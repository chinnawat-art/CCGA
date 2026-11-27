// ❌ ยกเลิกระหว่างผลิต (27/11/2569)
// ใช้กับใบ กำลังผลิต / รอ QC / ตรวจเสร็จรอจัดส่ง ที่ลูกค้ายกเลิก
// กติกาโรงงาน: จ่ายวัสดุให้ช่างแล้ว = ผลิตให้เสร็จก่อน แล้วค่อยยกเลิกเก็บเป็นสต็อกสำรอง
//   · กำลังผลิต + ยังไม่จ่ายวัสดุ → คืนวัสดุทั้งหมดเข้าสต็อก
//   · กำลังผลิต + จ่ายแล้ว → ยังยกเลิกไม่ได้ (บอกให้ผลิตให้เสร็จก่อน)
//   · ผลิตเสร็จแล้ว → เก็บเป็นสต็อกสำรอง หรือ ไม่เข้าสต็อก (ขนาดพิเศษ / บานเสีย)
// ฐานข้อมูลตัดสินเองและทำทุกอย่างในฟังก์ชันเดียว (rpc_cancel_in_production) — พลาดข้อไหน = ไม่บันทึกอะไรเลย
(function () {
    'use strict';

    let st = null;   // { db, order, data, onDone, log, label, busy, choice, reason }

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
#cipModal .modal-content{max-width:600px}
#cipModal .cip-step{font-weight:600;color:var(--text);margin:.9rem 0 .45rem;font-size:.95rem}
#cipModal .cip-mode{display:flex;gap:.6rem;align-items:flex-start;padding:.65rem .8rem;border:1px solid var(--border);border-radius:10px;margin-bottom:.45rem;cursor:pointer;background:var(--input-bg)}
#cipModal .cip-mode input{margin-top:.25rem;flex:0 0 auto;width:18px;height:18px}
#cipModal .cip-mode.on{border-color:rgba(239,68,68,.55);box-shadow:0 0 0 1px rgba(239,68,68,.35)}
#cipModal .cip-mode.off{opacity:.55;cursor:not-allowed}
#cipModal .cip-mode b{display:block;color:var(--text)}
#cipModal .cip-mode small{color:var(--muted);font-size:.8rem}
#cipModal .cip-row{display:flex;gap:.6rem;align-items:center;justify-content:space-between;padding:.45rem .1rem;border-bottom:1px dashed var(--border)}
#cipModal .cip-name{flex:1 1 auto;min-width:0;font-size:.86rem;color:var(--text);line-height:1.35}
#cipModal .cip-name code{font-size:.72rem;color:var(--muted);word-break:break-all}
#cipModal .cip-qty{flex:0 0 auto;font-size:.86rem;font-weight:600;color:var(--status-success-text)}
#cipModal .cip-meta{font-size:.75rem;color:var(--muted)}
#cipModal .cip-note{font-size:.8rem;color:var(--muted);margin:.4rem 0}
#cipModal .cip-ok{font-size:.88rem;padding:.65rem .8rem;border-radius:8px;margin:.7rem 0;background:var(--status-success-bg);color:var(--status-success-text)}
#cipModal .cip-stop{font-size:.9rem;padding:.8rem .9rem;border-radius:10px;margin:.7rem 0;background:var(--status-pending-bg);color:var(--status-pending-text);line-height:1.55}
#cipModal .cip-warn{font-size:.82rem;padding:.55rem .75rem;border-radius:8px;margin:.6rem 0;background:var(--status-pending-bg);color:var(--status-pending-text)}
#cipModal .cip-sum{font-size:.86rem;padding:.6rem .8rem;border-radius:8px;margin:.8rem 0;background:var(--bg-card-strong,rgba(148,163,184,.08));color:var(--text)}
#cipModal .cip-check{display:flex;gap:.5rem;align-items:flex-start;font-size:.86rem;margin:.6rem 0;color:var(--text)}
#cipModal .cip-check input{width:18px;height:18px;margin-top:.15rem}
#cipModal details summary{cursor:pointer;font-size:.84rem;color:var(--text);margin:.3rem 0}
@media (max-width:640px){
 #cipModal.modal-overlay{padding:.5rem}
 #cipModal .modal-content{padding:1.1rem;max-height:94vh}
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

    const closeOnly = '<div class="modal-actions"><button type="button" class="btn btn-outline" data-cip="close">ปิด</button></div>';

    async function open(order, opts) {
        if (!order || !opts || !opts.db) return;
        st = { db: opts.db, order, data: null, onDone: opts.onDone, log: opts.log || function () {}, label: opts.label || order.production_number || '-', busy: false, choice: '', reason: '' };
        const el = ensureModal();
        box().innerHTML = header() + '<div class="cip-note">⏳ กำลังตรวจใบนี้...</div>';
        el.style.display = 'flex';
        document.addEventListener('keydown', onKey);
        try {
            const { data, error } = await st.db.rpc('rpc_cancel_in_production_preview', { p_order_id: order.id });
            if (error) throw error;
            if (!st || st.order.id !== order.id) return;
            st.data = data || {};
            const d = st.data;
            const canBackup = !d.custom_size && !!(d.order && d.order.product_code);
            st.choice = d.mode === 'finished' ? (canBackup ? 'backup' : 'nostock') : '';
            render();
        } catch (e) {
            if (!st) return;
            box().innerHTML = header() + `<div class="modal-info-box">❌ โหลดไม่สำเร็จ: ${esc(e.message || e)}</div>${closeOnly}`;
        }
    }

    function orderBox(o, sets) {
        return `<div class="modal-info-box">เลขที่ผลิต <b>${esc(st.label)}</b> · ออเดอร์ ${esc(o.order_number || '-')}<br>
            ${esc(o.product_name || '')} <code>${esc(o.product_code || '')}</code> × ${num(sets)}<br>
            สถานะตอนนี้: <b>${esc(o.tracking_status || '-')}</b></div>`;
    }

    function render() {
        const d = st.data;
        const o = d.order || {};
        const items = Array.isArray(d.items) ? d.items : [];
        const dmg = Array.isArray(d.damaged_pending) ? d.damaged_pending : [];
        const panels = (Array.isArray(d.panels_used) ? d.panels_used : []).filter(p => Number(p && p.qty) > 0);
        const sets = Math.max(Number(o.quantity) || 1, 1);
        const mode = d.mode || (d.allowed ? 'finished' : 'not_allowed');

        if (mode === 'must_finish') {
            box().innerHTML = header() + orderBox(o, sets) + `
                <div class="cip-stop">🔧 <b>ใบนี้จ่ายวัสดุให้ช่างแล้ว — ตามกติกาโรงงานต้องผลิตให้เสร็จก่อน</b><br>
                    ผลิตเสร็จแล้ว (กด "ผลิตสำเร็จ") ค่อยกลับมากด ❌ ยกเลิก อีกครั้ง → ระบบจะเก็บบานเป็นสต็อกสำรองให้</div>
                <div class="cip-note">ระหว่างนี้แจ้งช่างว่าลูกค้ายกเลิกแล้ว ไม่ต้องแพ็กส่ง</div>${closeOnly}`;
            return;
        }
        if (mode !== 'return_all' && mode !== 'finished') {
            box().innerHTML = header() + `<div class="modal-info-box">ใบนี้อยู่สถานะ "${esc(o.tracking_status || '-')}" — ยกเลิกแบบนี้ได้เฉพาะใบ กำลังผลิต / รอ QC / ตรวจเสร็จรอจัดส่ง</div>${closeOnly}`;
            return;
        }

        let body = '';
        let step = 1;
        if (mode === 'return_all') {
            const pcs = items.reduce((a, it) => a + (Number(it.qty) || 0), 0);
            const missing = items.filter(it => it.found === false);
            body += items.length
                ? `<div class="cip-ok">↩ ยังไม่ได้จ่ายวัสดุให้ช่าง — ระบบจะ <b>คืนวัสดุทั้งหมดเข้าสต็อก</b> ${num(items.length)} รายการ ${num(pcs)} ชิ้น และเอาออกจากหน้าเตรียมวัสดุ</div>
                   <details><summary>ดูรายการวัสดุที่คืน</summary>${items.map(it => `<div class="cip-row">
                        <div class="cip-name">${esc(it.name || it.code)}<br><code>${esc(it.code)}</code>
                            ${it.location ? `<div class="cip-meta">📍 ${esc(it.location)}</div>` : ''}</div>
                        <div class="cip-qty">+${num(it.qty)} ${esc(it.unit || 'ชิ้น')}</div></div>`).join('')}</details>`
                : '<div class="cip-ok">ใบนี้ไม่มีวัสดุที่ตัดค้างไว้ (เช่น ใช้สต็อกสำรอง) — ไม่มีวัสดุให้คืน ยกเลิกใบได้เลย</div>';
            if (missing.length) {
                body += `<div class="cip-warn">⚠️ วัสดุ ${esc(missing.map(it => it.code).join(', '))} ไม่พบในสต็อกแล้ว — ยกเลิกไม่ได้ ให้แจ้งผู้ดูแลระบบ</div>`;
            }
            if (panels.length) {
                const txt = panels.map(p => `${panelLabel(p.type)} × ${num(p.qty)}`).join(' · ');
                body += `<label class="cip-check"><input type="checkbox" id="cipPanels"${st.panels === false ? '' : ' checked'}>
                    <span>คืนบานเก็บที่ใบนี้เบิกไป กลับเข้าสต๊อกบาน (${esc(txt)})<br><small class="cip-meta">ถ้าบานยังไม่ได้หยิบออกจากชั้น ให้ติ๊กไว้</small></span></label>`;
            }
        } else {
            const canBackup = !d.custom_size && !!o.product_code;
            const why = d.custom_size
                ? `งานขนาดพิเศษ ${esc(d.custom_width)} x ${esc(d.custom_height)} ซม. — ขนาดไม่ตรง SKU เก็บเป็นสต็อกสำรองไม่ได้`
                : 'ใบนี้ไม่มีรหัสสินค้า';
            const opt = (k, icon, title, sub, disabled) => `<label class="cip-mode${st.choice === k ? ' on' : ''}${disabled ? ' off' : ''}">
                <input type="radio" name="cipChoice" value="${k}"${st.choice === k ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                <span><b>${icon} ${esc(title)}</b><small>${sub}</small></span></label>`;
            body += `<div class="cip-step">${step++}. บานที่ผลิตเสร็จแล้ว เอาไปไหน <span style="color:#ef4444">*</span></div>`
                + opt('backup', '📦', `เก็บเป็นสต็อกสำรอง ${num(sets)} ชุด`,
                    canBackup ? 'ออเดอร์ SKU เดียวกันครั้งหน้าดึงไปใช้ได้ · ไม่คืนวัสดุ ไม่ตัดวัสดุซ้ำ' : why, !canBackup)
                + opt('nostock', '🗑️', 'ไม่เข้าสต็อก', 'ใช้กับงานขนาดพิเศษ หรือบานเสียใช้ต่อไม่ได้ · ไม่คืนวัสดุ', false);
        }

        if (dmg.length) {
            body += `<div class="cip-warn">⚠️ มีคำขอวัสดุเสียที่ยังไม่ได้จ่าย ${dmg.length} รายการ (${esc(dmg.map(x => `${x.item} × ${x.qty}`).join(', '))}) — ระบบจะคืนชิ้นทดแทนเข้าสต็อกและยกเลิกคำขอให้เอง</div>`;
        }

        box().innerHTML = header() + orderBox(o, sets) + body + `
            <div class="cip-step">${step}. เหตุผล <span style="color:#ef4444">*</span></div>
            <input type="text" id="cipReason" class="form-field" maxlength="300" placeholder="เช่น ลูกค้ายกเลิกใน Shopee" value="${esc(st.reason)}">
            <div class="cip-sum" id="cipSum"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-outline" data-cip="close">ปิด</button>
                <button type="button" class="btn btn-danger-soft" data-cip="submit" id="cipSubmit" disabled>❌ ยืนยันยกเลิกออเดอร์</button>
            </div>`;
        updateSummary();
    }

    // อ่านค่าจากหน้าต่าง → ตรวจครบไหม
    function readForm() {
        const d = st.data;
        const items = Array.isArray(d.items) ? d.items : [];
        const reasonEl = document.getElementById('cipReason');
        const pc = document.getElementById('cipPanels');
        return {
            mode: d.mode,
            choice: st.choice,
            reason: reasonEl ? reasonEl.value.trim() : '',
            panels: !!(pc && pc.checked),
            retN: items.length,
            retPcs: items.reduce((a, it) => a + (Number(it.qty) || 0), 0),
            missingStock: items.some(it => it.found === false)
        };
    }

    function outcomeText(f) {
        const sets = Math.max(Number(st.data.order && st.data.order.quantity) || 1, 1);
        const dmgN = (st.data.damaged_pending || []).length;
        let txt;
        if (f.mode === 'return_all') {
            txt = f.retN ? `คืนวัสดุเข้าสต็อก ${num(f.retPcs)} ชิ้น (${num(f.retN)} รายการ)` : 'ไม่มีวัสดุให้คืน';
            if (f.panels) txt += ' · คืนบานเก็บเข้าสต๊อกบาน';
        } else if (f.choice === 'backup') {
            txt = `เก็บเป็นสต็อกสำรอง ${num(sets)} ชุด · ไม่คืนวัสดุ`;
        } else {
            txt = 'ไม่เข้าสต็อก · ไม่คืนวัสดุ';
        }
        if (dmgN) txt += ` · คืนวัสดุเสียที่ยังไม่จ่าย ${dmgN} รายการ`;
        return txt;
    }

    function updateSummary() {
        const sumEl = document.getElementById('cipSum');
        const btn = document.getElementById('cipSubmit');
        if (!sumEl || !btn) return;
        const f = readForm();
        let warn = '';
        if (f.mode === 'finished' && !f.choice) warn = 'เลือกข้อ 1 ก่อน';
        else if (f.mode === 'return_all' && f.missingStock) warn = 'มีวัสดุที่ไม่พบในสต็อก ยกเลิกไม่ได้';
        else if (f.reason.length < 3) warn = 'ใส่เหตุผลอย่างน้อย 3 ตัวอักษร';
        sumEl.innerHTML = esc(outcomeText(f)) + (warn ? `<br><span style="color:#f59e0b">⚠️ ${esc(warn)}</span>` : '');
        btn.disabled = !!warn || st.busy;
    }

    function onClick(e) {
        if (!st) return;
        // แตะพื้นหลังไม่ปิด (กันเหตุผลที่พิมพ์ไว้หาย) — ปิดด้วยปุ่ม ✕ / ปิด / Esc
        const b = e.target.closest('[data-cip]');
        if (!b) return;
        const a = b.dataset.cip;
        if (a === 'close') { if (!st.busy) close(); return; }
        if (a === 'submit') submit();
    }

    function onInput(e) {
        if (!st || !st.data) return;
        if (e.target.name === 'cipChoice') {
            const r = document.getElementById('cipReason');
            if (r) st.reason = r.value;
            st.choice = e.target.value;
            render();
            const r2 = document.getElementById('cipReason');
            if (r2 && !r2.value) r2.focus();
            return;
        }
        if (e.target.id === 'cipPanels') st.panels = e.target.checked;
        updateSummary();
    }

    function onKey(e) {
        if (e.key === 'Escape' && st && !st.busy) close();
    }

    async function submit() {
        if (!st || st.busy) return;
        const f = readForm();
        const btn = document.getElementById('cipSubmit');
        if (!btn || btn.disabled) { updateSummary(); return; }
        const o = st.data.order || {};
        const ok = confirm(`ยืนยันยกเลิกออเดอร์\n\nเลขที่ผลิต: ${st.label}\nออเดอร์: ${o.order_number || '-'}\n${outcomeText(f)}\nเหตุผล: ${f.reason}\n\nยกเลิกแล้วย้อนกลับไม่ได้`);
        if (!ok) return;

        st.busy = true;
        btn.disabled = true;
        btn.textContent = '⏳ กำลังบันทึก...';
        const order = st.order;
        try {
            const { data, error } = await st.db.rpc('rpc_cancel_in_production', {
                p_order_id: order.id,
                p_reason: f.reason,
                p_keep_backup: f.mode === 'finished' && f.choice === 'backup',
                p_return_panels: f.mode === 'return_all' && f.panels
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
            btn.textContent = '❌ ยืนยันยกเลิกออเดอร์';
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
