import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { order_id, from, to, result, limit } = req.query;

        let query = supabase
            .from('ecom_calls')
            .select('*, ecom_orders(order_number, customer_name, customer_phone, store_id)')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit) || 200);

        if (order_id) query = query.eq('order_id', order_id);
        if (result) query = query.eq('result', result);
        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to + 'T23:59:59.999Z');

        const { data, error } = await query;
        if (error) throw error;

        return res.status(200).json({ calls: data || [] });

    } catch (err) {
        console.error('Calls API error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
