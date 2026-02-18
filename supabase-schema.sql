-- ============================================
-- ECOM COD CONFIRMATION - Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Tiendas Shopify
CREATE TABLE ecom_stores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    access_token TEXT NOT NULL DEFAULT '',
    cod_gateway_name TEXT NOT NULL DEFAULT 'Cash on Delivery',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos
CREATE TABLE ecom_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id UUID REFERENCES ecom_stores(id) ON DELETE SET NULL,
    shopify_order_id BIGINT,
    order_number TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    address_corrected TEXT DEFAULT '',
    product TEXT NOT NULL DEFAULT '',
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (status IN ('pendiente', 'llamada_programada', 'en_llamada', 'confirmado', 'rechazado', 'direccion_cambiada', 'no_contesta')),
    call_scheduled_at TIMESTAMPTZ,
    call_attempts INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Llamadas
CREATE TABLE ecom_calls (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES ecom_orders(id) ON DELETE CASCADE,
    vapi_call_id TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    cost DECIMAL(10,4) DEFAULT 0,
    ended_reason TEXT DEFAULT '',
    result TEXT DEFAULT ''
        CHECK (result IN ('', 'confirmado', 'rechazado', 'no_contesta', 'buzon', 'error', 'callback')),
    transcript TEXT DEFAULT '',
    recording_url TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configuración
CREATE TABLE ecom_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

-- Default settings
INSERT INTO ecom_settings (key, value) VALUES
    ('vapi_key', ''),
    ('vapi_assistant_id', ''),
    ('vapi_phone_id', ''),
    ('phone_number', ''),
    ('hour_start', '09:00'),
    ('hour_end', '21:00'),
    ('wait_minutes', '15'),
    ('max_retries', '3'),
    ('notification_channel', 'none'),
    ('prenotify_msg', 'Hola {nombre}, en breves recibirás una llamada para confirmar los datos de tu pedido #{pedido}. Por favor, atiende la llamada. Gracias.')
ON CONFLICT (key) DO NOTHING;

-- Indexes
CREATE INDEX idx_ecom_orders_status ON ecom_orders(status);
CREATE INDEX idx_ecom_orders_store ON ecom_orders(store_id);
CREATE INDEX idx_ecom_orders_scheduled ON ecom_orders(call_scheduled_at) WHERE status IN ('pendiente', 'llamada_programada');
CREATE INDEX idx_ecom_orders_shopify ON ecom_orders(shopify_order_id);
CREATE INDEX idx_ecom_calls_order ON ecom_calls(order_id);
CREATE INDEX idx_ecom_calls_vapi ON ecom_calls(vapi_call_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ecom_orders_updated_at
    BEFORE UPDATE ON ecom_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Enable RLS (optional, disable if using service key)
-- ALTER TABLE ecom_stores ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ecom_orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ecom_calls ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ecom_settings ENABLE ROW LEVEL SECURITY;
