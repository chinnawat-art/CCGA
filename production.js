// production.js - หน้าฝ่ายผลิตทั้งหมด

// ─── CONFIG ───────────────────────────────
// ใช้ค่าจาก config.js (ถูก gitignored)
const TABLE = 'stock_orders';
const db = window.auth?.supabase
    || (window.supabase && window.SUPABASE_CONFIG
        ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
        : null);
if (!db) {
    console.error('Supabase client ไม่ถูกสร้าง. ตรวจสอบว่า auth.js และ config.js โหลดแล้วหรือไม่');
}

// ─── STATE ────────────────────────────────
let allOrders = [];
let activeTab = 'pending'; // 'pending' | 'producing' | 'done'
const pendingStatusUpdates = new Set();
const ordersWithUndispatchedMaterials = new Set(); // order IDs ที่ยังไม่จ่ายวัสดุ
const ordersWithPendingDamaged = new Set(); // order IDs ที่มีวัสดุชำรุดยังไม่ถูกยืนยันจ่าย
let dispatchPollInterval = null; // polling interval สำหรับ file:// protocol

// ─── PRODUCTION STATUSES ──────────────────
const STATUS_PENDING = 'รอดำเนินการ';
const STATUS_PRODUCING = 'กำลังผลิต';
const STATUS_DONE = 'ผลิตสำเร็จแล้ว';
const PROD_STATUSES = [STATUS_PENDING, STATUS_PRODUCING, STATUS_DONE];
const STATUS_VIEW_PERMISSIONS = {
    [STATUS_PENDING]: 'data_view_production_pending',
    [STATUS_PRODUCING]: 'data_view_production_producing',
    [STATUS_DONE]: 'data_view_production_done'
};
const PRODUCTION_SKUS = ['ANWD', 'CMD', 'CMWD', 'D', 'FDD', 'FDWD', 'FXWD', 'LVWD', 'SAWD', 'SLD', 'SLWD'];
const PRODUCTION_SKU_PERMISSION_PREFIX = 'data_view_production_sku_';

function canViewProductionSku(productCode) {
    if (window.auth?.role === 'Ceo') return true;

    const normalizedCode = String(productCode || '').toUpperCase().trim();
    const configuredSkus = PRODUCTION_SKUS.filter(sku =>
        window.auth?.hasPermission?.(`${PRODUCTION_SKU_PERMISSION_PREFIX}${sku}`)
    );

    // Keep legacy behavior until a CEO configures at least one SKU for the user.
    return !configuredSkus.length || configuredSkus.some(sku => normalizedCode.startsWith(sku));
}

function canViewProductionStatus(status) {
    if (window.auth?.role === 'Ceo') return true;
    const permissionKey = STATUS_VIEW_PERMISSIONS[status];
    return Boolean(permissionKey && window.auth?.hasPermission?.(permissionKey));
}

function getViewableProductionStatuses() {
    return PROD_STATUSES.filter(canViewProductionStatus);
}

function selectFirstAllowedTab() {
    const statusByTab = {
        pending: STATUS_PENDING,
        producing: STATUS_PRODUCING,
        done: STATUS_DONE
    };
    if (canViewProductionStatus(statusByTab[activeTab])) return;
    activeTab = ['pending', 'producing', 'done'].find(tab =>
        canViewProductionStatus(statusByTab[tab])
    ) || 'pending';
}

function log(msg, type = 'info') {
    const el = document.getElementById('logBar');
    const colorMap = { info: '#94a3b8', success: '#34d399', error: '#f87171', warn: '#fbbf24' };
    if (el) {
        el.innerHTML = `<span style="color:${colorMap[type] || colorMap.info}">[${new Date().toLocaleTimeString()}] ${msg}</span>`;
    }
    console.log(`[${type}] ${msg}`);
    if (['success', 'error', 'warn'].includes(type) || msg.includes('สำเร็จ') || msg.includes('ล้มเหลว')) {
        showToast(msg, type);
    }
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' }[type] || 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span style="font-size:0.88rem;">${msg}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function createToastContainer() {
    const div = document.createElement('div');
    div.id = 'toastContainer';
    div.className = 'toast-container';
    document.body.appendChild(div);
    return div;
}

// ─── PRODUCT IMAGE CACHE ────────────────────────────
let productImageCache = {}; // { sku -> image_url }

function openProductImageModal(imageUrl, productName) {
    let modal = document.getElementById('productImageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'productImageModal';
        modal.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;
            z-index:9999;cursor:pointer;
            animation:fadeIn 0.2s ease;
        `;
        modal.innerHTML = `
            <style>
                @keyframes fadeIn {
                    from { opacity:0; }
                    to { opacity:1; }
                }
                @keyframes scaleIn {
                    from { transform:scale(0.95);opacity:0; }
                    to { transform:scale(1);opacity:1; }
                }
                #productImageModal .image-container {
                    animation:scaleIn 0.3s ease;
                    position:relative;
                    max-width:90vw;
                    max-height:90vh;
                }
            </style>
            <div class="image-container" onclick="event.stopPropagation();">
                <button onclick="closeProductImageModal()" style="
                    position:absolute;top:-40px;right:0;
                    background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);
                    color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;
                    font-size:1.2rem;padding:0;transition:all 0.2s;
                " onmouseover="this.style.background='rgba(239,68,68,0.3)';this.style.borderColor='rgba(239,68,68,0.5)';"
                   onmouseout="this.style.background='rgba(255,255,255,0.1)';this.style.borderColor='rgba(255,255,255,0.3)';">✕</button>
                <img id="modalProductImage" src="" alt="" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                <div style="color:#94a3b8;font-size:0.9rem;margin-top:16px;text-align:center;">
                    <span id="modalProductName"></span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', closeProductImageModal);
    }
    
    document.getElementById('modalProductImage').src = imageUrl;
    document.getElementById('modalProductName').textContent = productName;
    modal.style.display = 'flex';
}

function closeProductImageModal() {
    const modal = document.getElementById('productImageModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('modalProductImage').src = '';
    }
}

async function loadProductImage(sku) {
    const normalizedSku = String(sku || '').trim();
    if (!normalizedSku) return null;
    
    if (productImageCache[normalizedSku] !== undefined) {
        return productImageCache[normalizedSku];
    }
    
    try {
        const { data, error } = await db
            .from('product_images')
            .select('image_url')
            .eq('sku', normalizedSku)
            .maybeSingle();

        if (error) {
            console.error(`Product image lookup error for SKU ${normalizedSku}:`, error);
            productImageCache[normalizedSku] = null;
            return null;
        }

        const imageUrl = data?.image_url || null;
        productImageCache[normalizedSku] = imageUrl;
        return imageUrl;
    } catch (err) {
        console.error(`Product image lookup exception for SKU ${normalizedSku}:`, err);
        return null;
    }
}

// ─── LOAD DATA ────────────────────────────
async function loadData() {
    log('กำลังโหลดข้อมูลจาก Supabase...');
    const selectColumns = 'id,order_date,platform,order_number,production_number,tracking_number,product_code,product_name,product_size,slots,quantity,buyer_name,tracking_status,note,pattern,production_started_at,production_completed_at,payment_time,ship_by_date,aluminum_color,glass_color,screen_type,stock_deducted';
    const fallbackColumns = 'id,order_date,platform,order_number,production_number,tracking_number,product_code,product_name,product_size,slots,quantity,buyer_name,tracking_status,note,pattern,production_started_at,production_completed_at,aluminum_color,glass_color,screen_type';
    const viewableStatuses = getViewableProductionStatuses();
    try {
        let response = await db
            .from(TABLE)
            .select(selectColumns)
            .in('tracking_status', viewableStatuses)
            .is('tracking_number', null)
            .order('order_date', { ascending: true });

        if (response.error) {
            const message = String(response.error.message || '');
            if (/stock_deducted/i.test(message)) {
                log('stock_deducted ยังไม่มีใน schema, โหลดข้อมูลโดยไม่ใส่คอลัมน์นี้', 'warn');
                response = await db
                    .from(TABLE)
                    .select(fallbackColumns)
                    .in('tracking_status', viewableStatuses)
                    .is('tracking_number', null)
                    .order('order_date', { ascending: true });
            }
        }

        if (response.error) throw response.error;
        allOrders = (response.data || []).filter(order => canViewProductionSku(order.product_code));

        log(`โหลดสำเร็จ ${allOrders.length} รายการ`, 'success');
        document.getElementById('lastUpdated').textContent =
            `อัปเดต: ${new Date().toLocaleString('th-TH')} | ${allOrders.length} รายการ`;
        await enrichOrdersWithDispatchStatus();
        await enrichOrdersWithDamageStatus();
        applyFilters();
    } catch (err) {
        log(`โหลดล้มเหลว: ${err.message}`, 'error');
        document.getElementById('ordersContainer').innerHTML = `
            <div class="empty-state" style="padding:1.5rem;">
                <p style="color:#f87171;">❌ โหลดรายการล้มเหลว: ${esc(err.message)}</p>
            </div>`;
        document.getElementById('summaryTableBody').innerHTML = `
            <tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--muted);">
                ❌ โหลดสรุปล้มเหลว
            </td></tr>`;
        document.getElementById('kpiPending').textContent = '-';
        document.getElementById('kpiProducing').textContent = '-';
        document.getElementById('kpiDone').textContent = '-';
        document.getElementById('kpiQty').textContent = '-';
    }
}

// ─── DISPATCH STATUS ENRICHMENT ──────────
async function enrichOrdersWithDispatchStatus() {
    ordersWithUndispatchedMaterials.clear();
    const producingOrders = allOrders.filter(o =>
        o.tracking_status === STATUS_PRODUCING && o.stock_deducted === true
    );
    if (!producingOrders.length) return;

    try {
        const { data: logs, error } = await db
            .from('stock_movement_log')
            .select('reason')
            .eq('dispatched', false)
            .like('reason', 'ตัดสต็อกอัตโนมัติ (เริ่มผลิต%');

        if (error) { console.error('enrichDispatch error:', error); return; }
        if (!logs || !logs.length) return;

        producingOrders.forEach(o => {
            const found = logs.some(log =>
                log.reason && log.reason.includes(`ID ออเดอร์: ${o.id}`)
            );
            if (found) ordersWithUndispatchedMaterials.add(o.id);
        });
    } catch (err) {
        console.error('enrichDispatch exception:', err);
    }
}

async function enrichOrdersWithDamageStatus() {
    ordersWithPendingDamaged.clear();
    try {
        const { data, error } = await db
            .from('damaged_materials')
            .select('order_id')
            .neq('status', 'delivered');
        if (error) { console.error('enrichDamage error:', error); return; }
        if (!data || !data.length) return;
        data.forEach(r => {
            if (r && r.order_id) ordersWithPendingDamaged.add(r.order_id);
        });
    } catch (err) {
        console.error('enrichDamage exception:', err);
    }
}

// ─── FILTERS ──────────────────────────────
function getTodayDateString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now - offset).toISOString().split('T')[0];
}

function getFiltered(statusList, { autoApplyLatestDoneDate = false } = {}) {
    const platform = document.getElementById('filterPlatform').value;
    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;
    const completedDateInput = document.getElementById('filterCompletedDate').value;
    let completedDate = completedDateInput;
    const isDoneOnly = statusList.length === 1 && statusList[0] === STATUS_DONE;

    if (isDoneOnly && autoApplyLatestDoneDate && !completedDateInput) {
        completedDate = getTodayDateString();
        const completedDateEl = document.getElementById('filterCompletedDate');
        if (completedDateEl) completedDateEl.value = completedDate;
    }

    const shouldApplyCompletedDate = isDoneOnly && Boolean(completedDate);
    const filtered = allOrders.filter(o => {
        if (!canViewProductionStatus(o.tracking_status)) return false;
        if (!statusList.includes(o.tracking_status)) return false;
        if (platform && o.platform !== platform) return false;
        if (dateFrom && o.order_date < dateFrom) return false;
        if (dateTo && o.order_date > dateTo) return false;

        if (shouldApplyCompletedDate) {
            if (!o.production_completed_at) return false;
            const d = new Date(o.production_completed_at);
            const offset = d.getTimezoneOffset() * 60000;
            const localDateStr = (new Date(d - offset)).toISOString().split('T')[0];
            if (localDateStr !== completedDate) return false;
        }

        return true;
    });

    const parseSeq = (order) => {
        const productionNumber = formatProductionNumberLabel(order);
        const match = /^(\d+)\/(\d{1,2})$/.exec(productionNumber);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    };

    return filtered.sort((a, b) => {
        const dateA = a.order_date ? new Date(a.order_date).getTime() : 0;
        const dateB = b.order_date ? new Date(b.order_date).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;

        const seqA = parseSeq(a);
        const seqB = parseSeq(b);
        if (seqA !== seqB) return seqA - seqB;

        const payA = a.payment_time ? new Date(a.payment_time).getTime() : 0;
        const payB = b.payment_time ? new Date(b.payment_time).getTime() : 0;
        return payA - payB;
    });
}

