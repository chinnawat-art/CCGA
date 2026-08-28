// =============================================================
// BACKUP STOCK MANAGEMENT SYSTEM — backup_stock.js
// =============================================================

let db = null;
let allBackupStocks = [];   // Merged data: sku_master + production_backup_stock
let allLogs = [];
let allBackupLots = [];
let pendingApprovalOrders = [];
let sortField = 'product_code';
let sortAsc = true;
let showOnlyLow = false;
let searchQuery = '';
let activeTab = 'stock';
let currentEditProduct = null; // { product_code, product_name, quantity, reorder_point, unit, notes }
let adjustMode = 'receive';    // 'receive' | 'issue'
let realtimeChannel = null;
let currentUserSession = null;
let currentApprovalOrder = null;
let currentApprovalLots = [];
let currentEditLots = [];

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    db = (window.auth && window.auth.supabase)
        ? window.auth.supabase
        : (window.supabase && window.SUPABASE_CONFIG
            ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
            : null);

    if (!db) {
        showToast('❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้ — ตรวจสอบ config.js', 'error');
        return;
    }

    // Get session for user id
    try {
        const { data: { session } } = await db.auth.getSession();
        currentUserSession = session;
    } catch(e) {
        console.warn('Could not get session:', e);
    }

    document.getElementById('adjustForm').addEventListener('submit', handleAdjustSubmit);
    await refreshBackupStockList();
    await refreshApprovalOrders();
    await loadMovementLogs();
    setupRealtime();
});

// ─── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    if (!el) return;
    const colors = {
        success: '#10b981',
        error: '#f87171',
        info: '#818cf8',
        warning: '#f59e0b'
    };
    el.style.background = 'rgba(15,23,42,0.97)';
    el.style.borderColor = colors[type] || colors.info;
    el.style.color = colors[type] || colors.info;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3800);
}

// ─── REALTIME ──────────────────────────────────────────────────
function setupRealtime() {
    if (!db) return;
    realtimeChannel = db.channel('backup-stock-realtime')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'production_backup_stock'
        }, payload => {
            const { eventType, new: nw, old: oldRow } = payload;

            if (eventType === 'UPDATE' || eventType === 'INSERT') {
                const idx = allBackupStocks.findIndex(s => s.product_code === nw.product_code);
                if (idx !== -1) {
                    allBackupStocks[idx] = { ...allBackupStocks[idx], ...nw };
                } else {
                    allBackupStocks.push({
                        product_code: nw.product_code,
                        product_name: nw.product_name || nw.product_code,
                        product_size: nw.product_size || '',
                        quantity: nw.quantity ?? 0,
                        reorder_point: nw.reorder_point ?? 2,
                        unit: nw.unit || 'ชิ้น',
                        notes: nw.notes || '',
                        updated_at: nw.updated_at || null
                    });
                }
                if (!updateBackupStockRowInDOM(nw)) {
                    renderBackupStockTable();
                    loadSkuDetailsForBackupRow(nw.product_code);
                }
                updateStats();
                refreshApprovalOrders();
            } else if (eventType === 'DELETE' && oldRow && oldRow.product_code) {
                allBackupStocks = allBackupStocks.filter(s => s.product_code !== oldRow.product_code);
                const row = document.querySelector(`#stockTableBody tr[data-code="${CSS.escape(oldRow.product_code)}"]`);
                if (row) row.remove();
                updateStats();
                refreshApprovalOrders();
                const empty = document.getElementById('emptyState');
                if (empty && document.querySelectorAll('#stockTableBody tr').length === 0) {
                    empty.style.display = 'block';
                }
            }
        })
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'production_backup_stock_log'
        }, payload => {
            allLogs.unshift(payload.new);
            renderLogs();
        })
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'production_backup_stock_lots'
        }, () => {
            refreshBackupStockList();
            refreshApprovalOrders();
        })
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'stock_orders'
        }, payload => {
            const { eventType, new: nw } = payload;
            if (!nw) return;
            const hasUntracked = !nw.tracking_number || nw.tracking_number === '-' || nw.tracking_number === '';
            if (eventType === 'INSERT' || eventType === 'UPDATE') {
                if (hasUntracked && ['รอดำเนินการ','กำลังผลิต','ผลิตสำเร็จแล้ว'].includes(nw.tracking_status)) {
                    refreshApprovalOrders();
                } else {
                    refreshApprovalOrders();
                }
            } else if (eventType === 'DELETE') {
                refreshApprovalOrders();
            }
        })
        .subscribe();
}

