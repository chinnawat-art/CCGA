// ❌ ยกเลิกระหว่างผลิต (27/11/2569)
// ใช้กับใบ กำลังผลิต / รอ QC / ตรวจเสร็จรอจัดส่ง ที่ลูกค้ายกเลิก
// เลือกว่าวัสดุชิ้นไหนเอากลับขึ้นชั้นได้ · บานเสร็จแล้วเก็บเป็นสต็อกสำรอง · กดยืนยันครั้งเดียว
// ฐานข้อมูลทำทุกอย่างในฟังก์ชันเดียว (rpc_cancel_in_production) — พลาดข้อไหน = ไม่บันทึกอะไรเลย
(function () {
    'use strict';

    const MODES = {
        unfinished: { icon: '🔧', title: 'ยังผลิตไม่เสร็จ', sub: 'คืนวัสดุที่ยังไม่ได้ใช้เข้าสต็อก (ชิ้นที่ตัด/ประกอบไปแล้วไม่คืน)' },
        backup: { icon: '📦', title: 'ผลิตเสร็จแล้ว — เก็บเป็นสต็อกสำรอง', sub: 'ออเดอร์ SKU เดียวกันครั้งหน้าดึงไปใช้ได้ · ระบบไม่ตัดวัสดุซ้ำ' },
        scrap: { icon: '🗑️', title: 'ทำไปแล้ว ใช้ต่อไม่ได้', sub: 'ไม่คืนวัสดุ ไม่เก็บ (วัสดุถือว่าใช้ไปแล้วทั้งหมด)' }
    };

    let st = null;   // { db, order, data, onDone, log, busy }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function num(n) { return Number(n || 0).toLocaleString('th-TH'); }
    function panelLabel(t) {
        try { if (typeof PANEL_LABEL !== 'undefined' && PANEL_LABEL[t]) return PANEL_LABEL[t]; } catch (_) { /* ไม่มีก็ใช้ชื่อเดิม */ }
        return t;
    }

    function injectStyle() {
        if (document.getElementById('cipStyle')) return;
        const css = `
#cipModal .modal-content{max-width:640px}
#cipModal .cip-step{font-weight:600;color:var(--text);margin:.9rem 0 .45rem;font-size:.95rem}
#cipModal .cip-mode{display:flex;gap:.6rem;align-items:flex-start;padding:.65rem .8rem;border:1px solid var(--border);border-radius:10px;margin-bottom:.45rem;cursor:pointer;background:var(--input-bg)}
#cipModal .cip-mode input{margin-top:.25rem;flex:0 0 auto;width:18px;height:18px}
#cipModal .cip-mode.on{border-color:rgba(239,68,68,.55);box-shadow:0 0 0 1px rgba(239,68,68,.35)}
#cipModal .cip-mode b{display:block;color:var(--text)}
#cipModal .cip-mode small{color:var(--muted);font-size:.8rem}
#cipModal .cip-quick{display:flex;gap:.5rem;flex-wrap:wrap;margin:.3rem 0 .6rem}
#cipModal .cip-row{display:flex;gap:.6rem;align-items:center;justify-content:space-between;padding:.55rem .1rem;border-bottom:1px dashed var(--border)}
#cipModal .cip-row.miss{background:rgba(245,158,11,.08)}
#cipModal .cip-name{flex:1 1 auto;min-width:0;font-size:.86rem;color:var(--text);line-height:1.35}
#cipModal .cip-name code{font-size:.72rem;color:var(--muted);word-break:break-all}
#cipModal .cip-meta{font-size:.75rem;color:var(--muted)}
#cipModal .cip-tag{display:inline-block;font-size:.7rem;padding:0 .4rem;border-radius:6px;margin-left:.25rem}
#cipModal .cip-tag.shelf{background:var(--status-success-bg);color:var(--status-success-text)}
#cipModal .cip-tag.out{background:var(--status-pending-bg);color:var(--status-pending-text)}
#cipModal .cip-in{flex:0 0 auto;display:flex;align-items:center;gap:.3rem}
#cipModal .cip-in input{width:64px;margin:0;text-align:center;padding:.4rem .3rem}
#cipModal .cip-in button{padding:.3rem .45rem;font-size:.72rem}
#cipModal .cip-note{font-size:.8rem;color:var(--muted);margin:.4rem 0}
#cipModal .cip-warn{font-size:.82rem;padding:.55rem .75rem;border-radius:8px;margin:.6rem 0;background:var(--status-pending-bg);color:var(--status-pending-text)}
#cipModal .cip-sum{font-size:.86rem;padding:.6rem .8rem;border-radius:8px;margin:.8rem 0;background:var(--bg-card-strong,rgba(148,163,184,.08));color:var(--text)}
#cipModal .cip-check{display:flex;gap:.5rem;align-items:flex-start;font-size:.86rem;margin:.6rem 0;color:var(--text)}
#cipModal .cip-check input{width:18px;height:18px;margin-top:.15rem}
@media (max-width:640px){
 #cipModal.modal-overlay{padding:.5rem}
 #cipModal .modal-content{padding:1.1rem;max-height:94vh}
 #cipModal .cip-row{flex-wrap:wrap}
 #cipModal .cip-in{width:100%;justify-content:flex-end}
 #cipModal .modal-actions{flex-direction:column-reverse}
 #cipModal .modal-actions .btn{width:100%}
}`;
        const el = document.createElement('style');
        el.id = 'cipStyle';
        el.textContent = css;
        document.head.appendChild(el);
    }

    function ensureModal() {
        injectStyle();
        let el = document.getElementById('cipModal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'cipModal';
        el.className = 'modal-overlay';
        el.style.display = 'none';
        el.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="cipTitle"></div>';
        document.body.appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('input', onInput);
        el.addEventListener('change', onInput);
        return el;
    }

    function box() { return document.querySelector('#cipModal .modal-content'); }

    function header() {
        return `<div class="modal-header">
            <h3 class="modal-heading-alert" id="cipTitle">❌ ยกเลิกออเดอร์ระหว่างผลิต</h3>
            <button type="button" class="modal-close-btn" data-cip="close" aria-label="ปิด">✕</button>
        </div>`;
    }

    async function open(order, opts) {
        if (!order || !opts || !opts.db) return;
        st = { db: opts.db, order, data: null, onDone: opts.onDone, log: opts.log || function () {}, label: opts.label || order.production_number || '-', busy: false, mode: '' };
        const el = ensureModal();
        box().innerHTML = header() + '<div class="cip-note">⏳ กำลังโหลดรายการวัสดุของใบนี้...</div>';
        el.style.display = 'flex';
        document.addEventListener('keydown', onKey);
        try {
            const { data, error } = await st.db.rpc('rpc_cancel_in_production_preview', { p_order_id: order.id });
            if (error) throw error;
            if (!st || st.order.id !== order.id) return;
            st.data = data || {};
            render();
        } catch (e) {
            if (!st) return;
            box().innerHTML = header() + `<div class="modal-info-box">❌ โหลดไม่สำเร็จ: ${esc(e.message || e)}</div>
                <div class="modal-actions"><button type="button" class="btn btn-outline" data-cip="close">ปิด</button></div>`;
        }
    }

    function render() {
        const d = st.data;
        const o = d.order || {};
        const items = Array.isArray(d.items) ? d.items : [];
        const dmg = Array.isArray(d.damaged_pending) ? d.damaged_pending : [];
        const panels = (Array.isArray(d.panels_used) ? d.panels_used : []).filter(p => Number(p && p.qty) > 0);
        const sets = Math.max(Number(o.quantity) || 1, 1);

        if (!d.allowed) {
            box().innerHTML = header() + `<div class="modal-info-box">ใบนี้อยู่สถานะ "${esc(o.tracking_status || '-')}" — ยกเลิกแบบนี้ได้เฉพาะใบ กำลังผลิต / รอ QC / ตรวจเสร็จรอจัดส่ง</div>
                <div class="modal-actions"><button type="button" class="btn btn-outline" data-cip="close">ปิด</button></div>`;
            return;
        }

        const modes = Object.keys(MODES).map(k => {
            const m = MODES[k];
            const title = k === 'backup' ? `${m.title} ${num(sets)} ชุด` : m.title;
            return `<label class="cip-mode${st.mode === k ? ' on' : ''}">
                <input type="radio" name="cipMode" value="${k}"${st.mode === k ? ' checked' : ''}>
                <span><b>${m.icon} ${esc(title)}</b><small>${esc(m.sub)}</small></span>
            </label>`;
        }).join('');

        let mat = '';
        if (st.mode === 'unfinished') {
            if (!items.length) {
                mat = `<div class="cip-note">ใบนี้ไม่มีวัสดุที่ตัดค้างไว้ (เช่น ใช้สต็อกสำรอง หรือกดผลิตสำเร็จจากรอผลิต) — ไม่มีอะไรให้คืน</div>`;
            } else {
                const rows = items.map((it, i) => {
                    const q = Number(it.qty) || 0;
                    const shelf = Number(it.undispatched_qty) > 0 && !(Number(it.dispatched_qty) > 0);
                    const tag = shelf
                        ? '<span class="cip-tag shelf">ยังไม่จ่าย · น่าจะยังอยู่ชั้น</span>'
                        : (Number(it.dispatched_qty) > 0 ? `<span class="cip-tag out">จ่ายแล้ว${it.dispatched_by ? ' · ' + esc(it.dispatched_by) : ''}</span>` : '');
                    return `<div class="cip-row" data-row="${i}">
                        <div class="cip-name">${esc(it.name || it.code)} ${tag}<br>
                            <code>${esc(it.code)}</code>
                            <div class="cip-meta">ตัดให้ใบนี้ ${num(q)} ${esc(it.unit || 'ชิ้น')}${it.location ? ' · 📍 ' + esc(it.location) : ''}${it.found === false ? ' · ⚠️ ไม่พบในสต็อก คืนไม่ได้' : ''}</div>
                        </div>
                        <div class="cip-in">
                            <span class="cip-meta">คืน</span>
                            <input type="number" class="form-field" inputmode="numeric" min="0" max="${q}" step="1" data-ret="${i}" placeholder="?" aria-label="จำนวนที่คืนเข้าสต็อก ${esc(it.name || it.code)}">
                            <button type="button" class="btn btn-outline btn-sm" data-cip="all1" data-i="${i}" title="คืนทั้งหมด ${q}">หมด</button>
                            <button type="button" class="btn btn-outline btn-sm" data-cip="none1" data-i="${i}" title="ใช้ไปแล้ว คืน 0">0</button>
                        </div>
                    </div>`;
                }).join('');
                mat = `<div class="cip-step">2. วัสดุที่เอากลับขึ้นชั้นได้ <span style="color:#ef4444">*</span></div>
                    <div class="cip-note">ใส่จำนวนที่ <b>เอากลับขึ้นชั้นได้จริง</b> ทุกแถว · ชิ้นที่ตัดหรือประกอบไปแล้วใส่ 0</div>
                    <div class="cip-quick">
                        <button type="button" class="btn btn-outline btn-sm" data-cip="all">↩ คืนทั้งหมด</button>
                        <button type="button" class="btn btn-outline btn-sm" data-cip="shelf">↩ คืนเฉพาะที่ยังไม่จ่าย</button>
                        <button type="button" class="btn btn-outline btn-sm" data-cip="none">✂️ ใช้ไปแล้วทั้งหมด</button>
                    </div>
                    <div id="cipRows">${rows}</div>`;
                if (panels.length) {
                    const txt = panels.map(p => `${panelLabel(p.type)} × ${num(p.qty)}`).join(' · ');
                    mat += `<label class="cip-check"><input type="checkbox" id="cipPanels" checked>
                        <span>คืนบานเก็บที่ใบนี้เบิกไป กลับเข้าสต๊อกบาน (${esc(txt)})<br><small class="cip-meta">ถ้าบานถูกประกอบเข้ากรอบไปแล้ว ให้เอาติ๊กออก</small></span></label>`;
                }
            }
        }

        const dmgHtml = dmg.length
            ? `<div class="cip-warn">⚠️ มีคำขอวัสดุเสียที่ยังไม่ได้จ่าย ${dmg.length} รายการ (${esc(dmg.map(x => `${x.item} × ${x.qty}`).join(', '))}) — ระบบจะคืนชิ้นทดแทนเข้าสต็อกและยกเลิกคำขอให้เอง</div>`
            : '';

        const reasonStep = st.mode === 'unfinished' && items.length ? '3' : '2';
        const keepReason = st.reason || '';
        box().innerHTML = header() + `
            <div class="modal-info-box">เลขที่ผลิต <b>${esc(st.label)}</b> · ออเดอร์ ${esc(o.order_number || '-')}<br>
                ${esc(o.product_name || '')} <code>${esc(o.product_code || '')}</code> × ${num(sets)}<br>
                สถานะตอนนี้: <b>${esc(o.tracking_status || '-')}</b></div>
            <div class="cip-step">1. บานตอนนี้เป็นยังไง <span style="color:#ef4444">*</span></div>
            ${modes}
            ${mat}
            ${dmgHtml}
            ${st.mode ? `<div class="cip-step">${reasonStep}. เหตุผล <span style="color:#ef4444">*</span></div>
            <input type="text" id="cipReason" class="form-field" maxlength="300" placeholder="เช่น ลูกค้ายกเลิกใน Shopee" value="${esc(keepReason)}">` : ''}
            <div class="cip-sum" id="cipSum">เลือกข้อ 1 ก่อน</div>
            <div class="modal-actions">
                <button type="button" class="btn btn-outline" data-cip="close">ปิด</button>
                <button type="button" class="btn btn-danger-soft" data-cip="submit" id="cipSubmit" disabled>❌ ยืนยันยกเลิกออเดอร์</button>
            </div>`;
        (st.retValues || []).forEach((v, i) => {
            const inp = box().querySelector(`input[data-ret="${i}"]`);
            if (inp && v !== '') inp.value = v;
        });
        updateSummary();
    }

    // อ่านค่าจากหน้าต่าง → ตรวจครบไหม
    function readForm() {
        const items = Array.isArray(st.data.items) ? st.data.items : [];
        const out = { mode: st.mode, returns: [], missing: 0, invalid: 0, retPcs: 0, retN: 0, usedPcs: 0, panels: false };
        const reasonEl = document.getElementById('cipReason');
        out.reason = reasonEl ? reasonEl.value.trim() : '';
        const totalNet = items.reduce((a, it) => a + (Number(it.qty) || 0), 0);
        if (st.mode !== 'unfinished') { out.usedPcs = totalNet; return out; }
        items.forEach((it, i) => {
            const inp = box().querySelector(`input[data-ret="${i}"]`);
            const raw = inp ? inp.value.trim() : '';
            const q = Number(it.qty) || 0;
            const row = inp && inp.closest('.cip-row');
            if (raw === '') { out.missing++; if (row) row.classList.add('miss'); return; }
            if (row) row.classList.remove('miss');
            const v = Number(raw);
            if (!Number.isInteger(v) || v < 0 || v > q || (v > 0 && it.found === false)) { out.invalid++; return; }
            if (v > 0) { out.returns.push({ code: it.code, qty: v }); out.retPcs += v; out.retN++; }
            out.usedPcs += q - v;
        });
        const pc = document.getElementById('cipPanels');
        out.panels = !!(pc && pc.checked);
        return out;
    }

    function updateSummary() {
        const sumEl = document.getElementById('cipSum');
        const btn = document.getElementById('cipSubmit');
        if (!sumEl || !btn) return;
        if (!st.mode) { sumEl.textContent = 'เลือกข้อ 1 ก่อน'; btn.disabled = true; return; }
        const f = readForm();
        const sets = Math.max(Number(st.data.order && st.data.order.quantity) || 1, 1);
        const dmgN = (st.data.damaged_pending || []).length;
        let txt;
        if (f.mode === 'unfinished') {
            txt = `คืนเข้าสต็อก <b>${num(f.retPcs)}</b> ชิ้น (${f.retN} รายการ) · ใช้ไปแล้ว <b>${num(f.usedPcs)}</b> ชิ้น`;
            if (f.panels) txt += ' · คืนบานเก็บเข้าสต๊อกบาน';
        } else if (f.mode === 'backup') {
            txt = `เก็บเป็นสต็อกสำรอง <b>${num(sets)}</b> ชุด`
                + (f.usedPcs > 0 ? ` · วัสดุ ${num(f.usedPcs)} ชิ้นถือว่าใช้ไปกับบานแล้ว (ไม่คืน ไม่ตัดซ้ำ)` : ' · ไม่ตัดวัสดุเพิ่ม');
        } else {
            txt = 'ไม่คืนวัสดุ · ไม่เก็บ' + (f.usedPcs > 0 ? ` · วัสดุ ${num(f.usedPcs)} ชิ้นถือว่าใช้ไปแล้ว` : '');
        }
        if (dmgN) txt += ` · คืนวัสดุเสียที่ยังไม่จ่าย ${dmgN} รายการ`;
        let warn = '';
        if (f.missing) warn = `ยังไม่ได้ใส่จำนวนคืน ${f.missing} รายการ`;
        else if (f.invalid) warn = `จำนวนคืนไม่ถูกต้อง ${f.invalid} รายการ (ต้องเป็นเลขเต็ม ไม่เกินที่ตัดให้ใบนี้)`;
        else if (f.reason.length < 3) warn = 'ใส่เหตุผลอย่างน้อย 3 ตัวอักษร';
        sumEl.innerHTML = txt + (warn ? `<br><span style="color:#f59e0b">⚠️ ${esc(warn)}</span>` : '');
        btn.disabled = !!warn || st.busy;
    }

    function setAll(kind) {
        const items = Array.isArray(st.data.items) ? st.data.items : [];
        items.forEach((it, i) => {
            const inp = box().querySelector(`input[data-ret="${i}"]`);
            if (!inp) return;
            const q = Number(it.qty) || 0;
            if (kind === 'all') inp.value = it.found === false ? 0 : q;
            else if (kind === 'none') inp.value = 0;
            else if (kind === 'shelf') {
                const shelf = Number(it.undispatched_qty) > 0 && !(Number(it.dispatched_qty) > 0);
                inp.value = shelf && it.found !== false ? q : 0;
            }
        });
        updateSummary();
    }

    function rememberInputs() {
        const items = Array.isArray(st.data && st.data.items) ? st.data.items : [];
        st.retValues = items.map((_, i) => {
            const inp = box().querySelector(`input[data-ret="${i}"]`);
            return inp ? inp.value : (st.retValues ? st.retValues[i] || '' : '');
        });
        const r = document.getElementById('cipReason');
        if (r) st.reason = r.value;
    }

    function onClick(e) {
        if (!st) return;
        // แตะพื้นหลังไม่ปิด (กันจำนวนที่กรอกไว้หาย) — ปิดด้วยปุ่ม ✕ / ปิด / Esc
        const b = e.target.closest('[data-cip]');
        if (!b) return;
        const a = b.dataset.cip;
        if (a === 'close') { if (!st.busy) close(); return; }
        if (a === 'all' || a === 'none' || a === 'shelf') { setAll(a); return; }
        if (a === 'all1' || a === 'none1') {
            const i = Number(b.dataset.i);
            const it = (st.data.items || [])[i];
            const inp = box().querySelector(`input[data-ret="${i}"]`);
            if (it && inp) inp.value = a === 'all1' ? (it.found === false ? 0 : Number(it.qty) || 0) : 0;
            updateSummary();
            return;
        }
        if (a === 'submit') submit();
    }

    function onInput(e) {
        if (!st || !st.data) return;
        if (e.target.name === 'cipMode') {
            rememberInputs();
            st.mode = e.target.value;
            render();
            const r = document.getElementById('cipReason');
            if (r && !r.value) r.focus();
            return;
        }
        updateSummary();
    }

    function onKey(e) {
        if (e.key === 'Escape' && st && !st.busy) close();
    }

    async function submit() {
        if (!st || st.busy) return;
        const f = readForm();
        if (!f.mode || f.missing || f.invalid || f.reason.length < 3) { updateSummary(); return; }
        const o = st.data.order || {};
        const sets = Math.max(Number(o.quantity) || 1, 1);
        const what = f.mode === 'unfinished'
            ? `คืนวัสดุเข้าสต็อก ${num(f.retPcs)} ชิ้น (${f.retN} รายการ) · ใช้ไปแล้ว ${num(f.usedPcs)} ชิ้น${f.panels ? ' · คืนบานเก็บ' : ''}`
            : (f.mode === 'backup' ? `เก็บเป็นสต็อกสำรอง ${num(sets)} ชุด (ไม่คืนวัสดุ)` : 'ไม่คืนวัสดุ ไม่เก็บ');
        const ok = confirm(`ยืนยันยกเลิกออเดอร์\n\nเลขที่ผลิต: ${st.label}\nออเดอร์: ${o.order_number || '-'}\n${what}\nเหตุผล: ${f.reason}\n\nยกเลิกแล้วย้อนกลับไม่ได้`);
        if (!ok) return;

        st.busy = true;
        const btn = document.getElementById('cipSubmit');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...'; }
        const order = st.order;
        try {
            const { data, error } = await st.db.rpc('rpc_cancel_in_production', {
                p_order_id: order.id,
                p_reason: f.reason,
                p_returns: f.mode === 'unfinished' ? f.returns : [],
                p_keep_backup: f.mode === 'backup',
                p_return_panels: f.mode === 'unfinished' && f.panels
            });
            if (error) throw error;
            const r = data || {};
            const parts = [];
            if (Number(r.returned_pcs) > 0) parts.push(`คืนวัสดุ ${num(r.returned_pcs)} ชิ้น`);
            if (Number(r.damaged_returned) > 0) parts.push(`คืนวัสดุเสียที่ยังไม่จ่าย ${num(r.damaged_returned)} รายการ`);
            if (Number(r.panels_returned) > 0) parts.push(`คืนบานเก็บ ${num(r.panels_returned)} บาน`);
            if (Number(r.backup_qty) > 0) parts.push(`เก็บสต็อกสำรอง ${num(r.backup_qty)} ชุด`);
            st.log(`❌ ยกเลิกระหว่างผลิต ${st.label} (${order.order_number || order.id})${parts.length ? ' · ' + parts.join(' · ') : ''}`, 'success');
            const done = st.onDone;
            st.busy = false;
            close();
            if (typeof done === 'function') await done(r);
        } catch (e) {
            st.busy = false;
            const msg = (e && e.message) ? e.message : String(e);
            st.log('ยกเลิกไม่สำเร็จ: ' + msg, 'error');
            alert('❌ ยกเลิกไม่สำเร็จ: ' + msg + '\n\nยังไม่ได้บันทึกอะไร');
            if (btn) { btn.textContent = '❌ ยืนยันยกเลิกออเดอร์'; }
            updateSummary();
        }
    }

    function close() {
        const el = document.getElementById('cipModal');
        if (el) el.style.display = 'none';
        document.removeEventListener('keydown', onKey);
        st = null;
    }

    window.CancelInProduction = { open, close };
})();