function applyFilters() {
    selectFirstAllowedTab();
    updateActiveTabUi();
    const pending = getFiltered([STATUS_PENDING]);
    const producing = getFiltered([STATUS_PRODUCING]);
    const done = getFiltered([STATUS_DONE], { autoApplyLatestDoneDate: true });

    // KPIs
    document.getElementById('kpiPending').textContent = pending.length;
    document.getElementById('kpiProducing').textContent = producing.length;
    document.getElementById('kpiDone').textContent = done.length;
    const totalQty = [...pending, ...producing].reduce((s, o) => s + (parseInt(o.quantity) || 1), 0);
    document.getElementById('kpiQty').textContent = totalQty.toLocaleString('th-TH');

    // Tab counts
    document.getElementById('tc-pending').textContent = pending.length;
    document.getElementById('tc-producing').textContent = producing.length;
    document.getElementById('tc-done').textContent = done.length;

    // Summary table (pending + producing)
    renderSummaryTable([...pending, ...producing]);

    renderCards();
}

function clearFilters() {
    ['filterPlatform', 'filterDateFrom', 'filterDateTo', 'filterCompletedDate'].forEach(id => {
        document.getElementById(id).value = '';
    });
    applyFilters();
}

// ─── TABS ─────────────────────────────────
const TAB_CFG = {
    pending: { label: '📦 รายการออเดอร์รอผลิต', cls: 'active-pending' },
    producing: { label: '🔨 รายการกำลังผลิต', cls: 'active-producing' },
    done: { label: '✅ รายการผลิตสำเร็จแล้ว', cls: 'active-done' }
};

function updateActiveTabUi() {
    ['pending', 'producing', 'done'].forEach(tab => {
        const button = document.getElementById('tab-' + tab);
        if (button) button.className = 'tab-btn' + (tab === activeTab ? ' ' + TAB_CFG[tab].cls : '');
    });
    const title = document.getElementById('panelTitle');
    if (title) title.textContent = TAB_CFG[activeTab].label;
}

function switchTab(tab) {
    const statusByTab = {
        pending: STATUS_PENDING,
        producing: STATUS_PRODUCING,
        done: STATUS_DONE
    };
    if (!canViewProductionStatus(statusByTab[tab])) return;
    activeTab = tab;
    updateActiveTabUi();
    renderCards();
}

// ─── SUMMARY TABLE ────────────────────────
function buildGroups(orders) {
    const groups = {};
    orders.forEach(o => {
        const key = [
            (o.product_code || '').toLowerCase(), 
            (o.product_name || '').toLowerCase(), 
            (o.product_size || ''), 
            (o.slots ?? ''), 
            (o.pattern || ''),
            (o.aluminum_color || ''),
            (o.glass_color || ''),
            (o.screen_type || '')
        ].join('|');
        if (!groups[key]) groups[key] = { 
            product_code: o.product_code || '', 
            product_name: o.product_name || '', 
            product_size: o.product_size || '', 
            slots: o.slots, 
            pattern: o.pattern || '',
            aluminum_color: o.aluminum_color || '',
            glass_color: o.glass_color || '',
            screen_type: o.screen_type || '',
            totalQty: 0, 
            orderCount: 0 
        };
        groups[key].totalQty += parseInt(o.quantity) || 1;
        groups[key].orderCount += 1;
    });
    return Object.values(groups).sort((a, b) => b.totalQty - a.totalQty);
}

