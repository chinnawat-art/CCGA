const bomForm = document.getElementById('bomForm');
const formStatus = document.getElementById('formStatus');
const bomTableBody = document.getElementById('bomTableBody');
const bomCount = document.getElementById('bomCount');
const bomSearchInput = document.getElementById('bomSearch');
const bomSearchBtn = document.getElementById('bomSearchBtn');
const bomStatusFilter = document.getElementById('bomStatusFilter');
const refreshBtn = document.getElementById('refreshBtn');
const deleteBomBtn = document.getElementById('deleteBomBtn');
const clearBomBtn = document.getElementById('clearBomBtn');
const saveBomBtn = document.getElementById('saveBomBtn');
const bomParentSkuInput = document.getElementById('bomParentSku');
const bomParentSuggestionsEl = document.getElementById('bomParentSuggestions');
const componentsListEl = document.getElementById('componentsList');
const addComponentBtn = document.getElementById('addComponentBtn');
const newBomBtn = document.getElementById('newBomBtn');
const BOM_RENDER_LIMIT = 1000;

let dbClient = null;
let bomRows = [];
let skuMasterRows = [];
let selectedBomId = null;
let parentSearchTimer = null;
let componentNameMap = {};
let selectedBomParent = null;
let compRowCounter = 0;
let bomRowsLoaded = false;
let skuMasterRowsLoaded = false;
let isRefreshing = false;
let appliedSearchTerm = '';
let bomTotalCount = 0;
let skuMasterTotalCount = 0;
let knownProductsWithBom = new Set();

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
}

const COMPONENT_COLOR_NAMES = {
    ALU: {
        AG: 'แอชเทคเกรย์',
        B: 'ดำ',
        EF: 'กรอบสีอื่นๆ',
        GS: 'เทาซาฮาร่า',
        W: 'ขาว',
        W1: 'ลายไม้1',
        W2: 'ลายไม้2',
        W3: 'ลายไม้3',
        W4: 'ลายไม้4',
        W5: 'ลายไม้5',
        W6: 'ลายไม้6'
    },
    GLS: {
        B: 'ชาดำ',
        C: 'ใส',
        EG: 'กระจกสีอื่นๆ',
        F: 'ฝ้า',
        G: 'เขียว',
        LG: 'ลอนแก้ว'
    }
};

function localizeComponentName(productName, productCode) {
    const name = String(productName || '').trim();
    const code = normalizeCode(productCode);
    if (!name || !code) return name;

    const type = code.startsWith('ALU-') ? 'ALU' : code.startsWith('GLS-') ? 'GLS' : null;
    if (!type) return name;

    const colorMap = COMPONENT_COLOR_NAMES[type];
    const codeParts = code.split('-');
    const colorCode = type === 'GLS'
        ? codeParts[1]
        : [...codeParts.slice(1, -1)].reverse().find(part => colorMap[part]);
    const colorName = colorMap[colorCode];
    if (!colorName) return name;

    return name.replace(/สี\s*[A-Z][A-Z0-9]*(?=\s|ยาว|$)/i, `สี${colorName}`);
}

function showStatus(message, type = 'success') {
    formStatus.textContent = message;
    formStatus.className = `status-message status-${type}`;
}

function clearStatus() {
    formStatus.textContent = '';
    formStatus.className = 'status-message';
}

