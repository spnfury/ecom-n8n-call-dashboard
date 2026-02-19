export default async function handler(req, res) {
    const { shop } = req.query;

    if (!shop) {
        return res.status(400).send('Missing shop parameter');
    }

    // Basic shop domain validation
    const shopNameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
    if (!shopNameRegex.test(shop)) {
        return res.status(400).send('Invalid shop domain. Use your-store.myshopify.com');
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = `${process.env.APP_URL}/api/shopify/callback`;
    const scopes = 'read_orders,write_orders'; // Adjust as needed

    // In a real app, generate a secure random state and store it (e.g., in a cookie)
    const state = 'nonce';

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

    res.redirect(authUrl);
}