function renderSummaryTable(orders) {
    const groups = buildGroups(orders);
    document.getElementById('summaryCount').textContent = `(${groups.length} รายการสินค้า)`;
    const tbody = document.getElementById('summaryTableBody');
    if (!groups.length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="emoji">✅</div><p>ไม่มีรายการ</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = groups.map((g, i) => `
        <tr>
            <td style="color:var(--muted);width:36px;">${i + 1}</td>
            <td>
                ${g.product_code ? `<div class="sku-text">${esc(g.product_code)}</div>` : ''}
                <div style="font-weight:500;margin-top:2px;">${esc(g.product_name)}</div>
            </td>
            <td>${g.product_size ? `<span style="background:rgba(168,85,247,0.15);color:#c084fc;padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(g.product_size)}</span>` : '-'}</td>
            <td>${g.pattern ? `<span style="background:rgba(16,185,129,0.12);color:#34d399;padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(g.pattern)}</span>` : '-'}</td>
            <td>${g.slots != null ? `<span style="color:#60a5fa;font-weight:600;">${g.slots} ช่อง</span>` : '-'}</td>
            <td><span style="color:#cbd5e1;">${esc(g.aluminum_color || '-')}</span></td>
            <td><span style="color:#cbd5e1;">${esc(g.glass_color || '-')}</span></td>
            <td><span style="color:#cbd5e1; font-size:0.85rem;">${esc(g.screen_type || '-')}</span></td>
            <td><span class="qty-badge">${g.totalQty}</span></td>
            <td><span style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.25);padding:3px 10px;border-radius:20px;font-size:0.8rem;">${g.orderCount} ออเดอร์</span></td>
        </tr>`).join('');
}

async function logStockMovement(itemId, itemName, oldQty, newQty, userName, reason) {
    try {
        const { error } = await db
            .from('stock_movement_log')
            .insert([{
                item_id:   itemId,
                item_name: itemName,
                old_qty:   oldQty,
                new_qty:   newQty,
                operator:  userName.trim(),
                reason:    reason ? reason.trim() : null
            }]);
        if (error) console.error('Error logging movement:', error);
    } catch (err) {
        console.error('Catch error logging movement:', err);
    }
}

async function deductSingleStockForOrder(order) {
    const normalizedProductCode = String(order.product_code || '').trim();
    const normalizedProductName = String(order.product_name || '').trim();
    const normalizedCodeKey = normalizedProductCode.replace(/\s+/g, '').toUpperCase();
    const normalizedNameKey = normalizedProductName.replace(/\s+/g, '').toUpperCase();

    if (!normalizedProductCode && !normalizedProductName) {
        log(`ออเดอร์ ${order?.order_number || order?.id} ไม่มี product_code หรือ product_name`, 'warn');
        return false;
    }

    try {
        let stockItem = null;
        let result;

        if (normalizedProductCode) {
            result = await db.from('stock_items').select('*').eq('product_code', normalizedProductCode).maybeSingle();
            if (!result.error && result.data) stockItem = result.data;
            
            if (!stockItem) {
                result = await db.from('stock_items').select('*').ilike('product_code', `%${normalizedProductCode}%`).limit(1);
                if (!result.error && result.data?.length > 0) stockItem = result.data[0];
            }
        }

        if (!stockItem && normalizedProductName) {
            result = await db.from('stock_items').select('*').eq('product_name', normalizedProductName).maybeSingle();
            if (!result.error && result.data) stockItem = result.data;

            if (!stockItem) {
                result = await db.from('stock_items').select('*').ilike('product_name', `%${normalizedProductName}%`).limit(1);
                if (!result.error && result.data?.length > 0) stockItem = result.data[0];
            }
        }

        if (!stockItem) {
            result = await db.from('stock_items').select('*');
            if (!result.error && result.data) {
                stockItem = result.data.find(item => {
                    const code = String(item.product_code || '').replace(/\s+/g, '').toUpperCase();
                    const name = String(item.product_name || '').replace(/\s+/g, '').toUpperCase();
                    return (normalizedCodeKey && (code === normalizedCodeKey || code.includes(normalizedCodeKey) || normalizedCodeKey.includes(code)))
                        || (normalizedNameKey && (name === normalizedNameKey || name.includes(normalizedNameKey) || normalizedNameKey.includes(name)));
                });
            }
        }

        if (!stockItem) {
            throw new Error(`วัสดุในการผลิตไม่เพียงพอ ${normalizedProductCode || normalizedProductName}`);
        }

        const currentQty = parseInt(stockItem.quantity) || 0;
        const orderQty = parseInt(order.quantity) || 1;
        const updatedQty = currentQty - orderQty;

        if (updatedQty < 0) throw new Error(`สินค้า '${stockItem.product_name}' สต็อกไม่พอ (มี ${currentQty}, ใช้ ${orderQty})`);

        const { error: updateError } = await db.from('stock_items').update({ quantity: updatedQty }).eq('id', stockItem.id);
        if (updateError) throw updateError;

        const reasonStr = `ตัดสต็อกอัตโนมัติ (เริ่มผลิต, ไม่มี BOM) | source: production-start-1to1 | order_id: ${order.id} | order_number: ${order.order_number || '-'} | sku: ${order.product_code || '-'} | item: ${stockItem.product_name || stockItem.product_code}`;
        await logStockMovement(stockItem.id, stockItem.product_name, currentQty, updatedQty, 'ระบบ', reasonStr);

        log(`ตัดสต็อก ${stockItem.product_name || stockItem.product_code} ${orderQty} ชิ้น (คงเหลือ ${updatedQty})`, 'success');
        return true;
    } catch (err) {
        log(`ตัดสต็อกล้มเหลว: ${err.message}`, 'error');
        throw err;
    }
}

async function returnSingleStockForOrder(order) {
    const normalizedProductCode = String(order.product_code || '').trim();
    const normalizedProductName = String(order.product_name || '').trim();
    const normalizedCodeKey = normalizedProductCode.replace(/\s+/g, '').toUpperCase();
    const normalizedNameKey = normalizedProductName.replace(/\s+/g, '').toUpperCase();

    try {
        let stockItem = null;
        let result;

        if (normalizedProductCode) {
            result = await db.from('stock_items').select('*').eq('product_code', normalizedProductCode).maybeSingle();
            if (!result.error && result.data) stockItem = result.data;
        }
        if (!stockItem && normalizedProductName) {
            result = await db.from('stock_items').select('*').eq('product_name', normalizedProductName).maybeSingle();
            if (!result.error && result.data) stockItem = result.data;
        }
        if (!stockItem) {
            result = await db.from('stock_items').select('*');
            if (!result.error && result.data) {
                stockItem = result.data.find(item => {
                    const code = String(item.product_code || '').replace(/\s+/g, '').toUpperCase();
                    const name = String(item.product_name || '').replace(/\s+/g, '').toUpperCase();
                    return (normalizedCodeKey && code === normalizedCodeKey) || (normalizedNameKey && name === normalizedNameKey);
                });
            }
        }

        if (!stockItem) {
            log(`คืนสต็อกล้มเหลว: ไม่พบสินค้า ${normalizedProductCode || normalizedProductName}`, 'warn');
            return false;
        }

        const currentQty = parseInt(stockItem.quantity) || 0;
        const orderQty = parseInt(order.quantity) || 1;
        const updatedQty = currentQty + orderQty;

        const { error: updateError } = await db.from('stock_items').update({ quantity: updatedQty }).eq('id', stockItem.id);
        if (updateError) throw updateError;

        const reasonStr = `คืนสต็อกอัตโนมัติ (ย้อนกลับ, ไม่มี BOM) | source: production-return-1to1 | order_id: ${order.id} | order_number: ${order.order_number || '-'} | sku: ${order.product_code || '-'} | item: ${stockItem.product_name || stockItem.product_code}`;
        await logStockMovement(stockItem.id, stockItem.product_name, currentQty, updatedQty, 'ระบบ', reasonStr);

        log(`คืนสต็อก ${stockItem.product_name || stockItem.product_code} ${orderQty} ชิ้น (คงเหลือ ${updatedQty})`, 'success');
        return true;
    } catch (err) {
        log(`คืนสต็อกล้มเหลว: ${err.message}`, 'error');
        throw err;
    }
}

// ─── BOM / RPC Helpers ─────────────────────
async function fetchComponentsForOrder(order) {
    try {
        const { data: oc, error: ocErr } = await db.from('order_components')
            .select('component_product_code, component_qty')
            .eq('order_id', order.id);
        if (!ocErr && oc && oc.length) return oc.map(r => ({ component_product_code: r.component_product_code, component_qty: parseInt(r.component_qty) || 1 }));

        const { data: bom, error: bomErr } = await db.from('stock_bom')
            .select('component_product_code, component_qty')
            .eq('product_code', order.product_code);
        if (bomErr) throw bomErr;
        return (bom || []).map(r => ({ component_product_code: r.component_product_code, component_qty: parseInt(r.component_qty) || 1 }));
    } catch (err) {
        console.error('fetchComponentsForOrder error', err);
        return [];
    }
}

async function fetchStockLevels(codes) {
    if (!codes || !codes.length) return [];
    try {
        const { data, error } = await db.from('stock_items').select('id, product_code, product_name, quantity').in('product_code', codes);
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('fetchStockLevels error', err);
        return [];
    }
}

async function fetchBackupStockOption(order) {
    const productCode = String(order?.product_code || '').trim();
    const requiredQty = Math.max(1, parseInt(order?.quantity) || 1);
    if (!productCode) return null;

    try {
        const { data, error } = await db.rpc('rpc_get_backup_stock_for_production_order', {
            p_order_id: order.id
        });
        if (error) throw error;
        const availableQty = Math.max(0, parseInt(data?.available_quantity) || 0);
        return {
            requiredQty,
            availableQty,
            canUse: data?.can_use === true && availableQty >= requiredQty,
            lots: Array.isArray(data?.lots) ? data.lots : []
        };
    } catch (error) {
        console.warn('ตรวจสอบสต็อกสำรองไม่สำเร็จ:', error);
        return null;
    }
}

async function rpcUseBackupStockForOrder(order, allocations) {
    const { data: sessionData } = await db.auth.getSession();
    const user = sessionData?.session?.user;
    const { data, error } = await db.rpc('rpc_use_backup_stock_lots_for_order', {
        p_order_id: order.id,
        p_allocations: allocations,
        p_operator: user?.email || 'ฝ่ายผลิต',
        p_user_id: user?.id || null
    });
    if (error) throw error;
    if (data?.status && data.status !== 'ok') throw new Error(data.message || 'ใช้สต็อกสำรองไม่สำเร็จ');
    return data;
}

async function hasBackupAllocationForOrder(orderId) {
    const { data, error } = await db.rpc('rpc_has_backup_stock_allocation', {
        p_order_id: orderId
    });
    if (error) throw error;
    return data === true;
}

async function rpcReturnBackupStockForOrder(order) {
    const { data: sessionData } = await db.auth.getSession();
    const user = sessionData?.session?.user;
    const { data, error } = await db.rpc('rpc_return_backup_stock_for_production_order', {
        p_order_id: order.id,
        p_operator: user?.email || 'ฝ่ายผลิต',
        p_user_id: user?.id || null
    });
    if (error) throw error;
    if (data?.status && data.status !== 'ok') throw new Error(data.message || 'คืนสต็อกสำรองไม่สำเร็จ');
    return data;
}

function openComponentsModal(order, comps, backupOption = null) {
    return new Promise((resolve) => {
        const modal = document.getElementById('componentsModal');
        const list = document.getElementById('componentsList');
        const lotPicker = document.getElementById('componentsBackupLotPicker');
        const confirmBtn = document.getElementById('componentsConfirmBtn');
        const backupBtn = document.getElementById('componentsUseBackupBtn');
        
        const cancelBtn = modal.querySelector('.cancel-modal');
        const closeBtn = modal.querySelector('.close-modal');

        list.innerHTML = '';
        if (lotPicker) lotPicker.innerHTML = '';

        const normalizedComps = comps.map((component, index) => ({
            ...component,
            row_key: `${String(component.component_product_code || 'component').trim()}__${index}`
        }));
        const hasInsufficientStock = normalizedComps.some(c => (parseInt(c.have) || 0) < (parseInt(c.need) || 0));
        const canUseBackup = backupOption?.canUse === true;
        const backupLots = Array.isArray(backupOption?.lots) ? backupOption.lots : [];
        const warningHtml = hasInsufficientStock
            ? canUseBackup
                ? `<div style="margin-bottom:12px;padding:12px;border-radius:10px;background:rgba(2,132,199,0.1);color:#0369a1;border:1px solid rgba(2,132,199,0.25);font-size:0.9rem;">
                    📦 วัสดุไม่เพียงพอ แต่มีสินค้าสำเร็จรูปในสต็อกสำรอง ${backupOption.availableQty} ชิ้น สามารถเลือกใช้สต็อกสำรองได้</div>`
                : `<div style="margin-bottom:12px;padding:12px;border-radius:10px;background:rgba(239,68,68,0.12);color:#b91c1c;border:1px solid rgba(239,68,68,0.2);font-size:0.9rem;">
                    ❌ พบรายการที่มีสต็อกไม่เพียงพอ ระบบไม่อนุญาตให้ยืนยันและตัดสต็อกได้ กรุณาเพิ่มสต็อกก่อน</div>`
            : '';

        const headerInfo = `<div style="padding:10px; border-radius:8px; background:rgba(255,255,255,0.03); margin-bottom:15px; border:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:0.75rem; color:var(--muted); margin-bottom:4px;">📦 ออเดอร์ #${esc(order.order_number || order.id)}</div>
                    <div style="font-weight:500; font-size:0.9rem;">${esc(order.product_name)}</div>
                    ${order.product_code ? `<div style="font-size:0.75rem; color:var(--primary); margin-top:2px;">SKU: ${esc(order.product_code)}</div>` : ''}
                </div>`;
        list.innerHTML = headerInfo + warningHtml;

        list.innerHTML += `
            <div class="components-selection-toolbar">
                <label class="components-master-toggle">
                    <input type="checkbox" id="componentsSelectAll" checked>
                    <span>เลือกทั้งหมด</span>
                </label>
                <div class="components-selection-summary" id="componentsSelectionSummary">เลือก 0 รายการ</div>
            </div>
        `;

        normalizedComps.forEach(c => {
            const nameHtml = c.component_product_name 
                ? `<div style="font-size:0.75rem; color:#94a3b8; font-weight:normal; margin-top:2px;">${esc(c.component_product_name)}</div>`
                : '';
            const isInsufficient = (parseInt(c.have) || 0) < (parseInt(c.need) || 0);
            const short = `<label class="component-select-row ${isInsufficient ? 'is-insufficient' : ''}">
                        <div class="component-select-box">
                            <input type="checkbox" class="component-checkbox" data-row-key="${esc(c.row_key)}" checked>
                        </div>
                        <div style="flex:1; min-width:0; text-align:left;">
                            <div style="font-weight:600; font-size:0.88rem; color:#f1f5f9; word-break:break-all;">${esc(c.component_product_code)}</div>
                            ${nameHtml}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;font-size:0.82rem;white-space:nowrap;">
                            <span style="color:var(--muted);">ต้องการ <strong style="color:#fff;">${c.need}</strong></span>
                            <span style="color:rgba(255,255,255,0.15)">|</span>
                            <span style="background:${isInsufficient ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)'}; 
                                         color:${isInsufficient ? '#f87171' : '#34d399'}; 
                                         border:1px solid ${isInsufficient ? 'rgba(239,68,68,0.22)' : 'rgba(16,185,129,0.22)'}; 
                                         padding:2px 8px; border-radius:6px; font-weight:500; font-size:0.78rem;">
                                มี ${c.have}
                            </span>
                        </div>
                    </label>`;
            list.innerHTML += short;
        });

        if (canUseBackup && lotPicker) {
            const lotRows = backupLots.map(lot => {
                const receivedAt = lot.created_at
                    ? new Date(lot.created_at).toLocaleString('th-TH', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit'
                    })
                    : '-';
                const remainingQty = Math.max(0, parseInt(lot.remaining_qty) || 0);
                return `<div class="production-backup-lot-row">
                    <div class="production-backup-lot-info">
                        <strong>${esc(lot.note || 'ไม่ระบุหมายเหตุ')}</strong>
                        <span>${esc(receivedAt)} · ${esc(lot.operator || '-')}</span>
                    </div>
                    <div class="production-backup-lot-balance">คงเหลือ ${remainingQty}</div>
                    <input class="production-backup-lot-qty" type="number" min="0" max="${remainingQty}"
                        value="0" inputmode="numeric" data-lot-id="${esc(lot.id)}"
                        aria-label="จำนวนที่เลือกจากหมายเหตุ ${esc(lot.note || 'ไม่ระบุหมายเหตุ')}">
                </div>`;
            }).join('');

            lotPicker.innerHTML = `<section class="production-backup-lot-picker">
                <div class="production-backup-lot-heading">
                    <div>
                        <strong>เลือกหมายเหตุสต็อกสำรอง</strong>
                        <span>ระบุจำนวนจากล็อตที่ต้องการใช้</span>
                    </div>
                    <div class="production-backup-lot-total">
                        เลือกแล้ว <strong id="productionBackupSelectedQty">0</strong> / ${backupOption.requiredQty} ชิ้น
                    </div>
                </div>
                <div class="production-backup-lot-list">
                    ${lotRows || '<div class="production-backup-lot-empty">ไม่พบข้อมูลล็อต กรุณาตรวจสอบข้อมูลสต็อกสำรอง</div>'}
                </div>
            </section>`;
        }

        modal.style.display = 'flex';
        if (backupBtn) {
            backupBtn.style.display = canUseBackup ? '' : 'none';
            backupBtn.disabled = true;
            backupBtn.textContent = canUseBackup
                ? `📦 เลือกล็อตให้ครบ ${backupOption.requiredQty} ชิ้น`
                : '📦 ใช้สต็อกสำรอง';
        }

        const componentCheckboxes = [...list.querySelectorAll('.component-checkbox')];
        const selectAllCheckbox = list.querySelector('#componentsSelectAll');
        const selectionSummary = list.querySelector('#componentsSelectionSummary');
        const getSelectedComponents = () => normalizedComps.filter(component =>
            componentCheckboxes.some(input => input.dataset.rowKey === component.row_key && input.checked)
        );
        const updateComponentSelectionState = () => {
            const selectedComponents = getSelectedComponents();
            const selectedCount = selectedComponents.length;
            const selectedNeedTotal = selectedComponents.reduce((sum, item) => sum + (parseInt(item.need) || 0), 0);
            const selectedInsufficient = selectedComponents.some(c => (parseInt(c.have) || 0) < (parseInt(c.need) || 0));

            componentCheckboxes.forEach(input => {
                input.closest('.component-select-row')?.classList.toggle('is-excluded', !input.checked);
            });

            if (selectionSummary) {
                selectionSummary.textContent = selectedCount > 0
                    ? `เลือก ${selectedCount} รายการ · รวมใช้ ${selectedNeedTotal} ชิ้น`
                    : 'ไม่ได้เลือกวัสดุ';
            }

            if (selectAllCheckbox) {
                const checkedCount = componentCheckboxes.filter(input => input.checked).length;
                selectAllCheckbox.checked = checkedCount === componentCheckboxes.length;
                selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < componentCheckboxes.length;
            }

            confirmBtn.disabled = selectedInsufficient;
            confirmBtn.style.cursor = selectedInsufficient ? 'not-allowed' : '';
            confirmBtn.title = selectedInsufficient ? 'ไม่สามารถยืนยันได้เมื่อรายการที่เลือกมีสต็อกไม่เพียงพอ' : '';
            confirmBtn.textContent = selectedCount > 0
                ? `ยืนยันและตัด ${selectedCount} รายการ`
                : 'ยืนยันโดยไม่ตัดวัสดุ';
        };
        componentCheckboxes.forEach(input => input.addEventListener('change', updateComponentSelectionState));
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', () => {
                componentCheckboxes.forEach(input => {
                    input.checked = selectAllCheckbox.checked;
                });
                updateComponentSelectionState();
            });
        }

        const lotInputs = lotPicker
            ? [...lotPicker.querySelectorAll('.production-backup-lot-qty')]
            : [];
        const getSelectedAllocations = () => lotInputs
            .map(input => ({
                lot_id: input.dataset.lotId,
                qty: Math.max(0, parseInt(input.value) || 0)
            }))
            .filter(item => item.qty > 0);
        const updateSelectedLots = () => {
            lotInputs.forEach(input => {
                const max = Math.max(0, parseInt(input.max) || 0);
                const value = Math.max(0, Math.min(parseInt(input.value) || 0, max));
                if (String(value) !== input.value) input.value = value;
            });
            const total = getSelectedAllocations().reduce((sum, item) => sum + item.qty, 0);
            const totalEl = lotPicker?.querySelector('#productionBackupSelectedQty');
            if (totalEl) {
                totalEl.textContent = total;
                totalEl.classList.toggle('is-complete', total === backupOption?.requiredQty);
            }
            if (backupBtn && canUseBackup) {
                backupBtn.disabled = total !== backupOption.requiredQty;
                backupBtn.textContent = total === backupOption.requiredQty
                    ? `📦 ยืนยันใช้ล็อตที่เลือก ${total} ชิ้น`
                    : `📦 เลือกล็อตให้ครบ ${backupOption.requiredQty} ชิ้น (${total}/${backupOption.requiredQty})`;
            }
        };
        lotInputs.forEach(input => input.addEventListener('input', updateSelectedLots));
        updateSelectedLots();
        updateComponentSelectionState();

        const onDone = (result) => {
            modal.style.display = 'none';
            if (lotPicker) lotPicker.innerHTML = '';
            confirmBtn.onclick = null;
            if (backupBtn) backupBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        confirmBtn.onclick = () => onDone({
            mode: 'components',
            selectedComponents: getSelectedComponents()
        });
        if (backupBtn) backupBtn.onclick = () => {
            const allocations = getSelectedAllocations();
            const total = allocations.reduce((sum, item) => sum + item.qty, 0);
            if (total !== backupOption.requiredQty) {
                alert(`กรุณาเลือกจำนวนจากหมายเหตุรวมให้ครบ ${backupOption.requiredQty} ชิ้น`);
                return;
            }
            const confirmed = window.confirm(
                `ยืนยันใช้สต็อกสำรอง ${backupOption.requiredQty} ชิ้นสำหรับออเดอร์ ${order.order_number || order.id}?\nออเดอร์จะเปลี่ยนเป็นผลิตสำเร็จแล้วทันที`
            );
            if (confirmed) onDone({ mode: 'backup', allocations });
        };
        if (cancelBtn) cancelBtn.onclick = () => onDone(false);
        if (closeBtn) closeBtn.onclick = () => onDone(false);
        modal.onclick = (e) => { if (e.target === modal) onDone(false); };
    });
}

function closeComponentsModal() {
    const modal = document.getElementById('componentsModal');
    if (modal) modal.style.display = 'none';
}

async function rpcDeductComponentsForOrder(order) {
    try {
        const { data, error } = await db.rpc('rpc_deduct_components_for_order', { p_order_id: order.id });
        if (error) throw error;
        if (data && data.status === 'ok') return true;
        if (data && data.status === 'error') throw new Error(data.message || 'RPC reported error');
        return true;
    } catch (err) {
        throw err;
    }
}

async function rpcDeductSelectedComponentsForOrder(order, selectedComponents = []) {
    try {
        const selectedCodes = [...new Set(
            (selectedComponents || [])
                .map(item => String(item?.component_product_code || '').trim())
                .filter(Boolean)
        )];
        const { data, error } = await db.rpc('rpc_deduct_selected_components_for_order', {
            p_order_id: order.id,
            p_selected_component_codes: selectedCodes
        });
        if (error) throw error;
        if (data && data.status === 'ok') return data;
        if (data && data.status === 'error') throw new Error(data.message || 'RPC reported error');
        return data || { stock_deducted: selectedCodes.length > 0 };
    } catch (err) {
        throw err;
    }
}

async function rpcReturnComponentsForOrder(order) {
    try {
        const { data, error } = await db.rpc('rpc_return_components_for_order', { p_order_id: order.id });
        if (error) throw error;
        if (data && data.status === 'ok') return true;
        if (data && data.status === 'error') throw new Error(data.message || 'RPC reported error');
        return true;
    } catch (err) {
        throw err;
    }
}

async function performDeduction(order) {
    try {
        let comps = await fetchComponentsForOrder(order);
        const orderQty = parseInt(order.quantity) || 1;
        let isBOM = true;

        if (!comps || comps.length === 0) {
            isBOM = false;
            comps = [{
                component_product_code: order.product_code || order.product_name || 'ไม่ระบุ',
                component_qty: 1
            }];
            log(`ไม่มี BOM สำหรับ ${order.product_name} — จะตัดสต็อกแบบ 1:1`, 'info');
        }

        const codes = comps.map(c => c.component_product_code);
        const stockItems = await fetchStockLevels(codes);
        const stockMap = {};
        stockItems.forEach(item => {
            stockMap[item.product_code] = item.quantity;
        });
                
        const compsWithNeed = comps.map(c => {
            const need = (parseInt(c.component_qty) || 1) * orderQty;
            const have = stockMap[c.component_product_code] ?? 0;
            const stockItem = stockItems.find(item => 
                String(item.product_code).trim() === String(c.component_product_code).trim() ||
                String(item.product_name).trim() === String(c.component_product_code).trim()
            );
            const component_product_name = stockItem ? stockItem.product_name : '';
            return { component_product_code: c.component_product_code, component_product_name, need, have };
        });

        const backupOption = await fetchBackupStockOption(order);
        const deductionMode = await openComponentsModal(order, compsWithNeed, backupOption);
        if (!deductionMode) return false;

        if (deductionMode?.mode === 'backup') {
            await rpcUseBackupStockForOrder(order, deductionMode.allocations);
            log(`📦 ใช้สต็อกสำรองสำหรับออเดอร์ ${order.order_number || order.id} สำเร็จ`, 'success');
            return { mode: 'backup', stockDeducted: true };
        }

        const selectedComponents = Array.isArray(deductionMode?.selectedComponents)
            ? deductionMode.selectedComponents
            : compsWithNeed;

        if (selectedComponents.length === 0) {
            log(`ℹ️ ผู้ใช้เลือกไม่ตัดวัสดุสำหรับออเดอร์ ${order.order_number || order.id}`, 'info');
            return { mode: 'components', stockDeducted: false };
        }

        let deductionResult;
        if (isBOM) {
            if (selectedComponents.length === compsWithNeed.length) {
                await rpcDeductComponentsForOrder(order);
                deductionResult = { stock_deducted: true };
            } else {
                deductionResult = await rpcDeductSelectedComponentsForOrder(order, selectedComponents);
            }
        } else {
            await deductSingleStockForOrder(order);
            deductionResult = { stock_deducted: true };
        }
                
        log(`ตัดสต็อกสำเร็จสำหรับออเดอร์ ${order.order_number || order.id}`, 'success');
        return {
            mode: 'components',
            stockDeducted: deductionResult?.stock_deducted === true
        };
    } catch (err) {
        log(`การตัดสต็อกล้มเหลว: ${err.message}`, 'error');
        throw err;
    }
}

async function performReturn(order) {
    try {
        log(`กำลังดำเนินการคืนสต็อกสำหรับ [${order.order_number || order.id}]...`);
                
        const comps = await fetchComponentsForOrder(order);
        if (!comps || comps.length === 0) {
            log(`ไม่มี BOM สำหรับ ${order.product_code || order.product_name} — ใช้การคืนสต็อกแบบ 1:1`, 'warn');
            return await returnSingleStockForOrder(order);
        }

        await rpcReturnComponentsForOrder(order);
        log(`คืนสต็อกสำเร็จ (RPC) สำหรับออเดอร์ ${order.order_number || order.id}`, 'success');
        return true;
    } catch (err) {
        log(`Return stock failed: ${err.message}`, 'error');
        throw err;
    }
}

// ─── ORDER CARD RENDER ──────────────────────────
function isValidProductionNumberString(value) {
    return /^\s*\d+\/\d{1,2}\s*$/.test(String(value));
}

function normalizeProductionNumberString(value) {
    const raw = String(value || '').trim();
    const match = /^(\d+)\/(\d{1,2})$/.exec(raw);
    if (!match) return null;
    const sequence = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    if (!Number.isInteger(sequence) || sequence < 1 || day < 1 || day > 31) return null;
    return `${sequence}/${day}`;
}

function formatProductionNumberLabel(order) {
    if (order?.production_number) {
        const normalized = normalizeProductionNumberString(order.production_number);
        if (normalized) return normalized;
    }
    return 'ยังไม่กำหนด';
}

function renderOrderCard(o) {
    const status = o.tracking_status;
    const canCancel = window.auth?.hasPermission?.('action_cancel_order') === true;
    const canDelete = window.auth?.hasPermission?.('action_delete_order') === true;
    const canEditProductionNumber = window.auth?.hasPermission?.('action_edit_production_number') === true;
    const canRevert = window.auth?.role === 'Ceo' || window.auth?.hasPermission?.('action_revert_production_order') === true;
    const platCls = { Shopee: 'p-shopee', Lazada: 'p-lazada', TikTok: 'p-tiktok' }[o.platform] || 'p-other';
    const cardCls = status === STATUS_DONE ? 'is-done' : (status === STATUS_PRODUCING ? 'is-producing' : 'is-pending');

    let badgeHtml = '';
    let actionsHtml = '';

    if (status === STATUS_PENDING) {
        badgeHtml = `<span class="badge badge-pending">⏳ รอผลิต</span>`;
        const canFinishPending = window.auth?.role === 'Ceo' || window.auth?.hasPermission?.('action_complete_pending_production') === true;
        actionsHtml = `
            ${canCancel ? `<button class="btn btn-outline btn-sm" style="color:#f87171;border-color:rgba(239,68,68,0.35);" onclick="cancelProductionOrder('${o.id}',this)">❌ ยกเลิก</button>` : ''}
            <button class="btn btn-produce btn-sm" onclick="updateStatus('${o.id}','${STATUS_PRODUCING}',this)">🔨 เริ่มผลิต</button>
            ${canFinishPending ? `<button class="btn btn-done btn-sm" onclick="updateStatus('${o.id}','${STATUS_DONE}',this)">✅ ผลิตสำเร็จ</button>` : ''}`;
    } else if (status === STATUS_PRODUCING) {
        badgeHtml = `<span class="badge badge-producing">🔨 กำลังผลิต</span>`;
        const canFinish = ['Ceo', 'pdtPerson'].includes(window.auth.role);
        actionsHtml = `
            ${canRevert ? `<button class="btn btn-outline btn-sm" onclick="updateStatus('${o.id}','${STATUS_PENDING}',this)">↩ ย้อนกลับ</button>` : ''}
            <button class="btn btn-sm" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;" onclick="openDamageModal('${o.id}')">⚠️ วัสดุเสีย</button>
            ${canFinish ? (() => {
                const hasUndispatched = ordersWithUndispatchedMaterials.has(o.id) || ordersWithPendingDamaged.has(o.id);
                const btnStyle = hasUndispatched
                    ? `background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);color:#fbbf24;`
                    : ``;
                const btnTitle = hasUndispatched ? `title="⚠️ วัสดุยังไม่เรียบร้อย — กรุณาตรวจสอบในหน้ารายงานวัสดุเสียหาย / คลังวัสดุ"` : ``;
                const btnLabel = hasUndispatched ? `⚠️ วัสดุยังไม่เรียบร้อย` : `✅ ผลิตสำเร็จ`;
                return `<button class="btn btn-done btn-sm" style="${btnStyle}" ${btnTitle} onclick="updateStatus('${o.id}','${STATUS_DONE}',this)">${btnLabel}</button>`;
            })() : ''}`;  
    } else {
        badgeHtml = `<span class="badge badge-proddone">✅ ผลิตสำเร็จแล้ว</span>`;
        const targetRevertStatus = (o.stock_deducted === true) ? STATUS_PRODUCING : STATUS_PENDING;
        actionsHtml = `
            ${canRevert ? `<button class="btn btn-outline btn-sm" onclick="updateStatus('${o.id}','${targetRevertStatus}',this)">↩ ย้อนกลับ</button>` : ''}`;
    }

    actionsHtml += `
        ${canDelete ? `<button class="btn btn-outline btn-sm" style="color:#f87171;border-color:rgba(239,68,68,0.45);" title="ลบออเดอร์ออกจาก Supabase" onclick="deleteProductionOrder('${o.id}',this)">🗑️ ลบ</button>` : ''}
        <button class="btn btn-outline btn-sm" title="ดูประวัติ" onclick="viewHistory('${o.id}')">📜</button>`;

    const timeDetails = [];
    if (o.production_started_at) {
        const d = new Date(o.production_started_at);
        timeDetails.push(`<div style="font-size:0.75rem;color:#fb923c;margin-top:4px;">▶ เริ่ม: ${d.toLocaleDateString('th-TH')} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>`);
    }
    if (o.production_completed_at) {
        const d = new Date(o.production_completed_at);
        timeDetails.push(`<div style="font-size:0.75rem;color:#34d399;margin-top:2px;">✅ เสร็จ: ${d.toLocaleDateString('th-TH')} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>`);
    }
    if (o.payment_time) {
        try {
            const pd = new Date(o.payment_time);
            timeDetails.push(`<div style="font-size:1.35rem;color:#60a5fa;margin-top:2px;font-weight:700;letter-spacing:0.5px;">💳 ชำระ: ${pd.toLocaleDateString('th-TH')} ${pd.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>`);
        } catch (e) {}
    }

    const details = [
        o.product_size ? `<span class="detail-pill size">📐 ${esc(o.product_size)}</span>` : '',
        o.slots != null ? `<span class="detail-pill slots">🔲 ${o.slots} ช่อง</span>` : '',
        o.pattern ? `<span class="detail-pill pattern">🎨 ${esc(o.pattern)}</span>` : '',
        o.aluminum_color ? `<span class="detail-pill" style="background:rgba(255,255,255,0.05); color:#94a3b8; border:1px solid rgba(255,255,255,0.1);">🏗️ ${esc(o.aluminum_color)}</span>` : '',
        o.glass_color ? `<span class="detail-pill" style="background:rgba(59,130,246,0.1); color:#60a5fa; border:1px solid rgba(59,130,246,0.2);">💎 ${esc(o.glass_color)}</span>` : '',
        o.screen_type ? `<span class="detail-pill" style="background:rgba(16,185,129,0.1); color:#34d399; border:1px solid rgba(16,185,129,0.2);">🦟 ${esc(o.screen_type)}</span>` : '',
        `<span class="detail-pill qty">x${parseInt(o.quantity) || 1} ชิ้น</span>`
    ].filter(Boolean).join('');

    const productionNumberLabel = formatProductionNumberLabel(o);
    
    loadProductImage(o.product_code).then(imageUrl => {
        setTimeout(() => {
            if (imageUrl) {
                const imageContainer = document.getElementById(`imageContainer_${o.id}`);
                if (imageContainer) {
                    imageContainer.innerHTML = `
                    <div style="position:relative;width:100%;height:100%;overflow:hidden;border-radius:14px;background:linear-gradient(135deg,rgba(129,140,248,0.1),rgba(59,130,246,0.05));border:2px solid rgba(129,140,248,0.35);transition:all 0.35s cubic-bezier(0.4,0,0.2,1);cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.1);" 
                         onmouseover="this.style.boxShadow='0 12px 32px rgba(129,140,248,0.25),inset 0 1px 0 rgba(255,255,255,0.15)';this.style.borderColor='rgba(129,140,248,0.6)';"
                         onmouseout="this.style.boxShadow='0 8px 24px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.1)';this.style.borderColor='rgba(129,140,248,0.35)';"
                         onclick="openProductImageModal('${imageUrl}','${esc(o.product_code || o.product_name)}')">
                        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(129,140,248,0),rgba(0,0,0,0));opacity:0;transition:opacity 0.3s ease;pointer-events:none;" class="img-overlay"></div>
                        <img src="${imageUrl}" alt="${esc(o.product_code || o.product_name)}" 
                             style="width:100%;height:100%;object-fit:cover;display:block;transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);"
                             onmouseover="this.parentElement.querySelector('.img-overlay').style.opacity='0.15';this.style.transform='scale(1.1) translateZ(0)';"
                             onmouseout="this.parentElement.querySelector('.img-overlay').style.opacity='0';this.style.transform='scale(1) translateZ(0)';"
                             onerror="this.parentElement.style.display='none';">
                        <div style="position:absolute;top:10px;right:10px;background:linear-gradient(135deg,rgba(129,140,248,0.9),rgba(99,102,241,0.8));color:#fff;padding:5px 10px;border-radius:8px;font-size:0.75rem;opacity:0;transition:opacity 0.3s ease,transform 0.3s ease;pointer-events:none;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(129,140,248,0.3);transform:translateY(-4px);" class="zoom-indicator">🔍 ดูใหญ่</div>
                    </div>`;
                    const zoomIndicator = imageContainer.querySelector('.zoom-indicator');
                    const imgDiv = imageContainer.querySelector('div');
                    if (imgDiv) {
                        imgDiv.addEventListener('mouseover', () => {
                            if (zoomIndicator) {
                                zoomIndicator.style.opacity = '1';
                                zoomIndicator.style.transform = 'translateY(0)';
                            }
                        });
                        imgDiv.addEventListener('mouseout', () => {
                            if (zoomIndicator) {
                                zoomIndicator.style.opacity = '0';
                                zoomIndicator.style.transform = 'translateY(-4px)';
                            }
                        });
                    }
                }
            }
        }, 0);
    }).catch(err => console.error('Image load error:', err));

    return `
    <div class="order-card ${cardCls}${o.is_test ? ' is-test' : ''}" id="card_${o.id}">
        <div class="card-top">
            ${badgeHtml}${o.is_test ? '<span class="badge badge-test">🧪 ใบทดลอง</span>' : ''}
            <div style="text-align:right;">
                <span class="plat ${platCls}">${esc(o.platform)}</span>
                <div class="card-date" style="margin-top:4px;">${(() => {
                    try {
                        if (!o.order_date) return '-';
                        const od = new Date(o.order_date);
                        let out = '-';
                        if (!isNaN(od.getTime())) {
                            out = `${od.toLocaleDateString('th-TH')}`;
                        } else {
                            out = esc(o.order_date || '-');
                        }
                        if (o.payment_time) {
                            try {
                                const pd = new Date(o.payment_time);
                                if (!isNaN(pd.getTime())) {
                                    out += `<br><span style="font-size:1.35rem;color:var(--muted);font-weight:700;letter-spacing:0.5px;">💳 ${pd.toLocaleDateString('th-TH')} ${pd.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>`;
                                }
                            } catch (e) {}
                        }
                        if (o.ship_by_date) {
                            try {
                                const sd = new Date(o.ship_by_date);
                                if (!isNaN(sd.getTime())) {
                                    out += `<br><span style="font-size:1.1rem;color:#f97316;font-weight:700;letter-spacing:0.5px;">🚚 ${sd.toLocaleDateString('th-TH')} ${sd.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>`;
                                }
                            } catch (e) {}
                        }
                        return out;
                    } catch (e) { return esc(o.order_date || '-'); }
                })()}</div>
            </div>
        </div>
        <div style="display:flex;gap:1.2rem;align-items:flex-start;">
            <div id="imageContainer_${o.id}" style="flex-shrink:0;width:280px;height:280px;order:1;margin-top:-2px;"></div>
            <div style="flex:1;min-width:0;order:2;display:flex;flex-direction:column;justify-content:flex-start;padding-top:4px;">
                <div>
                    <div class="card-product-name">${esc(o.product_name || '-')}</div>
                    ${o.product_code ? `<div class="card-sku"># ${esc(o.product_code)}</div>` : ''}
                </div>
                <div class="card-details" style="margin-bottom:8px;">${details}</div>
                ${timeDetails.join('')}
                ${o.note ? `<div class="card-note">📝 ${esc(o.note)}</div>` : ''}
                <div style="font-size:0.85rem;color:var(--muted);margin-top:auto;padding-top:8px;">👤 ${esc(o.buyer_name || '-')} &nbsp;|&nbsp; #${esc(o.order_number || '-')}</div>
            </div>
        </div>
        <div style="margin-top:12px;padding:10px 12px;background:rgba(129,140,248,0.12);border:1px solid rgba(129,140,248,0.3);border-radius:8px;font-size:1.05rem;font-weight:700;color:var(--text);display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span>🧾 เลขที่การผลิต:</span>
            <span style="display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0;">
                <span style="font-size:1.55rem;color:var(--text);font-family:monospace;letter-spacing:1px;font-weight:800;text-shadow:0 0 8px var(--primary-glow);">${esc(productionNumberLabel)}</span>
                ${canEditProductionNumber ? `<button type="button" class="btn btn-outline btn-sm" style="white-space:nowrap;" title="แก้ไขเลขที่การผลิต" onclick="editProductionNumber('${o.id}',this)">✏️ แก้ไข</button>` : ''}
            </span>
        </div>
        <div class="card-actions">${actionsHtml}</div>
    </div>`;
}


// ═══ ล้างใบทดลองทั้งหมด ═══════════════════════════════════════════
// เรียกฟังก์ชันฝั่งฐานข้อมูล rpc_purge_test_orders ซึ่งจะ
//   1) ลบใบทดลองทุกใบ พร้อมคืนวัสดุเข้าสต็อกให้อัตโนมัติ
//   2) รีเซ็ตตัวนับเลขทดลองกลับไปเริ่มที่ T1
// เลขของจริงไม่ถูกแตะต้องเลย
async function purgeTestOrders(btn) {
    const n = (allOrders || []).filter(o => o.is_test).length;
    if (n === 0) {
        alert('ไม่มีใบทดลองในระบบ');
        return;
    }
    const ok = confirm(
        'ลบใบทดลองทั้งหมด ' + n + ' ใบ?\n\n' +
        '• วัสดุที่ตัดไปจะถูกคืนเข้าสต็อกให้อัตโนมัติ\n' +
        '• เลขทดลองจะเริ่มนับใหม่ที่ T1\n' +
        '• ออเดอร์จริงไม่ถูกแตะต้อง\n\n' +
        'การลบนี้ย้อนกลับไม่ได้'
    );
    if (!ok) return;

    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังลบ...'; }
    try {
        log('กำลังลบใบทดลอง ' + n + ' ใบ...', 'info');
        const { data, error } = await db.rpc('rpc_purge_test_orders');
        if (error) throw error;
        const deleted = (data && data.deleted != null) ? data.deleted : n;
        log('ลบใบทดลองสำเร็จ ' + deleted + ' ใบ · คืนวัสดุเข้าสต็อกแล้ว', 'success');
        alert('✅ ลบใบทดลองแล้ว ' + deleted + ' ใบ\nวัสดุถูกคืนเข้าสต็อกเรียบร้อย');
        await loadData();
    } catch (e) {
        log('ลบใบทดลองไม่สำเร็จ: ' + (e.message || e), 'error');
        alert('❌ ลบไม่สำเร็จ: ' + (e.message || e));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = old; }
    }
}
window.purgeTestOrders = purgeTestOrders;

function renderCards() {
    const statusMap = {
        pending: STATUS_PENDING,
        producing: STATUS_PRODUCING,
        done: STATUS_DONE
    };
    selectFirstAllowedTab();
    const orders = getFiltered([statusMap[activeTab]], {
        autoApplyLatestDoneDate: activeTab === 'done'
    });
    const container = document.getElementById('ordersContainer');

    try {
        const qEl = document.getElementById('searchInput');
        const rawQ = qEl ? String(qEl.value || '').trim().toLowerCase() : '';
        const q = rawQ.replace(/\s+/g, ' ');
        let filtered = orders;
        if (q) {
            filtered = orders.filter(o => {
                const fields = [
                    String(o.product_code || ''),
                    String(o.product_name || ''),
                    String(o.buyer_name || ''),
                    String(o.order_number || ''),
                    String(o.tracking_number || ''),
                    String(o.note || '')
                ].map(s => s.toLowerCase());
                return fields.some(f => f.includes(q));
            });
        }

        if (!filtered.length) {
            container.innerHTML = `<div class="empty-state"><div class="emoji">✅</div><p>ไม่มีรายการ</p></div>`;
            return;
        }

        container.innerHTML = filtered.map(renderOrderCard).join('');
    } catch (err) {
        console.error('renderCards error:', err);
        container.innerHTML = `<div class="empty-state"><p style="color:#f87171;">เกิดข้อผิดพลาดในการแสดงผล</p></div>`;
    }
}

// ─── UPDATE STATUS ────────────────────────
async function editProductionNumber(id, btnEl) {
    if (window.auth?.hasPermission?.('action_edit_production_number') !== true) {
        alert('❌ คุณไม่มีสิทธิ์แก้ไขเลขที่การผลิต');
        return;
    }

    if (pendingStatusUpdates.has(id)) return;

    const order = allOrders.find(item => item.id === id);
    if (!order) {
        alert('❌ ไม่พบออเดอร์ที่ต้องการแก้ไข');
        return;
    }

    const currentNumber = normalizeProductionNumberString(order.production_number) || '';
    const enteredValue = prompt(
        `แก้ไขเลขที่การผลิตของออเดอร์ ${order.order_number || '-'}\nรูปแบบ: ลำดับ/วันที่ เช่น 5/29`,
        currentNumber
    );
    if (enteredValue === null) return;

    const productionNumber = normalizeProductionNumberString(enteredValue);
    if (!productionNumber) {
        alert('❌ เลขที่การผลิตไม่ถูกต้อง\nกรุณากรอกเป็น ลำดับ/วันที่ เช่น 5/29');
        return;
    }
    if (productionNumber === currentNumber) return;

    const confirmed = confirm(
        `ยืนยันเปลี่ยนเลขที่การผลิต\n\n` +
        `ออเดอร์: ${order.order_number || '-'}\n` +
        `จาก: ${currentNumber || 'ยังไม่กำหนด'}\n` +
        `เป็น: ${productionNumber}`
    );
    if (!confirmed) return;

    pendingStatusUpdates.add(id);
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.dataset.originalText = btnEl.innerHTML;
        btnEl.innerHTML = '⏳';
    }

    try {
        const { data: updatedOrder, error } = await db
            .from(TABLE)
            .update({ production_number: productionNumber })
            .eq('id', id)
            .select('production_number')
            .single();
        if (error) throw error;

        order.production_number = updatedOrder?.production_number || productionNumber;

        const { error: logError } = await db.from('production_logs').insert({
            order_id: id,
            order_number: order.order_number || '-',
            action: `แก้ไขเลขที่การผลิตจาก ${currentNumber || 'ยังไม่กำหนด'} เป็น ${order.production_number}`
        });
        if (logError) console.warn('Unable to save production number edit log:', logError);

        log(`✅ แก้ไขเลขที่การผลิตเป็น ${order.production_number} แล้ว`, 'success');
        applyFilters();
    } catch (err) {
        console.error('Edit production number error:', err);
        const message = err?.message || 'ไม่ทราบสาเหตุ';
        alert(`❌ แก้ไขเลขที่การผลิตไม่สำเร็จ: ${message}`);
        log(`แก้ไขเลขที่การผลิตไม่สำเร็จ: ${message}`, 'error');
    } finally {
        pendingStatusUpdates.delete(id);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = btnEl.dataset.originalText || '✏️ แก้ไข';
        }
    }
}

function cancelProductionOrder(id, btnEl) {
    if (window.auth?.hasPermission?.('action_cancel_order') !== true) {
        alert('❌ คุณไม่มีสิทธิ์ยกเลิกออเดอร์');
        return;
    }

    const order = allOrders.find(item => item.id === id);
    if (!order) {
        alert('❌ ไม่พบออเดอร์ที่ต้องการยกเลิก');
        return;
    }

    const confirmed = confirm(
        `ยืนยันยกเลิกออเดอร์ ${order.order_number || '-'}\nSKU: ${order.product_code || '-'}\n\nออเดอร์จะออกจากคิวฝ่ายผลิต แต่ข้อมูลยังอยู่ใน Supabase`
    );
    if (!confirmed) return;

    updateStatus(id, 'ยกเลิก', btnEl);
}

async function deleteProductionOrder(id, btnEl) {
    if (window.auth?.hasPermission?.('action_delete_order') !== true) {
        alert('❌ คุณไม่มีสิทธิ์ลบออเดอร์');
        return;
    }

    if (pendingStatusUpdates.has(id)) return;

    const order = allOrders.find(item => item.id === id);
    if (!order) {
        alert('❌ ไม่พบออเดอร์ที่ต้องการลบ');
        return;
    }

    const isDone = order.tracking_status === STATUS_DONE;

    const confirmed = confirm(
        `ยืนยันลบออเดอร์ ${order.order_number || '-'}\nSKU: ${order.product_code || '-'}\n\n` +
        (isDone
            ? `ออเดอร์สถานะ "ผลิตสำเร็จแล้ว" จะถูกลบออกจากระบบโดยไม่ต้องคืนสต็อกวัสดุ\n`
            : `ระบบจะคืนสต็อกที่เกี่ยวข้อง แล้วลบออเดอร์ รายงานวัสดุเสีย และรายการจ่ายวัสดุของออเดอร์นี้ออกจาก Supabase\n`) +
        `การดำเนินการนี้ไม่สามารถย้อนกลับได้`
    );
    if (!confirmed) return;

    pendingStatusUpdates.add(id);
    const card = document.getElementById(`card_${id}`);
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.dataset.originalText = btnEl.innerHTML;
        btnEl.innerHTML = '⏳ กำลังลบ...';
    }
    if (card) card.style.opacity = '0.5';

    try {
        if (isDone) {
            // หากผลิตสำเร็จแล้ว ให้ลบออเดอร์และข้อมูลที่เกี่ยวข้องโดยตรงโดยไม่ต้องคืนสต็อกวัสดุ
            await db.from('damaged_materials').delete().eq('order_id', id);
            await db.from('production_logs').delete().eq('order_id', id);
            await db.from('order_components').delete().eq('order_id', id);
            const { error: deleteErr } = await db.from(TABLE).delete().eq('id', id);
            if (deleteErr) throw deleteErr;
        } else {
            const { data: cleanupResult, error } = await db.rpc('rpc_delete_production_order_cleanup', {
                p_order_id: id
            });
            if (error) {
                if (order.stock_deducted === true) {
                    try { await performReturn(order); } catch (e) { console.warn('fallback return error', e); }
                }
                await db.from('damaged_materials').delete().eq('order_id', id);
                await db.from('production_logs').delete().eq('order_id', id);
                await db.from('order_components').delete().eq('order_id', id);
                const { error: deleteErr } = await db.from(TABLE).delete().eq('id', id);
                if (deleteErr) throw deleteErr;
            }
        }

        const index = allOrders.findIndex(item => item.id === id);
        if (index !== -1) allOrders.splice(index, 1);
        log(
            `🗑️ ลบออเดอร์ ${order.order_number || id} ออกจากระบบเรียบร้อยแล้ว`,
            'success'
        );

        if (card) {
            card.style.transition = 'all 0.3s ease';
            card.style.transform = 'scale(0.95)';
            card.style.opacity = '0';
            setTimeout(() => applyFilters(), 320);
        } else {
            applyFilters();
        }
    } catch (err) {
        log(`❌ ลบออเดอร์ไม่สำเร็จ: ${err.message}`, 'error');
        alert(`❌ ลบออเดอร์ไม่สำเร็จ: ${err.message}`);
        if (card) card.style.opacity = '1';
        if (btnEl) btnEl.disabled = false;
    } finally {
        pendingStatusUpdates.delete(id);
        if (btnEl?.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
    }
}

async function updateStatus(id, newStatus, btnEl) {
    getAudioContext();
    if (pendingStatusUpdates.has(id)) {
        log(`⚠️ คำสั่งอัปเดตสถานะสำหรับออเดอร์ ${id} ถูกดำเนินการอยู่แล้ว`, 'warn');
        if (btnEl) btnEl.disabled = true;
        return;
    }

    pendingStatusUpdates.add(id);
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.dataset.originalText = btnEl.dataset.originalText || btnEl.innerHTML;
        btnEl.innerHTML = '⏳ กำลังอัปเดต...';
    }

    const order = allOrders.find(o => o.id === id);
    log(`กำลังอัปเดต [${order?.order_number || id}] → ${newStatus}...`);
    const card = document.getElementById(`card_${id}`);
    if (card) card.style.opacity = '0.5';

    try {
        const isRevertingFromDone = order?.tracking_status === STATUS_DONE && newStatus !== STATUS_DONE;

        // ตรวจสอบสิทธิ์หากกดผลิตสำเร็จโดยตรงจาก รอผลิต
        if (order?.tracking_status === STATUS_PENDING && newStatus === STATUS_DONE) {
            const canFinishPending = window.auth?.role === 'Ceo' || window.auth?.hasPermission?.('action_complete_pending_production') === true;
            if (!canFinishPending) {
                log('❌ คุณไม่มีสิทธิ์ใช้ปุ่มผลิตสำเร็จของรอผลิต', 'error');
                alert('❌ คุณไม่มีสิทธิ์ใช้ปุ่มผลิตสำเร็จจากหน้ารอผลิต (กรุณาให้ CEO กำหนดสิทธิ์ให้)');
                if (card) card.style.opacity = '1';
                if (btnEl) btnEl.disabled = false;
                pendingStatusUpdates.delete(id);
                return;
            }

            // ถามเหตุผลก่อนผลิตสำเร็จจาก รอผลิต
            const reason = await new Promise((resolve) => {
                // สร้าง modal
                const overlay = document.createElement('div');
                overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);`;

                const modal = document.createElement('div');
                modal.style.cssText = `background:#1e293b;border:1px solid rgba(99,102,241,0.4);border-radius:16px;padding:28px 32px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.5);`;
                modal.innerHTML = `
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                        <span style="font-size:1.4rem;">✅</span>
                        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;">ยืนยันผลิตสำเร็จ (รอผลิต)</h3>
                    </div>
                    <p style="color:#94a3b8;font-size:0.875rem;margin:0 0 14px;">ออเดอร์ #<strong style="color:#e2e8f0;">${order?.order_number || id}</strong></p>
                    <label style="display:block;color:#cbd5e1;font-size:0.85rem;margin-bottom:8px;">เหตุผลที่ผลิตสำเร็จโดยไม่ผ่านขั้นตอนปกติ <span style="color:#f87171;">*</span></label>
                    <textarea id="pendingCompleteReason" rows="3" placeholder="เช่น ผลิตด้วยวัสดุสำรอง, ลูกค้าต้องการด่วน, ฯลฯ"
                        style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid rgba(99,102,241,0.35);border-radius:10px;color:#f1f5f9;padding:10px 12px;font-size:0.875rem;resize:vertical;outline:none;font-family:inherit;"></textarea>
                    <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">
                        <button id="pendingCompleteCancel" style="padding:9px 20px;border-radius:9px;border:1px solid rgba(148,163,184,0.3);background:transparent;color:#94a3b8;cursor:pointer;font-size:0.875rem;font-family:inherit;">ยกเลิก</button>
                        <button id="pendingCompleteConfirm" style="padding:9px 20px;border-radius:9px;border:none;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;cursor:pointer;font-size:0.875rem;font-weight:600;font-family:inherit;">✅ ยืนยันผลิตสำเร็จ</button>
                    </div>
                `;
                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                const textarea = modal.querySelector('#pendingCompleteReason');
                const confirmBtn = modal.querySelector('#pendingCompleteConfirm');
                const cancelBtn = modal.querySelector('#pendingCompleteCancel');

                setTimeout(() => textarea.focus(), 80);

                const cleanup = () => document.body.removeChild(overlay);

                cancelBtn.onclick = () => { cleanup(); resolve(null); };
                overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(null); } };
                confirmBtn.onclick = () => {
                    const val = textarea.value.trim();
                    if (!val) {
                        textarea.style.borderColor = '#f87171';
                        textarea.placeholder = '⚠️ กรุณากรอกเหตุผลก่อน';
                        textarea.focus();
                        return;
                    }
                    cleanup();
                    resolve(val);
                };
            });

            if (!reason) {
                // กดยกเลิก
                if (card) card.style.opacity = '1';
                if (btnEl) btnEl.disabled = false;
                pendingStatusUpdates.delete(id);
                return;
            }

            // เก็บเหตุผลไว้ใส่ใน updatePayload ด้านล่าง
            window._pendingCompleteReason = reason;
        }

        // ตรวจสอบสิทธิ์การกดปุ่มย้อนกลับ
        const isReverting = (order?.tracking_status === STATUS_PRODUCING && newStatus === STATUS_PENDING) ||
                            (order?.tracking_status === STATUS_DONE && newStatus !== STATUS_DONE);
        if (isReverting) {
            const canRevert = window.auth?.role === 'Ceo' || window.auth?.hasPermission?.('action_revert_production_order') === true;
            if (!canRevert) {
                log('❌ คุณไม่มีสิทธิ์ใช้ปุ่มย้อนกลับสถานะ', 'error');
                alert('❌ คุณไม่มีสิทธิ์ใช้ปุ่มย้อนกลับสถานะ (กรุณาให้ CEO กำหนดสิทธิ์ให้)');
                if (card) card.style.opacity = '1';
                if (btnEl) btnEl.disabled = false;
                pendingStatusUpdates.delete(id);
                return;
            }
        }

        // ตรวจสอบว่ามีรายการจัดเตรียมวัสดุที่ถูกจ่ายแล้วหรือไม่ หากกดย้อนกลับไปเป็น 'รอผลิต' (ยกเว้นย้อนกลับจาก ผลิตสำเร็จแล้ว)
        if (newStatus === STATUS_PENDING && !isRevertingFromDone) {
            const { data: dispatchedLogs, error: checkError } = await db
                .from('stock_movement_log')
                .select('id')
                .eq('dispatched', true)
                .like('reason', 'ตัดสต็อกอัตโนมัติ (เริ่มผลิต%')
                .like('reason', `%ID ออเดอร์: ${id}%`);

            if (checkError) {
                console.error('Check dispatch error:', checkError);
            } else if (dispatchedLogs && dispatchedLogs.length > 0) {
                log(`❌ ไม่สามารถย้อนกลับได้ เนื่องจากวัสดุถูกจ่ายให้ฝ่ายผลิตแล้ว`, 'error');
                alert(`❌ ไม่สามารถย้อนกลับสถานะเป็น "รอผลิต" ได้\nเนื่องจากวัสดุสำหรับออเดอร์นี้ (#${order?.order_number || id}) ได้ถูกจ่ายให้ฝ่ายผลิตแล้ว`);
                if (card) card.style.opacity = '1';
                if (btnEl) btnEl.disabled = false;
                return;
            }
        }

        const updatePayload = { tracking_status: newStatus };
        const now = new Date().toISOString();
        if (newStatus === STATUS_PRODUCING) {
            updatePayload.production_started_at = order?.production_started_at || now;
            updatePayload.production_completed_at = null;
        } else if (newStatus === STATUS_DONE) {
            updatePayload.production_completed_at = now;
            if (!order?.production_started_at) {
                updatePayload.production_started_at = now;
            }
            // บันทึกเหตุผลที่กดผลิตสำเร็จจาก รอผลิต ลงใน field note
            if (window._pendingCompleteReason) {
                updatePayload.note = `[ผลิตสำเร็จจากรอผลิต] ${window._pendingCompleteReason}`;
                delete window._pendingCompleteReason;
            }
        } else if (newStatus === STATUS_PENDING) {
            updatePayload.production_started_at = null;
            updatePayload.production_completed_at = null;
        }


        // เมื่อกดย้อนกลับจาก ผลิตสำเร็จแล้ว -> ไม่ต้องคืนสต็อกวัสดุและสต็อกสำรอง
        const isMovingToProducing = (newStatus === STATUS_PRODUCING);
        const isAlreadyProducing = (order?.tracking_status === STATUS_PRODUCING);
        const isAlreadyDeducted = (order?.stock_deducted === true);

        // ตัดสต็อกเฉพาะเมื่อย้ายเข้า กำลังผลิต จาก รอผลิต (ไม่ตัดเมื่อข้ามไป ผลิตสำเร็จ เลย หรือเมื่อย้อนกลับจาก ผลิตสำเร็จแล้ว)
        const shouldDeduct = isMovingToProducing && !isAlreadyProducing && !isAlreadyDeducted && !isRevertingFromDone;

        if (shouldDeduct) {
            log(`📦 ระบบกำลังตรวจสอบส่วนประกอบสำหรับ [${order?.order_number || id}]...`);
            const deductionMode = await performDeduction(order);
            if (!deductionMode) {
                log(`⚠️ การตัดสต็อกถูกยกเลิก โดยผู้ใช้ [${order?.order_number || id}]`, 'info');
                if (card) card.style.opacity = '1';
                if (btnEl) {
                    btnEl.disabled = false;
                    btnEl.innerHTML = '🔨 เริ่มผลิต';
                }
                return;
            }

            if (deductionMode?.mode === 'backup') {
                const completedAt = new Date().toISOString();
                const index = allOrders.findIndex(item => item.id === id);
                if (index !== -1) {
                    allOrders[index] = {
                        ...allOrders[index],
                        tracking_status: STATUS_DONE,
                        stock_deducted: true,
                        production_started_at: allOrders[index].production_started_at || completedAt,
                        production_completed_at: completedAt
                    };
                }
                log(`✅ ใช้สต็อกสำรองและปิดงานออเดอร์ ${order?.order_number || id} แล้ว`, 'success');
                playSuccessSound();
                if (card) {
                    card.style.transition = 'all 0.35s ease';
                    card.style.transform = 'scale(0.9)';
                    card.style.opacity = '0';
                    setTimeout(() => applyFilters(), 360);
                } else {
                    applyFilters();
                }
                return;
            }
            updatePayload.stock_deducted = deductionMode?.stockDeducted === true;
        }

        // คืนสต็อกเฉพาะเมื่อย้อนกลับเป็น รอผลิต จาก กำลังผลิต ที่เคยตัดสต็อกไว้ (ไม่คืนสต็อกหากย้อนกลับจาก ผลิตสำเร็จแล้ว)
        const shouldReturn = newStatus === STATUS_PENDING && order?.stock_deducted === true && !isRevertingFromDone;
        if (shouldReturn) {
            const returnedStatus = await performReturn(order);
            if (returnedStatus) {
                updatePayload.stock_deducted = false;
                await db
                    .from('stock_movement_log')
                    .update({
                        reason: `คืนสต็อกแล้ว | source: production-return-marked | order_id: ${id} | order_number: ${order?.order_number || '-'} | sku: ${order?.product_code || '-'} | old_reason_contains: ID ออเดอร์: ${id}`
                    })
                    .eq('dispatched', false)
                    .like('reason', `%ID ออเดอร์: ${id}%`);
            }
        }

        if (newStatus === STATUS_DONE) {
            // ตรวจสอบการจ่ายวัสดุเฉพาะออเดอร์ที่เคยอยู่ในขั้นตอนกำลังผลิตและตัดสต็อกไว้
            if (order?.tracking_status === STATUS_PRODUCING && order?.stock_deducted === true) {
                const { data: undispatchedLogs, error: dispatchCheckErr } = await db
                    .from('stock_movement_log')
                    .select('id')
                    .eq('dispatched', false)
                    .like('reason', 'ตัดสต็อกอัตโนมัติ (เริ่มผลิต%')
                    .like('reason', `%ID ออเดอร์: ${id}%`);

                if (dispatchCheckErr) {
                    console.error('Dispatch check error:', dispatchCheckErr);
                } else if (undispatchedLogs && undispatchedLogs.length > 0) {
                    log(`❌ ไม่สามารถกดผลิตสำเร็จได้ เนื่องจากยังไม่ได้จ่ายวัสดุให้ฝ่ายผลิต`, 'error');
                    alert(`❌ ไม่สามารถกดผลิตสำเร็จได้\n\nกรุณาไปที่หน้า "คลังวัสดุ" แล้วกด "จ่ายวัสดุแล้ว" สำหรับออเดอร์นี้ก่อน`);
                    if (card) card.style.opacity = '1';
                    if (btnEl) {
                        btnEl.disabled = false;
                        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
                    }
                    pendingStatusUpdates.delete(id);
                    return;
                }
            }

            try {
                const { data: undeliveredDamages, error: dmgErr } = await db
                    .from('damaged_materials')
                    .select('id,status')
                    .eq('order_id', id)
                    .neq('status', 'delivered')
                    .limit(1);

                if (dmgErr) {
                    console.error('Damage check error:', dmgErr);
                } else if (undeliveredDamages && undeliveredDamages.length > 0) {
                    log(`❌ ไม่สามารถกดผลิตสำเร็จได้ เนื่องจากพบวัสดุชำรุดที่ยังไม่ได้จ่าย`, 'error');
                    alert(`❌ ไม่สามารถกดผลิตสำเร็จได้\n\nพบรายการวัสดุชำรุดที่ยังไม่ได้กด "จ่ายของแล้ว" ในหน้ารายงานวัสดุเสียหาย (Damage Report)\nกรุณาไปที่หน้า "รายงานวัสดุเสียหาย" และกด "จ่ายของแล้ว" สำหรับรายการที่เกี่ยวข้องก่อน`);
                    if (card) card.style.opacity = '1';
                    if (btnEl) {
                        btnEl.disabled = false;
                        if (btnEl.dataset.originalText) btnEl.innerHTML = btnEl.dataset.originalText;
                    }
                    pendingStatusUpdates.delete(id);
                    return;
                }
            } catch (err) {
                console.error('Error checking damaged_materials:', err);
            }

        }

        const { data: updatedOrder, error } = await db
            .from(TABLE)
            .update(updatePayload)
            .eq('id', id)
            .select('production_number,production_started_at,production_completed_at,stock_deducted')
            .single();
        if (error) throw error;

        const persistedUpdate = { ...updatePayload, ...(updatedOrder || {}) };
        if (newStatus === STATUS_PRODUCING && !persistedUpdate.production_number) {
            log('เริ่มผลิตแล้ว แต่ฐานข้อมูลยังไม่ได้สร้างเลขที่การผลิต', 'warn');
        } else if (newStatus === STATUS_PRODUCING) {
            log(`เลขที่การผลิต: ${persistedUpdate.production_number}`, 'success');
        }

        try {
            await db.from('production_logs').insert({
                order_id: id,
                order_number: order?.order_number || '-',
                action: `เปลี่ยนสถานะเป็น ${newStatus}`
            });
        } catch (logErr) {
            console.error('Failed to save log', logErr);
        }

        const idx = allOrders.findIndex(o => o.id === id);
        if (idx !== -1) {
            if (!PROD_STATUSES.includes(newStatus)) {
                allOrders.splice(idx, 1);
            } else {
                allOrders[idx] = { ...allOrders[idx], ...persistedUpdate };
            }
        }

        log(`✅ อัปเดตสำเร็จ [${order?.order_number}] → ${newStatus}`, 'success');

        if (newStatus === STATUS_PRODUCING) {
            playStartProductionSound();
        } else if (newStatus === STATUS_DONE) {
            playSuccessSound();
        } else if (newStatus === STATUS_PENDING) {
            playRevertSound();
        }

        if (card) {
            card.style.transition = 'all 0.35s ease';
            card.style.transform = 'scale(0.9)';
            card.style.opacity = '0';
            setTimeout(() => applyFilters(), 360);
        } else {
            applyFilters();
        }
    } catch (err) {
        log(`อัปเดตล้มเหลว: ${err.message}`, 'error');
        if (card) card.style.opacity = '1';
        if (btnEl) {
            btnEl.disabled = false;
            if (btnEl.dataset.originalText) {
                btnEl.innerHTML = btnEl.dataset.originalText;
            }
        }
        alert(`❌ อัปเดตสถานะล้มเหลว: ${err.message}`);
    } finally {
        pendingStatusUpdates.delete(id);
        if (btnEl && btnEl.dataset.originalText) {
            btnEl.innerHTML = btnEl.dataset.originalText;
        }
    }
}

