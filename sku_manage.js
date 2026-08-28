const SKU_REF = window.SKU_REFERENCE;
if (!SKU_REF) throw new Error('ไม่พบข้อมูลอ้างอิง SKU กรุณาตรวจสอบ sku_reference.js');

const PRODUCT_TYPES = SKU_REF.productTypes;
const PANEL_OPTIONS = SKU_REF.panels;
const DIMENSIONS = SKU_REF.dimensions;
const FRAME_COLORS = SKU_REF.frameColors;
const GLASS_COLORS = SKU_REF.glassColors;
const PATTERNS = SKU_REF.patterns;

const skuForm = document.getElementById('skuForm');
const statusEl = document.getElementById('formStatus');
const skuTableBody = document.getElementById('skuTableBody');
const skuCountEl = document.getElementById('skuCount');
const skuSearchInput = document.getElementById('skuSearch');
const submitBtn = document.getElementById('submitBtn');
const deleteBtn = document.getElementById('deleteBtn');
const resetBtn = document.getElementById('resetBtn');
const newSkuBtn = document.getElementById('newSkuBtn');
const productCodeInput = document.getElementById('productCode');
const nameInput = document.getElementById('name');
const productTypeSelect = document.getElementById('productType');
const panelCountSelect = document.getElementById('panelCount');
const heightSelect = document.getElementById('heightCode');
const widthSelect = document.getElementById('widthCode');
const sizeInput = document.getElementById('size');
const patternCodeSelect = document.getElementById('patternCode');
const patternInput = document.getElementById('pattern');
const frameColorSelect = document.getElementById('frameColor');
const glassColorSelect = document.getElementById('glassColor');
const netSelect = document.getElementById('netId');
const productImageFileInput = document.getElementById('productImageFile');
const skuImagePreview = document.getElementById('skuImagePreview');

let dbClient = null;
let skuRows = [];
let selectedProductCode = null;
let selectedImageFile = null;
let previewObjectUrl = null;
let skuManageInitialized = false;
let skuDataLoaded = false;
let skuSearchDebounceTimer = null;
let latestSkuSearchRequestId = 0;

const SKU_LIST_PAGE_SIZE = 200;
const SKU_SEARCH_RESULT_LIMIT = 100;
const SKU_SEARCH_DEBOUNCE_MS = 250;
const SKU_SELECT_COLUMNS = 'product_code, name, size, slots, product_prefix, pattern, pattern_code, frame_color_code, glass_color_code, net_id';