function updateBackupStockRowInDOM(stock) {
    const productCode = stock.product_code;
    if (!productCode) return false;

    const row = document.querySelector(`#stockTableBody tr[data-code="${CSS.escape(productCode)}"]`);
    if (!row) return false;

    const existingIndex = allBackupStocks.findIndex(s => s.product_code === productCode);
    const mergedStock = existingIndex !== -1 ? allBackupStocks[existingIndex] : {
        product_code: stock.product_code,
        product_name: stock.product_name || stock.product_code,
        product_size: stock.product_size || '',
        quantity: stock.quantity ?? 0,
        reorder_point: stock.reorder_point ?? 2,
        unit: stock.unit || 'ชิ้น',
        notes: stock.notes || '',
        updated_at: stock.updated_at || null
    };

    const isLow = mergedStock.quantity <= mergedStock.reorder_point;
    const qtyClass = isLow ? 'qty-low' : 'qty-ok';
    const badge = isLow
        ? `<span class="badge-low">⚠️ ต่ำ</span>`
        : `<span class="badge-ok">✅ ปกติ</span>`;

    const quantityCell = row.querySelector('.qty-value');
    if (quantityCell) {
        quantityCell.textContent = (mergedStock.quantity ?? 0).toLocaleString('th-TH');
        quantityCell.className = `qty-value ${qtyClass}`;
    }

    const unitCell = row.children[3];
    if (unitCell) unitCell.innerHTML = esc(mergedStock.unit || 'ชิ้น');

    const sizeCell = row.children[4];
    if (sizeCell) {
        sizeCell.innerHTML = mergedStock.product_size
            ? `<span style="background:rgba(168,85,247,0.12);color:#c084fc;padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(mergedStock.product_size)}</span>`
            : '<span style="color:var(--muted);">-</span>';
    }

    const reorderCell = row.children[5];
    if (reorderCell) reorderCell.innerHTML = `<span style="color: var(--muted); font-size:0.88rem;">${mergedStock.reorder_point ?? 2}</span>`;

    const notesCell = row.children[6];
    if (notesCell) notesCell.innerHTML = mergedStock.notes
        ? `<span class="stock-note" title="${esc(mergedStock.notes)}">${esc(mergedStock.notes)}</span>`
        : '<span style="color:var(--muted);">-</span>';

    const badgeCell = row.children[8];
    if (badgeCell) badgeCell.innerHTML = badge;

    row.classList.toggle('row-low', isLow);

    if (!mergedStock.product_size) {
        loadSkuDetailsForBackupRow(productCode);
    }

    return true;
}

async function loadSkuDetailsForBackupRow(productCode) {
    if (!productCode || !db) return;
    const row = document.querySelector(`#stockTableBody tr[data-code="${CSS.escape(productCode)}"]`);
    if (!row) return;

    const existingIndex = allBackupStocks.findIndex(s => s.product_code === productCode);
    if (existingIndex !== -1 && allBackupStocks[existingIndex].product_size) return;

    const { data: sku, error } = await db
        .from('sku_master')
        .select('name, size')
        .eq('product_code', productCode)
        .limit(1)
        .single();

    if (error || !sku) return;

    if (existingIndex !== -1) {
        allBackupStocks[existingIndex].product_name = sku.name || allBackupStocks[existingIndex].product_name;
        allBackupStocks[existingIndex].product_size = sku.size || allBackupStocks[existingIndex].product_size;
    }

    const productNameCell = row.querySelector('.product-name');
    if (productNameCell && sku.name) {
        productNameCell.textContent = sku.name;
    }

    const sizeCell = row.children[4];
    if (sizeCell) {
        sizeCell.innerHTML = sku.size
            ? `<span style="background:rgba(168,85,247,0.12);color:#c084fc;padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(sku.size)}</span>`
            : '<span style="color:var(--muted);">-</span>';
    }
}

// ─── DATA LOADING ───────────────────────────────────────────────
async function refreshBackupStockList() {
    try {
        // Load backup stock quantities first
        const { data: backups, error: bkErr } = await db
            .from('production_backup_stock')
            .select('product_code, quantity, reorder_point, unit, notes, updated_at')
            .gt('quantity', 0)
            .order('product_code', { ascending: true });

        if (bkErr) throw bkErr;

        if (!backups || backups.length === 0) {
            allBackupStocks = [];
            renderBackupStockTable();
            updateStats();
            return;
        }

        const backupCodes = backups.map(b => b.product_code);

        const { data: skus, error: skuErr } = await db
            .from('sku_master')
            .select('product_code, name, size')
            .in('product_code', backupCodes);

        if (skuErr) throw skuErr;

        const skuMap = {};
        (skus || []).forEach(sku => {
            skuMap[sku.product_code] = sku;
        });

        const { data: lots, error: lotsError } = await db
            .from('production_backup_stock_lots')
            .select('id, product_code, received_qty, remaining_qty, note, operator, created_at')
            .in('product_code', backupCodes)
            .gt('remaining_qty', 0)
            .order('created_at', { ascending: true });

        if (lotsError) throw lotsError;
        allBackupLots = lots || [];
        const lotMap = allBackupLots.reduce((acc, lot) => {
            (acc[lot.product_code] ||= []).push(lot);
            return acc;
        }, {});

        allBackupStocks = (backups || []).map(b => {
            const sku = skuMap[b.product_code];
            const productLots = lotMap[b.product_code] || [];
            return {
                product_code: b.product_code,
                product_name: sku?.name || b.product_code,
                product_size: sku?.size || '',
                quantity: b.quantity ?? 0,
                reorder_point: b.reorder_point ?? 2,
                unit: b.unit || 'ชิ้น',
                notes: productLots.map(lot => lot.note).filter(Boolean).join(', ') || b.notes || '',
                lots: productLots,
                updated_at: b.updated_at || null
            };
        });

        renderBackupStockTable();
        updateStats();
    } catch (err) {
        console.error('Error loading backup stocks:', err);
        showToast('❌ โหลดข้อมูลล้มเหลว: ' + err.message, 'error');
    }
}

