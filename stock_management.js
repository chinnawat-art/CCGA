// ==========================================
// STOCK MANAGEMENT SYSTEM — v2 (UX Improved)
// ==========================================

const STOCK_TABLE_NAME = 'stock_items';
const STOCK_PAGE_SIZE = 1000;
const STOCK_RENDER_PAGE_SIZE = 100;
const LEGACY_PIECE_UNIT = '\u00e0\u00b8\u0160\u00e0\u00b8\u00b4\u00e0\u00b9\u2030\u00e0\u00b8\u2122';
let dbSupabase = null;
let allStocks = [];
let currentEditingId = null;
let sortField = 'created_at';
let sortAsc = false;
let realtimeChannel = null;
let movementLogs = [];
let currentStockPage = 1;
let stockSearchDebounceTimer = null;
let logsRenderDebounceTimer = null;
let movementLogsReloadTimer = null;
let movementLogsLoading = false;

function normalizeUnit(value, fallback = '') {
    const unit = String(value || '').trim();
    if (!unit) return fallback;
    return unit === LEGACY_PIECE_UNIT ? 'ชิ้น' : unit;
}

function getReorderPoint(stock) {
    const value = Number(stock?.reorder_point ?? 10);
    return Number.isFinite(value) && value >= 0 ? value : 10;
}

function getNearStockPoint(stock) {
    const reorderPoint = getReorderPoint(stock);
    const value = Number(stock?.near_stock_point);
    return Number.isFinite(value) && value > reorderPoint ? value : reorderPoint + 10;
}

function getStockLevel(stock) {
    const quantity = Number(stock?.quantity) || 0;
    if (quantity <= getReorderPoint(stock)) return 'low';
    if (quantity <= getNearStockPoint(stock)) return 'near';
    return 'ok';
}

// ─── INIT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    dbSupabase = (window.auth && window.auth.supabase)
        ? window.auth.supabase
        : (window.supabase && window.SUPABASE_CONFIG
            ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
            : null);

    if (!dbSupabase) {
        showToast('❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้ — ตรวจสอบ config.js', 'error');
        return;
    }

    await refreshStockList();
    await loadMovementLogs();
    document.getElementById('stockForm').addEventListener('submit', handleFormSubmit);
    startRealtime();
});

function scheduleRenderLogs() {
    clearTimeout(logsRenderDebounceTimer);
    logsRenderDebounceTimer = setTimeout(() => {
        renderLogs();
    }, 180);
}

function scheduleMovementLogsReload() {
    clearTimeout(movementLogsReloadTimer);
    movementLogsReloadTimer = setTimeout(() => {
        loadMovementLogs();
    }, 350);
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    if (!el) return;
    const colors = {
        success: '#10b981',
        error: '#f87171',
        info: '#818cf8',
        warning: '#f59e0b'
    };
    el.style.background = `rgba(15,23,42,0.97)`;
    el.style.borderColor = colors[type] || colors.info;
    el.style.color = colors[type] || colors.info;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ─── REALTIME (Row-level) ─────────────────────────────────────────────────
// เวลาฝ่ายผลิตตัดสต็อก 1 ออเดอร์ ระบบส่งสัญญาณมาทีละ 10-20 แถวติดกัน
// เดิมวาดตารางใหม่ทั้งตารางทุกสัญญาณ → มือถือ (โดยเฉพาะ iPhone) หน่วง/ค้าง และช่องที่กำลังพิมพ์ถูกล้าง
// ตอนนี้: รวบสัญญาณแล้ววาดครั้งเดียว และถ้ากำลังพิมพ์ในตารางอยู่ รอให้พิมพ์เสร็จก่อนค่อยวาด
let realtimeRenderTimer = null;
function scheduleRealtimeRender(delay = 400) {
    clearTimeout(realtimeRenderTimer);
    realtimeRenderTimer = setTimeout(() => {
        const active = document.activeElement;
        const tbody = document.getElementById('stockTableBody');
        const typingInTable = active && tbody && tbody.contains(active)
            && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
        // กำลังพิมพ์ในตาราง / พักจอ / กล่องเหตุผลปรับยอดเปิดอยู่ → ยังไม่วาด เช็คใหม่ทุก 1 วิ
        if (typingInTable || document.hidden || adjState) {
            scheduleRealtimeRender(1000);
            return;
        }
        // ตัวเลขที่ใส่ในช่องปรับจำนวนแล้วยังไม่ได้กด ✓ (มือถือ: กดปิดแป้นแล้ว ช่องไม่ได้โฟกัส) อย่าให้หายตอนวาดใหม่
        const pendingQty = [...tbody.querySelectorAll('.quick-qty-input-new')]
            .filter(inp => inp.value)
            .map(inp => ({
                id: inp.closest('tr') && inp.closest('tr').dataset.id,
                value: inp.value,
                minus: inp.parentElement.querySelector('.sign-toggle-btn')?.getAttribute('data-sign') === '-'
            }));
        renderStockTable();
        updateStatistics();
        pendingQty.forEach(p => {
            const tr = [...tbody.querySelectorAll('tr[data-id]')].find(r => r.dataset.id === String(p.id));
            const inp = tr && tr.querySelector('.quick-qty-input-new');
            if (!inp) return;
            inp.value = p.value;
            const sign = tr.querySelector('.sign-toggle-btn');
            if (p.minus && sign && !sign.disabled && sign.getAttribute('data-sign') !== '-') toggleSignBtn(sign);
            markQuickQtyDirty(inp);
        });
    }, delay);
}

function startRealtime() {
    if (!dbSupabase) return;
    realtimeChannel = dbSupabase
        .channel('stock-mgmt-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: STOCK_TABLE_NAME },
            ({ new: row }) => {
                // Add new row to local data without DB refetch
                if (!allStocks.find(s => s.id === row.id)) {
                    allStocks.unshift(row);
                }
                scheduleRealtimeRender();
                showToast(`➕ เพิ่มสินค้าใหม่: ${row.product_name}`, 'success');
            })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: STOCK_TABLE_NAME },
            ({ new: row }) => {
                // Patch only the changed row in local array
                const idx = allStocks.findIndex(s => s.id === row.id);
                if (idx !== -1) allStocks[idx] = row;
                else allStocks.unshift(row);
                scheduleRealtimeRender();
            })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: STOCK_TABLE_NAME },
            ({ old: row }) => {
                allStocks = allStocks.filter(s => s.id !== row.id);
                scheduleRealtimeRender();
                showToast(`🗑️ ลบสินค้า: ${row.product_name || row.id}`, 'info');
            })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_movement_log' },
            () => {
                scheduleMovementLogsReload();
            })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stock_movement_log' },
            () => {
                scheduleMovementLogsReload();
            })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                showToast('🟢 เชื่อมต่อเรียลไทม์แล้ว', 'info');
                scheduleMovementLogsReload();
            }
        });
}

window.addEventListener('beforeunload', () => {
    if (realtimeChannel) dbSupabase.removeChannel(realtimeChannel);
});

// ─── LOAD DATA ────────────────────────────────────────────────────────────
async function fetchAllStocks() {
    const stocks = [];

    for (let from = 0; ; from += STOCK_PAGE_SIZE) {
        const { data, error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .select('*')
            .order('id', { ascending: true })
            .range(from, from + STOCK_PAGE_SIZE - 1);

        if (error) throw error;

        const page = data || [];
        stocks.push(...page);
        if (page.length < STOCK_PAGE_SIZE) break;
    }

    return stocks;
}

async function refreshStockList() {
    try {
        allStocks = await fetchAllStocks();
        currentStockPage = 1;
        renderStockTable();
        updateStatistics();
    } catch (err) {
        showToast('❌ โหลดข้อมูลล้มเหลว: ' + err.message, 'error');
    }
}

// ─── SORT ─────────────────────────────────────────────────────────────────
function sortBy(field) {
    if (sortField === field) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = true;
    }
    renderStockTable();
    // Update sort icons
    document.querySelectorAll('th[data-sort]').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (th.dataset.sort === field) {
            icon.textContent = sortAsc ? ' ↑' : ' ↓';
        } else {
            icon.textContent = ' ↕';
        }
    });
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────
function getSorted(stocks) {
    if (sortField === 'storage_location') {
        // ช่องเก็บ: เรียงแบบนับเลข (A-2 ก่อน A-10) · ยังไม่ระบุไว้ท้ายเสมอ
        return [...stocks].sort((a, b) => {
            const va = a.storage_location || '';
            const vb = b.storage_location || '';
            if (!va || !vb) return (!va) - (!vb);
            const d = va.localeCompare(vb, 'th', { numeric: true, sensitivity: 'base' });
            return sortAsc ? d : -d;
        });
    }
    return [...stocks].sort((a, b) => {
        let va = a[sortField] ?? '';
        let vb = b[sortField] ?? '';
        if (typeof va === 'number') return sortAsc ? va - vb : vb - va;
        return sortAsc
            ? String(va).localeCompare(String(vb), 'th')
            : String(vb).localeCompare(String(va), 'th');
    });
}