function renderSkuImagePreview(imageUrl = '') {
    if (previewObjectUrl && imageUrl !== previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
    skuImagePreview.replaceChildren();
    if (!imageUrl) {
        const icon = document.createElement('span');
        icon.textContent = '📷';
        const text = document.createElement('small');
        text.textContent = 'ยังไม่มีรูปสินค้า';
        skuImagePreview.append(icon, text);
        return;
    }
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = `รูปสินค้า ${productCodeInput.value || ''}`;
    skuImagePreview.appendChild(image);
}

async function loadSkuImage(productCode) {
    if (!dbClient || !productCode) {
        renderSkuImagePreview();
        return;
    }
    const { data, error } = await dbClient
        .from('product_images')
        .select('image_url')
        .eq('sku', productCode)
        .maybeSingle();
    if (error) {
        console.warn('โหลดรูป SKU ไม่สำเร็จ:', error.message);
        renderSkuImagePreview();
        return;
    }
    renderSkuImagePreview(data?.image_url || '');
}

async function uploadSkuImage(productCode) {
    if (!selectedImageFile) return null;
    const extension = (selectedImageFile.name.split('.').pop() || 'jpg').toLowerCase();
    const safeSku = productCode.replace(/[^A-Z0-9_-]/gi, '_');
    const objectPath = `${safeSku}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await runWithNetworkRetry(() => dbClient.storage
        .from('product-images')
        .upload(objectPath, selectedImageFile, { cacheControl: '3600', upsert: true }));
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = dbClient.storage.from('product-images').getPublicUrl(objectPath);
    const imageUrl = publicUrlData?.publicUrl;
    if (!imageUrl) throw new Error('ไม่สามารถสร้าง URL รูปสินค้าได้');

    const { error: imageError } = await runWithNetworkRetry(() => dbClient.from('product_images').upsert({
        sku: productCode,
        image_url: imageUrl
    }, { onConflict: 'sku' }));
    if (imageError) throw imageError;
    return imageUrl;
}

function showStatus(message, type = 'success') {
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
}

function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'status-message';
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function runWithNetworkRetry(requestFactory, attempts = 3) {
    let lastResult;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            lastResult = await requestFactory();
            const message = String(lastResult?.error?.message || '');
            const isNetworkError = /failed to fetch|network|quic|load failed/i.test(message);
            if (!lastResult?.error || !isNetworkError || attempt === attempts) return lastResult;
        } catch (error) {
            const isNetworkError = /failed to fetch|network|quic|load failed/i.test(String(error?.message || error));
            if (!isNetworkError || attempt === attempts) throw error;
        }
        await wait(500 * attempt);
    }
    return lastResult;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function setOptions(selectEl, items, placeholder) {
    const currentValue = selectEl.value;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        Object.entries(item.dataset || {}).forEach(([key, value]) => {
            option.dataset[key] = String(value);
        });
        selectEl.appendChild(option);
    });
    if (currentValue && Array.from(selectEl.options).some(option => option.value === currentValue)) {
        selectEl.value = currentValue;
    }
}

function getSelectedOption(selectEl) {
    return selectEl.options[selectEl.selectedIndex] || null;
}

function loadExcelReferenceOptions() {
    const productTypes = PRODUCT_TYPES.map(type => ({
        value: type.code,
        label: `${type.code} - ${type.name}`,
        dataset: { productName: type.name }
    }));
    const panelCounts = PANEL_OPTIONS.map(panel => ({
        value: String(panel.count),
        label: `${panel.code} - ${panel.count} บาน`,
        dataset: { panelCode: panel.code }
    }));

    const dimensions = DIMENSIONS.map(item => ({
        value: item.code,
        label: `${item.size} (${item.code})`,
        dataset: { size: item.size }
    }));

    setOptions(productTypeSelect, productTypes, '-- เลือกประเภทสินค้า --');
    setOptions(panelCountSelect, panelCounts, '-- เลือกจำนวนบาน --');
    setOptions(heightSelect, dimensions, '-- เลือกความกว้าง --');
    setOptions(widthSelect, dimensions, '-- เลือกความสูง --');
    setOptions(frameColorSelect, FRAME_COLORS.map(item => ({
        value: item.code,
        label: `${item.code} - ${item.name}`,
        dataset: { colorName: item.name }
    })), '-- เลือกสีกรอบ --');
    setOptions(glassColorSelect, GLASS_COLORS.map(item => ({
        value: item.code,
        label: `${item.code} - ${item.name}`,
        dataset: { colorName: item.name }
    })), '-- เลือกสีกระจก --');
    setOptions(patternCodeSelect, PATTERNS.map(item => ({
        value: item.dbCode,
        label: `${item.skuCode} - ${item.name}`,
        dataset: { skuCode: item.skuCode, patternName: item.name }
    })), '-- เลือกลาย --');
}

function inferNetSkuCode(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'x' || normalized === 'ไม่มีมุ้ง' || normalized.includes('ไม่มีมุ้ง')) return 'X';
    if (normalized === 'n' || normalized === 'มีมุ้ง' || normalized.includes('มีมุ้ง')) return 'N';
    return '';
}

async function loadNetOptions() {
    const { data, error } = await dbClient
        .from('mosquito_nets')
        .select('net_id, net_status')
        .order('net_id', { ascending: true });
    if (error) throw error;

    const options = (data || []).map(item => {
        const skuCode = inferNetSkuCode(item.net_status);
        return {
            value: String(item.net_id),
            label: `${skuCode || item.net_status} - ${skuCode === 'N' ? 'มีมุ้ง' : (skuCode === 'X' ? 'ไม่มีมุ้ง' : item.net_status)}`,
            dataset: {
                skuCode,
                netName: skuCode === 'N' ? 'มีมุ้ง' : (skuCode === 'X' ? 'ไม่มีมุ้ง' : item.net_status)
            }
        };
    });
    setOptions(netSelect, options, '-- เลือกสถานะมุ้ง --');
}

function buildAutoName() {
    const typeOption = getSelectedOption(productTypeSelect);
    const heightOption = getSelectedOption(heightSelect);
    const widthOption = getSelectedOption(widthSelect);
    const frameOption = getSelectedOption(frameColorSelect);
    const glassOption = getSelectedOption(glassColorSelect);
    const netOption = getSelectedOption(netSelect);
    const patternOption = getSelectedOption(patternCodeSelect);

    if (!productTypeSelect.value || !panelCountSelect.value || !heightSelect.value || !widthSelect.value) return '';
    const parts = [
        typeOption?.dataset.productName,
        `${panelCountSelect.value} บาน`,
        `ขนาด ${heightOption?.dataset.size}x${widthOption?.dataset.size}`,
        frameColorSelect.value ? `กรอบ${frameOption?.dataset.colorName}` : '',
        glassColorSelect.value ? `กระจก${glassOption?.dataset.colorName}` : '',
        netOption?.dataset.netName,
        patternOption?.dataset.patternName
    ];
    return parts.filter(Boolean).join(' ');
}

function updateGeneratedFields() {
    const heightOption = getSelectedOption(heightSelect);
    const widthOption = getSelectedOption(widthSelect);
    const netOption = getSelectedOption(netSelect);
    const patternOption = getSelectedOption(patternCodeSelect);

    sizeInput.value = heightSelect.value && widthSelect.value
        ? `${heightOption?.dataset.size}x${widthOption?.dataset.size}`
        : '';
    patternInput.value = patternOption?.dataset.patternName || '';

    productCodeInput.value = productTypeSelect.value && panelCountSelect.value ? SKU_REF.buildProductCode({
        productType: productTypeSelect.value,
        panelCount: Number(panelCountSelect.value),
        height: heightOption?.dataset.size,
        width: widthOption?.dataset.size,
        frameColor: frameColorSelect.value,
        glassColor: glassColorSelect.value,
        net: netOption?.dataset.skuCode,
        pattern: patternOption?.dataset.skuCode
    }) : '';

    if (nameInput.dataset.autoGenerated === 'true') {
        nameInput.value = buildAutoName();
    }
}

function resetForm() {
    skuForm.reset();
    selectedProductCode = null;
    nameInput.dataset.autoGenerated = 'true';
    productCodeInput.value = '';
    sizeInput.value = '';
    patternInput.value = '';
    selectedImageFile = null;
    productImageFileInput.value = '';
    renderSkuImagePreview();
    clearStatus();
    renderSkuRows();
    productTypeSelect.focus();
}

function renderSkuRows() {
    if (!skuRows.length) {
        skuCountEl.textContent = '0 รายการ';
        skuTableBody.innerHTML = '<tr><td colspan="3" class="empty-state">ไม่พบข้อมูล SKU</td></tr>';
        return;
    }

    skuTableBody.innerHTML = skuRows.map(row => `
        <tr data-product-code="${escapeHtml(row.product_code)}" class="${selectedProductCode === row.product_code ? 'active' : ''}">
            <td>${escapeHtml(row.product_code || '-')}</td>
            <td>${escapeHtml(row.name || '-')}</td>
            <td>${escapeHtml(row.size || '-')}</td>
        </tr>
    `).join('');
}

function updateSkuCountLabel(displayCount, totalCount, term = '') {
    if (term) {
        skuCountEl.textContent = totalCount > displayCount
            ? `${displayCount}/${totalCount} รายการ`
            : `${displayCount} รายการ`;
        return;
    }

    skuCountEl.textContent = totalCount > displayCount
        ? `ล่าสุด ${displayCount}/${totalCount}`
        : `${displayCount} รายการ`;
}

function buildSkuQuery(term = '') {
    const normalizedTerm = term.trim();
    let query = dbClient
        .from('sku_master')
        .select(SKU_SELECT_COLUMNS, { count: 'exact' })
        .order('product_code', { ascending: true });

    if (!normalizedTerm) {
        return query.range(0, SKU_LIST_PAGE_SIZE - 1);
    }

    const escapedTerm = normalizedTerm
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_')
        .replaceAll(',', '\\,');

    return query
        .or([
            `product_code.ilike.%${escapedTerm}%`,
            `name.ilike.%${escapedTerm}%`,
            `size.ilike.%${escapedTerm}%`,
            `product_prefix.ilike.%${escapedTerm}%`,
            `pattern.ilike.%${escapedTerm}%`
        ].join(','))
        .range(0, SKU_SEARCH_RESULT_LIMIT - 1);
}

async function loadSkus(term = '') {
    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        return;
    }

    const requestId = ++latestSkuSearchRequestId;
    const normalizedTerm = term.trim();

    try {
        skuTableBody.innerHTML = '<tr><td colspan="3" class="empty-state">กำลังค้นหา...</td></tr>';

        const { data, error, count } = await runWithNetworkRetry(() => buildSkuQuery(normalizedTerm));
        if (requestId !== latestSkuSearchRequestId) return;
        if (error) throw error;

        skuRows = data || [];
        updateSkuCountLabel(skuRows.length, count ?? skuRows.length, normalizedTerm);
        renderSkuRows();
    } catch (error) {
        if (requestId !== latestSkuSearchRequestId) return;
        console.error(error);
        skuRows = [];
        updateSkuCountLabel(0, 0, normalizedTerm);
        renderSkuRows();
        showStatus(`โหลด SKU ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

function parseProductCode(productCode) {
    const parsed = SKU_REF.parseProductCode(productCode);
    if (!parsed) return null;
    return {
        prefix: parsed.productPrefix,
        productType: parsed.productType,
        panelCount: parsed.panelCount,
        heightCode: parsed.heightCode,
        widthCode: parsed.widthCode,
        frameCode: parsed.frameColor,
        glassCode: parsed.glassColor,
        netSkuCode: parsed.net,
        patternDbCode: parsed.patternCode
    };
}

function selectNetBySkuCode(skuCode) {
    const option = Array.from(netSelect.options).find(item => item.dataset.skuCode === skuCode);
    netSelect.value = option?.value || '';
}

async function loadSelectedSku(productCode) {
    if (!dbClient || !productCode) return;
    try {
        const { data, error } = await dbClient
            .from('sku_master')
            .select('product_code, name, size, slots, product_prefix, pattern, pattern_code, frame_color_code, glass_color_code, net_id')
            .eq('product_code', productCode)
            .maybeSingle();
        if (error) throw error;
        if (!data) return;

        const parsed = parseProductCode(data.product_code);
        const storedPrefix = /^(.*?)(\d+)P$/.exec(data.product_prefix || '');
        productTypeSelect.value = parsed?.productType || storedPrefix?.[1] || '';
        panelCountSelect.value = String(data.slots || parsed?.panelCount || storedPrefix?.[2] || '');
        heightSelect.value = parsed?.heightCode || '';
        widthSelect.value = parsed?.widthCode || '';
        frameColorSelect.value = data.frame_color_code || parsed?.frameCode || '';
        glassColorSelect.value = data.glass_color_code || parsed?.glassCode || '';
        const storedPatternCode = String(data.pattern_code ?? parsed?.patternDbCode ?? '');
        patternCodeSelect.value = storedPatternCode === 'X1'
            ? '6'
            : storedPatternCode.replace(/^L/i, '');
        netSelect.value = data.net_id != null ? String(data.net_id) : '';
        if (!netSelect.value && parsed?.netSkuCode) selectNetBySkuCode(parsed.netSkuCode);

        nameInput.dataset.autoGenerated = 'false';
        updateGeneratedFields();
        productCodeInput.value = data.product_code || productCodeInput.value;
        nameInput.value = data.name || buildAutoName();
        sizeInput.value = data.size || sizeInput.value;
        patternInput.value = data.pattern || patternInput.value;
        selectedProductCode = data.product_code;
        renderSkuRows();
        await loadSkuImage(data.product_code);
    } catch (error) {
        console.error(error);
        showStatus(`โหลดรายละเอียด SKU ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function ensureSelectedLookups() {
    const typeOption = getSelectedOption(productTypeSelect);
    const frameOption = getSelectedOption(frameColorSelect);
    const glassOption = getSelectedOption(glassColorSelect);
    const patternOption = getSelectedOption(patternCodeSelect);

    const requestFactories = [
        () => dbClient.from('products').upsert([{
            product_prefix: `${productTypeSelect.value}${panelCountSelect.value}P`,
            product_name: `${typeOption.dataset.productName} ${panelCountSelect.value} บาน`
        }], { onConflict: 'product_prefix' }),
        () => dbClient.from('aluminum_colors').upsert([{
            color_code: frameColorSelect.value,
            color_name: frameOption.dataset.colorName
        }], { onConflict: 'color_code' }),
        () => dbClient.from('glass_colors').upsert([{
            color_code: glassColorSelect.value,
            color_name: glassOption.dataset.colorName
        }], { onConflict: 'color_code' }),
        () => dbClient.from('patterns').upsert([{
            pattern_code: patternCodeSelect.value,
            pattern_name: patternOption.dataset.patternName
        }], { onConflict: 'pattern_code' })
    ];

    const results = await Promise.all(requestFactories.map(factory => runWithNetworkRetry(factory)));
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;
}

async function handleSubmit(event) {
    event.preventDefault();
    clearStatus();
    updateGeneratedFields();

    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        return;
    }

    const payload = {
        product_code: productCodeInput.value.trim(),
        name: nameInput.value.trim(),
        product_prefix: productTypeSelect.value && panelCountSelect.value
            ? `${productTypeSelect.value}${panelCountSelect.value}P`
            : null,
        size: sizeInput.value.trim(),
        slots: Number(panelCountSelect.value || 1),
        pattern: patternInput.value.trim() || null,
        pattern_code: patternCodeSelect.value || null,
        net_id: netSelect.value ? Number(netSelect.value) : null,
        frame_color_code: frameColorSelect.value || null,
        glass_color_code: glassColorSelect.value || null
    };

    if (!payload.product_code || !payload.name || !payload.size || !payload.net_id) {
        showStatus('กรุณาเลือกข้อมูล SKU ให้ครบทุกช่อง', 'error');
        return;
    }
    if (selectedProductCode && selectedProductCode !== payload.product_code) {
        showStatus('ไม่สามารถเปลี่ยนรหัสของ SKU เดิมได้ กรุณากด “SKU ใหม่” เพื่อสร้างรายการใหม่', 'error');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก...';
    try {
        await ensureSelectedLookups();
        const { error } = await runWithNetworkRetry(() => dbClient
            .from('sku_master')
            .upsert([payload], { onConflict: 'product_code' }));
        if (error) throw error;
        const uploadedImageUrl = await uploadSkuImage(payload.product_code);
        showStatus('บันทึก SKU สำเร็จแล้ว', 'success');
        if (uploadedImageUrl) {
            selectedImageFile = null;
            productImageFileInput.value = '';
            renderSkuImagePreview(uploadedImageUrl);
        }
        selectedProductCode = payload.product_code;
        nameInput.dataset.autoGenerated = 'false';
        await loadSkus();
        await loadSelectedSku(payload.product_code);
    } catch (error) {
        console.error(error);
        showStatus(`บันทึกไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึก SKU';
    }
}

async function handleDelete() {
    const code = productCodeInput.value.trim();
    if (!code || !confirm(`ลบ SKU ${code} พร้อมรูปสินค้าทั้งหมดจริงหรือไม่?`)) return;

    try {
        const { data: imageRows, error: imageLookupError } = await runWithNetworkRetry(() => dbClient
            .from('product_images')
            .select('image_url')
            .eq('sku', code));
        if (imageLookupError) throw imageLookupError;

        const { data: deletedSkuRows, error } = await runWithNetworkRetry(() => dbClient
            .from('sku_master')
            .delete()
            .eq('product_code', code)
            .select('product_code'));
        if (error) throw error;
        if (!deletedSkuRows?.length) throw new Error('ไม่มีสิทธิ์ลบ SKU หรือไม่พบ SKU นี้');

        let imageCleanupWarning = '';
        try {
            const { error: imageDeleteError } = await runWithNetworkRetry(() => dbClient
                .from('product_images')
                .delete()
                .eq('sku', code));
            if (imageDeleteError) throw imageDeleteError;

            const marker = '/storage/v1/object/public/product-images/';
            const objectPaths = (imageRows || [])
                .map(row => {
                    const imageUrl = String(row.image_url || '');
                    const markerIndex = imageUrl.indexOf(marker);
                    return markerIndex >= 0
                        ? decodeURIComponent(imageUrl.slice(markerIndex + marker.length))
                        : null;
                })
                .filter(Boolean);
            if (objectPaths.length > 0) {
                const { error: storageDeleteError } = await runWithNetworkRetry(() => dbClient.storage
                    .from('product-images')
                    .remove([...new Set(objectPaths)]));
                if (storageDeleteError) throw storageDeleteError;
            }
        } catch (cleanupError) {
            console.error('ล้างรูป SKU ไม่สำเร็จ:', cleanupError);
            imageCleanupWarning = ` แต่ล้างรูปไม่ครบ: ${cleanupError.message}`;
        }

        resetForm();
        showStatus(`ลบ SKU สำเร็จแล้ว${imageCleanupWarning}`, imageCleanupWarning ? 'error' : 'success');
        await loadSkus();
    } catch (error) {
        console.error(error);
        showStatus(`ลบ SKU ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function initializePage() {
    if (skuManageInitialized) return;
    skuManageInitialized = true;

    if (window.location.protocol === 'file:') {
        window.location.replace('http://localhost:8000/sku_manage.html');
        return;
    }
    dbClient = window.auth?.supabase || (window.supabase && window.SUPABASE_CONFIG
        ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
        : null);
    if (!dbClient) {
        showStatus('ไม่พบ Supabase client กรุณาตรวจสอบ config.js', 'error');
        return;
    }

    loadExcelReferenceOptions();
    try {
        await loadNetOptions();
    } catch (error) {
        console.error(error);
        showStatus(`โหลดข้อมูลมุ้งไม่สำเร็จ: ${error.message}`, 'error');
    }

    [productTypeSelect, panelCountSelect, heightSelect, widthSelect, frameColorSelect, glassColorSelect, netSelect, patternCodeSelect]
        .forEach(element => element.addEventListener('change', updateGeneratedFields));
    nameInput.addEventListener('input', () => {
        nameInput.dataset.autoGenerated = 'false';
    });
    productImageFileInput.addEventListener('change', event => {
        const file = event.target.files?.[0] || null;
        if (!file) {
            selectedImageFile = null;
            loadSkuImage(selectedProductCode || productCodeInput.value);
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
            showStatus('รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ GIF', 'error');
            event.target.value = '';
            selectedImageFile = null;
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showStatus('รูปสินค้าต้องมีขนาดไม่เกิน 5 MB', 'error');
            event.target.value = '';
            selectedImageFile = null;
            return;
        }
        selectedImageFile = file;
        previewObjectUrl = URL.createObjectURL(file);
        renderSkuImagePreview(previewObjectUrl);
        clearStatus();
    });
    skuForm.addEventListener('submit', handleSubmit);
    deleteBtn.addEventListener('click', handleDelete);
    newSkuBtn.addEventListener('click', resetForm);
    resetBtn.addEventListener('click', event => {
        event.preventDefault();
        resetForm();
    });
    skuSearchInput.addEventListener('input', () => {
        const term = skuSearchInput.value || '';
        clearTimeout(skuSearchDebounceTimer);
        skuSearchDebounceTimer = setTimeout(() => {
            loadSkus(term).catch(error => {
                console.error(error);
                showStatus(`ค้นหา SKU ไม่สำเร็จ: ${error.message}`, 'error');
            });
        }, SKU_SEARCH_DEBOUNCE_MS);
    });
    skuTableBody.addEventListener('click', event => {
        const row = event.target.closest('tr[data-product-code]');
        if (!row) return;
        selectedProductCode = row.dataset.productCode;
        renderSkuRows();
        loadSelectedSku(selectedProductCode);
    });

    resetForm();

    const loadInitialSkuData = async () => {
        if (skuDataLoaded) return;
        skuDataLoaded = true;
        await loadSkus();
    };

    if (window.auth?.role) {
        await loadInitialSkuData();
        return;
    }

    window.addEventListener('auth-ready', () => {
        loadInitialSkuData().catch(error => {
            console.error(error);
            skuDataLoaded = false;
            showStatus(`โหลด SKU ไม่สำเร็จ: ${error.message}`, 'error');
        });
    }, { once: true });
}

document.addEventListener('DOMContentLoaded', initializePage);