async function refreshApprovalOrders() {
    try {
        // Find pending orders without tracking_number that still have available backup stock
        const { data: orders, error } = await db
            .from('stock_orders')
            .select('id, order_number, product_code, product_name, quantity, tracking_status, stock_deducted')
            .or('tracking_number.is.null,tracking_number.eq.-,tracking_number.eq.')
            .or('stock_deducted.is.null,stock_deducted.eq.false')
            .in('tracking_status', ['รอดำเนินการ', 'กำลังผลิต'])
            .order('order_number', { ascending: true });

        if (error) throw error;

        const orderList = orders || [];
        const backupCodes = [...new Set(orderList.map(o => o.product_code).filter(Boolean))];

        if (!backupCodes.length) {
            pendingApprovalOrders = [];
            renderApprovalOrders();
            return;
        }

        const { data: backupStocks, error: backupError } = await db
            .from('production_backup_stock')
            .select('product_code, quantity')
            .in('product_code', backupCodes)
            .gt('quantity', 0);

        if (backupError) throw backupError;
        const backupMap = (backupStocks || []).reduce((acc, item) => {
            acc[item.product_code] = item.quantity;
            return acc;
        }, {});

        pendingApprovalOrders = orderList
            .map(o => ({
                ...o,
                quantity: Number(o.quantity) || 0,
                backup_quantity: Number(backupMap[o.product_code] ?? 0)
            }))
            .filter(o => o.product_code && o.backup_quantity >= o.quantity && o.quantity > 0)
            .sort((a, b) => String(a.order_number || '').localeCompare(String(b.order_number || '')));

        renderApprovalOrders();
    } catch (err) {
        console.error('Error loading approval orders:', err);
    }
}

function renderApprovalOrders() {
    const tbody = document.getElementById('pendingOrdersBody');
    if (!tbody) return;

    if (!pendingApprovalOrders.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding:2rem; color:#64748b;">
                    ไม่มีออเดอร์ที่ยังไม่มีเลขพัสดุและมีสต็อกสำรองเพียงพอสำหรับอนุมัติ
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = pendingApprovalOrders.map(order => {
        const statusBadge = order.tracking_status === 'รอดำเนินการ'
            ? '<span class="badge badge-pending">⏳ รอผลิต</span>'
            : '<span class="badge badge-producing">🔨 กำลังผลิต</span>';

        return `
            <tr>
                <td>${esc(order.order_number || '-')}</td>
                <td>${esc(order.product_code || '-')}</td>
                <td>${esc(order.product_name || '-')}</td>
                <td style="text-align:right;">${order.quantity}</td>
                <td style="text-align:right;">${order.backup_quantity}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-approve" onclick="openApprovalLotModal('${order.id}')">
                        ✅ เลือกล็อตและอนุมัติ
                    </button>
                </td>
            </tr>`;
    }).join('');
}

async function openApprovalLotModal(orderId) {
    const order = pendingApprovalOrders.find(o => o.id === orderId);
    if (!order) {
        showToast('ไม่พบออเดอร์สำหรับอนุมัติ', 'error');
        return;
    }
    if (order.stock_deducted === true) {
        showToast('ออเดอร์นี้ตัดสต็อกแล้ว จึงไม่สามารถอนุมัติใช้สต็อกสำรองซ้ำได้', 'warning');
        await refreshApprovalOrders();
        return;
    }

    try {
        const { data, error } = await db
            .from('production_backup_stock_lots')
            .select('id, product_code, remaining_qty, note, operator, created_at')
            .eq('product_code', order.product_code)
            .gt('remaining_qty', 0)
            .order('created_at', { ascending: true });
        if (error) throw error;

        currentApprovalOrder = order;
        currentApprovalLots = data || [];

        document.getElementById('approvalOrderNumber').textContent = order.order_number || order.id;
        document.getElementById('approvalProductCode').textContent = order.product_code;
        document.getElementById('approvalRequiredQty').textContent = `${order.quantity} ชิ้น`;
        document.getElementById('approvalTargetQty').textContent = order.quantity;

        let remainingToAllocate = order.quantity;
        const tbody = document.getElementById('approvalLotsBody');
        tbody.innerHTML = currentApprovalLots.map(lot => {
            const defaultQty = Math.min(lot.remaining_qty, remainingToAllocate);
            remainingToAllocate -= defaultQty;
            const receivedAt = new Date(lot.created_at).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            return `
                <tr>
                    <td style="white-space:nowrap;">${receivedAt}</td>
                    <td>
                        <strong>${esc(lot.note || 'ไม่ระบุหมายเหตุ')}</strong>
                        <div style="font-size:0.75rem;color:var(--muted);">${esc(lot.operator || '-')}</div>
                    </td>
                    <td style="text-align:right;">${lot.remaining_qty}</td>
                    <td style="text-align:right;">
                        <input class="lot-allocation-input" type="number" min="0" max="${lot.remaining_qty}"
                            value="${defaultQty}" data-lot-id="${lot.id}" oninput="updateApprovalSelectedTotal()">
                    </td>
                </tr>`;
        }).join('');

        if (!currentApprovalLots.length) {
            const aggregateQty = Number(order.backup_quantity || 0);
            const message = aggregateQty > 0
                ? `พบยอดคงเหลือรวม ${aggregateQty} ชิ้น แต่ข้อมูลเดิมยังไม่มีล็อต กรุณารัน migration_backup_stock_lot_backfill.sql`
                : 'ไม่มีล็อตคงเหลือสำหรับ SKU นี้';
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--muted);">${esc(message)}</td></tr>`;
        }

        updateApprovalSelectedTotal();
        const modal = document.getElementById('approvalLotModal');
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    } catch (err) {
        console.error('Load lots error:', err);
        showToast('❌ โหลดล็อตไม่สำเร็จ: ' + err.message, 'error');
    }
}