function renderBomRows() {
    const status = bomStatusFilter?.value || 'all';
    if (!bomRowsLoaded || (status === 'without-bom' && !skuMasterRowsLoaded)) {
        bomCount.textContent = 'กำลังโหลด...';
        bomTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">กำลังโหลดข้อมูล SKU และ BOM...</td></tr>';
        return;
    }

    const term = appliedSearchTerm.toLowerCase();
    const productsWithBom = new Set([
        ...knownProductsWithBom,
        ...bomRows.map(row => normalizeCode(row.product_code))
    ]);
    const filtered = status === 'without-bom' ? [] : bomRows.filter(row => {
        if (!term) return true;
        return [row.product_code, row.component_product_code].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
    });

    const masterOnlyRows = status === 'with-bom' ? [] : skuMasterRows.filter(item =>
            !productsWithBom.has(normalizeCode(item.product_code)) &&
            (!term || [item.product_code, item.product_name].filter(Boolean).some(value => String(value).toLowerCase().includes(term)))
        );

    const loadedMatches = filtered.length + masterOnlyRows.length;
    const totalMatches = status === 'without-bom'
        ? loadedMatches
        : Math.max(loadedMatches, bomTotalCount);
    if (!totalMatches) {
        bomCount.textContent = '0 รายการ';
        bomTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">ไม่พบ BOM</td></tr>';
        return;
    }

    const visibleBomRows = filtered.slice(0, BOM_RENDER_LIMIT);
    const remainingSlots = BOM_RENDER_LIMIT - visibleBomRows.length;
    const visibleMasterRows = masterOnlyRows.slice(0, Math.max(0, remainingSlots));
    const visibleCount = visibleBomRows.length + visibleMasterRows.length;

    bomCount.textContent = totalMatches > BOM_RENDER_LIMIT
        ? `แสดง ${visibleCount.toLocaleString('th-TH')} จาก ${totalMatches.toLocaleString('th-TH')} รายการ`
        : `${totalMatches.toLocaleString('th-TH')} รายการ`;

    const bomHtml = visibleBomRows.map((row, index) => {
        const componentName = localizeComponentName(
            componentNameMap[row.component_product_code],
            row.component_product_code
        ) || '-';
        return `
        <tr data-bom-id="${row.id}" class="${selectedBomId === row.id ? 'active' : ''}">
            <td class="sequence-column">${index + 1}</td>
            <td>${row.product_code}</td>
            <td>${row.component_product_code}</td>
            <td>${componentName}</td>
            <td>${row.component_qty}</td>
        </tr>
    `;
    }).join('');

    const masterHtml = visibleMasterRows.map((item, index) => `
        <tr data-master-code="${item.product_code}" class="master-only-row">
            <td class="sequence-column">${visibleBomRows.length + index + 1}</td>
            <td>${item.product_code}</td>
            <td><span style="color:#f59e0b;font-weight:600;">ยังไม่มี BOM</span></td>
            <td>${item.product_name || '-'}</td>
            <td>-</td>
        </tr>
    `).join('');

    const limitNoticeHtml = totalMatches > BOM_RENDER_LIMIT
        ? `<tr><td colspan="5" class="empty-state">แสดงสูงสุด ${BOM_RENDER_LIMIT.toLocaleString('th-TH')} แถว กรุณาใช้ช่องค้นหาเพื่อดูรายการอื่น</td></tr>`
        : '';

    bomTableBody.innerHTML = bomHtml + masterHtml + limitNoticeHtml;
}

async function loadBomRows() {
    bomRowsLoaded = false;
    if (!isRefreshing) renderBomRows();
    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        return;
    }

    try {
        const { data, error, count } = await dbClient
            .from('stock_bom')
            .select('id, product_code, component_product_code, component_qty', { count: 'exact' })
            .order('product_code', { ascending: true })
            .order('component_product_code', { ascending: true })
            .order('id', { ascending: true })
            .range(0, BOM_RENDER_LIMIT - 1);

        if (error) throw error;
        bomRows = data || [];
        bomTotalCount = count ?? bomRows.length;
        bomRows.forEach(row => knownProductsWithBom.add(normalizeCode(row.product_code)));
        await loadComponentNames(bomRows.map(row => row.component_product_code));
        selectedBomId = null;
        bomRowsLoaded = true;
        if (!isRefreshing) renderBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`โหลด BOM ล้มเหลว: ${error.message}`, 'error');
    }
}

async function loadComponentNames(codes) {
    const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
    if (!uniqueCodes.length || !dbClient) return;

    try {
        const chunkSize = 500;
        for (let index = 0; index < uniqueCodes.length; index += chunkSize) {
            const { data, error } = await dbClient
                .from('stock_items')
                .select('product_code, product_name')
                .in('product_code', uniqueCodes.slice(index, index + chunkSize));
            if (error) throw error;
            (data || []).forEach(item => {
                componentNameMap[item.product_code] = localizeComponentName(item.product_name, item.product_code);
            });
        }
    } catch (error) {
        console.warn('ไม่สามารถโหลดชื่อ SKU ชิ้นส่วนได้:', error);
    }
}

function resetBomForm(keepStatus = false) {
    bomForm.reset();
    selectedBomId = null;
    selectedBomParent = null;
    if (componentsListEl) componentsListEl.innerHTML = '';
    if (!keepStatus) clearStatus();
}

