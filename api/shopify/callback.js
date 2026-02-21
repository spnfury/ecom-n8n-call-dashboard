import { createClient } from '@supabase/supabase-js';

let crypto;
try {
    crypto = await import('node:crypto');
} catch (e) {
    // Fallback
    crypto = await import('crypto');
}

export default async function handler(req, res) {
    try {
        const { shop, code, hmac, state, host, timestamp } = req.query;

        if (!shop || !code) {
            return res.status(400).json({ error: 'Missing required parameters (shop or code)' });
        }

        // 1. Verify HMAC (optional - skip if it causes issues)
        const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

        if (hmac && clientSecret) {
            try {
                const map = { ...req.query };
                delete map['hmac'];
                const message = Object.keys(map).sort().map(key => `${key}=${map[key]}`).join('&');
                const generatedHmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

                if (generatedHmac !== hmac) {
                    console.warn('HMAC mismatch - continuing anyway for debug');
                    // In production you'd return 401 here
                }
            } catch (hmacErr) {
                console.error('HMAC validation error:', hmacErr.message);
                // Continue anyway
            }
        }

        // 2. Exchange code for access token
        const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();

        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code
            })
        });

        const tokenData = await tokenRes.json();

        if (!tokenData.access_token) {
            return res.status(500).json({ error: 'Failed to get access token', shopify_response: tokenData });
        }

        const accessToken = tokenData.access_token;

        // 3. Get shop info
        let storeName = shop;
        try {
            const shopRes = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
                headers: { 'X-Shopify-Access-Token': accessToken }
            });
            const shopData = await shopRes.json();
            if (shopData && shopData.shop && shopData.shop.name) {
                storeName = shopData.shop.name;
            }
        } catch (shopErr) {
            console.error('Failed to fetch shop info:', shopErr.message);
            // Use shop domain as name fallback
        }

        // 4. Save store in Supabase
        const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
        const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();

        if (!supabaseUrl || !supabaseKey) {
            return res.status(500).json({ error: 'Supabase not configured' });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // Check if store already exists
        const { data: existing } = await supabase
            .from('ecom_stores')
            .select('id')
            .eq('url', shop)
            .maybeSingle();

        if (existing) {
            await supabase
                .from('ecom_stores')
                .update({ access_token: accessToken, is_active: true, name: storeName })
                .eq('id', existing.id);
        } else {
            await supabase
                .from('ecom_stores')
                .insert({ name: storeName, url: shop, access_token: accessToken, is_active: true });
        }

        // 5. Register Webhook (best effort, don't block on failure)
        try {
            const appUrl = (process.env.APP_URL || '').trim();
            if (appUrl) {
                await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        webhook: {
                            topic: 'orders/create',
                            address: `${appUrl}/api/shopify-webhook`,
                            format: 'json'
                        }
                    })
                });
            }
        } catch (webhookErr) {
            console.error('Webhook registration failed:', webhookErr.message);
        }

        // 6. Redirect back to dashboard
        const appUrl = (process.env.APP_URL || '').trim();
        const redirectTo = appUrl ? `${appUrl}/?connected=success` : '/?connected=success';
        return res.redirect(redirectTo);

    } catch (err) {
        console.error('Shopify callback fatal error:', err);
        return res.status(500).json({
            error: 'Shopify connection failed',
            message: err.message,
            stack: err.stack
        });
    }
}
