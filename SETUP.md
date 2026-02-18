# Guía de Configuración - Ecom Call Dashboard

## Arquitectura

```
Dashboard (Vite) → /api/* (Vercel Serverless) → Supabase (Postgres)
Shopify Webhook → /api/shopify-webhook → Supabase
Vercel Cron (1min) → /api/trigger-calls → Vapi AI → /api/vapi-callback → Supabase
```

## 1. Crear Proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea un proyecto (o usa uno existente)
2. Abre el **SQL Editor**
3. Copia y pega el contenido de `supabase-schema.sql`
4. Ejecuta el script
5. Anota:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Service Key** (Settings → API → service_role key)

## 2. Configurar Variables en Vercel

En tu proyecto Vercel, añade estas **Environment Variables**:

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJhbG...` (service_role key) |

## 3. Deploy

```bash
cd ecom-n8n-call-dashboard
vercel --prod
```

El deploy configurará automáticamente:
- Frontend estático (Vite build)
- API routes en `/api/*`
- Cron job cada minuto para lanzar llamadas pendientes

## 4. Configurar el Dashboard

1. Abre tu dashboard desplegado
2. Contraseña: `ecom2024`
3. Ve a **⚙️ Configuración** y rellena:
   - Vapi API Key y Assistant ID
   - Número de teléfono
   - Horarios (default 9:00-21:00)
   - Espera (default 15 min)

## 5. Añadir Tienda Shopify

1. En el dashboard, ve a **🏪 Tiendas** → **+ Añadir Tienda**
2. Rellena nombre, URL, access token, y nombre del gateway COD
3. Copia la **URL del Webhook** que aparece
4. En Shopify → Settings → Notifications → Webhooks:
   - Event: **Order creation**
   - URL: la URL copiada
   - Format: JSON

## 6. Configurar Vapi

1. Crea un asistente en [dashboard.vapi.ai](https://dashboard.vapi.ai)
2. Usa el script de `vapi-assistant-script.md` como System Prompt
3. En Server URL, pon: `https://tu-dominio.vercel.app/api/vapi-callback`
4. Copia el Assistant ID → ponlo en la configuración del dashboard

## Estructura del Proyecto

```
ecom-n8n-call-dashboard/
├── api/                          ← Backend (Vercel Serverless)
│   ├── lib/supabase.js           ← Cliente Supabase
│   ├── shopify-webhook.js        ← Recibe pedidos Shopify
│   ├── vapi-callback.js          ← Recibe resultados Vapi
│   ├── trigger-calls.js          ← Lanza llamadas (cron)
│   ├── orders.js                 ← API pedidos
│   ├── stores.js                 ← API tiendas
│   ├── calls.js                  ← API llamadas
│   └── settings.js               ← API configuración
├── call-dashboard-app/           ← Frontend (Vite)
│   ├── index.html
│   ├── style.css
│   └── main.js
├── supabase-schema.sql           ← Schema BD
├── vapi-assistant-script.md      ← Script IA
├── package.json                  ← Deps del backend
└── vercel.json                   ← Config deploy + cron
```