// ─── SUMMARY MODAL ────────────────────────
function openSummaryModal() {
    const pending = getFiltered([STATUS_PENDING]);
    const producing = getFiltered([STATUS_PRODUCING]);
    const groups = buildGroups([...pending, ...producing]);
    const totalQty = groups.reduce((s, g) => s + g.totalQty, 0);
    const now = new Date().toLocaleString('th-TH');

    let text = `🏭 สรุปการผลิต — ${now}\n${'─'.repeat(40)}\n`;
    text += `📦 รอผลิต: ${pending.length} ออเดอร์ | 🔨 กำลังผลิต: ${producing.length} ออเดอร์\n`;
    text += `🔢 รวมทั้งหมด: ${totalQty} ชิ้น\n${'─'.repeat(40)}\n\n`;
    groups.forEach((g, i) => {
        const sku = g.product_code ? ` [${g.product_code}]` : '';
        const size = g.product_size ? ` ไซส์ ${g.product_size}` : '';
        const slots = g.slots != null ? ` ${g.slots}ช่อง` : '';
        const pattern = g.pattern ? ` ${g.pattern}` : '';
        const al = g.aluminum_color ? ` สีอลู:${g.aluminum_color}` : '';
        const gl = g.glass_color ? ` กระจก:${g.glass_color}` : '';
        const screen = g.screen_type ? ` [${g.screen_type}]` : '';
        text += `${i + 1}. ${g.product_name}${sku}${size}${slots}${pattern}${al}${gl}${screen}\n   ➜ ผลิต ${g.totalQty} ชิ้น (${g.orderCount} ออเดอร์)\n\n`;
    });
    text += `${'─'.repeat(40)}\n✅ ระบบบันทึกสต็อก`;

    document.getElementById('summaryText').textContent = text;
    document.getElementById('summaryModal').style.display = 'flex';
}

