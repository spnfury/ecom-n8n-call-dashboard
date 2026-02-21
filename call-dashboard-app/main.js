// ============================================
// ECOM CALL DASHBOARD - Main Application
// Uses /api/* backend (Vercel Serverless + Supabase)
// ============================================

// ---- API HELPERS ----
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : '/api';

async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}/${endpoint}`;
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'API Error');
    }
    return res.json();
}

// ---- STATE ----
let allOrders = [];
let allStores = [];
let currentView = 'dashboard';
let ordersChartInstance = null;
let statusChartInstance = null;
let triggerInterval = null;

// ---- CONFIG ----
const LOCAL_PASSWORD = 'ecom2024';

// ---- DATA FETCHING ----
async function fetchOrders(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.store_id) params.set('store_id', filters.store_id);
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        if (filters.search) params.set('search', filters.search);
        const qs = params.toString();
        const data = await apiFetch(`orders${qs ? '?' + qs : ''}`);
        return data.orders || [];
    } catch (err) {
        console.error('Error fetching orders:', err);
        showToast('Error al cargar pedidos: ' + err.message, 'error');
        return [];
    }
}

async function fetchStores() {
    try {
        const data = await apiFetch('stores');
        return data.stores || [];
    } catch (err) {
        console.error('Error fetching stores:', err);
        return [];
    }
}

async function fetchSettings() {
    try {
        const data = await apiFetch('settings');
        return data.settings || {};
    } catch (err) {
        console.error('Error fetching settings:', err);
        return {};
    }
}

async function saveSettingsToAPI(settings) {
    await apiFetch('settings', {
        method: 'POST',
        body: JSON.stringify(settings)
    });
}

async function updateOrder(id, updates) {
    return apiFetch('orders', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...updates })
    });
}

async function triggerPendingCalls() {
    try {
        const data = await apiFetch('trigger-calls', { method: 'POST' });
        if (data.triggered > 0) {
            showToast(`${data.triggered} llamada(s) iniciada(s)`, 'success');
            await loadData();
        }
    } catch (err) {
        // Silent fail for polling
        console.log('Trigger check:', err.message);
    }
}

// ---- NAVIGATION ----
function switchView(viewName) {
    currentView = viewName;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${viewName}"]`)?.classList.add('active');

    const titles = {
        dashboard: 'Dashboard',
        orders: 'Pedidos',
        calls: 'Llamadas',
        stores: 'Tiendas',
        settings: 'Configuración'
    };
    document.getElementById('page-title').textContent = titles[viewName] || viewName;

    document.getElementById('sidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('active');
}

// ---- FORMATTING ----
function formatDate(dateStr, short = false) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (short) return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds) {
    if (!seconds) return '-';
    const s = parseInt(seconds);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function getStatusBadge(status) {
    const map = {
        'pendiente': { label: '⏳ Pendiente', class: 'status-pendiente' },
        'llamada_programada': { label: '📅 Programada', class: 'status-programado' },
        'en_llamada': { label: '📞 En Llamada', class: 'status-en-llamada' },
        'confirmado': { label: '✅ Confirmado', class: 'status-confirmado' },
        'rechazado': { label: '❌ Rechazado', class: 'status-rechazado' },
        'direccion_cambiada': { label: '📍 Dir. Cambiada', class: 'status-direccion-cambiada' },
        'no_contesta': { label: '🔇 No Contesta', class: 'status-no-contesta' }
    };
    const s = map[status] || { label: status || 'Desconocido', class: 'status-pendiente' };
    return `<span class="status-badge ${s.class}">${s.label}</span>`;
}

function getCallStatusIcon(status) {
    if (!status || status === 'pendiente') return '⏳';
    if (status === 'confirmado' || status === 'direccion_cambiada') return '✅';
    if (status === 'rechazado') return '❌';
    if (status === 'no_contesta') return '🔇';
    if (status === 'en_llamada') return '📞';
    return '📅';
}

// ---- DASHBOARD VIEW ----
function updateDashboardStats(orders) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = orders.filter(o => new Date(o.created_at) >= today);
    const confirmed = orders.filter(o => o.status === 'confirmado').length;
    const rejected = orders.filter(o => o.status === 'rechazado').length;
    const pending = orders.filter(o => ['pendiente', 'llamada_programada', 'en_llamada'].includes(o.status)).length;
    const addressChanged = orders.filter(o => o.status === 'direccion_cambiada').length;
    const totalProcessed = confirmed + rejected;
    const confirmRate = totalProcessed > 0 ? Math.round((confirmed / totalProcessed) * 100) : 0;

    document.getElementById('stat-total-orders').textContent = todayOrders.length;
    document.getElementById('stat-confirmed').textContent = confirmed;
    document.getElementById('stat-rejected').textContent = rejected;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-address-changed').textContent = addressChanged;
    document.getElementById('stat-confirm-rate').textContent = confirmRate + '%';

    const badge = document.getElementById('pending-badge');
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'inline' : 'none';
}