let selectedCategory = ''; // active tab category
let showOnlyLowStock = false;
let showOnlyNearStock = false;

// ─── จุดเก็บวัสดุ ──────────────────────────────────────────────────────────
// จุดที่ 2 = วัสดุในสูตรบานกระทุ้ง/บานเปิด (ANWD, CMWD) เก็บที่โรงงานโมดูลาร่า · ที่เหลือ = จุดที่ 1
// ชุดเดียวกับหน้าเตรียมวัสดุ/ตรวจนับ · สูตร ~15,000 แถว โหลดครั้งแรก ~5 วิ → จำในเครื่อง 12 ชม. (ใช้ร่วมกับหน้าตรวจนับ)
const SITE2_SKUS = ['ANWD', 'CMWD'];
const SITE_LABEL = { '1': 'จุดที่ 1', '2': 'จุดที่ 2 · บานกระทุ้ง/บานเปิด' };
const SITE2_CACHE = 'ccga_site2_codes_v1';
const SITE2_TTL = 12 * 3600 * 1000;
let selectedSite = '';
let site2Set = null;

async function loadSite2Set() {
    if (site2Set) return site2Set;
    try {
        const c = JSON.parse(localStorage.getItem(SITE2_CACHE) || 'null');
        if (c && Array.isArray(c.codes) && c.codes.length && Date.now() - c.at < SITE2_TTL) {
            site2Set = new Set(c.codes);
            return site2Set;
        }
    } catch (e) { /* เครื่องไม่ให้เก็บ — โหลดใหม่ */ }
    const orF = SITE2_SKUS.map(p => 'product_code.ilike.' + p + '%').join(',');
    const head = await dbSupabase.from('stock_bom').select('id', { count: 'exact', head: true }).or(orF);
    if (head.error) throw head.error;
    const reqs = [];
    for (let from = 0; from < (head.count || 0); from += 1000)   // ฐานข้อมูลส่งได้ครั้งละ 1,000 แถว
        reqs.push(dbSupabase.from('stock_bom').select('component_product_code').or(orF).order('id').range(from, from + 999));
    const set = new Set();
    (await Promise.all(reqs)).forEach(r => {
        if (r.error) throw r.error;
        (r.data || []).forEach(x => { if (x.component_product_code) set.add(x.component_product_code); });
    });
    try { localStorage.setItem(SITE2_CACHE, JSON.stringify({ at: Date.now(), codes: [...set] })); } catch (e) { /* ไม่เป็นไร */ }
    site2Set = set;
    return site2Set;
}

function inSelectedSite(stock) {
    if (!selectedSite || !site2Set) return true;
    const isSite2 = site2Set.has(stock.product_code);
    return selectedSite === '2' ? isSite2 : !isSite2;
}

async function selectSite(value) {
    const sel = document.getElementById('siteSelect');
    if (value && !site2Set) {
        if (sel) sel.disabled = true;
        showToast('⏳ กำลังโหลดรายการวัสดุของแต่ละจุด...', 'info');
        try {
            await loadSite2Set();
        } catch (err) {
            showToast('❌ โหลดรายการจุดไม่สำเร็จ: ' + err.message, 'error');
            if (sel) sel.value = selectedSite;
            return;
        } finally {
            if (sel) sel.disabled = false;
        }
    }
    selectedSite = value;
    if (sel) sel.classList.toggle('active', !!value);
    currentStockPage = 1;
    renderStockTable();
    updateStatistics();
}

// คัดลอกรายการที่แสดงอยู่ (ตามจุด/หมวด/ค้นหา/ต่ำกว่าเตือน/ใกล้หมด) ไปวางใน LINE
async function copyFilteredList() {
    const rows = getSorted(getFiltered());
    if (!rows.length) { showToast('ไม่มีรายการให้คัดลอก', 'warning'); return; }
    const MAX = 300;
    const tags = [];
    if (selectedSite) tags.push(SITE_LABEL[selectedSite]);
    if (showOnlyLowStock) tags.push('ต่ำกว่าระดับเตือน');
    if (showOnlyNearStock) tags.push('ใกล้หมด');
    const lines = rows.slice(0, MAX).map((s, i) => {
        const unit = normalizeUnit(s.unit, 'ชิ้น');
        return (i + 1) + '. ' + (s.product_name || '-') + (s.product_code ? ' [' + s.product_code + ']' : '')
            + ' — เหลือ ' + (Number(s.quantity) || 0).toLocaleString('th-TH') + ' ' + unit
            + ' (เตือนที่ ' + getReorderPoint(s) + ')' + (s.storage_location ? ' · ช่อง ' + s.storage_location : '');
    });
    const text = ['รายการวัสดุ' + (tags.length ? ' · ' + tags.join(' · ') : '') + ' — '
            + rows.length.toLocaleString('th-TH') + ' รายการ · ' + new Date().toLocaleDateString('th-TH')]
        .concat(lines)
        .concat(rows.length > MAX ? ['… และอีก ' + (rows.length - MAX).toLocaleString('th-TH') + ' รายการ (กรองให้แคบลงก่อนคัดลอก)'] : [])
        .join('\n');
    let ok = false;
    try {
        await navigator.clipboard.writeText(text);
        ok = true;
    } catch (e) {
        // เครื่อง/เบราว์เซอร์เก่าไม่ให้ใช้คลิปบอร์ดแบบใหม่ → คัดลอกแบบเดิม
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
    }
    showToast(ok ? '📋 คัดลอกแล้ว ' + Math.min(rows.length, MAX).toLocaleString('th-TH') + ' รายการ — วางใน LINE ได้เลย'
                 : '❌ คัดลอกไม่สำเร็จ ลองอีกครั้ง', ok ? 'success' : 'error');
}

function selectCategoryTab(element, category) {
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    element.classList.add('active');
    selectedCategory = category;
    currentStockPage = 1;
    renderStockTable();
}

function getFiltered() {
    const term = (document.getElementById('searchInput')?.value || '').toLowerCase();
    return allStocks.filter(s => {
        const matchName = s.product_name?.toLowerCase().includes(term) ||
                          (s.product_code || '').toLowerCase().includes(term) ||
                          (s.storage_location || '').toLowerCase().includes(term);
        
        const matchCat = !selectedCategory || (selectedCategory === 'general'
            ? s.category === 'general' || s.category === 'tools'
            : s.category === selectedCategory);
        
        const level = getStockLevel(s);
        const isLow = level === 'low';
        const isNear = level === 'near';
        const matchLow = !showOnlyLowStock || isLow;
        const matchNear = !showOnlyNearStock || isNear;
        
        return matchName && matchCat && matchLow && matchNear && inSelectedSite(s);
    });
}