function setBomForm(row) {
    // Populate form for editing whole parent BOM
    const parent = row.product_code || '';
    bomParentSkuInput.value = parent;
    selectedBomParent = parent;
    // clear existing component rows
    if (componentsListEl) componentsListEl.innerHTML = '';
    // add all components for this parent
    const comps = bomRows.filter(r => r.product_code === parent);
    if (comps.length) {
        comps.forEach(c => addComponentRow({ code: c.component_product_code, name: componentNameMap[c.component_product_code] || '', qty: c.component_qty }));
    } else {
        addComponentRow();
    }
    selectedBomId = row.id;
    renderBomRows();
}

async function rememberProductsWithBom(productCodes) {
    const uniqueCodes = Array.from(new Set(productCodes.map(normalizeCode).filter(Boolean)));
    if (!uniqueCodes.length || !dbClient) return;

    for (let index = 0; index < uniqueCodes.length; index += 500) {
        const { data, error } = await dbClient
            .from('stock_bom')
            .select('product_code')
            .in('product_code', uniqueCodes.slice(index, index + 500));
        if (error) throw error;
        (data || []).forEach(row => knownProductsWithBom.add(normalizeCode(row.product_code)));
    }
}

async function loadSkuMasterRows() {
    skuMasterRowsLoaded = false;
    if (!isRefreshing) renderBomRows();
    if (!dbClient) return;
    try {
        const { data, error, count } = await dbClient
            .from('sku_master')
            .select('product_code, name', { count: 'exact' })
            .order('product_code', { ascending: true })
            .range(0, BOM_RENDER_LIMIT - 1);
        if (error) throw error;

        skuMasterRows = (data || []).map(item => ({
            product_code: item.product_code,
            product_name: item.name || item.product_code
        }));
        skuMasterTotalCount = count ?? skuMasterRows.length;
        await rememberProductsWithBom(skuMasterRows.map(item => item.product_code));
        skuMasterRowsLoaded = true;
        if (!isRefreshing) renderBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`โหลด SKU Master ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function refreshAllData() {
    isRefreshing = true;
    bomRowsLoaded = false;
    skuMasterRowsLoaded = false;
    knownProductsWithBom = new Set();
    componentNameMap = {};
    renderBomRows();
    const bomPromise = loadBomRows();
    const skuPromise = loadSkuMasterRows();
    await bomPromise;
    renderBomRows();
    await skuPromise;
    isRefreshing = false;
    renderBomRows();
}

async function searchStockItems(query) {
    if (!dbClient || !query) return [];
    try {
        const { data, error } = await dbClient
            .from('stock_items')
            .select('product_code, product_name')
            .or(`product_code.ilike.%${query}%,product_name.ilike.%${query}%`)
            .order('product_code', { ascending: true })
            .limit(12);
        if (error) throw error;
        return (data || []).map(item => ({
            ...item,
            product_name: localizeComponentName(item.product_name, item.product_code)
        }));
    } catch (error) {
        console.warn('ค้นหา stock_items ไม่สำเร็จ:', error);
        return [];
    }
}

function hideSuggestions() {
    if (bomParentSuggestionsEl) bomParentSuggestionsEl.classList.remove('show');
}

function addComponentRow(data = {}) {
    if (!componentsListEl) return;
    const id = `comp-${++compRowCounter}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'component-row';
    wrapper.dataset.compId = id;
    wrapper.innerHTML = `
        <div class="comp-grid" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <div style="flex:1">
                <input class="comp-code" placeholder="SKU \u0e0a\u0e34\u0e49\u0e19\u0e2a\u0e48\u0e27\u0e19" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
                <div class="comp-suggestions" style="position:relative"></div>
            </div>
            <div style="flex:1">
                <input class="comp-name" placeholder="\u0e0a\u0e37\u0e48\u0e2d\u0e0a\u0e34\u0e49\u0e19\u0e2a\u0e48\u0e27\u0e19" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
            </div>
            <div style="width:110px">
                <input class="comp-qty" type="number" min="1" value="1" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
            </div>
            <div style="width:40px;text-align:center">
                <button type="button" class="btn-remove-comp" title="\u0e25\u0e1a\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23">×</button>
            </div>
        </div>
    `;
    componentsListEl.appendChild(wrapper);

    const codeInput = wrapper.querySelector('.comp-code');
    const nameInput = wrapper.querySelector('.comp-name');
    const qtyInput = wrapper.querySelector('.comp-qty');
    const suggestionsEl = wrapper.querySelector('.comp-suggestions');
    const removeBtn = wrapper.querySelector('.btn-remove-comp');

    if (data.code) codeInput.value = data.code;
    if (data.name) nameInput.value = data.name;
    if (data.qty) qtyInput.value = data.qty;

    let rowTimer = null;
    codeInput.addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim();
        if (rowTimer) clearTimeout(rowTimer);
        if (!q) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('show'); return; }
        rowTimer = setTimeout(async () => {
            const results = await searchStockItems(q);
            suggestionsEl.innerHTML = results.map(item => `
                <div class="suggestion-item" data-code="${item.product_code}" data-name="${item.product_name || ''}" style="padding:6px;border-bottom:1px solid rgba(0,0,0,0.03);cursor:pointer;">
                    <div style="font-weight:600">${item.product_code}</div>
                    <div style="font-size:12px;color:#666">${item.product_name || '-'}</div>
                </div>
            `).join('');
            suggestionsEl.classList.add('show');
        }, 220);
    });

    suggestionsEl.addEventListener('click', (ev) => {
        const it = ev.target.closest('.suggestion-item');
        if (!it) return;
        const c = it.dataset.code;
        const n = it.dataset.name || '';
        codeInput.value = c;
        nameInput.value = n;
        suggestionsEl.classList.remove('show');
    });

    removeBtn.addEventListener('click', () => {
        wrapper.remove();
    });
}

