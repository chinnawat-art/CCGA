/* ตัวคิดตัดกระจกส่วนเกินเป็นขนาดที่ใช้บ่อย (เจ้าของสั่ง 13/11/2569)
 * - "เกิน"   = ยอดที่มี − ที่จองในใบสั่งตัด − ที่เก็บไว้ (พอใช้ keepDays วัน แต่ไม่ต่ำกว่า minKeep แผ่น)
 * - "ต้องการ" = ให้มีพอใช้ targetDays วัน (ขนาดที่ใช้บ่อยและใกล้หมด)
 * - ความต้องการต่อวันมาจาก rpc_glass_demand = ออเดอร์ย้อนหลัง × สูตรวัสดุ
 * - รุ่นที่เพิ่งเริ่มขาย (ขายครั้งแรกไม่ถึง newDays วัน) ยังไม่เอาไปตัด และยังไม่ตัดให้
 * - สีเดียวกันเท่านั้น · บานเลื่อน (SLD ประตู + SLWD หน้าต่าง) ตัดข้ามกันได้ · บานกระทุ้ง/บานเปิด (GLS) แยก
 * - ผังตัดแบบกิโยติน (ตัดตรงทะลุแผ่นทีละเส้น แบบที่ช่างตัดกระจกทำจริง) หาแบบที่เหลือเศษน้อยสุด
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.GlassRecut) และ node (ไว้เทส)
 */