function closeSummaryModal() { document.getElementById('summaryModal').style.display = 'none'; }

function doCopy() {
    navigator.clipboard.writeText(document.getElementById('summaryText').textContent).then(() => {
        log('📋 คัดลอกสรุปสำเร็จ!', 'success');
        closeSummaryModal();
        alert('📋 คัดลอกแล้ว! นำไปวางใน LINE ได้เลย ✅');
    });
}

// ─── HISTORY MODAL ────────────────────────
function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }
async function viewHistory(id) {
    document.getElementById('historyModal').style.display = 'flex';
    const content = document.getElementById('historyContent');
    content.innerHTML = `<div class="empty-state"><div class="spinner"></div><p>กำลังโหลดประวัติ...</p></div>`;

    try {
        const { data, error } = await db.from('production_logs')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false });
        if (error) throw error;

        if (!data || data.length === 0) {
            content.innerHTML = `<div class="empty-state" style="padding:1rem;"><p>ไม่มีประวัติการอัปเดตสถานะของออเดอร์นี้</p></div>`;
            return;
        }

        content.innerHTML = data.map(lg => {
            const d = new Date(lg.created_at);
            return `<div style="padding:0.8rem; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:4px; background: rgba(255,255,255,0.02); margin-bottom:4px; border-radius:10px;">
                <div style="font-weight:600; color:var(--primary-bright); font-size: 0.95rem;">${esc(lg.action)}</div>
                <div style="font-size:0.82rem; color:var(--muted);">📅 ${d.toLocaleDateString('th-TH')} 🕒 ${d.toLocaleTimeString('th-TH')}</div>
            </div>`;
        }).join('');
    } catch (err) {
        content.innerHTML = `<div style="color:#f87171; text-align:center; padding:1rem;">❌ โหลดประวัติล้มเหลว: ${err.message}</div>`;
    }
}