// ─── BUILD SINGLE ROW HTML ────────────────────────────────────────────────
function buildRow(stock) {
    const stockLevel = getStockLevel(stock);
    const isLow = stockLevel === 'low';
    const isNear = stockLevel === 'near';
    const size  = (stock.width && stock.height)
        ? `${stock.width} × ${stock.height}`
        : (stock.width || stock.height || '—');
    const rowClass = isLow ? 'row-low' : (isNear ? 'row-near' : '');
    const qtyClass = isLow ? 'qty-low' : (isNear ? 'qty-near' : 'qty-ok');

    return `
    <tr class="${rowClass}" data-id="${stock.id}">
        <td>${getCategoryLabel(stock.category)}</td>
        <td>
            <div class="product-name">${stock.product_name}</div>
            ${stock.product_code ? `<div class="product-code">${stock.product_code}</div>` : ''}
        </td>
        <td>
            <div class="location-editor">
                <span class="location-symbol">📍</span>
                <input type="text" maxlength="60" value="${escAttr(stock.storage_location || '')}"
                    data-original-value="${escAttr(stock.storage_location || '')}"
                    placeholder="เช่น A01"
                    aria-label="ช่องเก็บของ ${escAttr(stock.product_name)}"
                    oninput="markLocationDirty(this)"
                    onkeydown="handleLocationKeyDown(event, '${stock.id}', this)">
                <button type="button" disabled
                    onclick="saveLocation('${stock.id}', this.parentElement.querySelector('input'), this)"
                    title="แก้ช่องเก็บก่อนจึงจะบันทึกได้">✓</button>
            </div>
        </td>
        <td style="text-align: right; padding-right: 2rem;">
            <span class="qty-value ${qtyClass}">${stock.quantity}</span>
        </td>
        <td style="color:#64748b;">${normalizeUnit(stock.unit, '—')}</td>
        <td>
            <div class="reorder-point-editor">
                <span class="reorder-symbol">≤</span>
                <input type="number" min="0" step="1" value="${getReorderPoint(stock)}"
                    data-original-value="${getReorderPoint(stock)}"
                    aria-label="ระดับแจ้งเตือนของ ${stock.product_name}"
                    oninput="markReorderPointDirty(this)"
                    onkeydown="handleReorderPointKeyDown(event, '${stock.id}', this)">
                <span class="reorder-unit">${normalizeUnit(stock.unit, 'ชิ้น')}</span>
                <button type="button" disabled
                    onclick="saveReorderPoint('${stock.id}', this.parentElement.querySelector('input'), this)"
                    title="แก้ตัวเลขก่อนจึงจะบันทึกได้">✓</button>
            </div>
        </td>
        <td>
            <div class="near-stock-point-editor">
                <span class="near-stock-symbol">&gt;</span>
                <span class="near-stock-lower">${getReorderPoint(stock)}</span>
                <span class="near-stock-symbol">ถึง</span>
                <input type="number" min="${getReorderPoint(stock) + 1}" step="1" value="${getNearStockPoint(stock)}"
                    data-original-value="${getNearStockPoint(stock)}"
                    aria-label="ระดับสินค้าใกล้หมดของ ${stock.product_name}"
                    oninput="markNearStockPointDirty(this)"
                    onkeydown="handleNearStockPointKeyDown(event, '${stock.id}', this)">
                <span class="near-stock-unit">${normalizeUnit(stock.unit, 'ชิ้น')}</span>
                <button type="button" disabled
                    onclick="saveNearStockPoint('${stock.id}', this.parentElement.querySelector('input'), this)"
                    title="แก้ตัวเลขก่อนจึงจะบันทึกได้">✓</button>
            </div>
        </td>
        <td style="color:#64748b; font-size:0.85rem;">${size}</td>
        <td>
            <div class="qty-adjust-group" style="display: inline-flex; align-items: center; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; padding: 2px;">
                ${window.auth?.hasPermission?.('action_decrease_stock') === true
                    ? `<button type="button" class="sign-toggle-btn" onclick="toggleSignBtn(this)" style="background: rgba(16, 185, 129, 0.15); border: none; color: #10b981; min-width: 30px; height: 28px; font-weight: bold; cursor: pointer; border-radius: 5px; font-family: monospace; transition: all 0.2s; font-size: 1rem; display: flex; align-items: center; justify-content: center; line-height: 1;" data-sign="+">+</button>`
                    : `<button type="button" class="sign-toggle-btn" style="background: rgba(16, 185, 129, 0.15); border: none; color: #10b981; min-width: 30px; height: 28px; font-weight: bold; cursor: not-allowed; border-radius: 5px; font-family: monospace; font-size: 1rem; display: flex; align-items: center; justify-content: center; line-height: 1;" data-sign="+" title="CEO ยังไม่ได้ให้สิทธิ์ปรับสต็อกลดลง" disabled>+</button>`
                }
                <input class="quick-qty-input-new" type="number" min="1" step="1" inputmode="numeric" enterkeyhint="done" placeholder="0" aria-label="จำนวนที่จะปรับของ ${escAttr(stock.product_name)}" oninput="markQuickQtyDirty(this)" onkeydown="handleNewQuickQtyKeyDown(event, '${stock.id}', this)" style="border: none; background: transparent; width: 50px; color: var(--text); font-size: 0.9rem; text-align: center; padding: 0.3rem 0.2rem; outline: none; -moz-appearance: textfield;" title="ใส่จำนวนแล้วกด ✓ (หรือ Enter) เพื่อปรับสต็อก">
                <button type="button" class="quick-qty-save" disabled onclick="submitQuickQty('${stock.id}', this.parentElement.querySelector('.quick-qty-input-new'), this)" title="ใส่จำนวนก่อนจึงจะกดได้">✓</button>
            </div>
        </td>
        <td>
            ${isLow
                ? `<span class="badge-low">⚠️ ต่ำ</span>`
                : (isNear
                    ? `<span class="badge-near">🟠 ใกล้หมด</span>`
                    : `<span class="badge-ok">✅ เพียงพอ</span>`)}
        </td>
    </tr>`;
}

function renderStockTable() {
    const tbody = document.getElementById('stockTableBody');
    const emptyState = document.getElementById('emptyState');
    const meta = document.getElementById('stockTableMeta');
    const pagination = document.getElementById('stockPagination');
    const stocks = getSorted(getFiltered());
    const totalRows = stocks.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / STOCK_RENDER_PAGE_SIZE));
    currentStockPage = Math.min(currentStockPage, totalPages);
    currentStockPage = Math.max(1, currentStockPage);
    const startIndex = (currentStockPage - 1) * STOCK_RENDER_PAGE_SIZE;
    const visibleRows = stocks.slice(startIndex, startIndex + STOCK_RENDER_PAGE_SIZE);

    if (totalRows === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        if (meta) meta.textContent = 'ไม่พบข้อมูล';
        if (pagination) pagination.innerHTML = '';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = visibleRows.map(buildRow).join('');
    if (meta) {
        meta.textContent = `แสดง ${startIndex + 1}-${startIndex + visibleRows.length} จาก ${totalRows} รายการ`;
    }
    renderStockPagination(totalPages);
}

function goToStockPage(page) {
    currentStockPage = page;
    renderStockTable();
}

function renderStockPagination(totalPages) {
    const pagination = document.getElementById('stockPagination');
    if (!pagination) return;

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    const pages = [];
    const startPage = Math.max(1, currentStockPage - 2);
    const endPage = Math.min(totalPages, currentStockPage + 2);

    pages.push(`
        <button class="pagination-btn" ${currentStockPage === 1 ? 'disabled' : ''}
            onclick="goToStockPage(${currentStockPage - 1})">ก่อนหน้า</button>
    `);

    for (let page = startPage; page <= endPage; page += 1) {
        pages.push(`
            <button class="pagination-page ${page === currentStockPage ? 'active' : ''}"
                onclick="goToStockPage(${page})">${page}</button>
        `);
    }

    pages.push(`
        <button class="pagination-btn" ${currentStockPage === totalPages ? 'disabled' : ''}
            onclick="goToStockPage(${currentStockPage + 1})">ถัดไป</button>
    `);

    pagination.innerHTML = pages.join('');
}

function handleReorderPointKeyDown(event, id, input) {
    if (event.key === 'Enter' && input.value !== input.dataset.originalValue) {
        event.preventDefault();
        saveReorderPoint(id, input, input.parentElement.querySelector('button'));
    }
}

function markReorderPointDirty(input) {
    const editor = input.closest('.reorder-point-editor');
    const button = editor.querySelector('button');
    const isDirty = input.value !== input.dataset.originalValue;
    editor.classList.toggle('is-dirty', isDirty);
    button.disabled = !isDirty;
    button.title = isDirty ? 'บันทึกระดับแจ้งเตือนใหม่' : 'ยังไม่มีการเปลี่ยนแปลง';
}