function updateOrdersChart(orders) {
    const ctx = document.getElementById('orders-chart')?.getContext('2d');
    if (!ctx) return;

    const grouped = {};
    orders.forEach(o => {
        const day = formatDate(o.created_at, true);
        if (day !== '-') grouped[day] = (grouped[day] || 0) + 1;
    });

    const labels = Object.keys(grouped).reverse();
    const data = Object.values(grouped).reverse();

    if (ordersChartInstance) ordersChartInstance.destroy();
    ordersChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Pedidos por Día',
                data,
                borderColor: '#7c5cfc',
                backgroundColor: 'rgba(124, 92, 252, 0.08)',
                fill: true,
                tension: 0.4,
                borderWidth: 2.5,
                pointBackgroundColor: '#7c5cfc',
                pointBorderColor: '#0a0a0f',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8888aa', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#8888aa' } }
            }
        }
    });
}

function updateStatusChart(orders) {
    const ctx = document.getElementById('status-chart')?.getContext('2d');
    if (!ctx) return;

    const counts = {
        confirmado: orders.filter(o => o.status === 'confirmado').length,
        rechazado: orders.filter(o => o.status === 'rechazado').length,
        pendiente: orders.filter(o => ['pendiente', 'llamada_programada', 'en_llamada'].includes(o.status)).length,
        no_contesta: orders.filter(o => o.status === 'no_contesta').length,
        direccion_cambiada: orders.filter(o => o.status === 'direccion_cambiada').length
    };

    if (statusChartInstance) statusChartInstance.destroy();
    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Confirmados', 'Rechazados', 'Pendientes', 'No Contesta', 'Dir. Cambiada'],
            datasets: [{
                data: Object.values(counts),
                backgroundColor: ['#00e676', '#ff5252', '#ffab40', '#8888aa', '#ffd740'],
                borderColor: '#1a1a2e',
                borderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#8888aa', padding: 12, usePointStyle: true, pointStyleWidth: 10, font: { size: 11 } }
                }
            }
        }
    });
}

function renderRecentOrders(orders) {
    const tbody = document.getElementById('recent-orders-table');
    const recent = orders.slice(0, 10);

    if (recent.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading-row" style="animation:none; padding:48px;">No hay pedidos. Añade una tienda Shopify y configura el webhook.</td></tr>';
        return;
    }

    tbody.innerHTML = recent.map((o, i) => `
        <tr>
            <td><code style="color: var(--accent-light); font-size: 12px;">${o.order_number || '-'}</code></td>
            <td><strong>${o.customer_name || '-'}</strong></td>
            <td>${o.store_name || ''}</td>
            <td style="max-width:160px; overflow:hidden; text-overflow:ellipsis;">${o.product || '-'}</td>
            <td><strong>${o.amount || '-'}€</strong></td>
            <td>${getStatusBadge(o.status)}</td>
            <td>${getCallStatusIcon(o.status)} ${o.call_attempts || 0} int.</td>
            <td><button class="action-btn" data-order-id="${o.id}" data-source="recent">👁 Ver</button></td>
        </tr>
    `).join('');
}

// ---- ORDERS VIEW ----
function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-table');
    document.getElementById('orders-count').textContent = `${orders.length} pedidos`;

    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="loading-row" style="animation:none;">No hay pedidos que coincidan con los filtros</td></tr>';
        return;
    }

    tbody.innerHTML = orders.map((o) => `
        <tr>
            <td><code style="color: var(--accent-light); font-size: 12px;">${o.order_number || '-'}</code></td>
            <td>${formatDate(o.created_at)}</td>
            <td><strong>${o.customer_name || '-'}</strong></td>
            <td style="font-family: monospace; color: var(--text-secondary);">${o.customer_phone || '-'}</td>
            <td>${o.store_name || ''}</td>
            <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis;">${o.product || '-'}</td>
            <td><strong>${o.amount || '-'}€</strong></td>
            <td>${getStatusBadge(o.status)}</td>
            <td>${getCallStatusIcon(o.status)}</td>
            <td>${o.call_attempts || 0}/3</td>
            <td><button class="action-btn" data-order-id="${o.id}" data-source="all">👁 Ver</button></td>
        </tr>
    `).join('');
}

