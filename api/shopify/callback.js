import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
    const { shop, code, hmac, state } = req.query;

    if (!shop || !code || !hmac) {
        return res.status(400).send('Missing required parameters');
    }

    // 1. Verify HMAC
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const map = Object.assign({}, req.query);
    delete map['hmac'];
    const message = Object.keys(map).sort().map(key => `${key}=${map[key]}`).join('&');
    const generatedHmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

    if (generatedHmac !== hmac) {
        return res.status(401).send('HMAC validation failed');
    }

    try {
        // 2. Exchange code for access token
        const accessTokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: process.env.SHOPIFY_CLIENT_ID,
                client_secret: clientSecret,
                code
            })
        });

        const accessTokenData = await accessTokenResponse.json();
        const accessToken = accessTokenData.access_token;

        if (!accessToken) {
            return res.status(500).send('Failed to obtain access token');
        }

        // 3. Get shop info to get the store name
        const shopInfoResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
        });
        const shopInfoData = await shopInfoResponse.json();
        const storeName = shopInfoData.shop.name;

        // 4. Save/Update store in Supabase
        const { data: store, error: upsertError } = await supabase
            .from('ecom_stores')
            .upsert({
                name: storeName,
                url: shop,
                access_token: accessToken,
                is_active: true
            }, { onConflict: 'url' })
            .select()
            .single();

        if (upsertError) throw upsertError;

        // 5. Register Webhook (orders/create)
        const appUrl = process.env.APP_URL;
        const webhookUrl = `${appUrl}/api/shopify-webhook`;

        await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                webhook: {
                    topic: 'orders/create',
                    address: webhookUrl,
                    format: 'json'
                }
            })
        });

        // 6. Redirect back to dashboard with success
        res.redirect('/?connected=success');

    } catch (err) {
        console.error('Shopify OAuth Error:', err);
        res.status(500).send('Internal Server Error during Shopify connection');
    }
}