(function (root) {
    'use strict';

    var DEFAULTS = { histDays: 90, keepDays: 90, minKeep: 10, targetDays: 60, newDays: 30, minUtil: 70, kerfMm: 0 };
    var EPS = 1e-6;
    var COLOR_GLS = { C: 'ใส', G: 'เขียว', B: 'ชาดำ', F: 'ฝ้า' };

    function parse(code) {
        code = String(code || '');
        var m = code.match(/-([0-9]+(?:\.[0-9]+)?)x([0-9]+(?:\.[0-9]+)?)$/);
        if (!m) return null;
        var color = null, group = null, kind = '';
        var c1 = code.match(/^(SLWD|SLD)-กระจก-([^-]+)-/);
        var c2 = code.match(/^GLS-([CGBF])-/);
        if (c1) { color = c1[2]; group = 'SLIDE'; kind = c1[1] === 'SLD' ? 'ประตู' : 'หน้าต่าง'; }
        else if (c2) { color = COLOR_GLS[c2[1]]; group = 'GLS'; kind = 'บานกระทุ้ง/บานเปิด'; }
        if (!color) return null;
        return { color: color, group: group, kind: kind, a: Number(m[1]), b: Number(m[2]) };
    }

    function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
    function sizeText(p) { return fmt(p.a) + '×' + fmt(p.b); }

    /* วิเคราะห์ยอด: items = [{product_code, product_name, quantity, storage_location}]
     * demand = [{product_code, demand, window_days, first_order_at, in_bom}]
     * pending = ใบสั่งตัดที่ยังไม่ได้ตัด [{lines:[{source, sheets, outputs:[{code, per_sheet}]}]}] */
    function analyze(items, demand, pending, settings, now) {
        var s = Object.assign({}, DEFAULTS, settings || {});
        var t = now ? new Date(now).getTime() : Date.now();
        var dem = {};
        (demand || []).forEach(function (d) { dem[d.product_code] = d; });
        var reserved = {}, incoming = {};
        (pending || []).forEach(function (j) {
            (j.lines || []).forEach(function (l) {
                reserved[l.source] = (reserved[l.source] || 0) + (Number(l.sheets) || 0);
                (l.outputs || []).forEach(function (o) {
                    incoming[o.code] = (incoming[o.code] || 0) + (Number(o.per_sheet) || 0) * (Number(l.sheets) || 0);
                });
            });
        });
        var out = [];
        (items || []).forEach(function (it) {
            var p = parse(it.product_code);
            if (!p) return;
            var d = dem[it.product_code] || {};
            var win = Number(d.window_days) || s.histDays;
            var daily = (Number(d.demand) || 0) / Math.max(win, 1);
            var first = d.first_order_at ? new Date(d.first_order_at).getTime() : null;
            var isNew = !!d.in_bom && (first == null || (t - first) < s.newDays * 864e5);
            var qty = Math.max(0, Number(it.quantity) || 0);
            var keep = Math.max(Math.ceil(daily * s.keepDays - EPS), s.minKeep);
            var target = Math.ceil(daily * s.targetDays - EPS);
            var res = reserved[it.product_code] || 0;
            var inc = incoming[it.product_code] || 0;
            var active = !isNew && daily > 0;
            out.push({
                code: it.product_code, name: it.product_name || it.product_code, loc: it.storage_location || '',
                color: p.color, group: p.group, kind: p.kind, a: p.a, b: p.b, area: p.a * p.b,
                qty: qty, demand: Number(d.demand) || 0, windowDays: win, daily: daily,
                daysLeft: daily > 0 ? qty / daily : Infinity,
                inBom: !!d.in_bom, isNew: isNew, keep: keep, target: target,
                reserved: res, incoming: inc,
                excess: isNew ? 0 : Math.max(0, qty - res - keep),
                need: active ? Math.max(0, target - qty - inc) : 0,
                room: active ? Math.max(0, keep - qty - inc) : 0
            });
        });
        return out;
    }

    /* ผังตัดดีที่สุดของแผ่น W×H จากชิ้น pieces=[{code,a,b,value}] (ใช้ซ้ำได้ไม่จำกัด) — กิโยติน */
    function bestPattern(W, H, pieces, kerf, budget) {
        var memo = new Map();
        var calls = 0, limit = budget || 400000;
        var minDim = Infinity;
        pieces.forEach(function (p) { minDim = Math.min(minDim, p.a, p.b); });
        function key(w, h) { return Math.round(w * 1000) + '|' + Math.round(h * 1000); }
        function best(w, h) {
            if (w < minDim - EPS || h < minDim - EPS) return 0;
            var k = key(w, h);
            var m = memo.get(k);
            if (m) return m.v;
            if (++calls > limit) throw new Error('budget');
            var bv = 0, bc = null;
            for (var i = 0; i < pieces.length; i++) {
                var p = pieces[i];
                for (var r = 0; r < 2; r++) {
                    if (r === 1 && Math.abs(p.a - p.b) < EPS) break;
                    var pw = r ? p.b : p.a, ph = r ? p.a : p.b;
                    if (pw > w + EPS || ph > h + EPS) continue;
                    var rw = Math.max(0, w - pw - kerf), th = Math.max(0, h - ph - kerf);
                    var A = best(rw, ph) + best(w, th);
                    var B = best(rw, h) + best(pw, th);
                    var v = p.value + Math.max(A, B);
                    if (v > bv + EPS) { bv = v; bc = { i: i, pw: pw, ph: ph, split: A >= B ? 'A' : 'B', rw: rw, th: th }; }
                }
            }
            memo.set(k, { v: bv, c: bc });
            return bv;
        }
        var total = best(W, H);
        var rects = [];
        function place(w, h, x, y) {
            if (w < minDim - EPS || h < minDim - EPS) return;
            var m = memo.get(key(w, h));
            if (!m || !m.c) return;
            var c = m.c, p = pieces[c.i];
            rects.push({ x: x, y: y, w: c.pw, h: c.ph, code: p.code });
            if (c.split === 'A') {
                place(c.rw, c.ph, x + c.pw + kerf, y);
                place(w, c.th, x, y + c.ph + kerf);
            } else {
                place(c.rw, h, x + c.pw + kerf, y);
                place(c.pw, c.th, x, y + c.ph + kerf);
            }
        }
        place(W, H, 0, 0);
        return { value: total, rects: rects };
    }

    /* วางแผนทั้งหมด → รายการแนะนำ [{source, …, sheets, outputs:[{code, per_sheet}], rects, util}] */
    function plan(stats, settings) {
        var s = Object.assign({}, DEFAULTS, settings || {});
        var kerf = (Number(s.kerfMm) || 0) / 10;
        var minUtil = (Number(s.minUtil) || 0) / 100;
        var byCode = {};
        stats.forEach(function (x) { byCode[x.code] = x; });
        var cap = {}, need = {};
        stats.forEach(function (x) { cap[x.code] = x.room; need[x.code] = x.need; });
        var sources = stats.filter(function (x) { return x.excess > 0; })
            .sort(function (p, q) { return q.excess * q.area - p.excess * p.area; });
        var suggestions = [], leftovers = [];

        sources.forEach(function (src) {
            var sheets = src.excess, exclude = {}, guard = 0;
            var lines = [];
            while (sheets > 0 && guard++ < 60) {
                var pieces = stats.filter(function (t) {
                    return t.code !== src.code && t.color === src.color && t.group === src.group
                        && cap[t.code] > 0 && !exclude[t.code] && t.area < src.area - EPS
                        && ((t.a <= src.a + EPS && t.b <= src.b + EPS) || (t.a <= src.b + EPS && t.b <= src.a + EPS));
                }).map(function (t) {
                    return { code: t.code, a: t.a, b: t.b, value: t.area * (need[t.code] > 0 ? 1 : 0.35) };
                });
                if (!pieces.some(function (p) { return need[p.code] > 0; })) break;
                if (pieces.length > 45) {   // ชิ้นเยอะมาก → เก็บชิ้นใหญ่ที่ต้องการก่อน (กันคิดนาน)
                    pieces.sort(function (p, q) { return q.value - p.value; });
                    pieces = pieces.slice(0, 45);
                }
                var pat;
                try { pat = bestPattern(src.a, src.b, pieces, kerf); } catch (e) { break; }
                if (!pat.rects.length) break;
                var cnt = {}, area = 0, needArea = 0;
                pat.rects.forEach(function (r) {
                    cnt[r.code] = (cnt[r.code] || 0) + 1;
                    area += r.w * r.h;
                    if (need[r.code] > 0) needArea += r.w * r.h;
                });
                var util = area / src.area;
                if (util + EPS < minUtil || needArea <= 0) break;
                // จำนวนแผ่น: ตัดจนขนาดที่ต้องการมากสุดในผังครบ (พอใช้ targetDays วัน) — ขนาดอื่นในผังอาจได้เกินเป้าบ้าง
                // แต่ทุกขนาดต้องไม่เกินที่ควรเก็บ (keepDays วัน) · ได้ผังน้อยแบบ ช่างตัดง่าย
                var k = sheets, worst = null, worstK = Infinity, kNeed = 0;
                Object.keys(cnt).forEach(function (c) {
                    var kk = Math.floor(cap[c] / cnt[c]);
                    if (kk < worstK) { worstK = kk; worst = c; }
                    k = Math.min(k, kk);
                    if (need[c] > 0) kNeed = Math.max(kNeed, Math.ceil(need[c] / cnt[c]));
                });
                k = Math.min(k, kNeed);
                if (k <= 0) { exclude[worst] = true; continue; }   // ชิ้นนี้ออกมาเยอะเกินที่ควรเก็บ → ลองแบบไม่มีชิ้นนี้
                var outs = Object.keys(cnt).map(function (c) { return { code: c, per_sheet: cnt[c] }; })
                    .sort(function (p, q) { return byCode[q.code].area - byCode[p.code].area; });
                var sig = outs.map(function (o) { return o.code + '*' + o.per_sheet; }).join(',');
                var same = lines.find(function (l) { return l.sig === sig; });
                if (same) same.sheets += k;
                else lines.push({ sig: sig, sheets: k, outputs: outs, rects: pat.rects, util: util });
                sheets -= k;
                Object.keys(cnt).forEach(function (c) {
                    cap[c] -= cnt[c] * k;
                    need[c] = Math.max(0, need[c] - cnt[c] * k);
                });
            }
            lines.sort(function (p, q) { return q.sheets - p.sheets || q.util - p.util; });
            lines.forEach(function (l) {
                suggestions.push({
                    source: src.code, sourceName: src.name, color: src.color, group: src.group,
                    a: src.a, b: src.b, qty: src.qty, keep: src.keep, excess: src.excess, reserved: src.reserved,
                    sheets: l.sheets, maxSheets: l.sheets, outputs: l.outputs, rects: l.rects, util: l.util
                });
            });
            if (sheets > 0) leftovers.push({ code: src.code, name: src.name, color: src.color, a: src.a, b: src.b, sheets: sheets, qty: src.qty, keep: src.keep });
        });
        return { suggestions: suggestions, leftovers: leftovers };
    }

    /* ผังตัด 1 แผ่นเป็น SVG (ตัวเลขเป็น ซม.) */
    function svg(sheetA, sheetB, rects, opts) {
        opts = opts || {};
        var maxW = opts.width || 240;
        var sc = maxW / sheetA;
        var W = sheetA * sc, H = sheetB * sc;
        var colors = ['#3b82f6', '#16a34a', '#f59e0b', '#a855f7', '#ef4444', '#0891b2', '#db2777'];
        var cmap = {}, ci = 0;
        var print = !!opts.print;
        var parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ' + (W + 2) + ' ' + (H + 2) + '" width="' + (W + 2) + '" height="' + (H + 2) + '">',
            '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + (print ? '#fff' : 'rgba(148,163,184,.18)') + '" stroke="' + (print ? '#000' : '#64748b') + '" stroke-dasharray="4 3"/>'];
        rects.forEach(function (r) {
            if (!(r.code in cmap)) cmap[r.code] = colors[ci++ % colors.length];
            var col = cmap[r.code];
            var x = r.x * sc, y = r.y * sc, w = r.w * sc, h = r.h * sc;
            parts.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (print ? '#e5e5e5' : col + '33') + '" stroke="' + (print ? '#000' : col) + '" stroke-width="1.5"/>');
            var pp = parse(r.code);   // เขียนขนาดตามรหัสกระจก (ตรงกับรายการ) แม้ชิ้นจะวางหมุนในผัง
            var label = pp ? sizeText(pp) : fmt(r.w) + '×' + fmt(r.h);
            var fs = Math.max(8, Math.min(13, Math.min(w / (label.length * 0.62), h / 2.2)));
            if (w > 22 && h > 12) parts.push('<text x="' + (x + w / 2) + '" y="' + (y + h / 2) + '" font-size="' + fs.toFixed(1) + '" text-anchor="middle" dominant-baseline="middle" font-family="Kanit,sans-serif" font-weight="700" fill="' + (print ? '#000' : col) + '">' + label + '</text>');
        });
        parts.push('</svg>');
        return parts.join('');
    }

    var api = { DEFAULTS: DEFAULTS, parse: parse, analyze: analyze, plan: plan, bestPattern: bestPattern, svg: svg, sizeText: sizeText, fmt: fmt };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.GlassRecut = api;
})(typeof window !== 'undefined' ? window : this);