async function saveReorderPoint(id, input, button) {
    const stock = allStocks.find(item => item.id === id);
    if (!stock) return;

    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0) {
        showToast('⚠️ ระดับแจ้งเตือนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป', 'warning');
        input.focus();
        return;
    }
    if (value >= getNearStockPoint(stock)) {
        showToast(`⚠️ จุดแจ้งเตือนต้องน้อยกว่าระดับใกล้หมด (${getNearStockPoint(stock)})`, 'warning');
        input.focus();
        return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '…';

    try {
        const { error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .update({ reorder_point: value, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        stock.reorder_point = value;
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr) tr.outerHTML = buildRow(stock);
        updateStatistics();
        showToast(`✅ ตั้งค่าแจ้งเตือน ${stock.product_name} ที่ ${value} ${normalizeUnit(stock.unit, 'ชิ้น')}`, 'success');
    } catch (err) {
        button.disabled = false;
        button.textContent = originalText;
        showToast('❌ บันทึกระดับแจ้งเตือนไม่สำเร็จ: ' + err.message, 'error');
    }
}

// ─── ช่องเก็บวัสดุ (storage_location) — บอกพนักงานเตรียมวัสดุว่าต้องไปหยิบช่องไหน ──
function escAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// รูปแบบช่องเก็บ = ชั้นใหญ่ (ตัวอักษร) + ชั้นย่อย (เลข 2 หลัก) เช่น A01 = ชั้น A ชั้นย่อย 01
// พิมพ์แบบไหนก็ได้ ระบบจัดให้: a1 / A-1 / a 01 → A01 · หลายช่องคั่นด้วย , → "A01, A02"
// ชื่อที่ไม่ตรงรูปแบบ (เช่น ชั้นกระจก) เก็บตามที่พิมพ์ แค่ทำตัวอังกฤษเป็นตัวใหญ่
function normalizeLocation(value) {
    return String(value || '').split(/[,，]/).map(part => {
        const p = part.replace(/\s+/g, ' ').trim().toUpperCase();
        const m = p.match(/^([A-Z]+)\s*-?\s*0*(\d{1,3})$/);
        return m ? m[1] + m[2].padStart(2, '0') : p;
    }).filter(Boolean).join(', ');
}

function describeLocation(value) {
    return value.split(', ').map(code => {
        const m = code.match(/^([A-Z]+)(\d+)$/);
        return m ? `ชั้น ${m[1]} ช่อง ${code}` : code;
    }).join(' และ ');
}

function handleLocationKeyDown(event, id, input) {
    if (event.key === 'Enter' && input.value !== input.dataset.originalValue) {
        event.preventDefault();
        saveLocation(id, input, input.parentElement.querySelector('button'));
    }
}

function markLocationDirty(input) {
    const editor = input.closest('.location-editor');
    const button = editor.querySelector('button');
    const isDirty = input.value !== input.dataset.originalValue;
    editor.classList.toggle('is-dirty', isDirty);
    button.disabled = !isDirty;
    button.title = isDirty ? 'บันทึกช่องเก็บใหม่' : 'ยังไม่มีการเปลี่ยนแปลง';
}

async function saveLocation(id, input, button) {
    const stock = allStocks.find(item => item.id === id);
    if (!stock) return;

    const value = normalizeLocation(input.value) || null;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '…';

    try {
        const { error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .update({ storage_location: value, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        stock.storage_location = value;
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr) tr.outerHTML = buildRow(stock);
        showToast(value
            ? `📍 ${stock.product_name} เก็บที่${describeLocation(value)}`
            : `📍 ล้างช่องเก็บของ ${stock.product_name} แล้ว`, 'success');
    } catch (err) {
        button.disabled = false;
        button.textContent = originalText;
        showToast('❌ บันทึกช่องเก็บไม่สำเร็จ: ' + err.message, 'error');
    }
}

function handleNearStockPointKeyDown(event, id, input) {
    if (event.key === 'Enter' && input.value !== input.dataset.originalValue) {
        event.preventDefault();
        saveNearStockPoint(id, input, input.parentElement.querySelector('button'));
    }
}

function markNearStockPointDirty(input) {
    const editor = input.closest('.near-stock-point-editor');
    const button = editor.querySelector('button');
    const isDirty = input.value !== input.dataset.originalValue;
    editor.classList.toggle('is-dirty', isDirty);
    button.disabled = !isDirty;
    button.title = isDirty ? 'บันทึกระดับใกล้หมดใหม่' : 'ยังไม่มีการเปลี่ยนแปลง';
}

async function saveNearStockPoint(id, input, button) {
    const stock = allStocks.find(item => item.id === id);
    if (!stock) return;

    const value = Number(input.value);
    const reorderPoint = getReorderPoint(stock);
    if (!Number.isInteger(value) || value <= reorderPoint) {
        showToast(`⚠️ ระดับใกล้หมดต้องเป็นจำนวนเต็มที่มากกว่าจุดแจ้งเตือน (${reorderPoint})`, 'warning');
        input.focus();
        return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '…';

    try {
        const { error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .update({ near_stock_point: value, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        stock.near_stock_point = value;
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr) tr.outerHTML = buildRow(stock);
        updateStatistics();
        showToast(`✅ ตั้งค่าระดับใกล้หมด ${stock.product_name} ถึง ${value} ${normalizeUnit(stock.unit, 'ชิ้น')}`, 'success');
    } catch (err) {
        button.disabled = false;
        button.textContent = originalText;
        showToast('❌ บันทึกระดับใกล้หมดไม่สำเร็จ: ' + err.message, 'error');
    }
}



// ─── QUICK ADJUST QTY ─────────────────────────────────────────────────────
function toggleSignBtn(btn) {
    if (window.auth?.hasPermission?.('action_decrease_stock') !== true) {
        showToast('🔒 CEO ยังไม่ได้ให้สิทธิ์ปรับสต็อกลดลง', 'warning');
        return;
    }
    const curSign = btn.getAttribute('data-sign');
    if (curSign === '+') {
        btn.setAttribute('data-sign', '-');
        btn.textContent = '-';
        btn.style.background = 'rgba(239, 68, 68, 0.15)';
        btn.style.color = '#ef4444';
    } else {
        btn.setAttribute('data-sign', '+');
        btn.textContent = '+';
        btn.style.background = 'rgba(16, 185, 129, 0.15)';
        btn.style.color = '#10b981';
    }
}

// ปุ่ม ✓ ข้างช่องจำนวน: กดได้เมื่อใส่จำนวนมากกว่า 0
function markQuickQtyDirty(inputEl) {
    const btn = inputEl.parentElement && inputEl.parentElement.querySelector('.quick-qty-save');
    if (!btn) return;
    const ok = Number(inputEl.value) > 0;
    btn.disabled = !ok || inputEl.disabled;
    btn.title = ok ? 'กดเพื่อปรับสต็อก' : 'ใส่จำนวนก่อนจึงจะกดได้';
}

async function handleNewQuickQtyKeyDown(e, id, inputEl) {
    if (e.key === 'Enter') {
        e.preventDefault();
        await submitQuickQty(id, inputEl, null);
    }
}

// ปรับจำนวนด่วน — กด Enter (คอม) หรือปุ่ม ✓ (มือถือ: แป้นตัวเลข iPhone ไม่มีปุ่ม Enter
// ปุ่ม "เสร็จสิ้น" แค่ปิดแป้น เดิมเลยบันทึกไม่ได้ — เจ้าของแจ้ง 17/11/2569)
async function submitQuickQty(id, inputEl, btn) {
    if (!inputEl || inputEl.disabled) return;
    const val = inputEl.value.trim();
    if (!val) return;

    const qty = parseInt(val);
    if (isNaN(qty) || qty <= 0) {
        showToast('⚠️ กรุณากรอกจำนวนตัวเลขที่มากกว่า 0', 'warning');
        return;
    }

    // Find the sign sibling button
    const group = inputEl.closest('.qty-adjust-group');
    const toggleBtn = group.querySelector('.sign-toggle-btn');
    const sign = toggleBtn.getAttribute('data-sign') || '+';
    const delta = sign === '-' ? -qty : qty;

    const saveBtn = btn || group.querySelector('.quick-qty-save');
    inputEl.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
        await quickAdjust(id, delta);
    } finally {
        inputEl.disabled = false;
        inputEl.value = '';
        markQuickQtyDirty(inputEl);
        if (!btn && inputEl.isConnected) inputEl.focus();
    }
}

async function logStockMovement(itemId, itemName, oldQty, newQty, delta, userName, reason) {
    try {
        const { error } = await dbSupabase
            .from('stock_movement_log')
            .insert([{
                item_id:   itemId,
                item_name: itemName,
                old_qty:   oldQty,
                new_qty:   newQty,
                operator:  String(userName || '').trim(),
                reason:    reason ? reason.trim() : null
            }]);
        if (error) {
            console.error('Error logging movement:', error);
            showToast('⚠️ ไม่สามารถบันทึกประวัติลง stock_movement_log ได้', 'warning');
        }
    } catch (err) {
        console.error('Catch error logging movement:', err);
    }
}

async function getLoggedInUserEmail() {
    if (!dbSupabase) return 'unknown';

    try {
        const { data: { session } } = await dbSupabase.auth.getSession();
        return session?.user?.email || 'unknown';
    } catch (err) {
        console.warn('ไม่สามารถอ่าน session ของผู้ใช้ได้:', err);
        return 'unknown';
    }
}

async function quickAdjust(id, delta) {
    const stock = allStocks.find(s => s.id === id);
    if (!stock) return;

    if (delta < 0 && window.auth?.hasPermission?.('action_decrease_stock') !== true) {
        showToast('🔒 CEO ยังไม่ได้ให้สิทธิ์ปรับสต็อกลดลง', 'warning');
        return;
    }

    // ต้องเลือกเหตุผล + ใส่ชื่อคนลง · กล่องนี้บันทึกยอด+ประวัติให้ในขั้นเดียว (ปิดกล่อง = ยกเลิก)
    const res = await openAdjDialog(stock, delta);
    if (!res) {
        showToast('⚠️ ยกเลิกการปรับจำนวน', 'warning');
        return;
    }
    applyAdjResult(stock, res, delta);
}

// ─── ปรับยอดด้วยมือ: ต้องเลือกเหตุผล + ใส่ชื่อคนลงทุกครั้ง (19/11/2569) ──────
// เจ้าของ: "ถ้าลงของผิด มีระบบป้องกันไหม" → เดิมกด OK เปล่าได้ ประวัติว่าง 1,600+ รายการ ไม่รู้ใครลง
// บัญชีเดียวใช้หลายคน (เช่น mgstore) → ต้องใส่ชื่อคนลง (จำไว้ในเครื่อง ไม่ต้องพิมพ์ใหม่ทุกครั้ง)
// ปรับยอด + บันทึกประวัติทำในขั้นเดียวที่ฐานข้อมูล (rpc_stock_manual_adjust) · ลดเกินที่มี = ไม่ให้ลง (เดิมปัดเป็น 0 เงียบ ๆ)
// กดบันทึกซ้ำ / เน็ตหลุดแล้วกดใหม่ ใช้รหัสเดิม → ไม่บวกซ้ำ
const ADJ_TYPES = [
    { key: 'receive', icon: '📥', label: 'รับของเข้า',     hint: 'ของจากโรงงานตัด / ซื้อมา',  sign: 1 },
    { key: 'issue',   icon: '📤', label: 'เบิกออก',        hint: 'ไม่ผ่านใบผลิต',             sign: -1 },
    { key: 'count',   icon: '🔢', label: 'นับจริงไม่ตรง',  hint: 'ปรับให้ตรงของจริง',         sign: 0 },
    { key: 'damage',  icon: '💥', label: 'ของเสีย/หาย',    hint: 'ชำรุด ตัดเสีย หาย',         sign: -1 },
    { key: 'correct', icon: '✏️', label: 'แก้ที่ลงผิด',     hint: 'ต้องพิมพ์ว่าผิดตรงไหน',      sign: 0, needNote: true },
    { key: 'other',   icon: '📝', label: 'อื่น ๆ',          hint: 'ต้องพิมพ์เหตุผล',           sign: 0, needNote: true }
];
const ADJ_NAME_KEY = 'ccga_stock_entered_by';
const ADJ_REUSE_MS = 30 * 60 * 1000;   // ลงหลายรายการติดกัน: ใช้เหตุผลเดิมให้ภายใน 30 นาที
let adjLast = null;                    // { type, note, sign, at }
let adjState = null;                   // กล่องที่เปิดอยู่
let adjNamesLoaded = false;

function newAdjKey() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function adjErrText(err) {
    const msg = String((err && (err.message || err.details)) || err || '');
    if (/Could not find the function|PGRST202|function .* does not exist/i.test(msg)) {
        return 'ฐานข้อมูลยังไม่ได้อัปเดต (ต้องรันไฟล์ SQL ก่อน) — แจ้งเจ้าของระบบ';
    }
    if (/Failed to fetch|NetworkError|network|timeout|timed out|aborted|Load failed/i.test(msg)) {
        return 'เน็ตหลุด/ช้า — กดบันทึกอีกครั้งได้ ระบบไม่บวกซ้ำ';
    }
    return msg || 'ไม่ทราบสาเหตุ';
}

function readAdjName() {
    try { return localStorage.getItem(ADJ_NAME_KEY) || ''; } catch (e) { return ''; }
}
function saveAdjName(name) {
    try { localStorage.setItem(ADJ_NAME_KEY, name); } catch (e) {}
}

// รายชื่อคนที่เคยลง (ไว้เลือก ไม่ต้องพิมพ์ · ชื่อจะได้สะกดตรงกัน รายงานรายคนถึงจะนับถูก)
async function loadAdjNames() {
    if (adjNamesLoaded || !dbSupabase) return;
    adjNamesLoaded = true;
    try {
        const { data, error } = await dbSupabase
            .from('stock_movement_log')
            .select('entered_by')
            .not('entered_by', 'is', null)
            .order('id', { ascending: false })
            .limit(500);
        if (error) throw error;
        const names = [...new Set((data || []).map(r => String(r.entered_by || '').trim()).filter(Boolean))].slice(0, 40);
        const list = document.getElementById('adjNameList');
        if (list) list.innerHTML = names.map(n => `<option value="${escAttr(n)}"></option>`).join('');
    } catch (e) {
        adjNamesLoaded = false;   // ฐานข้อมูลยังไม่มีช่องชื่อ → ลองใหม่ครั้งหน้า
    }
}

function ensureAdjDialog() {
    if (document.getElementById('adjModal')) return;
    const style = document.createElement('style');
    style.id = 'adjModalStyle';
    style.textContent = `
        #adjModal .modal-content { max-width: 460px; }
        #adjModal .adj-item { font-weight: 600; font-size: 1.05rem; color: var(--text); line-height: 1.35; }
        #adjModal .adj-code { color: var(--muted); font-size: 0.82rem; margin-top: 2px; word-break: break-all; }
        #adjModal .adj-calc { margin: 0.75rem 0 0.25rem; padding: 0.6rem 0.8rem; border-radius: 10px; background: var(--bg-card-strong);
            border: 1px solid var(--border); font-size: 1.05rem; display: flex; flex-wrap: wrap; gap: 0.35rem 0.6rem; align-items: baseline; }
        #adjModal .adj-calc b { font-size: 1.25rem; }
        #adjModal .adj-plus { color: #10b981; font-weight: 700; }
        #adjModal .adj-minus { color: #ef4444; font-weight: 700; }
        #adjModal .adj-lbl { display: block; margin: 0.9rem 0 0.4rem; font-size: 0.9rem; color: var(--muted); }
        #adjModal .adj-lbl em { color: #ef4444; font-style: normal; }
        #adjModal .adj-types { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
        #adjModal .adj-type { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; cursor: pointer;
            padding: 0.55rem 0.65rem; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-card-strong);
            color: var(--text); font-family: 'Kanit', sans-serif; font-size: 0.95rem; line-height: 1.25; min-height: 52px; }
        #adjModal .adj-type small { color: var(--muted); font-size: 0.74rem; }
        #adjModal .adj-type.sel { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-glow); background: var(--surface-strong, rgba(99,102,241,.08)); }
        #adjModal input[type=text] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid var(--border);
            background: var(--input-bg); color: var(--text); font-family: 'Kanit', sans-serif; font-size: 1rem; }
        #adjModal input[type=text]:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-glow); }
        #adjModal .adj-reuse { margin-top: 0.4rem; font-size: 0.8rem; color: var(--muted); }
        #adjModal .adj-err { display: none; margin-top: 0.8rem; padding: 0.55rem 0.75rem; border-radius: 8px; font-size: 0.9rem;
            background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); white-space: pre-line; }
        #adjModal .adj-err.show { display: block; }
        #adjModal .adj-namehint { margin-top: 0.3rem; font-size: 0.78rem; color: var(--muted); }
        @media (max-width: 480px) { #adjModal .modal-content { padding: 1.1rem; } #adjModal .adj-type { min-height: 48px; } }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'adjModal';
    wrap.className = 'modal';
    wrap.innerHTML = `
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="adjTitle">
            <div class="modal-header">
                <h2 id="adjTitle">📝 ปรับยอดสต็อก</h2>
                <button type="button" class="close-btn" onclick="closeAdjDialog()" aria-label="ปิด">✕</button>
            </div>
            <div class="adj-item" id="adjItem"></div>
            <div class="adj-code" id="adjCode"></div>
            <div class="adj-calc" id="adjCalc"></div>
            <span class="adj-lbl">เหตุผล <em>*</em></span>
            <div class="adj-types" id="adjTypes"></div>
            <div class="adj-reuse" id="adjReuse"></div>
            <label class="adj-lbl" for="adjNote" id="adjNoteLbl">รายละเอียด</label>
            <input type="text" id="adjNote" maxlength="300" autocomplete="off">
            <label class="adj-lbl" for="adjName">ชื่อคนลง <em>*</em></label>
            <input type="text" id="adjName" maxlength="60" list="adjNameList" autocomplete="off" placeholder="ชื่อเล่นก็ได้ เช่น เมย์">
            <datalist id="adjNameList"></datalist>
            <div class="adj-namehint">เครื่องนี้จะจำชื่อไว้ · คนอื่นมาใช้เครื่องนี้ ให้เปลี่ยนชื่อก่อนบันทึก</div>
            <div class="adj-err" id="adjErr"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-cancel" onclick="closeAdjDialog()">ยกเลิก</button>
                <button type="button" class="btn btn-save" id="adjSave" onclick="submitAdjDialog()">💾 บันทึก</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) closeAdjDialog(); });
    wrap.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); closeAdjDialog(); }
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submitAdjDialog(); }
    });
    document.getElementById('adjNote').addEventListener('input', () => setAdjError(''));
    document.getElementById('adjName').addEventListener('input', () => setAdjError(''));
}

