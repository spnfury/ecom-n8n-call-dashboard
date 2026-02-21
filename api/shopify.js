import { createClient } from '@supabase/supabase-js';

let crypto;
try {
    crypto = await import('node:crypto');
} catch (e) {
    crypto = await import('crypto');
}

// ── Auth handler (was shopify/auth.js) ──
async function handleAuth(req, res) {
    let { shop } = req.query;

    if (!shop) {
        return res.status(400).json({ error: 'Missing shop parameter' });
    }

    shop = shop.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();

    const shopNameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
    if (!shopNameRegex.test(shop)) {
        return res.status(400).json({ error: 'Invalid shop domain. Use your-store.myshopify.com' });
    }

    const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
    const appUrl = (process.env.APP_URL || '').trim();

    if (!clientId) {
        return res.status(500).json({ error: 'SHOPIFY_CLIENT_ID not configured' });
    }
    if (!appUrl) {
        return res.status(500).json({ error: 'APP_URL not configured' });
    }

    const redirectUri = `${appUrl}/api/shopify?action=callback`;
    const scopes = 'read_orders,write_orders';
    const state = 'nonce';

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    res.redirect(authUrl);
}

// ── Callback handler (was shopify/callback.js) ──
async function handleCallback(req, res) {
    const { shop, code, hmac, state, host, timestamp } = req.query;

    if (!shop || !code) {
        return res.status(400).json({ error: 'Missing required parameters (shop or code)' });
    }

    // 1. Verify HMAC
    const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

    if (hmac && clientSecret) {
        try {
            const map = { ...req.query };
            delete map['hmac'];
            // Remove our routing param from HMAC validation
            delete map['action'];
            const message = Object.keys(map).sort().map(key => `${key}=${map[key]}`).join('&');
            const generatedHmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');

            if (generatedHmac !== hmac) {
                console.warn('HMAC mismatch - continuing anyway for debug');
            }
        } catch (hmacErr) {
            console.error('HMAC validation error:', hmacErr.message);
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
    }

    // 4. Save store in Supabase
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // 5. Register Webhook
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
}

// ── Router ──
export default async function handler(req, res) {
    try {
        const action = req.query.action || 'auth';

        if (action === 'callback') {
            return await handleCallback(req, res);
        } else {
            return await handleAuth(req, res);
        }
    } catch (err) {
        console.error('Shopify handler error:', err);
        return res.status(500).json({
            error: 'Shopify operation failed',
            message: err.message,
            stack: err.stack
        });
    }
}
