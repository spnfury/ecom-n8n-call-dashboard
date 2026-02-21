import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
    const { shop, code, hmac, state } = req.query;

    if (!shop || !code || !hmac) {
        return res.status(400).send('Missing required parameters');
    }

    // 1. Verify HMAC
    const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
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
                client_id: (process.env.SHOPIFY_CLIENT_ID || '').trim(),
                client_secret: clientSecret,
                code
            })
        });

        const accessTokenData = await accessTokenResponse.json();
        const accessToken = accessTokenData.access_token;

        if (!accessToken) {
            return res.status(500).json({ error: 'Failed to obtain access token', details: accessTokenData });
        }

        // 3. Get shop info to get the store name
        const shopInfoResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken }
        });
        const shopInfoData = await shopInfoResponse.json();

        if (!shopInfoData || !shopInfoData.shop) {
            return res.status(500).json({ error: 'Failed to fetch shop info', details: shopInfoData });
        }
        const storeName = shopInfoData.shop.name;

        // 4. Save store in Supabase (check if exists first)
        const { data: existingStore, error: selectError } = await supabase
            .from('ecom_stores')
            .select('id')
            .ilike('url', `%${shop}%`)
            .limit(1)
            .maybeSingle();

        if (selectError) {
            return res.status(500).json({ error: 'Database check error', details: selectError });
        }

        let store;
        if (existingStore) {
            const { data, error } = await supabase
                .from('ecom_stores')
                .update({ access_token: accessToken, is_active: true, name: storeName })
                .eq('id', existingStore.id)
                .select()
                .single();
            if (error) return res.status(500).json({ error: 'Database update error', details: error });
            store = data;
        } else {
            const { data, error } = await supabase
                .from('ecom_stores')
                .insert({ name: storeName, url: shop, access_token: accessToken, is_active: true })
                .select()
                .single();
            if (error) return res.status(500).json({ error: 'Database insert error', details: error });
            store = data;
        }

        // 5. Register Webhook (orders/create)
        const appUrl = (process.env.APP_URL || '').trim();
        const webhookUrl = `${appUrl}/api/shopify-webhook`;

        const webhookResponse = await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
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

        const webhookData = await webhookResponse.json();

        // Don't fail the whole auth if webhook fails, just log it (often fails if already registered)
        if (!webhookResponse.ok) {
            console.error('Webhook registration failed:', webhookData);
        }

        // 6. Redirect back to dashboard with success
        res.redirect('/?connected=success');

    } catch (err) {
        console.error('Shopify OAuth Error:', err);
        res.status(500).json({ error: 'Internal Server Error during Shopify connection', details: err.message, stack: err.stack });
    }
}