async function applyOrderFilters() {
    const filters = {
        status: document.getElementById('filter-status')?.value || '',
        store_id: document.getElementById('filter-store')?.value || '',
        from: document.getElementById('filter-date-from')?.value || '',
        to: document.getElementById('filter-date-to')?.value || '',
        search: document.getElementById('filter-search')?.value || ''
    };

    // Filter locally from allOrders for responsiveness
    let filtered = [...allOrders];
    if (filters.status) filtered = filtered.filter(o => o.status === filters.status);
    if (filters.store_id) filtered = filtered.filter(o => o.store_id === filters.store_id);
    if (filters.from) {
        const d = new Date(filters.from);
        d.setHours(0, 0, 0, 0);
        filtered = filtered.filter(o => new Date(o.created_at) >= d);
    }
    if (filters.to) {
        const d = new Date(filters.to);
        d.setHours(23, 59, 59, 999);
        filtered = filtered.filter(o => new Date(o.created_at) <= d);
    }
    if (filters.search) {
        const s = filters.search.toLowerCase();
        filtered = filtered.filter(o =>
            (o.customer_name || '').toLowerCase().includes(s) ||
            (o.customer_phone || '').toLowerCase().includes(s) ||
            (o.order_number || '').toLowerCase().includes(s) ||
            (o.product || '').toLowerCase().includes(s)
        );
    }

    renderOrdersTable(filtered);
}

// ---- CALLS VIEW ----
function renderCallsTable(orders) {
    const tbody = document.getElementById('calls-table');
    // Flatten calls from all orders
    const allCallsList = [];
    orders.forEach(o => {
        (o.calls || []).forEach(c => {
            allCallsList.push({
                ...c,
                order_number: o.order_number,
                customer_name: o.customer_name,
                customer_phone: o.customer_phone,
                order_status: o.status
            });
        });
    });

    allCallsList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (allCallsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-row" style="animation:none;">No hay llamadas registradas</td></tr>';
        return;
    }

    tbody.innerHTML = allCallsList.map((c) => `
        <tr>
            <td><code style="color: var(--accent-light); font-size: 11px;">${c.vapi_call_id ? c.vapi_call_id.substring(0, 12) + '...' : '-'}</code></td>
            <td>${c.order_number || '-'}</td>
            <td><strong>${c.customer_name || '-'}</strong></td>
            <td style="font-family: monospace; color: var(--text-secondary);">${c.customer_phone || '-'}</td>
            <td>${formatDate(c.started_at || c.created_at)}</td>
            <td>${formatDuration(c.duration_seconds)}</td>
            <td>${getStatusBadge(c.result || c.order_status)}</td>
            <td>${c.cost || '-'}€</td>
            <td><button class="action-btn" data-order-id="${c.order_id}" data-source="calls">👁 Ver</button></td>
        </tr>
    `).join('');
}

// ---- STORES VIEW ----
function renderStores() {
    const stores = allStores;
    const grid = document.getElementById('stores-grid');
    const noStores = document.getElementById('no-stores');
    const webhookCard = document.getElementById('webhook-info-card');

    if (stores.length === 0) {
        grid.style.display = 'none';
        noStores.style.display = 'block';
        webhookCard.style.display = 'none';
        return;
    }

    noStores.style.display = 'none';
    grid.style.display = 'grid';
    webhookCard.style.display = 'block';

    // Set webhook URL
    const host = window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin;
    document.getElementById('webhook-url').textContent = `${host}/api/shopify-webhook`;

    // Populate store filter
    const storeFilter = document.getElementById('filter-store');
    if (storeFilter) {
        const currentVal = storeFilter.value;
        storeFilter.innerHTML = '<option value="">Todas</option>' + stores.map(s =>
            `<option value="${s.id}">${s.name}</option>`
        ).join('');
        storeFilter.value = currentVal;
    }

    grid.innerHTML = stores.map((store) => {
        const storeOrders = allOrders.filter(o => o.store_id === store.id);
        const confirmed = storeOrders.filter(o => o.status === 'confirmado').length;
        const total = storeOrders.length;

        return `
            <div class="store-card">
                <div class="store-card-header">
                    <span class="store-card-name">${store.name}</span>
                    <span class="store-status" title="${store.is_active ? 'Activa' : 'Inactiva'}" style="background: ${store.is_active ? 'var(--green)' : 'var(--red)'}; box-shadow: 0 0 8px ${store.is_active ? 'var(--green)' : 'var(--red)'}"></span>
                </div>
                <div class="store-card-url">${store.url}</div>
                <div class="store-card-stats">
                    <div class="store-stat">
                        <div class="store-stat-value">${total}</div>
                        <div class="store-stat-label">Pedidos</div>
                    </div>
                    <div class="store-stat">
                        <div class="store-stat-value" style="color: var(--green);">${confirmed}</div>
                        <div class="store-stat-label">Confirmados</div>
                    </div>
                    <div class="store-stat">
                        <div class="store-stat-value">${total > 0 ? Math.round(confirmed / total * 100) : 0}%</div>
                        <div class="store-stat-label">Tasa</div>
                    </div>
                </div>
                <div class="store-card-actions">
                    <button class="btn btn-ghost btn-sm" style="color: var(--red);" data-delete-store="${store.id}" data-store-name="${store.name}">🗑️ Eliminar</button>
                </div>
            </div>
        `;
    }).join('');
}

