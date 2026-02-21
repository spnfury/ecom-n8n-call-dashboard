export default async function handler(req, res) {
    try {
        let { shop } = req.query;

        if (!shop) {
            return res.status(400).json({ error: 'Missing shop parameter' });
        }

        // Clean the shop domain (remove https://, http://, trailing slashes)
        shop = shop.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();

        // Basic shop domain validation
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

        const redirectUri = `${appUrl}/api/shopify/callback`;
        const scopes = 'read_orders,write_orders';
        const state = 'nonce';

        const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

        res.redirect(authUrl);
    } catch (err) {
        console.error('Shopify auth error:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
}
