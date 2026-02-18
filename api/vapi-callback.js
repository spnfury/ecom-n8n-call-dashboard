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
        const message = body.message || body;

        // Only process end-of-call reports
        if (message.type && message.type !== 'end-of-call-report') {
            return res.status(200).json({ message: 'Ignored non-end event' });
        }

        const call = message.call || {};
        const analysis = message.analysis || {};
        const vapiCallId = call.id || message.callId || '';

        if (!vapiCallId) {
            return res.status(400).json({ error: 'No call ID found' });
        }

        // Find the call record
        const { data: callRecord } = await supabase
            .from('ecom_calls')
            .select('*, order_id')
            .eq('vapi_call_id', vapiCallId)
            .limit(1)
            .single();

        if (!callRecord) {
            console.error(`No call record found for vapi_call_id: ${vapiCallId}`);
            return res.status(404).json({ error: 'Call record not found' });
        }

        // Determine result
        const successEval = (analysis.successEvaluation || message.successEvaluation || '').toLowerCase();
        let result = 'no_contesta';
        let orderStatus = 'no_contesta';

        if (successEval.includes('success') || successEval === 'true') {
            result = 'confirmado';
            orderStatus = 'confirmado';
        } else if (successEval.includes('fail') || successEval === 'false') {
            result = 'rechazado';
            orderStatus = 'rechazado';
        } else if (successEval.includes('callback')) {
            result = 'callback';
            orderStatus = 'llamada_programada';
        }

        const endedReason = message.endedReason || call.endedReason || '';
        const transcript = message.transcript || '';

        // Check for address change in transcript
        const transcriptLower = transcript.toLowerCase();
        let addressCorrected = '';
        if (transcriptLower.includes('cambiar') || transcriptLower.includes('nueva dirección') ||
            transcriptLower.includes('correg') || transcriptLower.includes('no es correcta')) {
            if (result === 'confirmado') {
                orderStatus = 'direccion_cambiada';
            }
            // Try to extract the new address from summary
            addressCorrected = analysis.structuredData?.new_address || message.summary || '';
        }

        // Handle no-answer / voicemail
        if (endedReason === 'voicemail' || endedReason.includes('voicemail')) {
            result = 'buzon';
            orderStatus = 'no_contesta';
        }
        if (endedReason === 'no-answer' || endedReason.includes('no-answer') ||
            endedReason.includes('failed-to-connect')) {
            result = 'no_contesta';
            orderStatus = 'no_contesta';
        }

        // Update the call record
        await supabase
            .from('ecom_calls')
            .update({
                ended_at: new Date().toISOString(),
                duration_seconds: message.durationSeconds || call.durationSeconds || 0,
                cost: message.cost || call.cost || 0,
                ended_reason: endedReason,
                result: result,
                transcript: transcript,
                recording_url: message.recordingUrl || call.recordingUrl || '',
                summary: message.summary || ''
            })
            .eq('id', callRecord.id);

        // Update order status
        const orderUpdate = { status: orderStatus };
        if (addressCorrected) {
            orderUpdate.address_corrected = addressCorrected;
        }

        // Get current order for retry logic
        const { data: order } = await supabase
            .from('ecom_orders')
            .select('*')
            .eq('id', callRecord.order_id)
            .single();

        // Handle retries if no answer
        if (orderStatus === 'no_contesta' && order) {
            const { data: settings } = await supabase.from('ecom_settings').select('*');
            const settingsMap = {};
            (settings || []).forEach(s => { settingsMap[s.key] = s.value; });
            const maxRetries = parseInt(settingsMap.max_retries) || 3;

            if (order.call_attempts < maxRetries) {
                // Schedule retry in 30 minutes (respecting hours)
                const hourStart = parseInt((settingsMap.hour_start || '09:00').split(':')[0]);
                const hourEnd = parseInt((settingsMap.hour_end || '21:00').split(':')[0]);
                let retryAt = new Date(Date.now() + 30 * 60 * 1000);
                const retryHour = retryAt.getHours();

                if (retryHour < hourStart || retryHour >= hourEnd) {
                    if (retryHour >= hourEnd) retryAt.setDate(retryAt.getDate() + 1);
                    retryAt.setHours(hourStart, 0, 0, 0);
                }

                orderUpdate.status = 'llamada_programada';
                orderUpdate.call_scheduled_at = retryAt.toISOString();
            }
        }

        await supabase
            .from('ecom_orders')
            .update(orderUpdate)
            .eq('id', callRecord.order_id);

        return res.status(200).json({ success: true, result, orderStatus: orderUpdate.status || orderStatus });

    } catch (err) {
        console.error('Vapi callback error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
