// Supabase Configuration — โหลดจาก config.js (ถูก gitignore แล้ว)
// ถ้าเปิดหน้าเว็บแล้วไม่ทำงาน ให้ตรวจสอบว่ามีไฟล์ config.js อยู่ในโฟลเดอร์
if (!window.SUPABASE_CONFIG) {
    document.addEventListener('DOMContentLoaded', () => {
        document.body.innerHTML = `
            <div style="font-family:'Kanit',sans-serif;text-align:center;padding:50px;color:white;background:#050811;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <h2 style="color:#f87171;">⚠️ ไม่พบไฟล์ config.js</h2>
                <p style="color:#94a3b8;margin:20px 0;">กรุณาสร้างไฟล์ <code style="background:#1e293b;padding:4px 8px;border-radius:6px;color:#fbbf24;">config.js</code> โดยคัดลอกจาก <code style="background:#1e293b;padding:4px 8px;border-radius:6px;color:#fbbf24;">config.example.js</code> แล้วใส่ค่า Supabase URL และ KEY ของคุณ</p>
                <p style="color:#64748b;font-size:0.85rem;">ดูวิธีติดตั้งใน README.md</p>
            </div>`;
    });
}

if (window.location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', () => {
        const target = document.body || document.querySelector('body');
        if (!target) return;
        target.innerHTML = `
            <div style="font-family:'Kanit',sans-serif;text-align:center;padding:50px;color:white;background:#050811;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <h2 style="color:#f87171;">⚠️ เปิดหน้าแบบ file:// ไม่รองรับ</h2>
                <p style="color:#fbbf24;margin:12px 0 8px;">กรุณาเปิดผ่าน localhost เท่านั้น</p>
                <p style="color:#94a3b8; margin: 0 0 20px;">รันคำสั่งนี้ในโฟลเดอร์โปรเจกต์แล้วเปิด <strong>http://localhost:8000/login.html</strong></p>
                <code style="background:#1e293b;padding:10px 14px;border-radius:8px;color:#e2e8f0;display:inline-block;">python -m http.server 8000</code>
            </div>`;
    });
}

// Initialize Supabase
let supabaseClient = null;
if (window.supabase && window.SUPABASE_CONFIG) {
    supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY);
}

const PERMISSION_PAGE_CATALOG = [
    ['index.html', 'บันทึกออเดอร์', '📝'],
    ['dashboard.html', 'แดชบอร์ดออเดอร์', '📊'],
    ['executive_dashboard.html', 'แดชบอร์ดผู้บริหาร', '📈'],
    ['executive_dashboard_money.html', 'แดชบอร์ดผู้บริหาร (เงิน)', '💰'],
    ['production.html', 'ฝ่ายผลิต', '🏭'],
    ['production_history.html', 'ประวัติการผลิต', '🕘'],
    ['material_prep.html', 'จัดเตรียมวัสดุ', '📋'],
    ['stock_management.html', 'จัดการสต็อก', '📦'],
    ['backup_stock.html', 'สต็อกสำรอง', '🗄️'],
    ['sku_manage.html', 'จัดการ SKU', '🏷️'],
    ['stock_bom_manage.html', 'จัดการ BOM', '🧩'],
    ['damage_report.html', 'วัสดุเสียหาย', '⚠️'],
    ['user_management.html', 'จัดการสมาชิกและสิทธิ์', '🔐']
];

