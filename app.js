// ==========================================
// CONFIGURATION - Shared with auth.js
// ==========================================
// Identifiers like SUPABASE_URL are managed by auth.js to prevent conflicts
const SUPABASE_TABLE_NAME = 'stock_orders';

// ==========================================
// DEBUG LOGGER
// ==========================================
function log(msg, type = 'info') {
    const logDiv = document.getElementById('statusLog');
    if (logDiv) {
        logDiv.style.display = 'block';
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logDiv.prepend(entry);
    }
    console.log(`[${type}] ${msg}`);
}

window.onerror = function(message, source, lineno, colno, error) {
    log(`Runtime Error: ${message} at ${lineno}:${colno}`, 'error');
    return false;
};

const ALLOWED_GLASS_COLORS = window.SKU_REFERENCE
    ? window.SKU_REFERENCE.glassColors.map(item => item.name)
    : ['ใส', 'เขียว', 'ชาดำ', 'ฝ้า', 'ลอนแก้ว', 'กระจกสีอื่นๆ'];
const ALLOWED_SCREEN_TYPES = ['มีมุ้ง', 'ไม่มีมุ้ง'];

const mosquitoNetCache = {};
const aluminumColorCache = {};
const glassColorCache = {};

async function resolveColorName(colorCode, type = 'aluminum') {
    const normalized = normalizeString(colorCode);
    if (!normalized || !dbSupabase) return null;
    
    const cache = type === 'glass' ? glassColorCache : aluminumColorCache;
    const tableName = type === 'glass' ? 'glass_colors' : 'aluminum_colors';
    
    if (cache[normalized]) return cache[normalized];

    try {
        const { data, error } = await dbSupabase.from(tableName).select('color_name').eq('color_code', normalized).maybeSingle();
        if (error) {
            log(`❌ ไม่สามารถอ่านชื่อสีจาก ${tableName}: ${error.message}`, 'error');
            return null;
        }
        const colorName = data?.color_name || null;
        if (colorName) cache[normalized] = colorName;
        return colorName;
    } catch (e) {
        log(`❌ เกิดข้อผิดพลาดขณะอ่าน ${tableName}: ${e.message}`, 'error');
        return null;
    }
}

async function resolveMosquitoNetStatus(netIdOrStatus) {
    if (netIdOrStatus === null || netIdOrStatus === undefined) return null;
    const normalized = String(netIdOrStatus).trim();
    if (normalized === '') return null;
    if (mosquitoNetCache[normalized]) return mosquitoNetCache[normalized];

    // ถ้าเป็นค่าตัวอักษร x/n ให้ตีความเป็น net_status โดยตรง
    if (normalized.toLowerCase() === 'x') {
        mosquitoNetCache[normalized] = 'ไม่มีมุ้ง';
        return 'ไม่มีมุ้ง';
    }
    if (normalized.toLowerCase() === 'n') {
        mosquitoNetCache[normalized] = 'มีมุ้ง';
        return 'มีมุ้ง';
    }

    try {
        let query = dbSupabase.from('mosquito_nets').select('net_status');
        const asNumber = Number(normalized);
        if (!Number.isNaN(asNumber) && Number.isInteger(asNumber)) {
            query = query.eq('net_id', asNumber);
        } else {
            query = query.eq('net_status', normalized);
        }
        const { data, error } = await query.maybeSingle();
        if (error) {
            log(`❌ ไม่สามารถอ่าน net_status จาก mosquito_nets: ${error.message}`, 'error');
            return null;
        }
        const status = data?.net_status || null;
        mosquitoNetCache[normalized] = status;
        return status;
    } catch (e) {
        log(`❌ เกิดข้อผิดพลาดขณะอ่าน mosquito_nets: ${e.message}`, 'error');
        return null;
    }
}

function normalizeString(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
}

function normalizeGlassColor(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    if (ALLOWED_GLASS_COLORS.includes(normalized)) return normalized;

    const lower = normalized.toLowerCase();
    const cleaned = lower.replace(/\(.*?\)/g, '').replace(/[^a-zก-๙0-9]+/g, ' ').trim();
    const tokens = cleaned.split(' ').filter(Boolean);

    const lookup = {
        'clear': 'ใส',
        'transparent': 'ใส',
        'ใส': 'ใส',
        'c': 'ใส',
        'green': 'เขียว',
        'g': 'เขียว',
        'เขียว': 'เขียว',
        'เขียวตัดแสง': 'เขียว',
        'tea': 'ชาดำ',
        't': 'ชาดำ',
        'b': 'ชาดำ',
        'ชา': 'ชาดำ',
        'ชาดำ': 'ชาดำ',
        'frost': 'ฝ้า',
        'matte': 'ฝ้า',
        'f': 'ฝ้า',
        'ฝ้า': 'ฝ้า',
        'lg': 'ลอนแก้ว',
        'ลอนแก้ว': 'ลอนแก้ว',
        'eg': 'กระจกสีอื่นๆ',
        'กระจกสีอื่นๆ': 'กระจกสีอื่นๆ'
    };

    for (const token of tokens) {
        if (lookup[token]) {
            return lookup[token];
        }
    }

    if (lower.includes('ใส')) return 'ใส';
    if (lower.includes('เขียว')) return 'เขียว';
    if (lower.includes('ชา')) return 'ชาดำ';
    if (lower.includes('ฝ้า')) return 'ฝ้า';
    if (lower.includes('ลอนแก้ว')) return 'ลอนแก้ว';
    if (lower.includes('กระจกสีอื่น')) return 'กระจกสีอื่นๆ';

    return null;
}

function normalizeScreenType(value) {
    const normalized = normalizeString(value);
    if (!normalized) return null;
    if (ALLOWED_SCREEN_TYPES.includes(normalized)) return normalized;

    const lookup = {
        'yes': 'มีมุ้ง',
        'y': 'มีมุ้ง',
        'n': 'มีมุ้ง',
        'มี': 'มีมุ้ง',
        'no': 'ไม่มีมุ้ง',
        'x': 'ไม่มีมุ้ง',
        'ไม่มี': 'ไม่มีมุ้ง'
    };

    return lookup[normalized.toLowerCase()] || null;
}

function normalizePattern(value) {
    const normalized = normalizeString(value);
    if (!normalized) return 'L0';
    const reference = window.SKU_REFERENCE;
    if (reference) {
        const pattern = reference.patterns.find(item =>
            item.skuCode.toLowerCase() === normalized.toLowerCase() ||
            item.dbCode === normalized ||
            item.name === normalized ||
            (normalized === 'X1' && item.skuCode === 'L6')
        );
        if (pattern) return pattern.skuCode;
    }
    return normalized.toUpperCase();
}

function isValidProductionNumberString(value) {
    return /^\s*\d+\/\d{1,2}\s*$/.test(String(value));
}

async function validateOrderSkuReferences(items) {
    const references = new Map();
    const rowsWithoutSku = [];

    (items || []).forEach(item => {
        const productCode = normalizeString(item?.product_code);
        const orderNumber = normalizeString(item?.order_number) || '-';
        if (!productCode) {
            rowsWithoutSku.push(orderNumber);
            return;
        }
        if (!references.has(productCode)) references.set(productCode, new Set());
        references.get(productCode).add(orderNumber);
    });

    const productCodes = [...references.keys()];
    const existingCodes = new Set();
    const chunkSize = 80;

    for (let index = 0; index < productCodes.length; index += chunkSize) {
        const chunk = productCodes.slice(index, index + chunkSize);
        const { data, error } = await dbSupabase
            .from('sku_master')
            .select('product_code')
            .in('product_code', chunk);
        if (error) {
            throw new Error(`ตรวจสอบ SKU Master ไม่สำเร็จ: ${error.message}`);
        }
        (data || []).forEach(row => existingCodes.add(String(row.product_code).trim()));
    }

    const missing = productCodes
        .filter(code => !existingCodes.has(code))
        .map(code => ({ code, orders: [...references.get(code)] }));

    return { missing, rowsWithoutSku };
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

function formatProductionNumber(dateValue, sequence) {
    const dateKey = getBangkokDateKey(dateValue || new Date());
    if (!dateKey) return null;
    const day = String(Number(dateKey.slice(-2)));
    const seq = String(sequence);
    return `${seq}/${day}`;
}

function getBangkokDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

async function generateProductionNumber(orderDateValue, existingValue = null) {
    const manualValue = normalizeString(existingValue);
    if (manualValue) {
        const normalized = normalizeProductionNumberString(manualValue);
        if (normalized) {
            return normalized;
        }
        log(`เลขที่การผลิตไม่ตรงรูปแบบ ${manualValue} — จะสร้างใหม่อัตโนมัติ`, 'warn');
    }

    const dateKey = getBangkokDateKey(orderDateValue || new Date());
    if (!dateKey) return null;
    const day = String(Number(dateKey.slice(-2)));
    const suffix = `/${day}`;

    if (!dbSupabase) return `1${suffix}`;

    try {
        const { data, error } = await dbSupabase
            .from(SUPABASE_TABLE_NAME)
            .select('production_number, payment_time, order_date')
            .not('production_number', 'is', null)
            .ilike('production_number', `%${suffix}`);

        if (!error && Array.isArray(data)) {
            const matches = data
                .filter(item => getBangkokDateKey(item.order_date || item.payment_time) === dateKey)
                .map(item => normalizeString(item.production_number))
                .filter(Boolean)
                .map(value => {
                    const parts = value.split('/');
                    const num = parts[1] === day ? parseInt(parts[0], 10) : null;
                    return Number.isInteger(num) ? num : null;
                })
                .filter(value => value !== null);

            if (matches.length) {
                const next = Math.max(...matches) + 1;
                return `${next}${suffix}`;
            }
        }
    } catch (e) {
        log(`ไม่สามารถสร้างเลขที่การผลิตอัตโนมัติ: ${e.message}`, 'warn');
    }

    const fallback = `1${suffix}`;
    return fallback;
}

const productionNumberUploadCache = {};

async function generateProductionNumberForUpload(orderDateValue, existingValue = null) {
    const manualValue = normalizeString(existingValue);
    if (manualValue) {
        const normalized = normalizeProductionNumberString(manualValue);
        if (normalized) return normalized;
        log(`เลขที่การผลิตไม่ตรงรูปแบบ ${manualValue} — จะสร้างใหม่อัตโนมัติ`, 'warn');
    }

    const dateKey = getBangkokDateKey(orderDateValue || new Date());
    if (!dateKey) return null;
    const day = String(Number(dateKey.slice(-2)));
    const cacheKey = `date-${dateKey}`;

    // 1. If we already have a sequence generated in this batch for this day, increment it
    if (productionNumberUploadCache[cacheKey]) {
        const seq = productionNumberUploadCache[cacheKey]++;
        return `${seq}/${day}`;
    }

    // 2. Otherwise, fetch the next sequence from database
    const generated = await generateProductionNumber(orderDateValue, null);
    let result = generated;
    if (!result) {
        result = getNextProductionNumberForUpload(orderDateValue);
        log(`ไม่สามารถสร้างเลขที่ผลิตจากฐานข้อมูลได้ — สร้างแบบ fallback: ${result}`, 'warn');
    }
    if (!result) return null;

    const currentSeq = parseInt(result.split('/')[0] || '1', 10);
    // Initialize cache to next seq
    productionNumberUploadCache[cacheKey] = currentSeq + 1;
    return `${currentSeq}/${day}`;
}

function getNextProductionNumberForUpload(orderDateValue) {
    const dateKey = getBangkokDateKey(orderDateValue || new Date());
    if (!dateKey) return null;
    const day = String(Number(dateKey.slice(-2)));
    const cacheKey = `date-${dateKey}`;
    if (!productionNumberUploadCache[cacheKey]) productionNumberUploadCache[cacheKey] = 1;
    const seq = productionNumberUploadCache[cacheKey]++;
    return `${seq}/${day}`;
}

// แปลง "22/6/2026 23:59" (รูปแบบ Shopee ไทย d/m/yyyy HH:MM) → ISO timestamptz Asia/Bangkok
function parseShopeeDate(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' && value !== null && typeof value.getTime === 'function') {
        return isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)) && Number(value) > 30000 && Number(value) < 100000)) {
        const num = Number(value);
        const utcMs = (num - 25569) * 86400 * 1000;
        const d = new Date(utcMs);
        return isNaN(d.getTime()) ? null : d.toISOString();
    }
    let s = String(value).trim();
    if (!s) return null;

    // YYYY-MM-DD HH:MM:SS or YYYY/MM/DD ...
    const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ymdMatch) {
        let year = parseInt(ymdMatch[1], 10);
        if (year > 2500) year -= 543;
        const month = parseInt(ymdMatch[2], 10) - 1;
        const day = parseInt(ymdMatch[3], 10);
        const hour = ymdMatch[4] !== undefined ? parseInt(ymdMatch[4], 10) : 23;
        const min = ymdMatch[5] !== undefined ? parseInt(ymdMatch[5], 10) : 59;
        const sec = ymdMatch[6] !== undefined ? parseInt(ymdMatch[6], 10) : 0;
        const utcMs = Date.UTC(year, month, day, hour - 7, min, sec);
        const d = new Date(utcMs);
        if (!isNaN(d.getTime())) return d.toISOString();
    }

    // DD/MM/YYYY HH:MM:SS or DD-MM-YYYY ...
    const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10) - 1;
        let year = parseInt(dmyMatch[3], 10);
        if (year > 2500) year -= 543;
        const hour = dmyMatch[4] !== undefined ? parseInt(dmyMatch[4], 10) : 23;
        const min = dmyMatch[5] !== undefined ? parseInt(dmyMatch[5], 10) : 59;
        const sec = dmyMatch[6] !== undefined ? parseInt(dmyMatch[6], 10) : 0;
        const utcMs = Date.UTC(year, month, day, hour - 7, min, sec);
        const d = new Date(utcMs);
        if (!isNaN(d.getTime())) return d.toISOString();
    }

    // DD MMM YYYY HH:MM or DD MMM YYYY
    const monthNames = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11
    };
    const mmmMatch = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (mmmMatch) {
        const day = parseInt(mmmMatch[1], 10);
        const monthName = mmmMatch[2].toLowerCase();
        const month = monthNames[monthName];
        let year = parseInt(mmmMatch[3], 10);
        const hour = mmmMatch[4] !== undefined ? parseInt(mmmMatch[4], 10) : 23;
        const min = mmmMatch[5] !== undefined ? parseInt(mmmMatch[5], 10) : 59;
        const sec = mmmMatch[6] !== undefined ? parseInt(mmmMatch[6], 10) : 0;
        if (month !== undefined) {
            const utcMs = Date.UTC(year, month, day, hour - 7, min, sec);
            const d = new Date(utcMs);
            if (!isNaN(d.getTime())) return d.toISOString();
        }
    }

    const isoString = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
    const d = new Date(isoString);
    return !isNaN(d.getTime()) ? d.toISOString() : null;
}

