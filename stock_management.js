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
                renderStockTable();
                updateStatistics();
                showToast(`➕ เพิ่มสินค้าใหม่: ${row.product_name}`, 'success');
            })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: STOCK_TABLE_NAME },
            ({ new: row }) => {
                // Patch only the changed row in local array
                const idx = allStocks.findIndex(s => s.id === row.id);
                if (idx !== -1) allStocks[idx] = row;
                else allStocks.unshift(row);
                renderStockTable();
                updateStatistics();
            })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: STOCK_TABLE_NAME },
            ({ old: row }) => {
                allStocks = allStocks.filter(s => s.id !== row.id);
                renderStockTable();
                updateStatistics();
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
                          (s.product_code || '').toLowerCase().includes(term);
        
        const matchCat = !selectedCategory || (selectedCategory === 'general'
            ? s.category === 'general' || s.category === 'tools'
            : s.category === selectedCategory);
        
        const level = getStockLevel(s);
        const isLow = level === 'low';
        const isNear = level === 'near';
        const matchLow = !showOnlyLowStock || isLow;
        const matchNear = !showOnlyNearStock || isNear;
        
        return matchName && matchCat && matchLow && matchNear;
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
                <input class="quick-qty-input-new" type="number" min="1" placeholder="0" onkeydown="handleNewQuickQtyKeyDown(event, '${stock.id}', this)" style="border: none; background: transparent; width: 50px; color: var(--text); font-size: 0.9rem; text-align: center; padding: 0.3rem 0.2rem; outline: none; -moz-appearance: textfield;" title="ใส่จำนวนแล้วกด Enter เพื่อปรับสต็อก">
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

async function handleNewQuickQtyKeyDown(e, id, inputEl) {
    if (e.key === 'Enter') {
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
        
        let delta = qty;
        if (sign === '-') {
            delta = -qty;
        }
        
        inputEl.disabled = true;
        await quickAdjust(id, delta);
        inputEl.disabled = false;
        inputEl.value = '';
        inputEl.focus();
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

    const userName = await getLoggedInUserEmail();

    // ถาม: เหตุผล (ไม่บังคับ — กด OK เปล่าได้)
    const reason = prompt('📝 เหตุผลในการปรับสต็อก (ระบุหรือเว้นว่างได้):');
    if (reason === null) {
        // กด Cancel บน dialog เหตุผล = ยกเลิกทั้งหมด
        showToast('⚠️ ยกเลิกการปรับจำนวน', 'warning');
        return;
    }

    const oldQty = stock.quantity;
    const newQty = Math.max(0, oldQty + delta);
    try {
        const { error } = await dbSupabase
            .from(STOCK_TABLE_NAME)
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        stock.quantity = newQty;

        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr) tr.outerHTML = buildRow(stock);
        else renderStockTable();

        updateStatistics();
        showToast(`✅ ${stock.product_name}: ${delta > 0 ? '+' : ''}${delta} → ${newQty} ${normalizeUnit(stock.unit, 'ชิ้น')}`, delta > 0 ? 'success' : 'warning');

        await logStockMovement(id, stock.product_name, oldQty, newQty, delta, userName, reason);
    } catch (err) {
        showToast('❌ ปรับจำนวนล้มเหลว: ' + err.message, 'error');
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
    const total    = allStocks.length;
    const lowStock = allStocks.filter((stock) => {
        const quantity = Number(stock.quantity) || 0;
        return quantity <= getReorderPoint(stock);
    }).length;
    const nearStock = allStocks.filter((stock) => getStockLevel(stock) === 'near').length;
    const totalQty = allStocks.reduce((sum, stock) => sum + (Number(stock.quantity) || 0), 0);

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
    if (label) label.textContent = mode === 'receive' ? 'จำนวนที่รับเข้า *' : 'จำนวนที่จ่ายออก *';
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
    document.getElementById('deltaQty').required = true;
    
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
            const deltaRaw = parseInt(document.getElementById('deltaQty').value);
            if (isNaN(deltaRaw) || deltaRaw <= 0) {
                throw new Error('กรุณาระบุจำนวนสินค้าที่ต้องการปรับปรุงให้ถูกต้อง (ต้องมากกว่า 0)');
            }
            const delta = adjustMode === 'receive' ? deltaRaw : -deltaRaw;

            // ถาม 1: ชื่อ (บังคับ)
            const userName = await getLoggedInUserEmail();

            // ถาม: เหตุผล (ไม่บังคับ)
            const reason = prompt('📝 เหตุผลในการปรับสต็อก (ระบุหรือเว้นว่างได้):');
            if (reason === null) {
                throw new Error('ยกเลิกการปรับจำนวน');
            }
            const oldQty = stock?.quantity || 0;
            const newQty = Math.max(0, oldQty + delta);
            const unit = normalizeUnit(document.getElementById('unitEdit').value, 'ชิ้น');

            const updateData = {
                product_name: document.getElementById('productName').value.trim(),
                product_code: document.getElementById('productCode').value.trim() || null,
                category:     document.getElementById('category').value,
                reorder_point: reorderPoint,
                near_stock_point: nearStockPoint,
                unit:         unit,
                quantity:     newQty,
                width:        document.getElementById('width').value  ? parseFloat(document.getElementById('width').value)  : null,
                height:       document.getElementById('height').value ? parseFloat(document.getElementById('height').value) : null,
                updated_at:   new Date().toISOString()
            };

            const { error } = await dbSupabase
                .from(STOCK_TABLE_NAME)
                .update(updateData)
                .eq('id', currentEditingId);
            if (error) throw error;
            
            const sign = delta > 0 ? '+' : '';
            showToast(`✅ ${updateData.product_name}: ${sign}${delta} → คงเหลือ ${newQty} ${unit || 'ชิ้น'}`, adjustMode === 'receive' ? 'success' : 'warning');

            // Log movement to stock_movement_log
            await logStockMovement(currentEditingId, updateData.product_name, oldQty, newQty, delta, userName, reason);
        } else {
            // Add Mode - create new item
            const qtyVal = document.getElementById('quantity').value;
            const formData = {
                product_name: document.getElementById('productName').value.trim(),
                product_code: document.getElementById('productCode').value.trim() || null,
                category:     document.getElementById('category').value,
                reorder_point: reorderPoint,
                near_stock_point: nearStockPoint,
                quantity:     qtyVal ? parseInt(qtyVal) : 0,
                unit:         normalizeUnit(document.getElementById('unit').value, 'ชิ้น'),
                width:        document.getElementById('width').value  ? parseFloat(document.getElementById('width').value)  : null,
                height:       document.getElementById('height').value ? parseFloat(document.getElementById('height').value) : null,
            };
            
            const { error } = await dbSupabase
                .from(STOCK_TABLE_NAME)
                .insert([formData]);
            if (error) throw error;
            showToast('✅ เพิ่มสินค้าเรียบร้อย', 'success');
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