// ---- ORDER DETAIL MODAL ----
function openOrderDetail(order) {
    if (!order) return;

    document.getElementById('order-modal-title').textContent = `Pedido ${order.order_number || ''}`;
    document.getElementById('order-modal-subtitle').textContent = `${order.customer_name} • ${order.store_name || ''}`;

    document.getElementById('od-order-number').textContent = order.order_number || '-';
    document.getElementById('od-store').textContent = order.store_name || '-';
    document.getElementById('od-product').textContent = order.product || '-';
    document.getElementById('od-amount').textContent = (order.amount || '-') + '€';
    document.getElementById('od-date').textContent = formatDate(order.created_at);
    document.getElementById('od-status').innerHTML = getStatusBadge(order.status);

    document.getElementById('od-customer-name').textContent = order.customer_name || '-';
    document.getElementById('od-customer-phone').textContent = order.customer_phone || '-';
    document.getElementById('od-address-original').textContent = order.address || '-';

    const changedRow = document.getElementById('od-address-changed-row');
    if (order.address_corrected) {
        changedRow.style.display = 'flex';
        document.getElementById('od-address-corrected').textContent = order.address_corrected;
    } else {
        changedRow.style.display = 'none';
    }

    // Call timeline from actual call records
    const timeline = document.getElementById('od-call-timeline');
    const calls = order.calls || [];

    if (calls.length > 0) {
        timeline.innerHTML = calls.map(c => {
            const icon = c.result === 'confirmado' ? 'success' :
                (c.result === 'rechazado' ? 'fail' : 'pending');
            const emoji = icon === 'success' ? '✅' : (icon === 'fail' ? '❌' : '⏳');
            return `
                <div class="timeline-item">
                    <div class="timeline-icon ${icon}">${emoji}</div>
                    <div class="timeline-info">
                        <div class="timeline-title">Intento ${c.attempt_number} — ${c.result || c.ended_reason || 'En proceso'}</div>
                        <div class="timeline-meta">${formatDate(c.started_at)} • ${formatDuration(c.duration_seconds)} • ${c.cost || '0'}€</div>
                    </div>
                </div>
            `;
        }).join('');
    } else if (order.call_attempts > 0) {
        timeline.innerHTML = `<div class="timeline-empty">Llamada en proceso...</div>`;
    } else {
        timeline.innerHTML = '<div class="timeline-empty">No hay llamadas registradas aún</div>';
    }

    // Transcript (from last call)
    const lastCall = calls[0] || order.last_call;
    const transcriptSection = document.getElementById('od-transcript-section');
    if (lastCall?.transcript) {
        transcriptSection.style.display = 'block';
        document.getElementById('od-transcript').textContent = lastCall.transcript;
    } else {
        transcriptSection.style.display = 'none';
    }

    // Recording
    const recordingSection = document.getElementById('od-recording-section');
    if (lastCall?.recording_url) {
        recordingSection.style.display = 'block';
        document.getElementById('od-audio').src = lastCall.recording_url;
    } else {
        recordingSection.style.display = 'none';
    }

    // Notes
    document.getElementById('od-notes').value = order.notes || '';

    // Store order ref
    document.getElementById('order-modal').dataset.orderId = order.id;
    document.getElementById('order-modal').style.display = 'flex';
}

