/* ============================================================
   alu-cut-plan.js — ตัวจัดเส้นอลูมิเนียม (สั่งตัดโรงงานโมดูลาร่า)
   โจทย์: มีขนาดท่อนที่ต้องการ × จำนวน → จัดลงเส้นเต็มให้ใช้เส้นน้อยที่สุด และใช้แบบตัดน้อย
          (แบบตัดเดียวกันตัดซ้ำหลายเส้น = ช่างตั้งระยะครั้งเดียว)
   สูตรเนื้อที่ (ตรงกับแอปโมดูลาร่า calcCutPlan):  ใช้ = หัวเส้น + Σ ยาวท่อน + ใบตัด × จำนวนท่อน
       → 1 ท่อนกินที่ (ยาว + ใบตัด) · ที่ว่างต่อเส้น = ยาวเส้น − หัวเส้น
   หน่วย: มิลลิเมตรจำนวนเต็มทั้งหมด
   ไม่ใช้นาฬิกาหรือสุ่ม → ใส่ข้อมูลเดิมได้ผลเดิมทุกครั้งทุกเครื่อง

   เปิดใช้: เว็บ <script src="alu-cut-plan.js"></script> → window.AluCutPlan
            node const AluCutPlan = require('./alu-cut-plan.js')
   ============================================================ */