function getComponentsFromForm() {
    if (!componentsListEl) return [];
    const rows = Array.from(componentsListEl.querySelectorAll('.component-row'));
    return rows.map(r => {
        const code = (r.querySelector('.comp-code')?.value || '').trim();
        const name = (r.querySelector('.comp-name')?.value || '').trim();
        const qty = parseInt(r.querySelector('.comp-qty')?.value || '1') || 1;
        return { code, name, qty };
    }).filter(c => c.code);
}

function renderParentSuggestions(items) {
    if (!bomParentSuggestionsEl) return;
    if (!items || !items.length) {
        bomParentSuggestionsEl.classList.remove('show');
        bomParentSuggestionsEl.innerHTML = '';
        return;
    }

    bomParentSuggestionsEl.innerHTML = items.map(item => `
        <div class="suggestion-item" data-code="${item.product_code}" data-name="${item.product_name || ''}">
            <span class="suggestion-label">${item.product_code}</span>
            <span class="suggestion-subtitle">${item.product_name || '-'}</span>
        </div>
    `).join('');
    bomParentSuggestionsEl.classList.add('show');
}

function fillParentSku(code, name) {
    bomParentSkuInput.value = code;
    if (bomParentSuggestionsEl) bomParentSuggestionsEl.classList.remove('show');
}

async function searchParentSkus(query, limit = 12) {
    if (!dbClient || !query) return [];
    try {
        const { data, error } = await dbClient
            .from('sku_master')
            .select('product_code, name')
            .or(`product_code.ilike.%${query}%,name.ilike.%${query}%`)
            .order('product_code', { ascending: true })
            .limit(limit);
        if (error) throw error;
        return (data || []).map(item => ({
            product_code: item.product_code,
            product_name: item.name || item.product_code
        }));
    } catch (error) {
        console.warn('ค้นหา sku_master ไม่สำเร็จ:', error);
        return [];
    }
}

async function handleParentSearchInput(event) {
    const query = String(event.target.value || '').trim();
    if (parentSearchTimer) clearTimeout(parentSearchTimer);
    if (!query) {
        if (bomParentSuggestionsEl) {
            bomParentSuggestionsEl.classList.remove('show');
            bomParentSuggestionsEl.innerHTML = '';
        }
        return;
    }

    parentSearchTimer = setTimeout(async () => {
        const results = await searchParentSkus(query);
        renderParentSuggestions(results);
    }, 240);
}

async function loadCompleteBomForParent(code) {
    const normalizedCode = normalizeCode(code);
    const { data, error } = await dbClient
        .from('stock_bom')
        .select('id, product_code, component_product_code, component_qty')
        .ilike('product_code', normalizedCode)
        .order('component_product_code', { ascending: true })
        .range(0, BOM_RENDER_LIMIT - 1);
    if (error) throw error;

    const completeRows = data || [];
    if (completeRows.length) {
        bomRows = [
            ...bomRows.filter(row => normalizeCode(row.product_code) !== normalizedCode),
            ...completeRows
        ];
        knownProductsWithBom.add(normalizedCode);
        await loadComponentNames(completeRows.map(row => row.component_product_code));
    }
    return completeRows;
}

