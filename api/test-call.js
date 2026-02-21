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
        const { phone, customer_name, order_number, product, amount, address, store_name } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'El teléfono es obligatorio' });
        }

        // Get VAPI settings
        const { data: settings } = await supabase.from('ecom_settings').select('*');
        const settingsMap = {};
        (settings || []).forEach(s => { settingsMap[s.key] = s.value; });

        const vapiKey = settingsMap.vapi_key;
        const assistantId = settingsMap.vapi_assistant_id;
        const phoneId = settingsMap.vapi_phone_id;

        if (!vapiKey || !assistantId || !phoneId) {
            return res.status(400).json({ error: 'Vapi no está configurado. Configura la API Key, el ID del Asistente y el Phone Number ID en Configuración.' });
        }

        // Build VAPI payload with test data
        const vapiPayload = {
            assistantId: assistantId,
            phoneNumberId: phoneId,
            customer: {
                number: phone
            },
            assistantOverrides: {
                variableValues: {
                    nombre_cliente: customer_name || 'Cliente de Prueba',
                    numero_pedido: order_number || '#TEST-001',
                    producto: product || 'Producto de Ejemplo',
                    importe: String(amount || '29.99'),
                    direccion: address || 'Calle de Prueba 123, Madrid',
                    tienda: store_name || 'Mi Tienda Test'
                }
            }
        };

        // Make the VAPI call
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
            console.error('Test call VAPI error:', vapiData);
            return res.status(400).json({
                error: 'Error al iniciar la llamada de prueba',
                details: vapiData.message || JSON.stringify(vapiData)
            });
        }

        // Return success — NO database records created
        return res.status(200).json({
            success: true,
            message: 'Llamada de prueba iniciada correctamente',
            call_id: vapiData.id,
            status: vapiData.status
        });

    } catch (err) {
        console.error('Test call error:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}