function setAdjError(msg) {
    const el = document.getElementById('adjErr');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
}

function renderAdjTypes() {
    const sign = adjState.delta > 0 ? 1 : -1;
    const box = document.getElementById('adjTypes');
    box.innerHTML = ADJ_TYPES.filter(t => t.sign === 0 || t.sign === sign).map(t => `
        <button type="button" class="adj-type${adjState.type === t.key ? ' sel' : ''}" data-type="${t.key}" onclick="pickAdjType('${t.key}')">
            <span>${t.icon} ${t.label}</span><small>${t.hint}</small>
        </button>`).join('');
    const t = ADJ_TYPES.find(x => x.key === adjState.type);
    const note = document.getElementById('adjNote');
    const lbl = document.getElementById('adjNoteLbl');
    if (t && t.needNote) {
        lbl.innerHTML = 'รายละเอียด <em>*</em>';
        note.placeholder = t.key === 'correct' ? 'เช่น เมื่อวานลงเกินไป 30 ท่อน' : 'พิมพ์เหตุผล';
    } else {
        lbl.textContent = 'รายละเอียด (ถ้ามี)';
        note.placeholder = t && t.key === 'receive' ? 'เช่น เลขใบ CO-189 / เลขบิล' : 'ถ้ามี เช่น ใช้ทำอะไร / ใครเบิก';
    }
}