function updateApprovalSelectedTotal() {
    const total = [...document.querySelectorAll('.lot-allocation-input')]
        .reduce((sum, input) => sum + (parseInt(input.value) || 0), 0);
    const target = Number(currentApprovalOrder?.quantity || 0);
    const totalEl = document.getElementById('approvalSelectedQty');
    totalEl.textContent = total;
    totalEl.className = total === target ? 'approval-total-ok' : 'approval-total-error';

    const confirmBtn = document.getElementById('confirmLotApprovalBtn');
    if (confirmBtn) confirmBtn.disabled = total !== target || target <= 0;
}

function closeApprovalLotModal() {
    const modal = document.getElementById('approvalLotModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 250);
    }
    currentApprovalOrder = null;
    currentApprovalLots = [];
}

async function confirmApprovalLots() {
    if (!currentApprovalOrder) return;

    const allocations = [...document.querySelectorAll('.lot-allocation-input')]
        .map(input => ({ lot_id: input.dataset.lotId, qty: parseInt(input.value) || 0 }))
        .filter(item => item.qty > 0);
    const total = allocations.reduce((sum, item) => sum + item.qty, 0);
    const required = Number(currentApprovalOrder.quantity) || 0;

    if (total !== required) {
        showToast(`กรุณาเลือกล็อตรวมให้ครบ ${required} ชิ้น (ปัจจุบัน ${total} ชิ้น)`, 'error');
        return;
    }

    const button = document.getElementById('confirmLotApprovalBtn');
    button.disabled = true;
    button.textContent = '⏳ กำลังอนุมัติ...';

    try {
        const operator = currentUserSession?.user?.email || 'admin';
        const { data, error } = await db.rpc('rpc_use_backup_stock_lots_for_order', {
            p_order_id: currentApprovalOrder.id,
            p_allocations: allocations,
            p_operator: operator,
            p_user_id: currentUserSession?.user?.id || null
        });
        if (error) throw error;
        if (data?.status === 'error') throw new Error(data.message || 'RPC ล้มเหลว');

        showToast('✅ อนุมัติและตัดล็อตที่เลือกเรียบร้อย', 'success');
        closeApprovalLotModal();
        await refreshBackupStockList();
        await refreshApprovalOrders();
        await loadMovementLogs();
    } catch (err) {
        console.error('Approve lots error:', err);
        showToast('❌ อนุมัติไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = '✅ ยืนยันอนุมัติ';
    }
}

async function loadMovementLogs() {
    try {
        const { data, error } = await db
            .from('production_backup_stock_log')
            .select('id, product_code, old_qty, new_qty, delta, operator, reason, created_at')
            .order('created_at', { ascending: false })
            .limit(300);

        if (error) throw error;
        allLogs = data || [];
        renderLogs();
    } catch (err) {
        console.error('Error loading logs:', err);
    }
}

// ─── STATS ─────────────────────────────────────────────────────
function updateStats() {
    const total = allBackupStocks.length;
    const low = allBackupStocks.filter(s => s.quantity <= s.reorder_point).length;
    const totalQty = allBackupStocks.reduce((acc, s) => acc + (parseInt(s.quantity) || 0), 0);

    document.getElementById('totalItems').textContent = total;
    document.getElementById('lowStockItems').textContent = low;
    document.getElementById('totalValue').textContent = totalQty.toLocaleString('th-TH');
}

// ─── SORT ───────────────────────────────────────────────────────
function sortBy(field) {
    if (sortField === field) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = true;
    }
    renderBackupStockTable();
}

function getSorted(arr) {
    return [...arr].sort((a, b) => {
        let va = a[sortField], vb = b[sortField];
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
    });
}

// ─── SEARCH / FILTER ───────────────────────────────────────────
function searchStocks() {
    searchQuery = (document.getElementById('searchInput')?.value || '').toLowerCase();
    renderBackupStockTable();
}

function toggleLowStockFilter(checked) {
    showOnlyLow = checked;
    const card = document.getElementById('lowStockCard');
    card?.classList.toggle('selected', checked);
    renderBackupStockTable();
}

function toggleLowStockFilterFromCard() {
    const cb = document.getElementById('lowStockCheckbox');
    if (!cb) return;
    cb.checked = !cb.checked;
    toggleLowStockFilter(cb.checked);
}

// ─── RENDER TABLE ───────────────────────────────────────────────
function renderBackupStockTable() {
    const tbody = document.getElementById('stockTableBody');
    const empty = document.getElementById('emptyState');
    if (!tbody) return;

    let items = getSorted(allBackupStocks);

    // Apply search filter
    if (searchQuery) {
        items = items.filter(s =>
            (s.product_code || '').toLowerCase().includes(searchQuery) ||
            (s.product_name || '').toLowerCase().includes(searchQuery) ||
            (s.notes || '').toLowerCase().includes(searchQuery)
        );
    }

    // Apply low stock filter
    if (showOnlyLow) {
        items = items.filter(s => s.quantity <= s.reorder_point);
    }

    if (!items.length) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }

    if (empty) empty.style.display = 'none';
    tbody.innerHTML = items.map(s => buildRow(s)).join('');
}

