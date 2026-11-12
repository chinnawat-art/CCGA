// ภาพตำแหน่งบาน (ชุด 2 / 3 / 4 บาน) — ใช้ตอนเลือกบานในสต๊อกบาน / ของตีกลับ / เริ่มผลิต
// เจ้าของกำหนด 07/11/2569 (มองจากรูปสินค้า ซ้าย → ขวา):
//   4 บาน: 1 ตายฝั่งซ้าย · 2 เลื่อนฝั่งจับเรียบ · 3 เลื่อนฝั่งจับล็อค · 4 ตายฝั่งขวา
//   3 บาน: 1 เลื่อนฝั่งซ้าย · 2 ตาย (ตรงกลาง) · 3 เลื่อนฝั่งขวา
//   2 บาน: 1 เลื่อนฝั่งซ้าย · 2 เลื่อนฝั่งขวา
// บานมุ้ง (เจ้าของสั่ง 12/11/2569): รุ่นที่มีมุ้ง = รหัสมีตัว N หลังรหัสสี (เช่น SLWD2P0604BBNL0)
//   SLWD/SLD 2-3 บาน มุ้ง 1 · 4 บาน มุ้ง 2 · บานกระทุ้ง ANWD / บานเปิด CMWDL/CMWDR มุ้ง 1 (เก็บได้แค่บานมุ้ง)
//   → layout() คือจำนวนบานต่อชุดของทุกหน้า (ตรงกับ panel_family / panel_layout ในฐานข้อมูล)
// ช่องกรอกจำนวนอยู่ในรูปบานแต่ละบานเลย พนักงานดูรูปแล้วใส่ตรงบานที่ถือจริง ไม่ต้องจำว่าซ้าย/ขวาคืออะไร
(function () {
    'use strict';

    var LAYOUT = {
        SLWD2P: { slide_left: 1, slide_right: 1 }, SLD2P: { slide_left: 1, slide_right: 1 },
        SLWD3P: { slide_left: 1, fixed: 1, slide_right: 1 },
        SLWD4P: { fixed_left: 1, fixed_right: 1, slide_handle: 1, slide_plain: 1 },
        SLD4P: { fixed_left: 1, fixed_right: 1, slide_handle: 1, slide_plain: 1 },
        ANWD1P: {}, CMWDL1P: {}, CMWDR1P: {}
    };
    var POSITIONS = {
        SLWD2P: ['slide_left', 'slide_right'],
        SLD2P: ['slide_left', 'slide_right'],
        SLWD3P: ['slide_left', 'fixed', 'slide_right'],
        SLWD4P: ['fixed_left', 'slide_plain', 'slide_handle', 'fixed_right'],
        SLD4P: ['fixed_left', 'slide_plain', 'slide_handle', 'fixed_right']
    };
    // เลขบานใช้ตามลำดับใน POSITIONS (no ด้านล่างเป็นของชุด 4 บาน)
    var TILE = {
        slide_left: { kind: 'slide', name: 'บานเลื่อน', side: 'ฝั่งซ้าย' },
        slide_right: { kind: 'slide', name: 'บานเลื่อน', side: 'ฝั่งขวา' },
        fixed: { kind: 'fixed', name: 'บานตาย', side: 'ตรงกลาง' },
        fixed_left: { no: 1, kind: 'fixed', name: 'บานตาย', side: 'ฝั่งซ้าย' },
        slide_plain: { no: 2, kind: 'slide', name: 'บานเลื่อน', side: 'ฝั่งจับเรียบ' },
        slide_handle: { no: 3, kind: 'slide', name: 'บานเลื่อน', side: 'ฝั่งจับล็อค' },
        fixed_right: { no: 4, kind: 'fixed', name: 'บานตาย', side: 'ฝั่งขวา' },
        net: { kind: 'net', name: 'บานมุ้ง', side: '' }
    };
    var photoCache = {};

    function family(sku) {
        var m = String(sku || '').match(/^(?:SLWD|SLD)\dP|^(?:ANWD|CMWDL|CMWDR)1P/);
        return m ? m[0] : '';
    }

    function hasNet(sku) {
        return /^(?:(?:SLWD|SLD)\dP|(?:ANWD|CMWDL|CMWDR)1P)\d{4}[A-Z]{2}N/.test(String(sku || ''));
    }

    // จำนวนบานแต่ละประเภทต่อ 1 ชุด · null = สินค้านี้เก็บบานไม่ได้
    function layout(sku) {
        var f = family(sku), base = LAYOUT[f];
        if (!base) return null;
        var out = {};
        Object.keys(base).forEach(function (k) { out[k] = base[k]; });
        if (hasNet(sku)) out.net = (f === 'SLWD4P' || f === 'SLD4P') ? 2 : 1;
        return Object.keys(out).length ? out : null;
    }

    function positions(sku) {
        return POSITIONS[family(sku)] || null;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function injectCss() {
        if (document.getElementById('pp-css')) return;
        var css = ''
            + '.pp{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin:6px 0 4px}'
            + '.pp-photo{flex:0 0 130px;text-align:center;font-size:.72rem;color:var(--muted-strong,#64748b)}'
            + '.pp-photo img{width:130px;height:auto;border-radius:8px;border:1px solid var(--border,#cbd5e1);background:#fff;display:block;margin-bottom:3px}'
            + '.pp-photo .pp-nophoto{width:130px;height:96px;border-radius:8px;border:1px dashed var(--border,#cbd5e1);display:flex;align-items:center;justify-content:center;margin-bottom:3px}'
            + '.pp-main{flex:1 1 300px;min-width:0}'
            + '.pp-cap{font-size:.78rem;color:var(--muted-strong,#64748b);margin-bottom:4px}'
            + '.pp-frame{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:6px;border-radius:8px;background:#9ca3af}'
            + '.pp-tile{background:var(--surface,#fff);color:var(--text,#0f172a);border:3px solid #111827;border-radius:4px;padding:6px 4px 8px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:150px;position:relative}'
            + '.pp-tile.fixed{background-image:repeating-linear-gradient(135deg,rgba(100,116,139,.13) 0 6px,transparent 6px 14px)}'
            + '.pp-tile.off{opacity:.45}'
            + '.pp-no{width:30px;height:30px;border-radius:50%;background:#111827;color:#fff;font-weight:700;font-size:1.05rem;display:flex;align-items:center;justify-content:center}'
            + '.pp-name{font-weight:700;font-size:.82rem;line-height:1.25}'
            + '.pp-side{font-size:.74rem;color:var(--muted-strong,#64748b);line-height:1.2}'
            + '.pp-mark{font-size:1.1rem;line-height:1;color:#475569}'
            + '.pp-tile input{width:100%;max-width:70px;text-align:center;font-size:1.05rem;padding:6px 2px;margin-top:auto}'
            + '.pp-extra{font-size:.7rem;color:var(--muted-strong,#64748b);line-height:1.25}'
            + '.pp-netrow{display:flex;gap:8px;align-items:stretch;margin-top:8px}'
            + '.pp-tile.net{flex:0 0 150px;min-height:0;background-image:repeating-linear-gradient(0deg,rgba(100,116,139,.18) 0 1px,transparent 1px 6px),repeating-linear-gradient(90deg,rgba(100,116,139,.18) 0 1px,transparent 1px 6px)}'
            + '.pp-netnote{font-size:.74rem;color:var(--muted-strong,#64748b);align-self:center}'
            + '@media (max-width:420px){.pp-photo{flex-basis:100%;display:flex;gap:8px;align-items:center;text-align:left}.pp-photo img,.pp-photo .pp-nophoto{width:72px}}';
        var st = document.createElement('style');
        st.id = 'pp-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // tileFn(type, info) → HTML ที่ใส่ในบาน (ช่องกรอก + ข้อความเล็ก) · คืน null = บานนี้ใช้ไม่ได้ (ทำจาง)
    function html(sku, tileFn, caption) {
        var pos = positions(sku);
        if (!pos) return '';
        injectCss();
        var tiles = pos.map(function (type, idx) {
            var t = TILE[type];
            var inner = tileFn(type, t);
            return '<div class="pp-tile ' + t.kind + (inner == null ? ' off' : '') + '">'
                + '<div class="pp-no">' + (idx + 1) + '</div>'
                + '<div class="pp-name">' + t.name + '</div>'
                + '<div class="pp-side">' + t.side + '</div>'
                + '<div class="pp-mark" aria-hidden="true">' + (t.kind === 'slide' ? '⇆' : '▦') + '</div>'
                + (inner == null ? '<div class="pp-extra">—</div>' : inner)
                + '</div>';
        }).join('');
        // บานมุ้ง (รุ่นที่มีมุ้ง): ช่องแยกใต้ภาพบาน — มุ้งไม่มีตำแหน่งซ้าย/ขวา
        var lay = layout(sku) || {};
        var netHtml = '';
        if (lay.net) {
            var netInner = tileFn('net', TILE.net);
            netHtml = '<div class="pp-netrow"><div class="pp-tile net' + (netInner == null ? ' off' : '') + '">'
                + '<div class="pp-name">🕸️ บานมุ้ง</div>'
                + '<div class="pp-side">ชุดละ ' + lay.net + ' บาน</div>'
                + (netInner == null ? '<div class="pp-extra">—</div>' : netInner)
                + '</div><div class="pp-netnote">มุ้งใช้ได้ทุกตำแหน่ง ไม่ต้องดูซ้าย/ขวา</div></div>';
        }
        return '<div class="pp">'
            + '<div class="pp-photo" data-pp-img="' + esc(sku) + '"><div class="pp-nophoto">🖼️</div><span>รูปสินค้า</span></div>'
            + '<div class="pp-main"><div class="pp-cap">' + (caption || 'มองจากรูปสินค้า ซ้าย → ขวา · ใส่จำนวนตรงบานที่ตรงกัน') + '</div>'
            + '<div class="pp-frame" style="grid-template-columns:repeat(' + pos.length + ',minmax(0,1fr))">' + tiles + '</div>' + netHtml + '</div>'
            + '</div>';
    }

    // ใส่รูปสินค้าของ SKU (ตาราง product_images) ลงในกล่องรูป — ไม่มีรูปก็ไม่เป็นไร
    function loadPhotos(db, root) {
        if (!db || !root) return;
        var boxes = root.querySelectorAll('[data-pp-img]');
        Array.prototype.forEach.call(boxes, function (box) {
            var sku = box.getAttribute('data-pp-img');
            var put = function (url) {
                if (!url || !box.isConnected) return;
                box.innerHTML = '<img src="' + esc(url) + '" alt="รูปสินค้า ' + esc(sku) + '" loading="lazy"><span>รูปสินค้า</span>';
            };
            if (photoCache[sku] !== undefined) { put(photoCache[sku]); return; }
            db.from('product_images').select('image_url').eq('sku', sku).maybeSingle()
                .then(function (res) {
                    photoCache[sku] = (res && res.data && res.data.image_url) || '';
                    put(photoCache[sku]);
                }, function () { /* ไม่มีรูป ใช้ภาพบานอย่างเดียว */ });
        });
    }

    window.PanelPicker = { positions: positions, html: html, loadPhotos: loadPhotos, TILE: TILE,
        family: family, hasNet: hasNet, layout: layout };
})();