function pickAdjType(key) {
    if (!adjState) return;
    adjState.type = key;
    document.getElementById('adjReuse').textContent = '';
    setAdjError('');
    renderAdjTypes();
    const t = ADJ_TYPES.find(x => x.key === key);
    const note = document.getElementById('adjNote');
    const name = document.getElementById('adjName');
    if (t && t.needNote && note.value.trim().length < 3) note.focus();
    else if (!name.value.trim()) name.focus();
}

// เปิดกล่องเหตุผล → บันทึกที่ฐานข้อมูล → คืนผล ({ quantity, new_qty, duplicate, ... }) หรือ null ถ้ายกเลิก
// opts.defaultType / opts.defaultNote = ค่าเริ่ม (เช่น สินค้าใหม่ใส่ยอดเริ่มต้น)
function openAdjDialog(stock, delta, opts = {}) {
    ensureAdjDialog();
    if (adjState) closeAdjDialog();
    const sign = delta > 0 ? 1 : -1;
    const reuse = adjLast && adjLast.sign === sign && (Date.now() - adjLast.at) < ADJ_REUSE_MS
        && ADJ_TYPES.some(t => t.key === adjLast.type && (t.sign === 0 || t.sign === sign));
    return new Promise(resolve => {
        adjState = {
            stock, delta, resolve, busy: false, key: newAdjKey(),
            type: opts.defaultType || (reuse ? adjLast.type : null)
        };
        const unit = normalizeUnit(stock.unit, 'ชิ้น');
        const oldQty = Number(stock.quantity) || 0;
        const after = oldQty + delta;
        document.getElementById('adjTitle').textContent = delta > 0 ? '📥 เพิ่มยอดสต็อก' : '📤 ลดยอดสต็อก';
        document.getElementById('adjItem').textContent = stock.product_name || '';
        document.getElementById('adjCode').textContent = stock.product_code || '';
        document.getElementById('adjCalc').innerHTML =
            `<span>มีอยู่ <b>${oldQty.toLocaleString('th-TH')}</b></span>`
            + `<span class="${delta > 0 ? 'adj-plus' : 'adj-minus'}">${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('th-TH')}</span>`
            + `<span>→ เหลือ <b${after < 0 ? ' style="color:#ef4444"' : ''}>${after.toLocaleString('th-TH')}</b> ${escAttr(unit)}</span>`;
        document.getElementById('adjNote').value = opts.defaultNote != null ? opts.defaultNote : (reuse ? adjLast.note : '');
        document.getElementById('adjName').value = readAdjName();
        document.getElementById('adjReuse').textContent = (reuse && !opts.defaultType)
            ? '↺ ใช้เหตุผลเดียวกับรายการก่อนหน้า — ถ้าไม่ใช่ กดเลือกใหม่' : '';
        setAdjError(after < 0 ? `ลดเกินที่มี — มีอยู่ ${oldQty} ลดได้ไม่เกิน ${oldQty}` : '');
        const save = document.getElementById('adjSave');
        save.disabled = after < 0;
        save.textContent = '💾 บันทึก';
        renderAdjTypes();
        document.getElementById('adjModal').classList.add('active');
        loadAdjNames();
        setTimeout(() => {
            const name = document.getElementById('adjName');
            const t = ADJ_TYPES.find(x => x.key === adjState?.type);
            if (!adjState?.type) document.querySelector('#adjTypes .adj-type')?.focus();
            else if (t && t.needNote && document.getElementById('adjNote').value.trim().length < 3) document.getElementById('adjNote').focus();
            else if (!name.value.trim()) name.focus();
            else save.focus();
        }, 60);
    });
}

function closeAdjDialog(result = null) {
    const modal = document.getElementById('adjModal');
    if (modal) modal.classList.remove('active');
    const st = adjState;
    adjState = null;
    if (st) st.resolve(result);
}

async function submitAdjDialog() {
    const st = adjState;
    if (!st || st.busy) return;
    const t = ADJ_TYPES.find(x => x.key === st.type);
    const note = document.getElementById('adjNote').value.replace(/\s+/g, ' ').trim();
    const name = document.getElementById('adjName').value.replace(/\s+/g, ' ').trim();
    if (!t) { setAdjError('กรุณาเลือกเหตุผล'); return; }
    if (t.needNote && note.length < 3) { setAdjError(`"${t.label}" ต้องพิมพ์รายละเอียดด้วย (อย่างน้อย 3 ตัวอักษร)`); document.getElementById('adjNote').focus(); return; }
    if (name.length < 2) { setAdjError('กรุณาใส่ชื่อคนลง'); document.getElementById('adjName').focus(); return; }
    st.busy = true;
    const save = document.getElementById('adjSave');
    save.disabled = true;
    save.textContent = '⏳ กำลังบันทึก...';
    setAdjError('');
    try {
        const { data, error } = await dbSupabase.rpc('rpc_stock_manual_adjust', {
            p_item_id: st.stock.id, p_delta: st.delta, p_type: t.key,
            p_note: note || null, p_entered_by: name, p_key: st.key
        });
        if (error) throw error;
        saveAdjName(name);
        adjLast = { type: t.key, note, sign: st.delta > 0 ? 1 : -1, at: Date.now() };
        st.busy = false;
        closeAdjDialog(data || {});
    } catch (err) {
        st.busy = false;
        if (adjState !== st) return;
        setAdjError('❌ บันทึกไม่สำเร็จ: ' + adjErrText(err));
        save.disabled = false;
        save.textContent = '💾 บันทึกอีกครั้ง';
    }
}

// หลังบันทึกสำเร็จ: ใช้ยอดจากฐานข้อมูล (ไม่ใช่ตัวเลขในเครื่องที่อาจเก่า)
function applyAdjResult(stock, res, delta) {
    const qty = Number(res && (res.quantity ?? res.new_qty));
    if (Number.isFinite(qty)) stock.quantity = qty;
    const tr = document.querySelector(`tr[data-id="${stock.id}"]`);
    if (tr) tr.outerHTML = buildRow(stock);
    else renderStockTable();
    updateStatistics();
    scheduleMovementLogsReload();
    if (res && res.duplicate) {
        showToast(`ℹ️ ${stock.product_name}: รายการนี้บันทึกไปแล้ว (ไม่บวกซ้ำ) → ${stock.quantity}`, 'info');
    } else {
        showToast(`✅ ${stock.product_name}: ${delta > 0 ? '+' : ''}${delta} → ${stock.quantity} ${normalizeUnit(stock.unit, 'ชิ้น')}`, delta > 0 ? 'success' : 'warning');
    }
}


// ─── SEARCH & FILTER ──────────────────────────────────────────────────────
function searchStocks() {
    clearTimeout(stockSearchDebounceTimer);
    stockSearchDebounceTimer = setTimeout(() => {
        currentStockPage = 1;
        renderStockTable();
    }, 180);
}

