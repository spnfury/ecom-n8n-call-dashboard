import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const order = req.body;

        // Validate it's a Shopify order
        if (!order || !order.id) {
            return res.status(400).json({ error: 'Invalid order payload' });
        }

        // Find the store by checking the Shopify domain header
        const shopifyDomain = req.headers['x-shopify-shop-domain'] || '';
        let store = null;

        if (shopifyDomain) {
            const { data } = await supabase
                .from('ecom_stores')
                .select('*')
                .ilike('url', `%${shopifyDomain}%`)
                .eq('is_active', true)
                .limit(1)
                .single();
            store = data;
        }

        // Check if it's a COD order
        const paymentGateways = order.payment_gateway_names || [];
        const codName = store?.cod_gateway_name || 'Cash on Delivery';
        const isCOD = paymentGateways.some(g =>
            g.toLowerCase().includes(codName.toLowerCase()) ||
            g.toLowerCase().includes('cod') ||
            g.toLowerCase().includes('contra reembolso') ||
            g.toLowerCase().includes('cash on delivery')
        );

        if (!isCOD) {
            return res.status(200).json({ message: 'Not a COD order, skipped' });
        }

        // Check for duplicate
        const { data: existing } = await supabase
            .from('ecom_orders')
            .select('id')
            .eq('shopify_order_id', order.id)
            .limit(1);

        if (existing && existing.length > 0) {
            return res.status(200).json({ message: 'Order already exists', id: existing[0].id });
        }

        // Extract customer data
        const shipping = order.shipping_address || order.billing_address || {};
        const lineItems = order.line_items || [];
        const productNames = lineItems.map(i => `${i.title}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');

        // Get settings for scheduling
        const { data: settings } = await supabase.from('ecom_settings').select('*');
        const settingsMap = {};
        (settings || []).forEach(s => { settingsMap[s.key] = s.value; });

        const waitMinutes = parseInt(settingsMap.wait_minutes) || 15;
        const hourStart = parseInt((settingsMap.hour_start || '09:00').split(':')[0]);
        const hourEnd = parseInt((settingsMap.hour_end || '21:00').split(':')[0]);

        // Calculate call_scheduled_at
        const now = new Date();
        const currentHour = now.getHours();
        let scheduledAt = new Date(now.getTime() + waitMinutes * 60 * 1000);
        let status = 'pendiente';

        // Check if scheduled time falls within business hours
        const scheduledHour = scheduledAt.getHours();
        if (scheduledHour < hourStart || scheduledHour >= hourEnd) {
            // Schedule for next available window
            if (scheduledHour >= hourEnd || currentHour >= hourEnd) {
                scheduledAt.setDate(scheduledAt.getDate() + 1);
            }
            scheduledAt.setHours(hourStart, 0, 0, 0);
            status = 'llamada_programada';
        }

        // Build address
        const addressParts = [
            shipping.address1,
            shipping.address2,
            shipping.city,
            shipping.province,
            shipping.zip,
            shipping.country
        ].filter(Boolean);

        // Insert order
        const { data: newOrder, error } = await supabase
            .from('ecom_orders')
            .insert({
                store_id: store?.id || null,
                shopify_order_id: order.id,
                order_number: order.name || `#${order.order_number}`,
                customer_name: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || order.customer?.first_name || 'Sin nombre',
                customer_phone: shipping.phone || order.phone || order.billing_address?.phone || '',
                address: addressParts.join(', '),
                product: productNames || 'Producto no especificado',
                amount: parseFloat(order.total_price) || 0,
                currency: order.currency || 'EUR',
                status: status,
                call_scheduled_at: scheduledAt.toISOString(),
                call_attempts: 0
            })
            .select()
            .single();

        if (error) {
            console.error('Error inserting order:', error);
            return res.status(500).json({ error: 'Failed to save order' });
        }

        return res.status(200).json({ success: true, order_id: newOrder.id, status });

    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
