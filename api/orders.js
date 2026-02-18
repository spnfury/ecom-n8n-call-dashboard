import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const { status, store_id, from, to, search, limit } = req.query;

            let query = supabase
                .from('ecom_orders')
                .select('*, ecom_stores(name, url)')
                .order('created_at', { ascending: false })
                .limit(parseInt(limit) || 200);

            if (status) query = query.eq('status', status);
            if (store_id) query = query.eq('store_id', store_id);
            if (from) query = query.gte('created_at', from);
            if (to) query = query.lte('created_at', to + 'T23:59:59.999Z');
            if (search) {
                query = query.or(
                    `customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%,order_number.ilike.%${search}%,product.ilike.%${search}%`
                );
            }

            const { data, error } = await query;
            if (error) throw error;

            // Get calls for each order
            const orderIds = (data || []).map(o => o.id);
            let calls = [];
            if (orderIds.length > 0) {
                const { data: callsData } = await supabase
                    .from('ecom_calls')
                    .select('*')
                    .in('order_id', orderIds)
                    .order('created_at', { ascending: false });
                calls = callsData || [];
            }

            // Merge calls into orders
            const orders = (data || []).map(order => ({
                ...order,
                store_name: order.ecom_stores?.name || '',
                store_url: order.ecom_stores?.url || '',
                calls: calls.filter(c => c.order_id === order.id),
                last_call: calls.find(c => c.order_id === order.id) || null
            }));

            return res.status(200).json({ orders });
        }

        if (req.method === 'PATCH') {
            const { id, ...updates } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing order id' });

            // Only allow safe fields
            const allowed = ['status', 'notes', 'address_corrected'];
            const safeUpdates = {};
            for (const key of allowed) {
                if (updates[key] !== undefined) safeUpdates[key] = updates[key];
            }

            const { data, error } = await supabase
                .from('ecom_orders')
                .update(safeUpdates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return res.status(200).json({ order: data });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('Orders API error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
