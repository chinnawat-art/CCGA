// ติดตั้งแอปลงหน้าจอมือถือ — ลงทะเบียน service worker + ปุ่ม "ติดตั้งแอป"
(function () {
    'use strict';

    // ลงทะเบียน service worker (ต้องเป็น https หรือ localhost เท่านั้น)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function (err) {
                console.warn('ลงทะเบียน service worker ไม่สำเร็จ:', err && err.message);
            });
        });
    }

    // Chrome/Android: จะยิง beforeinstallprompt เมื่อติดตั้งได้
    // เก็บไว้แล้วโชว์ปุ่มของเราเอง เพราะเมนู "เพิ่มลงหน้าจอหลัก" ของเบราว์เซอร์หายาก
    var deferred = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferred = e;
        showInstallButton();
    });

    window.addEventListener('appinstalled', function () {
        deferred = null;
        var b = document.getElementById('pwa-install-btn');
        if (b) b.remove();
        try { localStorage.setItem('pwa_installed', '1'); } catch (e) {}
    });

    function showInstallButton() {
        if (document.getElementById('pwa-install-btn')) return;
        // เปิดจากไอคอนที่ติดตั้งแล้ว ไม่ต้องโชว์ปุ่มอีก
        if (window.matchMedia('(display-mode: standalone)').matches) return;
        try { if (localStorage.getItem('pwa_install_dismissed') === '1') return; } catch (e) {}

        var wrap = document.createElement('div');
        wrap.id = 'pwa-install-btn';
        wrap.innerHTML =
            '<button type="button" class="pwa-install-main">📲 ติดตั้งแอปลงมือถือ</button>' +
            '<button type="button" class="pwa-install-close" aria-label="ไม่ต้องตอนนี้">✕</button>';

        var style = document.createElement('style');
        style.textContent =
            '#pwa-install-btn{position:fixed;left:16px;bottom:18px;z-index:10001;display:flex;' +
            'align-items:center;gap:6px;font-family:"Kanit",sans-serif;}' +
            '#pwa-install-btn .pwa-install-main{padding:12px 18px;border:0;border-radius:14px;' +
            'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font:600 .92rem "Kanit",sans-serif;' +
            'box-shadow:0 10px 26px rgba(99,102,241,.42);cursor:pointer;}' +
            '#pwa-install-btn .pwa-install-close{width:34px;height:34px;border-radius:50%;border:0;' +
            'background:rgba(100,116,139,.28);color:#e2e8f0;font-size:.85rem;cursor:pointer;}' +
            '@media (max-width:640px){#pwa-install-btn{left:12px;bottom:12px;}}';

        document.head.appendChild(style);
        document.body.appendChild(wrap);

        wrap.querySelector('.pwa-install-main').addEventListener('click', function () {
            if (!deferred) return;
            deferred.prompt();
            deferred.userChoice.then(function () {
                deferred = null;
                wrap.remove();
            });
        });

        wrap.querySelector('.pwa-install-close').addEventListener('click', function () {
            try { localStorage.setItem('pwa_install_dismissed', '1'); } catch (e) {}
            wrap.remove();
        });
    }
})();
