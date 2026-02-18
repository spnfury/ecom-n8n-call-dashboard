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
        // Get settings
        const { data: settings } = await supabase.from('ecom_settings').select('*');
        const settingsMap = {};
        (settings || []).forEach(s => { settingsMap[s.key] = s.value; });

        const vapiKey = settingsMap.vapi_key;
        const assistantId = settingsMap.vapi_assistant_id;
        const phoneId = settingsMap.vapi_phone_id;

        if (!vapiKey || !assistantId) {
            return res.status(200).json({ message: 'Vapi not configured', triggered: 0 });
        }

        const hourStart = parseInt((settingsMap.hour_start || '09:00').split(':')[0]);
        const hourEnd = parseInt((settingsMap.hour_end || '21:00').split(':')[0]);
        const maxRetries = parseInt(settingsMap.max_retries) || 3;

        // Check current hour
        const now = new Date();
        const currentHour = now.getHours();
        if (currentHour < hourStart || currentHour >= hourEnd) {
            return res.status(200).json({ message: 'Outside business hours', triggered: 0 });
        }

        // Find orders ready to call
        const { data: pendingOrders, error } = await supabase
            .from('ecom_orders')
            .select('*')
            .in('status', ['pendiente', 'llamada_programada'])
            .lte('call_scheduled_at', now.toISOString())
            .lt('call_attempts', maxRetries)
            .order('call_scheduled_at', { ascending: true })
            .limit(5); // Process max 5 at a time

        if (error || !pendingOrders || pendingOrders.length === 0) {
            return res.status(200).json({ message: 'No pending calls', triggered: 0 });
        }

        let triggered = 0;
        const results = [];

        for (const order of pendingOrders) {
            if (!order.customer_phone) {
                // Mark as error if no phone
                await supabase
                    .from('ecom_orders')
                    .update({ status: 'no_contesta', notes: (order.notes || '') + '\n[Auto] Sin teléfono de contacto' })
                    .eq('id', order.id);
                results.push({ order: order.order_number, status: 'skipped_no_phone' });
                continue;
            }

            try {
                // Get store info for the call
                let storeName = '';
                if (order.store_id) {
                    const { data: store } = await supabase
                        .from('ecom_stores')
                        .select('name')
                        .eq('id', order.store_id)
                        .single();
                    storeName = store?.name || '';
                }

                // Make Vapi call
                const vapiPayload = {
                    assistantId: assistantId,
                    customer: {
                        number: order.customer_phone
                    },
                    assistantOverrides: {
                        variableValues: {
                            nombre_cliente: order.customer_name || '',
                            numero_pedido: order.order_number || '',
                            producto: order.product || '',
                            importe: String(order.amount || '0'),
                            direccion: order.address || '',
                            tienda: storeName
                        }
                    }
                };

                if (phoneId) {
                    vapiPayload.phoneNumberId = phoneId;
                }

                const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${vapiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(vapiPayload)
                });

                const vapiData = await vapiRes.json();

                if (!vapiRes.ok) {
                    console.error('Vapi call failed:', vapiData);
                    results.push({ order: order.order_number, status: 'vapi_error', error: vapiData });
                    continue;
                }

                // Create call record
                await supabase
                    .from('ecom_calls')
                    .insert({
                        order_id: order.id,
                        vapi_call_id: vapiData.id || '',
                        attempt_number: (order.call_attempts || 0) + 1,
                        started_at: new Date().toISOString()
                    });

                // Update order
                await supabase
                    .from('ecom_orders')
                    .update({
                        status: 'en_llamada',
                        call_attempts: (order.call_attempts || 0) + 1
                    })
                    .eq('id', order.id);

                triggered++;
                results.push({ order: order.order_number, status: 'called', vapi_call_id: vapiData.id });

            } catch (callErr) {
                console.error(`Error calling order ${order.order_number}:`, callErr);
                results.push({ order: order.order_number, status: 'error', error: callErr.message });
            }
        }

        return res.status(200).json({ success: true, triggered, results });

    } catch (err) {
        console.error('Trigger calls error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