// Normalize various payment time inputs into ISO timestamptz string or null
function normalizePaymentTime(value) {
    if (value === null || value === undefined) return null;
    try {
        if (typeof value === 'object' && value !== null && 'value' in value) {
            value = value.value;
        }
    } catch (e) {
        // ignore
    }

    const parsed = parseShopeeDate(value);
    if (parsed) return parsed;

    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        return value.toISOString();
    }

    return null;
}

// Initialize Supabase Client
// Use the existing client from auth.js if available
let dbSupabase = (window.auth && window.auth.supabase) ? window.auth.supabase : null; 

try {
    if (!dbSupabase) {
        log("กำลังเตรียมการเชื่อมต่อ Supabase ใหม่...");
        // Fallback: ใช้ค่าจาก config.js ที่ถูก gitignore (อ่านไว้ใน window.SUPABASE_CONFIG)
        if (window.supabase && window.SUPABASE_CONFIG) {
            dbSupabase = window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY);
            log("เชื่อมต่อ Supabase สำเร็จ (Client Ready)", "success");
        } else if (!window.SUPABASE_CONFIG) {
            log("ไม่พบ config.js — กรุณาสร้างไฟล์ config.js ก่อนใช้งาน (ดูตัวอย่างจาก config.example.js)", "error");
        } else {
            log("ไม่พบ Supabase Library ในระบบ", "error");
        }
    } else {
        log("ใช้งานการเชื่อมต่อ Supabase จาก Auth System", "success");
    }
} catch (e) {
    log(`Supabase Init Failed: ${e.message}`, "error");
}

