import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const { data, error } = await supabase
                .from('ecom_stores')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.status(200).json({ stores: data || [] });
        }

        if (req.method === 'POST') {
            const { name, url, access_token, cod_gateway_name } = req.body;

            if (!name || !url) {
                return res.status(400).json({ error: 'Name and URL are required' });
            }

            const { data, error } = await supabase
                .from('ecom_stores')
                .insert({
                    name,
                    url,
                    access_token: access_token || '',
                    cod_gateway_name: cod_gateway_name || 'Cash on Delivery',
                    is_active: true
                })
                .select()
                .single();

            if (error) throw error;
            return res.status(201).json({ store: data });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing store id' });

            const { error } = await supabase
                .from('ecom_stores')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('Stores API error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