async function openSkuFromGlobalSearch(code) {
    bomSearchInput.value = code;
    appliedSearchTerm = String(code || '').trim();

    try {
        const completeRows = await loadCompleteBomForParent(code);
        if (completeRows.length) {
            setBomForm(completeRows[0]);
            showStatus(`เปิด BOM ของ ${code} แล้ว`, 'success');
            return;
        }
    } catch (error) {
        showStatus(`โหลด BOM ของ ${code} ไม่สำเร็จ: ${error.message}`, 'error');
        return;
    }

    resetBomForm();
    bomParentSkuInput.value = code;
    selectedBomId = null;
    selectedBomParent = null;
    addComponentRow();
    renderBomRows();
    showStatus(`พบ ${code} ใน SKU Master และพร้อมสร้าง BOM ใหม่`, 'success');
}

async function runBomSearch() {
    appliedSearchTerm = String(bomSearchInput.value || '').trim();
    if (!appliedSearchTerm) {
        await refreshAllData();
        return;
    }

    const safeTerm = appliedSearchTerm.replace(/[%(),]/g, ' ').trim();
    if (!safeTerm) return;

    bomRowsLoaded = false;
    skuMasterRowsLoaded = false;
    componentNameMap = {};
    renderBomRows();

    try {
        const [bomResult, skuResult] = await Promise.all([
            dbClient
                .from('stock_bom')
                .select('id, product_code, component_product_code, component_qty', { count: 'exact' })
                .or(`product_code.ilike.%${safeTerm}%,component_product_code.ilike.%${safeTerm}%`)
                .order('product_code', { ascending: true })
                .order('component_product_code', { ascending: true })
                .range(0, BOM_RENDER_LIMIT - 1),
            dbClient
                .from('sku_master')
                .select('product_code, name', { count: 'exact' })
                .or(`product_code.ilike.%${safeTerm}%,name.ilike.%${safeTerm}%`)
                .order('product_code', { ascending: true })
                .range(0, BOM_RENDER_LIMIT - 1)
        ]);

        if (bomResult.error) throw bomResult.error;
        if (skuResult.error) throw skuResult.error;

        bomRows = bomResult.data || [];
        bomTotalCount = bomResult.count ?? bomRows.length;
        skuMasterRows = (skuResult.data || []).map(item => ({
            product_code: item.product_code,
            product_name: item.name || item.product_code
        }));
        skuMasterTotalCount = skuResult.count ?? skuMasterRows.length;
        knownProductsWithBom = new Set(bomRows.map(row => normalizeCode(row.product_code)));

        await Promise.all([
            loadComponentNames(bomRows.map(row => row.component_product_code)),
            rememberProductsWithBom(skuMasterRows.map(item => item.product_code))
        ]);
    } catch (error) {
        console.error(error);
        showStatus(`ค้นหา BOM ไม่สำเร็จ: ${error.message}`, 'error');
        bomRows = [];
        skuMasterRows = [];
        bomTotalCount = 0;
    } finally {
        bomRowsLoaded = true;
        skuMasterRowsLoaded = true;
        renderBomRows();
    }
}

function handleBomSearchKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runBomSearch();
}