// ─── SOUND NOTIFICATION ─────────────────────
let audioCtx = null;
let soundEnabled = true;

function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playNotificationSound() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const now = ctx.currentTime;
        
        // เสียงกระดิ่งกังวานชัดเจนสำหรับแจ้งเตือนออเดอร์โรงงาน (Loud High-Visibility 4-Tone Chime)
        const notes = [
            { freq: 783.99,  start: 0.00, duration: 0.28, gain: 0.85, type: 'triangle' }, // G5 (เสียงเริ่ม)
            { freq: 1046.50, start: 0.12, duration: 0.32, gain: 0.95, type: 'triangle' }, // C6 (เสียงกลาง)
            { freq: 1318.51, start: 0.25, duration: 0.55, gain: 1.00, type: 'sine' },     // E6 (เสียงกังวาน)
            { freq: 1567.98, start: 0.40, duration: 0.70, gain: 0.90, type: 'sine' }      // G6 (เสียงปิดท้ายก้อง)
        ];

        notes.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = n.type;
            osc.frequency.setValueAtTime(n.freq, now + n.start);
            
            gain.gain.setValueAtTime(n.gain, now + n.start);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start(now + n.start);
            osc.stop(now + n.start + n.duration);
        });
    } catch (e) {
        console.warn('Unable to play notification sound:', e);
    }
}