async function checkAuth() {
    if (!supabaseClient) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    const pathParts = window.location.pathname.split('/');
    const currentPage = pathParts[pathParts.length - 1] || 'index.html';

    // If on login page, just check if already logged in
    if (currentPage === 'login.html') {
        if (session) {
            redirectBasedOnRole(session.user);
        }
        return;
    }

    // Not logged in -> Redirect to login
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    // Fetch user role
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (error || !profile) {
        console.error("Auth Error:", error);
        // Error handling for missing profile
        document.body.innerHTML = `
            <div style="font-family:'Kanit', sans-serif; text-align:center; padding:50px; color:white; background:#050811; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <h2 style="color:#f87171;">⚠️ ไม่พบข้อมูลสิทธิ์การใช้งาน</h2>
                <p style="color:#94a3b8; margin: 20px 0;">ID ของคุณคือ: <code style="background:#1e293b; padding:4px 8px; border-radius:6px; color:#fbbf24;">${session.user.id}</code></p>
                <p style="color:#94a3b8;">กรุณาคัดลอก ID ด้านบนไปเพิ่มในตาราง profiles และกำหนดสิทธิ์ (Admin, Ceo หรือ pdtPerson)</p>
                <button onclick="auth.logout()" style="margin-top:30px; padding:12px 24px; cursor:pointer; background:#1e293b; border:1px solid #334155; color:white; border-radius:12px; font-family:inherit;">
                    🚪 กลับไปหน้า Login
                </button>
            </div>`;
        return;
    }

    const userRole = profile.role;
    window.auth.role = userRole; // Expose role
    let pagePermissions = [];
    if (userRole !== 'Ceo') {
        const { data: permissionRows, error: permissionError } = await supabaseClient
            .from('user_page_permissions')
            .select('page_key, can_access')
            .eq('user_id', session.user.id);

        if (!permissionError) pagePermissions = permissionRows || [];
        else console.error('Unable to load permissions:', permissionError.message);
    }
    window.auth.pagePermissions = pagePermissions;

    // CEO controls explicit page permissions for every non-CEO account.
    initUI(session.user, userRole, pagePermissions);

    const pageAccessPermissions = pagePermissions.filter(item => String(item.page_key || '').endsWith('.html'));
    const customPermission = pageAccessPermissions.find(item => item.page_key === currentPage);
    const isAllowed = userRole === 'Ceo' || customPermission?.can_access === true;

    if (!isAllowed) {
        alert('ขออภัย CEO ยังไม่ได้กำหนดสิทธิ์ให้คุณเข้าถึงหน้านี้');
        redirectBasedOnRole(session.user, userRole, pagePermissions);
        return;
    }

    window.dispatchEvent(new CustomEvent('auth-ready', {
        detail: { role: userRole, permissions: pagePermissions }
    }));
}