async function getStockItemByCode(productCode) {
    if (!dbClient || !productCode) return null;
    const { data, error } = await dbClient
        .from('stock_items')
        .select('id, product_name')
        .eq('product_code', productCode)
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function getParentSkuByCode(productCode) {
    if (!dbClient || !productCode) return null;
    const { data, error } = await dbClient
        .from('sku_master')
        .select('product_code, name')
        .eq('product_code', productCode)
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function ensureStockItemExists(productCode, productName) {
    const normalizedName = localizeComponentName(productName, productCode);
    const existing = await getStockItemByCode(productCode);
    if (existing) {
        if (normalizedName && existing.product_name !== normalizedName) {
            const { error } = await dbClient
                .from('stock_items')
                .update({ product_name: normalizedName })
                .eq('id', existing.id);
            if (error) throw error;
        }
        return existing;
    }

    const payload = {
        product_code: productCode,
        product_name: normalizedName || productCode,
        quantity: 0,
        unit: 'ชิ้น',
        category: 'general'
    };
    const { data, error } = await dbClient
        .from('stock_items')
        .insert([payload])
        .select('id, product_name')
        .single();
    if (error) throw error;
    return data;
}

async function saveBom(event) {
    event.preventDefault();
    clearStatus();
    const productCode = (bomParentSkuInput?.value || '').trim();
    if (!productCode) {
        showStatus('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e01\u0e23\u0e2d\u0e01 SKU \u0e2b\u0e25\u0e31\u0e01', 'error');
        return;
    }

    try {
        const components = getComponentsFromForm();
        if (!components.length) {
            showStatus('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e19\u0e49\u0e2d\u0e22 1 \u0e0a\u0e34\u0e49\u0e19\u0e2a\u0e48\u0e27\u0e19', 'error');
            return;
        }

        const componentCodes = components.map(component => normalizeCode(component.code));
        const duplicateComponentCode = componentCodes.find((code, index) =>
            componentCodes.indexOf(code) !== index
        );
        if (duplicateComponentCode) {
            showStatus(`SKU ชิ้นส่วน ${duplicateComponentCode} ซ้ำในแบบฟอร์ม กรุณารวมเป็นรายการเดียว`, 'error');
            return;
        }

        const normalizedProductCode = normalizeCode(productCode);
        const { data: existingBomRow, error: existingBomError } = await dbClient
            .from('stock_bom')
            .select('id')
            .ilike('product_code', normalizedProductCode)
            .limit(1)
            .maybeSingle();
        if (existingBomError) throw existingBomError;
        const existingBomForProduct = Boolean(existingBomRow);
        const isEditingSameBom = selectedBomParent &&
            normalizeCode(selectedBomParent) === normalizedProductCode;
        if (existingBomForProduct && !isEditingSameBom) {
            showStatus(`SKU หลัก ${productCode} มี BOM อยู่แล้ว ไม่สามารถเพิ่ม BOM ซ้ำได้`, 'error');
            return;
        }

        const parentSku = await getParentSkuByCode(productCode);
        if (!parentSku) {
            showStatus('\u0e44\u0e21\u0e48\u0e1e\u0e1a SKU \u0e2b\u0e25\u0e31\u0e01\u0e43\u0e19 sku_master \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01 SKU \u0e2b\u0e25\u0e31\u0e01\u0e08\u0e32\u0e01\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32', 'error');
            return;
        }

        // ensure each component exists (and update name if provided)
        for (const c of components) {
            await ensureStockItemExists(c.code, c.name);
        }

        const payloads = components.map(c => ({ product_code: productCode, component_product_code: c.code, component_qty: c.qty }));
        const { error } = await dbClient.from('stock_bom').upsert(payloads, {
            onConflict: 'product_code,component_product_code'
        });
        if (error) throw error;

        // Remove obsolete rows only after the new BOM has been stored successfully.
        const previousParent = selectedBomParent || bomRows.find(row => row.id === selectedBomId)?.product_code;
        if (previousParent) {
            const isSameParent = normalizeCode(previousParent) === normalizedProductCode;
            const activeComponentCodes = new Set(componentCodes);
            const staleIds = bomRows
                .filter(row => normalizeCode(row.product_code) === normalizeCode(previousParent))
                .filter(row => !isSameParent || !activeComponentCodes.has(normalizeCode(row.component_product_code)))
                .map(row => row.id)
                .filter(id => id != null);

            if (staleIds.length) {
                const { error: delErr } = await dbClient.from('stock_bom').delete().in('id', staleIds);
                if (delErr) throw delErr;
            }
        }
        showStatus('\u0e40\u0e1e\u0e34\u0e48\u0e21/\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15 BOM \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08\u0e41\u0e25\u0e49\u0e27', 'success');

        resetBomForm(true);
        await loadBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 BOM \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ${error.message}`, 'error');
    }
}

async function deleteBom() {
    if (!selectedBomParent) {
        showStatus('\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01 BOM \u0e17\u0e35\u0e48\u0e15\u0e49\u0e2d\u0e07\u0e01\u0e32\u0e23\u0e25\u0e1a\u0e01\u0e48\u0e2d\u0e19', 'error');
        return;
    }

    const relatedRows = bomRows.filter(row => row.product_code === selectedBomParent);
    const relatedCount = relatedRows.length;
    if (!relatedCount) {
        showStatus('ไม่พบรายการ BOM ของ SKU หลักนี้แล้ว', 'error');
        return;
    }

    if (!confirm(`ยืนยันการลบ BOM ของ SKU หลัก ${selectedBomParent} จำนวน ${relatedCount} รายการ?`)) return;

    try {
        const { error } = await dbClient.from('stock_bom').delete().eq('product_code', selectedBomParent);
        if (error) throw error;
        showStatus('\u0e25\u0e1a BOM \u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08\u0e41\u0e25\u0e49\u0e27', 'success');
        resetBomForm(true);
        await loadBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`\u0e25\u0e1a BOM \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ${error.message}`, 'error');
    }
}

function clearBomForm() {
    resetBomForm();
    hideSuggestions();
}

function startNewBom() {
    const sourceProductCode = (bomParentSkuInput.value || '').trim();
    const copiedComponents = getComponentsFromForm();

    resetBomForm();
    hideSuggestions();
    if (copiedComponents.length) {
        copiedComponents.forEach(component => addComponentRow(component));
    } else {
        addComponentRow();
    }
    renderBomRows();
    showStatus(
        copiedComponents.length
            ? `คัดลอกชิ้นส่วน ${copiedComponents.length} รายการจาก ${sourceProductCode || 'BOM เดิม'} แล้ว กรุณาเลือก SKU หลักใหม่`
            : 'ยังไม่มีรายการชิ้นส่วนให้คัดลอก กรุณาเลือก SKU หลักและระบุชิ้นส่วน',
        'success'
    );
    bomParentSkuInput.focus();
}

async function handleTableClick(event) {
    const masterRow = event.target.closest('tr[data-master-code]');
    if (masterRow) {
        await openSkuFromGlobalSearch(masterRow.dataset.masterCode);
        return;
    }

    const row = event.target.closest('tr[data-bom-id]');
    if (!row) return;
    const id = Number(row.dataset.bomId);
    let bomRow = bomRows.find(item => item.id === id);
    if (!bomRow) return;
    try {
        const completeRows = await loadCompleteBomForParent(bomRow.product_code);
        bomRow = completeRows[0] || bomRow;
        setBomForm(bomRow);
    } catch (error) {
        showStatus(`โหลดรายละเอียด BOM ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

function handleDocumentClick(event) {
    const target = event.target;
    const insideParent = bomParentSuggestionsEl && bomParentSuggestionsEl.contains(target);
    const isParentInput = target.id === 'bomParentSku';
    if (!insideParent && !isParentInput) {
        hideSuggestions();
    }

}

async function initializePage() {
    dbClient = window.auth?.supabase || (window.supabase && window.SUPABASE_CONFIG
        ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
        : null);

    if (!dbClient) {
        showStatus('ไม่พบ Supabase client กรุณาตรวจสอบ config.js', 'error');
        return;
    }

    bomForm.addEventListener('submit', saveBom);
    deleteBomBtn.addEventListener('click', deleteBom);
    clearBomBtn.addEventListener('click', clearBomForm);
    newBomBtn.addEventListener('click', startNewBom);
    refreshBtn.addEventListener('click', refreshAllData);
    bomTableBody.addEventListener('click', handleTableClick);
    bomSearchBtn.addEventListener('click', runBomSearch);
    bomSearchInput.addEventListener('keydown', handleBomSearchKeydown);
    if (bomStatusFilter) bomStatusFilter.addEventListener('change', runBomSearch);
    // addComponent button
    if (addComponentBtn) addComponentBtn.addEventListener('click', () => addComponentRow());
    // Parent SKU autocomplete listeners
    if (bomParentSkuInput) {
        bomParentSkuInput.addEventListener('input', handleParentSearchInput);
    }
    if (bomParentSuggestionsEl) {
        bomParentSuggestionsEl.addEventListener('click', event => {
            const item = event.target.closest('.suggestion-item');
            if (!item) return;
            fillParentSku(item.dataset.code, item.dataset.name);
        });
    }
    document.addEventListener('click', handleDocumentClick);

    resetBomForm();
    // ensure there's at least one empty component row
    if (componentsListEl && !componentsListEl.querySelector('.component-row')) addComponentRow();
    await refreshAllData();
}

document.addEventListener('DOMContentLoaded', initializePage);