async function loadProductImagePreview(skuCode) {
    const previewContainer = document.getElementById('productImagePreview');
    if (!previewContainer) return;

    const normalizedSku = (skuCode || '').trim();
    if (!normalizedSku || !dbSupabase) {
        previewContainer.innerHTML = '📷 รูปสินค้าจะปรากฏที่นี่เมื่อค้นหา SKU แล้ว';
        return;
    }

    previewContainer.innerHTML = '⏳ กำลังค้นหารูปสินค้า...';

    try {
        const { data, error } = await dbSupabase
            .from('product_images')
            .select('image_url')
            .eq('sku', normalizedSku)
            .maybeSingle();

        if (error) throw error;

        const imageUrl = data?.image_url?.trim();
        if (!imageUrl) {
            previewContainer.innerHTML = '📷 ไม่พบรูปภาพสำหรับ SKU นี้';
            return;
        }

        previewContainer.innerHTML = `
            <div style="display:flex; align-items:flex-start; gap:0.7rem; flex-wrap:wrap;">
                <img id="productImagePreviewImg" src="${imageUrl}" alt="รูปสินค้า ${normalizedSku}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid rgba(129,140,248,0.35);margin-top:0px;flex-shrink:0;">
                <div style="display:flex; flex-direction:column; gap:0.2rem;justify-content:flex-start;padding-top:2px;">
                    <div style="font-size:0.85rem; color:#a5b4fc;">📷 รูปสินค้า</div>
                    <a href="${imageUrl}" target="_blank" rel="noopener noreferrer" style="color:#818cf8; text-decoration:none; font-size:0.9rem;">เปิดรูปภาพ</a>
                </div>
            </div>`;
    } catch (err) {
        console.warn('Product image lookup failed:', err);
        previewContainer.innerHTML = '📷 ไม่สามารถดึงรูปภาพได้ในขณะนี้';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    log("หน้าเว็บ (UI) โหลดเสร็จสมบูรณ์");
    
    // Set default date to today
    const orderDateInput = document.getElementById('orderDate');
    if (orderDateInput) orderDateInput.valueAsDate = new Date();

    const form = document.getElementById('stockForm');
    const submitBtn = document.getElementById('submitBtn');
    const productionNumberInput = document.getElementById('productionNumber');

    if (productionNumberInput) {
        productionNumberInput.value = '';
        productionNumberInput.readOnly = true;
        productionNumberInput.placeholder = 'ระบบจะสร้างอัตโนมัติเมื่อบันทึก';
    }
    
    if (!submitBtn) {
        log("ไม่พบปุ่มบันทึก (submitBtn) ในหน้าเว็บ", "error");
        return;
    }

    // ==========================================
    // AUTOFILL PRODUCT DATA BY SKU
    // ==========================================
    const productCodeInput = document.getElementById('productCode');
    const productFetchStatus = document.getElementById('productFetchStatus');
    const btnFetchSku = document.getElementById('btnFetchSku');

    function isMissingRelationshipError(error) {
        const message = String(error?.message || '').toLowerCase();
        return error?.code === 'PGRST200' || message.includes('relationship');
    }
    
    async function fetchSkuData() {
        if (!productCodeInput || !dbSupabase) return;
        const code = productCodeInput.value.trim();
        if (!code) {
            if (productFetchStatus) productFetchStatus.textContent = '';
            await loadProductImagePreview('');
            return;
        }
        await loadProductImagePreview(code);
        
        if (productFetchStatus) {
            productFetchStatus.textContent = '⏳ กำลังค้นหาข้อมูล...';
            productFetchStatus.style.color = '#fbbf24';
        }
        
        try {
            let { data, error } = await dbSupabase
                .from('sku_master')
                .select('*, frame_color:aluminum_colors(color_name), glass_color:glass_colors(color_name), glass_color_code, net_id')
                .ilike('product_code', code)
                .maybeSingle();

            if (isMissingRelationshipError(error)) {
                ({ data, error } = await dbSupabase
                    .from('sku_master')
                    .select('*')
                    .ilike('product_code', code)
                    .maybeSingle());
            }
                
            if (error) throw error;
            
            if (data) {
                if (productFetchStatus) {
                    productFetchStatus.textContent = '✅ พบข้อมูลสินค้า';
                    productFetchStatus.style.color = '#34d399';
                }
                
                const skuName = data.name || '';
                const skuPattern = normalizePattern(data.pattern_code ?? data.pattern);
                if (skuName) document.getElementById('productName').value = skuName;
                if (data.size) document.getElementById('productSize').value = data.size;
                if (data.slots != null) document.getElementById('slots').value = data.slots;
                if (data.price != null) document.getElementById('price').value = data.price;
                
                // เติมช่องลายอัตโนมัติ
                const patternInput = document.getElementById('pattern');
                if (patternInput) patternInput.value = skuPattern;

                // เติมสีอลูมิเนียม, สีกระจก (ใช้ชื่อสีจาก JOIN)
                const aluminumEl = document.getElementById('aluminum_color');
                const aluminumName = data.frame_color?.color_name || data.frame_color_code || null;
                if (aluminumEl && aluminumName) aluminumEl.value = aluminumName;
                const glassEl = document.getElementById('glass_color');
                const glassName = data.glass_color?.color_name || data.glass_color_code || null;
                if (glassEl) {
                    let normalizedGlass = normalizeGlassColor(glassName);
                    if (!normalizedGlass && data.glass_color_code) {
                        const resolvedGlassName = await resolveColorName(data.glass_color_code, 'glass');
                        normalizedGlass = normalizeGlassColor(resolvedGlassName || data.glass_color_code);
                    }
                    if (normalizedGlass) {
                        glassEl.value = normalizedGlass;
                    } else {
                        log(`⚠️ ไม่สามารถแปลงค่าสีกระจก '${glassName}' เป็นค่าที่รองรับ`, 'warn');
                    }
                }

                // เติมประเภทมุ้งจาก net_id โดย query ตาราง mosquito_nets แยกต่างหาก
                const screenEl = document.getElementById('screen_type');
                if (screenEl) {
                    const netStatus = await resolveMosquitoNetStatus(data.net_id);
                    const screenName = netStatus || normalizeScreenType(data.net_id) || null;
                    screenEl.value = normalizeScreenType(screenName) || '';
                }

                log(`ดึงข้อมูลสำเร็จ: ${skuName} | ไซส์: ${data.size} | ช่อง: ${data.slots} | ลาย: ${skuPattern || 'ไม่มี'}`, 'success');
            } else {
                if (productFetchStatus) {
                    productFetchStatus.textContent = '⚠️ ไม่พบรหัสนี้ในฐานข้อมูล (SKU Master)';
                    productFetchStatus.style.color = '#f87171'; // Red to make it obvious
                }
            }
        } catch (err) {
            console.error("Autofill Error: ", err);
            if (productFetchStatus) {
                productFetchStatus.textContent = '❌ ค้นหาล้มเหลว (อาจเป็นที่สิทธิ์ของฐานข้อมูล)';
                productFetchStatus.style.color = '#f87171';
            }
        }
    }

    if (productCodeInput) {
        productCodeInput.addEventListener('input', () => {
            if (!productCodeInput.value.trim()) {
                loadProductImagePreview('');
            }
        });
        productCodeInput.addEventListener('blur', fetchSkuData);
        productCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); fetchSkuData(); }
        });
    }
    if (btnFetchSku) {
        btnFetchSku.addEventListener('click', fetchSkuData);
    }

    log("กำลังติดตั้งระบบปุ่มบันทึก...");
    submitBtn.addEventListener('click', async (e) => {
        log("มีการคลิกปุ่มบันทึก (Manual Save Clicked)");
        e.preventDefault();

        if (!form || !form.checkValidity()) {
            const invalidFields = form ? Array.from(form.querySelectorAll(':invalid')) : [];
            const missingLabels = invalidFields.map(field => {
                const label = field.id ? form.querySelector(`label[for="${field.id}"]`) : null;
                return label?.textContent?.trim() || field.name || field.id || 'ช่องข้อมูลที่จำเป็น';
            });
            const uniqueLabels = [...new Set(missingLabels)];
            const missingText = uniqueLabels.length ? `\n\nกรุณาตรวจสอบ: ${uniqueLabels.join(', ')}` : '';

            log(`ตรวจสอบล้มเหลว: ข้อมูลในฟอร์มไม่ครบถ้วน${uniqueLabels.length ? ` (${uniqueLabels.join(', ')})` : ''}`, "error");
            alert(`❌ กรุณากรอกข้อมูลในช่องที่จำเป็นให้ครบถ้วนก่อนกดบันทึกครับ${missingText}`);
            if (invalidFields[0]) {
                invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                invalidFields[0].focus({ preventScroll: true });
            }
            if (form) form.reportValidity();
            return;
        }

        const btnText = submitBtn.querySelector('.btn-text');
        const btnLoader = submitBtn.querySelector('.btn-loader');
        const statusMessage = document.getElementById('statusMessage');

        // UI Loading state
        submitBtn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnLoader) btnLoader.style.display = 'inline';
        if (statusMessage) {
            statusMessage.className = 'status-message';
            statusMessage.style.display = 'none';
        }

        log("กำลังอ่านข้อมูลจากฟอร์ม...");
        try {
            const orderNumber = document.getElementById('orderNumber').value.trim();
            if (!dbSupabase) throw new Error("Supabase Client ไม่พร้อมทำงาน");

            const manualProductCode = normalizeString(document.getElementById('productCode')?.value);
            const manualSkuValidation = await validateOrderSkuReferences([{
                order_number: orderNumber,
                product_code: manualProductCode
            }]);
            if (manualSkuValidation.rowsWithoutSku.length) {
                throw new Error('กรุณาระบุ SKU ที่มีอยู่ใน sku_master ก่อนบันทึกออเดอร์');
            }
            if (manualSkuValidation.missing.length) {
                throw new Error(
                    `ไม่พบ SKU ${manualSkuValidation.missing[0].code} ใน sku_master กรุณาเพิ่ม SKU ในหน้า จัดการ SKU ก่อนบันทึกออเดอร์`
                );
            }

            // -- เริ่มระบบอัปโหลดรูปภาพ (ถ้ามี) --
            const bookImageInput = document.getElementById('bookImage');
            let uploadedImageUrl = null;
            
            if (bookImageInput && bookImageInput.files.length > 0) {
                const file = bookImageInput.files[0];
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                log(`กำลังอัปโหลดรูปภาพใบbook: ${fileName}`);
                if (statusMessage) {
                    statusMessage.textContent = 'กำลังอัปโหลดรูปภาพใบbook... ⏳';
                    statusMessage.style.display = 'block';
                    statusMessage.className = 'status-message';
                }

                const { data: uploadData, error: uploadError } = await dbSupabase
                    .storage
                    .from('book_images')
                    .upload(fileName, file);

                if (uploadError) {
                    log(`อัปโหลดรูปภาพล้มเหลว: ${uploadError.message}`, "error");
                    throw new Error(`อัปโหลดรูปล้มเหลว: ${uploadError.message}`);
                }

                const { data: publicUrlData } = dbSupabase
                    .storage
                    .from('book_images')
                    .getPublicUrl(fileName);

                uploadedImageUrl = publicUrlData.publicUrl;
                log(`อัปโหลดรูปภาพสำเร็จ: ${uploadedImageUrl}`, "success");
            }

            const formData = {
                is_test: !!(document.getElementById("isTestOrder") && document.getElementById("isTestOrder").checked),
                order_date: document.getElementById('orderDate').value,
                platform: document.getElementById('platform').value,
                order_number: orderNumber,
                production_number: null,
                product_code: manualProductCode,
                product_name: document.getElementById('productName').value,
                product_size: document.getElementById('productSize').value || null,
                slots: document.getElementById('slots').value ? parseInt(document.getElementById('slots').value) : null,
                quantity: parseInt(document.getElementById('quantity').value),
                price: parseFloat(document.getElementById('price').value),
                shipping_fee: parseFloat(document.getElementById('shippingFee').value || 0),
                buyer_name: document.getElementById('buyerName').value,
                address: document.getElementById('address').value || null,
                province: document.getElementById('province').value,
                tracking_status: document.getElementById('status').value,
                book_image_url: uploadedImageUrl,
                payment_time: normalizePaymentTime(document.getElementById('paymentTime') ? document.getElementById('paymentTime').value : null),
                note: document.getElementById('note') ? document.getElementById('note').value || null : null,
                tracking_number: null,
                courier_phone: document.getElementById('courier_phone') ? document.getElementById('courier_phone').value || null : null,
                delivery_service: document.getElementById('deliveryService') ? document.getElementById('deliveryService').value || null : null,
                latest_location: document.getElementById('latest_location') ? document.getElementById('latest_location').value || null : null,
                aluminum_color: document.getElementById('aluminum_color') ? document.getElementById('aluminum_color').value || null : null,
                glass_color: normalizeGlassColor(document.getElementById('glass_color') ? document.getElementById('glass_color').value : null),
                screen_type: normalizeScreenType(document.getElementById('screen_type') ? document.getElementById('screen_type').value : null),
                pattern: normalizePattern(document.getElementById('pattern') ? document.getElementById('pattern').value : null)
            };
            log(`รวบรวมข้อมูลสำเร็จ: ${formData.order_number}`);
            
            log("กำลังส่งข้อมูลไปที่ Supabase Database...");
            // Debug: log payload to console (check browser console)
            console.log('[DEBUG] insert payload (manual):', formData);
            const { data, error } = await dbSupabase
                .from(SUPABASE_TABLE_NAME)
                .insert([formData])
                .select('id, production_number')
                .single();

            if (error) throw error;

            log("บันทึกลง Supabase สำเร็จ!", "success");
            if (statusMessage) {
                statusMessage.textContent = `✅ บันทึกข้อมูลสำเร็จ เลขที่ผลิต: ${data?.production_number || '-'}`;
                statusMessage.style.display = 'block';
                statusMessage.className = 'status-message status-success';
            }
            
            form.reset();
            if (orderDateInput) orderDateInput.valueAsDate = new Date();
            document.getElementById('platform').value = "";
            document.getElementById('status').value = "รอดำเนินการ";
            if (bookImageInput) bookImageInput.value = "";
            const pcInput = document.getElementById('productCode');
            if (pcInput) pcInput.value = "";
            const noteInput = document.getElementById('note');
            if (noteInput) noteInput.value = "";
            const shipByInput = document.getElementById('shipByDate');
            if (shipByInput) shipByInput.value = "";
            const patternInput2 = document.getElementById('pattern');
            if (patternInput2) patternInput2.value = "";

        } catch (error) {
            log(`บันทึกไม่สำเร็จ: ${error.message}`, "error");
            if (statusMessage) {
                statusMessage.style.display = 'block';
                statusMessage.textContent = `❌ เกิดข้อผิดพลาด: ${error.message}`;
                statusMessage.className = 'status-message status-error';
            }
            alert(`ข้อผิดพลาดการบันทึก: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            if (btnText) btnText.style.display = 'inline';
            if (btnLoader) btnLoader.style.display = 'none';
        }
    });

    // ==========================================
    // CANCEL BUTTON FOR MANUAL FORM
    // ==========================================
    const cancelManualBtn = document.getElementById('cancelManualBtn');
    if (cancelManualBtn) {
        cancelManualBtn.addEventListener('click', () => {
            if (form) {
                form.reset();
                // Reset date to today
                if (orderDateInput) orderDateInput.valueAsDate = new Date();
                // Clear production number
                if (productionNumberInput) productionNumberInput.value = '';
                // Clear status message
                const statusMessage = document.getElementById('statusMessage');
                if (statusMessage) {
                    statusMessage.className = 'status-message';
                    statusMessage.textContent = '';
                }
                // Clear product image preview
                const productImagePreview = document.getElementById('productImagePreview');
                if (productImagePreview) {
                    productImagePreview.innerHTML = '📷 รูปสินค้าจะปรากฏที่นี่เมื่อค้นหา SKU แล้ว';
                }
                log('ล้างฟอร์มบันทึกด้วยมือเรียบร้อย', 'success');
            }
        });
    }

    // ==========================================
    // EXCEL / CSV BULK UPLOAD SYSTEM
    // ==========================================
    const manualTabBtn = document.getElementById('manualTabBtn');
    const uploadTabBtn = document.getElementById('uploadTabBtn');

    if (manualTabBtn && uploadTabBtn) {
        log("กำลังติดตั้งระบบสลับแท็บ...");
        manualTabBtn.addEventListener('click', () => {
            manualTabBtn.classList.add('active');
            uploadTabBtn.classList.remove('active');
            document.getElementById('manualSection').style.display = 'block';
            document.getElementById('uploadSection').style.display = 'none';
        });
        uploadTabBtn.addEventListener('click', () => {
            uploadTabBtn.classList.add('active');
            manualTabBtn.classList.remove('active');
            document.getElementById('manualSection').style.display = 'none';
            document.getElementById('uploadSection').style.display = 'block';
        });
    }

    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    let parsedDataToUpload = [];
    let skippedShopeeMissingShipDateCount = 0;
    let skippedShopeeMissingShipDateOrders = [];

    if (dropZone) {
        log("กำลังติดตั้งระบบลากวางไฟล์...");
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFileSelect(e.target.files[0]);
        });
    }

    function handleFileSelect(file) {
        log(`เลือกไฟล์: ${file.name}`);
        const fileNameDisplay = document.getElementById('fileNameDisplay');
        if (fileNameDisplay) fileNameDisplay.innerHTML = `✅ เลือกไฟล์แล้ว:<br><span style="font-size: 0.9rem; color: #cbd5e1;">${file.name}</span>`;
        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                if (dropZone) dropZone.classList.add('processing');
                log("กำลังอ่านไฟล์ Excel...");
                await new Promise(r => setTimeout(r, 100));

                const data = new Uint8Array(e.target.result);
                log(`อ่าน Buffer สำเร็จ (${data.length} bytes) กำลังถอดรหัส...`);
                await new Promise(r => setTimeout(r, 50));

                const workbook = XLSX.read(data, {type: 'array', cellDates: true});
                log("ถอดรหัส Workbook สำเร็จ");

                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: ""});
                let rawData = [];

                // Header row auto-detection
                // A real column header row contains multiple distinct column names (>2 non-empty cells and matches multiple keywords).
                const targetHeaderKeywords = [
                    'หมายเลขคำสั่งซื้อ', 'เลขอ้างอิงsku', 'เลขอ้างอิง', 'sku', 'ชื่อสินค้า',
                    'วันที่ทำการสั่งซื้อ', 'วันที่สั่งซื้อ', 'เวลาการชำระ', 'เวลาชำระ', 'ชำระเงิน',
                    'paid', 'payment', 'หมายเลขติดตามพัสดุ', 'เลขพัสดุ', 'วันที่คาดว่าจะ', 'กำหนดจัดส่ง',
                    'ที่อยู่', 'จังหวัด', 'ชื่อผู้ใช้', 'ผู้ซื้อ', 'จำนวนเงิน', 'ordernumber', 'orderid',
                    'productname', 'createdtime', 'shipbydate', 'tracking', 'seller'
                ].map(normalizeKey);

                let bestIdx = -1;
                let bestScore = 0;

                for (let r = 0; r < Math.min(15, rows.length); r++) {
                    const cols = rows[r] || [];
                    const nonNullCols = cols.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
                    
                    // Skip title/comment rows that have fewer than 3 non-empty cells
                    if (nonNullCols.length < 3) continue;

                    let matchedKeywords = new Set();
                    for (const c of nonNullCols) {
                        const normC = normalizeKey(c);
                        for (const kw of targetHeaderKeywords) {
                            if (normC.includes(kw)) {
                                matchedKeywords.add(kw);
                            }
                        }
                    }

                    const score = matchedKeywords.size;
                    if (score > bestScore && score >= 2) {
                        bestScore = score;
                        bestIdx = r;
                    }
                }

                if (bestIdx >= 0 && bestScore >= 2) {
                    const headerRow = rows[bestIdx].map(h => h === null || h === undefined ? '' : String(h).trim());
                    console.log('[DEBUG] auto-detected header row index:', bestIdx, 'score:', bestScore, 'header:', headerRow);
                    for (let r = bestIdx + 1; r < rows.length; r++) {
                        const rowArr = rows[r];
                        if (!rowArr) continue;
                        const obj = {};
                        let hasVal = false;
                        for (let c = 0; c < headerRow.length; c++) {
                            const key = headerRow[c] || `col_${c}`;
                            const val = rowArr[c] !== undefined ? rowArr[c] : '';
                            obj[key] = val;
                            if (val !== '' && val !== null && val !== undefined) hasVal = true;
                        }
                        if (hasVal) rawData.push(obj);
                    }
                } else {
                    console.log('[DEBUG] using sheet_to_json default row 0 headers');
                    rawData = XLSX.utils.sheet_to_json(worksheet, {defval: ""});
                }

                log(`ประมวลผลเป็น JSON สำเร็จ (${rawData.length} แถว)`);
                await new Promise(r => setTimeout(r, 50));

                if (rawData.length === 0) {
                    log("ไม่พบข้อมูลในไฟล์", "error");
                    alert('ไม่พบข้อมูลในไฟล์ หรือไฟล์ผิดรูปแบบ');
                    if (dropZone) dropZone.classList.remove('processing');
                    return;
                }

                log(`เริ่มวิเคราะห์ข้อมูล...`);
                await processExcelData(rawData);
                log("วิเคราะห์ข้อมูลเสร็จสิ้น", "success");
            } catch (err) {
                log(`ล้มเหลว: ${err.message}`, "error");
                alert(`เกิดข้อผิดพลาดในการประมวลผล: ${err.message}`);
                console.error(err);
            } finally {
                if (dropZone) dropZone.classList.remove('processing');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function extractSkuFromName(name) {
        if (!name) return null;
        // มองหารูปแบบ SKU เช่น BKH-BK-50-40-GK ที่ซ่อนอยู่ในชื่อสินค้า
        const match = String(name).match(/([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)/);
        return match ? match[1] : null;
    }

    function extractSizeAndSlots(itemName) {
        if (!itemName) return { size: null, slots: null };
        let size = null, slots = null;
        const sizeMatch = String(itemName).match(/size\s*([a-zA-Z0-9]+)|ขนาด\s*([a-zA-Z0-9]+)|\b([SML]|XL|XXL|XXXL)\b/i);
        if (sizeMatch) size = sizeMatch[1] || sizeMatch[2] || sizeMatch[3];
        const slotMatch = String(itemName).match(/(\d+)\s*ช่อง/);
        if (slotMatch) slots = parseInt(slotMatch[1]);
        return { size: size ? size.toUpperCase() : null, slots };
    }

    let headerMapCache = new Map();

    function normalizeKey(key) {
        return String(key || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[\*\(\)\[\]_\-:\/\.,'"]/g, '')
            .replace(/[^\p{L}0-9]/gu, '');
    }

    function getValue(row, keys, precalcRowKeys = null) {
        // ตรวจสอบ key โดยตรงก่อน (direct match เร็วที่สุด)
        for (let k of keys) {
            if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
                if (row[k] instanceof Date) return row[k];
                return String(row[k]).trim();
            }
        }

        const rowKeys = precalcRowKeys || Object.keys(row);
        const normalizedRowKeys = rowKeys.map(normalizeKey);

        for (let k of keys) {
            const normalizedK = normalizeKey(k);

            // Check cache
            if (headerMapCache.has(normalizedK)) {
                const cachedKey = headerMapCache.get(normalizedK);
                const val = row[cachedKey];
                if (val !== undefined && val !== null && val !== '') {
                    if (val instanceof Date) return val;
                    return String(val).trim();
                }
            }

            // Fallback to exact match (normalized)
            const foundKey = rowKeys.find((rk, idx) => normalizedRowKeys[idx] === normalizedK);
            if (foundKey) {
                headerMapCache.set(normalizedK, foundKey);
                const val = row[foundKey];
                if (val !== undefined && val !== null && val !== '') {
                    if (val instanceof Date) return val;
                    return String(val).trim();
                }
            }

            // Fallback: normalized substring match
            const substringKey = rowKeys.find((rk, idx) => {
                const norm = normalizedRowKeys[idx];
                return (norm.length >= 3 && normalizedK.length >= 3) &&
                       (norm.includes(normalizedK) || normalizedK.includes(norm));
            });
            if (substringKey) {
                headerMapCache.set(normalizedK, substringKey);
                const sval = row[substringKey];
                if (sval !== undefined && sval !== null && sval !== '') {
                    if (sval instanceof Date) return sval;
                    return String(sval).trim();
                }
            }
        }
        return null;
    }

    async function processExcelData(rawData) {
        log("กำลังเริ่มวิเคราะห์ข้อมูล...");
        headerMapCache.clear(); // Reset cache for new file
        parsedDataToUpload = [];
        skippedShopeeMissingShipDateCount = 0;
        skippedShopeeMissingShipDateOrders = [];
        // Reset cache for production number sequence
        for (const key in productionNumberUploadCache) delete productionNumberUploadCache[key];
        
        // Pruning: กรองเอาเฉพาะแถวที่มีข้อมูลจริงๆ ป้องกันเคส Excel มีหมื่นแถว "หลอก"
        let cleanData = rawData.filter(row => {
            const vals = Object.values(row);
            return vals.length > 0 && vals.some(v => v !== "" && v !== null && v !== undefined);
        });
        
        if (cleanData.length === 0) {
            log("ไม่พบแถวข้อมูลที่ใช้งานได้ในไฟล์นี้", "error");
            alert("ไม่พบข้อมูลในไฟล์");
            return;
        }
        
        log(`วิเคราะห์พบแถวข้อมูลจริง ${cleanData.length} รายการ (จากทั้งหมด ${rawData.length} แถว)`);

        const headers = Object.keys(cleanData[0]);
        console.log('[DEBUG] detected headers:', headers);
        const normalizedHeaders = headers.map(normalizeKey);
        console.log('[DEBUG] normalized headers:', normalizedHeaders);
        console.log('[DEBUG] sample row keys:', Object.keys(cleanData[0]).slice(0,20));
        // Auto-map any header that looks like a payment time column (Thai/EN keywords)
        try {
            const lowerHeaders = headers.map(h => String(h).toLowerCase());
            const paymentCandidateIndex = lowerHeaders.findIndex(h => h.includes('ชำระ') || h.includes('paid') || h.includes('payment'));
            if (paymentCandidateIndex !== -1) {
                const candidateKey = headers[paymentCandidateIndex];
                const paymentKeyVariants = ['paid_time','paidtime','paidTime','payment_time','paymentdate','payment_time','วันที่ชำระเงิน','เวลาการชำระเงิน','เวลาชำระสินค้า','เวลาการชำระสินค้า'];
                paymentKeyVariants.forEach(k => headerMapCache.set(normalizeKey(k), candidateKey));
                console.log('[DEBUG] auto-mapped payment header to:', candidateKey);
            }
        } catch (e) {
            console.error('Auto-mapping payment header failed:', e);
        }
        const tiktokKeywords = [
            'tiktok',
            'tiktokorderid',
            'orderid',
            'orderstatus',
            'createdtime',
            'paidtime',
            'rtstime',
            'recipientname',
            'mustshipbydate',
            '1skuoriginalprice',
            'dispatchdeadline',
            'fulfillmentdeadline',
            'buyerusername',
            'trackingid',
            'shippingprovidername',
            'recipient',
            'orderamount'
        ].map(normalizeKey);

        const shopeeKeywords = [
            'shopee',
            'วันที่ทำการสั่งซื้อ',
            'วันที่คาดว่าจะทำการจัดส่งสินค้า',
            'เลขอ้างอิงsku',
            'skureferenceno',
            'parentskureferenceno',
            'ค่าจัดส่งที่ชำระโดยผู้ซื้อ'
        ].map(normalizeKey);

        const lazadaKeywords = [
            'lazada',
            'lazadaid',
            'orderitemid',
            'ordernumber',
            'sellersku',
            'lazadasku',
            'createtime',
            'itemname',
            'shippingaddress',
            'shippingaddress3',
            'billingaddr',
            'rtssla',
            'ttssla',
            'trackingcode',
            'cdtrackingcode',
            'promisedshippingtime',
            'paidprice',
            'unitprice',
            'customername',
            'shippingname'
        ].map(normalizeKey);

        let lazadaScore = 0;
        let shopeeScore = 0;
        let tiktokScore = 0;

        normalizedHeaders.forEach(h => {
            if (lazadaKeywords.some(kw => h === kw || h.includes(kw))) lazadaScore++;
            if (shopeeKeywords.some(kw => h === kw || h.includes(kw))) shopeeScore++;
            if (tiktokKeywords.some(kw => h === kw || h.includes(kw))) tiktokScore++;
        });

        const hasLazadaOrderItemAnchor = normalizedHeaders.some(h => h.includes('orderitemid'));
        const hasLazadaAnchor = normalizedHeaders.some(h => 
            h.includes('sellersku') || 
            h.includes('lazadasku') || 
            h.includes('lazadaid') || 
            h.includes('trackingcode') || 
            h.includes('cdtrackingcode') || 
            h.includes('rtssla') || 
            h.includes('lazada')
        );
        const hasShopeeAnchor = normalizedHeaders.some(h => h.includes('วันที่ทำการสั่งซื้อ') || h.includes('เลขอ้างอิงsku') || h.includes('skureferenceno') || h.includes('shopee'));
        const tiktokAnchorFields = [
            'tiktok',
            'orderid',
            'createdtime',
            'paidtime',
            'rtstime',
            'recipient',
            'recipientname',
            'buyerusername',
            'trackingid'
        ];
        const tiktokAnchorCount = normalizedHeaders.reduce((count, h) =>
            count + (tiktokAnchorFields.some(kw => h === kw || h.includes(kw)) ? 1 : 0),
            0
        );
        const hasTikTokAnchor = tiktokAnchorCount > 0;

        let platform = 'Other';
        if (hasLazadaOrderItemAnchor) {
            platform = 'Lazada';
        } else if (tiktokAnchorCount >= 2 || (hasTikTokAnchor && tiktokScore > lazadaScore)) {
            platform = 'TikTok';
        } else if (hasLazadaAnchor && lazadaScore >= shopeeScore) {
            platform = 'Lazada';
        } else if (hasShopeeAnchor) {
            platform = 'Shopee';
        } else if (lazadaScore > shopeeScore && lazadaScore > tiktokScore) {
            platform = 'Lazada';
        } else if (shopeeScore > lazadaScore && shopeeScore > tiktokScore) {
            platform = 'Shopee';
        } else if (tiktokScore > lazadaScore && tiktokScore > shopeeScore) {
            platform = 'TikTok';
        }

        log(`ตรวจพบแพลตฟอร์ม: ${platform} (Score -> Lazada: ${lazadaScore}, Shopee: ${shopeeScore}, TikTok: ${tiktokScore})`);

        if (platform === 'Shopee') {
            // สถิติตรวจสอบวันที่คาดว่าจะทำการจัดส่งสินค้า (ไม่ต้องกรองแถวออก)
            cleanData.forEach((row, index) => {
                const rowKeys = Object.keys(row);
                const expectedShipDate = getValue(row, [
                    'วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    '*วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    '* วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    'วันที่คาดว่าจะจัดส่งสินค้า',
                    'วันที่คาดว่าจะจัดส่ง',
                    'วันที่จัดส่งสินค้า',
                    'กำหนดจัดส่ง',
                    'กำหนดการจัดส่ง',
                    'วันที่ต้องจัดส่ง',
                    'เวลาที่ต้องจัดส่ง',
                    'Expected Ship Date',
                    'Ship-by Date',
                    'Ship By Date',
                    'Estimated Delivery Date',
                    'ship_by_date'
                ], rowKeys);
                if (!expectedShipDate) {
                    skippedShopeeMissingShipDateCount++;
                    skippedShopeeMissingShipDateOrders.push(
                        getValue(row, ['หมายเลขคำสั่งซื้อ', '*หมายเลขคำสั่งซื้อ', 'Order ID'], rowKeys) || `แถว ${index + 1}`
                    );
                }
            });

            if (skippedShopeeMissingShipDateCount > 0) {
                const samples = [...new Set(skippedShopeeMissingShipDateOrders)]
                    .slice(0, 8)
                    .join(', ');
                log(
                    `พบข้อมูล Shopee ที่ไม่มีคอลัมน์กำหนดจัดส่ง ${skippedShopeeMissingShipDateCount} รายการ (ระบบจะบันทึกโดยเว้นว่างกำหนดจัดส่งไว้)` +
                    `${samples ? ` (ตัวอย่าง: ${samples})` : ''}`,
                    'info'
                );
            }
        }
        
        // 1. รวบรวม SKU และ ชื่อสินค้า เพื่อจะไปดึงทีเดียว
        const skusToFetch = [];
        const namesToFetch = [];
        cleanData.forEach(row => {
            const rowKeys = Object.keys(row);
            let pCode = null, pName = "";
            if (platform === 'Lazada') { 
                pCode = getValue(row, ['sellerSku'], rowKeys); 
                pName = getValue(row, ['itemName'], rowKeys); 
            }
            if (platform === 'Shopee') { 
                pCode = getValue(row, [
                    'เลขอ้างอิง SKU (SKU Reference No.)',
                    'เลขอ้างอิง SKU',
                    'SKU Reference No.',
                    'เลขอ้างอิง Parent SKU',
                    'Parent SKU',
                    'SKU'
                ], rowKeys); 
                pName = getValue(row, ['ชื่อสินค้า'], rowKeys); 
            }
            if (platform === 'TikTok') { 
                pCode = getValue(row, ['Seller SKU', 'SKU ID'], rowKeys); 
                pName = getValue(row, ['Product Name'], rowKeys); 
            }
            
            pCode = pCode || extractSkuFromName(pName);
            if (pCode) skusToFetch.push(pCode);
            if (pName) namesToFetch.push(pName);
        });

        let masterDict = {};
        if (typeof dbSupabase !== 'undefined' && dbSupabase) {
            log("กำลังเชื่อมต่อ SKU Master เพื่อตรวจสอบราคาและขนาด...");
            try {
                // Optimized Fetch Function: Chunking to avoid URL length limits
                async function fetchInChunks(column, values) {
                    const uniqueValues = [...new Set(values)].filter(v => v);
                    const total = uniqueValues.length;
                    if (total === 0) return [];
                    
                    // ใช้ Chunk Size เล็กๆ สำหรับ Name/name_ref เพราะชื่อสินค้ายาวมาก
                    const chunkSize = (column === 'name' || column === 'name_ref') ? 1 : 40; 
                    let results = [];
                    log(`🔍 ค้นหา ${column} ในฐานข้อมูล: ${total} รายการ...`);
                    
                    for (let i = 0; i < total; i += chunkSize) {
                        const originalChunk = uniqueValues.slice(i, i + chunkSize).map(v => v.trim());
                        
                        // ป้องกันชื่อยาวเกินไปจนทำระบบค้าง
                        if ((column === 'name' || column === 'name_ref') && originalChunk[0].length > 200) {
                            log(`   - ข้ามการค้นหาชื่อที่ยาวเกินไป (${originalChunk[0].length} ตัวอักษร)`);
                            continue;
                        }

                        const robustChunk = [...new Set([
                            ...originalChunk,
                            ...originalChunk.map(v => v.toUpperCase()),
                            ...originalChunk.map(v => v.toLowerCase())
                        ])];
                        
                        try {
                            const selectFields = '*, frame_color:aluminum_colors(color_name), glass_color:glass_colors(color_name), glass_color_code, net_id';
                            let { data, error } = await dbSupabase.from('sku_master')
                                .select(selectFields)
                                .in(column, robustChunk);

                            if (isMissingRelationshipError(error)) {
                                ({ data, error } = await dbSupabase.from('sku_master')
                                    .select('*')
                                    .in(column, robustChunk));
                            }
                            
                            if (error) {
                                log(`❌ ชุดที่ ${Math.floor(i/chunkSize) + 1} ผิดพลาด: ${error.message}`, 'error');
                            } else if (data) {
                                results = results.concat(data);
                            }
                        } catch (pkgErr) {
                            log(`❌ ชุดที่ ${Math.floor(i/chunkSize) + 1} ล้มเหลว (Network Error)`, 'error');
                        }
                        
                        // Yield to UI
                        await new Promise(r => setTimeout(r, 0));
                    }
                    log(`✅ ดึงข้อมูล ${column} สำเร็จ (พบ ${results.length} รายการ)`);
                    return results;
                }

                // Fetch by SKU Code
                if (skusToFetch.length > 0) {
                    const skusData = await fetchInChunks('product_code', skusToFetch);
                    skusData.forEach(item => {
                        if (item.product_code) {
                            const key = 'CODE_' + String(item.product_code).toLowerCase().trim();
                            masterDict[key] = item;
                        }
                    });
                }

                // Fetch by Product Name (รองรับเฉพาะ column 'name' ตาม schema ปัจจุบัน)
                if (namesToFetch.length > 0) {
                    const namesData = await fetchInChunks('name', namesToFetch);
                    namesData.forEach(item => {
                        const itemName = item.name;
                        if (itemName) {
                            const key = 'NAME_' + String(itemName).toLowerCase().trim();
                            masterDict[key] = item;
                        }
                    });
                }
                
                log("ตรวจสอบข้อมูล SKU Master เสร็จสมบูรณ์", "success");
            } catch (err) {
                log(`Master Fetch Error: ${err.message}`, "error");
                console.error("Master Fetch Error:", err);
            }
        }

        // ฟังก์ชันดึงเวลาสำหรับจัดเรียงข้อมูลนำเข้า (เก่าสุดไปใหม่สุด)
        function getRowDateTime(row, plat, rKeys) {
            let rawTime = null;
            if (plat === 'Lazada') {
                rawTime = getValue(row, ['createTime'], rKeys);
            } else if (plat === 'Shopee') {
                rawTime = getValue(row, ['เวลาการชำระเงิน', 'เวลาการชำระเงิน (ตามร้านค้า)', 'เวลาชำระเงิน', 'paid_time', 'เวลาชำระสินค้า'], rKeys)
                    || getValue(row, ['วันที่ทำการสั่งซื้อ'], rKeys);
            } else if (plat === 'TikTok') {
                rawTime = getValue(row, ['Paid At', 'Paid Time'], rKeys)
                    || getValue(row, ['Created Time'], rKeys);
            }
            if (rawTime) {
                if (rawTime instanceof Date) return rawTime.getTime();
                const d = new Date(rawTime);
                if (!isNaN(d.getTime())) return d.getTime();
                const alt = String(rawTime).replace(/\//g, '-').replace(' ', 'T');
                const d2 = new Date(alt);
                if (!isNaN(d2.getTime())) return d2.getTime();
            }
            return 0;
        }

        log("กำลังจัดเรียงออเดอร์ตามวันเวลาจากเก่าที่สุด...");
        cleanData.sort((a, b) => {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            const ta = getRowDateTime(a, platform, keysA);
            const tb = getRowDateTime(b, platform, keysB);
            return ta - tb;
        });

        let matchCount = 0;
        
        // ใช้ for...of เพื่อให้สามารถใช้ await เพื่อ "พัก" ให้ UI ทำงานได้
        for (let i = 0; i < cleanData.length; i++) {
            const row = cleanData[i];
            const rowKeys = Object.keys(row);
            let date = new Date().toISOString().split('T')[0];
            let orderNumber = `UNK-${i}`, trackingNumber = null, courierPhone = null, latestLocation = null, bookImageUrl = null, productCode = null, productName = "Unknown", quantity = 1, price = 0, shipping = 0, buyer = "Unknown", address = null, province = "Unknown", status = "รอดำเนินการ", productionNumber = null, note = null;
            // ship_by_date เฉพาะ Shopee — ประกาศไว้ล่วงหน้าเพื่อให้ push ด้านล่างอ่านได้ทุก platform
            var shipByDateRaw = null, shipByDate = null;
            
            if (platform === 'Lazada') {
                const dateRaw = getValue(row, ['createTime', 'createdTime', 'create_time', 'created_time', 'Create Time', 'Created Time', 'orderDate', 'Order Date', 'paidTime'], rowKeys);
                if (dateRaw) {
                    try {
                        const parsedDate = parseShopeeDate(dateRaw);
                        if (parsedDate) date = parsedDate.split('T')[0];
                        else date = new Date(dateRaw).toISOString().split('T')[0];
                    } catch(e){}
                }
                // ใช้ orderNumber (order-level) ก่อน แล้วค่อย fallback ไป orderItemId (item-level)
                orderNumber = getValue(row, ['orderNumber', 'orderId', 'order_number', 'Order Number', 'Order No.', 'orderItemId', 'Order ID', 'order_id'], rowKeys) || orderNumber;
                trackingNumber = getValue(row, ['trackingCode', 'cdTrackingCode', 'tracking_number', 'tracking_id', 'Tracking ID', 'Tracking Number', 'Tracking Code'], rowKeys);
                productCode = getValue(row, ['sellerSku', 'lazadaSku', 'sku', 'SKU', 'SKU ID'], rowKeys) || productCode;
                productName = getValue(row, ['itemName', 'productName', 'ชื่อสินค้า', 'Product Name'], rowKeys) || productName;
                quantity = parseInt(getValue(row, ['quantity', 'productQuantity', 'Quantity'], rowKeys) || 1);
                price = parseFloat(getValue(row, ['unitPrice', 'paidPrice', 'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Amount'], rowKeys) || 0);
                shipping = parseFloat(getValue(row, ['shippingFee', 'Shipping Fee After Discount', 'Original Shipping Fee', 'Shipping Fee Seller Discount', 'Shipping Fee Platform Discount'], rowKeys) || 0);
                // ข้อมูลคนซื้อ (ให้เช็ค billing ก่อนเพราะบางที shipping ถูก Mask)
                buyer = getValue(row, ['billingName', 'shippingName', 'customerName', 'Buyer Username'], rowKeys) || buyer;
                address = getValue(row, ['shippingAddress', 'shippingAddress2', 'shippingAddress3', 'shippingAddress4', 'shippingAddress5', 'billingAddr', 'billingAddr2', 'billingAddr3', 'billingAddr4', 'billingAddr5', 'Detail Address', 'Additional address information'], rowKeys);
                // จังหวัดใน Lazada มักอยู่ใน shippingAddress3 หรือ billingAddr3
                province = getValue(row, ['shippingAddress3', 'billingAddr3', 'shippingAddress4', 'billingAddr4', 'shippingRegion', 'Province'], rowKeys) || province;
                
                note = getValue(row, ['sellerNote', 'buyerMessage', 'หมายเหตุ', 'Seller Note'], rowKeys) || note;
                bookImageUrl = getValue(row, ['book_image_url', 'รูปภาพ', 'รูปใบ Book', 'Image', 'Photo', 'URL'], rowKeys);
                courierPhone = getValue(row, ['shippingPhone', 'shippingPhone2', 'billingPhone', 'billingPhone2', 'courier_phone', 'เบอร์ขนส่ง', 'เบอร์โทรขนส่ง', 'Courier Phone', 'Phone #'], rowKeys);
                latestLocation = getValue(row, ['latest_location', 'สถานที่ล่าสุด', 'สาขาล่าสุด', 'Location'], rowKeys);
                // Ship by date (Lazada: prioritize the Excel field rtsSla, then fall back to other date fields)
                var shipDateCandidates = [
                    'rtsSla', 'RTS SLA', 'rts_sla', 'rts sla',
                    'updateTime', 'update_time', 'promisedShippingTime', 'RTS Time', 'Shipped Time', 'Delivered Time', 'deliveredDate',
                    'ship_by_date', 'กำหนดจัดส่ง', 'วันที่คาดว่าจะทำการจัดส่งสินค้า', 'วันที่คาดว่าจะจัดส่งสินค้า',
                    'วันที่จัดส่งสินค้า', 'วันที่ต้องจัดส่ง', 'Expected Ship Date', 'Ship-by Date', 'Ship By Date', 'Estimated Delivery Date'
                ];
                var shipByDateRaw = getValue(row, shipDateCandidates, rowKeys);
                if (shipByDateRaw) {
                    try {
                        shipByDate = new Date(shipByDateRaw).toISOString().split('T')[0];
                        if (!shipByDate || shipByDate === 'Invalid Date') {
                            shipByDate = parseShopeeDate(shipByDateRaw);
                            if (shipByDate) shipByDate = shipByDate.split('T')[0];
                        }
                    } catch(e) {
                        shipByDate = parseShopeeDate(shipByDateRaw);
                        if (shipByDate) shipByDate = shipByDate.split('T')[0];
                    }
                    if (!shipByDate) shipByDate = null;
                    console.log(`[DEBUG] row ${i} Lazada shipByDateRaw ->`, shipByDateRaw, 'parsed ->', shipByDate);
                } else {
                    const candidateValues = shipDateCandidates.reduce((acc, key) => {
                        acc[key] = row[key] !== undefined ? row[key] : null;
                        return acc;
                    }, {});
                    console.log(`[DEBUG] row ${i} Lazada shipByDate candidates missing ->`, candidateValues);
                }
                // Payment time (Lazada) — Lazada ไม่มีคอลัมน์ paidTime โดยตรง ใช้ createTime เป็น fallback
                var paymentRaw = getValue(row, [
                    'paidTime', 'paymentTime', 'payment_date', 'paid_at',
                    'เวลาการชำระเงิน', 'เวลาการชำระสินค้า',
                    'rtsSla', 'RTS SLA', 'RTS Time', 'rtsTime',
                    'createTime', 'createdTime', 'create_time'
                ], rowKeys);
                let paymentTime = normalizePaymentTime(paymentRaw || null);
                if (paymentRaw) console.log(`[DEBUG] row ${i} Lazada paymentRaw ->`, paymentRaw, 'normalized->', paymentTime);

                // สถานะออเดอร์ Lazada (ตรวจ cancelled)
                const lazadaStatus = getValue(row, ['status', 'Status', 'orderStatus', 'order_status'], rowKeys);
                if (lazadaStatus) {
                    const lowerStatus = String(lazadaStatus).toLowerCase();
                    if (lowerStatus.includes('cancel') || lowerStatus.includes('ยกเลิก')) {
                        status = 'ยกเลิก';
                    }
                }
            } else if (platform === 'Shopee') {
                const dateRaw = getValue(row, ['วันที่ทำการสั่งซื้อ', '*วันที่ทำการสั่งซื้อ', 'วันที่สั่งซื้อ', 'Order Creation Date', 'Created Time', 'Order Date'], rowKeys);
                if (dateRaw) {
                    if (dateRaw instanceof Date) {
                        date = dateRaw.toISOString().split('T')[0];
                    } else {
                        const parsedDate = parseShopeeDate(dateRaw);
                        if (parsedDate) date = parsedDate.split('T')[0];
                        else date = String(dateRaw).trim().split(' ')[0].replace(/\//g, '-');
                    }
                }
                orderNumber = getValue(row, ['หมายเลขคำสั่งซื้อ', '*หมายเลขคำสั่งซื้อ', 'เลขออเดอร์', 'Order ID', 'Order No.', 'Order Number'], rowKeys) || orderNumber;
                productCode = getValue(row, [
                    'เลขอ้างอิง SKU (SKU Reference No.)',
                    'เลขอ้างอิง SKU',
                    '*เลขอ้างอิง SKU',
                    'SKU Reference No.',
                    'เลขอ้างอิง Parent SKU',
                    'Parent SKU',
                    'Parent SKU Reference No.',
                    'SKU',
                    'sku',
                    'Seller SKU',
                    'SKU ID'
                ], rowKeys) || productCode;
                productName = getValue(row, ['ชื่อสินค้า', '*ชื่อสินค้า', 'ชื่อสินค้า (Product Name)', 'productName', 'Product Name', 'Item Name'], rowKeys) || productName;
                quantity = parseInt(getValue(row, ['จำนวน', '*จำนวน', 'จำนวน (Quantity)', 'Quantity', 'Qty'], rowKeys) || 1);
                price = parseFloat(getValue(row, ['จำนวนเงินทั้งหมด', '*จำนวนเงินทั้งหมด', 'ยอดรวม', 'ราคารวม', 'Total Amount', 'Deal Price', 'Order Amount'], rowKeys) || 0);
                shipping = parseFloat(getValue(row, ['ค่าจัดส่งที่ชำระโดยผู้ซื้อ', '*ค่าจัดส่งที่ชำระโดยผู้ซื้อ', 'ค่าจัดส่ง', 'Shipping Fee', 'shipping fee', 'Buyer Paid Shipping Fee'], rowKeys) || 0);
                buyer = getValue(row, ['ชื่อผู้ใช้ (ผู้ซื้อ)', '*ชื่อผู้ใช้ (ผู้ซื้อ)', 'ชื่อผู้ซื้อ', 'ชื่อผู้ใช้(ผู้ซื้อ)', 'Buyer Username', 'Buyer Name'], rowKeys) || buyer;
                address = getValue(row, ['ที่อยู่', '*ที่อยู่ในการจัดส่ง', 'ที่อยู่ในการจัดส่ง', 'ที่อยู่จัดส่ง', 'Delivery Address', 'Shipping Address', 'Full Address'], rowKeys);
                province = getValue(row, ['จังหวัด', '*จังหวัด', 'Province', 'State/Province'], rowKeys) || province;
                note = getValue(row, [
                    'ข้อความจากผู้ซื้อ',
                    '*ข้อความจากผู้ซื้อ',
                    '* ข้อความจากผู้ซื้อ',
                    'หมายเหตุ',
                    '*หมายเหตุ',
                    '* หมายเหตุ',
                    'หมายเหตุจากผู้ซื้อ',
                    '*หมายเหตุจากผู้ซื้อ',
                    'ข้อความจากผู้ซื้อ (Buyer Message)',
                    'หมายเหตุผู้ซื้อ',
                    'หมายเหตุสั่งซื้อ',
                    'Buyer Message',
                    'Seller Note',
                    'Note',
                    'Remark',
                    'buyerMessage',
                    'sellerNote',
                    'note'
                ], rowKeys) || note;
                bookImageUrl = getValue(row, ['book_image_url', 'รูปภาพ', 'รูปใบ Book', 'Image', 'Photo', 'URL'], rowKeys);
                courierPhone = getValue(row, ['courier_phone', 'เบอร์ขนส่ง', 'เบอร์โทรขนส่ง', 'Courier Phone'], rowKeys);
                latestLocation = getValue(row, ['latest_location', 'สถานที่ล่าสุด', 'สาขาล่าสุด', 'Location'], rowKeys);
                trackingNumber = getValue(row, [
                    '*หมายเลขติดตามพัสดุ',
                    'หมายเลขติดตามพัสดุ', 
                    'เลขพัสดุ', 
                    'Tracking Number', 
                    'Tracking ID', 
                    'Tracking Number*', 
                    'Tracking No.',
                    'หมายเลขพัสดุ',
                    'tracking_number'
                ], rowKeys);
                productionNumber = getValue(row, ['production_number', 'production number', 'เลขที่ผลิต', 'เลขที่การผลิต'], rowKeys) || productionNumber;
                // วันที่คาดว่าจะทำการจัดส่งสินค้า (Shopee ship-by date)
                var shipByDateRaw = getValue(row, [
                    'วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    '*วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    '* วันที่คาดว่าจะทำการจัดส่งสินค้า',
                    'วันที่คาดว่าจะจัดส่งสินค้า',
                    'วันที่คาดว่าจะจัดส่ง',
                    'วันที่จัดส่งสินค้า',
                    'กำหนดจัดส่ง',
                    'กำหนดการจัดส่ง',
                    'วันที่ต้องจัดส่ง',
                    'เวลาที่ต้องจัดส่ง',
                    'จัดส่งภายในวันที่',
                    'Days to Ship',
                    'Expected Ship Date',
                    'Ship-by Date',
                    'Ship By Date',
                    'Estimated Delivery Date',
                    'ship_by_date',
                    'Shipment Boundary Date'
                ], rowKeys);
                var shipByDate = parseShopeeDate(shipByDateRaw);
                if (shipByDateRaw) console.log(`[DEBUG] row ${i} Shopee shipByDateRaw ->`, shipByDateRaw, 'parsed ->', shipByDate);
                // Payment time (Shopee)
                var paymentRaw = getValue(row, [
                    'paid_time', 'paidTime', 'payment_time', 'paymentDate',
                    'วันที่ชำระเงิน', '*เวลาการชำระเงิน', 'เวลาการชำระเงิน',
                    'เวลาชำระสินค้า', 'เวลาการชำระเงิน (ตามร้านค้า)',
                    'เวลาการชำระเงิน (Paid Time)', 'Paid Time', 'Order Paid Time'
                ], rowKeys);
                let paymentTime = normalizePaymentTime(paymentRaw || null);
                if (paymentRaw) console.log(`[DEBUG] row ${i} Shopee paymentRaw ->`, paymentRaw, 'normalized->', paymentTime);
            } else if (platform === 'TikTok') {
                const dateRaw = getValue(row, ['Created Time'], rowKeys);
                if (dateRaw) { try { date = new Date(dateRaw.split(' ')[0].replace(/\//g,'-')).toISOString().split('T')[0]; } catch(e){} }
                orderNumber = getValue(row, ['Order ID'], rowKeys) || orderNumber;
                productCode = getValue(row, ['Seller SKU', 'SKU ID', 'sku'], rowKeys) || productCode;
                productName = getValue(row, ['Product Name', 'ชื่อสินค้า'], rowKeys) || productName;
                quantity = parseInt(getValue(row, ['Quantity'], rowKeys) || 1);
                price = parseFloat(getValue(row, ['1 SKU original price', 'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Amount'], rowKeys) || 0);
                shipping = parseFloat(getValue(row, ['Shipping Fee After Discount', 'Original Shipping Fee', 'Shipping Fee', 'shipping fee'], rowKeys) || 0);
                buyer = getValue(row, ['Buyer Username', 'Recipient', 'Recipient Name'], rowKeys) || buyer;
                address = getValue(row, ['Full Address', 'Detailed Address', 'Detail Address', 'Additional address information'], rowKeys);
                province = getValue(row, ['Province'], rowKeys) || province;
                note = getValue(row, ['Buyer Message', 'หมายเหตุ', 'Seller Note'], rowKeys) || note;
                bookImageUrl = getValue(row, ['book_image_url', 'รูปภาพ', 'รูปใบ Book', 'Image', 'Photo', 'URL'], rowKeys);
                courierPhone = getValue(row, ['courier_phone', 'เบอร์ขนส่ง', 'เบอร์โทรขนส่ง', 'Courier Phone'], rowKeys);
                latestLocation = getValue(row, ['latest_location', 'สถานที่ล่าสุด', 'สาขาล่าสุด', 'Location'], rowKeys);
                trackingNumber = getValue(row, ['Tracking Number', 'Tracking ID', 'tracking_number'], rowKeys);
                // Payment time (TikTok)
                var paymentRaw = getValue(row, ['Paid At', 'Paid Time', 'payment_time', 'paymentDate', 'เวลาการชำระเงิน', 'paid_at', 'เวลาการชำระสินค้า'], rowKeys);
                let paymentTime = normalizePaymentTime(paymentRaw || null);
                if (paymentRaw) console.log(`[DEBUG] row ${i} TikTok paymentRaw ->`, paymentRaw, 'normalized->', paymentTime);

                // Ship by date (TikTok)
                var shipByDateRaw = getValue(row, [
                    'RTS Time',
                    'RTS SLA',
                    'rtsTime',
                    'rts_time',
                    'เวลาส่งมอบที่กำหนด',
                    'เวลาที่ต้องส่งสินค้า',
                    'เวลาที่ต้องส่งสินค้าภายใน',
                    'วันที่ต้องจัดส่ง',
                    'กำหนดการจัดส่ง',
                    'กำหนดจัดส่ง',
                    'เวลาจัดส่งที่คาดหวัง',
                    'จัดส่งภายใน',
                    'Must Ship By Date',
                    'Ship By Date',
                    'Ship-by Date',
                    'Dispatch Deadline',
                    'Shipping Deadline',
                    'Fulfillment Deadline',
                    'Latest Ship Time',
                    'Promised Dispatch Time',
                    'Estimated Ship Date',
                    'ship_by_date'
                ], rowKeys);
                var shipByDate = parseShopeeDate(shipByDateRaw);
                if (shipByDateRaw) console.log(`[DEBUG] row ${i} TikTok shipByDateRaw ->`, shipByDateRaw, 'parsed ->', shipByDate);
            }
            
            // พยายามดึง SKU จากชื่อสินค้าในกรณีที่ได้มาไม่ครบ
            productCode = productCode || extractSkuFromName(productName);

            let { size, slots } = extractSizeAndSlots(productName);
            let pattern = null;
            let finalPrice = price; // ใช้ราคาจาก Excel เป็นพื้นฐาน
            
            // 2. ถ้าเจอใน masterDict เอาข้อมูลมาทับของเดิม (Overide Excel)
            const masterKeyCode = productCode ? 'CODE_' + productCode.toLowerCase().trim() : null;
            const masterKeyName = productName ? 'NAME_' + productName.toLowerCase().trim() : null;
            const master = masterDict[masterKeyCode] || masterDict[masterKeyName];
                           
            if (master) {
                matchCount++;
                if (master.product_code) productCode = master.product_code; 
                
                // ชื่อสินค้า (รองรับเฉพาะ name ตาม schema ปัจจุบัน)
                const masterName = master.name;
                if (masterName) productName = masterName;
                if (master.size) size = master.size;
                
                // ลาย (รองรับเฉพาะ pattern ตาม schema ปัจจุบัน)
                const masterPattern = normalizePattern(master.pattern_code ?? master.pattern);
                if (masterPattern) pattern = masterPattern;
                if (master.slots != null) slots = parseInt(master.slots);
                if (master.price != null && master.price > 0) finalPrice = parseFloat(master.price);
            }

            // ดึงชื่อสีจาก JOIN (frame_color.color_name / glass_color.color_name) หรือ fallback เป็น code
            const glassFromRow = getValue(row, ['glass_color', 'glassColor', 'สีกระจก'], rowKeys);
            const screenFromRow = getValue(row, ['screen_type', 'screenType', 'มุ้ง', 'screen'], rowKeys);

            let aluminumColor = master ? (master.frame_color?.color_name || master.aluminum_color || master.frame_color_code || null) : null;
            let glassColor = master ? (master.glass_color?.color_name || master.glass_color || null) : glassFromRow;
            const glassCode = master?.glass_color_code;
            const frameColorCode = master?.frame_color_code;

            if (master) {
                if (!aluminumColor && frameColorCode) {
                    aluminumColor = await resolveColorName(frameColorCode, 'aluminum') || frameColorCode;
                }
                if (!glassColor && glassCode) {
                    glassColor = await resolveColorName(glassCode, 'glass') || glassCode;
                }
            }

            // ดึงสถานะมุ้ง: ลำดับความสำคัญ master.screen_type >Joined net_status >master.net_id > ค่าในไฟล์
            const masterNetStatus = master ? await resolveMosquitoNetStatus(master.net_id) : null;
            const screenType = master ? (
                master.screen_type || 
                masterNetStatus || 
                normalizeScreenType(master.net_id) || 
                screenFromRow
            ) : screenFromRow;
            // ถ้าไม่เข้า if (master) ข้างบน ค่า productCode จะยังคงเป็นค่าเดิมที่ดึงมาจากไฟล์ (sellerSku)

            // Automatic numbers are assigned only after duplicate detection.
            productionNumber = normalizeProductionNumberString(productionNumber) || null;

            parsedDataToUpload.push({
                order_date: date, platform: platform, order_number: orderNumber, product_code: productCode, product_name: productName,
                // use function-scoped `paymentRaw` (declared with var in each branch) so value is available here
                payment_time: normalizePaymentTime((typeof paymentRaw !== 'undefined' ? paymentRaw : null) || null),
                product_size: size, slots: slots, quantity: quantity, price: finalPrice, shipping_fee: shipping,
                buyer_name: buyer, address: address, province: province,
                tracking_status: status,
                book_image_url: bookImageUrl,
                note: note,
                tracking_number: trackingNumber,
                courier_phone: courierPhone,
                latest_location: latestLocation,
                production_number: normalizeProductionNumberString(productionNumber) || null,
                pattern: pattern,
                aluminum_color: aluminumColor,
                glass_color: normalizeGlassColor(glassColor),
                screen_type: normalizeScreenType(screenType),
                // วันที่คาดว่าจะทำการจัดส่งสินค้า — รองรับ Shopee และ Lazada (rtsSla)
                ship_by_date: (typeof shipByDate !== 'undefined' ? shipByDate : null) || null
            });

            // พักให้ UI ทำงานทุกๆ 200 แถว
            if (i % 200 === 0 && i > 0) {
                log(`ประมวลผลแล้ว ${i} แถว...`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        if (matchCount > 0) {
            log(`🎯 แมตช์ข้อมูลกับ SKU Master สำเร็จทั้งหมด ${matchCount} รายการ`, 'success');
        }
        // Summary: นับจำนวนแถวที่จับค่า payment_time ได้ และแสดงตัวอย่างเล็กน้อย
        try {
            const withPayment = parsedDataToUpload.filter(p => p.payment_time !== null && p.payment_time !== undefined && String(p.payment_time).trim() !== '');
            console.log(`[DEBUG] parsed total ${parsedDataToUpload.length}, with payment_time: ${withPayment.length}`);
            console.log('[DEBUG] sample payment_time values:', withPayment.slice(0,10).map(p => ({ order_number: p.order_number, payment_time: p.payment_time }))); 
        } catch (e) {
            console.error('Error summarizing payment_time:', e);
        }
        renderPreview();
    }

    function formatShipByDate(isoStr) {
        if (!isoStr) return '-';
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            return new Intl.DateTimeFormat('th-TH', {
                timeZone: 'Asia/Bangkok',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).format(d);
        } catch (e) { return isoStr; }
    }

    function renderPreview() {
        const tbody = document.getElementById('previewBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        document.getElementById('previewCount').textContent = parsedDataToUpload.length;
        document.getElementById('previewSection').style.display = 'block';
        parsedDataToUpload.slice(0, 10).forEach(item => {
            const tr = document.createElement('tr');
            const shipByDisplay = item.ship_by_date ? formatShipByDate(item.ship_by_date) : '-';
            const shipByStyle = item.ship_by_date ? 'color:#f97316;font-weight:600;' : 'color:#64748b;';
            tr.innerHTML = `
                <td>${item.platform}</td>
                <td>${item.order_date}</td>
                <td>${item.order_number}</td>
                <td>${item.tracking_number || '-'}</td>
                <td title="${item.product_code || ''}">${item.product_code || '-'}</td>
                <td title="${item.product_name}">${String(item.product_name).substring(0, 20)}..</td>
                <td>${item.product_size || '-'}</td>
                <td>${item.slots || '-'}</td>
                <td>${item.pattern || '-'}</td>
                <td>${item.aluminum_color || '-'}</td>
                <td>${item.glass_color || '-'}</td>
                <td>${item.screen_type || '-'}</td>
                <td>x${item.quantity} | ${item.price}฿</td>
                <td>${item.payment_time ? String(item.payment_time).replace('T',' ').split('.')[0] : '-'}</td>
                <td style="${shipByStyle}" title="วันที่คาดว่าจะทำการจัดส่งสินค้า">🚚 ${shipByDisplay}</td>
                <td>${item.note || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const bulkUploadBtn = document.getElementById('bulkUploadBtn');
    if (bulkUploadBtn) {
        bulkUploadBtn.addEventListener('click', async () => {
            if (!parsedDataToUpload.length || !dbSupabase) return;
            log(`กำลังเตรียมตรวจสอบข้อมูลซ้ำและอัปโหลด ${parsedDataToUpload.length} รายการ...`);
            
            const btnText = bulkUploadBtn.querySelector('.btn-text');
            const btnLoader = bulkUploadBtn.querySelector('.btn-loader');
            
            bulkUploadBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoader) btnLoader.style.display = 'inline';
            
            try {
                // Match an existing row by tracking number, or by the stable order identity
                // when a tracking number has not been assigned yet.
                const isUsableTrackingNumber = value => {
                    const normalized = normalizeString(value);
                    if (!normalized) return false;
                    return !['-', '59', 'null', 'undefined', 'n/a'].includes(normalized.toLowerCase());
                };
                const isUsableOrderNumber = value => {
                    const normalized = normalizeString(value);
                    if (!normalized || /^UNK-\d+$/i.test(normalized)) return false;
                    return !['-', 'null', 'undefined', 'n/a'].includes(normalized.toLowerCase());
                };
                const trackingNumbers = parsedDataToUpload
                    .map(o => o.tracking_number)
                    .filter(isUsableTrackingNumber);
                const orderNumbers = parsedDataToUpload
                    .map(o => o.order_number)
                    .filter(isUsableOrderNumber)
                    .map(normalizeString);

                log(`กำลังค้นหาข้อมูลที่มีอยู่แล้วในระบบโดยใช้หมายเลขพัสดุเพื่อจับคู่...`);
                let existingOrders = [];

                if (trackingNumbers.length > 0) {
                    const uniqueTracking = [...new Set(trackingNumbers)];
                    const checkChunkSize = 80;

                    for (let i = 0; i < uniqueTracking.length; i += checkChunkSize) {
                        const chunk = uniqueTracking.slice(i, i + checkChunkSize);
                        const { data: existing, error: checkError } = await dbSupabase
                            .from(SUPABASE_TABLE_NAME)
                            .select('id, tracking_number, order_number, product_code, buyer_name, payment_time, production_number, tracking_status')
                            .in('tracking_number', chunk);
                        if (checkError) throw checkError;
                        if (existing) existingOrders = existingOrders.concat(existing);
                    }
                }

                if (orderNumbers.length > 0) {
                    const uniqueOrders = [...new Set(orderNumbers)];
                    const checkChunkSize = 80;

                    for (let i = 0; i < uniqueOrders.length; i += checkChunkSize) {
                        const chunk = uniqueOrders.slice(i, i + checkChunkSize);
                        const { data: existing, error: checkError } = await dbSupabase
                            .from(SUPABASE_TABLE_NAME)
                            .select('id, tracking_number, order_number, product_code, buyer_name, payment_time, production_number, tracking_status')
                            .in('order_number', chunk);
                        if (checkError) throw checkError;
                        if (existing) existingOrders = existingOrders.concat(existing);
                    }
                }

                existingOrders = [...new Map(existingOrders.map(order => [order.id, order])).values()];

                const normalizeMatchPart = value => String(value ?? '').trim().toLowerCase();
                const buildOrderMatchKey = order => [
                    normalizeMatchPart(order.order_number),
                    normalizeMatchPart(order.buyer_name),
                    normalizePaymentTime(order.payment_time) || '',
                    normalizeMatchPart(order.product_code)
                ].join('|');

                const buildImportUpdate = (item, existing) => {
                    const payload = { ...item };
                    delete payload.production_number;
                    delete payload.tracking_status;
                    if (!payload.tracking_number) delete payload.tracking_number;
                    return payload;
                };

                let itemsToInsert = [];
                let itemsToUpdate = [];
                let blockedStatusCount = 0;
                const blockedOrderNumbers = [];
                let skippedTrackingOrderNotFoundCount = 0;
                const skippedTrackingOrderNotFoundNumbers = [];
                let skippedMissingOrderNumberCount = 0;
                const skippedMissingOrderNumberRows = [];
                let skippedUnmatchedExistingCount = 0;
                const skippedUnmatchedExistingNumbers = [];
                const productionDoneStatuses = new Set(['ผลิตสำเร็จ', 'ผลิตสำเร็จแล้ว']);
                const existingByTracking = new Map(
                    existingOrders
                        .filter(order => isUsableTrackingNumber(order.tracking_number))
                        .map(order => [normalizeMatchPart(order.tracking_number), order])
                );
                const existingByOrderKey = new Map(
                    existingOrders.map(order => [buildOrderMatchKey(order), order])
                );
                const existingByOrderNumber = new Map();
                existingOrders.forEach(order => {
                    const key = normalizeMatchPart(order.order_number);
                    if (!key) return;
                    if (!existingByOrderNumber.has(key)) existingByOrderNumber.set(key, []);
                    existingByOrderNumber.get(key).push(order);
                });

                parsedDataToUpload.forEach(item => {
                    const hasOrderNumber = isUsableOrderNumber(item.order_number);
                    const orderNumberKey = hasOrderNumber
                        ? normalizeMatchPart(item.order_number)
                        : '';
                    const sameOrderRows = existingByOrderNumber.get(orderNumberKey) || [];
                    const t = isUsableTrackingNumber(item.tracking_number)
                        ? String(item.tracking_number).trim()
                        : null;
                    const normalizedItem = { ...item, tracking_number: t };

                    // Every insert requires a real order number. Generated UNK values
                    // are only parser fallbacks and must never reach Supabase.
                    if (!hasOrderNumber) {
                        skippedMissingOrderNumberCount++;
                        skippedMissingOrderNumberRows.push(
                            normalizeString(item.product_code) || '(ไม่พบ SKU)'
                        );
                        return;
                    }

                    // A row that already has tracking must update an existing order.
                    // If the order number is unknown to Supabase, skip it.
                    if (t && sameOrderRows.length === 0) {
                        skippedTrackingOrderNotFoundCount++;
                        skippedTrackingOrderNotFoundNumbers.push(normalizeString(item.order_number));
                        return;
                    }

                    const canUpdateExistingOrder = sameOrderRows.length === 0
                        || sameOrderRows.every(order => productionDoneStatuses.has(normalizeString(order.tracking_status)));

                    if (!canUpdateExistingOrder) {
                        blockedStatusCount++;
                        blockedOrderNumbers.push(normalizeString(item.order_number));
                        return;
                    }

                    const trackingMatch = t
                        ? existingByTracking.get(normalizeMatchPart(t))
                        : null;
                    let existing = trackingMatch
                        && normalizeMatchPart(trackingMatch.order_number) === orderNumberKey
                        ? trackingMatch
                        : existingByOrderKey.get(buildOrderMatchKey(normalizedItem));

                    if (!existing && sameOrderRows.length > 0) {
                        const productCodeKey = normalizeMatchPart(normalizedItem.product_code);
                        const sameProductRows = sameOrderRows.filter(order =>
                            normalizeMatchPart(order.product_code) === productCodeKey
                        );
                        if (sameProductRows.length === 1) {
                            existing = sameProductRows[0];
                        } else if (sameOrderRows.length === 1) {
                            existing = sameOrderRows[0];
                        }
                    }

                    if (existing) {
                        itemsToUpdate.push({
                            id: existing.id,
                            payload: buildImportUpdate(normalizedItem, existing)
                        });
                        return;
                    }

                    if (sameOrderRows.length > 0) {
                        skippedUnmatchedExistingCount++;
                        skippedUnmatchedExistingNumbers.push(normalizeString(item.order_number));
                        return;
                    }

                    // New rows may be inserted only when they have a real order number.
                    // Rows with tracking were already rejected above when no order existed.
                    itemsToInsert.push(normalizedItem);
                });

                log('กำลังตรวจสอบว่า SKU ทุกรหัสมีอยู่ใน SKU Master...');
                const skuValidation = await validateOrderSkuReferences([
                    ...itemsToInsert,
                    ...itemsToUpdate.map(item => item.payload)
                ]);

                if (skuValidation.missing.length || skuValidation.rowsWithoutSku.length) {
                    const missingDetails = skuValidation.missing.slice(0, 12).map(item =>
                        `${item.code} (ออเดอร์: ${item.orders.slice(0, 3).join(', ')})`
                    );
                    if (skuValidation.rowsWithoutSku.length) {
                        missingDetails.push(`ไม่มีรหัส SKU (ออเดอร์: ${skuValidation.rowsWithoutSku.slice(0, 3).join(', ')})`);
                    }
                    const remainingCount = Math.max(0, skuValidation.missing.length - 12);
                    const remainingText = remainingCount ? `\nและอีก ${remainingCount} SKU` : '';
                    throw new Error(
                        `ไม่สามารถบันทึกได้ เพราะไม่พบ SKU ใน sku_master:\n${missingDetails.join('\n')}${remainingText}\n\nกรุณาเพิ่ม SKU เหล่านี้ในหน้า จัดการ SKU แล้วอัปโหลดไฟล์อีกครั้ง`
                    );
                }
                log(`ตรวจสอบ SKU Master ผ่าน ${new Set([
                    ...itemsToInsert.map(item => item.product_code),
                    ...itemsToUpdate.map(item => item.payload.product_code)
                ].filter(Boolean)).size} รหัส`, 'success');

                // Supabase assigns production numbers atomically when each new row is inserted.
                itemsToInsert.forEach(item => { item.production_number = null; });

                const skipCount = blockedStatusCount;

                if (itemsToInsert.length === 0 && itemsToUpdate.length === 0) {
                    log("ไม่มีรายการที่ผ่านเงื่อนไขสำหรับบันทึก", "error");
                    const sampleOrders = blockedOrderNumbers.slice(0, 8).join(', ');
                    const trackingNotFoundSamples = [...new Set(skippedTrackingOrderNotFoundNumbers)]
                        .slice(0, 8)
                        .join(', ');
                    const allSkippedNumbers = [...new Set([
                        ...blockedOrderNumbers,
                        ...skippedShopeeMissingShipDateOrders,
                        ...skippedTrackingOrderNotFoundNumbers,
                        ...skippedUnmatchedExistingNumbers
                    ].filter(isUsableOrderNumber))].join(', ');
                    alert(
                        `⚠️ ไม่มีรายการที่สามารถบันทึกได้\n\n` +
                        `ออเดอร์เดิมที่สถานะยังไม่เป็น "ผลิตสำเร็จแล้ว": ${skipCount} รายการ` +
                        `${sampleOrders ? `\nตัวอย่าง: ${sampleOrders}` : ''}\n` +
                        `มีเลขพัสดุแต่ไม่พบเลขออเดอร์ใน Supabase: ${skippedTrackingOrderNotFoundCount} รายการ` +
                        `${trackingNotFoundSamples ? `\nตัวอย่าง: ${trackingNotFoundSamples}` : ''}\n` +
                        `ไม่มีเลขออเดอร์: ${skippedMissingOrderNumberCount} รายการ\n` +
                        `พบออเดอร์แต่จับคู่รายการสินค้าไม่ได้: ${skippedUnmatchedExistingCount} รายการ` +
                        `${allSkippedNumbers ? `\nเลขออเดอร์ที่ถูกข้าม: ${allSkippedNumbers}` : ''}`
                    );
                    resetBulkUI();
                    return;
                }

                log(
                    `เตรียมการ: อัปเดตข้อมูลเก่า ${itemsToUpdate.length} รายการ, ` +
                    `บันทึกใหม่ ${itemsToInsert.length} รายการ, ` +
                    `บล็อกเพราะยังผลิตไม่สำเร็จ ${skipCount} รายการ, ` +
                    `ข้ามแถวมีเลขพัสดุแต่ไม่พบออเดอร์เดิม ${skippedTrackingOrderNotFoundCount} รายการ, ` +
                    `ข้ามแถวไม่มีเลขออเดอร์ ${skippedMissingOrderNumberCount} รายการ...`
                );

                // 1. ทำการอัปเดต
                let updatedCount = 0;
                for (const updateObj of itemsToUpdate) {
                    const { error } = await dbSupabase
                        .from(SUPABASE_TABLE_NAME)
                        .update(updateObj.payload)
                        .eq('id', updateObj.id);
                    if (error) throw error;
                    updatedCount++;
                    if (updatedCount % 20 === 0) log(`อัปเดตข้อมูลแล้ว ${updatedCount}/${itemsToUpdate.length} รายการ`);
                }

                // 2. ทำการเพิ่มข้อมูลใหม่
                const chunkSize = 50;
                let insertedCount = 0;
                for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
                    const chunk = itemsToInsert.slice(i, i + chunkSize);
                    // Normalize payment_time on each item to be ISO string or null
                    chunk.forEach(it => { it.payment_time = normalizePaymentTime(it.payment_time); });
                    // Debug: log chunk payload
                    console.log(`[DEBUG] insert payload chunk ${i}-${i+chunk.length}`, chunk.map(it => ({ order_number: it.order_number, production_number: it.production_number, payment_time: it.payment_time })));
                    const { error } = await dbSupabase.from(SUPABASE_TABLE_NAME).insert(chunk);
                    if (error) throw error;
                    insertedCount += chunk.length;
                    log(`บันทึกข้อมูลใหม่แล้ว ${insertedCount}/${itemsToInsert.length} รายการ`);
                }

                log("บันทึกข้อมูลและอัปเดตทั้งหมดสำเร็จ!", "success");
                const skippedOrderSamples = [...new Set([
                    ...blockedOrderNumbers,
                    ...skippedShopeeMissingShipDateOrders,
                    ...skippedTrackingOrderNotFoundNumbers,
                    ...skippedUnmatchedExistingNumbers
                ].filter(isUsableOrderNumber))].join(', ');
                alert(
                    `✅ ดำเนินการสำเร็จ!\n` +
                    `- อัปเดตออเดอร์เดิมที่ผลิตสำเร็จแล้ว: ${updatedCount} รายการ\n` +
                    `- บันทึกออเดอร์ใหม่ที่มีเลขออเดอร์: ${insertedCount} รายการ\n` +
                    `- บล็อกออเดอร์เดิมที่ยังผลิตไม่สำเร็จ: ${skipCount} รายการ\n` +
                    `- ข้าม Shopee ที่ไม่มีวันที่คาดว่าจะจัดส่ง: ${skippedShopeeMissingShipDateCount} รายการ\n` +
                    `- ข้ามแถวมีเลขพัสดุแต่ไม่พบออเดอร์เดิม: ${skippedTrackingOrderNotFoundCount} รายการ\n` +
                    `- ข้ามแถวไม่มีเลขออเดอร์: ${skippedMissingOrderNumberCount} รายการ\n` +
                    `- ข้ามแถวที่จับคู่สินค้าในออเดอร์เดิมไม่ได้: ${skippedUnmatchedExistingCount} รายการ` +
                    `${skippedOrderSamples ? `\n  เลขออเดอร์ที่ถูกข้าม: ${skippedOrderSamples}` : ''}`
                );
                resetBulkUI();

            } catch (error) {
                log(`ล้มเหลว: ${error.message}`, "error");
                alert(`❌ เกิดข้อผิดพลาด: ${error.message}`);
            } finally {
                bulkUploadBtn.disabled = false;
                if (btnText) btnText.style.display = 'inline';
                if (btnLoader) btnLoader.style.display = 'none';
            }
        });

        function resetBulkUI() {
            parsedDataToUpload = [];
            if (fileInput) fileInput.value = ""; 
            const tbody = document.getElementById('previewBody');
            if (tbody) tbody.innerHTML = ""; 
            const ps = document.getElementById('previewSection');
            if (ps) ps.style.display = 'none';
            const fnd = document.getElementById('fileNameDisplay');
            if (fnd) fnd.textContent = "📂 ลากไฟล์มาวาง หรือ คลิกเพื่อเลือกไฟล์";
            log("รีเซ็ตระบบอัปโหลดเรียบร้อย พร้อมสำหรับไฟล์ใหม่");
        }

        // ================================
        // CANCEL BUTTON FOR UPLOAD FORM
        // ================================
        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        if (cancelUploadBtn) {
            cancelUploadBtn.addEventListener('click', () => {
                resetBulkUI();
                log('ล้างข้อมูลการอัปโหลดและ preview เรียบร้อย', 'success');
            });
        }

        // ================================
        // Upload PM (Afternoon) Button
        // ================================
        const bulkUploadPMBtn = document.getElementById('bulkUploadPMBtn');
        if (bulkUploadPMBtn) {
            bulkUploadPMBtn.addEventListener('click', async () => {
                if (!parsedDataToUpload.length || !dbSupabase) return alert('ไม่มีข้อมูลที่จะอัปโหลด หรือ Supabase client ไม่พร้อม');

                // Filter rows with payment_time from 11:00 onwards (11:00 - 23:59 local time)
                const pmRows = parsedDataToUpload.filter(r => {
                    if (!r.payment_time) return false;
                    try {
                        const d = new Date(r.payment_time);
                        if (isNaN(d.getTime())) return false;
                        const h = d.getHours();
                        return h >= 11 && h <= 23;
                    } catch (e) { return false; }
                });

                if (pmRows.length === 0) {
                    alert('ไม่พบรายการที่มีเวลาชำระในช่วงบ่าย (PM)');
                    return;
                }

                log(`เตรียมอัปโหลดช่วงบ่าย ${pmRows.length} รายการ...`);

                // Build unique order and tracking lists
                const orderNumbers = [...new Set(pmRows.map(r => String(r.order_number||'').trim()).filter(Boolean))];
                const trackingNumbers = [...new Set(pmRows.map(r => String(r.tracking_number||'').trim()).filter(Boolean))];

                // Fetch existing orders in DB to detect duplicates
                let existing = [];
                try {
                    const chunkSize = 80;
                    for (let i = 0; i < orderNumbers.length; i += chunkSize) {
                        const chunk = orderNumbers.slice(i, i + chunkSize);
                        const { data, error } = await dbSupabase.from(SUPABASE_TABLE_NAME).select('id,order_number,tracking_number,product_code,payment_time').in('order_number', chunk);
                        if (error) throw error;
                        if (data) existing = existing.concat(data);
                    }
                    for (let i = 0; i < trackingNumbers.length; i += chunkSize) {
                        const chunk = trackingNumbers.slice(i, i + chunkSize);
                        const { data, error } = await dbSupabase.from(SUPABASE_TABLE_NAME).select('id,order_number,tracking_number,product_code,payment_time').in('tracking_number', chunk);
                        if (error) throw error;
                        if (data) existing = existing.concat(data);
                    }
                } catch (err) {
                    log(`ดึงข้อมูลจาก DB ล้มเหลว: ${err.message}`, 'error');
                    alert('ไม่สามารถตรวจสอบข้อมูลซ้ำได้: ' + err.message);
                    return;
                }

                const byTracking = new Map();
                const byOrderSku = new Map();
                existing.forEach(e => {
                    if (e.tracking_number) byTracking.set(String(e.tracking_number).trim(), e);
                    const key = `${String(e.order_number||'').trim()}|${String(e.product_code||'').trim()}`;
                    byOrderSku.set(key, e);
                });

                const toInsert = [];
                let skipped = 0;

                // Only skip PM rows when tracking number already exists in DB.
                // Allow duplicate order_number values (even same order+SKU/payment_time),
                // because requirement is: order numbers may repeat but tracking numbers must be unique.
                pmRows.forEach(row => {
                    const t = row.tracking_number && String(row.tracking_number).trim();
                    if (t && byTracking.has(t)) { skipped++; return; }
                    toInsert.push(row);
                });

                if (toInsert.length === 0) {
                    alert(`ไม่พบรายการใหม่ที่จะอัปโหลด (ข้าม ${skipped} รายการ)`);
                    return;
                }

                if (!confirm(`จะอัปโหลด ${toInsert.length} รายการ (ข้าม ${skipped}) ใช่หรือไม่?`)) return;

                try {
                    const chunkSize = 50;
                    let insertedCount = 0;
                    for (let i = 0; i < toInsert.length; i += chunkSize) {
                        const chunk = toInsert.slice(i, i + chunkSize);
                        chunk.forEach(it => { it.payment_time = normalizePaymentTime(it.payment_time); });
                        console.log(`[DEBUG] PM insert payload ${i}-${i+chunk.length}`, chunk.map(it => ({ order_number: it.order_number, payment_time: it.payment_time })));
                        const { error } = await dbSupabase.from(SUPABASE_TABLE_NAME).insert(chunk);
                        if (error) throw error;
                        insertedCount += chunk.length;
                        log(`บันทึกข้อมูล PM แล้ว ${insertedCount}/${toInsert.length} รายการ`);
                    }
                    alert(`อัปโหลดช่วงบ่ายสำเร็จ: ${toInsert.length} รายการ (ข้าม ${skipped})`);
                    // remove inserted rows from parsedDataToUpload and refresh preview
                    parsedDataToUpload = parsedDataToUpload.filter(r => !toInsert.includes(r));
                    renderPreview();
                } catch (err) {
                    log(`อัปโหลดล้มเหลว: ${err.message}`, 'error');
                    alert('อัปโหลดล้มเหลว: ' + err.message);
                }
            });
        }
    }
});
