// ติดตั้งแอปลงหน้าจอมือถือ
// แนวคิด: ไม่พึ่ง beforeinstallprompt อย่างเดียว เพราะ iPhone ไม่ส่งสัญญาณนี้เลย
// และ Chrome บางกรณีก็ไม่ส่ง ปุ่มจึงขึ้นเสมอบนมือถือ แล้วสอนวิธีติดตั้งตามเบราว์เซอร์
(function () {
    'use strict';

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function (err) {
                console.warn('ลงทะเบียน service worker ไม่สำเร็จ:', err && err.message);
            });
        });
    }

    var deferred = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferred = e;
        var b = document.querySelector('#pwa-install-btn .pwa-install-main');
        if (b) b.textContent = '📲 ติดตั้งแอปลงมือถือ';
    });

    window.addEventListener('appinstalled', function () {
        deferred = null;
        var w = document.getElementById('pwa-install-btn');
        if (w) w.remove();
        closeGuide();
    });

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function detectBrowser() {
        var ua = navigator.userAgent;
        var isIOS = /iPad|iPhone|iPod/.test(ua)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
            if (/CriOS|FxiOS|EdgiOS/.test(ua)) return 'ios-other';
            return 'ios-safari';
        }
        if (/Line\/|FBAN|FBAV|Instagram|Messenger/i.test(ua)) return 'inapp';
        if (/Android/.test(ua)) return 'android';
        return 'desktop';
    }

    var GUIDES = {
        'android': {
            title: '📲 ติดตั้งลงหน้าจอมือถือ',
            steps: [
                'กดปุ่ม <b>จุดสามจุด ⋮</b> มุมขวาบนของเบราว์เซอร์',
                'เลือก <b>"ติดตั้งแอป"</b> หรือ <b>"เพิ่มลงในหน้าจอหลัก"</b>',
                'กด <b>ติดตั้ง</b> เพื่อยืนยัน',
                'ไอคอนจะไปอยู่บนหน้าจอมือถือ กดเปิดได้เลย'
            ],
            note: 'ถ้าหาเมนูไม่เจอ ให้ปิดแท็บนี้แล้วเปิดเว็บใหม่อีกครั้ง'
        },
        'ios-safari': {
            title: '📲 เพิ่มลงหน้าจอ iPhone',
            steps: [
                'กดปุ่ม <b>แชร์</b> (รูปสี่เหลี่ยมมีลูกศรชี้ขึ้น) ตรงกลางแถบล่าง',
                'เลื่อนรายการลงมาหา <b>"เพิ่มไปยังหน้าจอโฮม"</b>',
                'กด <b>เพิ่ม</b> มุมขวาบน',
                'ไอคอนจะไปอยู่บนหน้าจอ กดเปิดได้เลย'
            ],
            note: 'iPhone ไม่มีปุ่มติดตั้งอัตโนมัติ ต้องทำผ่านเมนูแชร์เท่านั้น'
        },
        'ios-other': {
            title: '⚠️ ต้องเปิดใน Safari ก่อน',
            steps: [
                'ก๊อปที่อยู่เว็บนี้ไว้',
                'เปิดแอป <b>Safari</b> (ไอคอนเข็มทิศสีฟ้า)',
                'วางที่อยู่เว็บแล้วเข้าเว็บ',
                'กดปุ่ม <b>แชร์</b> แล้วเลือก <b>"เพิ่มไปยังหน้าจอโฮม"</b>'
            ],
            note: 'บน iPhone มีแค่ Safari ที่ติดตั้งเว็บเป็นแอปได้ Chrome ทำไม่ได้'
        },
        'inapp': {
            title: '⚠️ ต้องเปิดในเบราว์เซอร์ก่อน',
            steps: [
                'กดปุ่ม <b>จุดสามจุด</b> มุมขวาบน',
                'เลือก <b>"เปิดในเบราว์เซอร์"</b> หรือ <b>"เปิดด้วย Chrome"</b>',
                'พอเปิดใน Chrome แล้ว กดปุ่มติดตั้งนี้อีกครั้ง'
            ],
            note: 'ตอนนี้กำลังเปิดอยู่ในแอปอื่น เช่น LINE ซึ่งติดตั้งแอปไม่ได้'
        },
        'desktop': {
            title: '💻 ติดตั้งบนคอมพิวเตอร์',
            steps: [
                'ดูแถบที่อยู่เว็บด้านบน จะมี <b>ไอคอนจอมีลูกศรลง</b> ทางขวา',
                'กดไอคอนนั้น แล้วกด <b>ติดตั้ง</b>'
            ],
            note: ''
        }
    };

    function openGuide() {
        closeGuide();
        var g = GUIDES[detectBrowser()] || GUIDES.desktop;
        var ov = document.createElement('div');
        ov.id = 'pwa-guide';
        ov.innerHTML =
            '<div class="pwa-guide-box" role="dialog" aria-modal="true">' +
            '<div class="pwa-guide-title">' + g.title + '</div>' +
            '<ol class="pwa-guide-steps">' +
            g.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
            '</ol>' +
            (g.note ? '<div class="pwa-guide-note">💡 ' + g.note + '</div>' : '') +
            '<button type="button" class="pwa-guide-ok">เข้าใจแล้ว</button>' +
            '</div>';
        ov.addEventListener('click', function (e) { if (e.target === ov) closeGuide(); });
        ov.querySelector('.pwa-guide-ok').addEventListener('click', closeGuide);
        document.body.appendChild(ov);
    }

    function closeGuide() {
        var g = document.getElementById('pwa-guide');
        if (g) g.remove();
    }

    function injectStyles() {
        if (document.getElementById('pwa-styles')) return;
        var s = document.createElement('style');
        s.id = 'pwa-styles';
        s.textContent = [
            '#pwa-install-btn{position:fixed;left:16px;bottom:18px;z-index:10001;display:flex;',
            'align-items:center;gap:6px;font-family:"Kanit",sans-serif;}',
            '#pwa-install-btn .pwa-install-main{padding:12px 18px;border:0;border-radius:14px;',
            'background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;',
            'font:600 .92rem "Kanit",sans-serif;',
            'box-shadow:0 10px 26px rgba(99,102,241,.42);cursor:pointer;}',
            '#pwa-install-btn .pwa-install-close{width:34px;height:34px;border-radius:50%;border:0;',
            'background:rgba(100,116,139,.35);color:#e2e8f0;font-size:.85rem;cursor:pointer;}',
            '@media (max-width:640px){#pwa-install-btn{left:12px;bottom:12px;}}',
            '#pwa-guide{position:fixed;inset:0;z-index:10002;background:rgba(2,6,23,.72);',
            'display:flex;align-items:center;justify-content:center;padding:20px;',
            'font-family:"Kanit",sans-serif;}',
            '#pwa-guide .pwa-guide-box{background:#fff;color:#0f172a;border-radius:20px;',
            'padding:24px 22px;max-width:420px;width:100%;box-shadow:0 30px 70px rgba(0,0,0,.4);',
            'max-height:85vh;overflow:auto;}',
            '#pwa-guide .pwa-guide-title{font-size:1.15rem;font-weight:700;margin-bottom:14px;}',
            '#pwa-guide .pwa-guide-steps{margin:0 0 14px;padding-left:22px;line-height:1.95;',
            'font-size:.96rem;}',
            '#pwa-guide .pwa-guide-steps li{margin-bottom:6px;}',
            '#pwa-guide .pwa-guide-note{background:#f1f5f9;border-radius:12px;padding:11px 13px;',
            'font-size:.87rem;color:#475569;line-height:1.6;margin-bottom:16px;}',
            '#pwa-guide .pwa-guide-ok{width:100%;padding:13px;border:0;border-radius:13px;',
            'background:#6366f1;color:#fff;font:600 1rem "Kanit",sans-serif;cursor:pointer;}'
        ].join('');
        document.head.appendChild(s);
    }

    function showInstallButton() {
        if (document.getElementById('pwa-install-btn')) return;
        if (isStandalone()) return;
        if (detectBrowser() === 'desktop' && !deferred) return;
        try { if (localStorage.getItem('pwa_install_dismissed') === '1') return; } catch (e) {}

        injectStyles();
        var wrap = document.createElement('div');
        wrap.id = 'pwa-install-btn';
        wrap.innerHTML =
            '<button type="button" class="pwa-install-main">📲 ติดตั้งลงหน้าจอ</button>' +
            '<button type="button" class="pwa-install-close" aria-label="ไม่ต้องตอนนี้">✕</button>';
        document.body.appendChild(wrap);

        wrap.querySelector('.pwa-install-main').addEventListener('click', function () {
            if (deferred) {
                deferred.prompt();
                deferred.userChoice.then(function (r) {
                    deferred = null;
                    if (r && r.outcome === 'accepted') wrap.remove();
                });
            } else {
                openGuide();
            }
        });

        wrap.querySelector('.pwa-install-close').addEventListener('click', function () {
            try { localStorage.setItem('pwa_install_dismissed', '1'); } catch (e) {}
            wrap.remove();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showInstallButton);
    } else {
        showInstallButton();
    }
})();