// ---- SETTINGS ----
async function loadSettings() {
    const settings = await fetchSettings();
    document.getElementById('setting-vapi-key').value = settings.vapi_key || '';
    document.getElementById('setting-vapi-assistant').value = settings.vapi_assistant_id || '';
    document.getElementById('setting-phone-number').value = settings.phone_number || '';
    document.getElementById('setting-hour-start').value = settings.hour_start || '09:00';
    document.getElementById('setting-hour-end').value = settings.hour_end || '21:00';
    document.getElementById('setting-wait-minutes').value = settings.wait_minutes || '15';
    document.getElementById('setting-max-retries').value = settings.max_retries || '3';
    document.getElementById('setting-notification-channel').value = settings.notification_channel || 'none';
    document.getElementById('setting-prenotify-msg').value = settings.prenotify_msg || '';
}

async function saveSettings() {
    const btn = document.getElementById('save-settings-btn');
    btn.disabled = true;
    btn.textContent = '⌛ Guardando...';

    try {
        await saveSettingsToAPI({
            vapi_key: document.getElementById('setting-vapi-key').value,
            vapi_assistant_id: document.getElementById('setting-vapi-assistant').value,
            phone_number: document.getElementById('setting-phone-number').value,
            hour_start: document.getElementById('setting-hour-start').value,
            hour_end: document.getElementById('setting-hour-end').value,
            wait_minutes: document.getElementById('setting-wait-minutes').value,
            max_retries: document.getElementById('setting-max-retries').value,
            notification_channel: document.getElementById('setting-notification-channel').value,
            prenotify_msg: document.getElementById('setting-prenotify-msg').value
        });
        showToast('Configuración guardada', 'success');
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = '💾 Guardar Configuración';
}

// ---- TOAST ----
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---- MAIN LOAD ----
async function loadData() {
    try {
        const [orders, stores] = await Promise.all([
            fetchOrders(),
            fetchStores()
        ]);

        allOrders = orders;
        allStores = stores;

        updateDashboardStats(orders);
        updateOrdersChart(orders);
        updateStatusChart(orders);
        renderRecentOrders(orders);
        renderOrdersTable(orders);
        renderCallsTable(orders);
        renderStores();

    } catch (err) {
        console.error('Error loading data:', err);
        showToast('Error al cargar datos', 'error');
    }
}

// ---- AUTH ----
function showDashboard() {
    document.body.classList.remove('auth-hidden');
    document.getElementById('login-gate').style.display = 'none';
    loadSettings();
    loadData();

    // Auto-refresh every 30s
    setInterval(loadData, 30000);

    // Trigger pending calls every 60s (backup for cron)
    triggerInterval = setInterval(triggerPendingCalls, 60000);
}

function checkAuth() {
    if (localStorage.getItem('ecom_dashboard_auth') === 'true') {
        showDashboard();

        // Handle Shopify connection success redirect
        const params = new URLSearchParams(window.location.search);
        if (params.get('connected') === 'success') {
            showToast('¡Tienda conectada con éxito!', 'success');
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
}

// ---- EVENT LISTENERS ----

// Login
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('password-input').value;
    if (password === LOCAL_PASSWORD) {
        localStorage.setItem('ecom_dashboard_auth', 'true');
        showDashboard();
    } else {
        document.getElementById('auth-error').style.display = 'block';
    }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('ecom_dashboard_auth');
    if (triggerInterval) clearInterval(triggerInterval);
    location.reload();
});

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(item.dataset.view);
    });
});

document.querySelectorAll('[data-navigate]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        switchView(link.dataset.navigate);
    });
});

// Mobile menu
document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    overlay.classList.toggle('active');
});

// Refresh
document.getElementById('refresh-btn').addEventListener('click', () => {
    loadData();
    showToast('Datos actualizados', 'info');
});

// Order detail (delegated click)
document.addEventListener('click', async (e) => {
    // View order detail
    if (e.target.classList.contains('action-btn') && e.target.dataset.orderId) {
        const orderId = e.target.dataset.orderId;
        const order = allOrders.find(o => o.id === orderId);
        if (order) openOrderDetail(order);
    }

    // Delete store
    if (e.target.dataset.deleteStore) {
        const storeId = e.target.dataset.deleteStore;
        const storeName = e.target.dataset.storeName;
        if (!confirm(`¿Eliminar la tienda "${storeName}"?`)) return;

        try {
            await apiFetch(`stores?id=${storeId}`, { method: 'DELETE' });
            showToast(`Tienda "${storeName}" eliminada`, 'info');
            await loadData();
        } catch (err) {
            showToast('Error al eliminar: ' + err.message, 'error');
        }
    }
});

