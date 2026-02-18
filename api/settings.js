import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const { data, error } = await supabase
                .from('ecom_settings')
                .select('*');

            if (error) throw error;

            const settings = {};
            (data || []).forEach(s => { settings[s.key] = s.value; });
            return res.status(200).json({ settings });
        }

        if (req.method === 'POST') {
            const updates = req.body;

            if (!updates || typeof updates !== 'object') {
                return res.status(400).json({ error: 'Invalid settings' });
            }

            // Upsert each setting
            const upserts = Object.entries(updates).map(([key, value]) => ({
                key,
                value: String(value)
            }));

            const { error } = await supabase
                .from('ecom_settings')
                .upsert(upserts, { onConflict: 'key' });

            if (error) throw error;
            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('Settings API error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
