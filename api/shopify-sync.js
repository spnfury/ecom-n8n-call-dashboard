import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get all active stores with access tokens
        const { data: stores, error: storesErr } = await supabase
            .from('ecom_stores')
            .select('*')
            .eq('is_active', true)
            .neq('access_token', '');

        if (storesErr) throw storesErr;

        if (!stores || stores.length === 0) {
            return res.status(200).json({ message: 'No active stores with tokens', synced: 0 });
        }

        // Get settings for scheduling
        const { data: settings } = await supabase.from('ecom_settings').select('*');
        const settingsMap = {};
        (settings || []).forEach(s => { settingsMap[s.key] = s.value; });

        const waitMinutes = parseInt(settingsMap.wait_minutes) || 15;
        const hourStart = parseInt((settingsMap.hour_start || '09:00').split(':')[0]);
        const hourEnd = parseInt((settingsMap.hour_end || '21:00').split(':')[0]);

        let totalSynced = 0;
        const newOrders = [];
        const errors = [];

        for (const store of stores) {
            try {
                // Fetch recent orders from Shopify (last 30 days, open/any status)
                const shopifyUrl = `https://${store.url}/admin/api/2024-01/orders.json?status=any&limit=50&created_at_min=${getThirtyDaysAgo()}`;

                const shopifyRes = await fetch(shopifyUrl, {
                    headers: {
                        'X-Shopify-Access-Token': store.access_token,
                        'Content-Type': 'application/json'
                    }
                });

                if (!shopifyRes.ok) {
                    const errText = await shopifyRes.text();
                    console.error(`Shopify API error for ${store.name}:`, errText);
                    errors.push({ store: store.name, error: `HTTP ${shopifyRes.status}` });
                    continue;
                }

                const shopifyData = await shopifyRes.json();
                const orders = shopifyData.orders || [];

                // Get existing shopify_order_ids to avoid duplicates
                const shopifyIds = orders.map(o => o.id);
                let existingIds = new Set();

                if (shopifyIds.length > 0) {
                    const { data: existing } = await supabase
                        .from('ecom_orders')
                        .select('shopify_order_id')
                        .in('shopify_order_id', shopifyIds);
                    existingIds = new Set((existing || []).map(e => e.shopify_order_id));
                }

                // Filter to COD orders not yet in DB
                const codName = store.cod_gateway_name || 'Cash on Delivery';

                for (const order of orders) {
                    // Skip if already exists
                    if (existingIds.has(order.id)) continue;

                    // Check if COD
                    const paymentGateways = order.payment_gateway_names || [];
                    const isCOD = paymentGateways.some(g =>
                        g.toLowerCase().includes(codName.toLowerCase()) ||
                        g.toLowerCase().includes('cod') ||
                        g.toLowerCase().includes('contra reembolso') ||
                        g.toLowerCase().includes('cash on delivery')
                    );

                    if (!isCOD) continue;

                    // Extract customer data
                    const shipping = order.shipping_address || order.billing_address || {};
                    const lineItems = order.line_items || [];
                    const productNames = lineItems.map(i => `${i.title}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');

                    // Calculate scheduling
                    const now = new Date();
                    let scheduledAt = new Date(now.getTime() + waitMinutes * 60 * 1000);
                    let status = 'pendiente';

                    const scheduledHour = scheduledAt.getHours();
                    if (scheduledHour < hourStart || scheduledHour >= hourEnd) {
                        if (scheduledHour >= hourEnd) {
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

                    const newOrder = {
                        store_id: store.id,
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
                    };

                    const { data: inserted, error: insertErr } = await supabase
                        .from('ecom_orders')
                        .insert(newOrder)
                        .select()
                        .single();

                    if (insertErr) {
                        console.error('Insert error:', insertErr);
                        continue;
                    }

                    totalSynced++;
                    newOrders.push({
                        id: inserted.id,
                        order_number: inserted.order_number,
                        customer_name: inserted.customer_name,
                        store: store.name
                    });
                }

            } catch (storeErr) {
                console.error(`Error syncing store ${store.name}:`, storeErr);
                errors.push({ store: store.name, error: storeErr.message });
            }
        }

        return res.status(200).json({
            success: true,
            synced: totalSynced,
            new_orders: newOrders,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (err) {
        console.error('Shopify sync error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

function getThirtyDaysAgo() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
}