function initUI(user, role, pagePermissions = []) {
    // 1. Update User Display Area
    const displayArea = document.getElementById('user-display-area');
    if (displayArea) {
        const roleColors = {
            'Admin': 'var(--primary)',
            'Ceo': 'var(--status-success-text)',
            'pdtPerson': 'var(--status-pending-text)',
            'APRD': 'var(--purple)'
        };

        const color = roleColors[role] || 'var(--muted-strong)';
        
        displayArea.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;background:var(--surface);padding:7px 12px;border-radius:12px;border:1px solid var(--border-strong);box-shadow:0 4px 12px var(--surface-shadow);font-size:0.85rem;">
                <span style="color:var(--muted-strong);">👤</span>
                <span style="color:var(--text-main);font-weight:600;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${user.email}">${user.email}</span>
                <span style="width:1px;height:16px;background:var(--border-strong);margin:0 4px;"></span>
                <span style="color: ${color}; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">${role}</span>
            </div>
        `;
    }

    const pageAccessPermissions = pagePermissions.filter(item => String(item.page_key || '').endsWith('.html'));
    if (role !== 'Ceo') {
        const grantedPages = new Set(
            pageAccessPermissions.filter(item => item.can_access).map(item => item.page_key)
        );
        document.querySelectorAll('a[href]').forEach(link => {
            const href = (link.getAttribute('href') || '').split('?')[0].split('#')[0];
            if (href.endsWith('.html') && href !== 'login.html' && !grantedPages.has(href)) {
                link.style.display = 'none';
            }
        });
    }

    document.querySelectorAll('[data-required-permission]').forEach(element => {
        const permissionKey = element.dataset.requiredPermission;
        const allowed = role === 'Ceo' || pagePermissions.some(item =>
            item.page_key === permissionKey && item.can_access === true
        );
        element.hidden = !allowed;
        element.setAttribute('aria-hidden', String(!allowed));
        if ('disabled' in element) element.disabled = !allowed;
    });

    initPermissionNavigation(role, pagePermissions);

    console.log(`UI Initialized for ${user.email} as ${role}`);
}

function initPermissionNavigation(role, pagePermissions = []) {
    document.getElementById('permission-page-navigation')?.remove();

    const grantedPages = new Set(
        pagePermissions
            .filter(item => item.can_access === true && String(item.page_key || '').endsWith('.html'))
            .map(item => item.page_key)
    );
    const allowedPages = PERMISSION_PAGE_CATALOG.filter(([pageKey]) =>
        role === 'Ceo' || grantedPages.has(pageKey)
    );
    if (!allowedPages.length) return;

    if (!document.getElementById('permission-navigation-styles')) {
        const style = document.createElement('style');
        style.id = 'permission-navigation-styles';
        style.textContent = `
            #permission-page-navigation { position:fixed; right:18px; top:74px; z-index:10000; font-family:'Kanit',sans-serif; }
            #permission-page-navigation .permission-nav-toggle { display:flex; align-items:center; gap:8px; min-height:44px; padding:10px 15px; border:1px solid var(--border-strong,#334155); border-radius:14px; background:var(--surface,#111827); color:var(--text-main,#f8fafc); box-shadow:0 12px 30px rgba(2,6,23,.28); cursor:pointer; font:600 .88rem 'Kanit',sans-serif; }
            #permission-page-navigation .permission-nav-count { display:inline-grid; place-items:center; min-width:24px; height:24px; padding:0 6px; border-radius:99px; background:#2563eb; color:#fff; font-size:.75rem; }
            #permission-page-navigation .permission-nav-panel { position:absolute; right:0; top:52px; width:min(320px,calc(100vw - 28px)); max-height:min(68vh,560px); overflow:auto; padding:10px; border:1px solid var(--border-strong,#334155); border-radius:16px; background:var(--bg-card,var(--surface,#111827)); box-shadow:0 22px 50px rgba(2,6,23,.38); }
            #permission-page-navigation .permission-nav-panel[hidden] { display:none !important; }
            #permission-page-navigation .permission-nav-title { padding:6px 8px 10px; color:var(--muted-strong,#94a3b8); font-size:.76rem; font-weight:600; }
            #permission-page-navigation .permission-nav-link { display:flex; align-items:center; gap:10px; padding:10px 11px; margin:2px 0; border:1px solid transparent; border-radius:11px; color:var(--text-main,#f8fafc); text-decoration:none; font-size:.88rem; }
            #permission-page-navigation .permission-nav-link:hover { background:rgba(59,130,246,.12); border-color:rgba(59,130,246,.3); }
            #permission-page-navigation .permission-nav-link.active { background:#2563eb; border-color:#60a5fa; color:#fff; font-weight:700; }
            #permission-page-navigation .permission-nav-icon { width:24px; text-align:center; }
            @media (max-width:640px) { #permission-page-navigation { top:auto; right:12px; bottom:76px; } #permission-page-navigation .permission-nav-panel { top:auto; bottom:52px; max-height:58vh; } }
        `;
        document.head.appendChild(style);
    }

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navigation = document.createElement('nav');
    navigation.id = 'permission-page-navigation';
    navigation.setAttribute('aria-label', 'หน้าที่ CEO อนุญาต');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'permission-nav-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `<span>☰ หน้าที่เข้าถึง</span><span class="permission-nav-count">${allowedPages.length}</span>`;

    const panel = document.createElement('div');
    panel.className = 'permission-nav-panel';
    panel.hidden = true;
    const title = document.createElement('div');
    title.className = 'permission-nav-title';
    title.textContent = 'เมนูตามสิทธิ์ที่ CEO กำหนด';
    panel.appendChild(title);

    allowedPages.forEach(([pageKey, label, icon]) => {
        const link = document.createElement('a');
        link.href = pageKey;
        link.className = `permission-nav-link${pageKey === currentPage ? ' active' : ''}`;
        if (pageKey === currentPage) link.setAttribute('aria-current', 'page');
        const iconElement = document.createElement('span');
        iconElement.className = 'permission-nav-icon';
        iconElement.textContent = icon;
        const labelElement = document.createElement('span');
        labelElement.textContent = label;
        link.append(iconElement, labelElement);
        panel.appendChild(link);
    });

    const closePanel = () => {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', event => {
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', closePanel);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closePanel();
    });

    navigation.append(toggle, panel);
    document.body.appendChild(navigation);
}

async function redirectBasedOnRole(user, role = null, pagePermissions = null) {
    if (role) {
        const pageAccessPermissions = Array.isArray(pagePermissions)
            ? pagePermissions.filter(item => String(item.page_key || '').endsWith('.html'))
            : [];
        if (role !== 'Ceo') {
            const firstAllowed = pageAccessPermissions.find(item => item.can_access === true);
            if (firstAllowed) window.location.href = firstAllowed.page_key;
            else {
                alert('บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงหน้าใด กรุณาติดต่อ CEO');
                await logout();
            }
            return;
        }
        window.location.href = 'index.html';
        return;

    }

    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (!profile) {
        await logout();
        return;
    }

    let permissions = [];
    if (profile.role !== 'Ceo') {
        const { data } = await supabaseClient
            .from('user_page_permissions')
            .select('page_key, can_access')
            .eq('user_id', user.id);
        permissions = data || [];
    }
    await redirectBasedOnRole(user, profile.role, permissions);
}

async function logout() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }
}

function hasPermission(permissionKey) {
    if (!permissionKey) return false;
    if (window.auth?.role === 'Ceo') return true;
    return (window.auth?.pagePermissions || []).some(item =>
        item.page_key === permissionKey && item.can_access === true
    );
}

function canAccessPage(pageKey) {
    if (!pageKey || !String(pageKey).endsWith('.html')) return false;
    return hasPermission(pageKey);
}

// Run auth check on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAuth);
} else {
    checkAuth();
}

// Export for use in pages
window.auth = {
    supabase: supabaseClient,
    logout: logout,
    hasPermission: hasPermission,
    canAccessPage: canAccessPage,
    role: null, // Will be set after checkAuth
    pagePermissions: []
};
