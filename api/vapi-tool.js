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
        const body = req.body;

        // VAPI sends tool calls in this format
        const message = body.message || body;

        // Extract the tool call info
        let toolCall = null;
        let vapiCallId = '';

        if (message.type === 'tool-calls') {
            // Standard VAPI tool-calls format
            const toolCallList = message.toolCallList || [];
            toolCall = toolCallList[0] || null;
            vapiCallId = message.call?.id || '';
        } else if (message.toolCallList) {
            // Alternative format
            toolCall = message.toolCallList[0] || null;
            vapiCallId = message.call?.id || body.call?.id || '';
        } else if (body.functionCall || body.function_call) {
            // Direct function call format
            const fc = body.functionCall || body.function_call;
            toolCall = {
                id: body.toolCallId || 'direct',
                function: fc
            };
            vapiCallId = body.call?.id || body.callId || '';
        }

        if (!toolCall) {
            return res.status(400).json({ error: 'No tool call found in payload' });
        }

        const functionName = toolCall.function?.name || '';
        const args = typeof toolCall.function?.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : (toolCall.function?.arguments || {});

        console.log(`VAPI Tool Call: ${functionName}`, args, `callId: ${vapiCallId}`);

        // Only handle our function
        if (functionName !== 'actualizar_pedido') {
            return res.status(200).json({
                results: [{
                    toolCallId: toolCall.id,
                    result: 'Función no reconocida'
                }]
            });
        }

        const resultado = args.resultado || args.result || '';
        const nuevaDireccion = args.nueva_direccion || args.new_address || '';

        // Find the order via the active call record
        let order = null;

        if (vapiCallId) {
            const { data: callRecord } = await supabase
                .from('ecom_calls')
                .select('*, order_id')
                .eq('vapi_call_id', vapiCallId)
                .limit(1)
                .single();

            if (callRecord) {
                const { data: orderData } = await supabase
                    .from('ecom_orders')
                    .select('*')
                    .eq('id', callRecord.order_id)
                    .single();
                order = orderData;
            }
        }

        if (!order) {
            // Fallback: find the most recent order that is 'en_llamada'
            const { data: activeOrder } = await supabase
                .from('ecom_orders')
                .select('*')
                .eq('status', 'en_llamada')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();
            order = activeOrder;
        }

        if (!order) {
            return res.status(200).json({
                results: [{
                    toolCallId: toolCall.id,
                    result: 'No se encontró el pedido activo. El equipo lo revisará manualmente.'
                }]
            });
        }

        // Update the order based on resultado
        const updateData = {};
        let responseMessage = '';

        if (resultado === 'confirmado') {
            updateData.status = nuevaDireccion ? 'direccion_cambiada' : 'confirmado';
            if (nuevaDireccion) {
                updateData.address_corrected = nuevaDireccion;
                responseMessage = `Pedido ${order.order_number} confirmado con nueva dirección: ${nuevaDireccion}`;
            } else {
                responseMessage = `Pedido ${order.order_number} confirmado correctamente`;
            }
        } else if (resultado === 'rechazado') {
            updateData.status = 'rechazado';
            responseMessage = `Pedido ${order.order_number} marcado como rechazado`;
        } else {
            responseMessage = `Resultado "${resultado}" no reconocido. El equipo lo revisará.`;
        }

        if (Object.keys(updateData).length > 0) {
            const { error: updateErr } = await supabase
                .from('ecom_orders')
                .update(updateData)
                .eq('id', order.id);

            if (updateErr) {
                console.error('Error updating order:', updateErr);
                responseMessage = 'Error al actualizar el pedido. El equipo lo revisará manualmente.';
            }
        }

        // VAPI expects this response format for tool calls
        return res.status(200).json({
            results: [{
                toolCallId: toolCall.id,
                result: responseMessage
            }]
        });

    } catch (err) {
        console.error('VAPI tool error:', err);
        return res.status(200).json({
            results: [{
                toolCallId: 'error',
                result: 'Error interno. El equipo revisará el pedido manualmente.'
            }]
        });
    }
}