function playStartProductionSound() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;
        // เสียงตอบรับเมื่อเริ่มผลิต (ตึ๊ด-ดึ๊ง! 🔨)
        const notes = [
            { freq: 523.25, start: 0.00, duration: 0.15, gain: 0.75, type: 'triangle' }, // C5
            { freq: 783.99, start: 0.10, duration: 0.35, gain: 0.95, type: 'triangle' }  // G5
        ];

        notes.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = n.type;
            osc.frequency.setValueAtTime(n.freq, now + n.start);
            gain.gain.setValueAtTime(n.gain, now + n.start);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + n.start);
            osc.stop(now + n.start + n.duration);
        });
    } catch (e) {
        console.warn('Unable to play start sound:', e);
    }
}

function playSuccessSound() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;
        // เสียงตอบรับผลิตสำเร็จ (ตึ๊ด-ตึ๊ด-ดึ๊ง! 🎉)
        const notes = [
            { freq: 523.25, start: 0.00, duration: 0.10, gain: 0.65, type: 'triangle' }, // C5
            { freq: 659.25, start: 0.08, duration: 0.10, gain: 0.75, type: 'triangle' }, // E5
            { freq: 783.99, start: 0.16, duration: 0.15, gain: 0.85, type: 'triangle' }, // G5
            { freq: 1046.50, start: 0.26, duration: 0.45, gain: 0.95, type: 'sine' }     // C6
        ];

        notes.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = n.type;
            osc.frequency.setValueAtTime(n.freq, now + n.start);
            gain.gain.setValueAtTime(n.gain, now + n.start);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + n.start);
            osc.stop(now + n.start + n.duration);
        });
    } catch (e) {
        console.warn('Unable to play success sound:', e);
    }
}