function toggleLowStockFilter(active) {
    showOnlyLowStock = active;
    if (active) {
        showOnlyNearStock = false;
        syncNearStockFilterUi();
    }
    
    // Sync checkbox
    const checkbox = document.getElementById('lowStockCheckbox');
    if (checkbox) checkbox.checked = active;
    
    // Sync card style
    const card = document.getElementById('lowStockCard');
    if (card) {
        card.classList.toggle('selected', active);
    }
    
    // Sync label styling
    const label = document.getElementById('lowStockLabel');
    if (label) {
        if (active) {
            label.style.background = 'rgba(239, 68, 68, 0.2)';
            label.style.borderColor = 'var(--red)';
        } else {
            label.style.background = 'rgba(239, 68, 68, 0.08)';
            label.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        }
    }
    
    currentStockPage = 1;
    renderStockTable();
}

function toggleLowStockFilterFromCard() {
    toggleLowStockFilter(!showOnlyLowStock);
}

function syncNearStockFilterUi() {
    const checkbox = document.getElementById('nearStockCheckbox');
    if (checkbox) checkbox.checked = showOnlyNearStock;
    const card = document.getElementById('nearStockCard');
    if (card) card.classList.toggle('selected', showOnlyNearStock);
    const label = document.getElementById('nearStockLabel');
    if (label) {
        label.style.background = showOnlyNearStock
            ? 'rgba(245, 158, 11, 0.2)'
            : 'rgba(245, 158, 11, 0.1)';
        label.style.borderColor = showOnlyNearStock
            ? '#f59e0b'
            : 'rgba(245, 158, 11, 0.3)';
    }
}

function toggleNearStockFilter(active) {
    showOnlyNearStock = active;
    if (active) {
        showOnlyLowStock = false;
        const lowCheckbox = document.getElementById('lowStockCheckbox');
        if (lowCheckbox) lowCheckbox.checked = false;
        document.getElementById('lowStockCard')?.classList.remove('selected');
        const lowLabel = document.getElementById('lowStockLabel');
        if (lowLabel) {
            lowLabel.style.background = 'rgba(239, 68, 68, 0.08)';
            lowLabel.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        }
    }
    syncNearStockFilterUi();
    currentStockPage = 1;
    renderStockTable();
}

function toggleNearStockFilterFromCard() {
    toggleNearStockFilter(!showOnlyNearStock);
}

// ─── STATISTICS ───────────────────────────────────────────────────────────
function updateStatistics() {
    // ตัวเลขบนการ์ดนับตามจุดที่เลือก (ทุกจุด = ทั้งหมด)
    const stocks   = allStocks.filter(inSelectedSite);
    const total    = stocks.length;
    const lowStock = stocks.filter((stock) => {
        const quantity = Number(stock.quantity) || 0;
        return quantity <= getReorderPoint(stock);
    }).length;
    const nearStock = stocks.filter((stock) => getStockLevel(stock) === 'near').length;
    const totalQty = stocks.reduce((sum, stock) => sum + (Number(stock.quantity) || 0), 0);

    document.getElementById('totalItems').textContent    = total;
    document.getElementById('lowStockItems').textContent = lowStock;
    document.getElementById('nearStockItems').textContent = nearStock;
    document.getElementById('totalValue').textContent    = totalQty.toLocaleString('th-TH');
}

// ─── MODAL OPERATIONS ─────────────────────────────────────────────────────
let adjustMode = 'receive'; // 'receive' | 'issue'

function setAdjustMode(mode) {
    adjustMode = mode;
    document.getElementById('btnReceive').classList.toggle('selected', mode === 'receive');
    document.getElementById('btnIssue').classList.toggle('selected', mode === 'issue');
    const label = document.getElementById('deltaLabel');
    if (label) label.textContent = (mode === 'receive' ? 'จำนวนที่รับเข้า' : 'จำนวนที่จ่ายออก') + ' (เว้นว่าง = ไม่เปลี่ยนยอด)';
}

function openAddModal() {
    currentEditingId = null;
    adjustMode = 'receive';
    document.getElementById('modalTitle').textContent = '➕ เพิ่มสินค้าใหม่';
    document.getElementById('stockForm').reset();
    document.getElementById('reorderPoint').value = 10;
    document.getElementById('nearStockPoint').value = 20;
    
    // Show add section, hide edit section
    document.getElementById('addQtySection').style.display = '';
    document.getElementById('editQtySection').style.display = 'none';
    document.getElementById('quantity').required = true;
    document.getElementById('deltaQty').required = false;
    
    document.getElementById('stockModal').classList.add('active');
    document.getElementById('productName').focus();
}

async function openEditModal(id) {
    const stock = allStocks.find(s => s.id === id);
    if (!stock) return;
    currentEditingId = id;
    adjustMode = 'receive';
    document.getElementById('modalTitle').textContent = '✏️ แก้ไขข้อมูลสินค้า';
    document.getElementById('productName').value  = stock.product_name;
    document.getElementById('productCode').value  = stock.product_code || '';
    document.getElementById('category').value     = stock.category === 'tools' ? 'general' : stock.category;
    document.getElementById('reorderPoint').value = getReorderPoint(stock);
    document.getElementById('nearStockPoint').value = getNearStockPoint(stock);
    document.getElementById('width').value        = stock.width || '';
    document.getElementById('height').value       = stock.height || '';
    
    // Adjust panel
    document.getElementById('unitEdit').value     = normalizeUnit(stock.unit);
    document.getElementById('currentQtyDisplay').textContent = stock.quantity;
    document.getElementById('currentQtyUnit').textContent    = ' ' + normalizeUnit(stock.unit, 'ชิ้น');
    document.getElementById('deltaQty').value     = '';
    setAdjustMode('receive');
    
    // Hide add section, show edit section
    document.getElementById('addQtySection').style.display  = 'none';
    document.getElementById('editQtySection').style.display = '';
    document.getElementById('quantity').required = false;
    document.getElementById('deltaQty').required = false;
    
    document.getElementById('stockModal').classList.add('active');
    document.getElementById('deltaQty').focus();
}

function closeModal() {
    document.getElementById('stockModal').classList.remove('active');
    currentEditingId = null;
    document.getElementById('stockForm').reset();
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('stockModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
});