// Close modals
document.getElementById('close-order-modal')?.addEventListener('click', () => {
    document.getElementById('order-modal').style.display = 'none';
    document.getElementById('od-audio')?.pause();
});

document.getElementById('close-store-modal')?.addEventListener('click', () => {
    document.getElementById('store-modal').style.display = 'none';
});

document.getElementById('order-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'order-modal') {
        document.getElementById('order-modal').style.display = 'none';
        document.getElementById('od-audio')?.pause();
    }
});

document.getElementById('store-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'store-modal') {
        document.getElementById('store-modal').style.display = 'none';
    }
});

// One-click Shopify connection
document.getElementById('one-click-btn')?.addEventListener('click', () => {
    let shop = document.getElementById('shopify-shop-url').value.trim();
    if (!shop) {
        showToast('Introduce tu dominio .myshopify.com', 'error');
        return;
    }

    // Clean the domain (remove https://, trailing slashes)
    shop = shop.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();

    // Simple validation
    if (!shop.includes('.myshopify.com')) {
        showToast('El dominio debe terminar en .myshopify.com', 'error');
        return;
    }

    const host = window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin;

    window.location.href = `${host}/api/shopify/auth?shop=${encodeURIComponent(shop)}`;
});

// Add store
document.getElementById('add-store-btn')?.addEventListener('click', () => {
    document.getElementById('store-modal').style.display = 'flex';
});

document.getElementById('add-store-btn-empty')?.addEventListener('click', () => {
    document.getElementById('store-modal').style.display = 'flex';
});

document.getElementById('add-store-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '⌛ Añadiendo...';

    try {
        await apiFetch('stores', {
            method: 'POST',
            body: JSON.stringify({
                name: document.getElementById('store-name').value.trim(),
                url: document.getElementById('store-url').value.trim(),
                access_token: document.getElementById('store-token').value.trim(),
                cod_gateway_name: document.getElementById('store-cod-id').value.trim() || 'Cash on Delivery'
            })
        });

        showToast('Tienda añadida correctamente', 'success');
        document.getElementById('store-modal').style.display = 'none';
        document.getElementById('add-store-form').reset();
        await loadData();

    } catch (err) {
        showToast('Error al añadir tienda: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = '🏪 Añadir Tienda';
});

// Settings
document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);

// Filters
document.getElementById('filter-status')?.addEventListener('change', applyOrderFilters);
document.getElementById('filter-store')?.addEventListener('change', applyOrderFilters);
document.getElementById('filter-date-from')?.addEventListener('change', applyOrderFilters);
document.getElementById('filter-date-to')?.addEventListener('change', applyOrderFilters);
document.getElementById('filter-search')?.addEventListener('input', applyOrderFilters);

// Order actions in modal
document.getElementById('od-confirm-btn')?.addEventListener('click', async () => {
    const orderId = document.getElementById('order-modal').dataset.orderId;
    if (!orderId) return;
    try {
        await updateOrder(orderId, { status: 'confirmado' });
        document.getElementById('order-modal').style.display = 'none';
        showToast('Pedido confirmado', 'success');
        await loadData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
});

document.getElementById('od-reject-btn')?.addEventListener('click', async () => {
    const orderId = document.getElementById('order-modal').dataset.orderId;
    if (!orderId) return;
    try {
        await updateOrder(orderId, { status: 'rechazado' });
        document.getElementById('order-modal').style.display = 'none';
        showToast('Pedido rechazado', 'info');
        await loadData();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
});

document.getElementById('od-retry-btn')?.addEventListener('click', async () => {
    showToast('Forzando reintento de llamada...', 'info');
    await triggerPendingCalls();
});

document.getElementById('save-order-notes-btn')?.addEventListener('click', async () => {
    const orderId = document.getElementById('order-modal').dataset.orderId;
    const notes = document.getElementById('od-notes').value;
    if (!orderId) return;
    try {
        await updateOrder(orderId, { notes });
        showToast('Notas guardadas', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
});

// Copy webhook
document.getElementById('copy-webhook')?.addEventListener('click', () => {
    const url = document.getElementById('webhook-url').textContent;
    navigator.clipboard.writeText(url).then(() => {
        showToast('URL copiada al portapapeles', 'success');
    });
});

// Keyboard
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('order-modal').style.display = 'none';
        document.getElementById('store-modal').style.display = 'none';
        document.getElementById('od-audio')?.pause();
    }
});

// Init
checkAuth();