function esc(str) {
    const el = document.createElement('span');
    el.textContent = str ?? '';
    return el.innerHTML;
}

function buildRow(s) {
    const isLow = s.quantity <= s.reorder_point;
    const qtyClass = isLow ? 'qty-low' : 'qty-ok';
    const badge = isLow
        ? `<span class="badge-low">⚠️ ต่ำ</span>`
        : `<span class="badge-ok">✅ ปกติ</span>`;
    const rowClass = isLow ? 'row-low' : '';

    return `
    <tr class="${rowClass}" data-code="${esc(s.product_code)}">
        <td><span class="product-code">${esc(s.product_code)}</span></td>
        <td>
            <div class="product-name">${esc(s.product_name)}</div>
        </td>
        <td style="text-align: right; padding-right: 2rem;">
            <span class="qty-value ${qtyClass}">${(s.quantity ?? 0).toLocaleString('th-TH')}</span>
        </td>
        <td>${esc(s.unit || 'ชิ้น')}</td>
        <td>${s.product_size ? `<span style="background:rgba(168,85,247,0.12);color:#c084fc;padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(s.product_size)}</span>` : '<span style="color:var(--muted);">-</span>'}</td>
        <td><span style="color: var(--muted); font-size:0.88rem;">${s.reorder_point ?? 2}</span></td>
        <td>${s.notes ? `<span class="stock-note" title="${esc(s.notes)}">${esc(s.notes)}</span>` : '<span style="color:var(--muted);">-</span>'}</td>
        <td>
            <div class="action-btns">
                <button class="action-btn action-btn-edit" title="ปรับปรุงสต็อก" onclick="openAdjustModal('${esc(s.product_code)}')">
                    ✏️
                </button>
            </div>
        </td>
        <td>${badge}</td>
    </tr>`;
}

// ─── LOG RENDERING ──────────────────────────────────────────────
function renderLogs() {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;

    const query = (document.getElementById('logSearchInput')?.value || '').toLowerCase();
    let logs = allLogs;

    if (query) {
        logs = logs.filter(lg =>
            (lg.product_code || '').toLowerCase().includes(query) ||
            (lg.operator || '').toLowerCase().includes(query) ||
            (lg.reason || '').toLowerCase().includes(query)
        );
    }

    if (!logs.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:2rem;">ไม่พบประวัติที่ตรงกับเงื่อนไข</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(lg => {
        const d = new Date(lg.created_at);
        const dateStr = d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' });
        const timeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        const delta = lg.delta ?? (lg.new_qty - lg.old_qty);
        const isPlus = delta > 0;
        const deltaStr = isPlus
            ? `<span style="color:#34d399; font-weight:700;">+${delta}</span>`
            : `<span style="color:#f87171; font-weight:700;">${delta}</span>`;

        // Look up product name
        const sku = allBackupStocks.find(s => s.product_code === lg.product_code);
        const nameLine = sku ? `<div style="font-size:0.76rem;color:var(--muted);">${esc(sku.product_name)}</div>` : '';

        return `
        <tr>
            <td style="white-space:nowrap; color:var(--muted); font-size:0.82rem;">${dateStr} ${timeStr}</td>
            <td>
                <div style="font-family:monospace; font-size:0.82rem; color:var(--primary-bright);">${esc(lg.product_code)}</div>
                ${nameLine}
            </td>
            <td style="text-align:right; padding-right:1.5rem;">${deltaStr}</td>
            <td style="text-align:right; padding-right:1.5rem; font-weight:600;">${lg.new_qty}</td>
            <td><span style="background:rgba(255,255,255,0.04);border:1px solid var(--border);padding:2px 8px;border-radius:20px;font-size:0.8rem;">${esc(lg.operator || '-')}</span></td>
            <td style="max-width:260px; font-size:0.82rem; color:var(--muted);">${esc(lg.reason || '-')}</td>
        </tr>`;
    }).join('');
}

// ─── SECTION TAB SWITCHING ───────────────────────────────────────
function switchSectionTab(tab) {
    activeTab = tab;
    ['stock', 'logs'].forEach(t => {
        const btn = document.getElementById('tab-' + t);
        const panel = document.getElementById('panel-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'logs') renderLogs();
}

// ─── ADJUST MODAL ───────────────────────────────────────────────
async function openAdjustModal(productCode) {
    const stock = allBackupStocks.find(s => s.product_code === productCode);
    if (!stock) {
        showToast('ไม่พบข้อมูลสินค้า', 'error');
        return;
    }

    currentEditProduct = stock;
    adjustMode = 'receive';

    document.getElementById('modalProductCode').value = stock.product_code;
    document.getElementById('modalProductName').value = stock.product_name;
    document.getElementById('currentQtyDisplay').textContent = stock.quantity ?? 0;
    document.getElementById('currentQtyUnit').textContent = ' ' + (stock.unit || 'ชิ้น');
    document.getElementById('reorderPoint').value = stock.reorder_point ?? 2;
    document.getElementById('unitInput').value = stock.unit || 'ชิ้น';
    document.getElementById('stockNotes').value = '';
    document.getElementById('deltaQty').value = '';
    document.getElementById('operatorName').value = currentUserSession?.user?.email || '';
    document.getElementById('chkDeductBom').checked = false;
    currentEditLots = [];
    renderEditLotNotes(true);

    setAdjustMode('receive');

    const modal = document.getElementById('adjustModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    document.getElementById('deltaQty').focus();

    const [bomResult, lotsResult] = await Promise.all([
        db.from('stock_bom')
            .select('id')
            .eq('product_code', productCode)
            .limit(1),
        db.from('production_backup_stock_lots')
            .select('id, remaining_qty, note, operator, created_at')
            .eq('product_code', productCode)
            .gt('remaining_qty', 0)
            .order('created_at', { ascending: true })
    ]);

    const { data: bom, error: bomError } = bomResult;
    const { data: lots, error: lotsError } = lotsResult;

    if (bomError) console.error('Check BOM error:', bomError);

    if (lotsError) {
        console.error('Load editable lots error:', lotsError);
        showToast('โหลดหมายเหตุแต่ละล็อตไม่สำเร็จ: ' + lotsError.message, 'error');
    } else {
        currentEditLots = lots || [];
    }
    renderEditLotNotes(false);

    const bomSection = document.getElementById('bomSection');
    if (bomSection) {
        bomSection.style.display = (bom && bom.length > 0) ? '' : 'none';
    }
}

function closeModal() {
    const modal = document.getElementById('adjustModal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
    currentEditProduct = null;
    currentEditLots = [];
}

function renderEditLotNotes(isLoading = false) {
    const tbody = document.getElementById('editLotNotesBody');
    const count = document.getElementById('editLotCount');
    if (!tbody) return;

    if (count) count.textContent = isLoading ? '...' : currentEditLots.length;
    if (isLoading) {
        tbody.innerHTML = '<tr><td colspan="3" class="edit-lot-empty">กำลังโหลดล็อต...</td></tr>';
        return;
    }

    if (!currentEditLots.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="edit-lot-empty">ยังไม่มีล็อตคงเหลือสำหรับ SKU นี้</td></tr>';
        return;
    }

    tbody.innerHTML = currentEditLots.map(lot => {
        const receivedAt = new Date(lot.created_at).toLocaleString('th-TH', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
        return `
            <tr>
                <td>
                    <strong>${receivedAt}</strong>
                    <small>${esc(lot.operator || '-')}</small>
                </td>
                <td>
                    <input type="text" class="edit-lot-note-input" data-lot-id="${lot.id}"
                        maxlength="500" value="${esc(lot.note || '')}"
                        placeholder="ระบุหมายเหตุของล็อต">
                </td>
                <td class="edit-lot-remaining">${lot.remaining_qty} ชิ้น</td>
            </tr>`;
    }).join('');
}

function getChangedLotNotes() {
    const originalById = new Map(currentEditLots.map(lot => [lot.id, (lot.note || '').trim()]));
    return [...document.querySelectorAll('.edit-lot-note-input')]
        .map(input => ({
            id: input.dataset.lotId,
            note: input.value.trim() || 'ไม่ระบุหมายเหตุ'
        }))
        .filter(item => item.note !== (originalById.get(item.id) || 'ไม่ระบุหมายเหตุ'));
}

function setAdjustMode(mode) {
    adjustMode = mode;
    const btnReceive = document.getElementById('btnReceive');
    const btnIssue = document.getElementById('btnIssue');
    const deltaLabel = document.getElementById('deltaLabel');
    const bomSection = document.getElementById('bomSection');

    btnReceive?.classList.toggle('selected', mode === 'receive');
    btnIssue?.classList.toggle('selected', mode === 'issue');

    if (deltaLabel) {
        deltaLabel.textContent = mode === 'receive' ? 'จำนวนรับเข้าคลัง *' : 'จำนวนจ่ายออกจากคลัง *';
    }

    // BOM section only relevant when receiving
    if (bomSection) {
        // Only show if it was already discovered to have BOM (display !== 'none' from the BOM check)
        if (mode === 'issue') {
            bomSection.setAttribute('data-hidden-by-mode', 'true');
            bomSection.style.display = 'none';
        } else {
            if (bomSection.getAttribute('data-hidden-by-mode') === 'true') {
                bomSection.removeAttribute('data-hidden-by-mode');
                // Re-check if bom was available; if bomSection had display=none before this mode change, keep it hidden
            }
        }
    }
}

// ─── FORM SUBMIT ─────────────────────────────────────────────────
async function handleAdjustSubmit(e) {
    e.preventDefault();

    if (!currentEditProduct) return;

    const delta = parseInt(document.getElementById('deltaQty').value) || 0;
    const operatorName = document.getElementById('operatorName').value.trim();
    const reorderPoint = parseInt(document.getElementById('reorderPoint').value) || 2;
    const unit = document.getElementById('unitInput').value.trim() || 'ชิ้น';
    const notes = document.getElementById('stockNotes').value.trim();
    const deductBom = document.getElementById('chkDeductBom')?.checked && adjustMode === 'receive';
    const changedLotNotes = getChangedLotNotes();

    if (delta < 0) {
        showToast('กรุณาระบุจำนวนตั้งแต่ 0 ขึ้นไป', 'error');
        return;
    }

    if (delta > 0 && !operatorName) {
        showToast('กรุณาระบุชื่อผู้ปฏิบัติการ', 'error');
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ กำลังบันทึก...';

    try {
        const { product_code, quantity: currentQty } = currentEditProduct;

        if (delta === 0) {
            // Save metadata below without creating a movement log.
        } else if (deductBom && adjustMode === 'receive') {
            // Use RPC to deduct raw material via BOM and add to backup
            const { data, error } = await db.rpc('rpc_deduct_components_for_backup_production', {
                p_product_code: product_code,
                p_qty: delta,
                p_operator: operatorName,
                p_reason: notes || null
            });

            if (error) throw error;
            if (data?.status === 'error') throw new Error(data.message || 'RPC ล้มเหลว');

            showToast(`✅ รับเข้า ${delta} ${unit} และตัดวัสดุ BOM สำเร็จ`, 'success');

        } else {
            // Direct adjust without BOM deduction
            const newQty = adjustMode === 'receive'
                ? currentQty + delta
                : currentQty - delta;

            if (newQty < 0) {
                showToast(`❌ สต็อกสำรองไม่เพียงพอ (มี ${currentQty}, ต้องการ ${delta})`, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = '💾 บันทึกการปรับปรุง';
                return;
            }

            const signedDelta = adjustMode === 'receive' ? delta : -delta;

            // Upsert backup stock quantity
            const { error: upsertErr } = await db
                .from('production_backup_stock')
                .upsert({ product_code, quantity: newQty, reorder_point: reorderPoint, unit, notes: notes || null, updated_at: new Date().toISOString() }, { onConflict: 'product_code' });

            if (upsertErr) throw upsertErr;

            // Write log
            const reasonFull = notes || (adjustMode === 'receive' ? 'รับสินค้าสำเร็จรูปเข้าคลัง' : 'จ่ายออก / ใช้สินค้าสำรอง');
            const { error: logErr } = await db
                .from('production_backup_stock_log')
                .insert({
                    product_code,
                    old_qty: currentQty,
                    new_qty: newQty,
                    delta: signedDelta,
                    operator: operatorName,
                    reason: reasonFull
                });

            if (logErr) console.error('Log error:', logErr);

            showToast(`✅ ${adjustMode === 'receive' ? 'รับเข้า' : 'จ่ายออก'} ${delta} ${unit} สำเร็จ`, 'success');
        }

        // Also save reorder_point & unit regardless of mode
        const { error: metadataError } = await db
            .from('production_backup_stock')
            .upsert({ product_code, reorder_point: reorderPoint, unit, notes: notes || null }, { onConflict: 'product_code' });
        if (metadataError) throw metadataError;

        if (changedLotNotes.length > 0) {
            const lotUpdateResults = await Promise.all(changedLotNotes.map(item =>
                db.from('production_backup_stock_lots')
                    .update({ note: item.note, updated_at: new Date().toISOString() })
                    .eq('id', item.id)
                    .eq('product_code', product_code)
            ));
            const failedLotUpdate = lotUpdateResults.find(result => result.error);
            if (failedLotUpdate) throw failedLotUpdate.error;
        }

        if (delta === 0) {
            const lotMessage = changedLotNotes.length > 0
                ? ` และหมายเหตุล็อต ${changedLotNotes.length} รายการ`
                : '';
            showToast(`✅ บันทึกข้อมูลสินค้า${lotMessage}แล้ว`, 'success');
        } else if (changedLotNotes.length > 0) {
            showToast(`✅ บันทึกการปรับสต็อกและหมายเหตุล็อต ${changedLotNotes.length} รายการแล้ว`, 'success');
        }

        closeModal();
        await refreshBackupStockList();
        await loadMovementLogs();

    } catch (err) {
        showToast('❌ บันทึกล้มเหลว: ' + err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึกการปรับปรุง';
    }
}

// ─── SKU MASTER AUTO-COMPLETE & ADD STOCK ─────────────────────
let skuMasterCache = [];
let skuSearchTimer = null;

async function openAddSkuModal() {
    document.getElementById('addSkuForm').reset();
    document.getElementById('skuSelect').innerHTML = '<option value="">-- กรุณาพิมพ์เพื่อค้นหาหรือเลือก SKU --</option>';
    document.getElementById('skuProductName').value = '';
    document.getElementById('skuInitialQty').value = '';
    document.getElementById('skuReorderPoint').value = 2;
    document.getElementById('skuUnitInput').value = 'ชิ้น';
    document.getElementById('skuNotes').value = '';
    document.getElementById('skuOperatorName').value = currentUserSession?.user?.email || '';
    document.getElementById('skuSearchInput').value = '';

    const modal = document.getElementById('addSkuModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }

    document.getElementById('skuSelect').setAttribute('required', 'true');
    await fetchSkusForSelector('');
}

function closeAddSkuModal() {
    const modal = document.getElementById('addSkuModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 250);
    }
}

async function fetchSkusForSelector(searchQueryStr) {
    if (!db) return;
    try {
        const pageSize = 1000;
        const cleanQuery = searchQueryStr.trim();
        const rows = [];

        let from = 0;
        while (true) {
            let query = db
                .from('sku_master')
                .select('product_code, name, size')
                .order('product_code', { ascending: true })
                .range(from, from + pageSize - 1);

            if (cleanQuery) {
                query = query.or(`product_code.ilike.%${cleanQuery}%,name.ilike.%${cleanQuery}%`);
            }

            const { data, error } = await query;
            if (error) throw error;
            if (!data || data.length === 0) break;
            rows.push(...data);
            from += data.length;
        }

        skuMasterCache = rows;
        const select = document.getElementById('skuSelect');
        if (!select) return;
        
        if (skuMasterCache.length === 0) {
            select.innerHTML = '<option value="">❌ ไม่พบรหัส SKU ที่ตรงกับเงื่อนไข</option>';
            return;
        }

        let selectHtml = `<option value="">-- เลือก SKU (${skuMasterCache.length} รายการที่พบ) --</option>`;
        skuMasterCache.forEach(item => {
            const sizeStr = item.size ? ` (ไซส์ ${item.size})` : '';
            selectHtml += `<option value="${esc(item.product_code)}">${esc(item.product_code)} - ${esc(item.name)}${esc(sizeStr)}</option>`;
        });
        select.innerHTML = selectHtml;
    } catch (err) {
        console.error('Error fetching SKUs:', err);
        showToast('❌ ไม่สามารถโหลดรายการ SKU ได้: ' + err.message, 'error');
    }
}

function onSkuSearchInput() {
    clearTimeout(skuSearchTimer);
    skuSearchTimer = setTimeout(() => {
        const query = document.getElementById('skuSearchInput').value;
        fetchSkusForSelector(query);
    }, 300);
}

function onSkuSelectChange() {
    const select = document.getElementById('skuSelect');
    if (!select) return;
    const productCode = select.value;
    if (!productCode) {
        document.getElementById('skuProductName').value = '';
        return;
    }

    const selectedItem = skuMasterCache.find(item => item.product_code === productCode);
    if (selectedItem) {
        const sizeStr = selectedItem.size ? ` (ไซส์ ${selectedItem.size})` : '';
        document.getElementById('skuProductName').value = `${selectedItem.name}${sizeStr}`;
    }
}

async function handleAddSkuSubmit(e) {
    e.preventDefault();

    const productCode = document.getElementById('skuSelect').value;

    const productName = document.getElementById('skuProductName').value;
    const qty = parseInt(document.getElementById('skuInitialQty').value) || 0;
    const reorderPoint = parseInt(document.getElementById('skuReorderPoint').value) || 2;
    const unit = document.getElementById('skuUnitInput').value.trim() || 'ชิ้น';
    const notes = document.getElementById('skuNotes').value.trim();
    const operatorName = document.getElementById('skuOperatorName').value.trim();

    if (!productCode) {
        showToast('⚠️ กรุณาเลือก SKU จากข้อมูลเดิม', 'error');
        return;
    }

    if (qty <= 0) {
        showToast('⚠️ กรุณาระบุจำนวนที่มากกว่า 0', 'error');
        return;
    }

    if (!operatorName) {
        showToast('⚠️ กรุณาระบุชื่อผู้ปฏิบัติการ', 'error');
        return;
    }

    const submitBtn = document.getElementById('skuSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ กำลังบันทึก...';
    }

    try {
        // Check if item already exists in backup stock
        const { data: existing, error: selectError } = await db
            .from('production_backup_stock')
            .select('quantity, notes')
            .eq('product_code', productCode)
            .maybeSingle();

        if (selectError) throw selectError;

        const currentQty = existing ? (parseInt(existing.quantity) || 0) : 0;
        const newQty = currentQty + qty;

        // Upsert to production_backup_stock
        const { error: upsertErr } = await db
            .from('production_backup_stock')
            .upsert({
                product_code: productCode,
                quantity: newQty,
                reorder_point: reorderPoint,
                unit: unit,
                notes: notes || existing?.notes || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'product_code' });

        if (upsertErr) throw upsertErr;

        // Log movement
        const reasonFull = notes || 'รับสินค้าสำเร็จรูปเข้าสต็อกสำรองจาก SKU Master';
        const { error: logErr } = await db
            .from('production_backup_stock_log')
            .insert({
                product_code: productCode,
                old_qty: currentQty,
                new_qty: newQty,
                delta: qty,
                operator: operatorName,
                reason: reasonFull
            });

        if (logErr) console.error('Log error:', logErr);

        showToast(`✅ เพิ่มสต็อกสำรอง ${productCode} สำเร็จ (+${qty})`, 'success');
        closeAddSkuModal();
        await refreshBackupStockList();
        await loadMovementLogs();
    } catch (err) {
        showToast('❌ เพิ่มไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 บันทึกสต็อก';
        }
    }
}

// ─── Close modal on backdrop click ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const modalAdjust = document.getElementById('adjustModal');
    if (modalAdjust) {
        modalAdjust.addEventListener('click', (e) => {
            if (e.target === modalAdjust) closeModal();
        });
    }

    const modalAddSku = document.getElementById('addSkuModal');
    if (modalAddSku) {
        modalAddSku.addEventListener('click', (e) => {
            if (e.target === modalAddSku) closeAddSkuModal();
        });
    }

    const approvalLotModal = document.getElementById('approvalLotModal');
    if (approvalLotModal) {
        approvalLotModal.addEventListener('click', (e) => {
            if (e.target === approvalLotModal) closeApprovalLotModal();
        });
    }

    const addSkuForm = document.getElementById('addSkuForm');
    if (addSkuForm) {
        addSkuForm.addEventListener('submit', handleAddSkuSubmit);
    }
});