// ─── FORM SUBMISSION ──────────────────────────────────────────────────────
async function handleFormSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn') || e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังบันทึก...';

    try {
        const reorderPoint = parseInt(document.getElementById('reorderPoint').value, 10);
        const nearStockPoint = parseInt(document.getElementById('nearStockPoint').value, 10);
        if (!Number.isInteger(reorderPoint) || reorderPoint < 0) {
            throw new Error('จุดแจ้งเตือนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
        }
        if (!Number.isInteger(nearStockPoint) || nearStockPoint <= reorderPoint) {
            throw new Error(`ระดับใกล้หมดต้องมากกว่าจุดแจ้งเตือน (${reorderPoint})`);
        }

        if (currentEditingId) {
            // Edit Mode - adjust current quantity by delta
            const stock = allStocks.find(s => s.id === currentEditingId);
            if (!stock) throw new Error('ไม่พบสินค้านี้ — รีเฟรชหน้าแล้วลองใหม่');
            const deltaText = document.getElementById('deltaQty').value.trim();
            const deltaRaw = deltaText ? parseInt(deltaText, 10) : 0;
            if (deltaText && (isNaN(deltaRaw) || deltaRaw <= 0)) {
                throw new Error('จำนวนที่ปรับต้องมากกว่า 0 (หรือเว้นว่างถ้าไม่เปลี่ยนยอด)');
            }
            const delta = adjustMode === 'receive' ? deltaRaw : -deltaRaw;
            if (delta < 0 && window.auth?.hasPermission?.('action_decrease_stock') !== true) {
                throw new Error('CEO ยังไม่ได้ให้สิทธิ์ปรับสต็อกลดลง');
            }
            const unit = normalizeUnit(document.getElementById('unitEdit').value, 'ชิ้น');

            const updateData = {
                product_name: document.getElementById('productName').value.trim(),
                product_code: document.getElementById('productCode').value.trim() || null,
                category:     document.getElementById('category').value,
                reorder_point: reorderPoint,
                near_stock_point: nearStockPoint,
                unit:         unit,
                width:        document.getElementById('width').value  ? parseFloat(document.getElementById('width').value)  : null,
                height:       document.getElementById('height').value ? parseFloat(document.getElementById('height').value) : null,
                updated_at:   new Date().toISOString()
            };

            // ยอด: ถามเหตุผล+ชื่อ แล้วบันทึกผ่านฐานข้อมูล (ยกเลิก = ไม่แก้อะไรเลย)
            let adjRes = null;
            if (delta) {
                adjRes = await openAdjDialog(stock, delta);
                if (!adjRes) throw new Error('ยกเลิกการปรับจำนวน');
            }
            const { error } = await dbSupabase
                .from(STOCK_TABLE_NAME)
                .update(updateData)
                .eq('id', currentEditingId);
            if (error) throw error;

            const sign = delta > 0 ? '+' : '';
            showToast(delta
                ? `✅ ${updateData.product_name}: ${sign}${delta} → คงเหลือ ${adjRes.quantity ?? adjRes.new_qty} ${unit || 'ชิ้น'}`
                : `✅ บันทึกข้อมูล ${updateData.product_name} แล้ว`, delta >= 0 ? 'success' : 'warning');
} else {
            // Add Mode - create new item
            const qtyText = document.getElementById('quantity').value.trim();
            const qtyVal = qtyText ? parseInt(qtyText, 10) : 0;
            if (isNaN(qtyVal) || qtyVal < 0 || qtyVal > 100000) {
                throw new Error('จำนวนเริ่มต้นต้องเป็นตัวเลข 0 – 100,000');
            }
            const formData = {
                product_name: document.getElementById('productName').value.trim(),
                product_code: document.getElementById('productCode').value.trim() || null,
                category:     document.getElementById('category').value,
                reorder_point: reorderPoint,
                near_stock_point: nearStockPoint,
                quantity:     0,
                unit:         normalizeUnit(document.getElementById('unit').value, 'ชิ้น'),
                width:        document.getElementById('width').value  ? parseFloat(document.getElementById('width').value)  : null,
                height:       document.getElementById('height').value ? parseFloat(document.getElementById('height').value) : null,
            };
            
            const { data: created, error } = await dbSupabase
                .from(STOCK_TABLE_NAME)
                .insert([formData])
                .select()
                .single();
            if (error) throw error;
            if (qtyVal > 0 && created) {
                const adjRes = await openAdjDialog(created, qtyVal, { defaultType: 'receive', defaultNote: 'ยอดเริ่มต้น (สินค้าใหม่)' });
                if (adjRes) showToast(`✅ เพิ่มสินค้าแล้ว ยอดเริ่มต้น ${adjRes.quantity ?? adjRes.new_qty} ${formData.unit}`, 'success');
                else showToast('⚠️ เพิ่มสินค้าแล้ว แต่ยังไม่ได้ลงยอด (ยอด = 0) — ใส่จำนวนในตารางแล้วกด ✓', 'warning');
            } else {
                showToast('✅ เพิ่มสินค้าเรียบร้อย', 'success');
            }
}
        closeModal();
        await refreshStockList();
    } catch (err) {
        showToast('❌ บันทึกล้มเหลว: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึก';
    }
}

// ─── DELETE ───────────────────────────────────────────────────────────────
async function deleteStock(id) {
    const stock = allStocks.find(s => s.id === id);
    if (!stock) return;
    if (!confirm(`ลบ "${stock.product_name}" ออกจากสต็อก?\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
        const { error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .delete()
            .eq('id', id);
        if (error) throw error;
        showToast('🗑️ ลบสินค้าเรียบร้อย', 'info');
        await refreshStockList();
    } catch (err) {
        showToast('❌ ลบล้มเหลว: ' + err.message, 'error');
    }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────
function getCategoryLabel(cat) {
    if (cat === 'general') {
        return `<span class="tag-category general">🔩 อะไหล่</span>`;
    }
    if (cat === 'tools') {
        return `<span class="tag-category general">🔩 อะไหล่</span>`;
    }
    if (cat === 'glass') {
        return `<span class="tag-category glass">💠 กระจก</span>`;
    }
    if (cat === 'aluminum') {
        return `<span class="tag-category aluminum">📐 อลูมิเนียม</span>`;
    }
    return `<span class="tag-category">${cat}</span>`;
}

// ─── LOGS FETCHING & RENDERING ────────────────────────────────────────────
async function loadMovementLogs() {
    if (!dbSupabase) return;
    if (movementLogsLoading) return;
    movementLogsLoading = true;
    try {
        const { data, error } = await dbSupabase
            .from('stock_movement_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);
        if (error) throw error;
        movementLogs = data || [];
        renderLogs();
    } catch (err) {
        console.error("Error loading movement logs:", err);
    } finally {
        movementLogsLoading = false;
    }
}

function getLocalDateString(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function renderLogs() {
    const receiveLogBody = document.getElementById('receiveLogBody');
    const issueLogBody = document.getElementById('issueLogBody');
    if (!receiveLogBody || !issueLogBody) return;

    const receiveTerm = (document.getElementById('receiveSearchInput')?.value || '').toLowerCase().trim();
    const issueTerm = (document.getElementById('issueSearchInput')?.value || '').toLowerCase().trim();

    const receiveDateStart = document.getElementById('receiveDateStart')?.value || '';
    const receiveDateEnd = document.getElementById('receiveDateEnd')?.value || '';
    const issueDateStart = document.getElementById('issueDateStart')?.value || '';
    const issueDateEnd = document.getElementById('issueDateEnd')?.value || '';

    // Filter receives (delta > 0)
    let receives = movementLogs.filter(l => (l.delta ?? 0) > 0);
    if (receiveTerm) {
        receives = receives.filter(l => 
            (l.item_name || '').toLowerCase().includes(receiveTerm) ||
            (l.operator || '').toLowerCase().includes(receiveTerm) ||
            (l.reason || '').toLowerCase().includes(receiveTerm)
        );
    }
    if (receiveDateStart) {
        receives = receives.filter(l => getLocalDateString(l.created_at) >= receiveDateStart);
    }
    if (receiveDateEnd) {
        receives = receives.filter(l => getLocalDateString(l.created_at) <= receiveDateEnd);
    }

    // Filter issues (delta < 0)
    let issues = movementLogs.filter(l => (l.delta ?? 0) < 0);
    if (issueTerm) {
        issues = issues.filter(l => 
            (l.item_name || '').toLowerCase().includes(issueTerm) ||
            (l.dispatched_by || '').toLowerCase().includes(issueTerm) ||
            (l.operator || '').toLowerCase().includes(issueTerm) ||
            (l.reason || '').toLowerCase().includes(issueTerm)
        );
    }
    if (issueDateStart) {
        issues = issues.filter(l => getLocalDateString(l.created_at) >= issueDateStart);
    }
    if (issueDateEnd) {
        issues = issues.filter(l => getLocalDateString(l.created_at) <= issueDateEnd);
    }

    // Render Receives (IN)
    if (receives.length === 0) {
        receiveLogBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:2rem;">ไม่มีประวัติการรับเข้า</td></tr>`;
    } else {
        receiveLogBody.innerHTML = receives.map(l => {
            const dateStr  = new Date(l.created_at).toLocaleString('th-TH', { hour12: false });
            const opName   = l.operator || '—';
            const reason   = l.reason || '—';
            return `
            <tr>
                <td style="color:#64748b; font-size:0.8rem;">${dateStr}</td>
                <td style="font-weight:500; color:var(--text);">${l.item_name}</td>
                <td style="text-align:right; font-weight:bold; color:#10b981; padding-right:1.5rem;">+${l.delta}</td>
                <td style="color:#94a3b8;">${opName}</td>
                <td style="color:#94a3b8; font-size:0.9rem;">${reason}</td>
            </tr>`;
        }).join('');
    }

    // Render Issues (OUT)
    if (issues.length === 0) {
        issueLogBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:2rem;">ไม่มีประวัติการจ่ายออก</td></tr>`;
    } else {
        issueLogBody.innerHTML = issues.map(l => {
            const dateStr  = new Date(l.created_at).toLocaleString('th-TH', { hour12: false });
            const dispatcher = l.dispatched_by || '—';
            const producer   = l.operator || '—';
            const reason     = l.reason || '—';
            return `
            <tr>
                <td style="color:#64748b; font-size:0.8rem;">${dateStr}</td>
                <td style="font-weight:500; color:var(--text);">${l.item_name}</td>
                <td style="text-align:right; font-weight:bold; color:#f87171; padding-right:1.5rem;">${l.delta}</td>
                <td style="color:#94a3b8;">${dispatcher}</td>
                <td style="color:#94a3b8;">${producer}</td>
                <td style="color:#94a3b8; font-size:0.9rem;">${reason}</td>
            </tr>`;
        }).join('');
    }
}

// ─── SECTION TAB SWITCHING ────────────────────────────────────────────────
function switchSectionTab(tabId) {
    document.querySelectorAll('.section-panel').forEach(panel => {
        panel.style.display = 'none';
    });
    document.querySelectorAll('.section-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    const targetPanel = document.getElementById(`panel-${tabId}`);
    if (targetPanel) {
        targetPanel.style.display = 'block';
    }
    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
}