function playRevertSound() {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const now = ctx.currentTime;
        // เสียงย้อนกลับ (ดึ๊ง-ตึ๊ด ระดับลดลง)
        const notes = [
            { freq: 783.99, start: 0.00, duration: 0.18, gain: 0.75, type: 'triangle' }, // G5
            { freq: 523.25, start: 0.15, duration: 0.30, gain: 0.65, type: 'triangle' }  // C5
        ];

        notes.forEach(n => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = n.type;
            osc.frequency.setValueAtTime(n.freq, now + n.start);
            gain.gain.setValueAtTime(n.gain, now + n.start);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + n.start);
            osc.stop(now + n.start + n.duration);
        });
    } catch (e) {
        console.warn('Unable to play revert sound:', e);
    }
}

function toggleNotificationSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('soundToggleBtn');
    if (btn) {
        btn.textContent = soundEnabled ? '🔔 เสียงแจ้งเตือน: เปิด' : '🔕 เสียงแจ้งเตือน: ปิด';
        btn.style.color = soundEnabled ? '' : '#f87171';
    }
    if (soundEnabled) {
        playNotificationSound();
        showToast('🔔 เปิดเสียงแจ้งเตือนแล้ว (ทดสอบเสียงดัง 🔊)', 'info');
    } else {
        showToast('🔕 ปิดเสียงแจ้งเตือนแล้ว', 'warn');
    }
}

function unlockAudioOnInteraction() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }
}

document.addEventListener('click', unlockAudioOnInteraction);
document.addEventListener('keydown', unlockAudioOnInteraction);

// ─── REALTIME ─────────────────────────────
function setupRealtime() {
    const dot = document.getElementById('rtDot');
    const label = document.getElementById('rtLabel');
    db.channel('prod:stock_orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, payload => {
            const { eventType, new: nw, old: ol } = payload;
            if (eventType === 'INSERT') {
                if (canViewProductionStatus(nw.tracking_status) && !nw.tracking_number && canViewProductionSku(nw.product_code)) {
                    allOrders.push(nw);
                    log(`📥 ออเดอร์ใหม่: ${nw.order_number || '?'}`, 'success');
                    playNotificationSound();
                }
            } else if (eventType === 'UPDATE') {
                const idx = allOrders.findIndex(o => o.id === nw.id);
                if (canViewProductionStatus(nw.tracking_status) && !nw.tracking_number && canViewProductionSku(nw.product_code)) {
                    if (idx !== -1) {
                        const prevStatus = allOrders[idx].tracking_status;
                        allOrders[idx] = { ...allOrders[idx], ...nw };
                        if (prevStatus !== nw.tracking_status) {
                            if (nw.tracking_status === STATUS_PRODUCING) {
                                playStartProductionSound();
                            } else if (nw.tracking_status === STATUS_DONE) {
                                playSuccessSound();
                            } else if (nw.tracking_status === STATUS_PENDING) {
                                playRevertSound();
                            }
                        }
                    } else {
                        allOrders.push(nw);
                        playNotificationSound();
                    }
                } else {
                    if (idx !== -1) allOrders.splice(idx, 1);
                }
                log(`🔄 อัปเดต: ${nw.order_number || '?'}`, 'info');
            }
            else if (eventType === 'DELETE') {
                allOrders = allOrders.filter(o => o.id !== ol.id);
            }
            enrichOrdersWithDispatchStatus().then(() => applyFilters());
        })
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                dot.classList.remove('off');
                label.textContent = 'Realtime พร้อม';
            } else {
                dot.classList.add('off');
                label.textContent = 'Realtime ขาด';
            }
        });

    db.channel('prod:dispatch_watch')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stock_movement_log' }, () => {
            enrichOrdersWithDispatchStatus().then(() => applyFilters());
        })
        .subscribe();

    db.channel('prod:damaged_watch')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'damaged_materials' }, () => {
            enrichOrdersWithDamageStatus().then(() => applyFilters());
        })
        .subscribe();

    if (dispatchPollInterval) clearInterval(dispatchPollInterval);
    dispatchPollInterval = setInterval(() => {
        enrichOrdersWithDispatchStatus().then(() => applyFilters());
    }, 10000);
}

// ─── UTILS ────────────────────────────────
function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── DAMAGE REPORT ─────────────────────────
let _damageOrderId = null;

async function openDamageModal(orderId) {
    _damageOrderId = orderId;
    const order = allOrders.find(o => o.id === orderId);
    document.getElementById('damageOrderInfo').textContent =
        `📦 ออเดอร์: ${order?.order_number || orderId}  —  ${order?.product_name || ''}`;
    document.getElementById('damageQty').value = 1;
    document.getElementById('damageReason').value = '';
    document.getElementById('damageReporterName').value = '';
    ['damageReason','damageReporterName'].forEach(id => {
        document.getElementById(id).style.borderColor = '';
    });

    const select = document.getElementById('damageItemSelect');
    select.innerHTML = '<option value="">-- กำลังโหลด... --</option>';
    document.getElementById('damageModal').style.display = 'flex';

    try {
        let componentCodes = [];

        if (order?.product_code) {
            const { data: bomData, error: bomError } = await db.from('stock_bom')
                .select('component_product_code')
                .eq('product_code', order.product_code);
            if (bomError) throw bomError;
            componentCodes = (bomData || [])
                .map(item => String(item.component_product_code || '').trim())
                .filter(Boolean);
        }

        if (!componentCodes.length) {
            const components = order ? await fetchComponentsForOrder(order) : [];
            componentCodes = components
                .map(item => String(item.component_product_code || '').trim())
                .filter(Boolean);
        }

        if (!componentCodes.length) {
            select.innerHTML = '<option value="">-- ไม่พบชิ้นส่วนของหน้างานนี้ --</option>';
            return;
        }

        const { data, error } = await db.from('stock_items')
            .select('id,product_name,product_code,quantity')
            .in('product_code', componentCodes)
            .order('product_name');
        if (error) throw error;

        const allItems = data || [];
        const itemsByCode = new Map(
            allItems.map(item => [String(item.product_code || '').trim().toUpperCase(), item])
        );

        const filtered = componentCodes.map(code => {
            const item = itemsByCode.get(String(code).trim().toUpperCase());
            return item ? { ...item, component_code: code } : null;
        }).filter(Boolean);

        if (!filtered.length) {
            select.innerHTML = '<option value="">-- ไม่พบชิ้นส่วนของหน้างานนี้ --</option>';
        } else {
            select.innerHTML = filtered.map(item =>
                `<option value="${item.id}" data-name="${esc(item.product_name)}" data-qty="${item.quantity}">${esc(item.product_name)} (${esc(item.component_code)})</option>`
            ).join('');
        }
    } catch (err) {
        log(`ไม่สามารถโหลดรายการชิ้นส่วน: ${err.message}`, 'error');
        select.innerHTML = '<option value="">-- โหลดล้มเหลว --</option>';
    }
}

function closeDamageModal() {
    document.getElementById('damageModal').style.display = 'none';
    _damageOrderId = null;
}

async function submitDamageReport() {
    const select = document.getElementById('damageItemSelect');
    const itemId = select.value;
    const itemName = select.selectedOptions[0]?.dataset?.name || select.selectedOptions[0]?.text || '';
    const currentQty = parseInt(select.selectedOptions[0]?.dataset?.qty) || 0;
    const damageQty = parseInt(document.getElementById('damageQty').value) || 1;
    const reason = document.getElementById('damageReason').value.trim();
    const reporterName = document.getElementById('damageReporterName').value.trim();

    let hasError = false;
    if (!itemId) {
        log('⚠️ กรุณาเลือกชิ้นส่วนที่เสียหาย', 'warn');
        select.style.borderColor = '#ef4444';
        hasError = true;
    } else {
        select.style.borderColor = '';
    }
    if (!reason) {
        document.getElementById('damageReason').style.borderColor = '#ef4444';
        document.getElementById('damageReason').focus();
        log('⚠️ กรุณาระบุเหตุผล / หมายเหตุ', 'warn');
        hasError = true;
    } else {
        document.getElementById('damageReason').style.borderColor = '';
    }
    if (!reporterName) {
        document.getElementById('damageReporterName').style.borderColor = '#ef4444';
        document.getElementById('damageReporterName').focus();
        log('⚠️ กรุณาระบุชื่อฝ่ายผลิต (ผู้รายงาน)', 'warn');
        hasError = true;
    } else {
        document.getElementById('damageReporterName').style.borderColor = '';
    }
    if (hasError) return;

    if (damageQty <= 0) { log('⚠️ จำนวนต้องมากกว่า 0', 'warn'); return; }
    if (damageQty > currentQty) {
        log(`⚠️ จำนวนที่เสียหาย (${damageQty}) มากกว่าจำนวนในสต็อก (${currentQty})`, 'warn');
        return;
    }

    const newQty = currentQty - damageQty;

    const submitBtn = document.querySelector('#damageModal .modal-actions button:last-child');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ กำลังบันทึก...'; }

    try {
        const { error: deductErr } = await db.from('stock_items')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', itemId);
        if (deductErr) throw deductErr;

        const order = _damageOrderId ? allOrders.find(o => o.id === _damageOrderId) : null;
        const { data: dmgData, error: logErr } = await db.from('damaged_materials').insert({
            order_id: _damageOrderId || null,
            order_number: order?.order_number || null,
            item_id: itemId,
            item_name: itemName,
            quantity: damageQty,
            reason: reason,
            reported_by: reporterName
        }).select();
        if (logErr) throw new Error('ไม่สามารถบันทึกข้อมูลความเสียหายลงคลัง: ' + logErr.message);

        const dmgId = dmgData && dmgData[0] ? dmgData[0].id : null;

        const dmgReasonStr = `วัสดุเสียหาย | source: production-damage | order_id: ${order?.id || _damageOrderId} | order_number: ${order?.order_number || _damageOrderId} | item: ${itemName} | note: ${reason}${dmgId ? ` | ref: ${dmgId}` : ''}`;
        const { error: movErr } = await db.from('stock_movement_log').insert({
            item_id: itemId,
            item_name: itemName,
            old_qty: currentQty,
            new_qty: newQty,
            operator: reporterName,
            reason: dmgReasonStr
        });
        if (movErr) throw new Error('ไม่สามารถบันทึกประวัติการปรับสต็อก: ' + movErr.message);

        if (_damageOrderId) {
            await db.from('production_logs').insert({
                order_id: _damageOrderId,
                order_number: order?.order_number || '-',
                action: `⚠️ วัสดุเสียหาย: ${itemName} จำนวน ${damageQty} — ${reason} — ผู้รายงาน: ${reporterName}`
            });
        }

        log(`✅ บันทึกวัสดุเสียหาย: ${itemName} -${damageQty} (คงเหลือ ${newQty}) — โดย ${reporterName}`, 'success');
        closeDamageModal();
    } catch (err) {
        log(`❌ บันทึกไม่สำเร็จ: ${err.message}`, 'error');
        alert(`❌ เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '⚠️ ยืนยันวัสดุเสียหาย'; }
    }
}

// ─── INIT ─────────────────────────────────
let productionInitialized = false;
window.addEventListener('auth-ready', async () => {
    if (productionInitialized) return;
    productionInitialized = true;
    selectFirstAllowedTab();
    await loadData();
    setupRealtime();
});