(function (root) {
  'use strict';

  const DEFAULTS = { trim: 50, kerf: 5 };
  const EPS = 1e-9;

  /* ---------- ตรวจ + รวมขนาดซ้ำ ---------- */
  function normDemand(list) {
    const m = new Map();
    for (const it of list || []) {
      const len = Math.round(Number(it && it.len));
      const qty = Math.round(Number(it && it.qty));
      if (!(len > 0) || !(qty > 0)) continue;
      m.set(len, (m.get(len) || 0) + qty);
    }
    return [...m.entries()].map(([len, qty]) => ({ len, qty })).sort((a, b) => b.len - a.len);
  }

  function lowerBound(sizes, need, cap) {
    let mat = 0;
    for (let i = 0; i < sizes.length; i++) mat += sizes[i].w * need[i];
    return Math.ceil(mat / cap - EPS);
  }

  /* ---------- กระเป๋าเป้แบบจำกัดจำนวน (DP ตามความยาว) ----------
     เลือกจำนวน a[i] ≤ bound[i] ให้ Σ w[i]·a[i] ≤ cap และ Σ val[i]·a[i] มากสุด
     แตกจำนวนเป็นก้อน 1,2,4,… เพื่อให้ DP เร็ว · เสมอกัน → เอาที่ยาวรวมมากกว่า (เศษน้อย) */
  function knapsack(w, val, bound, cap) {
    const parts = [];
    for (let i = 0; i < w.length; i++) {
      let b = Math.min(bound[i], Math.floor(cap / w[i]));
      for (let k = 1; b > 0; k <<= 1) {
        const t = Math.min(k, b);
        parts.push({ i, t, w: w[i] * t, v: val[i] * t });
        b -= t;
      }
    }
    const best = new Float64Array(cap + 1);
    const used = new Int32Array(cap + 1);
    const take = parts.map(() => new Uint8Array(cap + 1));
    for (let p = 0; p < parts.length; p++) {
      const pw = parts[p].w, pv = parts[p].v, tk = take[p];
      for (let c = cap; c >= pw; c--) {
        const nv = best[c - pw] + pv, nu = used[c - pw] + pw;
        if (nv > best[c] + EPS || (nv > best[c] - EPS && nu > used[c])) {
          best[c] = nv; used[c] = nu; tk[c] = 1;
        }
      }
    }
    const a = new Array(w.length).fill(0);
    let c = cap;
    for (let p = parts.length - 1; p >= 0; p--) {
      if (take[p][c]) { a[parts[p].i] += parts[p].t; c -= parts[p].w; }
    }
    let value = 0, usedLen = 0;
    for (let i = 0; i < w.length; i++) { value += val[i] * a[i]; usedLen += w[i] * a[i]; }
    return { a, value, used: usedLen };
  }

  /* ---------- LP หลัก: min Σx  s.t.  A x ≥ d , x ≥ 0 ----------
     แก้ผ่านโจทย์คู่ (dual): max d·y  s.t.  patternᵀy ≤ 1 , y ≥ 0  → เริ่มจาก y = 0 ได้ทันที ไม่ต้องหาจุดเริ่ม
     ค่า x ของแต่ละแบบตัด = ราคาเงาของแถวแบบตัดนั้นในตารางสุดท้าย */
  function solveMaster(pats, need) {
    const n = pats.length, m = need.length, cols = m + n;
    const T = [];
    for (let r = 0; r < n; r++) {
      const row = new Float64Array(cols + 1);
      for (let i = 0; i < m; i++) row[i] = pats[r][i];
      row[m + r] = 1;
      row[cols] = 1;
      T.push(row);
    }
    const z = new Float64Array(cols + 1);
    for (let i = 0; i < m; i++) z[i] = -need[i];
    const basis = [];
    for (let r = 0; r < n; r++) basis.push(m + r);
    for (let iter = 0; iter < 5000; iter++) {
      // Bland: คอลัมน์แรกที่ยังทำให้ดีขึ้นได้ (กันวนซ้ำตอนเสื่อม)
      let e = -1;
      for (let j = 0; j < cols; j++) if (z[j] < -1e-9) { e = j; break; }
      if (e < 0) break;
      let lv = -1, bestRatio = Infinity;
      for (let r = 0; r < n; r++) {
        const a = T[r][e];
        if (a > 1e-12) {
          const ratio = T[r][cols] / a;
          if (ratio < bestRatio - 1e-12 || (Math.abs(ratio - bestRatio) <= 1e-12 && basis[r] < basis[lv])) {
            bestRatio = ratio; lv = r;
          }
        }
      }
      if (lv < 0) break; // ไม่มีขอบเขต (ไม่ควรเกิด)
      const pr = T[lv], pv = pr[e];
      for (let j = 0; j <= cols; j++) pr[j] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === lv) continue;
        const f = T[r][e];
        if (Math.abs(f) > 1e-15) { const row = T[r]; for (let j = 0; j <= cols; j++) row[j] -= f * pr[j]; }
      }
      const f = z[e];
      for (let j = 0; j <= cols; j++) z[j] -= f * pr[j];
      basis[lv] = e;
    }
    const y = new Array(m).fill(0);
    for (let r = 0; r < n; r++) if (basis[r] < m) y[basis[r]] = T[r][cols];
    const x = new Array(n);
    for (let r = 0; r < n; r++) x[r] = Math.max(0, z[m + r]);
    return { x, y, obj: z[cols] };
  }

  /* ---------- Column generation: หา LP ที่ดีที่สุดของความต้องการที่เหลือ ---------- */
  function columnGen(sizes, need, cap, seedPats) {
    const m = sizes.length, w = sizes.map(s => s.w);
    const key = a => a.join(',');
    const seen = new Set();
    const pats = [];
    const add = a => { const k = key(a); if (!seen.has(k) && a.some(v => v > 0)) { seen.add(k); pats.push(a.slice()); } };
    for (let i = 0; i < m; i++) {
      if (need[i] <= 0) continue;
      const a = new Array(m).fill(0);
      a[i] = Math.min(need[i], Math.floor(cap / w[i]));
      add(a);
    }
    for (const p of seedPats || []) if (p.every((v, i) => v <= Math.max(need[i], 0))) add(p);
    let lp;
    for (let it = 0; it < 300; it++) {
      lp = solveMaster(pats, need.map(v => Math.max(v, 0)));
      const kn = knapsack(w, lp.y, need.map(v => Math.max(v, 0)), cap);
      if (kn.value <= 1 + 1e-7) break;
      const before = pats.length;
      add(kn.a);
      if (pats.length === before) break;
    }
    return { pats, x: lp.x, obj: lp.obj };
  }

  /* ---------- วิธี A: LP + ปัดเศษทีละขั้น (เน้นเส้นน้อยสุด) ---------- */
  function solveByLP(sizes, need0, cap) {
    const m = sizes.length;
    const need = need0.slice();
    const out = [];
    let pool = [];
    for (let guard = 0; guard < 200 && need.some(v => v > 0); guard++) {
      const cg = columnGen(sizes, need, cap, pool);
      pool = cg.pats;
      let progressed = false;
      cg.pats.forEach((p, k) => {
        const t = Math.floor(cg.x[k] + 1e-7);
        if (t > 0) {
          out.push({ a: p.slice(), times: t });
          for (let i = 0; i < m; i++) need[i] -= p[i] * t;
          progressed = true;
        }
      });
      if (!progressed) {
        // ไม่มีแบบไหนเต็มเส้น → ใช้แบบที่ x มากสุด 1 เส้น (ปัดขึ้น)
        let k = 0;
        cg.x.forEach((v, j) => { if (v > cg.x[k] + 1e-12) k = j; });
        const p = cg.pats[k];
        out.push({ a: p.slice(), times: 1 });
        for (let i = 0; i < m; i++) need[i] -= p[i];
      }
    }
    return out;
  }

  /* ---------- วิธี B: ตั้งแบบเดียวตัดซ้ำให้มากที่สุด (เน้นแบบตัดน้อย · แบบที่คนจัดทำ) ----------
     ทุกรอบ: ลองความถี่ F จากมากไปน้อย หาแบบตัดที่ตัดซ้ำได้ F เส้นโดยไม่เกินที่ต้องการ และเศษไม่เกินเพดาน
     เพดานเศษค่อย ๆ ผ่อน (เศษน้อยมาก่อน) */
  const WASTE_STEPS = [0.004, 0.008, 0.015, 0.025, 0.04, 0.06, 0.1, 1];
  function solveBySHP(sizes, need0, cap, wasteSteps) {
    const m = sizes.length, w = sizes.map(s => s.w);
    const need = need0.slice();
    const out = [];
    for (let guard = 0; guard < 500 && need.some(v => v > 0); guard++) {
      const rem = need.map(v => Math.max(v, 0));
      const lb = lowerBound(sizes, rem, cap);
      let pick = null;
      // หางานสุดท้ายที่ใส่เส้นเดียวได้หมด
      if (lb <= 1) {
        const all = rem.reduce((s, v, i) => s + v * w[i], 0);
        if (all <= cap) pick = { a: rem.slice(), times: 1 };
      }
      for (const ws of (pick ? [] : (wasteSteps || WASTE_STEPS))) {
        const maxWaste = ws >= 1 ? cap : Math.floor(cap * ws);
        for (let F = lb; F >= 1 && !pick; F = F > 8 ? Math.floor(F * 0.85) : F - 1) {
          const bound = rem.map(v => Math.floor(v / F));
          if (!bound.some(v => v > 0)) continue;
          const kn = knapsack(w, w, bound, cap); // ให้ยาวรวมมากสุด = เศษน้อยสุด
          if (!kn.a.some(v => v > 0)) continue;
          if (cap - kn.used <= maxWaste) {
            let times = Infinity;
            kn.a.forEach((c, i) => { if (c > 0) times = Math.min(times, Math.floor(rem[i] / c)); });
            pick = { a: kn.a, times: Math.max(1, times) };
          }
        }
        if (pick) break;
      }
      if (!pick) break;
      out.push(pick);
      for (let i = 0; i < m; i++) need[i] -= pick.a[i] * pick.times;
    }
    return out;
  }

  /* ---------- วิธี C: รู้แล้วว่าใช้ได้ B เส้น → ค้นหาแบบตัดน้อยสุดที่ยังใช้ไม่เกิน B เส้น ----------
     ทุกขั้นเลือก "แบบตัด × จำนวนเส้น" จากผู้สมัคร (ตัดซ้ำได้มาก/แบบจากวิธี LP) แล้วไล่ลึกแบบตัดกิ่ง
     ตัดกิ่งเมื่อ เส้นที่ใช้แล้ว + เส้นขั้นต่ำของที่เหลือ > B หรือ จำนวนแบบ ≥ ดีที่สุดที่เจอ
     งบนับงาน (ไม่ใช้นาฬิกา) → ผลเหมือนเดิมทุกครั้ง */
  function solveByTarget(sizes, need0, cap, B, seedPats, budget) {
    const m = sizes.length, w = sizes.map(s => s.w);
    const knCache = new Map();
    const kn = bound => {
      const k = bound.join(',');
      if (!knCache.has(k)) knCache.set(k, knapsack(w, w, bound, cap));
      return knCache.get(k);
    };
    let work = 0, best = null;
    const path = [];
    const K = 4;
    function cands(rem, used) {
      const lb = lowerBound(sizes, rem, cap);
      const list = [], seen = new Set();
      const push = (a, t) => {
        if (!(t > 0) || !a.some(v => v > 0)) return;
        const k = a.join(',') + '|' + t;
        if (seen.has(k)) return;
        seen.add(k);
        const after = rem.map((v, i) => v - a[i] * t);
        const afterPos = after.map(v => Math.max(v, 0));
        const lbA = lowerBound(sizes, afterPos, cap);
        if (used + t + lbA > B) return;
        const waste = cap - a.reduce((s, c, i) => s + c * w[i], 0);
        list.push({ a, t, after: afterPos, waste });
      };
      // งานสุดท้ายใส่เส้นเดียวได้หมด
      if (rem.reduce((s, v, i) => s + v * w[i], 0) <= cap) push(rem.slice(), 1);
      const seenB = new Set();
      for (let F = lb; F >= 1; F = F > 8 ? Math.floor(F * 0.85) : F - 1) {
        const bound = rem.map(v => Math.floor(v / F));
        const bk = bound.join(',');
        if (seenB.has(bk) || !bound.some(v => v > 0)) continue;
        seenB.add(bk);
        work++;
        const r = kn(bound);
        let t = Infinity;
        r.a.forEach((c, i) => { if (c > 0) t = Math.min(t, Math.floor(rem[i] / c)); });
        if (t !== Infinity) push(r.a, t);
      }
      for (const p of seedPats || []) {
        if (!p.every((c, i) => c <= rem[i])) continue;
        let t = Infinity;
        p.forEach((c, i) => { if (c > 0) t = Math.min(t, Math.floor(rem[i] / c)); });
        if (t !== Infinity && t > 0) push(p, t);
      }
      // ตัดซ้ำได้หลายเส้นก่อน · เสมอกัน → เศษน้อยก่อน
      list.sort((x, y) => y.t - x.t || x.waste - y.waste);
      return list.slice(0, K);
    }
    function dfs(rem, used) {
      if (work > budget) return;
      if (!rem.some(v => v > 0)) {
        if (!best || path.length < best.length) best = path.map(p => ({ a: p.a.slice(), times: p.t }));
        return;
      }
      if (best && path.length + 1 >= best.length) return;
      for (const c of cands(rem, used)) {
        path.push(c);
        dfs(c.after, used + c.t);
        path.pop();
        if (work > budget) return;
      }
    }
    dfs(need0.map(v => Math.max(v, 0)), 0);
    return best;
  }

  /* ---------- รวมแบบตัดซ้ำ + สรุปผล ---------- */
  function summarize(sizes, need0, cap, raw, barLen, opt) {
    const m = sizes.length;
    const byKey = new Map();
    for (const r of raw) {
      const k = r.a.join(',');
      if (byKey.has(k)) byKey.get(k).times += r.times; else byKey.set(k, { a: r.a.slice(), times: r.times });
    }
    const made = new Array(m).fill(0);
    let bars = 0, wasteMm = 0;
    const patterns = [];
    for (const p of byKey.values()) {
      const used = p.a.reduce((s, c, i) => s + c * sizes[i].w, 0);
      const waste = cap - used;
      bars += p.times; wasteMm += waste * p.times;
      p.a.forEach((c, i) => { made[i] += c * p.times; });
      patterns.push({
        bars: p.times,
        cuts: p.a.map((c, i) => ({ len: sizes[i].len, count: c })).filter(x => x.count > 0),
        pieces: p.a.reduce((s, c) => s + c, 0),
        wasteMm: waste,
      });
    }
    patterns.sort((a, b) => b.bars - a.bars || a.wasteMm - b.wasteMm);
    const extra = sizes.map((s, i) => ({ len: s.len, count: made[i] - need0[i] })).filter(x => x.count > 0);
    return {
      barLen, trim: opt.trim, kerf: opt.kerf,
      bars, patternCount: patterns.length, patterns,
      wasteMm, wastePct: bars ? Math.round(wasteMm / (bars * barLen) * 1000) / 10 : 0,
      extra,
      ok: made.every((v, i) => v >= need0[i]),
    };
  }

  /* ---------- ทางเข้าหลัก ----------
     plan({ barLen, trim?, kerf?, fill?, fillers?:[{len, max}], demand:[{len, qty}] })   fill = เติมเศษเป็นท่อนเพิ่ม (ไม่เพิ่มเส้น)
       fillers = ขนาดอื่นที่ยอมให้ตัดจากเศษได้ (ใช้เมื่อ fill เปิด · ไม่เกิน max ท่อน · ไม่นับเป็นของที่ต้องได้)
     → { ok, bars, lowerBound, patternCount, patterns:[{bars, cuts:[{len,count}], pieces, wasteMm}], wastePct, extra, method, errors } */
  function plan(input) {
    const opt = Object.assign({}, DEFAULTS, input || {});
    const barLen = Math.round(Number(opt.barLen));
    const errors = [];
    if (!(barLen > 0)) errors.push('ไม่มีความยาวเส้น');
    const cap = barLen - opt.trim;
    const dem = normDemand(opt.demand);
    if (!dem.length) errors.push('ไม่มีขนาดที่ต้องตัด');
    for (const d of dem) if (d.len + opt.kerf > cap) errors.push(`ท่อน ${d.len} มม. ยาวเกินเส้น (ใส่ได้ไม่เกิน ${cap - opt.kerf} มม.)`);
    if (errors.length) return { ok: false, errors };
    const sizes = dem.map(d => ({ len: d.len, w: d.len + opt.kerf }));
    const need = dem.map(d => d.qty);
    const lb = lowerBound(sizes, need, cap);
    const cands = [];
    const lpRaw = solveByLP(sizes, need, cap);
    const lpRes = Object.assign(summarize(sizes, need, cap, lpRaw, barLen, opt), { method: 'เส้นน้อยสุด' });
    cands.push(lpRes);
    cands.push(Object.assign(summarize(sizes, need, cap, solveBySHP(sizes, need, cap), barLen, opt), { method: 'ตัดซ้ำมากสุด' }));
    const seeds = lpRaw.map(r => r.a);
    const tgt = solveByTarget(sizes, need, cap, lpRes.bars, seeds, opt.budget || 400);
    if (tgt) cands.push(Object.assign(summarize(sizes, need, cap, tgt, barLen, opt), { method: 'เส้นน้อยสุด+แบบน้อย' }));
    const okc = cands.filter(c => c.ok);
    okc.sort((a, b) => a.bars - b.bars || a.patternCount - b.patternCount || a.wasteMm - b.wasteMm);
    let best = okc[0];
    // เติมเศษ: เศษที่ยังยาวพอ → ตัดเป็นท่อนเพิ่ม (ไม่เพิ่มเส้น · ได้ของเกินที่สั่ง)
    //   ขั้น 1 ขนาดในใบเดียวกัน (ไม่จำกัดจำนวน · เหมือนเดิม)
    //   ขั้น 2 ที่ยังเหลือ → ขนาดอื่นของเส้นเดียวกัน (fillers: [{len, max}]) ไม่เกิน max ท่อนรวมทั้งใบ
    //   เศษยาวสุดได้เลือกก่อน · ถ้าขนาดอื่นหมดโควต้ากลางแบบ → แยกแบบนั้นเป็น 2 แบบ (ส่วนที่ได้เติม / ส่วนที่ไม่ได้)
    if (opt.fill) {
      const inOrder = new Set(sizes.map(s => s.len)), fm = new Map();
      for (const f of opt.fillers || []) {
        const len = Math.round(Number(f && f.len)), mx = Math.round(Number(f && f.max));
        if (!(len > 0) || !(mx > 0) || inOrder.has(len) || len + opt.kerf > cap) continue;
        fm.set(len, (fm.get(len) || 0) + mx);
      }
      const fl = [...fm.entries()].sort((a, b) => b[0] - a[0]);
      const all = sizes.concat(fl.map(([len]) => ({ len, w: len + opt.kerf })));
      const need2 = need.concat(fl.map(() => 0)), left = fl.map(x => x[1]), n0 = sizes.length;
      const W = all.map(s => s.w), minW = Math.min(...W), raw = [];
      const pats = best.patterns.slice().sort((a, b) => b.wasteMm - a.wasteMm || b.bars - a.bars);
      for (const p of pats) {
        const base = all.map(s => { const c = p.cuts.find(x => x.len === s.len); return c ? c.count : 0; });
        let room = cap - base.reduce((s, c, i) => s + c * W[i], 0);
        if (room >= Math.min(...W.slice(0, n0))) {
          const k1 = knapsack(W, W, W.map((w, i) => i < n0 ? Math.floor(room / w) : 0), room);
          k1.a.forEach((c, i) => { base[i] += c; });
          room -= k1.used;
        }
        let T = p.bars;
        while (T > 0) {
          const a = base.slice();
          let q = T;
          if (fl.length && room >= minW) {
            const kn = knapsack(W, W, W.map((w, i) => i < n0 ? 0 : Math.min(Math.floor(room / w), left[i - n0])), room);
            kn.a.forEach((c, i) => { a[i] += c; if (c > 0 && i >= n0) q = Math.min(q, Math.floor(left[i - n0] / c)); });
            kn.a.forEach((c, i) => { if (i >= n0) left[i - n0] -= c * q; });
          }
          raw.push({ a, times: q });
          T -= q;
        }
      }
      best = Object.assign(summarize(all, need2, cap, raw, barLen, opt), { method: best.method + '+เติมเศษ', filled: true });
    }
    return Object.assign({}, best, { lowerBound: lb, errors: [], alternatives: okc.filter(c => c !== okc[0]) });
  }

  const api = { plan, DEFAULTS, _internal: { knapsack, solveMaster, columnGen, solveByLP, solveBySHP, lowerBound, normDemand } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AluCutPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
