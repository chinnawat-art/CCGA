/* ============================================================
   shared/glass-engine.js — เครื่องคิดของแอป "สั่งกระจกตามแพทเทิร์น" (Glass Order)
   ใช้ร่วมกัน 3 ที่: หน้าเว็บ glass/app.html · AI worker (glass/worker/) · เทส node (shared/glass-engine.test.js)
   กฎเหล็ก: ตัวเลขทุกตัวที่แอป/AI พูดถึง (ผลผลิต · % พื้นที่ · ผลตรวจผัง · ทางเลือกการสั่ง) ต้องมาจากไฟล์นี้เท่านั้น

   ส่วนที่ 1 (TASK 4) — ผังตัด:  patternYield · patternUsedPct · validatePattern · renderPatternSVG
                                  + ฟังก์ชันช่วยหน่วย (mmOfCm · cmTxt · pieceKey …) ซึ่งเป็น "ตัวจริง" ตัวเดียวของทั้งแอป
   ส่วนที่ 2 (TASK 5) — ทางเลือกการสั่ง: computeNeeds · computeOptions · applyLines · explain
   ส่วนที่ 3 (TASK 12) — สร้างผังใหม่จากขนาดที่ต้องการ: generatePatterns (ตัดตรงทะลุแผ่น 2 ขั้น แถบ→ซอย · ทุกผังผ่าน validatePattern)
                                  → ต่อท้ายในหัวข้อ "ส่วนที่ 2" ด้านล่าง แล้วเพิ่มชื่อลงใน API ท้ายไฟล์

   หน่วย: ความยาว = มิลลิเมตรจำนวนเต็ม · แสดงเป็น ซม. ทศนิยม 1 ตำแหน่ง · แผ่นเรียกเป็นนิ้ว (1 นิ้ว = 25.4 มม. ปัดจำนวนเต็ม)
   โครง layout (ตรงกับคอลัมน์ glass_patterns.layout):
     {direction:'แนวตั้ง'|'แนวนอน', strips:[{size_mm, full_length?, label?, cuts:[{size_mm, piece_id, label?}]}]}
     แนวตั้ง = แถบกว้าง size_mm สูงเต็มแผ่น เรียงจากซ้ายไปขวา แล้วซอยตามความสูง (cuts เรียงจากบนลงล่าง ชิดขอบล่าง เศษอยู่บน)
     แนวนอน = กลับกัน (แถบสูง size_mm เรียงจากบนลงล่าง ชิดขอบล่าง · ซอยตามความกว้างจากซ้ายไปขวา เศษอยู่ขวา)
     cut.size_mm = ขนาดที่ "ตัดจริง" ตามรูปผัง · cut.piece_id = "รายการสต๊อก" ที่นับชิ้นนี้ → สองค่านี้ต่างกันได้ไม่เกิน 2 มม. ต่อด้าน (เจ้าของเคาะ 13 ก.ย. 69)
     (ใช้กับ "รวมเป็นสต๊อกเดียว": ผังยังตัด 60.8 ตามรูป แต่นับเป็นสต๊อก 61.0 — ห้ามเปลี่ยนขนาดตัดในผัง)
     label (ไม่บังคับ) = ตัวเลขตามที่พิมพ์ในรูป เช่น "43.05" ใช้แสดงในผัง SVG แทนค่าที่ปัดเป็น มม. แล้ว
     full_length: true = แถบนี้เป็นชิ้นเดียวยาวตลอดแผ่น · cut.size_mm ของแถบนี้ = fullLengthMm(แผ่น, ทิศ) (เจ้าของยืนยัน 13 ก.ย. 69:
     ปัดลงจากนิ้ว — 72 นิ้ว = 1828 มม. = "ยาว 182.8" ไม่ใช่ 1829 ที่เป็นขนาดแผ่นปัดครึ่งขึ้น · ขนาดแผ่นในทะเบียนยังเก็บ 1829 เหมือนเดิม)

   เปิดใช้: หน้าเว็บ <script src="../shared/glass-engine.js"></script> → globalThis.GlassEngine
            node    const GlassEngine = require('./shared/glass-engine.js')
   ============================================================ */
(function(root){
'use strict';

/* ==================== ค่าคงที่ ==================== */
const MM_PER_IN=25.4;              /* 1 นิ้ว = 25.4 มม. */
const MM2_PER_SQFT=92903.04;       /* 1 ตร.ฟุต = 92,903.04 ตร.มม. */
const SQIN_PER_SQFT=144;           /* 1 ตร.ฟุต = 144 ตร.นิ้ว */
/* ขนาดตัดจริงต่างจากขนาดชิ้นในทะเบียนได้ไม่เกินเท่านี้ (ต่อด้าน · สั้นเทียบสั้น ยาวเทียบยาว) = เกณฑ์ "ชิ้นเดียวกันในสต๊อก" ด้วย
   เจ้าของเคาะ 13 ก.ย. 69: "ในแพทเทิร์นอาจจะมีขนาดสั่งตัดที่ต่างกัน 1-2 มิล ให้แปลว่าเป็นอันเดียวกัน" → 2 มม. (เดิม TASK 4 ใช้ 5) */
const CUT_STOCK_TOL_MM=2;
/* จำนวน "ขั้นของการตัด" ที่ไฟล์นี้อ่านผังได้ — หน้าเว็บเช็คค่านี้ตอนบูต
   2 = แถบ→ซอย อย่างเดียว · 3 = แบ่งแผ่นเป็นส่วน (sections) ก่อน แล้วแต่ละส่วนเป็น แถบ→ซอย
   ⛔ ต้องขยับพร้อมกับความสามารถจริง — ถ้าหน้าเว็บเจอค่าต่ำกว่าที่ต้องการ ให้ขึ้นกล่องแดงบอกให้กด Ctrl+F5
      (กันเคส: deploy หน้าเว็บใหม่แล้ว แต่เบราว์เซอร์ยังใช้ glass-engine.js รุ่นเก่าจากแคช → ผัง 3 ขั้นถูกอ่านผิดเงียบ ๆ) */
const LAYOUT_LEVELS=3;
const DIR_V='แนวตั้ง',DIR_H='แนวนอน';
const DIRECTIONS=[DIR_V,DIR_H];
/* สีในผังตัด (ช่อง "สีใส= / สีเขียว= / สีชาดำ=") — ใช้เมื่อหน้าเว็บไม่ได้ส่ง settings.glass_colors มา */
const DEFAULT_COLORS=[{key:'ใส',name:'สีใส'},{key:'เขียว',name:'สีเขียว'},{key:'ชาดำ',name:'สีชาดำ'}];
/* พื้นชิ้นในผัง — พาสเทลอ่อน (ตัวหนังสือดำอ่านชัด) · "สีพื้นแยกกลุ่มขนาด" ไม่ใช่สีกระจก */
/* 10 สีคนละโทนชัด ๆ (ฟ้า เหลือง เขียว ชมพูม่วง ส้ม น้ำเงิน ม่วง เขียวน้ำทะเล แดงอ่อน ชมพู) — ไม่มีเทา เพราะเทา = ชิ้นที่ไม่มีในทะเบียน */
const PASTEL=['#aeeefa','#fde98f','#b6f29c','#f2b8f6','#fdcb9a','#b9cffb','#d6c8fb','#9fe3cf','#fbbab3','#f6b8d3'];

/* ==================== ฟังก์ชันช่วยหน่วย (ตัวจริงของทั้งแอป — หน้าเว็บเรียกของที่นี่ ห้ามมีสูตรชุดที่สอง) ==================== */
/* ซม. → มม. จำนวนเต็ม (47.5 → 475) */
function mmOfCm(cm){const v=Number(cm);return isFinite(v)?Math.round(v*10):0;}
/* มม. → ข้อความ ซม. ทศนิยม 1 ตำแหน่ง ตัด .0 ทิ้งถ้าลงตัว (875 → "87.5" · 600 → "60") */
function cmTxt(mm){const v=Math.round(Number(mm)||0);return (v/10).toFixed(1).replace(/\.0$/,'');}
/* มม. → ซม. ทศนิยม 1 ตำแหน่งเสมอ (600 → "60.0") — ใช้ในผังตัดให้หน้าตาเหมือนรูปเดิม */
function cmFixed(mm){const v=Math.round(Number(mm)||0);return (v/10).toFixed(1);}
/* คีย์ชิ้น = "ด้านสั้นxด้านยาว" (x เล็กภาษาอังกฤษ) — หมุน 90° ได้คีย์เดียวกัน */
function pieceKey(a_mm,b_mm){const a=Math.round(Number(a_mm)||0),b=Math.round(Number(b_mm)||0);
  return Math.min(a,b)+'x'+Math.max(a,b);}
const normalizeKey=pieceKey;       /* ชื่อตาม SPEC */
/* ชื่อที่คนอ่าน (ซม.) — ด้านสั้น×ด้านยาว เช่น 47.5×87.5 */
function pieceName(a_mm,b_mm){const a=Math.round(Number(a_mm)||0),b=Math.round(Number(b_mm)||0);
  return cmTxt(Math.min(a,b))+'×'+cmTxt(Math.max(a,b));}
/* นิ้ว → มม. จำนวนเต็ม (72 → 1829) */
function inToMm(inch){const v=Number(inch);return isFinite(v)?Math.round(v*MM_PER_IN):0;}
const mmOfInch=inToMm;             /* ชื่อเดียวกับที่หน้าเว็บ (TASK 2) ใช้ */
/* ตร.ฟุต ของชิ้น (จาก มม.) — แผ่นให้ใช้ sqftOfInches (คิดจากนิ้วตรง ๆ ห้ามคิดจาก มม. ที่ปัดแล้ว) */
function sqftOf(w_mm,h_mm){const w=Number(w_mm),h=Number(h_mm);return (isFinite(w)&&isFinite(h))?(w*h)/MM2_PER_SQFT:0;}
function sqftOfInches(w_in,h_in){const w=Number(w_in),h=Number(h_in);return (isFinite(w)&&isFinite(h))?(w*h)/SQIN_PER_SQFT:0;}
/* ค่าคลาดจากการปัดเศษ → roundTolMm() อยู่ใต้ labelOk() ด้านล่าง (ต้องใช้ตัวอ่านป้ายตัวเลข) */
/* ระยะห่างของขนาด (มม.) — ตัวจริงตัวเดียวของกติกา "ชิ้นเดียวกันในสต๊อก / ขนาดตัดต่างจากขนาดสต๊อกไม่เกิน 2 มม. ต่อด้าน" (หน้าเว็บห้ามเขียนสูตรนี้เอง)
   กติกาเจ้าของ 13 ก.ย. 69:
     R1 สองขนาด = ชิ้นเดียวกันในสต๊อก ถ้าด้านสั้นต่างกัน ≤ 2 มม. และด้านยาวต่างกัน ≤ 2 มม. (สั้นเทียบสั้น ยาวเทียบยาว)
     R2 รวม = นับสต๊อกเป็นรายการเดียวเท่านั้น · ผังที่ส่งร้านเขียนขนาดตัดจริงตามรูปเสมอ (cut.size_mm = ขนาดตัดจริง · cut.piece_id = รายการสต๊อก)
   sizeDiffMm  = วางทิศเดียวกัน (กว้างเทียบกว้าง · สูงเทียบสูง) → ค่ามากสุดของสองด้าน
   pieceDiffMm = ไม่สนทิศ (เทียบแบบคีย์ ด้านสั้น×ด้านยาว) — เรียงด้านสั้นก่อนแล้วเทียบ = ทิศที่ใกล้กว่าเสมอ
   samePiece(x,y) = R1 · x,y = {a_mm,b_mm} (สลับด้านมาก็ได้) · ขนาดไม่ใช่ตัวเลขบวก = false
   nearStock = ชื่อเดิมของ samePiece (หน้าเว็บเรียกอยู่: ฟอร์มผัง · นำเข้า · 🔗 รวม) — ตัวเดียวกันเป๊ะ ไม่ใช่สูตรชุดที่สอง */
function sizeDiffMm(w1,h1,w2,h2){return Math.max(Math.abs((Number(w1)||0)-(Number(w2)||0)),Math.abs((Number(h1)||0)-(Number(h2)||0)));}
function pieceDiffMm(a1,b1,a2,b2){const x1=Number(a1)||0,y1=Number(b1)||0,x2=Number(a2)||0,y2=Number(b2)||0;
  return sizeDiffMm(Math.min(x1,y1),Math.max(x1,y1),Math.min(x2,y2),Math.max(x2,y2));}
const posSize=v=>{const n=(typeof v==='number')?v:(typeof v==='string'&&v.trim()!=='')?Number(v):NaN;return isFinite(n)&&n>0;};
function samePiece(x,y){
  if(!x||!y||typeof x!=='object'||typeof y!=='object')return false;
  if(!posSize(x.a_mm)||!posSize(x.b_mm)||!posSize(y.a_mm)||!posSize(y.b_mm))return false;
  return pieceDiffMm(x.a_mm,x.b_mm,y.a_mm,y.b_mm)<=CUT_STOCK_TOL_MM;
}
const nearStock=samePiece;
/* findSamePiece(size, pieces) → ชิ้นในทะเบียนที่ใกล้ที่สุดที่เข้า R1 หรือ null
   size = {a_mm,b_mm} · pieces = ทะเบียน [{id,a_mm,b_mm,active}] หรือ {id:{…}}
   เรียง: ระยะ pieceDiffMm น้อยสุด → เท่ากันเลือกตัวที่เปิดใช้งาน (active!==false) ก่อน → พื้นที่ต่างน้อยสุด → รหัส id เรียงอักษร (ผลคงที่ทุกเครื่อง)
   ใช้: ฟอร์มผัง/นำเข้า หาว่า "ขนาดตัดนี้นับเป็นสต๊อกรายการไหน" โดยไม่สร้างชิ้นใหม่ซ้อน (R4) */
function findSamePiece(size,pieces){
  if(!size||typeof size!=='object')return null;
  const area=p=>(Number(p.a_mm)||0)*(Number(p.b_mm)||0),sa=area(size);
  let best=null,bk=null;
  pieceMap(pieces).forEach(p=>{
    if(!samePiece(size,p))return;
    const k=[pieceDiffMm(size.a_mm,size.b_mm,p.a_mm,p.b_mm),p.active===false?1:0,Math.abs(area(p)-sa),idOf(p.id)];
    if(!best||k[0]<bk[0]||(k[0]===bk[0]&&(k[1]<bk[1]||(k[1]===bk[1]&&(k[2]<bk[2]||(k[2]===bk[2]&&k[3]<bk[3]))))))(best=p,bk=k);
  });
  return best;
}
/* groupSamePieces(sizes, opts) → [{rep, members:[…], span_a, span_b}] — จัดกลุ่ม "ชิ้นเดียวกันในสต๊อก" (กติกาเจ้าของ 13 ก.ย. 69)
   sizes = [{key, a_mm, b_mm, count, patterns, registered?, id?}]
     count = จำนวนชิ้นรวมทุกแพทเทิร์น (ผลผลิตต่อแผ่นรวมกันทุกแบบ) · patterns = รายการรหัสแพทเทิร์น (array) หรือจำนวนแบบ (number)
     registered = true → ชิ้นที่มีในทะเบียนแล้ว (id = รหัส GP)
   R3 ทุกคู่ในกลุ่มต้องเข้า R1 (ไม่ใช่ลูกโซ่: 42.6 / 42.8 / 43.0 ไม่รวมเป็นกลุ่มเดียว เพราะ 42.6 กับ 43.0 ต่าง 4 มม.)
      วิธี: เรียงลำดับ (ข้างล่าง) แล้วใส่ทีละขนาดเข้า "กลุ่มแรก" ที่ทุกสมาชิกเข้า R1 กับขนาดนั้น · ไม่มี = เปิดกลุ่มใหม่
   R4 ตัวแทนของกลุ่ม (ชื่อที่ใช้ = a_mm/b_mm ของชิ้นในทะเบียน) = ขนาดที่ count มากสุด → เท่ากัน patterns มากกว่า → ยังเท่า พื้นที่ใหญ่กว่า
      ชิ้นในทะเบียน (registered) เป็นตัวแทนก่อนเสมอ — ห้ามสร้างชิ้นใหม่ซ้อน
   ลำดับที่ใส่ = registered ก่อน → count มาก → patterns มาก → พื้นที่ใหญ่ → key เรียงอักษร (ผลคงที่)
      → สมาชิกตัวแรกของทุกกลุ่ม = ตัวแทน (rep === members[0])
   ⚠️ กลุ่มหนึ่งมีชิ้นในทะเบียนได้ไม่เกิน 1 ชิ้น — ชิ้นในทะเบียนสองชิ้นที่ใกล้กันเป็นสต๊อกคนละรายการอยู่แล้ว
      ฟังก์ชันนี้ไม่รวมให้เงียบ ๆ (การรวมของที่มีอยู่แล้วเป็นงานของปุ่ม 🔗 รวม ที่เจ้าของยืนยันเอง)
   members = อ็อบเจกต์ตัวเดิมที่ส่งเข้ามา (ไม่คัดลอก) · span_a / span_b = ความต่างมากสุดในกลุ่มของด้านสั้น / ด้านยาว (มม.)
   ขนาดที่ไม่ใช่ตัวเลขบวก = กลุ่มเดี่ยวของตัวเอง (ไม่หาย ไม่รวมกับใคร) · opts สำรองไว้ (ยังไม่ใช้) */
function groupSamePieces(sizes,opts){
  const list=(Array.isArray(sizes)?sizes:[]).filter(x=>x&&typeof x==='object');
  const num=v=>{const n=toNum(v);return isFinite(n)?n:0;};
  const npat=x=>Array.isArray(x.patterns)?new Set(x.patterns.map(idOf).filter(Boolean)).size:Math.max(0,num(x.patterns));
  const lo=x=>Math.min(num(x.a_mm),num(x.b_mm)),hi=x=>Math.max(num(x.a_mm),num(x.b_mm));
  const order=list.map((x,i)=>({x,i,reg:x.registered===true?0:1,c:num(x.count),p:npat(x),ar:lo(x)*hi(x),k:String(x.key!=null?x.key:pieceKey(x.a_mm,x.b_mm))}))
    .sort((u,v)=>u.reg-v.reg||v.c-u.c||v.p-u.p||v.ar-u.ar||byStr(u.k,v.k)||u.i-v.i);
  const groups=[];
  order.forEach(o=>{
    const g=groups.find(g=>!(o.reg===0&&g.hasReg)&&g.members.every(m=>samePiece(m,o.x)));
    if(g){g.members.push(o.x);if(o.reg===0)g.hasReg=true;}
    else groups.push({members:[o.x],hasReg:o.reg===0});
  });
  return groups.map(g=>{
    const A=g.members.map(lo),B=g.members.map(hi);
    return {rep:g.members[0],members:g.members,span_a:Math.max(...A)-Math.min(...A),span_b:Math.max(...B)-Math.min(...B)};
  });
}

/* escape ทุกค่าที่ต่อเป็น HTML/SVG (ตัวเดียวกับหน้าเว็บ) */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* ตัวเลขทั่วไปในข้อความ — ทศนิยมไม่เกิน 2 ตำแหน่ง ตัดศูนย์ท้าย */
const numTxt=v=>String(Math.round((Number(v)||0)*100)/100);
/* ปัดทศนิยม 1 ตำแหน่ง — ใช้ toFixed ตามแบบ alu-erp/shared/pricing.js */
const round1=x=>!isFinite(x)?0:Number(x.toFixed(1));

/* ==================== อ่าน layout อย่างปลอดภัย ==================== */
/* ตัวเลขจากข้อมูล: รับเฉพาะ number หรือสตริงตัวเลข — true / [475] / {} / '' ไม่ใช่ตัวเลข
   (Number(true) = 1 · Number([475]) = 475 → ถ้าใช้ Number() ตรง ๆ ข้อมูลเสียจะถูกอ่านเป็นขนาดจริงแบบเงียบ ๆ) */
const toNum=v=>typeof v==='number'?v:(typeof v==='string'&&v.trim()!=='')?Number(v):NaN;
const posInt=v=>{const n=toNum(v);return Number.isInteger(n)&&n>0?n:0;};
const nonNeg=v=>{const n=toNum(v);return isFinite(n)&&n>0?n:0;};
const idOf=v=>v==null?'':String(v).trim();
function stripsOf(layout){return (layout&&typeof layout==='object'&&Array.isArray(layout.strips))?layout.strips:[];}
function cutsOf(strip){return (strip&&typeof strip==='object'&&Array.isArray(strip.cuts))?strip.cuts:[];}
function sheetDims(sheet){return {w:posInt(sheet&&sheet.w_mm),h:posInt(sheet&&sheet.h_mm)};}

/* ==================== ผังตัด 3 ขั้น — "ส่วน" (sections) · เจ้าของเคาะ 21 ต.ค. 69 ====================
   ผัง 2 ขั้น (เดิม ไม่แตะ):  {direction, strips:[{size_mm, cuts:[…]}]}
   ผัง 3 ขั้น (ใหม่):        {split:'แนวตั้ง'|'แนวนอน', sections:[{size_mm, direction, strips:[…]}, …]}

   ความหมาย: ตัดแบ่งแผ่นด้วยเส้นตรงทะลุแผ่นก่อน (split) ได้ "ส่วน" หลายส่วน
             แล้ว *แต่ละส่วนคือแผ่นเล็กที่มีผัง แถบ→ซอย ของตัวเอง* (ตรงตามที่เจ้าของอธิบาย)
     split='แนวตั้ง' → ตัดด้วยเส้นตั้ง · section.size_mm = ความกว้างของส่วน · สูงเต็มแผ่น · ส่วนเรียงซ้าย→ขวา
     split='แนวนอน' → ตัดด้วยเส้นนอน · section.size_mm = ความสูงของส่วน · กว้างเต็มแผ่น · ส่วนเรียงล่าง→บน

   ⛔ ทำไมเก็บที่ "ราก" ไม่ใช่ซ่อนไว้ข้างในแถบ: โค้ดเก่าที่ยังไม่รู้จัก 3 ขั้น จะได้ stripsOf() = []
      → ฟ้องดัง ๆ ("ผังยังไม่มีแถบ" · รูป PNG throw) แทนที่จะเดินผ่านแล้วได้คำตอบผิดบางส่วนแบบเงียบ ๆ
      (ถ้าซ่อนใน strip.sub โค้ดเก่าจะอ่านได้ครึ่งเดียวเสมอ: ผลผลิตขาด · รูปที่ส่งให้ร้านขาดแถบ)
   ⛔ ลึกได้ชั้นเดียว — ส่วนซ้อนส่วนไม่ได้ (= ไม่เกิน 3 ขั้น)
   ⛔ ผังหนึ่งมีได้อย่างใดอย่างหนึ่ง: strips หรือ sections ไม่ใช่ทั้งคู่ (validatePattern บังคับ)
   ==================================================================== */
function sectionsOf(layout){return (layout&&typeof layout==='object'&&Array.isArray(layout.sections))?layout.sections:[];}
/* ผังนี้เป็นผัง 3 ขั้นไหม (มีส่วนอย่างน้อย 1 ส่วน) */
function isSplitLayout(layout){return sectionsOf(layout).length>0;}

/* ตัวเดินผังกลาง — "ความจริงเส้นเดียว" ของการเดินผังทั้งแอป
   คืนรายการ "ส่วน" ที่แต่ละส่วนเป็นผัง 2 ขั้นบนแผ่นเสมือนของตัวเอง
   · ผัง 2 ขั้น → คืนส่วนเดียวที่เป็นตัวผังเองกับแผ่นจริง (ผู้เรียกจึงเขียนโค้ดชุดเดียวใช้ได้ทั้ง 2 แบบ)
   · ผัง 3 ขั้น → คืนทีละส่วน พร้อมแผ่นเสมือนและระยะเลื่อน (offset_mm) จากขอบแผ่น
   แผ่นเสมือน: ด้านที่ถูกตัดแบ่ง = size_mm ของส่วน (เป็น มม. เป๊ะ ไม่มีค่านิ้ว → ไม่มีค่าคลาดจากการปัด ซึ่งถูกต้อง
   เพราะส่วนถูกตัดจากแผ่นที่ปัดจากนิ้วไปแล้ว ไม่มีการปัดรอบสอง) · ด้านที่ไม่ถูกตัด = ของแผ่นจริง รวมค่านิ้ว
   (ต้องคงค่านิ้วไว้ ไม่งั้นชิ้นที่ยาวเต็มแผ่นในส่วนจะคิด fullLengthMm ผิด — 72 นิ้วต้องได้ 1828 ไม่ใช่ 1829) */
function partsOf(layout,sheet){
  const L=(layout&&typeof layout==='object')?layout:{};
  const secs=sectionsOf(L);
  if(!secs.length)return [{layout:L,sheet:sheet,size_mm:0,offset_mm:0,index:0,whole:true,vertical:true}];
  const vertical=L.split!==DIR_H;
  const S=(sheet&&typeof sheet==='object')?sheet:{};
  const out=[];let off=0;
  secs.forEach((s,i)=>{
    const size=Math.round(toNum(s&&s.size_mm)||0);
    const vs=vertical
      ?{w_mm:size,h_mm:posInt(S.h_mm),h_in:S.h_in}
      :{h_mm:size,w_mm:posInt(S.w_mm),w_in:S.w_in};
    out.push({layout:{direction:(s&&s.direction),strips:(s&&Array.isArray(s.strips))?s.strips:[]},
      sheet:vs,size_mm:size,offset_mm:off,index:i,whole:false,vertical:vertical});
    off+=size;
  });
  return out;
}
/* ความยาวของชิ้น "เต็มแผ่น" (มม.) — ตัวจริงตัวเดียวของทั้งแอป (ฟอร์มผัง · นำเข้า · ตัวตรวจผัง · ผัง SVG · test-task4.sql ต้องได้ค่าเดียวกัน)
   เจ้าของยืนยัน 13 ก.ย. 69: ชิ้นยาวตลอดแผ่นสูง 72 นิ้ว ยาวจริง 182.8 ซม. (ตรงกับเลข 182.8 ที่เขียนข้างรูป A41–A56)
   F1 = ปัดลง( นิ้วของด้านตามแนวแถบ × 25.4 ) — ชิ้นยาวกว่าแผ่นจริงไม่ได้ (72 นิ้ว = 1828.8 → 1828 · 84 → 2133 · 96 → 2438 · 120 → 3048)
        ด้านตามแนวแถบ: แนวตั้ง = สูง (h_in) · แนวนอน = กว้าง (w_in) · ทิศอื่น/ไม่ส่ง = แนวตั้ง (แบบเดียวกับ validatePattern)
        ไม่มีค่านิ้ว (ว่าง/0/ไม่ใช่ตัวเลข) → ใช้ มม. ของแผ่นด้านนั้นตรง ๆ (h_mm / w_mm) · ไม่มีทั้งคู่ = 0
   F2 ขนาดแผ่น (w_mm/h_mm) ไม่เปลี่ยน ยังปัดปกติ (72 นิ้ว = 1829) และใช้คิดค่าคลาดปัดเศษเหมือนเดิม — ฟังก์ชันนี้คือ "ความยาวชิ้น" ไม่ใช่ "ขนาดแผ่น"
   direction = 'แนวตั้ง'|'แนวนอน' หรือส่ง layout ({direction}) มาก็ได้
   +1e-9 กันเลขทศนิยมลอยของ 25.4 (เช่น นิ้วที่คูณแล้วควรลงตัวแต่ได้ ...999) ไม่ให้ถูกปัดลงผิด 1 มม. */
function fullLengthMm(sheet,direction){
  const s=(sheet&&typeof sheet==='object')?sheet:{};
  const dir=(direction&&typeof direction==='object')?direction.direction:direction;
  const vertical=dir!==DIR_H;
  const inch=toNum(vertical?s.h_in:s.w_in);
  if(isFinite(inch)&&inch>0)return Math.floor(inch*MM_PER_IN+1e-9);
  return posInt(vertical?s.h_mm:s.w_mm);
}
/* ทะเบียนชิ้นงาน: รับได้ทั้ง array [{id,…}] และ object {id:{…}} → Map */
function pieceMap(pieces){
  const m=new Map();
  if(Array.isArray(pieces))pieces.forEach(p=>{if(p&&idOf(p.id))m.set(idOf(p.id),p);});
  else if(pieces&&typeof pieces==='object')Object.keys(pieces).forEach(k=>{const p=pieces[k];if(p&&typeof p==='object')m.set(idOf(p.id||k),p);});
  return m;
}
const byStr=(a,b)=>a<b?-1:a>b?1:0;
/* ป้ายตัวเลขตามรูป ("43.05") ใช้ได้เฉพาะเมื่อเป็นตัวเลข ซม. ที่ต่างจาก size_mm ไม่เกิน 1 มม. — ไม่งั้นทิ้ง ใช้ค่าจาก มม. */
function labelOk(label,mm){
  /* รับเฉพาะสตริง/ตัวเลข (แบบ toNum) — ["43.05"] ห้ามถูกอ่านเป็น "43.05" (SQL ->> อ่านเป็น '["43.05"]' → คิดค่าคลาดไม่ตรงกัน) */
  if(typeof label!=='string'&&typeof label!=='number')return '';
  const s=String(label).trim();
  if(!/^\d{1,4}(\.\d{1,2})?$/.test(s))return '';
  return Math.abs(Number(s)*10-Number(mm))<=1?s:'';
}

/* ค่าคลาดจากการปัดเศษที่ยอมรับ (มม.) เมื่อเอาหลายค่ามาบวกกันแล้วเทียบกับขนาดแผ่น
   — เคาะแล้ว TASK 4 ① ทาง ค (13 ก.ย. 69): "ยอมคลาดเฉพาะค่าที่ถูกปัดจริง"
   ความยาวทั้งระบบเก็บ มม. จำนวนเต็ม · การปัดเกิดได้แค่ 2 แหล่ง:
   (1) ขนาดแผ่นแปลงจากนิ้ว: inchRoundErrMm(นิ้วของด้านที่เทียบ) = |round(นิ้ว×25.4) − นิ้ว×25.4| (≤ 0.5)
       ไม่มีค่านิ้ว (ว่าง/0/ไม่ใช่ตัวเลข) = 0 → ถือว่าแผ่นเป็น มม. เป๊ะ
   (2) ค่าที่รูปพิมพ์ละเอียดกว่า 1 มม.: labelRoundErrMm(label, size_mm) = |size_mm − label×10| (≤ 0.5)
       นับเฉพาะป้ายที่ใช้ได้ (labelOk) และ label×10 ไม่เป็นจำนวนเต็ม (เช่น "43.05" = 430.5 มม. เก็บ 431)
       ขนาดที่ไม่ใช่ มม. จำนวนเต็มบวก = 0 (ค่านั้นไม่ถูกเอามาบวกในผลรวมอยู่แล้ว)
   roundTolMm(นิ้ว, items) = ceil( (1) + Σ(2) ของ items − 1e-9 ) · items = ค่าที่เอามาบวก [{size_mm, label?}] (แถบ หรือ ชิ้นในแถบ)
   ตัวอย่าง: A41 แผ่น 120 นิ้ว (3048.0 เป๊ะ) + แถบป้าย 43.05 สองแถบ → ceil(0 + 0.5 + 0.5) = 1
             ชิ้น 92 มม. × 20 ไม่มีป้าย บนแผ่น 72 นิ้ว (1828.8 → 1829) → ceil(0.2) = 1 → รวม 1840 เกิน 11 = error
   ร่องตัด/เผื่อขอบไม่เกี่ยวกับค่านี้ · supabase/test-task4.sql (ข้อ 8–9) ใช้สูตรเดียวกันเป๊ะ */
function inchRoundErrMm(inch){
  const v=toNum(inch);if(!isFinite(v)||v<=0)return 0;
  const mm=v*MM_PER_IN;return Math.min(0.5,Math.abs(Math.round(mm)-mm));
}
function labelRoundErrMm(label,size_mm){
  const mm=posInt(size_mm);if(!mm)return 0;
  const s=labelOk(label,mm);if(!s)return 0;
  const l100=Math.round(Number(s)*100);      /* ป้าย ซม. ทศนิยม ≤ 2 ตำแหน่ง → ×100 = (มม.×10) จำนวนเต็ม — คิดเลขจำนวนเต็ม ไม่มีเศษทศนิยมลอย */
  if(l100%10===0)return 0;                    /* label×10 เป็นจำนวนเต็ม = ค่าเป็น มม. เต็มอยู่แล้ว ไม่ได้ถูกปัด */
  return Math.min(0.5,Math.abs(mm*10-l100)/10);
}
function roundTolMm(inch,items){
  let e=inchRoundErrMm(inch);
  (Array.isArray(items)?items:[]).forEach(x=>{if(x&&typeof x==='object')e+=labelRoundErrMm(x.label,x.size_mm);});
  return Math.max(0,Math.ceil(e-1e-9));
}

/* layout รูปแบบมาตรฐานสำหรับบันทึกลงฐาน — ตัดฟิลด์แปลกปลอมทิ้ง (เช่น piece_key ของไฟล์ seed) */
function normalizeLayout(layout){
  const L=(layout&&typeof layout==='object')?layout:{};
  /* แถบ → รูปมาตรฐาน · ⛔ ต้องมีคีย์ cuts เป็น array เสมอ ห้ามละคีย์
     (หน้าเว็บอ่าน s.cuts.map / s.cuts.length ตรง ๆ โดยไม่เช็คอยู่ ~20 จุด — ละคีย์ = TypeError ทั้งหน้า) */
  const stripOf=s=>{
    const o={size_mm:Math.round(toNum(s&&s.size_mm)||0)};
    if(s&&s.full_length===true)o.full_length=true;
    const sl=labelOk(s&&s.label,o.size_mm);if(sl)o.label=sl;
    o.cuts=cutsOf(s).map(c=>{
      const q={size_mm:Math.round(toNum(c&&c.size_mm)||0),piece_id:idOf(c&&c.piece_id)};
      const cl=labelOk(c&&c.label,q.size_mm);if(cl)q.label=cl;
      return q;});
    return o;};
  /* ผัง 3 ขั้น — เก็บ split + sections · ⛔ ไม่ใส่คีย์ strips ที่ราก
     (จงใจ: โค้ดเก่าที่ยังไม่รู้จัก sections จะได้ stripsOf() = [] แล้วฟ้องดัง ๆ แทนที่จะอ่านได้ครึ่งเดียวเงียบ ๆ)
     ส่วนซ้อนส่วนไม่ได้ — sections ที่อยู่ข้างในส่วนถูกตัดทิ้งตรงนี้ (ตัวตรวจผังจะฟ้องให้อีกชั้น) */
  if(isSplitLayout(L)){
    return {
      split:DIRECTIONS.includes(L.split)?L.split:DIR_V,
      sections:sectionsOf(L).map(sec=>({
        size_mm:Math.round(toNum(sec&&sec.size_mm)||0),
        direction:DIRECTIONS.includes(sec&&sec.direction)?sec.direction:DIR_V,
        strips:stripsOf(sec).map(stripOf)
      }))
    };
  }
  return {
    direction:DIRECTIONS.includes(L.direction)?L.direction:DIR_V,
    strips:stripsOf(L).map(stripOf)
  };
}
/* สร้าง layout ใหม่ที่เปลี่ยน piece_id ของทุกชิ้นด้วย fn(cut, stripIndex, cutIndex) — ขนาดตัดไม่แตะ
   ใช้ 2 งาน: ① นำเข้า seed: remapLayout(seed.layout, c=>idOfKey[c.piece_key])
              ② "🔗 รวมเข้ากับชิ้นอื่น": remapLayout(p.layout, c=>c.piece_id===fromId?toId:c.piece_id)
   fn คืน undefined/null = คงค่าเดิม · ผลลัพธ์ผ่าน normalizeLayout แล้ว */
function remapLayout(layout,fn){
  const L=(layout&&typeof layout==='object')?layout:{};
  /* fn(cut, stripIndex, cutIndex, sectionIndex) — sectionIndex = null เมื่อเป็นผัง 2 ขั้น
     (ผู้เรียกเดิมรับ 3 อาร์กิวเมนต์ ไม่พัง) · ⛔ ต้องเรียก fn กับ "ทุกชิ้น" รวมชิ้นที่อยู่ในส่วน
     ถ้าข้ามชิ้นในส่วน: นำเข้า seed จะได้ชิ้นที่ยังไม่มีรหัส GP · ปุ่ม 🔗 รวมชิ้น จะทิ้งชิ้นในส่วนไว้ที่รหัสเดิมที่เพิ่งถูกรวมทิ้ง */
  const doStrips=(arr,si)=>arr.map((s,i)=>Object.assign({},s,{cuts:cutsOf(s).map((c,j)=>{
    const r=typeof fn==='function'?fn(c||{},i,j,si):undefined;
    return Object.assign({},c,{piece_id:r==null?(c&&c.piece_id):r});})}));
  const tmp=isSplitLayout(L)
    ?{split:L.split,sections:sectionsOf(L).map((sec,k)=>Object.assign({},sec,{strips:doStrips(stripsOf(sec),k)}))}
    :{direction:L.direction,strips:doStrips(stripsOf(L),null)};
  return normalizeLayout(tmp);
}

/* ตำแหน่งชิ้นทุกใบในผัง เป็นมิลลิเมตรจากมุมล่างซ้ายของแผ่น — "ความจริงเส้นเดียว" ของคำถาม ชิ้นอยู่ตรงไหนในแผ่น
   ⛔ ตัววาดรูปทุกตัวต้องเรียกตัวนี้ ห้ามเขียนสูตรวางชิ้นชุดที่สอง
      (เดิมมี 2 ชุด: ผัง SVG ใน engine กับรูป PNG ส่งไลน์ในหน้าเว็บ → แก้ตัวหนึ่งลืมอีกตัว
       ผลคือรูปที่ส่งให้ร้านตัดกับผังที่เห็นบนจอไม่ตรงกันได้ ซึ่งแปลว่ากระจกตัดผิดจริง)
   คืน [{x_mm, yb_mm, w_mm, h_mm, cut, strip, part, si, ci}]
     x_mm  = ระยะจากขอบซ้ายของแผ่น ถึงขอบซ้ายของชิ้น
     yb_mm = ระยะจากขอบล่างของแผ่น ถึง "ขอบบน" ของชิ้น (แถบชิดขอบล่าง เศษอยู่บน — รูปแบบเดิมของตัววาด PNG)
     part  = ลำดับส่วน (ผัง 2 ขั้น = 0 เสมอ) · si = ลำดับแถบในส่วนนั้น · ci = ลำดับชิ้นในแถบ
   กติกาวางเหมือนเดิมทุกประการ: แนวตั้ง = แถบเรียงซ้าย→ขวา ชิ้นกองชิดขอบล่าง cut[0] อยู่บนสุด
                                แนวนอน = แถบเรียงชิดขอบล่าง strip[0] อยู่บนสุด ชิ้นเรียงซ้าย→ขวา */
function patternRects(layout,sheet){
  const out=[];
  const splitH=isSplitLayout(layout)&&layout.split===DIR_H;
  partsOf(layout,sheet).forEach(function(part,pi){
    const V=part.layout.direction!==DIR_H;
    const strips=stripsOf(part.layout);
    const sz=strips.map(s=>Math.max(0,toNum(s&&s.size_mm)||0));
    const cutSz=strips.map(s=>cutsOf(s).map(c=>Math.max(0,toNum(c&&c.size_mm)||0)));
    const cutSum=cutSz.map(a=>a.reduce((x,y)=>x+y,0));
    const stripSum=sz.reduce((a,b)=>a+b,0);
    /* ส่วนที่ถูกตัดแนวตั้ง = เลื่อนตามแกน x · ตัดแนวนอน = เลื่อนตามแกน y (วัดจากขอบล่างแผ่น) */
    const offX=part.whole?0:(splitH?0:part.offset_mm);
    const offY=part.whole?0:(splitH?part.offset_mm:0);
    if(V){
      let x=0;
      strips.forEach(function(s,si){
        let fromTop=0;
        cutsOf(s).forEach(function(c,ci){
          out.push({x_mm:offX+x,yb_mm:offY+cutSum[si]-fromTop,w_mm:sz[si],h_mm:cutSz[si][ci],
            cut:c,strip:s,part:pi,si:si,ci:ci});
          fromTop+=cutSz[si][ci];});
        x+=sz[si];});
    }else{
      let fromTop=0;
      strips.forEach(function(s,si){
        const top=stripSum-fromTop;let x=0;
        cutsOf(s).forEach(function(c,ci){
          out.push({x_mm:offX+x,yb_mm:offY+top,w_mm:cutSz[si][ci],h_mm:sz[si],
            cut:c,strip:s,part:pi,si:si,ci:ci});
          x+=cutSz[si][ci];});
        fromTop+=sz[si];});
    }
  });
  return out;
}

/* ==================== ส่วนที่ 1 — ผังตัด ==================== */

/* ผลผลิตต่อแผ่น = นับชิ้นตาม piece_id (รายการสต๊อก) · ชิ้นหมุนนับรวม · เรียงตาม piece_id
   ชิ้นที่ยังไม่ได้เลือก piece_id ไม่นับ (validatePattern จะฟ้องเป็น error ให้เอง) */
function patternYield(layout){
  const m=new Map();
  partsOf(layout).forEach(part=>stripsOf(part.layout).forEach(s=>cutsOf(s).forEach(c=>{
    const id=idOf(c&&c.piece_id);if(!id)return;
    m.set(id,(m.get(id)||0)+1);})));
  return [...m.keys()].sort(byStr).map(id=>({piece_id:id,qty:m.get(id)}));
}

/* % พื้นที่ชิ้นรวม ÷ พื้นที่แผ่น ทศนิยม 1 ตำแหน่ง (ชิ้น = กว้างแถบ × ขนาดตัด) — ข้อมูลประกอบเท่านั้น ไม่ใช่ตัวชี้วัด
   แผ่นไม่มีขนาด → 0 */
function patternUsedPct(layout,sheet){
  const {w,h}=sheetDims(sheet);if(!w||!h)return 0;
  let a=0;
  /* พื้นที่ชิ้น = กว้างแถบ × ขนาดตัด เหมือนเดิมทุกส่วน — ไม่ต้องคิดแกนเพราะเป็นการคูณพื้นที่
     ส่วนที่หารคือ "พื้นที่แผ่นจริง" เสมอ ไม่ใช่พื้นที่ของส่วน (ต้องบอกว่าใช้แผ่นไปกี่ % ไม่ใช่ใช้ส่วนไปกี่ %) */
  partsOf(layout,sheet).forEach(part=>stripsOf(part.layout).forEach(s=>{
    const sw=Math.max(0,toNum(s&&s.size_mm)||0);
    cutsOf(s).forEach(c=>{a+=sw*Math.max(0,toNum(c&&c.size_mm)||0);});}));
  return round1(a/(w*h)*100);
}

/* ขนาดที่ "ตัดจริง" ของแต่ละรายการสต๊อกในผัง → [{piece_id, w_mm, h_mm, key, name, qty}]
   w_mm = ด้านตามแนวกว้างแผ่น · h_mm = ด้านตามแนวสูงแผ่น · key/name เรียงด้านสั้นก่อน
   ใช้ในหน้า 📐 คอลัมน์ "อยู่ในแพทเทิร์น" (บอกว่าตัดจริงขนาดไหน เมื่อรวมสต๊อกแล้วขนาดตัดไม่เท่าขนาดสต๊อก) */
function patternCutSizes(layout){
  const m=new Map();
  /* ⛔ ทิศต้องอ่านจาก "ส่วน" ไม่ใช่จากรากผัง — แต่ละส่วนมีทิศแถบของตัวเอง
     ใส่ผิดจะเงียบมาก เพราะ pieceKey/pieceName เรียงด้านสั้นก่อน ชิ้นเกือบจัตุรัสจะถูกโดยบังเอิญ */
  partsOf(layout).forEach(part=>{
    const vertical=!(part.layout&&part.layout.direction===DIR_H);
    stripsOf(part.layout).forEach(s=>{const ss=Math.round(toNum(s&&s.size_mm)||0);
      cutsOf(s).forEach(c=>{const id=idOf(c&&c.piece_id);if(!id)return;
        const cs=Math.round(toNum(c&&c.size_mm)||0);
        const w=vertical?ss:cs,h=vertical?cs:ss,key=pieceKey(w,h),k=id+'|'+key;
        const cur=m.get(k);if(cur)cur.qty++;
        else m.set(k,{piece_id:id,w_mm:w,h_mm:h,key,name:pieceName(w,h),qty:1});});});
  });
  return [...m.values()].sort((a,b)=>byStr(a.piece_id,b.piece_id)||byStr(a.key,b.key));
}

/* ตรวจผัง → {ok, errors:[ไทย], infos:[ไทย]} · มี errors = ห้ามบันทึก · infos = ผ่านแต่ให้คนรู้
   layout = โครงข้างบน · sheet = {w_mm, h_mm} (แถว glass_sheet_sizes ส่งมาทั้งแถวได้)
   pieces = ทะเบียนชิ้นงาน [{id, a_mm, b_mm, rotatable, active}] (ส่งทั้งทะเบียน รวมที่ปิดใช้งาน) · rules = settings.glass_rules {kerf_mm, trim_mm}
   ตรวจ:
   · ทิศแถบ · แผ่นมีขนาด · มีแถบ · ทุกแถบมีชิ้น · ขนาดเป็น มม. จำนวนเต็ม > 0
   · แถบรวม + ร่องตัด×(จำนวนแถบ−1) + เผื่อขอบ×2 ไม่เกินแผ่น (แนวตั้งเทียบความกว้าง · แนวนอนเทียบความสูง)
   · ชิ้นในแต่ละแถบรวม + ร่องตัด×(จำนวนชิ้น−1) + เผื่อขอบ×2 ไม่เกินแผ่นอีกด้าน
     → เกินไม่เกิน roundTolMm(นิ้วของด้านแผ่นที่เทียบ, ค่าที่เอามาบวก) = info "เกินจากการปัดเศษ" · เกินกว่านั้น = error
       (sheet.w_in / sheet.h_in ไม่มี = แผ่นเป็น มม. เป๊ะ · ป้าย label ทศนิยม 2 ตำแหน่งของค่าที่บวก — ดูคอมเมนต์ roundTolMm)
   · แถบ "เต็มแผ่น" ต้องมีชิ้นเดียว · ชิ้นยาว = fullLengthMm(แผ่น, ทิศ) ผ่านเงียบ (F4 · เจ้าของยืนยัน 13 ก.ย. 69 — 72 นิ้ว = 1828)
     ยาวค่าอื่น → กติกาเดิม: ต่างจากแผ่น (มม.) ไม่เกิน roundTolMm(นิ้วด้านที่ซอย, ชิ้นนั้น) = ผ่าน · เกิน = error
   · piece_id ต้องมีในทะเบียน · ขนาดตัดต่างจากขนาดสต๊อก ≤ 2 มม. ต่อด้าน (CUT_STOCK_TOL_MM · เจ้าของเคาะ 13 ก.ย. 69) = info "ตัด … นับเป็นสต๊อก …" · เกิน = error (ต้องเป็นชิ้นแยก)
   · ชิ้นหมุนไม่ได้ (rotatable=false): ในทะเบียนถือว่า a_mm (ด้านสั้น) วางตามแนวกว้างแผ่น b_mm ตามแนวสูงแผ่น
     (อ่านชื่อ 47.5×87.5 แบบ กว้าง×สูง) — ถูกวางสลับด้าน (ขนาดที่วางใกล้ทิศกลับด้านมากกว่า) = error */
function validatePattern(layout,sheet,pieces,rules){
  const L=(layout&&typeof layout==='object')?layout:null;
  if(!L)return {ok:false,errors:['ยังไม่มีผังตัด'],infos:[]};
  /* ผัง 3 ขั้น (มีส่วน) → ตรวจรอยตัดแบ่งแผ่น แล้วตรวจแต่ละส่วนด้วยกติกาเดิมของผัง 2 ขั้น
     (ไม่เขียนกติกาชุดที่สอง — ส่วนคือแผ่นเล็ก จึงใช้ตัวตรวจตัวเดิมได้ทั้งก้อน) */
  if(isSplitLayout(L))return validateSplit(L,sheet,pieces,rules);
  return validateTwoStage(L,sheet,pieces,rules);
}

/* ตรวจผังแบ่งแผ่น (3 ขั้น) — เจ้าของเคาะ 21 ต.ค. 69 */
function validateSplit(L,sheet,pieces,rules){
  const errors=[],infos=[];
  if(Array.isArray(L.strips)&&L.strips.length)
    errors.push('ผังนี้มีทั้ง "แถบ" ที่ระดับแผ่น และ "ส่วน" พร้อมกัน — ต้องมีอย่างใดอย่างหนึ่งเท่านั้น');
  if(!DIRECTIONS.includes(L.split))
    errors.push('ทิศของรอยตัดแบ่งแผ่นต้องเป็น "'+DIR_V+'" หรือ "'+DIR_H+'"');
  const {w:W,h:H}=sheetDims(sheet);
  if(!W||!H)errors.push('ยังไม่มีขนาดแผ่น (กว้าง×สูง) — เลือกขนาดแผ่นของแพทเทิร์นนี้ก่อน');
  const secs=sectionsOf(L);
  if(secs.length<2)
    errors.push('ผังแบ่งแผ่นต้องมีอย่างน้อย 2 ส่วน — ถ้ามีส่วนเดียว ให้ใช้ผังแถบ→ซอย ธรรมดาแทน');
  const vertical=L.split!==DIR_H;
  const limit=vertical?W:H,word=vertical?'กว้าง':'สูง';
  const kerf=nonNeg(rules&&rules.kerf_mm),trim=nonNeg(rules&&rules.trim_mm);
  const sIn=(sheet&&typeof sheet==='object')?sheet:{};
  let sum=0,cnt=0;const items=[];
  secs.forEach((s,i)=>{
    const n=i+1;
    if(!s||typeof s!=='object'){errors.push('ส่วนที่ '+n+': ข้อมูลส่วนเสีย');return;}
    if(sectionsOf(s).length)
      errors.push('ส่วนที่ '+n+': แบ่งเป็นส่วนย่อยซ้อนอีกชั้นไม่ได้ (ผังลึกได้ไม่เกิน 3 ขั้น)');
    const ss=posInt(s.size_mm);
    if(!ss)errors.push('ส่วนที่ '+n+': '+word+'ของส่วนต้องเป็นมิลลิเมตรจำนวนเต็มมากกว่า 0');
    else{sum+=ss;cnt++;items.push({size_mm:ss});}
    if(!stripsOf(s).length)errors.push('ส่วนที่ '+n+': ยังไม่มีแถบในส่วนนี้');
  });
  /* ส่วนรวมไม่เกินแผ่น — สูตรเดียวกับแถบรวมของผัง 2 ขั้น (รวมร่องตัด/เผื่อขอบ และยอมค่าคลาดจากการปัดนิ้ว) */
  if(limit&&cnt){
    const tol=roundTolMm(vertical?sIn.w_in:sIn.h_in,items);
    const total=sum+kerf*Math.max(0,cnt-1)+2*trim,over=total-limit;
    const extra=(kerf||trim)?' (ส่วน '+numTxt(sum)+(kerf&&cnt>1?' + ร่องตัด '+numTxt(kerf)+'×'+(cnt-1):'')+(trim?' + เผื่อขอบ '+numTxt(trim)+'×2':'')+')':'';
    if(over>tol)errors.push('ส่วนรวม'+word+' '+numTxt(total)+' มม.'+extra+' เกินแผ่น '+limit+' มม. (เกิน '+numTxt(over)+' มม.)');
    else if(over>0)infos.push('ส่วนรวม'+word+' '+numTxt(total)+' มม. เกินแผ่น '+limit+' มม. อยู่ '+numTxt(over)+' มม. — เกินจากการปัดเศษ ยอมรับ (ยอมได้ไม่เกิน '+tol+' มม.)');
  }
  /* ตรวจข้างในแต่ละส่วนด้วยตัวตรวจเดิม บน "แผ่นเสมือน" ของส่วนนั้น */
  partsOf(L,sheet).forEach((part,i)=>{
    const r=validateTwoStage(part.layout,part.sheet,pieces,rules);
    r.errors.forEach(e=>errors.push('ส่วนที่ '+(i+1)+': '+e));
    r.infos.forEach(e=>infos.push('ส่วนที่ '+(i+1)+': '+e));
  });
  return {ok:errors.length===0,errors,infos};
}

function validateTwoStage(layout,sheet,pieces,rules){
  const errors=[],infos=[];
  const L=(layout&&typeof layout==='object')?layout:null;
  if(!L){errors.push('ยังไม่มีผังตัด');return {ok:false,errors,infos};}
  const dirOk=DIRECTIONS.includes(L.direction);
  if(!dirOk)errors.push('ทิศแถบต้องเป็น "'+DIR_V+'" หรือ "'+DIR_H+'"');
  const vertical=L.direction!==DIR_H;
  const {w:W,h:H}=sheetDims(sheet);
  const sheetOk=W>0&&H>0;
  if(!sheetOk)errors.push('ยังไม่มีขนาดแผ่น (กว้าง×สูง) — เลือกขนาดแผ่นของแพทเทิร์นนี้ก่อน');
  const raw=Array.isArray(L.strips)?L.strips:[];
  if(!raw.length)errors.push('ผังยังไม่มีแถบ — เพิ่มแถบอย่างน้อย 1 แถบ');
  const kerf=nonNeg(rules&&rules.kerf_mm),trim=nonNeg(rules&&rules.trim_mm);
  const across=vertical?W:H,along=vertical?H:W;      /* across = ด้านที่แถบเรียงกัน · along = ด้านที่ซอยชิ้น */
  const sIn=(sheet&&typeof sheet==='object')?sheet:{};
  const acrossIn=vertical?sIn.w_in:sIn.h_in,alongIn=vertical?sIn.h_in:sIn.w_in;   /* นิ้วของด้านเดียวกัน (ใช้คิดค่าคลาดจากการปัด) */
  const axisWord=vertical?'กว้าง':'สูง';
  const fullLen=fullLengthMm(sIn,vertical?DIR_V:DIR_H);   /* ความยาวชิ้นเต็มแผ่น (F1) — ไม่ใช่ขนาดแผ่น */
  const canSum=sheetOk&&dirOk;
  const pm=pieceMap(pieces);
  const missing=new Map(),noSize=new Set(),inactive=new Map(),rotated=new Map(),mismatch=new Map(),merged=new Map();
  const addStrip=(map,key,sn,extra)=>{const cur=map.get(key)||Object.assign({strips:[],n:0},extra||{});
    if(!cur.strips.includes(sn))cur.strips.push(sn);cur.n++;map.set(key,cur);};
  /* ส่วนขยายข้อความเมื่อมีร่องตัด/เผื่อขอบ ให้คนเห็นว่าตัวเลขรวมมาจากไหน */
  const extraTxt=(sum,cnt)=>(kerf||trim)?' (ชิ้น '+numTxt(sum)+(kerf&&cnt>1?' + ร่องตัด '+numTxt(kerf)+'×'+(cnt-1):'')+(trim?' + เผื่อขอบ '+numTxt(trim)+'×2':'')+')':'';
  const checkSum=(sum,cnt,limit,head,what,tol)=>{
    const total=sum+kerf*Math.max(0,cnt-1)+2*trim,over=total-limit;
    if(over>tol)errors.push(head+what+'รวม '+numTxt(total)+' มม.'+extraTxt(sum,cnt)+' เกินแผ่น '+limit+' มม. (เกิน '+numTxt(over)+' มม.)');
    else if(over>0)infos.push(head+what+'รวม '+numTxt(total)+' มม. เกินแผ่น '+limit+' มม. อยู่ '+numTxt(over)+' มม. — เกินจากการปัดเศษ '+numTxt(over)+' มม. ยอมรับ (ยอมได้ไม่เกิน '+tol+' มม.)');
  };
  let stripSum=0,stripCnt=0;
  const stripItems=[];   /* แถบที่เอามาบวก (ใช้คิดค่าคลาดจากป้าย) */
  raw.forEach((s,i)=>{
    const sn=i+1;
    if(!s||typeof s!=='object'){errors.push('แถบที่ '+sn+': ข้อมูลแถบเสีย');return;}
    const ss=posInt(s.size_mm);
    if(!ss)errors.push('แถบที่ '+sn+': ขนาดแถบต้องเป็นมิลลิเมตรจำนวนเต็มมากกว่า 0');
    else{stripSum+=ss;stripCnt++;stripItems.push(s);}
    const head='แถบที่ '+sn+(ss?' ('+axisWord+' '+cmTxt(ss)+' ซม.)':'')+': ';
    const cuts=Array.isArray(s.cuts)?s.cuts:[];
    if(!cuts.length)errors.push(head+'ยังไม่มีชิ้นในแถบ');
    let cutSum=0,cutCnt=0;
    const cutItems=[];   /* ชิ้นในแถบนี้ที่เอามาบวก */
    cuts.forEach((c,j)=>{
      const at='แถบที่ '+sn+' ชิ้นที่ '+(j+1)+': ';
      if(!c||typeof c!=='object'){errors.push(at+'ข้อมูลชิ้นเสีย');return;}
      const cs=posInt(c.size_mm);
      if(!cs)errors.push(at+'ขนาดชิ้นต้องเป็นมิลลิเมตรจำนวนเต็มมากกว่า 0');
      else{cutSum+=cs;cutCnt++;cutItems.push(c);}
      const id=idOf(c.piece_id);
      if(!id){errors.push(at+'ยังไม่ได้เลือกชิ้นงานจากทะเบียน');return;}
      const p=pm.get(id);
      if(!p){addStrip(missing,id,sn);return;}
      if(p.active===false)addStrip(inactive,id,sn,{name:pieceName(p.a_mm,p.b_mm)});
      const pa=posInt(p.a_mm),pb=posInt(p.b_mm);
      if(!pa||!pb){noSize.add(id);return;}
      if(!ss||!cs)return;
      /* ขนาดของชิ้นตามที่วางจริงในแผ่น: hx = ตามแนวกว้างแผ่น · vy = ตามแนวสูงแผ่น */
      const hx=vertical?ss:cs,vy=vertical?cs:ss;
      const dN=sizeDiffMm(hx,vy,pa,pb);   /* วางตามทะเบียน (a ตามแนวกว้าง) */
      const dR=sizeDiffMm(hx,vy,pb,pa);   /* วางสลับด้าน */
      const rot=p.rotatable!==false||!dirOk;
      const cutName=pieceName(hx,vy),stockName=pieceName(pa,pb);
      /* ชิ้นหมุนไม่ได้ที่วาง "ใกล้ทิศกลับด้านมากกว่าทิศตามทะเบียน" = วางสลับด้าน
         (รวมชิ้นเกือบจัตุรัส เช่น ทะเบียน 50×50.3 แต่วางกว้าง 50.3 สูง 50 — เดิมหลุดผ่านเป็น info ชื่อซ้ำกันอ่านงง) */
      if(!rot&&dR<dN&&dR<=CUT_STOCK_TOL_MM){addStrip(rotated,id,sn,{name:stockName});return;}
      const d=rot?Math.min(dN,dR):dN;
      if(d<=CUT_STOCK_TOL_MM){
        if(d>0)addStrip(merged,cutName+'|'+id,sn,{cut:cutName,stock:stockName,id});
        return;
      }
      addStrip(mismatch,cutName+'|'+id,sn,{cut:cutName,stock:stockName,id});
    });
    /* แถบ "เต็มแผ่น" = ชิ้นเดียวยาวตลอดแผ่น · ยาว = fullLengthMm ผ่านเงียบ (F4) · ค่าอื่นใช้ค่าคลาดปัดเศษกับขนาดแผ่นแบบเดิม */
    if(s.full_length===true){
      if(cuts.length!==1)errors.push(head+'ตั้งเป็น "เต็มแผ่น" ต้องมีชิ้นเดียว (ตอนนี้มี '+cuts.length+' ชิ้น)');
      else if(canSum&&cutCnt===1&&cutSum!==fullLen&&Math.abs(cutSum-along)>roundTolMm(alongIn,cutItems))
        errors.push(head+'ตั้งเป็น "เต็มแผ่น" แต่ชิ้นยาว '+cutSum+' มม. ไม่เท่าแผ่น '+along+' มม.'+
          (fullLen?' (ชิ้นเต็มแผ่นนี้ต้องยาว '+fullLen+' มม. = '+cmTxt(fullLen)+' ซม.)':''));
    }
    if(canSum&&cutCnt>0)checkSum(cutSum,cutCnt,along,head,'ชิ้นในแถบ',roundTolMm(alongIn,cutItems));
  });
  if(canSum&&stripCnt>0)checkSum(stripSum,stripCnt,across,'','แถบ',roundTolMm(acrossIn,stripItems));
  /* รวมข้อความที่ซ้ำหลายแถบเป็นบรรทัดเดียว */
  const stripsTxt=a=>'แถบที่ '+a.join(', ');
  missing.forEach((v,id)=>errors.push('ชิ้น '+id+' ไม่มีในทะเบียนชิ้นงาน ('+stripsTxt(v.strips)+')'));
  noSize.forEach(id=>errors.push('ชิ้น '+id+' ในทะเบียนไม่มีขนาด — แก้ที่หน้า 📐 ชิ้นงานก่อน'));
  rotated.forEach((v,id)=>errors.push('ชิ้น '+v.name+' ('+id+') ตั้งเป็น "หมุนไม่ได้" แต่ถูกวางสลับด้านกว้าง-ยาว ('+stripsTxt(v.strips)+') — หมุนไม่ได้ = ด้านสั้นต้องอยู่ตามแนวกว้างของแผ่นเสมอ'));
  mismatch.forEach(v=>errors.push('ตัด '+v.cut+' แต่นับเป็นสต๊อก '+v.stock+' ('+v.id+') — ต่างกันเกิน '+CUT_STOCK_TOL_MM+' มม. ('+stripsTxt(v.strips)+')'));
  /* ข้อความผ่าน (info) ไม่ใส่รหัส GP — คนอ่านเทียบกับรูปด้วยขนาด · ชื่อสต๊อกไม่ซ้ำกันอยู่แล้ว (คีย์ unique) */
  merged.forEach(v=>infos.push('ตัด '+v.cut+' นับเป็นสต๊อก '+v.stock+' · '+v.n+' ชิ้น'));
  inactive.forEach((v,id)=>infos.push('ชิ้น '+v.name+' ('+id+') ปิดใช้งานอยู่ในทะเบียน ('+stripsTxt(v.strips)+')'));
  return {ok:errors.length===0,errors,infos};
}

/* ==================== สีพื้นชิ้นในผัง ==================== */
function hashStr(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
/* สีประจำ piece_id (คงที่ทุกแพทเทิร์น) */
function pieceColor(piece_id){return PASTEL[hashStr(idOf(piece_id))%PASTEL.length];}
/* สีของทุกชิ้นในแพทเทิร์นเดียว → {piece_id: '#rrggbb'} · ใช้สีประจำ piece_id ก่อน
   ถ้าสองชิ้นในแผ่นเดียวกันได้สีชนกัน เลื่อนตัวหลัง (เรียงตาม piece_id) ไปสีถัดไป เพื่อให้แยกกลุ่มขนาดได้ด้วยตา
   หน้าเว็บใช้ฟังก์ชันนี้ทำชิปสีข้างรายการ "ชิ้นที่ได้" ให้ตรงกับสีใน SVG */
function patternColors(layout){
  const ids=[...new Set(partsOf(layout).flatMap(part=>
    stripsOf(part.layout).flatMap(s=>cutsOf(s).map(c=>idOf(c&&c.piece_id)).filter(Boolean))))].sort(byStr);
  const used=new Set(),out={},n=PASTEL.length;
  ids.forEach(id=>{let i=hashStr(id)%n,t=0;while(used.has(i)&&t<n){i=(i+1)%n;t++;}used.add(i);out[id]=PASTEL[i];});
  return out;
}

/* ==================== ผังตัด SVG ==================== */
/* ความกว้างโดยประมาณของข้อความ (หน่วยเท่าขนาดฟอนต์) — สระบน/ล่าง/วรรณยุกต์ไทยไม่กินที่ */
function estW(str,fs){
  let w=0;for(const ch of String(str)){const c=ch.charCodeAt(0);
    if(c===0x0E31||(c>=0x0E34&&c<=0x0E3A)||(c>=0x0E47&&c<=0x0E4E))continue;
    w+=ch===' '?0.3:(c>=0x0E00&&c<=0x0E7F)?0.62:(ch==='.'?0.3:0.58);}
  return w*fs;
}
const f2=n=>String(Math.round((Number(n)||0)*100)/100);
const safeColor=c=>(typeof c==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(c))?c:'';

/* renderPatternSVG(pattern, sheet, pieces, opts) → string '<svg …>…</svg>'
   pattern = {code, layout} (หรือส่ง layout ตรง ๆ ก็ได้) · sheet = {w_mm, h_mm, w_in?, h_in?}
   pieces  = ทะเบียนชิ้นงาน (ไม่บังคับ — ใช้ทำคำอธิบายเมื่อชี้ และทำชิ้นที่ไม่มีในทะเบียนเป็นสีเทา)
   opts    = {counts:{ใส:2,ชาดำ:3}, colors:[{key,name}] (settings.glass_colors), showCounts:true, showLegend:true, title, width,
              rules:{kerf_mm,trim_mm} (settings.glass_rules — กรอบแดงคิดร่องตัด/เผื่อขอบแบบเดียวกับ validatePattern),
              stripNumbers:true (วงกลมเลขแถบ 1..n ตรงกับแถวในฟอร์มผัง), highlightStrip:i (กรอบน้ำเงินรอบแถบที่กำลังแก้ · เริ่มที่ 0)}
   หน้าตาตามรูปเดิมของโรงงาน: รหัสตัวใหญ่ด้านบน · แถบเรียงจากซ้าย ชิ้นชิดขอบล่าง เศษขาวอยู่บน/ขวา
   · ใต้รูป = เส้นบอกความกว้างแถบ (ซม.) · ข้างซ้าย = ความสูงชิ้นของแถบแรก · แถบที่ซอยไม่เหมือนแถบแรก เขียนขนาดในชิ้น
   · ชิ้นยาวเต็มแผ่นเขียนความยาวในชิ้นจาก cut.size_mm ("ยาว 182.8" บนแผ่น 72 นิ้ว · F5) · ขนาดแผ่นเป็นนิ้วด้านบน/ขวา · ช่อง สีใส= / สีเขียว= / สีชาดำ= ด้านซ้าย
   · ชิ้นที่ล้นแผ่นเกินค่าปัดเศษ = กรอบแดงประ (พรีวิวสดตอนแก้ผังเห็นทันที)
   ไม่มีสคริปต์ · ไม่มี id (วางหลายรูปในหน้าเดียวได้) · ข้อความทุกตัวผ่าน esc · ไม่ throw แม้ข้อมูลเสีย */
function renderPatternSVG(pattern,sheet,pieces,opts){
  opts=opts||{};
  const pat=(pattern&&typeof pattern==='object')?pattern:{};
  const lay=(pat.layout&&typeof pat.layout==='object')?pat.layout:(Array.isArray(pat.strips)?pat:{});
  const code=String(opts.title!=null?opts.title:(pat.code||''));
  const vertical=lay.direction!==DIR_H;
  const num=v=>{const n=toNum(v);return isFinite(n)&&n>0?n:0;};
  const strips=stripsOf(lay).map(s=>({size:num(s&&s.size_mm),label:labelOk(s&&s.label,num(s&&s.size_mm)),full:!!(s&&s.full_length===true),
    cuts:cutsOf(s).map(c=>({size:num(c&&c.size_mm),label:labelOk(c&&c.label,num(c&&c.size_mm)),id:idOf(c&&c.piece_id)}))}));
  const pm=pieceMap(pieces),hasReg=pieces!=null;
  const colorMap=patternColors(lay);
  const stripSum=strips.reduce((a,s)=>a+s.size,0);
  const cutSums=strips.map(s=>s.cuts.reduce((a,c)=>a+c.size,0));
  const maxCut=cutSums.reduce((a,b)=>Math.max(a,b),0);
  /* ---- ผัง 3 ขั้น (sections) — ทางเดินแยก ไม่แตะทางของผัง 2 ขั้นเลยสักบรรทัด ----
     เหตุผล: รูปนี้คือสิ่งที่ส่งไลน์ให้ร้านตัดตาม ผิดแล้วเสียกระจกจริง
     จึงยอมเขียนซ้ำบางส่วน แลกกับการที่ผังเก่า 56 แบบ "เป็นไปไม่ได้" ที่จะเพี้ยน (เทส FX4 ตรึงแฮชไว้ทุกใบ) */
  const isSplit=isSplitLayout(lay);
  const splitV=lay.split!==DIR_H;                       /* ทิศของรอยตัดแบ่งแผ่นขั้นแรก */
  const parts=isSplit?partsOf(lay,sheet).map(p=>({
    off:p.offset_mm,size:p.size_mm,vert:p.layout.direction!==DIR_H,
    strips:stripsOf(p.layout).map(s=>({size:num(s&&s.size_mm),label:labelOk(s&&s.label,num(s&&s.size_mm)),full:!!(s&&s.full_length===true),
      cuts:cutsOf(s).map(c=>({size:num(c&&c.size_mm),label:labelOk(c&&c.label,num(c&&c.size_mm)),id:idOf(c&&c.piece_id)}))}))
  })):[];
  const partSum=parts.reduce((a,p)=>a+p.size,0);
  let {w:W,h:H}=sheetDims(sheet);
  const noSheet=!W||!H;
  const needX=isSplit?(splitV?partSum:W):(vertical?stripSum:maxCut);
  const needY=isSplit?(splitV?H:partSum):(vertical?maxCut:stripSum);
  if(noSheet){W=W||needX||2438;H=H||needY||1829;}
  const across=vertical?W:H,along=vertical?H:W;
  const extX=Math.max(W,needX),extY=Math.max(H,needY);
  const k=1000/Math.max(extX,extY,1);                 /* หน่วยวาดต่อ มม. — ด้านยาวสุดของรูป = 1000 หน่วย */
  const showCounts=opts.showCounts!==false,showLegend=opts.showLegend!==false;
  const showNums=opts.stripNumbers===true,hiStrip=Number.isInteger(opts.highlightStrip)?opts.highlightStrip:-1;
  const ruleO=(opts.rules&&typeof opts.rules==='object')?opts.rules:{};
  const kerfR=nonNeg(ruleO.kerf_mm),trimR=nonNeg(ruleO.trim_mm);
  /* ขนาดตัวอักษร (หน่วยวาด — ด้านยาวของแผ่น 1000 หน่วย) · ย่อรูปลงเหลือการ์ดกว้าง ~600 px ตัวเลขยังอ่านได้ */
  const DIMFS=28,INFS=26,SHEETFS=26,CNTFS=34,NOTEFS=20;
  /* เลขแถบ: แนวตั้งวางใต้เส้นบอกขนาด (เพิ่มขอบล่าง) · แนวนอนวางซ้ายเส้นบอกขนาด (เพิ่มขอบซ้าย) */
  const LP=showCounts?236:0,LD=122+(showNums&&!vertical?40:0),TT=code?108:28,TD=68,RD=146,BD=(showLegend?132:92)+(showNums&&vertical?46:0);
  const x0=LP+LD,top0=TT+TD,exW=extX*k,exH=extY*k;
  const sheetBottom=top0+exH,sheetTop=sheetBottom-H*k,sheetRight=x0+W*k;
  const VW=x0+exW+RD,VH=sheetBottom+BD;
  const INK='#1a2032',MUTED='#5c6478',BAD='#dc2626';
  const out=[];
  const FONT="Anuphan, 'Bai Jamjuree', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif";
  const HFONT="'Bai Jamjuree', Anuphan, 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif";
  out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+f2(VW)+' '+f2(VH)+'"'+
    (num(opts.width)?' width="'+f2(num(opts.width))+'"':'')+' preserveAspectRatio="xMidYMid meet" role="img"'+
    ' aria-label="'+esc('ผังตัด '+code)+'" font-family="'+esc(FONT)+'">');
  out.push('<rect x="0" y="0" width="'+f2(VW)+'" height="'+f2(VH)+'" fill="#ffffff"/>');
  const text=(x,y,str,fs,o)=>{o=o||{};
    out.push('<text x="'+f2(x)+'" y="'+f2(y)+'" font-size="'+f2(fs)+'" fill="'+(o.fill||INK)+'"'+
      (o.anchor?' text-anchor="'+o.anchor+'"':'')+(o.bold?' font-weight="700"':'')+(o.family?' font-family="'+esc(o.family)+'"':'')+
      (o.rot?' transform="rotate(-90 '+f2(x)+' '+f2(y)+')"':'')+' dy="0.35em">'+esc(str)+'</text>');};
  const line=(x1,y1,x2,y2,stroke,sw,dash)=>out.push('<line x1="'+f2(x1)+'" y1="'+f2(y1)+'" x2="'+f2(x2)+'" y2="'+f2(y2)+'" stroke="'+stroke+'" stroke-width="'+f2(sw)+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>');
  const tick=(x,y)=>line(x-6,y+6,x+6,y-6,INK,1.6);
  const labelBg=(cx,cy,str,fs,fill)=>{const w=estW(str,fs)+8,h=fs+6;
    out.push('<rect x="'+f2(cx-w/2)+'" y="'+f2(cy-h/2)+'" width="'+f2(w)+'" height="'+f2(h)+'" fill="#ffffff"/>');
    text(cx,cy,str,fs,{anchor:'middle',fill:fill||INK});};
  /* เส้นบอกขนาดแนวนอน/แนวตั้ง (ขีดเฉียงที่ปลายแบบรูปเดิม · ตัวเลขทับกลางเส้นบนพื้นขาว) */
  const dimH=(x1,x2,y,str,base,fill)=>{line(x1,y,x2,y,MUTED,1.3);tick(x1,y);tick(x2,y);
    if(!str)return;const fs=Math.max(9,Math.min(base,(Math.abs(x2-x1)-6)/Math.max(estW(str,1),0.1)));labelBg((x1+x2)/2,y,str,fs,fill);};
  const dimV=(x,y1,y2,str,base,fill)=>{line(x,y1,x,y2,MUTED,1.3);tick(x,y1);tick(x,y2);
    if(!str)return;const fs=Math.max(9,Math.min(base,Math.abs(y2-y1)-4));labelBg(x,(y1+y2)/2,str,fs,fill);};
  const cmLbl=(mm,label)=>label||cmFixed(mm);
  /* ---- กรอบแผ่น (พื้นขาว = เศษ) ---- */
  out.push('<rect x="'+f2(x0)+'" y="'+f2(sheetTop)+'" width="'+f2(W*k)+'" height="'+f2(H*k)+'" fill="#ffffff" stroke="'+INK+'" stroke-width="2"/>');
  /* ---- ชิ้น ---- */
  /* ค่าคลาดจากการปัด — roundTolMm ตัวเดียวกับ validatePattern (นิ้วของด้านที่เทียบ + ป้ายทศนิยม 2 ตำแหน่งของค่าที่บวก) */
  const sIn=(sheet&&typeof sheet==='object')?sheet:{};
  const acrossIn=vertical?sIn.w_in:sIn.h_in,alongIn=vertical?sIn.h_in:sIn.w_in;
  const tolItems=list=>list.map(x=>({size_mm:x.size,label:x.label}));
  const tolS=roundTolMm(acrossIn,tolItems(strips)),nS=strips.length;
  const rects=[];   /* {x,y,w,h,cut,strip,si,ci,bad} */
  const sboxes=[];  /* กรอบของแต่ละแถบ (ใช้วาดเลขแถบ/ไฮไลต์) */
  const splitLines=[];  /* รอยตัดแบ่งแผ่นขั้นแรก (ผัง 3 ขั้น) — วาดเป็นเส้นหนาให้ร้านเห็นว่าตัดอะไรก่อน */
  /* ---- วางชิ้นของผัง 3 ขั้น: ไล่ทีละส่วน แล้วใช้กติกาเดิมของผัง 2 ขั้นภายในส่วนนั้น ----
     ส่วนคือ "แผ่นเล็ก": ชิ้นชิดขอบล่างของส่วน · เศษอยู่บน/ขวาของส่วน (กติกาเดียวกับแผ่นจริง) */
  if(isSplit){
    parts.forEach((P,pi)=>{
      /* มุมล่างซ้ายของส่วนนี้ (หน่วยวาด) และขนาดของส่วน (มม.) */
      const pxMm=splitV?P.off:0, pyMm=splitV?0:P.off;             /* ระยะจากขอบซ้าย / ขอบล่างของแผ่น */
      const pwMm=splitV?P.size:W, phMm=splitV?H:P.size;
      const px=x0+pxMm*k, pBottom=sheetBottom-pyMm*k;
      const pAcross=P.vert?pwMm:phMm, pAlong=P.vert?phMm:pwMm;    /* ด้านที่แถบเรียงกัน / ด้านที่ซอยชิ้น */
      const pStripSum=P.strips.reduce((a,s)=>a+s.size,0);
      const pCutSums=P.strips.map(s=>s.cuts.reduce((a,c)=>a+c.size,0));
      if(pi>0){                                                   /* รอยตัดแบ่งแผ่นก่อนหน้าส่วนนี้ */
        if(splitV)splitLines.push({x1:px,y1:sheetTop,x2:px,y2:sheetBottom});
        else splitLines.push({x1:x0,y1:pBottom,x2:x0+W*k,y2:pBottom});
      }
      if(P.vert){
        let xmm=0;
        P.strips.forEach((s,si)=>{const S=pCutSums[si],n=s.cuts.length;let fromTop=0;
          const stripBad=xmm+s.size>pAcross+tolS;
          sboxes.push({x:px+xmm*k,y:pBottom-Math.max(phMm,S)*k,w:s.size*k,h:Math.max(phMm,S)*k,part:pi,sn:si});
          s.cuts.forEach((c,ci)=>{const topFromBottom=S-fromTop;
            rects.push({x:px+xmm*k,y:pBottom-topFromBottom*k,w:s.size*k,h:c.size*k,wmm:s.size,hmm:c.size,
              cut:c,strip:s,si:sboxes.length-1,ci,part:pi,bad:stripBad||S>pAlong+1});
            fromTop+=c.size;});
          xmm+=s.size;});
      }else{
        let fromTop=0;
        P.strips.forEach((s,si)=>{const S=pCutSums[si];const topFromBottom=pStripSum-fromTop;let xmm=0;
          const stripBad=pStripSum>pAcross+tolS;
          sboxes.push({x:px,y:pBottom-topFromBottom*k,w:Math.max(pwMm,S)*k,h:s.size*k,part:pi,sn:si});
          s.cuts.forEach((c,ci)=>{
            rects.push({x:px+xmm*k,y:pBottom-topFromBottom*k,w:c.size*k,h:s.size*k,wmm:c.size,hmm:s.size,
              cut:c,strip:s,si:sboxes.length-1,ci,part:pi,bad:stripBad||S>pAlong+1});
            xmm+=c.size;});
          fromTop+=s.size;});
      }
    });
  }else
  /* ล้นแผ่น = ระยะถึงปลายชิ้น + ร่องตัดที่ผ่านมา + เผื่อขอบ 2 ข้าง เกินแผ่นเกินค่าปัดเศษ — สูตรเดียวกับ checkSum ใน validatePattern
     (ร่องตัด/เผื่อขอบ = 0 ได้ผลเท่าเดิมทุกประการ) */
  if(vertical){
    let xmm=0;
    strips.forEach((s,si)=>{const S=cutSums[si],n=s.cuts.length,tolC=roundTolMm(alongIn,tolItems(s.cuts));let fromTop=0;
      const stripBad=trimR+xmm+kerfR*si+s.size+trimR>across+tolS;
      sboxes.push({x:x0+xmm*k,y:Math.min(sheetTop,sheetBottom-S*k),w:s.size*k,h:Math.max(H,S)*k});
      s.cuts.forEach((c,ci)=>{const topFromBottom=S-fromTop;
        rects.push({x:x0+xmm*k,y:sheetBottom-topFromBottom*k,w:s.size*k,h:c.size*k,wmm:s.size,hmm:c.size,cut:c,strip:s,si,ci,
          bad:stripBad||trimR+topFromBottom+kerfR*Math.max(0,n-1-ci)+trimR>along+tolC});
        fromTop+=c.size;});
      xmm+=s.size;});
  }else{
    let fromTop=0;
    strips.forEach((s,si)=>{const topFromBottom=stripSum-fromTop,tolC=roundTolMm(alongIn,tolItems(s.cuts));let xmm=0;
      const stripBad=trimR+topFromBottom+kerfR*Math.max(0,nS-1-si)+trimR>across+tolS;
      sboxes.push({x:x0,y:sheetBottom-topFromBottom*k,w:Math.max(W,cutSums[si])*k,h:s.size*k});
      s.cuts.forEach((c,ci)=>{
        rects.push({x:x0+xmm*k,y:sheetBottom-topFromBottom*k,w:c.size*k,h:s.size*k,wmm:c.size,hmm:s.size,cut:c,strip:s,si,ci,
          bad:stripBad||trimR+xmm+kerfR*ci+c.size+trimR>along+tolC});
        xmm+=c.size;});
      fromTop+=s.size;});
  }
  let anyBad=false,anyUnknown=false;
  rects.forEach(r=>{
    const id=r.cut.id,p=id?pm.get(id):null,unknown=!id||(hasReg&&!p);
    if(unknown)anyUnknown=true;if(r.bad)anyBad=true;
    const fill=unknown?'#e5e7eb':(colorMap[id]||pieceColor(id));
    const tip=(id||'ยังไม่ได้เลือกชิ้นงาน')+' · ตัด '+pieceName(r.wmm,r.hmm)+' ซม.'+
      (p&&pieceKey(p.a_mm,p.b_mm)!==pieceKey(r.wmm,r.hmm)?' · นับเป็นสต๊อก '+pieceName(p.a_mm,p.b_mm):'')+
      (hasReg&&id&&!p?' · ไม่มีในทะเบียน':'');
    out.push('<rect x="'+f2(r.x)+'" y="'+f2(r.y)+'" width="'+f2(r.w)+'" height="'+f2(r.h)+'" fill="'+fill+'"'+
      (r.bad?' stroke="'+BAD+'" stroke-width="3" stroke-dasharray="8 5"':' stroke="'+INK+'" stroke-width="1.4"')+
      '><title>'+esc(tip)+'</title></rect>');
  });
  /* เส้นขอบแผ่นซ้ำด้านบนสุด ให้คมเหมือนรูปเดิม */
  out.push('<rect x="'+f2(x0)+'" y="'+f2(sheetTop)+'" width="'+f2(W*k)+'" height="'+f2(H*k)+'" fill="none" stroke="'+INK+'" stroke-width="3"/>');
  /* แถบที่กำลังแก้ในฟอร์ม = กรอบน้ำเงินหนา (ทับเส้นชิ้น ไม่ทับตัวเลข) */
  const ACC='#2563eb';
  if(hiStrip>=0&&sboxes[hiStrip]){const b=sboxes[hiStrip];
    out.push('<rect x="'+f2(b.x)+'" y="'+f2(b.y)+'" width="'+f2(b.w)+'" height="'+f2(b.h)+'" fill="none" stroke="'+ACC+'" stroke-width="7"/>');}
  /* ---- ตัวเลขในชิ้น: ชิ้นยาวเต็มแผ่น (เขียนความยาว) · แถบที่ซอยต่างจากแถบอ้างอิง ---- */
  const refIdx=vertical?0:strips.length-1;                  /* แถบที่ติดเส้นบอกขนาด (ซ้ายสุด / ล่างสุด) */
  const seq=s=>s?s.cuts.map(c=>c.size+'/'+c.label).join(','):'';
  const refSeq=seq(strips[refIdx]);
  /* ชิ้นเต็มแผ่นที่ไม่ได้ติ๊ก full_length: ยาวใกล้ fullLengthMm (F1) หรือใกล้ขนาดแผ่น ≤ 1 มม. · ตัวเลขที่เขียน = cut.size_mm เสมอ (F5) */
  const fullLenS=noSheet?0:fullLengthMm(sheet,vertical?DIR_V:DIR_H);
  const inLabel=(r,str)=>{const tw=estW(str,1);if(!tw)return;
    const fsH=Math.min(INFS,(r.w-8)/tw,r.h-6),fsV=Math.min(INFS,(r.h-8)/tw,r.w-6);
    if(fsH>=11||(fsH>=fsV&&fsH>=8))text(r.x+r.w/2,r.y+r.h/2,str,fsH,{anchor:'middle'});
    else if(fsV>=8)text(r.x+r.w/2,r.y+r.h/2,str,fsV,{anchor:'middle',rot:true});};
  if(isSplit){
    /* ผัง 3 ขั้น: ไม่มี "แถบอ้างอิง" ที่ติดขอบแผ่นให้เขียนโซ่บอกขนาดได้ (ส่วนที่ 2 ขึ้นไปไม่ติดขอบ)
       → เขียนขนาดครบ 2 ด้านในชิ้นทุกใบแทน ห้ามปล่อยชิ้นไหนไม่มีตัวเลข (ร้านต้องตัดตามได้จากรูปนี้) */
    rects.forEach(r=>inLabel(r,cmLbl(r.wmm,null)+'×'+cmLbl(r.hmm,null)));
  }else rects.forEach(r=>{
    const full=r.strip.cuts.length===1&&(r.strip.full||Math.abs(r.cut.size-along)<=1||(fullLenS>0&&Math.abs(r.cut.size-fullLenS)<=1));
    if(full)inLabel(r,'ยาว '+cmLbl(r.cut.size,r.cut.label));
    else if(r.si!==refIdx&&seq(r.strip)!==refSeq)inLabel(r,cmLbl(r.cut.size,r.cut.label));
  });
  /* ---- รอยตัดแบ่งแผ่นขั้นแรก (ผัง 3 ขั้น) — เส้นหนาสีเข้ม + ป้ายบอกระยะ ให้ร้านเห็นว่าต้องตัดอะไรก่อน ---- */
  if(isSplit&&splitLines.length){
    splitLines.forEach(L=>out.push('<line x1="'+f2(L.x1)+'" y1="'+f2(L.y1)+'" x2="'+f2(L.x2)+'" y2="'+f2(L.y2)+
      '" stroke="'+INK+'" stroke-width="6"/>'));
    let acc=0;
    parts.forEach((P,i)=>{acc+=P.size;if(i===parts.length-1)return;
      const s='ตัดแบ่งที่ '+cmFixed(acc);
      if(splitV)labelBg(x0+acc*k,sheetTop-18,s,DIMFS*0.8,INK);
      else labelBg(x0+40+estW(s,DIMFS*0.8)/2,sheetBottom-acc*k,s,DIMFS*0.8,INK);
    });
  }
  /* ---- เส้นบอกขนาดชิ้น (ซม.) ---- */
  const dimY=sheetBottom+44,dimX=x0-56;
  const extLine=(x,y1,y2)=>line(x,y1,x,y2,'#9aa1b1',1);
  const extLineH=(y,x1,x2)=>line(x1,y,x2,y,'#9aa1b1',1);
  if(isSplit){
    /* โซ่บอกขนาดของผัง 3 ขั้น = ความกว้าง/สูงของแต่ละ "ส่วน" (ขนาดในชิ้นเขียนครบแล้วข้างบน) */
    let acc=0;
    parts.forEach((P,i)=>{
      if(splitV){const a=x0+acc*k,b=a+P.size*k;
        extLine(a,sheetBottom+4,dimY+8);if(i===parts.length-1)extLine(b,sheetBottom+4,dimY+8);
        dimH(a,b,dimY,cmFixed(P.size),DIMFS,rects.some(r=>r.part===i&&r.bad)?BAD:INK);
      }else{const yBot=sheetBottom-acc*k,yTop=yBot-P.size*k;
        extLineH(yBot,dimX-8,x0-4);if(i===parts.length-1)extLineH(yTop,dimX-8,x0-4);
        dimV(dimX,yTop,yBot,cmFixed(P.size),DIMFS,rects.some(r=>r.part===i&&r.bad)?BAD:INK);}
      acc+=P.size;});
  }else if(vertical){
    /* ใต้รูป = ความกว้างแถบ */
    let xmm=0;strips.forEach((s,si)=>{const a=x0+xmm*k,b=a+s.size*k;
      extLine(a,sheetBottom+4,dimY+8);if(si===strips.length-1)extLine(b,sheetBottom+4,dimY+8);
      dimH(a,b,dimY,cmLbl(s.size,s.label),DIMFS,rects.some(r=>r.si===si&&r.bad)?BAD:INK);xmm+=s.size;});
    /* ข้างซ้าย = ความสูงชิ้นของแถบแรก */
    rects.filter(r=>r.si===refIdx).forEach((r,i,arr)=>{
      extLineH(r.y,dimX-8,x0-4);if(i===arr.length-1)extLineH(r.y+r.h,dimX-8,x0-4);
      dimV(dimX,r.y,r.y+r.h,cmLbl(r.cut.size,r.cut.label),DIMFS,r.bad?BAD:INK);});
  }else{
    /* ข้างซ้าย = ความสูงแถบ */
    let fromTop=0;strips.forEach((s,si)=>{const yTop=sheetBottom-(stripSum-fromTop)*k,yBot=yTop+s.size*k;
      extLineH(yTop,dimX-8,x0-4);if(si===strips.length-1)extLineH(yBot,dimX-8,x0-4);
      dimV(dimX,yTop,yBot,cmLbl(s.size,s.label),DIMFS,rects.some(r=>r.si===si&&r.bad)?BAD:INK);fromTop+=s.size;});
    /* ใต้รูป = ความกว้างชิ้นของแถบล่างสุด */
    rects.filter(r=>r.si===refIdx).forEach((r,i,arr)=>{
      extLine(r.x,sheetBottom+4,dimY+8);if(i===arr.length-1)extLine(r.x+r.w,sheetBottom+4,dimY+8);
      dimH(r.x,r.x+r.w,dimY,cmLbl(r.cut.size,r.cut.label),DIMFS,r.bad?BAD:INK);});
  }
  /* ---- เลขแถบ 1..n (ตรงกับแถวในฟอร์มผัง) ---- */
  if(showNums&&isSplit)sboxes.forEach(b=>{
    /* ผัง 3 ขั้น: เลขเป็น "ส่วน-แถบ" เช่น 1-1 1-2 2-1 · วางมุมซ้ายบนในแผ่น ไม่ใช่ใต้รูป
       (แถบย่อยของหลายส่วนตกที่พิกัดเดียวกันถ้าวางใต้รูป · และที่ว่างใต้รูปไม่พอใส่หลายแถว) */
    const lb=(b.part+1)+'-'+(b.sn+1);
    const cx=b.x+19,cy=b.y+19;
    out.push('<rect x="'+f2(cx-17)+'" y="'+f2(cy-13)+'" width="'+f2(34)+'" height="'+f2(26)+'" rx="8" fill="#e8efff" stroke="'+ACC+'" stroke-width="2"/>');
    text(cx,cy,lb,15,{anchor:'middle',bold:true,fill:ACC});
  });
  else if(showNums)sboxes.forEach((b,si)=>{
    const cx=vertical?b.x+b.w/2:x0-116,cy=vertical?sheetBottom+96:b.y+b.h/2,on=si===hiStrip;
    /* opts.stripLabels[si] = เลขแถวในฟอร์ม (ฟอร์มข้ามแถวที่อ่านไม่ออก เลขวงกลมต้องยังตรงกับแถวในฟอร์ม) · ไม่ส่ง = 1..n */
    const lb=(Array.isArray(opts.stripLabels)&&opts.stripLabels[si]!=null)?String(opts.stripLabels[si]):String(si+1);
    out.push('<circle cx="'+f2(cx)+'" cy="'+f2(cy)+'" r="17" fill="'+(on?ACC:'#e8efff')+'" stroke="'+ACC+'" stroke-width="2"/>');
    text(cx,cy,lb,lb.length>1?17:21,{anchor:'middle',bold:true,fill:on?'#ffffff':ACC});
  });
  /* ---- ขนาดแผ่น (นิ้ว) รอบนอก: บน = กว้าง · ขวา = สูง ----
     ไม่มี w_in/h_in → คิดย้อนจาก มม. แล้วปัดเป็นครึ่งนิ้วที่ใกล้สุด (2438 มม. = 95.98 → 96) ไม่โชว์เลขเพี้ยนจากการปัด มม. */
  if(!noSheet){
    const wIn=num(sheet&&sheet.w_in)||Math.round(W/MM_PER_IN*2)/2,hIn=num(sheet&&sheet.h_in)||Math.round(H/MM_PER_IN*2)/2;
    const topY=top0-32,rightX=x0+exW+64;
    extLine(x0,topY-8,sheetTop-4);extLine(sheetRight,topY-8,sheetTop-4);
    dimH(x0,sheetRight,topY,numTxt(wIn)+' นิ้ว',SHEETFS,MUTED);
    extLineH(sheetTop,sheetRight+4,rightX+8);extLineH(sheetBottom,sheetRight+4,rightX+8);
    dimV(rightX,sheetTop,sheetBottom,numTxt(hIn)+' นิ้ว',SHEETFS,MUTED);
  }
  /* ---- รหัสแพทเทิร์นตัวใหญ่ด้านบน ---- */
  if(code)text(x0+exW/2,TT/2+6,code,Math.min(64,Math.max(28,(exW-20)/Math.max(estW(code,1),0.1))),{anchor:'middle',bold:true,family:HFONT});
  /* ---- ช่อง สีใส= / สีเขียว= / สีชาดำ= ด้านซ้าย ---- */
  if(showCounts){
    const list=(Array.isArray(opts.colors)&&opts.colors.length?opts.colors:DEFAULT_COLORS)
      .filter(c=>c&&c.key!=null&&c.active!==false).slice(0,8);
    const counts=(opts.counts&&typeof opts.counts==='object')?opts.counts:{};
    const rowH=CNTFS*2.2,cy=(sheetTop+sheetBottom)/2,y1=cy-(list.length-1)*rowH/2;
    list.forEach((c,i)=>{const y=y1+i*rowH,nm=String(c.name||('สี'+c.key))+'=';
      const fs=Math.min(CNTFS,(LP-80)/Math.max(estW(nm,1),0.1));
      text(14,y,nm,fs,{bold:true});
      const vx=14+estW(nm,fs)+8,n=Number(counts[c.key]);
      if(isFinite(n)&&n>0)text(vx,y,numTxt(n),CNTFS,{bold:true});
      else line(vx,y+fs*0.55,Math.min(LP-8,vx+50),y+fs*0.55,MUTED,1.5);
    });
  }
  /* ---- คำอธิบายหน่วย / คำเตือน ---- */
  if(showLegend){
    const notes=['ขนาดชิ้นเป็น ซม. · ขนาดแผ่นเป็นนิ้ว'+(showNums?' · วงกลม = ลำดับแถบ':'')];
    text(x0,VH-22,notes.join(''),NOTEFS,{fill:MUTED});
    const warns=[];
    if(noSheet)warns.push('ยังไม่มีขนาดแผ่น');
    if(anyBad)warns.push('กรอบแดงประ = ชิ้นล้นแผ่น');
    if(anyUnknown)warns.push('สีเทา = ยังไม่ได้เลือกชิ้นจากทะเบียน');
    if(warns.length)text(x0+exW+RD-10,VH-22,warns.join(' · '),NOTEFS,{fill:BAD,anchor:'end'});
  }
  out.push('</svg>');
  return out.join('');
}

/* ==================== ส่วนที่ 2 — ทางเลือกการสั่ง (TASK 5) ====================
   computeNeeds · computeOptions · applyLines · explain → เขียนต่อตรงนี้ แล้วเพิ่มชื่อลงใน API ข้างล่าง
   ใช้ patternYield() ของส่วนที่ 1 เป็นผลผลิตต่อแผ่น (ห้ามนับชิ้นเองซ้ำอีกชุด)

   ข้อมูลเข้า (แถวจากฐานตรง ๆ):
     input = {stock:[{piece_id,color,onhand}], pieces:[glass_pieces], patterns:[glass_patterns], sheets:[glass_sheets],
              sizes:[glass_sheet_sizes], colors:settings.glass_colors, rules:settings.glass_rules}
   ความหมายของระดับสต๊อก (ต่อชิ้นต่อสี · levels[สี] = {min,max}):
     L1 ไม่มี levels[สี]      = "ยังไม่ได้ตั้งระดับ" → ไม่คิดว่าขาด · ผลิตออกมา = ชิ้นเกิน (ไม่นับทะลุเพดาน) + เตือน
     L2 min=0 max=0           = "ไม่ใช้ชิ้นนี้ในสีนี้" → ผลิตออกมา = ทะลุเพดาน (เพดาน 0)
     L3 onhand < min          = ขาด · need = min − onhand · ยอดคงเหลือที่ไม่ได้ส่งมา = 0 + เตือน
   ทะลุเพดาน (violation) = ชิ้นที่ "ทางเลือกนี้ผลิต" (produced > 0) และ onhand + produced > max (ของที่เกินอยู่แล้วแต่ไม่ได้สั่งเพิ่ม ไม่นับ)
   ชิ้นเกิน (excess)    = produced − need (ไม่ติดลบ) · ชิ้นที่ไม่ได้ขาดนับเกินทั้งหมด · พื้นที่ = a_mm × b_mm (มม.² จำนวนเต็ม) → ตร.ฟุต ด้วย MM2_PER_SQFT
   กุญแจเรียง (CLAUDE.md): ทะลุเพดาน (รายการ) → ราคารวม → พื้นที่ชิ้นเกิน → จำนวนรายการ (แพทเทิร์น×สี) → แผ่นรวม → รหัสแพทเทิร์น (เรียงแบบตัวเลขในรหัส A2 < A10)

   ⭐ เพดานเป็น "เส้นห้ามข้าม" (เจ้าของสั่ง 28 ก.ย. 69 — ใช้จริงแล้วเจอว่าระบบเสนอสั่งเยอะเกินจริงเพราะยัดของที่ล้นเพดานมาด้วย):
     cap (เพดานที่ยืดได้) = floor( max × (100 + over_pct) / 100 ) ต่อ ชิ้น×สี · ตั้งที่ settings.glass_rules.over_pct (ตั้งต้น 20 · 0–100)
     · ใช้เฉพาะชิ้นที่ "ตั้งระดับแล้วและ max > 0" — ชิ้นที่ยังไม่ตั้งระดับ และชิ้น max = 0 ("ไม่ใช้ชิ้นนี้ในสีนี้") ไม่มี cap เหมือนเดิม
       (ถ้าบังคับ cap = 0 กับชิ้น max = 0 ด้วย แพทเทิร์นที่มีชิ้นนั้นติดมาจะถูกตัดทิ้งทั้งแบบ จนสั่งอะไรไม่ได้เลย — เจ้าของสั่งไว้ว่า max>0)
     · ทางเลือกที่ระบบเสนอ ห้ามทำให้ชิ้นไหน after > cap (ตัดทิ้งตั้งแต่ตอนค้น ทุกกลุ่ม: เดียว/คู่/สาม/ไล่ครบ/greedy/ขั้นปรับปรุง)
     · ไม่มีทางไหนทั้ง "ครบขั้นต่ำ" และ "ไม่เกิน cap" → เสนอทางที่ไม่เกิน cap โดยยอมให้ยังขาด (complete=false) เรียง ขาดน้อยสุด → กุญแจเดิม
     · ช่วง max < after ≤ cap = "ยืดเพดาน" (stretch_list / stretched) ห้ามเรียกว่าทะลุเพดาน · after > cap = over_cap_list (โหมดปรับมือเท่านั้น)
     · violation_list / violations ยังแปลว่า "เกิน max" เหมือนเดิม (ของเดิมทั้งแอปอ่านค่านี้) = stretched + over_cap + no_cap
       (no_cap = ชิ้นเพดาน 0 "ไม่ใช้ชิ้นนี้ในสีนี้" ที่ผลิตออกมา — ไม่มี cap จึงไม่มีช่วงยืดให้ ต้องแยกกองของตัวเอง ห้ามนับรวมกับ stretched) */

/* ---------- ตัวช่วยส่วนที่ 2 ---------- */
const OPT_MAX_OPTIONS=5,OPT_MAX_SHEETS=20;          /* ค่าเริ่มต้นเมื่อ settings.glass_rules ไม่มีค่า */
const OPT_OPTIONS_CAP=50,OPT_SHEETS_CAP=1000;       /* เพดานแข็งกันค่าตั้งเพี้ยน (กันเครื่องค้าง) */
const OPT_OVER_PCT=20,OPT_OVER_MAX=100;             /* "ยืดเพดานได้ไม่เกิน %" ตั้งต้น 20 · รับ 0–100 (เจ้าของเคาะ 28 ก.ย. 69) */
const TRIPLE_BUDGET=400000;                         /* ค้น 3 แพทเทิร์นแบบครบทุกทางเมื่อ (จำนวนชุด 3 แบบที่ครอบ need ได้) × S × S ≤ ค่านี้ */
const OPT_POOL=20;                                  /* ความกว้างการค้นต่อสี (กองทางเลือกระหว่างค้น) — ไม่ขึ้นกับ max_options → อันดับ 1 เหมือนกันทุกค่าที่ตั้ง */
/* งบค้นหาแบบ "นับงาน" (นับรอบวนชั้นในของ greedy / ลดแผ่น / ประเมินทาง) ไม่ใช้นาฬิกา → ผลเหมือนกันทุกเครื่อง · 1 หน่วย ≈ 10 นาโนวินาทีบนเครื่องพัฒนา */
const GREEDY_WORK=12000000;                         /* ต่อสี: greedy แบบบังคับเริ่มทีละผู้สมัคร (เรียงแบบคุ้มสุดก่อน) */
const LS_WORK=25000000;                             /* ต่อสี: ขั้นปรับปรุงเฉพาะที่ · ชุดหนักสุด 56 แบบ × 3 สี ≈ 0.9 วินาที · จำลอง 150 แบบ ≈ 1 วินาที (14 ก.ย. 69) */
const LS_STARTS=20;                                 /* ต่อสี: จำนวนทางดีสุดในกองที่ใช้เป็นจุดเริ่มปรับปรุง */
const EXH_BUDGET=100000;                            /* ไล่ครบทุกทางเมื่อ (S+1)^(จำนวนผู้สมัคร) ≤ ค่านี้ → ดีที่สุดจริง + ทางเลือกครบเท่าที่มี */
const ST_SHORT='ขาด',ST_OK='ครบ',ST_OVER='เกิน',ST_UNSET='ไม่ได้ตั้งระดับ';
/* จำนวนเต็มไม่ติดลบ (รับสตริงตัวเลข) หรือ null */
const nnInt=v=>{const n=toNum(v);return Number.isInteger(n)&&n>=0?n:null;};
/* เรียงรหัสแบบคน: ตัวเลขในรหัสเทียบเป็นตัวเลข (A2 < A10) · ผลเหมือนกันทุกเครื่อง (ไม่พึ่ง locale) */
function natCmp(a,b){
  const x=String(a==null?'':a).match(/\d+|\D+/g)||[],y=String(b==null?'':b).match(/\d+|\D+/g)||[];
  for(let i=0;i<Math.min(x.length,y.length);i++){
    const p=x[i],q=y[i],dp=/^\d/.test(p),dq=/^\d/.test(q);
    if(dp&&dq){const u=p.replace(/^0+/,''),w=q.replace(/^0+/,'');
      if(u.length!==w.length)return u.length-w.length;
      const c=byStr(u,w);if(c)return c;if(p.length!==q.length)return p.length-q.length;}
    else{const c=byStr(p,q);if(c)return c;}
  }
  return x.length-y.length;
}
/* สตางค์ → "฿3,600.00" (ลูกน้ำหลักพัน ทศนิยม 2 ตำแหน่ง · ไม่พึ่ง locale) */
function bahtTxt(satang){
  const s=Math.round(Number(satang)||0),neg=s<0,a=Math.abs(s);
  const b=String(Math.floor(a/100)).replace(/\B(?=(\d{3})+(?!\d))/g,','),st=String(a%100).padStart(2,'0');
  return (neg?'-':'')+'฿'+b+'.'+st;
}
/* มม.² → ตร.ฟุต ทศนิยม 2 ตำแหน่ง */
const sqftOfMm2=mm2=>Math.round((Number(mm2)||0)/MM2_PER_SQFT*100)/100;
/* รายชื่อยาว → "a, b, c และอีก n" */
const listTxt=(arr,max)=>{max=max||8;return arr.length<=max?arr.join(', '):arr.slice(0,max).join(', ')+' และอีก '+(arr.length-max);};
/* ค่าที่กรอกผิด → ข้อความที่ปลอดภัยสำหรับคนอ่าน (ตัวเลข/ข้อความสั้นเท่านั้น · null/undefined/NaN/อ็อบเจกต์ = ไม่พิมพ์ค่าดิบ) */
function rawTxt(v){
  if(typeof v==='number')return isFinite(v)?'"'+String(v)+'"':'';
  if(typeof v==='string'){const s=v.trim();return s?'"'+(s.length>20?s.slice(0,20)+'…':s)+'"':'';}
  return '';
}
/* ช่องว่าง = ยังไม่ได้กรอก (null · undefined · สตริงว่าง) */
const blankVal=v=>v==null||(typeof v==='string'&&v.trim()==='');
/* สีที่เปิดใช้งาน [{key,name}] ตามลำดับใน settings · ไม่ส่งมา = DEFAULT_COLORS */
function activeColorList(colors){
  const src=Array.isArray(colors)?colors:DEFAULT_COLORS,seen=new Set(),out=[];
  src.forEach(c=>{if(!c||typeof c!=='object')return;const k=idOf(c.key);if(!k||seen.has(k)||c.active===false)return;
    seen.add(k);out.push({key:k,name:(typeof c.name==='string'&&c.name.trim())?c.name.trim():'สี'+k});});
  return out;
}
/* ชื่อสีจากตั้งค่า รวมสีที่ปิดใช้งาน (ใช้ในข้อความ "สีเขียวปิดใช้งาน") · ไม่มีในตั้งค่า = "สี"+key */
function colorNameAny(colors,ck){
  const src=Array.isArray(colors)?colors:DEFAULT_COLORS;
  const c=src.find(x=>x&&typeof x==='object'&&idOf(x.key)===ck);
  return (c&&typeof c.name==='string'&&c.name.trim())?c.name.trim():'สี'+ck;
}
/* ชื่อชิ้นจากทะเบียน (pieceName) · ไม่มีในทะเบียน = "ชิ้นนอกทะเบียน" (ห้ามพิมพ์รหัสโปรแกรมให้คนอ่าน) */
const OUTSIDE_PIECE='ชิ้นนอกทะเบียน';
function pieceLabel(pm,pid){const p=pm.get(pid);if(!p)return OUTSIDE_PIECE;
  if(posInt(p.a_mm)&&posInt(p.b_mm))return pieceName(p.a_mm,p.b_mm);
  return (typeof p.name==='string'&&p.name.trim())?p.name.trim():'ชิ้นที่ไม่มีขนาดในทะเบียน';}
/* ชื่อขนาดแผ่น "96×72" */
function sizeLabel(sz){if(!sz)return '';const n=typeof sz.name==='string'?sz.name.trim():'';
  return n||(numTxt(sz.w_in)+'×'+numTxt(sz.h_in));}
/* อ่านระดับของชิ้นในสี → {set:false} | {set:true,min,max} | {set:false,bad:true} */
function levelOf(piece,ck){
  const L=(piece&&piece.levels&&typeof piece.levels==='object'&&!Array.isArray(piece.levels))?piece.levels[ck]:undefined;
  if(!L||typeof L!=='object'||Array.isArray(L))return {set:false};
  const mn=nnInt(L.min),mx=nnInt(L.max);
  if(mn===null||mx===null)return {set:false,bad:true};
  return {set:true,min:mn,max:mx};
}
/* เรียงชิ้น: ด้านสั้น → ด้านยาว → รหัส */
function pieceSortCmp(pm){return (a,b)=>{const p=pm.get(a)||{},q=pm.get(b)||{};
  return ((posInt(p.a_mm)||1e9)-(posInt(q.a_mm)||1e9))||((posInt(p.b_mm)||1e9)-(posInt(q.b_mm)||1e9))||byStr(a,b);};}

/* ==================== computeNeeds ====================
   computeNeeds(stock, pieces, colors) → {needs:[{piece_id,color,need,onhand,min,max}], warnings:[ไทย],
                                          stock_snapshot:[{piece_id,name,color,onhand,min,max,given}]}
   · คิดเฉพาะชิ้นที่เปิดใช้งาน × สีที่เปิดใช้งาน · เรียง: ลำดับสีใน settings → ด้านสั้น → ด้านยาว → รหัส
   · ช่องว่าง (null / undefined / '') = ยังไม่ได้กรอก → เหมือนไม่ได้ส่งยอด (= 0 + เตือน "ไม่ได้กรอกยอด")
   · ยอดคงเหลือไม่ถูกต้อง (ติดลบ/ทศนิยม/ไม่ใช่ตัวเลข) = 0 + เตือน · ส่งซ้ำหลายแถว = ใช้ค่าน้อยสุด + เตือน (สั่งพอแน่ ๆ)
   · เตือน "ไม่ได้กรอกยอด" เฉพาะชิ้น×สีที่ตั้งระดับไว้ (ไม่ใช่ 0/0) — ชิ้นที่ยังไม่ตั้งระดับรวมเป็นบรรทัดเดียวต่อสี
   · ตั้งของไม่ครบจนคำนวณไม่ได้ (ไม่มีสีที่เปิด / ไม่มีชิ้นที่เปิด / ยังไม่ตั้งระดับสักชิ้น) = เตือนบรรทัดเดียวบอกเหตุ
   · stock_snapshot = ยอดที่ใช้คิดจริงหลังทำความสะอาดแล้ว (ทุกชิ้นที่เปิด × ทุกสีที่เปิด) → หน้าเว็บบันทึกลง glass_pattern_orders.stock_snapshot ตรง ๆ
     given = มีการกรอกยอดมา (false = ถือเป็น 0) · min/max = null เมื่อยังไม่ตั้งระดับ */
function computeNeeds(stock,pieces,colors){
  const r=needsCore(stock,pieceMap(pieces),activeColorList(colors));
  return {needs:r.needs,warnings:r.warnings,stock_snapshot:r.snapshot};
}
function needsCore(stock,pm,cols){
  const warnings=[],needs=[],snapshot=[],info=new Map();   /* info: pid|ck → {onhand,min,max,set,need,given} */
  const colSet=new Set(cols.map(c=>c.key));
  const cname=ck=>{const c=cols.find(x=>x.key===ck);return c?c.name:'สี'+ck;};
  const given=new Map(),dups=new Map(),badVal=[],unknown=new Set();
  /* ปิดใช้งานชั่วคราวเฉพาะรอบนี้ (เจ้าของสั่ง 26 ต.ค. 69) — ชิ้น×สี ที่ติดธง skip = "รอบนี้ยังไม่อยากสั่ง"
     → ไม่นับว่าขาด ไม่ลากแพทเทิร์นมาเติมให้ · แต่ **เส้นเพดาน (cap) ยังคุ้มอยู่เหมือนเดิม**
       เพราะแพทเทิร์นหนึ่งแผ่นให้ชิ้นหลายขนาดพร้อมกัน ถ้าปลดเพดานไปด้วยจะกลายเป็นยัดของที่เจ้าของเพิ่งบอกว่าไม่อยากได้
     ⚠️ ต้องอ่านธงก่อนด่าน blankVal: ช่องที่ปิดไว้ส่วนใหญ่ไม่ได้กรอกยอด แถวจึงส่งมาแบบไม่มี onhand */
  const skipSet=new Set(),offPiece=new Set(),offColor=new Set();
  (Array.isArray(stock)?stock:[]).forEach(r=>{
    if(!r||typeof r!=='object')return;
    const pid=idOf(r.piece_id),ck=idOf(r.color);if(!pid||!ck)return;
    const p=pm.get(pid);
    if(!p){unknown.add(pid);return;}
    /* ⭐ ยอดที่คนอุตส่าห์นับแล้วกรอก ห้ามหายเงียบ — ถ้าชิ้น/สีถูกปิดใช้งาน ต้องบอกว่ายอดนั้นไม่ถูกนำมาคิด
       (สำรวจจุดเงียบ 26 ต.ค. 69 ข้อ 14-15) · นับเฉพาะช่องที่กรอกจริงหรือสั่งปิดจริง ช่องว่างเปล่าไม่ต้องเตือน */
    const typed=!blankVal(r.onhand)||r.skip===true;
    if(p.active===false){if(typed)offPiece.add(pieceLabel(pm,pid));return;}
    if(!colSet.has(ck)){if(typed)offColor.add(ck);return;}
    if(r.skip===true)skipSet.add(pid+'|'+ck);           /* รับเฉพาะ true แท้ ๆ — ค่าอื่นทั้งหมดถือว่ายังเปิดใช้งาน */
    if(blankVal(r.onhand))return;                       /* ช่องว่าง = ยังไม่ได้กรอก */
    let v=nnInt(r.onhand);
    if(v===null){const raw=rawTxt(r.onhand);badVal.push(pieceLabel(pm,pid)+' '+cname(ck)+(raw?' ('+raw+')':''));v=0;}
    const k=pid+'|'+ck;
    if(given.has(k)){dups.set(k,(dups.get(k)||[given.get(k)]).concat([v]));given.set(k,Math.min(given.get(k),v));}
    else given.set(k,v);
  });
  const ids=[...pm.keys()].filter(id=>pm.get(id).active!==false).sort(pieceSortCmp(pm));
  let levelsSet=0;
  ids.forEach(pid=>cols.forEach(c=>{if(levelOf(pm.get(pid),c.key).set)levelsSet++;}));
  const stats={colors:cols.length,pieces:ids.length,levels_set:levelsSet};
  let blocked=null;
  if(!cols.length){blocked='no_colors';warnings.push('ไม่มีสีที่เปิดใช้งาน — คำนวณไม่ได้ ตั้งที่หน้า ⚙️ ตั้งค่า (สีกระจก)');}
  else if(!ids.length){blocked='no_pieces';warnings.push('ไม่มีชิ้นงานที่เปิดใช้งานในทะเบียน — คำนวณไม่ได้ เพิ่มหรือเปิดใช้งานที่หน้า 📐 ชิ้นงาน');}
  else if(!levelsSet){blocked='no_levels';warnings.push('ยังไม่ได้ตั้งขั้นต่ำ/เพดานสักชิ้น — คำนวณไม่ได้ ตั้งที่หน้า 📐 ชิ้นงาน');}
  cols.forEach(c=>{
    const missing=[],unset=[],badLv=[],inverted=[],skipped=[];
    ids.forEach(pid=>{
      const p=pm.get(pid),L=levelOf(p,c.key),k=pid+'|'+c.key,has=given.has(k),onhand=has?given.get(k):0;
      const sk=skipSet.has(k);
      const snap={piece_id:pid,name:pieceLabel(pm,pid),color:c.key,onhand,min:L.set?L.min:null,max:L.set?L.max:null,given:has};
      if(sk){snap.skipped=true;skipped.push(pieceLabel(pm,pid));}   /* ใส่คีย์เฉพาะตอนปิดจริง — ใบเก่าและแถวปกติหน้าตาเหมือนเดิมเป๊ะ */
      snapshot.push(snap);
      if(!L.set){
        if(L.bad)badLv.push(pieceLabel(pm,pid));else unset.push(pieceLabel(pm,pid));
        info.set(k,{onhand,min:null,max:null,set:false,need:0,given:has,skipped:sk});return;
      }
      if(!has&&!sk&&(L.min>0||L.max>0))missing.push(pieceLabel(pm,pid));   /* ปิดไว้แล้ว = ไม่ต้องทวงให้ไปนับ */
      if(L.max<L.min)inverted.push(pieceLabel(pm,pid)+' (ขั้นต่ำ '+L.min+' เพดาน '+L.max+')');
      const need=(!sk&&onhand<L.min)?L.min-onhand:0;
      info.set(k,{onhand,min:L.min,max:L.max,set:true,need,given:has,skipped:sk});
      if(need>0)needs.push({piece_id:pid,color:c.key,need,onhand,min:L.min,max:L.max});
    });
    /* ⭐ ต้องขึ้นเสมอเมื่อมีการปิด: กฎเหล็กบอกว่า "ต้องสั่งให้ชิ้นที่ขาดถึงขั้นต่ำเป็นอย่างน้อย"
       การปิดรอบนี้คือคนจงใจสั่งข้ามกฎนั้นเอง ใบสั่งจึงต้องจดไว้ให้อ่านออกว่าปิดอะไรไปบ้าง ไม่ใช่เงียบ */
    if(skipped.length)warnings.push(c.name+': ปิดใช้งานชั่วคราวรอบนี้ '+skipped.length+' ชิ้น ('+listTxt(skipped)+') — จะไม่สั่งให้แม้ยอดต่ำกว่าขั้นต่ำ (เส้นเพดานยังคุ้มอยู่ตามเดิม)');
    if(missing.length)warnings.push(c.name+': ไม่ได้กรอกยอดคงเหลือ '+missing.length+' ชิ้น ('+listTxt(missing)+') — ถือเป็น 0');
    if(badLv.length)warnings.push(c.name+': ขั้นต่ำ/เพดานในทะเบียนไม่ใช่จำนวนเต็มไม่ติดลบ '+badLv.length+' ชิ้น ('+listTxt(badLv)+') — ถือว่ายังไม่ได้ตั้งระดับ');
    if(inverted.length)warnings.push(c.name+': เพดานต่ำกว่าขั้นต่ำ '+inverted.length+' ชิ้น ('+listTxt(inverted)+') — ตรวจที่หน้า 📐 ชิ้นงาน');
    /* ยังไม่ตั้งระดับสักชิ้น = บรรทัดเดียวข้างบนแล้ว ไม่ต้องซ้ำทุกสี */
    if(unset.length&&blocked!=='no_levels')warnings.push(c.name+': ยังไม่ได้ตั้งขั้นต่ำ/เพดาน '+unset.length+' ชิ้น — ไม่นับว่าขาด (ถ้าทางเลือกผลิตชิ้นเหล่านี้ออกมา จะนับเป็นชิ้นเกิน)');
  });
  if(badVal.length)warnings.push('ยอดคงเหลือไม่ใช่จำนวนเต็มไม่ติดลบ '+badVal.length+' ช่อง ('+listTxt(badVal)+') — ถือเป็น 0');
  dups.forEach((vals,k)=>{const i=k.lastIndexOf('|'),pid=k.slice(0,i),ck=k.slice(i+1);
    warnings.push('กรอกยอดคงเหลือ '+pieceLabel(pm,pid)+' '+cname(ck)+' ซ้ำ '+vals.length+' ครั้ง ('+vals.join(', ')+') — ใช้ค่าน้อยสุด '+Math.min(...vals));});
  if(unknown.size)warnings.push('ยอดคงเหลือของชิ้นที่ไม่มีในทะเบียน '+unknown.size+' รายการ ('+listTxt([...unknown].sort(byStr))+') — ไม่นำมาคิด');
  if(offPiece.size)warnings.push('ยอดที่กรอกของชิ้นที่ถูกปิดใช้งานในทะเบียน '+offPiece.size+' ชิ้น ('+listTxt([...offPiece].sort(byStr))+') — ไม่นำมาคิด เปิดใช้งานกลับได้ที่หน้า 📐 ชิ้นงาน');
  if(offColor.size)warnings.push('ยอดที่กรอกของสีที่ถูกปิดใช้งาน '+offColor.size+' สี ('+listTxt([...offColor].sort(byStr))+') — ไม่นำมาคิด เปิดใช้งานกลับได้ที่หน้า ⚙️ ตั้งค่า (สีกระจก)');
  return {needs,warnings,info,snapshot,stats,blocked};
}

/* ==================== บริบทการคำนวณ (อ่านทะเบียนครั้งเดียว) ==================== */
/* แพทเทิร์นนี้ "มีผัง" ไหม — ตัวตัดสินตัวเดียวของทั้ง engine (ห้ามเขียนเงื่อนไขชุดที่สองที่อื่น)
   ⛔ ห้ามเช็คด้วย Array.isArray(lay.strips) ตรง ๆ: ผัง 3 ขั้นไม่มีคีย์ strips ที่ราก (ตั้งใจ)
      ถ้าเช็คแบบนั้นจะได้ false → ไปอ่านผลผลิตจากคอลัมน์ yield แทนที่จะคิดจากผัง (ผิดกฎเหล็ก "ตัวเลขทุกตัวมาจาก engine")
      และผังจะไม่ถูก validatePattern เลย → ผังเสียก็ยังถูกเสนอให้สั่ง
      วัดจริง 22 ต.ค. 69: ผัง 3 ขั้นให้ 8 ชิ้น/แผ่น แต่คอลัมน์ yield เพี้ยนเป็น 2 → ระบบเสนอ 5 แผ่น ฿5,000 แทนที่จะเป็น 2 แผ่น ฿2,000 โดยไม่มีคำเตือนสักบรรทัด */
function hasLayoutOf(p){
  const lay=p&&p.layout;
  return !!(lay&&typeof lay==='object'&&(isSplitLayout(lay)||stripsOf(lay).length>0));
}
/* ผลผลิตต่อแผ่นของแพทเทิร์น: มีผัง = patternYield(layout) · ไม่มีผัง = คอลัมน์ yield (รวมรหัสซ้ำ · qty จำนวนเต็มบวก) */
function yieldOfPattern(p){
  if(hasLayoutOf(p))return patternYield(p.layout);
  return yieldCol(p);
}
function yieldCol(p){
  const m=new Map();
  (Array.isArray(p&&p.yield)?p.yield:[]).forEach(r=>{if(!r||typeof r!=='object')return;
    const id=idOf(r.piece_id),q=posInt(r.qty);if(id&&q)m.set(id,(m.get(id)||0)+q);});
  return [...m.keys()].sort(byStr).map(id=>({piece_id:id,qty:m.get(id)}));
}
const sameYield=(a,b)=>a.length===b.length&&a.every((y,i)=>y.piece_id===b[i].piece_id&&y.qty===b[i].qty);
function ruleInt(v,def,cap){const n=nnInt(v);return n!==null&&n>=1?Math.min(n,cap):def;}
/* % ที่ยืดเพดานได้ — 0 ใช้ได้จริง (= ห้ามเกินเพดานเป๊ะ) จึงไม่ใช้ ruleInt ที่บังคับ ≥ 1 · ค่าเพี้ยน/เกิน 100 = ใช้ค่าตั้งต้น */
function rulePct(v,def,cap){const n=nnInt(v);return n!==null&&n<=cap?n:def;}
/* เพดานที่ยืดได้ของชิ้นหนึ่ง (จำนวนเต็ม · คิดแบบจำนวนเต็มล้วน ไม่ให้ทศนิยมลอยทำให้ปัดพลาด 35×1.2 = 41.999…) */
function capOfMax(max,over){return Math.floor((max*(100+over))/100);}
function buildCtx(input){
  const I=(input&&typeof input==='object')?input:{};
  const R=(I.rules&&typeof I.rules==='object')?I.rules:{};
  const ctx={K:ruleInt(R.max_options,OPT_MAX_OPTIONS,OPT_OPTIONS_CAP),S:ruleInt(R.max_sheets_per_pattern,OPT_MAX_SHEETS,OPT_SHEETS_CAP),
    over:rulePct(R.over_pct,OPT_OVER_PCT,OPT_OVER_MAX),messages:[]};
  /* ⭐ ค่าตั้งที่ใช้ไม่ได้ถูกแทนด้วยค่าตั้งต้นเงียบ ๆ — ต้องบอก โดยเฉพาะ over_pct ที่เปลี่ยน "เส้นเพดาน"
     = เปลี่ยนว่าผังไหนถูกตัดทิ้ง · หน้าเว็บกันไว้ตอนบันทึกแล้ว ค่าเพี้ยนจึงเข้าได้ทาง Import JSON หรือแก้ฐานตรง
     (สำรวจจุดเงียบ 26 ต.ค. 69 ข้อ 17) · เทียบกับค่าที่ส่งมาจริง: ไม่ได้ส่ง = ไม่ใช่ความเพี้ยน ไม่ต้องเตือน */
  [['max_options','จำนวนทางเลือกสูงสุด',ctx.K],['max_sheets_per_pattern','แผ่นต่อแพทเทิร์นไม่เกิน',ctx.S],
   ['over_pct','ยืดเพดานได้ไม่เกิน %',ctx.over]].forEach(function(x){
    const raw=R[x[0]];
    if(raw==null||String(raw)===String(x[2]))return;
    ctx.messages.push('ค่าตั้ง "'+x[1]+'" ในฐานใช้ไม่ได้ ('+JSON.stringify(raw)+') — ใช้ค่าตั้งต้น '+x[2]+' แทนในการคิดครั้งนี้'+
      (x[0]==='over_pct'?' ⚠️ ค่านี้เปลี่ยนเส้นเพดาน จึงเปลี่ยนว่าผังไหนถูกตัดทิ้ง':'')+' · แก้ที่หน้า ⚙️ ตั้งค่า');
  });
  ctx.cols=activeColorList(I.colors);
  ctx.colIdx=new Map(ctx.cols.map((c,i)=>[c.key,i]));
  ctx.cname=ck=>{const i=ctx.colIdx.get(ck);return i===undefined?colorNameAny(I.colors,ck):ctx.cols[i].name;};
  ctx.pm=pieceMap(I.pieces);
  ctx.sizes=new Map();
  (Array.isArray(I.sizes)?I.sizes:[]).forEach(z=>{if(z&&idOf(z.id))ctx.sizes.set(idOf(z.id),z);});
  ctx.sizeOk=id=>{const z=ctx.sizes.get(id);return !!z&&z.active!==false;};
  /* แผ่นราคา: ใช้ได้เมื่อเปิดใช้งาน · ขนาดแผ่นเปิดใช้งาน · สีเปิดใช้งาน · price_satang จำนวนเต็ม > 0
     หลายแถวต่อ ขนาด×สี (ความหนาต่างกัน) = ใช้แถวราคาต่ำสุด → รหัสน้อยสุด + แจ้งในข้อความ */
  ctx.sheetBy=new Map();
  const dupSheet=new Map();
  (Array.isArray(I.sheets)?I.sheets:[]).filter(r=>r&&typeof r==='object').slice()
    .sort((a,b)=>byStr(idOf(a.id),idOf(b.id))).forEach(r=>{
      const sz=idOf(r.sheet_size_id),ck=idOf(r.color),pr=nnInt(r.price_satang);
      if(r.active===false||!ctx.sizeOk(sz)||!ctx.colIdx.has(ck)||!pr)return;
      const k=sz+'|'+ck,cur=ctx.sheetBy.get(k);
      if(cur){dupSheet.set(k,true);if(pr<cur.price)ctx.sheetBy.set(k,{row:r,price:pr});}
      else ctx.sheetBy.set(k,{row:r,price:pr});
    });
  dupSheet.forEach((_,k)=>{const i=k.lastIndexOf('|'),sz=k.slice(0,i),ck=k.slice(i+1),u=ctx.sheetBy.get(k);
    ctx.messages.push('แผ่น '+sizeLabel(ctx.sizes.get(sz))+' '+ctx.cname(ck)+' มีแผ่นราคาหลายแถว — ใช้ '+idOf(u.row.id)+' ('+bahtTxt(u.price)+'/แผ่น)');});
  /* แพทเทิร์นทุกแถว (รวมที่ปิด) → ใช้ได้ = เปิดใช้งาน + ขนาดแผ่นเปิดใช้งาน + ผังผ่าน validatePattern (ตัวตรวจเดียวกับหน้า 🧩 · คิดร่องตัด/เผื่อขอบตามตั้งค่าปัจจุบัน)
     ไม่มีผัง (ใช้คอลัมน์ yield) = ทุกชิ้นต้องมีในทะเบียน · ไม่ผ่าน = ไม่นำมาคิด + ข้อความบรรทัดเดียว (bad = ข้อผิดพลาดแรก) · เรียงรหัสแบบคน → id */
  ctx.patAll=new Map();
  const bad=[];
  let patNoId=0;
  (Array.isArray(I.patterns)?I.patterns:[]).forEach(p=>{
    if(!p||typeof p!=='object'||!idOf(p.id)){patNoId++;return;}   /* แถวเสียในฐาน — ต้องบอก ไม่ใช่ข้ามเงียบ */
    const id=idOf(p.id),lay=p.layout;
    const hasLayout=hasLayoutOf(p);   /* ⛔ ต้องใช้ตัวนี้ ไม่ใช่เช็ค lay.strips เอง — ผัง 3 ขั้นไม่มี strips ที่ราก */
    const rec={id,code:String(p.code!=null&&String(p.code).trim()?p.code:id).trim(),size_id:idOf(p.sheet_size_id),
      active:p.active!==false,yield:yieldOfPattern(p),bad:''};
    rec.yieldAny=rec.yield.length?rec.yield:yieldCol(p);   /* ใช้บอกเหตุผล "มีแพทเทิร์นแต่…" เท่านั้น */
    if(rec.active&&ctx.sizeOk(rec.size_id)){
      if(hasLayout){const v=validatePattern(lay,ctx.sizes.get(rec.size_id),I.pieces,R);if(!v.ok)rec.bad=v.errors[0];}
      else if(!rec.yield.length)rec.bad='ยังไม่มีผังตัด';
      else if(rec.yield.some(y=>!ctx.pm.has(y.piece_id)))rec.bad='ผลผลิตมีชิ้นที่ไม่มีในทะเบียนชิ้นงาน';
      if(rec.bad)bad.push(rec);
    }
    ctx.patAll.set(id,rec);
  });
  if(patNoId)ctx.messages.push('แถวแพทเทิร์นในฐานใช้ไม่ได้ '+patNoId+' แถว (ไม่มีรหัสประจำแถว) — ข้ามไป แจ้งผู้ดูแลระบบ');
  if(bad.length){bad.sort((a,b)=>natCmp(a.code,b.code)||byStr(a.id,b.id));
    ctx.messages.push('ผังตัดไม่ผ่านการตรวจ '+bad.length+' แบบ ('+listTxt(bad.map(p=>p.code))+') — ไม่นำมาคิด แก้ที่หน้า 🧩 แพทเทิร์น'+
      (bad.length===1?' ('+bad[0].bad+')':''));}
  ctx.pats=[...ctx.patAll.values()].filter(p=>p.active&&ctx.sizeOk(p.size_id)&&!p.bad&&p.yield.length)
    .sort((a,b)=>natCmp(a.code,b.code)||byStr(a.id,b.id));
  ctx.patRank=new Map(ctx.pats.map((p,i)=>[p.id,i]));
  const nr=needsCore(I.stock,ctx.pm,ctx.cols);
  ctx.needs=nr.needs;ctx.warnings=nr.warnings;ctx.info=nr.info;ctx.snapshot=nr.snapshot;ctx.blocked=nr.blocked;ctx.needStats=nr.stats;
  ctx.preps=new Map();
  analyzeNeeds(ctx);
  return ctx;
}

/* ครอบได้แค่ไหนต่อ need (ใช้ทั้งค้นหาและข้อความ "ทำไมยังขาด")
   cap = Σ (เพดานแผ่น × ผลผลิต) ของแพทเทิร์นที่สั่งได้ (ใช้งาน · ขนาดแผ่นใช้งาน · ผังผ่านการตรวจ · มีราคา ขนาด×สี)
   cap = 0 → ครอบไม่ได้เลย · cap < need → ครอบได้บางส่วน (ค้นหาใช้ need = cap) */
function analyzeNeeds(ctx){
  ctx.eff=new Map();ctx.why=new Map();ctx.whyGap=new Map();ctx.uncoverable=[];
  ctx.needs.forEach(n=>{
    const k=n.piece_id+'|'+n.color,nm=pieceLabel(ctx.pm,n.piece_id),cn=ctx.cname(n.color);
    const prod=ctx.pats.filter(p=>p.yield.some(y=>y.piece_id===n.piece_id));
    const priced=prod.filter(p=>ctx.sheetBy.has(p.size_id+'|'+n.color));
    let cap=0;priced.forEach(p=>{cap+=ctx.S*p.yield.find(y=>y.piece_id===n.piece_id).qty;});
    let why='';
    if(!prod.length){
      const offs=[...ctx.patAll.values()].filter(p=>!ctx.patRank.has(p.id)&&p.yieldAny.some(y=>y.piece_id===n.piece_id))
        .sort((a,b)=>natCmp(a.code,b.code)||byStr(a.id,b.id));
      const off=offs.filter(p=>!p.bad),badP=offs.filter(p=>p.bad),ex=[];
      if(off.length)ex.push('มี '+listTxt(off.map(p=>p.code))+' แต่ปิดใช้งานอยู่ หรือขนาดแผ่นปิดใช้งาน');
      if(badP.length)ex.push('มี '+listTxt(badP.map(p=>p.code))+' แต่ผังตัดไม่ผ่านการตรวจ');
      why='ไม่มีแพทเทิร์นที่ให้ '+nm+' '+cn+(ex.length?' ('+ex.join(' · ')+')':'');
    }else if(!priced.length){
      const sz=[...new Set(prod.map(p=>sizeLabel(ctx.sizes.get(p.size_id))))];
      why=nm+' '+cn+' มีแพทเทิร์น ('+listTxt(prod.map(p=>p.code))+') แต่แผ่น '+sz.join(' / ')+' '+cn+' ยังไม่มีราคา';
    }else if(cap<n.need){
      why=nm+' '+cn+' ต้องการ '+n.need+' ชิ้น แต่แพทเทิร์นที่สั่งได้ ('+listTxt(priced.map(p=>p.code))+') ให้ได้รวมสูงสุด '+cap+
        ' ชิ้น (แผ่นต่อแพทเทิร์นไม่เกิน '+ctx.S+') — ขาดอีก '+(n.need-cap)+' ชิ้น';
    }
    ctx.eff.set(k,Math.min(n.need,cap));
    /* whyGap = จำนวนที่ขาด "โดยโครงสร้าง" ของเหตุผลนี้ — ใช้กันเลขขัดกันเมื่อทางที่เสนอขาดมากกว่านั้น (ผลตรวจ 28 ก.ย. 69 ข้อ 3) */
    if(why){ctx.why.set(k,why);ctx.whyGap.set(k,n.need-Math.min(n.need,cap));
      ctx.uncoverable.push({piece_id:n.piece_id,color:n.color,need:n.need-Math.min(n.need,cap),why});}
  });
}

/* ข้อมูลต่อสี: ช่อง (slot) ต่อชิ้น → need/onhand/min/max/ตั้งระดับ/อยู่ในทะเบียน/พื้นที่ · สร้างครั้งเดียวต่อสี */
function prepOf(ctx,ck){
  let P=ctx.preps.get(ck);if(P)return P;
  P={ck,slot:new Map(),pid:[],need:[],onhand:[],min:[],max:[],cap:[],lv:[],reg:[],area:[],scratch:[],needSlots:[],over:ctx.over,cmp:pieceSortCmp(ctx.pm)};
  ctx.preps.set(ck,P);
  ctx.needs.forEach(n=>{if(n.color===ck)P.needSlots.push(slotOf(ctx,P,n.piece_id));});
  return P;
}
function slotOf(ctx,P,pid){
  let s=P.slot.get(pid);if(s!==undefined)return s;
  s=P.pid.length;P.slot.set(pid,s);P.pid.push(pid);
  const p=ctx.pm.get(pid),reg=!!p&&p.active!==false;
  let inf=reg?ctx.info.get(pid+'|'+P.ck):null;
  if(reg&&!inf){const L=levelOf(p,P.ck);inf=L.set?{onhand:0,min:L.min,max:L.max,set:true,need:L.min}:{onhand:0,set:false,need:0};}
  P.reg.push(reg?1:0);P.lv.push(reg&&inf.set?1:0);
  P.need.push(reg?inf.need:0);P.onhand.push(reg?inf.onhand:0);
  P.min.push(reg&&inf.set?inf.min:null);P.max.push(reg&&inf.set?inf.max:null);
  /* cap = เส้นห้ามข้าม · เฉพาะชิ้นที่ตั้งระดับแล้วและ max > 0 (ชิ้นที่ยังไม่ตั้งระดับ และ max = 0 ไม่มี cap — ดูหัวข้อส่วนที่ 2) */
  P.cap.push(reg&&inf.set&&inf.max>0?capOfMax(inf.max,ctx.over):null);
  P.area.push(p?posInt(p.a_mm)*posInt(p.b_mm):0);
  P.scratch.push(0);
  return s;
}
/* ⭐ ตัวคิดผลของสีหนึ่ง — ใช้ตัวเดียวทั้งตอนค้นหา (detail=false) และตอนสร้างทางเลือก/applyLines (detail=true) → สูตรเดียวกันเป๊ะ
   entries = [{yl:[[slot,qty],…], sheets, price}] → {v เกิน max, oc เกิน cap, price, ex มม.² ชิ้นเกิน, nl รายการ, sh แผ่น (+ รายละเอียด)} */
function evalColor(P,entries,detail){
  const prod=P.scratch,touched=[];
  let price=0,sh=0,nl=0,v=0,ex=0,oc=0;
  for(let e=0;e<entries.length;e++){const E=entries[e],x=E.sheets;if(!(x>0))continue;
    nl++;sh+=x;price+=x*E.price;
    const yl=E.yl;for(let t=0;t<yl.length;t++){const s=yl[t][0];if(prod[s]===0)touched.push(s);prod[s]+=x*yl[t][1];}}
  for(let t=0;t<touched.length;t++){const s=touched[t],pr=prod[s];
    if(P.reg[s]){
      if(P.lv[s]&&P.onhand[s]+pr>P.max[s])v++;
      if(P.cap[s]!=null&&P.onhand[s]+pr>P.cap[s])oc++;      /* เกินเพดานที่ยืดได้ = เส้นห้ามข้าม */
      const e2=pr-P.need[s];if(e2>0)ex+=e2*P.area[s];
    }else ex+=pr*P.area[s];
  }
  const out={v,oc,price,ex,nl,sh};
  if(detail){
    const after=[],vlist=[],oclist=[],stlist=[],nclist=[],short=[],untracked=[],pmap=new Map();
    const slots=[...new Set(P.needSlots.concat(touched))].sort((a,b)=>P.cmp(P.pid[a],P.pid[b]));
    slots.forEach(s=>{const pr=prod[s],pid=P.pid[s];
      if(pr>0)pmap.set(pid,pr);
      if(!P.reg[s]){if(pr>0)untracked.push({piece_id:pid,color:P.ck,produced:pr});return;}
      if(pr===0&&P.need[s]===0)return;
      const a=P.onhand[s]+pr,set=!!P.lv[s],cp=P.cap[s];
      const st=!set?ST_UNSET:(a<P.min[s]?ST_SHORT:(pr>0&&a>P.max[s]?ST_OVER:ST_OK));
      /* cap = เส้นห้ามข้ามของแถวนี้ (null = ไม่มีเส้น: ยังไม่ตั้งระดับ หรือเพดาน 0) — เก็บไว้ในแถวเพื่อให้ "ใบที่บันทึกแล้ว"
         แยก "ยืดเพดาน" กับ "เกินเพดานที่ยืดได้แล้ว" ได้จาก snapshot ของตัวเอง ไม่ต้องอ่านค่าตั้งปัจจุบัน (ผลตรวจ 28 ก.ย. 69 ข้อ 11) */
      after.push({piece_id:pid,color:P.ck,onhand:P.onhand[s],produced:pr,after:a,min:set?P.min[s]:null,max:set?P.max[s]:null,cap:cp,state:st});
      if(set&&pr>0&&a>P.max[s]){
        vlist.push({piece_id:pid,color:P.ck,after:a,max:P.max[s],over:a-P.max[s]});
        /* 3 กอง (ผลตรวจ 28 ก.ย. 69 ข้อ 2/13 — ห้ามปนกัน เพราะชิปสัญญาตัวเลข "% ที่ยืดได้" ไว้):
           เกิน cap = ห้ามข้าม (แดง) · max < after ≤ cap = "ยืดเพดาน" อยู่ในช่วงที่อนุญาต (เหลือง)
           max = 0 (ตั้งไว้ว่าไม่ใช้ชิ้นนี้ในสีนี้) = ไม่มี cap จึงไม่มี "%" มาสัญญา → กองของตัวเอง */
        if(cp==null)nclist.push({piece_id:pid,color:P.ck,after:a,max:P.max[s],cap:null,over:a-P.max[s]});
        else if(a>cp)oclist.push({piece_id:pid,color:P.ck,after:a,max:P.max[s],cap:cp,over:a-cp});
        else stlist.push({piece_id:pid,color:P.ck,after:a,max:P.max[s],cap:cp,over:a-P.max[s]});
      }
      if(set&&a<P.min[s])short.push({piece_id:pid,color:P.ck,need:P.min[s]-a});
    });
    Object.assign(out,{after,vlist,oclist,stlist,nclist,short,untracked,prod:pmap});
  }
  for(let t=0;t<touched.length;t++)prod[touched[t]]=0;
  return out;
}

/* ==================== applyLines — ผลของรายการสั่ง (สูตรเดียวกับทางเลือกที่ engine เสนอ) ==================== */
/* ทำไมชิ้นนี้ยังขาด: ครอบไม่ได้ (ctx.why) → ติดเพดาน (capWhy) → ยังสั่งไม่พอ (บอกแพทเทิร์นที่ให้ชิ้นนี้) */
function shortWhy(ctx,pid,ck,need,capWhy){
  const k=pid+'|'+ck,w=ctx.why.get(k);
  const rest=n=>{
    if(capWhy)return capWhy;
    const prod=ctx.pats.filter(p=>ctx.sheetBy.has(p.size_id+'|'+ck)&&p.yield.some(y=>y.piece_id===pid)).map(p=>p.code);
    return 'ยังขาด '+n+' ชิ้น'+(prod.length?' — เพิ่มแผ่นแพทเทิร์นที่ให้ชิ้นนี้ ('+listTxt(prod)+')':'');
  };
  if(w){
    /* เหตุเชิงโครงสร้างอธิบายได้แค่ gap ของมันเอง — ที่ขาดเกินกว่านั้นต้องมีเหตุของตัวเอง ไม่งั้นบรรทัดเดียวมีเลขขาด 2 ตัวที่ไม่ตรงกัน
       (ผลตรวจ 28 ก.ย. 69 ข้อ 3) */
    const g=ctx.whyGap.get(k)||0;
    return (need>g&&g>0)?w+' · อีก '+(need-g)+' ชิ้น '+rest(need-g):w;
  }
  return rest(need);
}
/* "สั่งเพิ่มไม่ได้เพราะจะทำให้ … เกินเพดาน" — จริงก็ต่อเมื่อ **ทุก** แพทเทิร์นที่ให้ชิ้นนี้ (และยังเพิ่มแผ่นได้) ทำให้ชิ้นใดชิ้นหนึ่งข้ามเส้น cap
   prodMap = ชิ้นที่รายการนี้ผลิตแล้ว (piece_id → จำนวน) · used = แผ่นที่สั่งไปแล้วต่อแพทเทิร์น (กันนับแบบที่เต็มเพดานแผ่นแล้ว)
   คืน '' เมื่อยังมีทางเติมได้ → ให้ข้อความเดิม ("เพิ่มแผ่นแพทเทิร์นที่ให้ชิ้นนี้") ทำงานแทน (ห้ามโทษเพดานทั้งที่ไม่ใช่) */
function capBlockWhy(ctx,P,ck,pid,prodMap,used){
  const cands=ctx.pats.filter(p=>ctx.sheetBy.has(p.size_id+'|'+ck)&&p.yield.some(y=>y.piece_id===pid)&&(used.get(p.id)||0)<ctx.S);
  if(!cands.length)return '';
  let blk=null;
  for(let i=0;i<cands.length;i++){
    const p=cands[i];let hit=null;
    for(let t=0;t<p.yield.length;t++){
      const y=p.yield[t],s=slotOf(ctx,P,y.piece_id),cp=P.cap[s];
      if(cp==null)continue;
      const a=P.onhand[s]+(prodMap.get(y.piece_id)||0)+y.qty;
      if(a>cp){hit={pid:y.piece_id,after:a,max:P.max[s],cap:cp};break;}
    }
    if(!hit)return '';                 /* มีแบบที่เติมได้โดยไม่ข้ามเส้น → ไม่ใช่เหตุเพดาน */
    if(!blk)blk=hit;
  }
  return 'สั่งเพิ่มไม่ได้เพราะจะทำให้ '+pieceLabel(ctx.pm,blk.pid)+' '+ctx.cname(ck)+' เกินเพดาน (จะมี '+blk.after+
    ' ชิ้น / เพดาน '+blk.max+' ยืดได้ถึง '+blk.cap+')';
}
/* lines → รายการมาตรฐาน + ผลรวมทุกสี
   โหมดปกติ (ปรับมือ / สร้างทางเลือก): แพทเทิร์น/ราคา/ผลผลิต อ่านจากทะเบียนปัจจุบัน (ctx)
     · บรรทัดมีราคา/ผลผลิตเดิมแต่ทะเบียนเปลี่ยนแล้ว = คิดด้วยทะเบียน + ข้อความ "ราคาในทะเบียนเปลี่ยนจาก ฿x เป็น ฿y" (ห้ามเปลี่ยนยอดเงียบ ๆ)
   โหมด snapshot (opts.snapshot=true · เปิดแก้ใบที่บันทึกแล้ว): ใช้ unit_price_satang / yield / sheet_* ในบรรทัด + ข้อความเมื่อทะเบียนต่างจากในใบ
   · ไม่พบแพทเทิร์น = ใช้ yield/code/ขนาดในบรรทัดเอง · ไม่มีราคาในทะเบียน = unit_price_satang ในบรรทัด (ถ้าเป็นจำนวนเต็ม) ไม่งั้น 0
   · แพทเทิร์น×สี ซ้ำ = รวมแผ่น · แผ่น 0 / ช่องว่าง = ตัดทิ้ง · แผ่นไม่ใช่จำนวนเต็มไม่ติดลบ = 0 + ข้อความ · เกินเพดานแผ่นต่อแพทเทิร์น = คิดให้ + ข้อความ
   · สีที่ปิดใช้งาน/ไม่มีในตั้งค่า = ไม่นำมาคิด + ข้อความบรรทัดเดียว */
function evaluateLines(ctx,lines,opts){
  const snap=!!(opts&&typeof opts==='object'&&opts.snapshot===true);
  const msgs=[],groups=new Map();
  const labelOf=(pid,src)=>{const reg=pid?ctx.patAll.get(pid):null;
    return reg?reg.code:((src&&typeof src.code==='string'&&src.code.trim())?src.code.trim():'แพทเทิร์นนอกทะเบียน');};
  (Array.isArray(lines)?lines:[]).forEach((L,i)=>{
    if(!L||typeof L!=='object')return;
    const pid=idOf(L.pattern_id),ck=idOf(L.color);
    if(!pid||!ck){msgs.push('รายการที่ '+(i+1)+(pid?' ('+labelOf(pid,L)+')':'')+': ไม่มีรหัสแพทเทิร์นหรือสี — ไม่นำมาคิด');return;}
    let x=blankVal(L.sheets)?0:nnInt(L.sheets);
    if(x===null){const raw=rawTxt(L.sheets);
      msgs.push('รายการที่ '+(i+1)+' ('+labelOf(pid,L)+'): จำนวนแผ่น'+(raw?' '+raw:'')+' ต้องเป็นจำนวนเต็มไม่ติดลบ — ถือเป็น 0');x=0;}
    const k=pid+'|'+ck,g=groups.get(k);
    if(g)g.sheets+=x;else groups.set(k,{pid,ck,sheets:x,src:L});
  });
  const out=[];
  groups.forEach(g=>{
    if(!g.sheets)return;
    const reg=ctx.patAll.get(g.pid),src=g.src,label=labelOf(g.pid,src),cn=ctx.cname(g.ck);
    if(!ctx.colIdx.has(g.ck)){msgs.push(label+' '+cn+' '+g.sheets+' แผ่น: '+cn+'ปิดใช้งานหรือไม่มีในตั้งค่า — ไม่นำมาคิด');return;}
    const lineYield=yieldCol(src);
    let yieldArr;
    if(!reg){yieldArr=lineYield;msgs.push(label+': ไม่พบแพทเทิร์นในทะเบียน — ใช้ผลผลิตที่อยู่ในรายการ');}
    else{
      if(snap&&lineYield.length){yieldArr=lineYield;if(!sameYield(lineYield,reg.yield))msgs.push(label+': ผังตัดในทะเบียนเปลี่ยนไปจากในใบนี้ — ใบนี้ใช้ผลผลิตตามที่บันทึกไว้');}
      else{yieldArr=reg.yield;if(!snap&&lineYield.length&&!sameYield(lineYield,reg.yield))msgs.push(label+': ผังตัดในทะเบียนเปลี่ยนไปจากตอนทำรายการ — คิดด้วยผังในทะเบียน');}
      if(!reg.active)msgs.push(label+': แพทเทิร์นปิดใช้งานอยู่');
      else if(reg.bad)msgs.push(label+': ผังตัดไม่ผ่านการตรวจ ('+reg.bad+')');
    }
    const code=snap&&typeof src.code==='string'&&src.code.trim()?src.code.trim():(reg?reg.code:String(src.code||g.pid));
    const size_id=(snap&&idOf(src.sheet_size_id))||(reg?reg.size_id:idOf(src.sheet_size_id));
    const sp=ctx.sheetBy.get(size_id+'|'+g.ck);
    const linePrice=nnInt(src.unit_price_satang);
    let unit;
    if(snap&&linePrice){unit=linePrice;
      if(sp&&sp.price!==linePrice)msgs.push(label+' '+cn+': ราคาในทะเบียนตอนนี้ '+bahtTxt(sp.price)+'/แผ่น — ใบนี้ใช้ราคาตามที่บันทึกไว้ '+bahtTxt(linePrice)+'/แผ่น');}
    else if(sp){unit=sp.price;
      if(!snap&&linePrice&&linePrice!==sp.price)msgs.push(label+' '+cn+': ราคาในทะเบียนเปลี่ยนจาก '+bahtTxt(linePrice)+' เป็น '+bahtTxt(sp.price)+'/แผ่น — คิดด้วยราคาในทะเบียน');}
    else{unit=linePrice||0;
      msgs.push(label+' '+cn+': แผ่น '+(sizeLabel(ctx.sizes.get(size_id))||'ของแพทเทิร์นนี้')+' ยังไม่มีราคาในทะเบียน'+
        (unit>0?' — ใช้ราคาในรายการ '+bahtTxt(unit)+'/แผ่น':' — คิดเป็น ฿0.00'));}
    if(g.sheets>ctx.S)msgs.push(label+' '+cn+' '+g.sheets+' แผ่น เกินเพดานแผ่นต่อแพทเทิร์น '+ctx.S+' แผ่น');
    const useLineSheet=snap&&(src.sheet_id!=null||typeof src.sheet_name==='string');
    out.push({pattern_id:g.pid,code,color:g.ck,sheets:g.sheets,sheet_size_id:size_id||null,
      sheet_id:useLineSheet&&src.sheet_id!=null?idOf(src.sheet_id):(sp?idOf(sp.row.id):(src.sheet_id!=null?idOf(src.sheet_id):null)),
      sheet_name:useLineSheet&&typeof src.sheet_name==='string'&&src.sheet_name?src.sheet_name:
        (sizeLabel(ctx.sizes.get(size_id))||(typeof src.sheet_name==='string'?src.sheet_name:'')),
      unit_price_satang:unit,amount_satang:g.sheets*unit,yield:yieldArr.map(y=>({piece_id:y.piece_id,qty:y.qty}))});
  });
  const cOrd=ck=>ctx.colIdx.has(ck)?ctx.colIdx.get(ck):1e6;
  out.sort((a,b)=>cOrd(a.color)-cOrd(b.color)||byStr(a.color,b.color)||natCmp(a.code,b.code)||byStr(a.pattern_id,b.pattern_id));
  /* สีที่ต้องคิด = สีที่มี need (ชิ้นขาดต้องโชว์ใน after แม้ไม่ได้สั่ง) + สีที่มีรายการ */
  const colorKeys=[...new Set(ctx.needs.map(n=>n.color).concat(out.map(l=>l.color)))].sort((a,b)=>cOrd(a)-cOrd(b)||byStr(a,b));
  const res={lines:out,total_satang:0,sheets_total:0,after:[],violations:0,violation_list:[],
    over_cap:0,over_cap_list:[],stretched:0,stretch_list:[],no_cap:0,no_cap_list:[],
    over_pct:ctx.over,excess_sqft:0,excess_mm2:0,
    complete:true,short_total:0,uncovered:[],untracked:[]};
  colorKeys.forEach(ck=>{
    const P=prepOf(ctx,ck);
    const mine=out.filter(l=>l.color===ck);
    const ents=mine.map(l=>({sheets:l.sheets,price:l.unit_price_satang,yl:l.yield.map(y=>[slotOf(ctx,P,y.piece_id),y.qty])}));
    const r=evalColor(P,ents,true);
    res.total_satang+=r.price;res.sheets_total+=r.sh;res.violations+=r.v;res.over_cap+=r.oc;res.excess_mm2+=r.ex;
    res.after.push(...r.after);res.violation_list.push(...r.vlist);res.untracked.push(...r.untracked);
    res.over_cap_list.push(...r.oclist);res.stretch_list.push(...r.stlist);res.no_cap_list.push(...r.nclist);
    const used=new Map(mine.map(l=>[l.pattern_id,l.sheets]));
    r.short.forEach(u=>res.uncovered.push({piece_id:u.piece_id,color:ck,need:u.need,
      why:shortWhy(ctx,u.piece_id,ck,u.need,capBlockWhy(ctx,P,ck,u.piece_id,r.prod,used))}));
  });
  res.stretched=res.stretch_list.length;res.no_cap=res.no_cap_list.length;
  res.excess_sqft=sqftOfMm2(res.excess_mm2);
  res.short_total=res.uncovered.reduce((a,u)=>a+(Number(u.need)||0),0);   /* ชิ้นที่ยังขาดรวม (ตัวเรียงอันดับเมื่อไม่มีทางไหนครบ) */
  res.complete=res.uncovered.length===0;
  res.messages=msgs;
  return res;
}
/* applyLines(lines, input, opts?) → {lines, total_satang, sheets_total, after, violations, violation_list,
                                      over_cap, over_cap_list, stretched, stretch_list, over_pct, excess_sqft, excess_mm2, complete, uncovered, untracked, messages}
   โหมดปรับมือยังยอมให้เกินเพดานได้ (คนตัดสินใจเอง) — violation_list = เกิน max (เหลือง) · over_cap_list = เกินเพดานที่ยืดได้แล้ว (แดง · ชุดย่อยของ violation_list)
   ใช้ตอนผู้ใช้ปรับจำนวนแผ่นเอง — คิดด้วยตัวเดียวกับที่ computeOptions ใช้สร้างทางเลือก (evaluateLines → evalColor)
   opts.snapshot=true = ใช้ราคา/ผลผลิตที่บันทึกในบรรทัด (เปิดแก้ใบร่าง/ตีกลับ) · ⚠️ หน้าแสดงใบที่บันทึกแล้วห้ามคิดใหม่ — อ่าน lines/after/total จากใบตรง ๆ */
function applyLines(lines,input,opts){
  const ctx=buildCtx(input);
  return evaluateLines(ctx,lines,opts);
}

/* ==================== explain — เหตุผลภาษาไทย อ้างตัวเลขในทางเลือกเท่านั้น ==================== */
/* explain(option, input, best?) → [ไทย]
   best = ทางอันดับ 1 (ส่งมาเมื่อ option ไม่ใช่อันดับ 1 → บอกว่าต่างกันอย่างไร) · ไม่คิดเลขใหม่ ใช้ค่าจาก option/best ล้วน
   ส่วนต่างชิ้นเกิน = ผลต่างของตัวเลข ตร.ฟุต ที่โชว์บนการ์ดสองใบ (ผู้ใช้ลบเองได้ตรง) · ทิศ มากกว่า/น้อยกว่า ตัดสินจาก มม.²
   ลำดับ: เทียบอันดับ 1 → ⛔ ยังขาด → ⚠️ ทะลุเพดาน → รายการสั่ง → ผลต่อชิ้น → ⚠️ ยังไม่ตั้งระดับ → ⚠️ ชิ้นนอกทะเบียน → สรุปยอด */
function explain(option,input,best){
  const o=(option&&typeof option==='object')?option:{};
  const ctx=input&&input.__ctx;
  const pm=ctx?ctx.pm:pieceMap(input&&input.pieces);
  const cols=ctx?ctx.cols:activeColorList(input&&input.colors);
  const cname=ctx?ctx.cname:(ck=>{const c=cols.find(x=>x.key===ck);return c?c.name:colorNameAny(input&&input.colors,ck);});
  const nm=pid=>pieceLabel(pm,pid);
  const lines=Array.isArray(o.lines)?o.lines:[],after=Array.isArray(o.after)?o.after:[];
  const R=[];
  const num=v=>Number(v)||0;
  if(best&&typeof best==='object'&&best!==o&&num(o.rank)!==1){
    const parts=[],dv=num(o.violations)-num(best.violations),dp=num(o.total_satang)-num(best.total_satang);
    const dm=(o.excess_mm2!=null&&best.excess_mm2!=null)?num(o.excess_mm2)-num(best.excess_mm2):num(o.excess_sqft)-num(best.excess_sqft);
    /* "ขาด" มาก่อน เพราะเป็นกุญแจแรกของการจัดอันดับ (ผลตรวจ 28 ก.ย. 69 ข้อ 5) — ไม่คิดเลขใหม่ ใช้ short_total ที่ engine ส่งมา */
    const ds=num(o.short_total)-num(best.short_total);
    if(ds>0)parts.push('ยังขาดมากกว่า '+ds+' ชิ้น');else if(ds<0)parts.push('ยังขาดน้อยกว่า '+(-ds)+' ชิ้น');
    if(dv>0)parts.push('ยืดเพดานมากกว่า '+dv+' รายการ');else if(dv<0)parts.push('ยืดเพดานน้อยกว่า '+(-dv)+' รายการ');
    parts.push(dp>0?'แพงกว่า '+bahtTxt(dp):dp<0?'ถูกกว่า '+bahtTxt(-dp):'ราคาเท่ากัน');
    const sq=Math.round(Math.abs(sqftOfMm2Shown(o)-sqftOfMm2Shown(best))*100)/100,sqT=sq>0?numTxt(sq):'ไม่ถึง 0.01';
    parts.push(dm>0?'ชิ้นเกินมากกว่า '+sqT+' ตร.ฟุต':dm<0?'ชิ้นเกินน้อยกว่า '+sqT+' ตร.ฟุต':'ชิ้นเกินเท่ากัน');
    if(!ds&&!dv&&!dp&&!dm)parts.push('ใช้ '+lines.length+' รายการ '+num(o.sheets_total)+' แผ่น (ทางที่ 1 ใช้ '+(Array.isArray(best.lines)?best.lines.length:0)+' รายการ '+num(best.sheets_total)+' แผ่น)');
    R.push('เทียบกับทางที่ 1: '+parts.join(' · '));
  }
  (Array.isArray(o.uncovered)?o.uncovered:[]).forEach(u=>R.push('⛔ ยังขาด '+nm(u.piece_id)+' '+cname(u.color)+' '+u.need+' ชิ้น'+(u.why?' — '+u.why:'')));
  const aBy=new Map(after.map(a=>[a.piece_id+'|'+a.color,a]));
  /* เกิน cap (⛔ ข้ามเส้นแล้ว — เกิดได้เฉพาะโหมดปรับมือ) ขึ้นก่อน · ยืดเพดาน (⚠️ ยังไม่ข้ามเส้น) ตามหลัง
     ใบเก่าที่บันทึกไว้ก่อนกติกานี้ไม่มี 2 ช่องนี้ → ใช้ violation_list แบบเดิม (ห้ามใบเก่าเปลี่ยนข้อความ) */
  const ocL=Array.isArray(o.over_cap_list)?o.over_cap_list:null,stL=Array.isArray(o.stretch_list)?o.stretch_list:null,
        ncL=Array.isArray(o.no_cap_list)?o.no_cap_list:null;
  const overTxt=x=>{const a=aBy.get(x.piece_id+'|'+x.color);
    return nm(x.piece_id)+' '+cname(x.color)+' จะมี '+x.after+' ชิ้น เกินเพดาน '+x.max+' อยู่ '+(num(x.after)-num(x.max))+
      ' ชิ้น'+(a&&a.min===0&&a.max===0?' (ตั้งไว้ว่าไม่ใช้ชิ้นนี้ในสีนี้)':'');};
  if(ocL||stL||ncL){
    (ocL||[]).forEach(x=>R.push('⛔ '+overTxt(x)+' — เกินเพดานที่ยืดได้แล้ว (ยืดได้ถึง '+x.cap+')'));
    (stL||[]).forEach(x=>R.push('⚠️ '+overTxt(x)+(x.cap!=null?' (ยังอยู่ในช่วงยืดเพดาน ไม่เกิน '+x.cap+')':'')));
    /* เพดาน 0 = "ไม่ใช้ชิ้นนี้ในสีนี้" → ไม่มี cap จึงไม่มี % มาสัญญา (overTxt ต่อท้ายให้แล้วว่าตั้งไว้ว่าไม่ใช้) */
    (ncL||[]).forEach(x=>R.push('⚠️ '+overTxt(x)));
  }else (Array.isArray(o.violation_list)?o.violation_list:[]).forEach(x=>R.push('⚠️ '+overTxt(x)));
  const producers=new Map();
  lines.forEach(l=>(Array.isArray(l.yield)?l.yield:[]).forEach(y=>{const k=y.piece_id+'|'+l.color;producers.set(k,(producers.get(k)||0)+1);}));
  const inlined=new Set();
  lines.forEach(l=>{
    const ys=Array.isArray(l.yield)?l.yield:[],x=num(l.sheets);
    let s=l.code+' '+cname(l.color)+' '+x+' แผ่น ได้ '+ys.map(y=>nm(y.piece_id)+' '+(x*num(y.qty))+' ชิ้น').join(' · ');
    if(ys.length===1){const k=ys[0].piece_id+'|'+l.color,a=aBy.get(k);
      if(a&&a.state===ST_OK&&producers.get(k)===1){s+=' → คงเหลือ '+a.onhand+' → '+a.after+' (ขั้นต่ำ '+a.min+' เพดาน '+a.max+')';inlined.add(k);}}
    R.push(s);
  });
  after.forEach(a=>{const k=a.piece_id+'|'+a.color;
    if(a.state===ST_OK&&!inlined.has(k))R.push(nm(a.piece_id)+' '+cname(a.color)+' คงเหลือ '+a.onhand+' → '+a.after+' (ขั้นต่ำ '+a.min+' เพดาน '+a.max+')');
    else if(a.state===ST_UNSET)R.push('⚠️ '+nm(a.piece_id)+' '+cname(a.color)+' ได้มา '+a.produced+' ชิ้น (คงเหลือ '+a.onhand+' → '+a.after+') แต่ยังไม่ได้ตั้งขั้นต่ำ/เพดาน — นับเป็นชิ้นเกินทั้งหมด');
  });
  (Array.isArray(o.untracked)?o.untracked:[]).forEach(u=>{const p=pm.get(u.piece_id),sized=!!p&&posInt(p.a_mm)>0&&posInt(p.b_mm)>0;
    R.push(sized?'⚠️ ได้ชิ้น '+nm(u.piece_id)+' '+cname(u.color)+' '+u.produced+' ชิ้น ที่ปิดใช้งานในทะเบียน — ไม่นับเข้าสต๊อก นับเป็นชิ้นเกิน'
      :'⚠️ ได้'+OUTSIDE_PIECE+' '+cname(u.color)+' '+u.produced+' ชิ้น (ไม่รู้ขนาด) — ไม่นับเข้าสต๊อก และไม่ได้นับเป็นชิ้นเกิน');});
  /* บรรทัดสรุป: 3 กองแยกกันเสมอ — "(ไม่เกิน x%)" พูดได้เฉพาะกองที่มี cap จริง (ผลตรวจ 28 ก.ย. 69 ข้อ 2/13) */
  let capTxt;
  if(ocL||stL||ncL){
    const cp=[];
    if(num(o.over_cap))cp.push('เกินเพดานที่ยืดได้ '+num(o.over_cap)+' รายการ');
    if(num(o.stretched))cp.push('ยืดเพดาน '+num(o.stretched)+' รายการ'+(o.over_pct!=null?' (ไม่เกิน '+num(o.over_pct)+'%)':''));
    if(num(o.no_cap))cp.push('ได้ชิ้นที่ตั้งว่าไม่ใช้ '+num(o.no_cap)+' รายการ');
    capTxt=cp.length?cp.join(' · '):'ไม่เกินเพดาน';
  }else capTxt=num(o.violations)?'ทะลุเพดาน '+num(o.violations)+' รายการ':'ไม่ทะลุเพดาน';
  R.push('รวม '+num(o.sheets_total)+' แผ่น · '+bahtTxt(o.total_satang)+' · ชิ้นเกิน '+numTxt(o.excess_sqft)+' ตร.ฟุต · '+
    capTxt+(o.complete===false?' · ยังขาด '+(o.uncovered||[]).length+' รายการ':''));
  return R;
}
/* ตร.ฟุต ที่โชว์บนการ์ด (ทศนิยม 2 ตำแหน่ง) — มี excess_sqft ใช้ตัวนั้น ไม่มีคิดจาก มม.² ด้วยสูตรเดียวกัน */
function sqftOfMm2Shown(o){return o.excess_sqft!=null?Number(o.excess_sqft)||0:sqftOfMm2(o.excess_mm2);}
/* summary ≤ 3 บรรทัด สำหรับหน้าการ์ด — หยิบจาก reasons ของ explain ตรง ๆ (ไม่แต่งข้อความ/ไม่คิดเลขใหม่)
   (1) บรรทัดสรุปยอด · (2) เทียบกับทางที่ 1 (ถ้ามี) · (3) คำเตือนสำคัญสุด: ⛔ ยังขาด ก่อน → ⚠️ แรก (+ "และเตือนอีก n รายการ") */
function summaryOf(R){
  const out=[];if(!Array.isArray(R)||!R.length)return out;
  out.push(R[R.length-1]);
  const cmp=R.find(s=>s.startsWith('เทียบกับทางที่ 1'));if(cmp)out.push(cmp);
  const warn=R.filter(s=>s.startsWith('⛔')||s.startsWith('⚠️'));
  const top=warn.find(s=>s.startsWith('⛔'))||warn[0];
  if(top)out.push(top+(warn.length>1?' (และเตือนอีก '+(warn.length-1)+' รายการ)':''));
  return out;
}
function summarize(option,input,best){return summaryOf(explain(option,input,best));}

/* ==================== computeOptions — ค้นทางเลือกต่อสี แล้วรวมเป็นใบ ==================== */
/* กุญแจเรียงของทางเลือกในสีเดียว: ทะลุเพดาน → ราคา → ชิ้นเกิน มม.² → รายการ → แผ่น → ลำดับแพทเทิร์น (index ตามรหัสแบบคน) → แผ่น */
function cntCmp(a,b){
  for(let i=0;i<Math.min(a.length,b.length);i++){const d=a[i][0]-b[i][0]||a[i][1]-b[i][1];if(d)return d;}
  return a.length-b.length;
}
/* กุญแจแรก = oc (เกินเพดานที่ยืดได้) → ขั้นปรับปรุงไต่ลงมาหา "ไม่เกินเพดาน" ได้เอง แทนการกั้นทางเดิน (ผลตรวจ 28 ก.ย. 69 ข้อ 9)
   ทุกทางในกองมี oc = 0 ⇒ กุญแจที่เหลือเหมือนเดิมเป๊ะ (ลำดับของทางที่เสนอไม่เปลี่ยน) */
function solCmp(a,b){return (a.oc||0)-(b.oc||0)||a.v-b.v||a.price-b.price||a.ex-b.ex||a.nl-b.nl||a.sh-b.sh||cntCmp(a.cnt,b.cnt);}
const cntEq=(a,b)=>a.length===b.length&&a.every((c,i)=>c[0]===b[i][0]&&c[1]===b[i][1]);

/* ค้นทางเลือกของสีเดียว → {C ผู้สมัคร, list ทางเลือกดีสุด ≤ max(K, OPT_POOL) เรียงแล้ว, stat}
   ความกว้างการค้นไม่ขึ้นกับ max_options (K): จุดเริ่มปรับปรุง = LS_STARTS ทาง · งบนับงาน · กองเก็บ ≥ OPT_POOL ทาง (ทางดีสุด OPT_POOL อันดับแรกของกองไม่ขึ้นกับขนาดกอง)
     → เส้นทางค้นเหมือนกันทุกค่า K · อันดับ 1 เหมือนกันทุกค่า K · ทางเลือกของ K น้อยเป็นส่วนต้นของ K มาก (เทสตรึงไว้)
   ทุกทางในกอง "ครอบ need ครบ" และ "ลดแผ่นไม่ได้อีก" (ทางที่ลดแผ่นได้แพ้ทางที่ลดแล้วเสมอ จึงไม่ให้กินที่ในกอง)
   ก) แพทเทิร์นเดียว: n = max ceil(need/ผลผลิต) — n น้อยสุดที่ครอบ ชนะทุก n ที่มากกว่า → ดีที่สุดจริงในกลุ่ม
   ข) สองแพทเทิร์น: ทุกคู่ที่ครอบ need รวมกันได้ × ทุก n = 1..S → m น้อยสุด → ดีที่สุดจริงในกลุ่ม
      หยุดไล่ n เมื่อแพทเทิร์นแรกครอบส่วนของตัวเองครบแล้ว หรือ m = 0
   ค) สามแพทเทิร์น: ถ้า (ชุด 3 แบบที่ครอบได้) × S × S ≤ TRIPLE_BUDGET → ไล่ครบทุก n1,n2 หา n3 น้อยสุด (ดีที่สุดจริงในกลุ่ม)
   ง) greedy: เติมทีละแผ่นด้วยแพทเทิร์นที่ "ครอบ need ที่เหลือ ÷ ราคา" สูงสุด
        4 แบบ = (วัดเป็นพื้นที่ชิ้น มม.² | จำนวนชิ้น) × (เลี่ยงแบบที่ทำให้ทะลุเพดานก่อน | ไม่เลี่ยง) · เสมอกัน → ทะลุเพดานเพิ่มน้อย → ถูกกว่า → รหัสก่อน
        + บังคับเริ่ม 1 แผ่นจากผู้สมัครทีละแบบ (2 แบบแรก · เรียงแบบคุ้มสุดก่อน · หยุดเมื่อหมดงบ GREEDY_WORK) · ครบแล้วลดแผ่นทีละใบ: ใบที่ถอดแล้วทะลุเพดานลดมากสุด → แพงสุด → ลำดับผู้สมัคร
   ฉ) ผู้สมัครน้อยมาก ((S+1)^J ≤ EXH_BUDGET): ไล่ครบทุกทาง (ตัดกิ่งที่ครอบไม่ได้) → ดีที่สุดจริง + ได้ทุกทางที่ลดแผ่นไม่ได้ (ทางเลือกครบ K ถ้ามีจริง) · ไม่ต้องทำ ง/จ
   จ) ปรับปรุงเฉพาะที่ (ไม่สุ่ม): เริ่มจากทางดีสุดในกองทีละทาง (≤ LS_STARTS ทาง) ขยับเฉพาะเมื่อกุญแจดีขึ้นจริง จนไม่มีก้าวไหนดีขึ้น หรือหมดงบ LS_WORK
        M1 ถอด r แผ่นของแบบ i (r = 1..n_i) แล้วเติมด้วยแบบ j จำนวนน้อยสุดที่กลับมาครบ (ลองทุก j) หรือเติมด้วย greedy ที่ห้ามใช้ i → ลดแผ่น
           (ไล่ i ตามลำดับ · แต่ละ i เลือกก้าวที่ดีสุด)
        M2 (เมื่อ M1 ไม่มีก้าวดีขึ้น) ถอดสองแบบพร้อมกัน (แต่ละแบบถอดทั้งหมด หรือ 1 แผ่น) แล้วเติมด้วยแบบเดียวที่น้อยสุด หรือ greedy ที่ห้ามทั้งสองแบบ → ลดแผ่น → เลือกก้าวดีสุด
        ทุกทางที่ประเมินเข้ากองด้วย (ทางเลือกหลากหลายขึ้น)
   ทุกทางแผ่นต่อแพทเทิร์น ≤ S · ไม่สุ่ม · ตัดทางซ้ำ
   พิสูจน์ (stat · ห้ามพูดเกินที่พิสูจน์):
     optimal_proven = ไล่ครบ (ฉ) หรือ ค้น ก/ข/ค ครบ และ (ผู้สมัคร ≤ 3 แบบ = ไล่ครบทุกทางแล้ว
                      หรือ ทางดีสุดใช้ ≤ 3 แบบ ไม่ทะลุเพดาน และราคาต่ำกว่าราคาต่ำสุดที่ทาง ≥ 4 แบบจะเป็นได้ = ราคาแผ่นของผู้สมัครถูกสุด 4 แบบรวมกัน)
     zero_violation_impossible = ทางดีสุดทะลุเพดาน และ (optimal_proven หรือ แม้ใช้แต่จำนวนแผ่นที่ยังไม่ทำให้ชิ้นใดทะลุเพดาน ก็ผลิตชิ้นที่ขาดได้ไม่ถึง need)
     violation_bound = ขอบบนข้างต้นอย่างเดียว (คิดทุกครั้ง · true ⇒ ไม่มีทางไม่ทะลุเพดานแน่นอน · เทสตรวจกับการไล่ครบ)
     triple_exhaustive = ค้นสามแบบครบ (ไม่ได้แปลว่าดีที่สุด — ให้ดู optimal_proven) · exhaustive = ไล่ครบ (ฉ) · budget_hit = หมดงบก่อนค้นจบ · work = หน่วยงานที่ใช้ */
function searchColor(ctx,ck,only){
  const P=prepOf(ctx,ck),S=ctx.S,KEEP=Math.max(ctx.K,OPT_POOL),run=g=>!only||only.includes(g);   /* only = เฉพาะกลุ่ม (ใช้ในเทสพิสูจน์ความแม่นยำต่อกลุ่ม) */
  const nd=ctx.needs.filter(n=>n.color===ck).map(n=>({pid:n.piece_id,n:ctx.eff.get(n.piece_id+'|'+ck)||0})).filter(x=>x.n>0);
  const k=nd.length,stat={color:ck,needs:k,candidates:0,covering_triples:0,triple_exhaustive:false,exhaustive:false,optimal_proven:false,zero_violation_impossible:false,violation_bound:false,partial:false,partial_exhaustive:false,over_pct:ctx.over,evaluations:0,work:0,forced_starts:0,budget_hit:false};
  if(!k)return {C:[],list:[],stat};
  const needIdx=new Map(nd.map((x,i)=>[x.pid,i]));
  const N=nd.map(x=>x.n),A=nd.map(x=>Math.max(1,P.area[slotOf(ctx,P,x.pid)]));
  const W=Math.ceil(k/32),full=new Array(W).fill(0);
  for(let i=0;i<k;i++)full[i>>5]=(full[i>>5]|(1<<(i&31)))>>>0;
  const C=[];
  ctx.pats.forEach(p=>{
    const sp=ctx.sheetBy.get(p.size_id+'|'+ck);if(!sp)return;
    const y=new Array(k).fill(0),mask=new Array(W).fill(0),cov=[];
    p.yield.forEach(r=>{const i=needIdx.get(r.piece_id);if(i!==undefined){y[i]=r.qty;mask[i>>5]=(mask[i>>5]|(1<<(i&31)))>>>0;cov.push([i,r.qty]);}});
    if(!cov.length)return;
    C.push({p,price:sp.price,y,mask,cov,yl:p.yield.map(r=>[slotOf(ctx,P,r.piece_id),r.qty])});
  });
  const J=C.length;stat.candidates=J;
  const NS=P.pid.length;
  /* ⭐ เส้นห้ามข้าม: CAPR[slot] = ผลิตได้อีกกี่ชิ้นก่อน after > cap (ไม่มี cap = Infinity · ติดลบ = ผลิตไม่ได้เลย)
     SJ[j] = แผ่นของแบบ j ที่ใส่ได้สูงสุดโดยลำพัง — เป็น **ขอบบนที่ถูกต้อง** ของทางที่เสนอได้จริง
       (แบบเดียวข้ามเส้นแล้ว แบบอื่นเติมเข้าไปอีกก็ยิ่งข้าม) จึงใช้ย่นวงไล่ครบของ ก/ข/ค/ฉ ได้โดยไม่ทิ้งคำตอบ
     ⚠️ ห้ามใช้ SJ/CAPR เป็น "กำแพง" ระหว่าง greedy เดินทีละแผ่น (ผลตรวจ 28 ก.ย. 69 ข้อ 9):
       ทางที่ครบและไม่เกินเพดานหลายทางต้องเดินผ่านสถานะที่ข้ามเส้นชั่วคราวก่อนถูกสลับแบบออก — กั้นตอนเดิน = หาไม่เจอทั้งที่มีจริง
       แทนที่ด้วยการให้ oc เป็น **กุญแจแรกของ solCmp** (ไต่ลงหา oc = 0 เอง) แล้วกรอง oc > 0 ทิ้งตอนจบ */
  const CAPR=new Array(NS);for(let sl=0;sl<NS;sl++)CAPR[sl]=(P.cap[sl]!=null)?P.cap[sl]-P.onhand[sl]:Infinity;
  /* ⭐ ผังที่ใส่แม้ "แผ่นเดียว" ก็ข้ามเส้นเพดานแล้ว = ใช้ไม่ได้เลยทั้งรอบ — ต้องจดไว้บอกผู้ใช้ ห้ามตัดทิ้งเงียบ ๆ
     เจ้าของเจอเอง 26 ต.ค. 69: ชิ้นที่ของล้นเส้นอยู่แล้วตั้งแต่ยังไม่สั่ง ทำให้ผังที่มีชิ้นนั้นหายจากทางเลือก
     โดยไม่มีคำอธิบายสักบรรทัด ถ้าผังที่หายไปถูกกว่า = จ่ายแพงขึ้นโดยไม่รู้ตัว (ขัดกฎ "ห้ามเงียบ" ในธรรมนูญ)
     หมายเหตุ: ของเดิมมีข้อความเฉพาะตอน "ทั้งสีสั่งไม่ได้เลย" (capStuck) ซึ่งไม่ครอบเคสที่ยังมีผังอื่นเหลือ */
  const capBlocked=[];
  const SJ=C.map(c=>{let m=S;const yl=c.yl;
    for(let t=0;t<yl.length;t++){const r=CAPR[yl[t][0]],q=yl[t][1];if(r===Infinity)continue;
      if(r<q){const sl=yl[t][0];
        capBlocked.push({pattern_id:c.p.id,code:c.p.code||c.p.id,piece_id:P.pid[sl],
          onhand:P.onhand[sl],max:P.max[sl],cap:P.cap[sl],qty:q});
        return 0;}
      const v=Math.floor(r/q);if(v<m)m=v;}
    return m;});
  stat.cap_blocked=capBlocked;
  let list=[],evals=0;
  const trim=()=>{list.sort(solCmp);const u=[];
    for(const s of list){if(u.length&&cntEq(u[u.length-1].cnt,s.cnt))continue;u.push(s);if(u.length>=KEEP)break;}list=u;};
  const canDrop=(j,got)=>{const cv=C[j].cov;for(let t=0;t<cv.length;t++){const i=cv[t][0];if(got[i]-cv[t][1]<N[i])return false;}return true;};
  /* เข้ากอง: ต้องครอบครบ · ลดแผ่นไม่ได้อีก · คืนทางที่ประเมินแล้ว หรือ null
     ทางที่ข้ามเส้น cap **เก็บไว้ในกองด้วย** (oc > 0) เพื่อเป็นบันไดให้ขั้นปรับปรุงไต่ลงมาหา oc = 0
     — ห้ามเสนอออกไป: กรองทิ้งทั้งหมดก่อนใช้งาน (ดู capOnly() ท้ายการค้น) */
  const push=cnt=>{
    if(!cnt||!cnt.length)return null;
    const got=new Array(k).fill(0);
    for(const c of cnt){const cv=C[c[0]].cov,n=c[1];for(let t=0;t<cv.length;t++)got[cv[t][0]]+=n*cv[t][1];}
    for(let i=0;i<k;i++)if(got[i]<N[i])return null;
    for(const c of cnt)if(canDrop(c[0],got))return null;
    evals++;
    const r=evalColor(P,cnt.map(c=>({sheets:c[1],price:C[c[0]].price,yl:C[c[0]].yl})),false);
    const sol={cnt,oc:r.oc,v:r.v,price:r.price,ex:r.ex,nl:r.nl,sh:r.sh};
    list.push(sol);
    if(list.length>4*KEEP+64)trim();
    return sol;
  };
  const covers=(...ms)=>{for(let w=0;w<W;w++){let u=0;for(const m of ms)u|=m[w];if((u>>>0)!==full[w])return false;}return true;};
  /* ก) แพทเทิร์นเดียว */
  if(run('single'))for(let j=0;j<J;j++){const y=C[j].y;let n=0,ok=true;
    for(let i=0;i<k;i++){if(!y[i]){ok=false;break;}n=Math.max(n,Math.ceil(N[i]/y[i]));}
    if(ok&&n>=1&&n<=Math.min(S,SJ[j]))push([[j,n]]);}
  /* ข) สองแพทเทิร์น */
  if(run('pair'))for(let a=0;a<J;a++)for(let b=a+1;b<J;b++){
    if(!covers(C[a].mask,C[b].mask))continue;
    const ya=C[a].y,yb=C[b].y,SA=Math.min(S,SJ[a]),SB=Math.min(S,SJ[b]);
    for(let n=1;n<=SA;n++){let m=0,feas=true,aDone=true;
      for(let i=0;i<k;i++){const r=N[i]-n*ya[i];if(r<=0)continue;if(ya[i])aDone=false;
        if(!yb[i])feas=false;else m=Math.max(m,Math.ceil(r/yb[i]));}
      if(feas){if(m===0)break;if(m<=SB)push([[a,n],[b,m]]);}
      if(aDone)break;}
  }
  /* ค) สามแพทเทิร์นแบบครบ (ถ้าอยู่ในงบ) */
  const T=[];let over=false;
  for(let a=0;a<J&&!over;a++)for(let b=a+1;b<J&&!over;b++)for(let c=b+1;c<J;c++){
    if(!covers(C[a].mask,C[b].mask,C[c].mask))continue;
    T.push([a,b,c]);if(T.length*S*S>TRIPLE_BUDGET){over=true;break;}}
  stat.covering_triples=over?-1:T.length;stat.triple_exhaustive=!over;
  if(!over&&run('triple')){const r1=new Array(k);
    T.forEach(([a,b,c])=>{const ya=C[a].y,yb=C[b].y,yc=C[c].y,SA=Math.min(S,SJ[a]),SB=Math.min(S,SJ[b]),SC=Math.min(S,SJ[c]);
      for(let n1=1;n1<=SA;n1++){let aDone=true;
        for(let i=0;i<k;i++){r1[i]=Math.max(0,N[i]-n1*ya[i]);if(r1[i]>0&&ya[i])aDone=false;}
        for(let n2=1;n2<=SB;n2++){let m=0,feas=true,bDone=true,stuck=false;
          for(let i=0;i<k;i++){const r=r1[i]-n2*yb[i];if(r<=0)continue;if(yb[i])bDone=false;
            if(!yc[i]){feas=false;if(!yb[i])stuck=true;}else m=Math.max(m,Math.ceil(r/yc[i]));}
          if(stuck)break;
          if(feas){if(m===0)break;if(m<=SC)push([[a,n1],[b,n2],[c,m]]);}
          if(bDone)break;}
        if(aDone)break;}
    });
  }
  /* ฉ) ผู้สมัครน้อยมาก: ไล่ครบทุกทางเมื่อ (S+1)^J ≤ EXH_BUDGET → ได้ทุกทางที่ครอบครบและลดแผ่นไม่ได้อีก = ดีที่สุดจริง + ทางเลือกครบเท่าที่มีจริง (ไม่ต้อง greedy) */
  let leaves=1;for(let j=0;j<J&&leaves<=EXH_BUDGET;j++)leaves*=S+1;
  const exh=leaves<=EXH_BUDGET&&run('exhaustive');
  stat.exhaustive=exh;
  if(exh){
    const x=new Array(J).fill(0),got=new Array(k).fill(0),suf=new Array(J+1);
    const SX=C.map((c,j)=>Math.min(S,SJ[j]));      /* เกินนี้ข้ามเส้น cap แน่ ๆ (แบบเดียวก็ข้ามแล้ว) → ไม่ต้องไล่ */
    suf[J]=new Array(k).fill(0);
    for(let j=J-1;j>=0;j--){suf[j]=suf[j+1].slice();for(let i=0;i<k;i++)suf[j][i]+=SX[j]*C[j].y[i];}
    const dfs=j=>{
      const sf=suf[j];for(let i=0;i<k;i++)if(got[i]+sf[i]<N[i])return;      /* แบบที่เหลือใส่เต็มเพดานแผ่นก็ยังไม่ครบ → ตัดกิ่ง */
      if(j===J){const cnt=[];for(let t=0;t<J;t++)if(x[t])cnt.push([t,x[t]]);push(cnt);return;}
      const cv=C[j].cov,Sj=SX[j];
      for(let v=0;v<=Sj;v++){
        if(v){x[j]=v;for(let t=0;t<cv.length;t++)got[cv[t][0]]+=cv[t][1];}
        dfs(j+1);
      }
      for(let t=0;t<cv.length;t++)got[cv[t][0]]-=Sj*cv[t][1];
      x[j]=0;
    };
    dfs(0);
  }
  /* ---- สถานะแบบเวกเตอร์ (greedy + ปรับปรุง): x แผ่นต่อผู้สมัคร · got ชิ้นที่ครอบ need · pr ผลผลิตต่อช่อง · rem need ที่ยังขาดรวม ---- */
  /* ROOM = ผลิตได้อีกกี่ชิ้นก่อนทะลุเพดาน (ไม่ได้ตั้งระดับ/นอกทะเบียน = ไม่จำกัด) · ทะลุ ⇔ ผลิต > 0 และ > ROOM (สูตรเดียวกับ evalColor) */
  const ROOM=new Array(NS);for(let sl=0;sl<NS;sl++)ROOM[sl]=(P.reg[sl]===1&&P.lv[sl]===1)?P.max[sl]-P.onhand[sl]:Infinity;
  /* work = หน่วยงานโดยประมาณ (นับรอบวนชั้นในของ greedy / ลดแผ่น / ประเมินทาง) → งบเวลาแบบนับงาน ไม่ใช้นาฬิกา → ผลเหมือนกันทุกเครื่อง */
  let work=0;
  const newSt=()=>{work+=J+k+NS;const s={x:new Array(J).fill(0),got:new Array(k).fill(0),pr:new Array(NS).fill(0),rem:0};for(let i=0;i<k;i++)s.rem+=N[i];return s;};
  const cloneSt=s=>{work+=J+k+NS;return {x:s.x.slice(),got:s.got.slice(),pr:s.pr.slice(),rem:s.rem};};
  const addSt=(s,j,d)=>{const cj=C[j],cv=cj.cov,yl=cj.yl;s.x[j]+=d;work+=cv.length+yl.length;
    for(let t=0;t<cv.length;t++){const i=cv[t][0],b=N[i]-s.got[i];s.got[i]+=d*cv[t][1];const a=N[i]-s.got[i];s.rem-=(b>0?b:0)-(a>0?a:0);}
    for(let t=0;t<yl.length;t++)s.pr[yl[t][0]]+=d*yl[t][1];};
  const cntOfSt=s=>{work+=J;const c=[];for(let j=0;j<J;j++)if(s.x[j]>0)c.push([j,s.x[j]]);return c;};
  /* ลดแผ่นจนลดไม่ได้อีก: ถอดใบที่ทำให้ทะลุเพดานลดมากสุด → แพงสุด → ลำดับผู้สมัคร */
  const reduceSt=s=>{
    for(;;){let best=-1,bdv=-1,bp=-1;work+=J;
      for(let j=0;j<J;j++){if(!s.x[j])continue;work+=C[j].cov.length;if(!canDrop(j,s.got))continue;
        let dv=0;const yl=C[j].yl;work+=yl.length;
        for(let t=0;t<yl.length;t++){const sl=yl[t][0],p=s.pr[sl],p2=p-yl[t][1];if(p>0&&p>ROOM[sl]&&!(p2>0&&p2>ROOM[sl]))dv++;}
        if(dv>bdv||(dv===bdv&&C[j].price>bp)){best=j;bdv=dv;bp=C[j].price;}}
      if(best<0)return s;
      addSt(s,best,-1);}
  };
  /* เติม 1 แผ่นของแบบ j แล้วมีชิ้นกี่ชนิดที่เริ่มทะลุเพดาน */
  const dvAdd=(s,j)=>{let dv=0;const yl=C[j].yl;work+=yl.length;
    for(let t=0;t<yl.length;t++){const sl=yl[t][0],p=s.pr[sl];if(!(p>0&&p>ROOM[sl])&&p+yl[t][1]>ROOM[sl])dv++;}return dv;};
  /* เติม 1 แผ่นของแบบ j แล้วข้ามเส้น cap ไหม (true = ห้ามเติม) */
  const capAdd=(s,j)=>{const yl=C[j].yl;work+=yl.length;
    for(let t=0;t<yl.length;t++){const sl=yl[t][0],r=CAPR[sl];if(r===Infinity)continue;if(s.pr[sl]+yl[t][1]>r)return true;}
    return false;};
  const modes=[{area:true,avert:true},{area:false,avert:true},{area:true,avert:false},{area:false,avert:false}];
  const cvr=Array.from({length:k},()=>[]);for(let j=0;j<J;j++)C[j].cov.forEach(([i])=>cvr[i].push(j));   /* cvr[i] = ผู้สมัครที่ให้ชิ้นขาดตัวที่ i */
  const mark=new Array(J).fill(0);let stamp=0;
  /* เติมทีละแผ่นจนครบ (ban[j] = ห้ามใช้แบบ j) · คืน false ถ้าเติมไม่ได้
     เลือก: (โหมดเลี่ยง) แบบที่ไม่ทำให้ทะลุเพดานก่อน → คุ้มสุด (ครอบ need ที่เหลือ ÷ ราคา) → ทะลุเพดานเพิ่มน้อย → ถูกกว่า → ลำดับผู้สมัคร
     สแกนเฉพาะผู้สมัครที่ให้ชิ้นที่ยังขาด และนับทะลุเพดานเฉพาะเมื่อจำเป็นต่อการตัดสิน — ได้ผลเท่ากับไล่ทุกแบบ แต่เร็วกว่า */
  const fill=(s,mode,ban)=>{
    const area=mode.area,avert=mode.avert;
    while(s.rem>0){
      stamp++;work+=k;
      for(let i=0;i<k;i++){if(N[i]-s.got[i]<=0)continue;const L=cvr[i];work+=L.length;for(let t=0;t<L.length;t++)mark[L[t]]=stamp;}
      let best=-1,bv=0,bp=1,bd=0;
      for(let j=0;j<J;j++){if(mark[j]!==stamp||(ban&&ban[j])||s.x[j]>=S)continue;const cj=C[j];
        let val=0;const cv=cj.cov;work+=cv.length;
        for(let t=0;t<cv.length;t++){const i=cv[t][0],q=cv[t][1],r=N[i]-s.got[i];if(r>0)val+=(r<q?r:q)*(area?A[i]:1);}
        if(val<=0)continue;
        /* ⛔ ห้ามใส่กำแพง cap ตรงนี้ (ผลตรวจ 28 ก.ย. 69 ข้อ 9) — โหมด avert เลี่ยง "เกิน max" อยู่แล้ว และ cap ≥ max เสมอ
           การกั้นตรงนี้ทำให้ทางที่ครบและไม่เกินเพดานหาไม่เจอ (ชุดจริง ขั้นต่ำ 15 เพดาน 20 ยืด 0%: 243 แผ่นครบ → กลายเป็น 255 แผ่นยังขาด) */
        if(best<0){best=j;bv=val;bp=cj.price;bd=dvAdd(s,j);continue;}
        const lhs=val*bp,rhs=bv*cj.price;
        if(avert&&bd===0){if(lhs<rhs)continue;if(dvAdd(s,j)>0)continue;
          if(lhs>rhs||cj.price<bp){best=j;bv=val;bp=cj.price;}continue;}
        if(avert){const dv=dvAdd(s,j);
          if(dv===0||lhs>rhs||(lhs===rhs&&(dv<bd||(dv===bd&&cj.price<bp)))){best=j;bv=val;bp=cj.price;bd=dv;}continue;}
        if(lhs<rhs)continue;
        const dv=dvAdd(s,j);
        if(lhs>rhs||dv<bd||(dv===bd&&cj.price<bp)){best=j;bv=val;bp=cj.price;bd=dv;}
      }
      if(best<0)return false;
      addSt(s,best,1);
    }
    return true;
  };
  const greedy=(start,mode,ban)=>{const s=newSt();
    (start||[]).forEach(([j,n])=>{if(n>0)addSt(s,j,Math.min(n,S));});
    if(!fill(s,mode,ban))return null;
    return cntOfSt(reduceSt(s));};
  if(run('greedy')&&!exh){
    modes.forEach(m=>push(greedy(null,m,null)));
    /* บังคับเริ่ม 1 แผ่นจากผู้สมัครทีละแบบ: เรียงแบบที่คุ้มสุด (พื้นที่ชิ้นที่ขาด ÷ ราคา) ก่อน → ลำดับผู้สมัคร · หยุดเมื่อหมดงบ GREEDY_WORK */
    const g0=work,order=C.map((c,j)=>{let v=0;c.cov.forEach(([i,q])=>{v+=Math.min(N[i],q)*A[i];});return {j,v,p:c.price};})
      .sort((a,b)=>b.v*a.p-a.v*b.p||a.j-b.j).map(o=>o.j);
    let started=0;
    for(const j of order){if(work-g0>=GREEDY_WORK)break;started++;for(let mi=0;mi<2;mi++)push(greedy([[j,1]],modes[mi],null));}
    stat.forced_starts=started;
    trim();
    /* จ) ปรับปรุงเฉพาะที่ */
    const starts=list.slice(0,LS_STARTS),seen=new Map(),ban=new Array(J).fill(false);
    const w0=work,inBudget=()=>work-w0<LS_WORK;
    const sigOf=cnt=>{let t='';for(const c of cnt)t+=c[0]+':'+c[1]+',';return t;};
    /* ประเมินสถานะที่ลดแผ่นแล้ว (ซ้ำ = ใช้ผลเดิม ไม่เข้ากองซ้ำ) */
    const tryIt=s=>{const cnt=cntOfSt(s),sg=sigOf(cnt);if(seen.has(sg))return seen.get(sg);work+=k+NS;const sol=push(cnt);seen.set(sg,sol);return sol;};
    /* เติมส่วนที่ขาดของ base แล้วเสนอเป็นก้าว: แบบเดียว j จำนวนน้อยสุด (ทุก j ที่ไม่ถูกห้าม) + greedy 2 แบบ (ถ้า withGreedy) */
    const refill=(base,D,take,withGreedy)=>{
      work+=J;
      for(let j=0;j<J;j++){
        if(ban[j]||base.x[j]>=S)continue;
        const yj=C[j].y;let m=0,ok=true;
        for(let t=0;t<D.length;t++){const d=D[t],q=yj[d];if(!q){ok=false;break;}const need=Math.ceil((N[d]-base.got[d])/q);if(need>m)m=need;}
        if(!ok||base.x[j]+m>S)continue;
        const t=cloneSt(base);addSt(t,j,m);reduceSt(t);take(t,tryIt(t));
      }
      if(withGreedy)for(let mi=0;mi<2;mi++){const t=cloneSt(base);if(fill(t,modes[mi],ban)){reduceSt(t);take(t,tryIt(t));}}
    };
    const deficits=base=>{work+=k;const D=[];for(let d=0;d<k;d++)if(base.got[d]<N[d])D.push(d);return D;};
    for(const st of starts){
      if(!inBudget())break;
      const sg0=sigOf(st.cnt);if(seen.has(sg0))continue;
      seen.set(sg0,st);
      let s=newSt();st.cnt.forEach(([j,n])=>addSt(s,j,n));
      let cur=st;
      for(;;){
        if(!inBudget())break;
        let moved=false;
        /* M1 ถอด r แผ่นของแบบ i (r = 1..ทั้งหมด) แล้วเติม (ไล่ i ตามลำดับ · แต่ละ i เลือกก้าวดีสุด) */
        for(let i=0;i<J&&inBudget();i++){
          if(!s.x[i])continue;
          let bSol=null,bSt=null;
          const take=(t,sol)=>{if(sol&&solCmp(sol,bSol||cur)<0){bSol=sol;bSt=t;}};
          const rMax=s.x[i];
          for(let r=1;r<=rMax&&inBudget();r++){
            const base=cloneSt(s);addSt(base,i,-r);
            const D=[];C[i].cov.forEach(([d])=>{if(base.got[d]<N[d])D.push(d);});
            if(!D.length)continue;
            ban[i]=true;refill(base,D,take,true);ban[i]=false;
          }
          if(bSol){s=bSt;cur=bSol;moved=true;}
        }
        if(moved)continue;
        /* M2 (เมื่อ M1 ไม่มีก้าวดีขึ้น) ถอดสองแบบพร้อมกัน (แต่ละแบบถอดทั้งหมด หรือ 1 แผ่น) แล้วเติมโดยห้ามสองแบบนั้น → เลือกก้าวดีสุด */
        const used=[];for(let j=0;j<J;j++)if(s.x[j])used.push(j);
        let bSol=null,bSt=null;
        const take=(t,sol)=>{if(sol&&solCmp(sol,bSol||cur)<0){bSol=sol;bSt=t;}};
        for(let a=0;a<used.length&&inBudget();a++)for(let b=a+1;b<used.length&&inBudget();b++){
          const i1=used[a],i2=used[b],r1s=s.x[i1]>1?[s.x[i1],1]:[1],r2s=s.x[i2]>1?[s.x[i2],1]:[1];
          for(const r1 of r1s)for(const r2 of r2s){
            if(!inBudget())break;
            const base=cloneSt(s);addSt(base,i1,-r1);addSt(base,i2,-r2);
            const D=deficits(base);
            if(!D.length)continue;
            ban[i1]=ban[i2]=true;refill(base,D,take,true);ban[i1]=ban[i2]=false;
          }
        }
        if(bSol){s=bSt;cur=bSol;continue;}
        break;
      }
    }
    stat.budget_hit=!inBudget()||started<J;
  }
  trim();
  /* ทางที่ข้ามเส้น cap เป็นแค่บันไดของขั้นปรับปรุง — ห้ามหลุดออกไปเป็นทางเลือกเด็ดขาด */
  const capOnly=()=>{list=list.filter(z=>!z.oc);};
  capOnly();
  /* ---- ไม่มีทางไหน "ครบขั้นต่ำ + ไม่ข้ามเส้น cap" → เสนอทางที่ดีที่สุดเท่าที่ไม่ข้ามเส้น (ยอมให้ยังขาด · เรียงขาดน้อยสุดก่อน) ---- */
  if(!list.length&&run('partial')){
    const plist=[];
    const SX=C.map((c,j)=>Math.min(S,SJ[j]));
    const shortOf=got=>{let t=0;for(let i=0;i<k;i++){const r=N[i]-got[i];if(r>0)t+=r;}return t;};
    /* "เติมอีกไม่ได้แล้ว" — ถ้ายังมีแบบที่เติมได้โดยไม่ข้ามเส้นแล้วของที่ขาดลดลง ทางนี้ไม่ใช่ทางที่ควรเสนอ (ทางที่เติมแล้วชนะเสมอ) */
    const pMax=(cnt,got)=>{
      const pr=new Array(NS).fill(0),cur=new Array(J).fill(0);
      for(const c of cnt){cur[c[0]]=c[1];const yl=C[c[0]].yl;for(let t=0;t<yl.length;t++)pr[yl[t][0]]+=c[1]*yl[t][1];}
      for(let j=0;j<J;j++){
        if(cur[j]>=SX[j])continue;
        const yl=C[j].yl;let bad=false;
        for(let t=0;t<yl.length&&!bad;t++){const sl=yl[t][0],r=CAPR[sl];if(r!==Infinity&&pr[sl]+yl[t][1]>r)bad=true;}
        if(bad)continue;
        const cv=C[j].cov;
        for(let t=0;t<cv.length;t++)if(got[cv[t][0]]<N[cv[t][0]])return false;
      }
      return true;
    };
    const pushP=cnt=>{
      if(!cnt||!cnt.length)return null;
      const got=new Array(k).fill(0);
      for(const c of cnt){const cv=C[c[0]].cov,n=c[1];for(let t=0;t<cv.length;t++)got[cv[t][0]]+=n*cv[t][1];}
      if(!pMax(cnt,got))return null;
      evals++;
      const r=evalColor(P,cnt.map(c=>({sheets:c[1],price:C[c[0]].price,yl:C[c[0]].yl})),false);
      if(r.oc>0)return null;
      const sol={cnt,short:shortOf(got),v:r.v,price:r.price,ex:r.ex,nl:r.nl,sh:r.sh};
      plist.push(sol);return sol;
    };
    if(exh){   /* ผู้สมัครน้อย = ไล่ครบทุกทางที่ไม่ข้ามเส้น (ไม่ตัดกิ่งด้วยความครบ) → ขาดน้อยสุดจริง */
      stat.partial_exhaustive=true;
      const xp=new Array(J).fill(0);
      const dfsP=j=>{
        if(j===J){const cnt=[];for(let t=0;t<J;t++)if(xp[t])cnt.push([t,xp[t]]);pushP(cnt);return;}
        for(let v=0;v<=SX[j];v++){xp[j]=v;dfsP(j+1);}
        xp[j]=0;
      };
      dfsP(0);
    }else{
      /* เติมทีละแผ่นเท่าที่ไม่ข้ามเส้น (คุ้มสุดก่อน) แล้วถอดแผ่นที่ไม่ได้ช่วยครอบอะไรเลย */
      const pfill=(s,area,ban)=>{
        for(;;){
          let best=-1,bv=0,bp=1;work+=J;
          for(let j=0;j<J;j++){
            if(s.x[j]>=SX[j]||(ban&&ban[j]))continue;
            let val=0;const cv=C[j].cov;work+=cv.length;
            for(let t=0;t<cv.length;t++){const i=cv[t][0],q=cv[t][1],r=N[i]-s.got[i];if(r>0)val+=(r<q?r:q)*(area?A[i]:1);}
            if(val<=0)continue;
            if(capAdd(s,j))continue;
            const pj=C[j].price;
            if(best<0||val*bp>bv*pj||(val*bp===bv*pj&&pj<bp)){best=j;bv=val;bp=pj;}
          }
          if(best<0)return s;
          addSt(s,best,1);
        }
      };
      const pReduce=s=>{
        for(;;){let best=-1,bp=-1;work+=J;
          for(let j=0;j<J;j++){if(!s.x[j])continue;const cv=C[j].cov;let ok=true;work+=cv.length;
            for(let t=0;t<cv.length;t++){const i=cv[t][0],g=s.got[i],q=cv[t][1];
              if((g<N[i]?g:N[i])!==((g-q)<N[i]?(g-q):N[i])){ok=false;break;}}
            if(!ok)continue;
            if(C[j].price>bp){best=j;bp=C[j].price;}}
          if(best<0)return s;
          addSt(s,best,-1);}
      };
      const pstart=(j0,area)=>{const s=newSt();
        if(j0>=0){if(SX[j0]<1||capAdd(s,j0))return null;addSt(s,j0,1);}
        pfill(s,area);pReduce(s);return cntOfSt(s);};
      [true,false].forEach(area=>pushP(pstart(-1,area)));
      const p0=work;
      for(let j=0;j<J;j++){if(work-p0>=GREEDY_WORK)break;[true,false].forEach(area=>pushP(pstart(j,area)));}
      /* ขั้นซ่อม: ถอดแผ่นของแบบหนึ่งออก (คืนที่ว่างใต้เส้น cap ให้ชิ้นที่ชนเส้น) แล้วเติมใหม่โดยห้ามใช้แบบนั้น
         — บางทีทางที่ "ครบขั้นต่ำและไม่ข้ามเส้น" มีจริง แต่การเติมทีละแผ่นแบบคุ้มสุดเดินไปชนเส้นก่อน · ได้ทางที่ครบ = เข้ากองปกติ (push) */
      const rban=new Array(J).fill(false),w0=work,inB=()=>work-w0<LS_WORK;
      const seeds=plist.slice().sort((a,b)=>a.short-b.short||solCmp(a,b)).slice(0,LS_STARTS);
      for(let si=0;si<seeds.length&&inB();si++){
        const s0=newSt();seeds[si].cnt.forEach(([j,n])=>addSt(s0,j,n));
        for(let i=0;i<J&&inB();i++){
          if(!s0.x[i])continue;
          const mx=s0.x[i];
          for(let rr=1;rr<=mx&&inB();rr++){
            rban[i]=true;
            for(let a=0;a<2;a++){
              const t=cloneSt(s0);addSt(t,i,-rr);pfill(t,a===0,rban);pReduce(t);
              const cnt=cntOfSt(t);if(!push(cnt))pushP(cnt);
            }
            rban[i]=false;
          }
        }
      }
      stat.budget_hit=stat.budget_hit||!inB();
    }
    capOnly();
    if(list.length){trim();capOnly();}  /* ขั้นซ่อมหาทางที่ครบเจอ → ใช้กองปกติ ไม่ใช่ทางที่ยังขาด */
    else{
      plist.sort((a,b)=>a.short-b.short||solCmp(a,b));
      const u=[];
      for(const s of plist){if(u.length&&cntEq(u[u.length-1].cnt,s.cnt))continue;u.push(s);if(u.length>=KEEP)break;}
      list=u;
      stat.partial=list.length>0;
    }
  }
  stat.evaluations=evals;stat.work=work;
  if(!only&&list.length&&stat.partial){
    stat.optimal_proven=stat.partial_exhaustive;
  }else if(!only&&list.length){
    const best=list[0];
    let sum4=Infinity;
    if(J>=4){const pr=C.map(c=>c.price).sort((a,b)=>a-b);sum4=pr[0]+pr[1]+pr[2]+pr[3];}
    stat.optimal_proven=exh||(!over&&(J<=3||(best.nl<=3&&best.v===0&&best.price<sum4)));
    /* ขอบบน (คิดทุกครั้ง เพื่อให้เทสตรวจความถูกต้องของขอบได้): แผ่นของแบบ j ที่ใส่ได้โดยไม่ทำให้ชิ้นใดทะลุเพดาน (u_j) → ผลิตชิ้นที่ขาดได้สูงสุดเท่าไร
       ไม่ถึง need แม้ชิ้นเดียว = ไม่มีทางที่ครอบครบโดยไม่ทะลุเพดานแน่นอน */
    const u=C.map(c=>{let m=S;for(const [sl,q] of c.yl){if(P.reg[sl]!==1||P.lv[sl]!==1)continue;const room=P.max[sl]-P.onhand[sl];if(room<q)return 0;m=Math.min(m,Math.floor(room/q));}return m;});
    let bound=false;
    for(let i=0;i<k&&!bound;i++){const sl=slotOf(ctx,P,nd[i].pid);let cap=0;C.forEach((c,j)=>{cap+=c.y[i]*u[j];});
      if(Math.min(cap,P.max[sl]-P.onhand[sl])<N[i])bound=true;}
    stat.violation_bound=bound;
    if(best.v>0)stat.zero_violation_impossible=stat.optimal_proven||bound;
  }
  return {C,list,stat};
}
/* _searchColor(input, colorKey, groups?) → ทางเลือกของสีเดียวจากกลุ่มที่เลือก ('single'|'pair'|'triple'|'greedy') — ใช้ในเทสเท่านั้น หน้าเว็บใช้ computeOptions */
function _searchColor(input,ck,groups){
  const ctx=buildCtx(input),r=searchColor(ctx,idOf(ck),Array.isArray(groups)?groups:null);
  return {stat:r.stat,list:r.list.map(x=>({lines:x.cnt.map(([j,n])=>({pattern_id:r.C[j].p.id,code:r.C[j].p.code,sheets:n})),
    violations:x.v,total_satang:x.price,excess_mm2:x.ex,lines_n:x.nl,sheets_total:x.sh,short:x.short||0}))};
}

/* computeOptions(input) → {options:[…เรียงแล้ว ≤ max_options], messages:[ไทย], uncoverable:[{piece_id,color,need,why}], needs:[…],
                            stock_snapshot:[…ดู computeNeeds], search:[สถิติต่อสี], optimal_proven, blocked}
   · คิดต่อสีอิสระ → ทางดีสุดของแต่ละสี (≤ K) จับคู่ทุกแบบทีละสี เรียงด้วยผลรวมกุญแจ แล้วตัดเหลือ K (แม่นยำ: กุญแจตัวเลขเป็นผลบวก จึงตัดทีละสีได้โดยไม่ทิ้งทางที่ควรติดอันดับ)
   · ทุกทางเลือกสร้างผ่าน evaluateLines (ตัวเดียวกับ applyLines) แล้วเรียงซ้ำด้วยค่าจากตัวนั้น · เหตุผลจาก explain · summary ≤ 3 บรรทัดจาก reasons
   · optimal_proven = พิสูจน์ได้ว่าอันดับ 1 ดีที่สุดจริงตามกุญแจ (ทุกสีที่ต้องสั่ง) · false = "ดีที่สุดที่ระบบหาเจอ" (หน้าจอห้ามเขียนว่าถูกที่สุด)
   · blocked = 'no_input'|'bad_input'|'no_colors'|'no_pieces'|'no_levels'|null — ตั้งของไม่ครบจนคำนวณไม่ได้ (หน้าจอปิดปุ่มคำนวณพร้อมข้อความ)
   · ไม่ throw — ข้อมูลเสียกลายเป็นข้อความ */
function computeOptions(input){
  const empty=(msg,blocked)=>({options:[],messages:[msg],uncoverable:[],needs:[],stock_snapshot:[],search:[],optimal_proven:false,over_pct:OPT_OVER_PCT,blocked});
  if(!input||typeof input!=='object'||Array.isArray(input))return empty('คำนวณไม่ได้: ไม่มีข้อมูลเข้า',"no_input");
  let ctx;
  try{ctx=buildCtx(input);}catch(e){return empty('คำนวณไม่ได้: ข้อมูลเข้าเสีย (ตรวจทะเบียนและตั้งค่า)','bad_input');}
  const messages=ctx.warnings.concat(ctx.messages);
  ctx.uncoverable.forEach(u=>messages.push(u.why));
  const res={options:[],messages,uncoverable:[],needs:[],stock_snapshot:ctx.snapshot,search:[],optimal_proven:false,over_pct:ctx.over,blocked:ctx.blocked};
  if(ctx.blocked)return res;
  if(!ctx.needs.length){
    const st=ctx.needStats;
    messages.push('ไม่มีชิ้นที่ขาด — คงเหลือไม่ต่ำกว่าขั้นต่ำทุกชิ้นที่ตั้งระดับไว้ (ตั้งระดับแล้ว '+st.levels_set+' จาก '+(st.pieces*st.colors)+' ชิ้น×สี) ยังไม่ต้องสั่ง');
    return res;
  }
  res.needs=ctx.needs;res.uncoverable=ctx.uncoverable;
  const per=[],search=res.search,capStuck=[];
  let cutMore=0;   /* ทางที่หาเจอแต่ถูกตัดทิ้งเพราะเกิน "จำนวนทางเลือกสูงสุด" — ต้องบอกว่ามีอยู่ ห้ามเงียบ
                      ตัดสองชั้น: ชั้นต่อสี (ตรงนี้) และชั้นรวมสี (ตอนประกอบ combos) */
  ctx.cols.forEach((c,ci)=>{
    if(!ctx.needs.some(n=>n.color===c.key))return;
    const r=searchColor(ctx,c.key);search.push(r.stat);
    if(r.list.length>ctx.K)cutMore=Math.max(cutMore,r.list.length-ctx.K);
    if(r.list.length)per.push({ck:c.key,ci,C:r.C,list:r.list.slice(0,ctx.K)});
    else if(r.stat.candidates>0)capStuck.push(c);   /* มีแพทเทิร์น+ราคา แต่แม้แผ่นเดียวก็ข้ามเส้นเพดาน */
  });
  /* "ตอนที่คิด" ไม่ใช่ "ตอนนี้" — ข้อความนี้ถูกอ่านทีหลัง ค่าตั้งอาจเปลี่ยนไปแล้ว (ผลตรวจ 28 ก.ย. 69 ข้อ 12) */
  capStuck.forEach(c=>messages.push(c.name+': สั่งไม่ได้เลยโดยไม่เกินเพดาน — แพทเทิร์นทุกแบบที่ให้ชิ้นที่ขาด ทำให้ชิ้นอื่นเกินเพดานที่ยืดได้ (ตอนที่คิด ยืดได้ '+
    ctx.over+'%) · ทางออก: เพิ่มเพดานของชิ้นที่ล้นที่หน้า 📐 ชิ้นงาน หรือเพิ่ม "ยืดเพดานได้ไม่เกิน %" ที่หน้า ⚙️ ตั้งค่า'));
  /* ⭐ ผังที่ถูกตัดทิ้งเพราะเส้นเพดาน — ต้องบอกเสมอ **แม้สีนั้นจะยังมีผังอื่นเสนอได้**
     ของเดิมพูดเฉพาะตอน "ทั้งสีสั่งไม่ได้เลย" (capStuck) จึงเงียบสนิทในเคสที่เจ้าของเจอ:
     ยังมีทางเลือกโผล่มาให้เห็น แต่ผังที่ถูกกว่าหายไปเฉย ๆ = จ่ายแพงขึ้นโดยไม่รู้ว่าเกิดอะไร
     บอกเป็น "ชิ้นที่บล็อก" ไม่ใช่ไล่ทีละผัง เพราะต้นเหตุคือชิ้นนั้นชิ้นเดียว แก้ที่เดียวจบ */
  /* ⭐ ผังที่ "น่าจะช่วยได้" แต่ใช้ไม่ได้รอบนี้ — ต้องบอกเหตุทีละเหตุ ห้ามหายเงียบ
     (สำรวจ 26 ต.ค. 69 เจอว่าผังหายได้หลายทางโดยไม่มีใครพูด: ปิดใช้งาน · ขนาดแผ่นปิด/ไม่มี · ไม่มีราคาแผ่นของสีนั้น)
     นับเฉพาะผังที่ตัดชิ้นที่ "ขาดจริงในสีนั้น" ออกมาอย่างน้อย 1 ชนิด — ผังที่ไม่เกี่ยวไม่ต้องพูดถึง ไม่งั้นรกจนไม่มีใครอ่าน
     ผังที่ตัวตรวจผังไม่ผ่าน ไม่ซ้ำตรงนี้ เพราะมีข้อความของตัวเองอยู่แล้ว */
  ctx.cols.forEach(function(c){
    const ck=c.key,need=new Set(ctx.needs.filter(n=>n.color===ck).map(n=>n.piece_id));
    if(!need.size)return;
    const off=[],noSize=[],noPrice=[];
    ctx.patAll.forEach(function(rec){
      const ys=rec.yield.length?rec.yield:rec.yieldAny;
      if(!ys.some(y=>need.has(y.piece_id)))return;
      if(!rec.active)off.push(rec.code);
      else if(!ctx.sizeOk(rec.size_id))noSize.push(rec.code);
      else if(rec.bad||!rec.yield.length)return;                       /* มีข้อความของตัวเองแล้ว */
      else if(!ctx.sheetBy.has(rec.size_id+'|'+ck))noPrice.push(rec.code);
    });
    const cn=ctx.cname(ck);
    if(off.length)messages.push(cn+': ไม่ได้ใช้ผัง '+off.length+' แบบ ('+listTxt(off.sort(byStr))+
      ') เพราะถูกปิดใช้งานอยู่ — เปิดกลับได้ที่หน้า 🧩 แพทเทิร์น');
    if(noSize.length)messages.push(cn+': ไม่ได้ใช้ผัง '+noSize.length+' แบบ ('+listTxt(noSize.sort(byStr))+
      ') เพราะขนาดแผ่นของผังถูกปิดใช้งานหรือไม่มีในทะเบียน — ดูที่หน้า 🪟 ขนาดแผ่น/ราคา');
    if(noPrice.length)messages.push(cn+': ไม่ได้ใช้ผัง '+noPrice.length+' แบบ ('+listTxt(noPrice.sort(byStr))+
      ') เพราะยังไม่ได้ใส่ราคาแผ่นของขนาดนั้นใน'+cn+' — ใส่ราคาที่หน้า 🪟 ขนาดแผ่น/ราคา แล้วคิดใหม่');
  });
  const capStuckKeys=new Set(capStuck.map(c=>c.key));
  search.forEach(function(st){
    const bl=Array.isArray(st.cap_blocked)?st.cap_blocked:[];
    if(!bl.length)return;
    const cn=ctx.cname(st.color),by=new Map();
    bl.forEach(function(b){
      const g=by.get(b.piece_id)||{codes:[],b:b};
      if(g.codes.indexOf(b.code)<0)g.codes.push(b.code);
      by.set(b.piece_id,g);
    });
    [...by.keys()].sort(byStr).forEach(function(pid){
      const g=by.get(pid),b=g.b,codes=g.codes.slice().sort(byStr);
      messages.push(cn+': ไม่ได้เสนอผัง '+codes.length+' แบบ ('+listTxt(codes)+') เพราะจะทำให้ '+
        pieceLabel(ctx.pm,pid)+' '+cn+' เกินเส้นเพดาน — ตอนนี้มี '+b.onhand+' ชิ้น · เพดาน '+b.max+
        ' · ยืดได้ถึง '+b.cap+' (ตอนที่คิด ยืดได้ '+ctx.over+'%)'+
        (capStuckKeys.has(st.color)?'' :
          ' · ถ้าอยากใช้ผังเหล่านี้: เพิ่มเพดานชิ้นนี้ที่หน้า 📐 ชิ้นงาน หรือเพิ่ม "ยืดเพดานได้ไม่เกิน %" ที่หน้า ⚙️ ตั้งค่า'));
    });
  });
  if(!per.length){
    messages.push(capStuck.length?'ไม่มีทางเลือกให้เสนอ — ทุกทางเกินเพดานที่ยืดได้ (ดูเหตุผลและทางออกด้านบน)'
                                 :'ชิ้นที่ขาดทุกรายการยังสั่งไม่ได้ — ดูเหตุผลด้านบน');
    return res;
  }
  let combos=[{parts:[],short:0,v:0,price:0,ex:0,nl:0,sh:0}];
  per.forEach(pc=>{
    const next=[];
    combos.forEach(a=>pc.list.forEach(s=>next.push({parts:a.parts.concat([s]),short:a.short+(s.short||0),
      v:a.v+s.v,price:a.price+s.price,ex:a.ex+s.ex,nl:a.nl+s.nl,sh:a.sh+s.sh})));
    next.sort((a,b)=>a.short-b.short||a.v-b.v||a.price-b.price||a.ex-b.ex||a.nl-b.nl||a.sh-b.sh||
      (()=>{for(let i=0;i<a.parts.length;i++){const d=cntCmp(a.parts[i].cnt,b.parts[i].cnt);if(d)return d;}return 0;})());
    if(next.length>ctx.K)cutMore=Math.max(cutMore,next.length-ctx.K);
    combos=next.slice(0,ctx.K);
  });
  const lineCmp=(a,b)=>ctx.colIdx.get(a.color)-ctx.colIdx.get(b.color)||natCmp(a.code,b.code)||byStr(a.pattern_id,b.pattern_id)||a.sheets-b.sheets;
  const sigCmp=(a,b)=>{for(let i=0;i<Math.min(a.lines.length,b.lines.length);i++){const d=lineCmp(a.lines[i],b.lines[i]);if(d)return d;}return a.lines.length-b.lines.length;};
  let options=combos.map(cb=>{
    const lines=[];
    cb.parts.forEach((s,i)=>{const pc=per[i];s.cnt.forEach(([j,x])=>lines.push({pattern_id:pc.C[j].p.id,color:pc.ck,sheets:x}));});
    const r=evaluateLines(ctx,lines);
    if(r.violations!==cb.v||r.total_satang!==cb.price||r.excess_mm2!==cb.ex||r.sheets_total!==cb.sh||r.lines.length!==cb.nl||r.messages.length||r.over_cap>0)
      messages.push('⚠️ ภายใน: ค่าที่ใช้ค้นหาไม่ตรงกับค่าที่คิดซ้ำ (แจ้งผู้ดูแลระบบ)');
    return {rank:0,lines:r.lines,total_satang:r.total_satang,sheets_total:r.sheets_total,after:r.after,
      violations:r.violations,violation_list:r.violation_list,over_cap:r.over_cap,over_cap_list:r.over_cap_list,
      stretched:r.stretched,stretch_list:r.stretch_list,no_cap:r.no_cap,no_cap_list:r.no_cap_list,
      over_pct:r.over_pct,excess_sqft:r.excess_sqft,excess_mm2:r.excess_mm2,
      complete:r.complete,short_total:r.short_total,uncovered:r.uncovered,untracked:r.untracked,reasons:[],summary:[]};
  });
  options.sort((a,b)=>a.short_total-b.short_total||a.violations-b.violations||a.total_satang-b.total_satang||a.excess_mm2-b.excess_mm2||
    a.lines.length-b.lines.length||a.sheets_total-b.sheets_total||sigCmp(a,b));
  options.forEach((o,i)=>{o.rank=i+1;});
  const ex={__ctx:ctx};
  options.forEach(o=>{o.reasons=explain(o,ex,options[0]);o.summary=summaryOf(o.reasons);});
  /* ⭐ "เพดานแผ่นต่อแพทเทิร์น" ตัดทางที่ถูกกว่าทิ้งเงียบ ๆ (สำรวจจุดเงียบ 26 ต.ค. 69 · วัดได้: A4 ฿1,000×2 แผ่น
     ถูกตัดเพราะตั้งเพดานไว้ 1 → ระบบเสนอ A43 ฿5,000 แทน โดยไม่บอกว่ามีทางถูกกว่าแต่ติดค่าตั้ง)
     ⛔ จะพูดได้ต่อเมื่อ **พิสูจน์ได้** เท่านั้น: ผังเดียวนั้นต้องครอบชิ้นที่ขาดครบทุกชนิดของสีนั้น ·
        ไม่ข้ามเส้นเพดานของชิ้นใดเลย · และราคารวมถูกกว่าที่เสนออยู่จริง — ไม่ใช่เดาว่า "อาจจะถูกกว่า" */
  (function(){
    const byColor=new Map();
    (options[0]?options[0].lines:[]).forEach(function(l){byColor.set(l.color,(byColor.get(l.color)||0)+(Number(l.amount_satang)||0));});
    ctx.cols.forEach(function(c){
      const ck=c.key,nd=ctx.needs.filter(n=>n.color===ck);
      if(!nd.length)return;
      const now=byColor.get(ck);
      if(now==null)return;                       /* สีนี้ไม่มีทางเสนออยู่ — มีข้อความอื่นคุมอยู่แล้ว */
      let best=null;
      ctx.pats.forEach(function(p){
        const sp=ctx.sheetBy.get(p.size_id+'|'+ck);if(!sp)return;
        const y=new Map();p.yield.forEach(r=>y.set(r.piece_id,r.qty));
        let sheets=0,covers=true;
        nd.forEach(function(n){
          const q=y.get(n.piece_id)||0;
          if(!q){covers=false;return;}
          const s=Math.ceil(n.need/q);if(s>sheets)sheets=s;
        });
        if(!covers||sheets<=ctx.S)return;        /* ครอบไม่ครบ หรือใช้แผ่นไม่เกินเพดานอยู่แล้ว (ตัวค้นหาเห็นอยู่แล้ว) */
        let capOk=true;
        p.yield.forEach(function(r){
          const inf=ctx.info.get(r.piece_id+'|'+ck);
          if(!inf||!inf.set||!(inf.max>0))return;
          if(inf.onhand+sheets*r.qty>capOfMax(inf.max,ctx.over))capOk=false;
        });
        if(!capOk)return;                        /* ติดเส้นเพดาน ไม่ใช่ติดค่าตั้งแผ่น — มีข้อความของตัวเองแล้ว */
        const price=sheets*sp.price;
        if(price<now&&(!best||price<best.price))best={code:p.code,sheets,price};
      });
      if(best)messages.push(ctx.cname(ck)+': มีทางที่ถูกกว่าแต่ใช้ไม่ได้เพราะค่าตั้ง — ผัง '+best.code+' แบบเดียว '+best.sheets+
        ' แผ่น ครอบชิ้นที่ขาดครบและไม่เกินเพดาน รวม '+bahtTxt(best.price)+' (ถูกกว่าที่เสนออยู่ '+bahtTxt(now-best.price)+
        ') แต่ติด "แผ่นต่อแพทเทิร์นไม่เกิน '+ctx.S+'" · เพิ่มค่านี้ที่หน้า ⚙️ ตั้งค่า แล้วคิดใหม่');
    });
  })();
  /* ⭐ บอกว่ายังมีทางอื่นที่หาเจอแต่ไม่ได้แสดง — ทางที่ตัดออกอยู่อันดับรองลงไปตามกติกาจัดอันดับอยู่แล้ว
     (ไม่ได้แปลว่ามีทางที่ดีกว่าซ่อนอยู่ แต่ต้องบอกว่ามีอยู่ ไม่ใช่ทำเหมือนมีแค่นี้ทั้งโลก) */
  if(cutMore>0)messages.push('แสดง '+options.length+' ทาง — ยังมีอีกอย่างน้อย '+cutMore+
    ' ทางที่หาเจอแต่ไม่ได้แสดง (อยู่อันดับรองลงไป) · อยากเห็นมากกว่านี้ เพิ่ม "จำนวนทางเลือกสูงสุด" ที่หน้า ⚙️ ตั้งค่า (ตอนที่คิด ตั้งไว้ '+ctx.K+')');
  res.options=options;
  res.optimal_proven=search.every(s=>s.needs===0||s.optimal_proven);
  /* ทางเลือกที่ระบบเสนอห้ามข้ามเส้น cap เด็ดขาด — ที่เหลือคือ "ยืดเพดาน" (อยู่ในช่วงที่อนุญาต) ห้ามเรียกว่าทะลุเพดาน
     ⚠️ นับเฉพาะแถว "ยืดเพดาน" จริง (stretched) — แถวเพดาน 0 (ได้ชิ้นที่ตั้งว่าไม่ใช้) ไม่มีช่วงยืดให้ จึงพูดแทนกันไม่ได้ (ผลตรวจข้อ 2/13)
     ⚠️ "ทุกทาง" พูดได้เฉพาะเมื่อทุกทางในรายการยืดจริง — ลำดับใหม่เรียง "ขาด" ก่อน จึงมีทางที่ยืด 0 อยู่ท้ายรายการได้ (ผลตรวจข้อ 1) */
  const stN=o=>Number(o.stretched)||0,shN=o=>Number(o.short_total)||0;
  const clean=options.find(o=>!stN(o));
  if(stN(options[0])>0){
    if(!clean)messages.push(search.some(s=>s.zero_violation_impossible)
      ?'ไม่มีทางไหนที่ไม่ต้องยืดเพดาน — ทุกทางที่เสนอยังอยู่ในช่วงยืดได้ (ไม่เกิน '+ctx.over+'%) เรียงตามราคา'
      :'ทุกทางเลือกที่ระบบหาเจอต้องยืดเพดาน (ระบบไม่ได้ไล่ครบทุกทาง อาจยังมีทางที่ไม่ต้องยืด) — ทุกทางที่เสนอยังอยู่ในช่วงยืดได้ (ไม่เกิน '+ctx.over+'%)');
    else messages.push('ทางที่ 1 ต้องยืดเพดาน '+stN(options[0])+' รายการ (ไม่เกิน '+ctx.over+'%) — ทางที่ไม่ต้องยืดเพดานมีอยู่ (ทางที่ '+clean.rank+
      ') แต่ได้ชิ้นไม่ครบเท่า: ยังขาด '+shN(clean)+' ชิ้น ส่วนทางที่ 1 ขาด '+shN(options[0])+' ชิ้น');
  }
  if(Number(options[0].no_cap)>0)
    messages.push('ทางที่ 1 ได้ชิ้นที่ตั้งไว้ว่าไม่ใช้ในสีนั้น (เพดาน 0) '+Number(options[0].no_cap)+
      ' รายการ — เพดาน 0 ไม่มีช่วงยืดให้ ดูรายการในเหตุผลของการ์ด');
  /* เสนอทางที่ไม่เกินเพดานแต่ยังขาด (partial) — ต้องบอกให้ชัดว่าทำไมสั่งเพิ่มไม่ได้
     "สั่งได้แค่นี้" = คำเด็ดขาด พูดได้เฉพาะตอนไล่ครบทุกทางที่ไม่ข้ามเส้นแล้ว · ไม่งั้นเขียน "ดีที่สุดที่ระบบหาเจอ" (กติกาเดียวกับหน้า ✨ · ผลตรวจข้อ 4) */
  const parts=search.filter(s=>s.partial);
  if(parts.length)
    messages.push((parts.every(s=>s.partial_exhaustive)?'สั่งได้แค่นี้ถ้าไม่ให้เกินเพดาน':'ดีที่สุดที่ระบบหาเจอโดยไม่ให้เกินเพดาน')+
      ' — ทางเลือกที่เสนอยังได้ชิ้นไม่ถึงขั้นต่ำ เพราะเพิ่มแผ่นอีกจะทำให้ชิ้นอื่นเกินเพดานที่ยืดได้ (ตอนที่คิด ยืดได้ '+ctx.over+
      '%) · ทางออก: เพิ่มเพดานของชิ้นที่ล้นที่หน้า 📐 ชิ้นงาน หรือเพิ่ม "ยืดเพดานได้ไม่เกิน %" ที่หน้า ⚙️ ตั้งค่า');
  if(ctx.uncoverable.length)messages.push('ทุกทางเลือกยังไม่ครบ: ครอบเฉพาะชิ้นที่สั่งได้ ยังขาด '+ctx.uncoverable.length+' รายการ (ดูเหตุผลด้านบน)');
  return res;
}

/* ==================== ส่วนที่ 3 — สร้างผังใหม่จากขนาดที่ต้องการ (TASK 12 · 21 ก.ย. 69 · รอบแก้ตามผลตรวจ 22 ก.ย. 69) ====================
   generatePatterns(req, opts) → {results:[…], missing:[…], messages:[ไทย], stats:{…}}
     req  = {sheet:(แถว glass_sheet_sizes {w_mm,h_mm,w_in?,h_in?,name?}),
             pieces:[{piece_id?, a_mm, b_mm, rotatable?, qty}]   qty = จำนวนที่อยากได้ต่อแผ่น · 0 = ไม่บังคับ (ใช้เฉพาะตอนเติมให้เต็มแผ่น)
             registry?:[glass_pieces] (ทะเบียนชิ้นงาน — ใช้ตรวจผังด้วย validatePattern และอ่าน rotatable/ทิศของชิ้นที่มี piece_id)
             rules?:{kerf_mm,trim_mm}}
     opts = {fill:true|false (ค่าตั้งต้น true = ครบจำนวนแล้วเติมชิ้นซ้ำให้เต็มแถบ/แผ่น) · direction:'auto'|'แนวตั้ง'|'แนวนอน' · max_results:3 · work_budget
             require_all:true = ทุกขนาดที่กรอกต้องมีในผังอย่างน้อยขนาดละ 1 ชิ้น (แถวที่ไม่ใส่จำนวน qty 0 ก็ต้องมี 1) — เจ้าของสั่ง 23 ก.ย. 69 (ค่าตั้งต้น false = เหมือนเดิม)}
     results[i] = {rank, layout (โครงเดียวกับ glass_patterns.layout · piece_id ของชิ้นใหม่ = 'ใหม่:'+คีย์ ชั่วคราว ⛔ ห้ามลงฐาน),
                   yield (= patternYield) · used_pct (= patternUsedPct) · used_mm2 · covered (ครบทุก qty) · missing:[{piece,want,got,short,why}]
                   pieces:[{key,name,piece_id,a_mm,b_mm,want,got,short,extra}] · strips_n · direction · why:[ไทย] · sig · exact (มาจากการไล่ครบ)
                   has_all (มีครบทุกขนาดที่กรอก ขนาดละ ≥ 1) · sizes_missing (จำนวนขนาดที่ไม่มีในผังนี้เลย) · best_area (ใบที่ใช้พื้นที่มากสุดของแผ่นนี้)}
     missing (ระดับบน) = ชิ้นที่วางไม่ลงแผ่นในทุกทิศที่ลอง (why 'ใหญ่กว่าแผ่น' · 'ยาวกว่าแผ่นจริง') · results ว่างได้ ไม่ throw
     stats = {runs, layouts, unique, dropped, work, budget_hit, exact:{แนวตั้ง:true|false|null, แนวนอน:…} (true = ไล่ครบทิศนั้นแล้ว · false = เกินงบ ใช้ผลลำดับวาง), exact_all}
   ⚠️ ข้อตัดสินเอง (จดใน BUILD.md): SPEC เขียนว่า "คืน [{layout…}]" — คืนเป็นอ็อบเจกต์ห่ออีกชั้นแทน เพราะกรณี "ชิ้นใหญ่กว่าแผ่น/ไม่มีผังเลย"
      ต้องมีที่ใส่ missing+ข้อความ โดยไม่ต้องคืนผังว่างที่ validatePattern ไม่ผ่าน (ทุก result ที่คืนผ่าน validatePattern เสมอ)

   วิธี (ดีเทอร์มินิสติก · ไม่ใช้นาฬิกา/สุ่ม · งบเป็น "จำนวนงาน" work_budget):
   G1 ตัดตรงทะลุแผ่น 2 ขั้น: แถบ (กว้าง = ด้านหนึ่งของชิ้น) → ซอยแถบตามอีกด้าน · ชิ้นหมุนได้ลองทั้ง 2 ด้านเป็นความกว้างแถบ
      ชิ้นหมุนไม่ได้: ด้านสั้น (a_mm ในทะเบียน) ตามแนวกว้างแผ่น (กติกาเดียวกับ validatePattern) → แนวตั้ง กว้างแถบ = a · แนวนอน สูงแถบ = b
   G2 ร่องตัด/เผื่อขอบ คิดแบบเดียวกับ validatePattern (Σ + ร่อง×(n−1) + เผื่อ×2 ≤ แผ่น) — ไม่ใช้ค่าคลาดปัดเศษ (สร้างให้พอดีแผ่น มม. เสมอ)
      ร่อง/เผื่อที่เป็นทศนิยม ปัดขึ้นเป็น มม. เต็มตอนสร้าง (หน้าตั้งค่ารับจำนวนเต็มอยู่แล้ว · ปัดขึ้น = ผังแน่นน้อยลงนิดเดียว แต่ผ่านตัวตรวจเสมอ)
   G2ข ชิ้นเดียวยาวกว่าแผ่นจริงไม่ได้ (CLAUDE.md "ชิ้นยาวเต็มแผ่น" · ผลตรวจ 22 ก.ย. 69 ข้อ 5): ด้านของชิ้นแต่ละด้าน ≤ fullLengthMm ของด้านแผ่นนั้น (ปัดลงจากนิ้ว
      72 นิ้ว = 1828 · 84 นิ้ว = 2133) − เผื่อขอบ×2 · ผลรวมหลายชิ้น/หลายแถบยังเทียบขนาดแผ่นในทะเบียน (1829 · 2134) แบบเดิม — ผังจริงของโรงงาน
      A21/A24/A26/A35/A37/A40 ซอย 42.6+42.7×4 = 213.4 บนแผ่นสูง 84 นิ้ว (213.36) ใช้งานอยู่จริง · ชิ้นที่ยาวเกินแผ่นจริงทุกทิศ = missing why 'ยาวกว่าแผ่นจริง'
   G3 การซอยในแถบ (packStrip) = knapsack แบบไล่ตามความยาว (ตาราง มม.) ได้คำตอบเท่ากับการไล่ทุกจำนวนชิ้น แต่ไม่โตแบบทวีคูณ
      (เดิมไล่ครบทุกจำนวน: ชิ้นสั้นหลายขนาดกว้างเท่ากัน 12 ขนาด → งบหมดตั้งแต่รอบแรก ได้ 0 ผัง — ผลตรวจ 22 ก.ย. 69 ข้อ 3)
      เลือก: ความยาวรวมมากสุด (พอดีขอบ = มากสุดโดยธรรมชาติ) → ชิ้นที่ขอ (qty>0) มากสุด → ชิ้นน้อยสุด → เวกเตอร์จำนวนมากสุดตามลำดับชิ้นยาว→สั้น (= ตัวไล่เดิม)
      จำนวนชิ้นจำกัดด้วย qty ที่เหลือ (ตอนเติม = ไม่จำกัด) · จำผล (memo) ต่อ ทิศ×กว้าง×เหลือ
   G4 ลำดับวาง (ต่อทิศ): [ลำดับชิ้น 3 แบบ: พื้นที่มาก→น้อย · ด้านยาว · จำนวนที่ขอ] × [ทิศของชิ้น 3 แบบ: ด้านสั้นเป็นกว้างแถบ · ด้านยาว · เลือกให้]
      + greedy ต่อแถบ = 10 รอบ/ทิศ · 2 ทิศ = 20 รอบ (greedy ของทุกทิศรันเสมอแม้งบหมด → มีผังให้ดูอย่างน้อยทิศละ 1 แบบเสมอ)
   G4ข ไล่ครบ (ผลตรวจ 22 ก.ย. 69 ข้อ 1–2): ต่อทิศ สร้าง "แบบแถบ" ทุกแบบ (ต่อความกว้าง: ทุกจำนวนของชิ้นที่ขอ ≤ qty แล้ว fill=true เติมที่เหลือด้วย G3)
      แล้วหาชุดแถบที่ดีที่สุดด้วย DP ตาม (ความกว้างที่เหลือ, จำนวนที่ได้แต่ละชิ้น ตัดที่ qty) เกณฑ์ = ขาดน้อยสุด → พื้นที่มากสุด → แถบน้อยสุด
      = ดีที่สุดจริงของผังแถบ→ซอย (ชิ้นกว้างเท่าแถบ) · เกินงบ (GEN_EXACT_WORK · GEN_EXACT_STATES · GEN_EXACT_PATS) = ทิ้งผลไล่ครบของทิศนั้น ใช้ผล G4 + ข้อความบอก
      เดิมมีแค่ G4: ขอ 87.5×92.8 ×1 + 59.6×182.8 ×2 บน 96×72 ผังที่ 1 = 67.1% ทั้งที่ 928[875,875] 596[1828]×2 = 85.3% ครบเหมือนกัน
   G5 fill=true (G4): ครบ qty (หรือใส่ไม่ลงแล้ว) → เติมชิ้นซ้ำในแถบเดิมให้เต็มความยาว แล้วเปิดแถบใหม่จนเต็มความกว้าง (เลือกแถบที่ได้พื้นที่มากสุด → ชิ้นที่ขอมากสุด → กว้างสุด)
   G6 ชิ้นยาวเต็มแผ่น: ชิ้นเดียวในแถบ ยาว = fullLengthMm(แผ่น, ทิศ) → full_length:true (เช่น 72 นิ้ว = 1828 · A43/A50)
   G7 ทุกผังผ่าน validatePattern(layout, sheet, registry+ชิ้นใหม่, rules) ก่อนคืน (ไม่ผ่าน = ทิ้ง นับใน stats.dropped · เทสบังคับ dropped = 0) · ลายเซ็นซ้ำ = แบบเดียวกัน (แถบเรียง กว้าง→แคบ · ชิ้นในแถบ ยาว→สั้น)
      ผลผลิตเหมือนกันเป๊ะในทิศเดียวกัน (ชิ้นเดียวกัน จำนวนเท่ากัน วางต่างกัน) = เก็บแบบอันดับดีกว่าไว้แบบเดียว — การ์ดไม่ซ้ำกันเอง (ผลตรวจ 22 ก.ย. 69 ข้อ 2 ค)
   G10 require_all (23 ก.ย. 69 · เจ้าของ: "ใส่แค่ขนาด ไม่ต้องใส่จำนวน ให้รวมทุกขนาดในแผ่นเดียว"): ความต้องการของแถวที่ไม่ใส่จำนวน (qty 0) = อย่างน้อย 1 ชิ้น
      ทำโดยไล่ 2 รอบด้วย "เพดานความต้องการ" คนละชุดบนเครื่องเดิม (G4 · G4ข): รอบ ก เพดาน = max(qty,1) → ผังที่มีครบทุกขนาด · รอบ ข เพดาน = qty (เหมือนเดิม) → ผังที่ใช้พื้นที่มากสุดแบบไม่บังคับครบ
      การไล่ครบของรอบ ก ใช้ค่าปรับ "ขนาดที่หายทั้งขนาด" หนักกว่าจำนวนที่ขาดรวมเสมอ → ได้ครบทุกขนาดก่อน แล้วจึงพื้นที่มากสุด
      เรียงผล (เมื่อมีแถวที่ไม่ใส่จำนวน = needAll): **ครบจำนวนที่กรอกก่อนเสมอ** → ขนาดที่หายน้อยสุด → ชิ้นที่ขาดน้อยสุด → พื้นที่มากสุด → …
        (ผลตรวจ 23 ก.ย. 69 ข้อ 1+3: ห้ามเอา "ขนาดที่หายทั้งขนาด" มาก่อน "ครบจำนวนที่กรอก" — กล่อง ✨ สัญญาไว้ว่า "ใส่จำนวน = ต้องได้อย่างน้อยเท่านั้นต่อแผ่น"
         ใส่จำนวนครบทุกแถว → needAll = false → เกณฑ์ G8 เดิมเป๊ะ ไม่แตะ)
      ใบที่พื้นที่มากสุด (best_area) และใบแรกที่มีครบทุกขนาด ถูกคืนเสมอแม้หลุด max_results (วางท้ายรายการ ห้ามแทนอันดับ 1)
      งบไล่ครบต่อทิศหารกันระหว่าง 2 รอบ — เปิด require_all แล้วต้องไม่ช้ากว่ารอบเดียวของเดิม (ผลตรวจ 23 ก.ย. 69 ข้อ 5)
   G8 เรียง: ครบ qty ก่อน → ชิ้นที่ขาดน้อยสุด → พื้นที่ใช้ (มม.²) มากสุด → แนวตั้งก่อน (ผัง 56 แบบของโรงงานเป็นแนวตั้งทั้งหมด) → แถบน้อย → ลายเซ็น
      (SPEC เขียน "used_pct → แถบน้อย" — เพิ่ม "ขาดน้อยสุด" ไว้หน้า และ "แนวตั้งก่อน" ไว้หลัง used_pct: ผัง 5 แถบ×47.5 ซอย 87.5×2 กับ 2 แถบ×87.5 ซอย 47.5×5 ใช้พื้นที่เท่ากันเป๊ะ
       ถ้าเอาแถบน้อยก่อน ผังแนวนอนจะชนะ A4 ทั้งที่โรงงานตัดแนวตั้งเสมอ — จดเป็นข้อตัดสินเองใน BUILD.md)
   G9 ไล่ครบทุกทิศทัน = ผังที่ 1 ดีที่สุดจริงของผังแถบ→ซอย (ข้อความบอก) · ไม่ทัน = ไม่รับประกัน (UI เขียน "ดีที่สุดที่หาเจอ" เสมอ ไม่ใช่ "เศษน้อยสุด")
      งบหมด = หยุดค้นต่อ แต่ผลที่ได้แล้วยังคืน (ไม่ทิ้ง) · ชิ้นใหญ่กว่าแผ่นทั้งสองทิศ = missing why 'ใหญ่กว่าแผ่น' ไม่ throw */
const GEN_MAX_RESULTS=3,GEN_RESULTS_CAP=20;        /* จำนวนผังที่คืน (ค่าตั้งต้น · เพดานแข็ง) */
const GEN_WORK=6000000;                            /* งบงานรวม (นับงาน ไม่ใช้นาฬิกา): ช่องตาราง/รอบไล่ของ G3 + รอบเทียบของ G4ข — งบหมด = ข้ามรอบที่เหลือ (greedy ยังรันทุกทิศ) */
const GEN_EXACT_WORK=1000000;                      /* งบของการไล่ครบ (G4ข) ต่อทิศ — เกิน = ทิ้งผลไล่ครบของทิศนั้น (2 ทิศ = 2 ล้าน < GEN_WORK) · โจทย์สมจริง 2–10 ขนาด ใช้ ≤ 0.8 ล้าน (วัด 22 ก.ย. 69) · หมดงบ ≈ 0.15 วินาที/ทิศ */
const GEN_EXACT_STATES=200000;                     /* สถานะ DP สูงสุดต่อทิศ (กันหน่วยความจำ) */
const GEN_EXACT_PATS=20000;                        /* แบบแถบสูงสุดต่อทิศ */
const GEN_PACK_ENUM=512;                           /* G3: จำนวนแบบให้ไล่ตรง ๆ ได้ (เล็กกว่านี้ไล่เร็วกว่าตาราง) — ผลเท่ากันเป๊ะ */
const NEW_PIECE_PREFIX='ใหม่:';                    /* piece_id ชั่วคราวของชิ้นที่ยังไม่มีในทะเบียน (หน้าเว็บใช้ค่าเดียวกัน: NEWP) ⛔ ห้ามลงฐาน */
function generatePatterns(req,opts){
  req=(req&&typeof req==='object')?req:{};opts=(opts&&typeof opts==='object')?opts:{};
  const messages=[],missing=[],results=[];
  const stats={runs:0,layouts:0,unique:0,dropped:0,work:0,budget_hit:false,exact:{},exact_all:false,exact_work:0};
  const out={results,missing,messages,stats};
  const sheet=(req.sheet&&typeof req.sheet==='object')?req.sheet:{};
  const {w:W,h:H}=sheetDims(sheet);
  if(!W||!H){messages.push('ยังไม่มีขนาดแผ่น (กว้าง×สูง) — เลือกขนาดแผ่นก่อน');return out;}
  const wIn=toNum(sheet.w_in),hIn=toNum(sheet.h_in);
  const sheetName=String(sheet.name||((isFinite(wIn)&&wIn>0&&isFinite(hIn)&&hIn>0)?numTxt(wIn)+'×'+numTxt(hIn)+' นิ้ว':cmTxt(W)+'×'+cmTxt(H)+' ซม.'));
  const rules=(req.rules&&typeof req.rules==='object')?req.rules:{};
  const kerf=nonNeg(rules.kerf_mm),trim=nonNeg(rules.trim_mm);
  const kerfG=Math.max(0,Math.ceil(kerf-1e-9)),trimG=Math.max(0,Math.ceil(trim-1e-9));   /* G2: ตอนสร้างใช้ มม. เต็ม (ปัดขึ้น) */
  /* G3 คะแนนแถบ = ยาวรวม×SB² + ชิ้นที่ขอ×SB − จำนวนชิ้น → เทียบตัวเดียวได้ลำดับ ยาวมาก → ชิ้นที่ขอมาก → ชิ้นน้อย (จำนวนเต็มใน float64 · ยาว ≤ ~3,100 มม. → < 2^53) */
  const SB=8192,SB2=SB*SB;
  const fill=opts.fill!==false;
  const reqAll=opts.require_all===true;   /* G10: ทุกขนาดที่กรอกต้องมีในผัง อย่างน้อยขนาดละ 1 ชิ้น */
  const dirs=opts.direction===DIR_V?[DIR_V]:opts.direction===DIR_H?[DIR_H]:DIRECTIONS.slice();
  const maxRes=Math.min(GEN_RESULTS_CAP,posInt(opts.max_results)||GEN_MAX_RESULTS);
  const workBudget=posInt(opts.work_budget)||GEN_WORK;
  const regMap=pieceMap(req.registry);
  /* ---- ชิ้นที่ขอ → รูปมาตรฐาน (รวมขนาด+รหัสซ้ำ · เรียงคงที่ ไม่ขึ้นกับลำดับที่ส่งมา) ---- */
  const byKey=new Map(),badIn=[];
  (Array.isArray(req.pieces)?req.pieces:[]).forEach(function(p,i){
    if(!p||typeof p!=='object'){badIn.push(i+1);return;}
    const a0=posInt(p.a_mm),b0=posInt(p.b_mm);
    if(!a0||!b0){badIn.push(i+1);return;}
    const a=Math.min(a0,b0),b=Math.max(a0,b0),key=pieceKey(a,b);
    let id=idOf(p.piece_id),rot=p.rotatable!==false,wa=a,ha=b,note='';
    const reg=id?regMap.get(id):null;
    if(reg){
      const ra=posInt(reg.a_mm),rb=posInt(reg.b_mm);
      if(ra&&rb&&pieceDiffMm(a,b,ra,rb)>CUT_STOCK_TOL_MM){note='ขนาด '+pieceName(a,b)+' ต่างจากชิ้น '+id+' ('+pieceName(ra,rb)+') เกิน '+CUT_STOCK_TOL_MM+' มม. — ถือเป็นชิ้นใหม่';id='';}
      else{rot=reg.rotatable!==false;if(ra&&rb&&ra>rb){wa=b;ha=a;}}   /* หมุนไม่ได้: a_mm ของทะเบียนวางตามแนวกว้างแผ่น (เหมือน validatePattern) */
    }
    const qty=nnInt(p.qty)||0,k=key+'|'+id;
    const cur=byKey.get(k);
    if(cur){cur.qty+=qty;cur.rot=cur.rot&&rot;}
    else byKey.set(k,{key,a,b,wa,ha,id:id||(NEW_PIECE_PREFIX+key),isNew:!id,name:pieceName(a,b),rot,qty,note,big:false,bigWhy:''});
  });
  if(badIn.length)messages.push('ชิ้นที่ '+badIn.join(', ')+': ขนาดต้องเป็นมิลลิเมตรจำนวนเต็มมากกว่า 0 — ข้ามชิ้นนี้');
  const types=[...byKey.values()].sort((x,y)=>y.a*y.b-x.a*x.b||y.b-x.b||y.a-x.a||byStr(x.id,y.id));
  types.forEach((t,i)=>{t.i=i;if(t.note)messages.push(t.note);});
  if(!types.length){messages.push('ยังไม่มีชิ้นที่ต้องการ — ใส่ขนาดอย่างน้อย 1 ชิ้น');return out;}
  const tiByKey=new Map();types.forEach(t=>tiByKey.set(t.key+'|'+t.id,t.i));
  const pieceRef=t=>({key:t.key,name:t.name,piece_id:t.isNew?'':t.id,a_mm:t.a,b_mm:t.b});
  /* ทะเบียนสำหรับ validatePattern = ทะเบียนที่ส่งมา + ชิ้นใหม่ชั่วคราว */
  const vreg=[...regMap.values()];
  types.forEach(t=>{if(!regMap.has(t.id))vreg.push({id:t.id,a_mm:t.a,b_mm:t.b,key:t.key,rotatable:t.rot,active:true});});
  /* ---- เรขาคณิตต่อทิศ (G1 · G2 · G2ข) ---- */
  const oneW=Math.min(W,fullLengthMm(sheet,DIR_H))-2*trimG,oneH=Math.min(H,fullLengthMm(sheet,DIR_V))-2*trimG;   /* ด้านชิ้นยาวสุดตามแนวกว้าง/สูงแผ่น (แผ่นจริง ปัดลง) */
  const G=dirs.map(function(dir){
    const vertical=dir!==DIR_H,across=vertical?W:H,along=vertical?H:W;
    const acrossCap=across-2*trimG,alongCap=along-2*trimG;
    const acrossOne=vertical?oneW:oneH,alongOne=vertical?oneH:oneW;
    const oriMm=types.map(function(t){
      const list=[];
      if(t.rot){list.push({sw:t.a,len:t.b});if(t.a!==t.b)list.push({sw:t.b,len:t.a});}
      else list.push(vertical?{sw:t.wa,len:t.ha}:{sw:t.ha,len:t.wa});
      return list.filter(o=>o.sw>0&&o.len>0&&o.sw<=acrossCap&&o.len<=alongCap);
    });
    const ori=oriMm.map(l=>l.filter(o=>o.sw<=acrossOne&&o.len<=alongOne));
    const widths=[...new Set(ori.flatMap(l=>l.map(o=>o.sw)))].sort((x,y)=>y-x);
    /* ชิ้นที่ด้านหนึ่งเท่ากับความกว้างแถบ (ต่อความกว้าง) เรียง ยาว→สั้น · Lmax = ความยาวแถบ (หน่วย ยาว+ร่อง) */
    const items=new Map();
    ori.forEach((list,ti)=>list.forEach(function(o){const dem=types[ti].qty>0?1:0;
      if(!items.has(o.sw))items.set(o.sw,[]);items.get(o.sw).push({ti,len:o.len,cost:o.len+kerfG,dem,val:o.len*SB2+dem*SB-1});}));
    items.forEach(l=>l.sort((x,y)=>y.len-x.len||x.ti-y.ti));
    return {dir,vertical,across,along,acrossCap,alongCap,fullLen:fullLengthMm(sheet,dir),ori,
      realCut:oriMm.map((l,i)=>l.length>ori[i].length),widths,items,Lmax:Math.floor(alongCap+kerfG+1e-9),memo:new Map(),tabs:new Map(),ucache:new Map()};
  });
  /* ด้านที่ยาวกว่าแผ่นจริง (ใส่ได้ตามขนาดแผ่นในทะเบียน แต่เกินแผ่นจริงที่ปัดลงจากนิ้ว) — บอกทุกครั้งที่ทำให้วางด้านนั้นไม่ได้ */
  const realTxt=function(t){
    const sides=[];
    [[oneH,H,hIn,'สูง'],[oneW,W,wIn,'กว้าง']].forEach(function(sd){
      [t.b,t.a].forEach(function(d){if(d>sd[0]&&d<=sd[1]-2*trimG&&!sides.some(x=>x.d===d&&x.w===sd[3]))sides.push({d,w:sd[3],one:sd[0],inch:sd[2]});});
    });
    return sides.map(x=>'ด้าน '+cmTxt(x.d)+' ยาวกว่าแผ่นจริงด้าน'+x.w+(isFinite(x.inch)&&x.inch>0?' '+numTxt(x.inch)+' นิ้ว ('+numTxt(x.inch*MM_PER_IN/10)+' ซม.':' (')+
      ' · ชิ้นยาวสุด '+cmTxt(x.one)+(trimG?' หักเผื่อขอบแล้ว':'')+')').join(' · ');
  };
  types.forEach(function(t){
    if(G.some(g=>g.ori[t.i].length)){
      if(G.some(g=>g.realCut[t.i]))messages.push('ชิ้น '+t.name+': '+realTxt(t)+' — ไม่วางด้านนั้นตามแนวนั้น (ชิ้นยาวกว่าแผ่นจริงไม่ได้)');
      return;
    }
    t.big=true;
    const realOnly=G.some(g=>g.realCut[t.i]);
    t.bigWhy=realOnly?'ยาวกว่าแผ่นจริง':'ใหญ่กว่าแผ่น';
    missing.push({piece:pieceRef(t),want:t.qty,got:0,short:t.qty,why:t.bigWhy});
    if(realOnly)messages.push('ชิ้น '+t.name+' ยาวกว่าแผ่นจริง '+sheetName+': '+realTxt(t)+' — วางไม่ลง'+(dirs.length>1?'ทั้งสองทิศ':'')+' (ชิ้นยาวกว่าแผ่นจริงไม่ได้)');
    else messages.push('ชิ้น '+t.name+' ใหญ่กว่าแผ่น '+sheetName+' ('+cmTxt(W)+'×'+cmTxt(H)+' ซม.'+((kerf||trim)?' หักร่องตัด/เผื่อขอบ':'')+')'+(dirs.length>1?' ทั้งสองทิศ':'')+' — วางไม่ลง');
  });
  if(types.every(t=>t.big)){messages.push('ไม่มีชิ้นไหนวางลงแผ่น '+sheetName+' ได้');return out;}
  /* เพดานความต้องการ 2 ชุด (G10): capQty = ตามที่กรอก (0 = ไม่บังคับ) · capNeed = แถวที่ไม่ใส่จำนวนต้องได้อย่างน้อย 1 เมื่อ require_all
     needAll = require_all แล้วมีผลจริง (มีแถวที่ไม่ใส่จำนวน) → ต้องไล่ 2 รอบ · ไม่งั้นรอบเดียวเหมือนเดิมเป๊ะ */
  const capQty=types.map(t=>t.big?0:t.qty);
  const capNeed=types.map((t,i)=>t.big?0:(t.qty>0?t.qty:(reqAll?1:0)));
  const needAll=capNeed.some((c,i)=>c!==capQty[i]);
  if(!fill&&capNeed.every(c=>c<=0)){messages.push('ยังไม่ได้ใส่จำนวนที่ต้องการ — ใส่จำนวนอย่างน้อย 1 ชิ้น หรือเปิด "เติมชิ้นให้เต็มแผ่น"');return out;}
  /* ---- ซอยแถบ (G3) ---- */
  let work=0,over=false;
  const spend=n=>{work+=n;if(work>workBudget)over=true;};
  /* ตาราง knapsack f[i][c] = คะแนนดีสุดจากชิ้นลำดับ i..m−1 ในความยาว c (ทุก c ≤ C) · จำนวนชิ้น i ≤ K[i]
     ไม่จำกัด = วนซ้ำตัวเอง · จำกัด = คิวเลื่อน (monotone deque) ต่อเศษหาร cost → O(m×C) ไม่ขึ้นกับจำนวนชิ้น */
  function packTable(items,K,C){
    const m=items.length,f=new Array(m+1);f[m]=new Float64Array(C+1);
    for(let i=m-1;i>=0;i--){
      const nx=f[i+1],cur=new Float64Array(C+1),cost=items[i].cost,v=items[i].val,k=K[i];
      spend(C+1);
      if(k<=0)cur.set(nx);
      else if(k>=Math.floor(C/cost)){for(let c=0;c<=C;c++){let b=nx[c];if(c>=cost){const q=cur[c-cost]+v;if(q>b)b=q;}cur[c]=b;}}
      else for(let r=0;r<cost&&r<=C;r++){
        const dq=[];let hd=0;
        for(let j=0,c=r;c<=C;j++,c+=cost){
          const gj=nx[c]-j*v;
          while(dq.length>hd){const t=dq[dq.length-1];if(nx[r+t*cost]-t*v<=gj)dq.pop();else break;}
          dq.push(j);
          if(dq[hd]<j-k)hd++;
          const jb=dq[hd];cur[c]=nx[r+jb*cost]-jb*v+j*v;
        }
      }
      f[i]=cur;
    }
    return f;
  }
  /* แถบกว้าง sw ความยาวให้ใช้ budgetLen (หน่วย Σ(ยาว+ร่อง)) → {used,n,dem,picks,tiCnt} หรือ null
     rem = จำนวนที่ยังขาดต่อชิ้น (unbounded = ไม่จำกัด ใช้ตอนเติม) · ผลเท่ากับไล่ทุกจำนวนแบบเดิมเป๊ะ: คะแนนดีสุด → เวกเตอร์จำนวนมากสุดตามลำดับชิ้น
     ไล่ตรง ๆ เมื่อแบบน้อย (≤ GEN_PACK_ENUM) · ไม่งั้นใช้ตาราง (ตารางไม่จำกัดจำนวนจำไว้ต่อความกว้าง ใช้ได้ทุกความยาว) */
  function packStrip(g,sw,rem,unbounded,budgetLen){
    const items=g.items.get(sw);
    if(!items)return null;
    const C=Math.min(g.Lmax,Math.floor(budgetLen+1e-9));
    if(C<=0)return null;
    let uc=null;
    if(unbounded){uc=g.ucache.get(sw);if(!uc){uc=new Array(g.Lmax+1);g.ucache.set(sw,uc);}if(uc[C]!==undefined)return uc[C];}
    const m=items.length;
    const K=items.map(it=>{const n=Math.floor(g.Lmax/it.cost);return unbounded?n:Math.min(n,rem[it.ti]);});
    const maxN=K.map((k,i)=>Math.min(k,Math.floor(C/items[i].cost)));
    if(!maxN.some(n=>n>0)){if(uc)uc[C]=null;return null;}
    const kk=unbounded?'u':maxN.join(','),ck=sw+'|'+C+'|'+kk;
    const hit=g.memo.get(ck);if(hit!==undefined)return hit;
    const cnt=new Array(m).fill(0);
    let space=1;for(let i=0;i<m&&space<=GEN_PACK_ENUM;i++)space*=maxN[i]+1;
    if(m===1){spend(1);cnt[0]=maxN[0];}
    else if(space<=GEN_PACK_ENUM){
      let best=0,bc=null;
      const rec=function(i,c,sc){
        spend(1);
        if(i===m){if(sc>best){best=sc;bc=cnt.slice();}return;}
        const it=items[i],top=Math.min(maxN[i],Math.floor(c/it.cost));
        for(let k=top;k>=0;k--){cnt[i]=k;rec(i+1,c-k*it.cost,sc+k*it.val);}
        cnt[i]=0;
      };
      rec(0,C,0);
      if(bc)bc.forEach((k,i)=>{cnt[i]=k;});
    }else{
      let f;
      if(unbounded){f=g.tabs.get(sw);if(!f){f=packTable(items,K,g.Lmax);g.tabs.set(sw,f);}}
      else f=packTable(items,maxN,C);
      /* ย้อนหา: ต่อชิ้นเอาจำนวนมากสุดที่ยังได้คะแนนดีสุด (= ตัวไล่เดิมที่ไล่จำนวนจากมากไปน้อย แล้วเก็บตัวแรกที่ดีสุด) */
      let c=C;
      for(let i=0;i<m;i++){
        const it=items[i];let k=Math.min(maxN[i],Math.floor(c/it.cost));
        for(;k>0;k--)if(k*it.val+f[i+1][c-k*it.cost]===f[i][c])break;
        cnt[i]=k;c-=k*it.cost;
      }
    }
    let used=0,n=0,dem=0;const picks=[],tiCnt=[];
    items.forEach((it,i)=>{if(!cnt[i])return;used+=cnt[i]*it.len;n+=cnt[i];dem+=cnt[i]*it.dem;tiCnt.push([it.ti,cnt[i],it.len]);
      for(let k=0;k<cnt[i];k++)picks.push({ti:it.ti,len:it.len});});
    const res=n?{used,n,dem,picks,tiCnt}:null;
    g.memo.set(ck,res);if(uc)uc[C]=res;
    return res;
  }
  /* ---- ประกอบ layout จากแถบ [{sw, cuts:[{ti,len}]}] (ใช้ร่วม G4/G4ข) ---- */
  function mkLayout(g,strips,exact){
    stats.layouts++;
    const sigStrip=s=>s.cuts.map(c=>c.size_mm+'/'+c.piece_id).join(',')+(s.full_length?'|F':'');
    const st=strips.map(function(s){
      const cuts=s.cuts.slice().sort((x,y)=>y.len-x.len||x.ti-y.ti);
      const o={size_mm:s.sw};
      if(cuts.length===1&&g.fullLen>0&&cuts[0].len===g.fullLen)o.full_length=true;
      o.cuts=cuts.map(c=>({size_mm:c.len,piece_id:types[c.ti].id}));
      return o;});
    st.sort((x,y)=>y.size_mm-x.size_mm||byStr(sigStrip(y),sigStrip(x)));
    const layout={direction:g.dir,strips:st};
    return {g,layout,exact:!!exact,sig:g.dir+'|'+st.map(s=>s.size_mm+':'+sigStrip(s)).join(';')};
  }
  /* ---- วางแถบทีละแถบ (G4) + เติม (G5) ---- */
  function runOne(g,order,mode,cap){
    stats.runs++;
    const rem=cap.slice(),strips=[];let acrossUsed=0;
    const room=()=>g.acrossCap-acrossUsed-(strips.length?kerfG:0);
    const add=(sw,pk)=>{acrossUsed+=(strips.length?kerfG:0)+sw;strips.push({sw,cuts:pk.picks.slice()});pk.picks.forEach(p=>{if(rem[p.ti]>0)rem[p.ti]--;});};
    const tryW=sw=>{if(sw>room())return null;const pk=packStrip(g,sw,rem,false,g.alongCap+kerfG);return (pk&&pk.n)?pk:null;};
    if(mode==='greedy'){
      for(;;){
        let best=null;
        g.widths.forEach(function(sw){const pk=tryW(sw);if(!pk)return;
          const c={sw,pk,area:pk.used*sw,exact:(pk.used+kerfG*(pk.n-1))===g.alongCap?1:0};
          if(!best||c.area>best.area||(c.area===best.area&&(c.exact>best.exact||(c.exact===best.exact&&c.sw<best.sw))))best=c;});
        if(!best)break;
        add(best.sw,best.pk);
      }
    }else{
      for(const ti of order){
        const t=types[ti];if(t.big||rem[ti]<=0)continue;
        let cands=g.ori[ti];
        if(mode==='short')cands=cands.filter(o=>o.sw<=o.len);
        else if(mode==='long')cands=cands.filter(o=>o.sw>=o.len);
        if(!cands.length)cands=g.ori[ti];
        if(!cands.length)continue;
        let sw=cands[0].sw;
        if(cands.length>1){   /* 'best' = จำลองวางชิ้นนี้ให้ครบด้วยแต่ละทิศ แล้วเอาทิศที่วางชิ้นนี้ได้มากกว่า → พื้นที่มากกว่า → กินความกว้างน้อยกว่า */
          let bs=null;
          cands.forEach(function(o){
            const r2=rem.slice();let au=acrossUsed,n=strips.length,placed=0,area=0;
            for(;;){
              if(o.sw>g.acrossCap-au-(n?kerfG:0))break;
              const pk=packStrip(g,o.sw,r2,false,g.alongCap+kerfG);if(!pk||!pk.n)break;
              au+=(n?kerfG:0)+o.sw;n++;
              pk.picks.forEach(p=>{if(r2[p.ti]>0){r2[p.ti]--;if(p.ti===ti)placed++;area+=p.len*o.sw;}});
              if(r2[ti]<=0)break;
            }
            const s={sw:o.sw,placed,area,au};
            if(!bs||s.placed>bs.placed||(s.placed===bs.placed&&(s.area>bs.area||(s.area===bs.area&&s.au<bs.au))))bs=s;
          });
          sw=bs.sw;
        }
        while(rem[ti]>0){const pk=tryW(sw);if(!pk)break;add(sw,pk);}
      }
    }
    if(fill){
      /* เติมในแถบเดิม: Σ(len+ร่อง) ของชิ้นที่เพิ่ม ≤ แผ่น − ยาวเดิม − ร่อง×(n−1) */
      strips.forEach(function(s){
        const L0=s.cuts.reduce((a,c)=>a+c.len,0),n0=s.cuts.length,bud=g.alongCap-L0-kerfG*(n0-1);
        if(bud<=0)return;
        const pk=packStrip(g,s.sw,rem,true,bud);
        if(pk&&pk.n)pk.picks.forEach(p=>{s.cuts.push(p);if(rem[p.ti]>0)rem[p.ti]--;});
      });
      /* แถบใหม่จนเต็มความกว้าง — ลอง 2 ทาง: (ก) ทีละแถบเลือกแถบที่ได้พื้นที่มากสุด · (ข) ใช้ความกว้างเดียวกันซ้ำจนสุดแล้วค่อยเก็บที่เหลือแบบ (ก)
         แล้วเอาทางที่ได้พื้นที่รวมมากสุด (→ ชิ้นที่ขอมากสุด → แถบน้อยสุด) — (ก) อย่างเดียวมองสั้น: ขอ 47.5×87.5 ×1 บน 96×72 จะเปิดแถบ 87.5 (3 ชิ้น) ก่อน
         แล้วเหลือที่ไม่พอ ได้ 8 ชิ้น ทั้งที่แถบ 47.5 ×5 ได้ 10 ชิ้น (= A4) */
      const fillRest=function(fixW){
        const r2=rem.slice(),add2=[];let au=acrossUsed,n=strips.length,area=0,dem=0;
        const roomOf=()=>g.acrossCap-au-(n?kerfG:0);
        const put=(sw,pk)=>{au+=(n?kerfG:0)+sw;n++;add2.push({sw,cuts:pk.picks.slice()});area+=pk.used*sw;dem+=pk.dem;pk.picks.forEach(p=>{if(r2[p.ti]>0)r2[p.ti]--;});};
        if(fixW)for(;;){if(fixW>roomOf())break;const pk=packStrip(g,fixW,r2,true,g.alongCap+kerfG);if(!pk||!pk.n)break;put(fixW,pk);}
        for(;;){
          let best=null;
          g.widths.forEach(function(sw){if(sw>roomOf())return;const pk=packStrip(g,sw,r2,true,g.alongCap+kerfG);if(!pk||!pk.n)return;
            const c={sw,pk,area:pk.used*sw};
            if(!best||c.area>best.area||(c.area===best.area&&(c.pk.dem>best.pk.dem||(c.pk.dem===best.pk.dem&&c.sw>best.sw))))best=c;});
          if(!best)break;
          put(best.sw,best.pk);
        }
        return {add2,area,dem,n:add2.length};
      };
      let bestF=fillRest(0);
      g.widths.forEach(function(w){const f=fillRest(w);
        if(f.area>bestF.area||(f.area===bestF.area&&(f.dem>bestF.dem||(f.dem===bestF.dem&&f.n<bestF.n))))bestF=f;});
      bestF.add2.forEach(s=>add(s.sw,{picks:s.cuts}));
    }
    if(!strips.length)return null;
    return mkLayout(g,strips,false);
  }
  /* ---- ไล่ครบ (G4ข): แบบแถบทุกแบบ → DP (ความกว้างที่เหลือ, จำนวนที่ได้ตัดที่ qty) · เกณฑ์ ขาดน้อยสุด → พื้นที่มากสุด → แถบน้อยสุด ---- */
  function exactRun(g,cap,wantAll,budget){
    const T=types.length,stride=[];let VS=1;
    for(let i=0;i<T;i++){stride.push(VS);VS*=cap[i]+1;}
    if(VS>1099511627776)return {done:false,r:null};  /* 2^40 — คีย์สถานะ (ความกว้าง×VS + เวกเตอร์) ต้องไม่เกินจำนวนเต็มที่ float64 เก็บได้ → ไม่ไล่ครบ */
    const L=g.Lmax,R0=Math.floor(g.acrossCap+kerfG+1e-9);
    const lim=Math.min(budget||GEN_EXACT_WORK,Math.max(0,workBudget-work));
    let ew=0,abort=false;
    const zero=types.map(()=>0),pats=[];
    /* นับจำนวนแบบแถบล่วงหน้า (นับแบบ knapsack ไม่ต้องไล่) — เยอะเกิน GEN_EXACT_PATS×3 = ไม่ไล่ครบเลย ไม่เสียเวลาไล่แล้วทิ้ง */
    const demOf=sw=>(g.items.get(sw)||[]).filter(it=>cap[it.ti]>0);
    let leaves=0;
    for(const sw of g.widths){
      const dem=demOf(sw);if(!dem.length)continue;
      let ways=new Float64Array(L+1);ways[0]=1;
      for(const it of dem){
        const K=Math.min(cap[it.ti],Math.floor(L/it.cost)),nw=new Float64Array(L+1);
        for(let r=0;r<it.cost&&r<=L;r++){let s=0;for(let j=0,c=r;c<=L;j++,c+=it.cost){s+=ways[c];if(j>K)s-=ways[c-(K+1)*it.cost];nw[c]=s;}}
        ways=nw;ew+=L+1;
        if(ew>lim){spend(ew);stats.exact_work+=ew;return {done:false,r:null};}
      }
      for(let c=0;c<=L;c++)leaves+=ways[c];
      if(leaves>GEN_EXACT_PATS*3){spend(ew);stats.exact_work+=ew;return {done:false,r:null};}
    }
    /* แบบแถบต่อความกว้าง: ทุกจำนวนของชิ้นที่ขอ (≤ qty) + fill เติมที่เหลือ · เวกเตอร์เดียวกัน (ตัดที่ qty) เก็บแบบพื้นที่มากสุด
       พิสูจน์ว่าพอ: แถบใดก็ตามในผังดีสุด แทนด้วยแบบของเวกเตอร์ (ตัดที่ qty) ของมันได้ โดยได้ชิ้นที่ขอไม่น้อยลงและพื้นที่ไม่น้อยลง (เติมที่เหลือ = ยาวมากสุดแล้ว) */
    for(const sw of g.widths){
      const dem=demOf(sw);
      if(!dem.length&&!fill)continue;
      const byV=new Map(),cnt=new Array(dem.length).fill(0);
      const leaf=function(used){
        const pk=(fill&&L-used>0)?packStrip(g,sw,zero,true,L-used):null;
        const v=zero.slice();let len=0,nc=0;
        for(let q=0;q<dem.length;q++)if(cnt[q]){v[dem[q].ti]+=cnt[q];len+=cnt[q]*dem[q].len;nc+=cnt[q];}
        if(pk)for(const tc of pk.tiCnt){v[tc[0]]+=tc[1];}
        if(pk){len+=pk.used;nc+=pk.n;}
        if(!nc)return;
        let vi=0;for(let i=0;i<T;i++){if(v[i]>cap[i]){if(!fill)return;v[i]=cap[i];}vi+=v[i]*stride[i];}
        const area=len*sw,cur=byV.get(vi);
        if(!cur||area>cur.area||(area===cur.area&&nc<cur.nc))byV.set(vi,{sw,cost:sw+kerfG,v,vi,area,nc,cnt:cnt.slice(),pk,dem,
          nz:v.map((x,i)=>x?i:-1).filter(i=>i>=0)});
      };
      const rec=function(j,used){
        if(++ew>lim){abort=true;return;}
        if(j===dem.length){leaf(used);return;}
        const it=dem[j],top=Math.min(cap[it.ti],Math.floor((L-used)/it.cost));
        for(let k=top;k>=0&&!abort;k--){cnt[j]=k;rec(j+1,used+k*it.cost);}
        cnt[j]=0;
      };
      rec(0,0);
      if(abort)break;
      byV.forEach(p=>pats.push(p));
      if(pats.length>GEN_EXACT_PATS){abort=true;break;}
    }
    if(abort||!pats.length){spend(ew);stats.exact_work+=ew;return {done:!abort,r:null};}
    pats.sort((x,y)=>x.cost-y.cost||y.area-x.area||x.vi-y.vi);
    /* DP: f(ความกว้างที่เหลือ R, เวกเตอร์ที่ได้ v) = ดีสุดของแถบที่เหลือ · เกณฑ์ ขาดน้อยสุด → พื้นที่มากสุด → แถบน้อยสุด → แบบแรกตามลำดับ (คงที่) */
    const memo=new Map();
    /* wantAll (G10): ขนาดที่ไม่มีในผังเลย ปรับหนักกว่าจำนวนที่ขาดรวมทั้งหมด (BIG > Σ cap) → DP ได้ "ครบทุกขนาดก่อน แล้วค่อยพื้นที่มากสุด" */
    const BIG=wantAll?(cap.reduce((a,c)=>a+c,0)+1):0;
    const shortOf=v=>{let s=0;for(let i=0;i<T;i++){s+=cap[i]-v[i];if(BIG&&cap[i]>0&&!v[i])s+=BIG;}return s;};
    const f=function(R,v,vi){
      let best={s:shortOf(v),a:0,n:0,p:null,nx:null};
      for(let pi=0;pi<pats.length;pi++){
        const p=pats[pi];if(p.cost>R)break;
        if(++ew>lim){abort=true;return best;}
        let nvi=vi,ok=true;
        for(const i of p.nz){let x=v[i]+p.v[i];if(x>cap[i]){if(!fill){ok=false;break;}x=cap[i];}nvi+=(x-v[i])*stride[i];}
        if(!ok)continue;
        const R2=R-p.cost,k2=R2*VS+nvi;
        let r=memo.get(k2);
        if(r===undefined){
          const nv=v.slice();for(const i of p.nz)nv[i]=Math.min(cap[i],v[i]+p.v[i]);
          r=f(R2,nv,nvi);if(abort)return best;
          memo.set(k2,r);if(memo.size>GEN_EXACT_STATES){abort=true;return best;}
        }
        const a=r.a+p.area,n=r.n+1;
        if(r.s<best.s||(r.s===best.s&&(a>best.a||(a===best.a&&n<best.n))))best={s:r.s,a,n,p,nx:r};
      }
      return best;
    };
    const top=f(R0,zero.slice(),0);
    spend(ew);stats.exact_work+=ew;
    if(abort)return {done:false,r:null};
    const strips=[];
    for(let x=top;x&&x.p;x=x.nx){
      const p=x.p,cuts=[];
      p.dem.forEach((it,q)=>{for(let k=0;k<p.cnt[q];k++)cuts.push({ti:it.ti,len:it.len});});
      if(p.pk)p.pk.picks.forEach(c=>cuts.push({ti:c.ti,len:c.len}));
      strips.push({sw:p.sw,cuts});
    }
    return {done:true,r:strips.length?mkLayout(g,strips,true):null};
  }
  /* ---- ประกอบผลต่อผัง (G7 ตรวจ · why ไทย) ---- */
  function finish(r){
    const g=r.g,layout=r.layout,axisWord=g.vertical?'กว้าง':'สูง';
    const got=types.map(()=>0);let used_mm2=0;
    layout.strips.forEach(s=>s.cuts.forEach(c=>{const ti=tiByKey.get(pieceKey(s.size_mm,c.size_mm)+'|'+c.piece_id);if(ti!==undefined)got[ti]++;used_mm2+=s.size_mm*c.size_mm;}));
    const pieces=types.map((t,i)=>Object.assign(pieceRef(t),{want:t.qty,got:got[i],short:Math.max(0,t.qty-got[i]),extra:Math.max(0,got[i]-t.qty)}));
    const whyOf=t=>t.big?t.bigWhy:(!g.ori[t.i].length?(g.realCut[t.i]?'ยาวกว่าแผ่นจริงในทิศ'+g.dir:'วางไม่ลงในทิศ'+g.dir):'ไม่มีที่พอ');
    const typeOf=p=>types[tiByKey.get(p.key+'|'+(p.piece_id||NEW_PIECE_PREFIX+p.key))];
    const miss=pieces.filter(p=>p.short>0).map(function(p){const t=typeOf(p);
      return {piece:pieceRef(t),want:p.want,got:p.got,short:p.short,why:whyOf(t)};});
    /* ขนาดที่ไม่มีในผังนี้เลย (แม้แถวที่ไม่ใส่จำนวน) — ใช้ตัดสิน "มีครบทุกขนาดที่กรอก" (G10) */
    const none=pieces.filter(p=>p.got===0).map(p=>({piece:pieceRef(typeOf(p)),why:whyOf(typeOf(p))}));
    const why=[];let acrossSum=0;
    layout.strips.forEach(function(s,i){
      acrossSum+=s.size_mm;
      const L=s.cuts.reduce((a,c)=>a+c.size_mm,0)+kerf*(s.cuts.length-1)+2*trim,rest=g.along-L;
      let desc;
      if(s.full_length)desc='ชิ้นเดียวยาวเต็มแผ่น '+cmTxt(s.cuts[0].size_mm);
      else{const grp=[];s.cuts.forEach(c=>{const l=grp[grp.length-1];if(l&&l.mm===c.size_mm)l.n++;else grp.push({mm:c.size_mm,n:1});});
        desc='ซอย '+grp.map(x=>cmTxt(x.mm)+' ×'+x.n).join(' + ');}
      why.push('แถบที่ '+(i+1)+' '+axisWord+' '+cmTxt(s.size_mm)+': '+desc+((s.full_length||rest<=0)?' (เต็มพอดี)':' (เหลือ '+cmTxt(rest)+' ซม.)'));
    });
    const n=layout.strips.length,acrossTot=acrossSum+kerf*(n-1)+2*trim,left=g.across-acrossTot;
    why.push('รวม '+n+' แถบ '+axisWord+' '+cmTxt(acrossTot)+' ซม. จากแผ่น '+cmTxt(g.across)+' ซม.'+(left<=0?' (เต็มพอดี)':' (เหลือ '+cmTxt(left)+' ซม.)'));
    const ex=pieces.filter(p=>p.extra>0);
    if(ex.length)why.push((fill?'เติมให้เต็มแผ่น: ':'ได้เพิ่มจากที่ขอ: ')+ex.map(p=>p.name+' +'+p.extra+' ตัว').join(' · '));
    miss.forEach(m=>why.push('ชิ้น '+m.piece.name+' ใส่ได้ '+m.got+' จาก '+m.want+' (ขาด '+m.short+' — '+m.why+')'));
    none.forEach(function(x){if(!miss.some(m=>m.piece.key===x.piece.key))why.push('ชิ้น '+x.piece.name+' ไม่ได้อยู่ในผังนี้เลย ('+x.why+')');});
    return {rank:0,layout,'yield':patternYield(layout),used_pct:patternUsedPct(layout,sheet),used_mm2,covered:!miss.length,short_n:miss.reduce((a,m)=>a+m.short,0),
      missing:miss,pieces,strips_n:n,direction:g.dir,why,sig:r.sig,exact:r.exact,
      has_all:!none.length,sizes_missing:none.length,no_size:none,best_area:false};
  }
  /* ---- ลองทุกทิศ × ลำดับ × ทิศชิ้น (G4) → ไล่ครบ (G4ข) ---- */
  const idx=types.map(t=>t.i);
  const orders=[idx.slice(),
    idx.slice().sort((x,y)=>types[y].b-types[x].b||x-y),
    idx.slice().sort((x,y)=>types[y].qty-types[x].qty||x-y)];
  const seen=new Map();
  const keep=r=>{if(r&&!seen.has(r.sig))seen.set(r.sig,r);else if(r&&r.exact)seen.get(r.sig).exact=true;};
  /* รอบค้น: ไม่ require_all = ชุดเดียว (เหมือนเดิมเป๊ะ) · require_all ที่มีผล = ชุด "ต้องครบทุกขนาด" ก่อน แล้วชุดเดิม (ได้ใบพื้นที่มากสุดมาเทียบด้วย) */
  const capSets=needAll?[{cap:capNeed,all:true},{cap:capQty,all:false}]:[{cap:capQty,all:false}];
  /* งบไล่ครบต่อทิศ "หารกันระหว่างรอบ" — เปิด require_all แล้วต้องไม่ใช้งบ (และเวลา) มากกว่าตอนรอบเดียวของเดิม
     (ขนาดเล็กหลายขนาด เพดานความต้องการ 1 ทำให้แบบแถบโตเร็วมาก · งบหมด = ผลของทิศนั้นมาจากลำดับวาง และมีข้อความบอกบนจอ) */
  const exactBudget=Math.floor(GEN_EXACT_WORK/capSets.length);
  capSets.forEach(function(cs){
    G.forEach(g=>keep(runOne(g,null,'greedy',cs.cap)));    /* greedy ของทุกทิศรันเสมอ (มีผลให้ดูแม้งบหมด) */
    G.forEach(function(g){
      orders.forEach(o=>['short','long','best'].forEach(function(m){if(!over)keep(runOne(g,o,m,cs.cap));}));
    });
    G.forEach(function(g){
      if(over){stats.exact[g.dir]=false;return;}
      const x=exactRun(g,cs.cap,cs.all,exactBudget);
      if(stats.exact[g.dir]!==false)stats.exact[g.dir]=x.done;   /* ไล่ครบ = ต้องครบทุกรอบของทิศนั้น */
      if(x.r)keep(x.r);
    });
  });
  stats.exact_all=G.every(g=>stats.exact[g.dir]===true);
  stats.require_all=reqAll;
  stats.work=work;stats.budget_hit=over;
  if(over)messages.push('หยุดค้นเมื่อครบงบคำนวณ — ผลที่แสดงอาจไม่ใช่ทางที่ดีที่สุด (ลดจำนวนชิ้น/ขนาดแล้วลองใหม่)');
  else if(!stats.exact_all)messages.push('ชิ้นหลายขนาด/หลายจำนวน ไล่ครบทุกแบบไม่ทันงบ'+(G.length>1?' ('+G.filter(g=>stats.exact[g.dir]===false).map(g=>g.dir).join(' · ')+')':'')+
    ' — ผลที่แสดงมาจากการลองลำดับวาง อาจไม่ใช่ทางที่ดีที่สุด');
  let dropped=0;
  const all=[];
  seen.forEach(function(r){
    const v=validatePattern(r.layout,sheet,vreg,rules);
    if(v.errors.length){dropped++;return;}
    all.push(finish(r));
  });
  stats.dropped=dropped;
  if(dropped)messages.push('ผังที่คิดได้ '+dropped+' แบบไม่ผ่านตัวตรวจผัง — ระบบทิ้งแล้ว');
  /* เรียง (G8 เดิม): ครบจำนวนที่กรอกก่อนเสมอ — "ใส่จำนวน = ต้องได้อย่างน้อยเท่านั้นต่อแผ่น" ตามที่กล่อง ✨ สัญญาไว้
     needAll (G10) = มีแถวที่ไม่ใส่จำนวน → แทรก "ขนาดที่หายทั้งขนาด" ไว้หลัง covered (ไม่ใส่จำนวนทุกแถว = covered จริงทุกใบ → เหลือ ขนาดหายน้อยสุด → พื้นที่มากสุด)
     ใส่จำนวนครบทุกแถว (needAll = false) = เกณฑ์เดิมเป๊ะ ไม่แตะ */
  all.sort((x,y)=>(y.covered?1:0)-(x.covered?1:0)||(needAll?x.sizes_missing-y.sizes_missing:0)||x.short_n-y.short_n||y.used_mm2-x.used_mm2||
    (x.direction===DIR_V?0:1)-(y.direction===DIR_V?0:1)||x.strips_n-y.strips_n||byStr(x.sig,y.sig));
  /* ผลผลิตเหมือนกันเป๊ะในทิศเดียวกัน = การ์ดซ้ำ → เก็บอันดับดีกว่าไว้แบบเดียว (G7) */
  const ySeen=new Set();
  all.forEach(function(x){const yk=x.direction+'|'+x['yield'].map(q=>q.piece_id+':'+q.qty).join(',');if(ySeen.has(yk))return;ySeen.add(yk);results.push(x);});
  stats.unique=results.length;
  /* ใบที่ต้องได้กลับไปเสมอแม้หลุด max_results: ① ใบที่ใช้พื้นที่มากสุด (ป้าย best_area) ② ใบแรกที่มีครบทุกขนาด (G10 · เฉพาะตอนมีแถวที่ไม่ใส่จำนวน)
     วางไว้ท้ายรายการที่แสดง — ห้ามแทนอันดับ 1 (ผังที่ 1 คือผังที่แนะนำ · maxRes = 1 จึงไม่แทนเลย) */
  let bi=0;
  results.forEach((x,i)=>{if(x.used_mm2>results[bi].used_mm2)bi=i;});
  if(results.length)results[bi].best_area=true;
  if(maxRes>1){
    const must=[bi];
    if(needAll){const ai=results.findIndex(x=>x.has_all);if(ai>=0&&must.indexOf(ai)<0)must.push(ai);}
    const pins=must.filter(i=>i>=maxRes).sort((x,y)=>x-y).slice(0,maxRes-1);
    if(pins.length){
      const keepRows=pins.map(i=>results[i]),head=results.filter((x,i)=>pins.indexOf(i)<0).slice(0,maxRes-pins.length);
      results.length=0;head.concat(keepRows).forEach(x=>results.push(x));
    }
  }
  results.splice(maxRes);
  results.forEach((r,i)=>{r.rank=i+1;});
  if(!results.length)messages.push(over?'คำนวณไม่ทันงบ — ยังไม่ได้ผังที่ผ่านตัวตรวจ ลองลดจำนวนขนาด/ชิ้นแล้วคิดใหม่':'คิดผังไม่ได้เลยบนแผ่น '+sheetName+' — ลองแผ่นขนาดอื่น หรือลดจำนวนชิ้น');
  else{
    /* ข้อความ "ไล่ครบทุกแบบแล้ว" ต้องพิสูจน์ได้จากตัวเลขบนจอ: ถ้าใบที่ใช้พื้นที่มากสุดไม่ใช่แบบที่ 1 ห้ามอ้างว่า "ไม่มีแบบไหนใช้พื้นที่มากกว่าแบบที่ 1" — บอกตรง ๆ ว่าใบนั้นแพ้ตรงไหน */
    const babove=results.findIndex(x=>x.best_area&&x.rank>1&&x.used_mm2>results[0].used_mm2);
    let sure;
    if(!stats.exact_all)sure=' (ไม่ได้ไล่ครบทุกทาง)';
    else if(babove<0)sure=' (ไล่ครบทุกแบบของผังแถบ→ซอยแล้ว — ไม่มีแบบไหนขาดน้อยกว่าหรือใช้พื้นที่มากกว่าแบบที่ 1)';
    else{
      const b=results[babove];
      const lose=(results[0].covered&&!b.covered)?'แต่ยังไม่ครบตามจำนวนที่ขอ'
        :(needAll&&b.sizes_missing>results[0].sizes_missing)?'แต่ไม่มีครบทุกขนาดที่กรอก'
        :'แต่ขาดชิ้นมากกว่า';
      sure=' (ไล่ครบทุกแบบของผังแถบ→ซอยแล้ว — ไม่มีแบบไหนดีกว่าแบบที่ 1 · แบบที่ '+b.rank+' ใช้พื้นที่มากกว่า ('+numTxt(b.used_pct)+'%) '+lose+')';
    }
    messages.push('ลอง '+stats.runs+' รอบ'+(stats.exact_all?' + ไล่ครบทุกแบบ':'')+' ได้ผังต่างกัน '+stats.unique+' แบบ · แสดง '+results.length+' แบบที่ดีที่สุดที่หาเจอ'+sure+
      (results[0].covered?'':' · ยังไม่มีแบบไหนได้ครบตามจำนวนที่ขอในแผ่นเดียว'));
  }
  /* G10: บอกบนจอว่าผังที่ 1 มีครบทุกขนาดที่กรอกไหม · ไม่ครบ = ชี้ใบที่ครบ (ถ้ามี) หรือบอกว่าขนาดไหนใส่ไม่ลงเพราะอะไร
     เฉพาะตอน needAll (มีแถวที่ไม่ใส่จำนวน) — ใส่จำนวนครบทุกแถว = ไม่ได้ไล่รอบ "ต้องครบทุกขนาด" จึงไม่อ้างอะไรเรื่องนี้ */
  if(needAll&&results.length){
    const ai=results.findIndex(x=>x.has_all);
    if(ai===0)messages.push('ผังที่ 1 มีครบทุกขนาดที่กรอก (อย่างน้อยขนาดละ 1 ชิ้น)');
    else if(ai>0)messages.push('ผังที่ 1 ได้ครบตามจำนวนที่กรอกก่อน จึงไม่มี '+results[0].no_size.map(x=>x.piece.name).join(' · ')+' ในผัง'+
      ' — อยากได้ทุกขนาดในแผ่นเดียว ดูแบบที่ '+results[ai].rank+' (มีครบทุกขนาด · ใช้พื้นที่ '+numTxt(results[ai].used_pct)+'%'+(results[ai].covered?'':' · ขาด '+results[ai].short_n+' ชิ้น')+')');
    else messages.push((stats.exact_all?'ใส่ครบทุกขนาดในแผ่น '+sheetName+' แผ่นเดียวไม่ได้ (ไล่ครบทุกแบบแล้ว)':'ยังหาผังที่มีครบทุกขนาดบนแผ่น '+sheetName+' ไม่เจอ (ไม่ได้ไล่ครบทุกทาง)')+
      ' — ขาด '+results[0].no_size.map(x=>x.piece.name+' ('+x.why+')').join(' · '));
  }
  return out;
}

/* ==================== ส่วนที่ 4 — สรุปการใช้กระจกแผ่นใหญ่ (เทียบบิลร้าน · เจ้าของสั่ง 7 ต.ค. 69) ====================
   ทำไม: ร้านกระจก **ออกบิลเป็นแผ่นใหญ่** (ขนาด×สี × จำนวนแผ่น × ราคา/แผ่น) ไม่ใช่เป็นแพทเทิร์น
         ใบสั่งของเราเก็บเป็นบรรทัด "แพทเทิร์น×สี×แผ่น" → ต้องยุบเป็น "ขนาดแผ่น×สี" ก่อนจึงกระทบยอดกับบิลได้
   ⭐ ตัวเลขทุกตัวอ่านจาก snapshot ในใบ (lines[].sheets · unit_price_satang · amount_satang · sheet_name · sheet_size_id)
      ห้ามคิดใหม่จากทะเบียนปัจจุบัน — บิลที่ร้านออกมาใช้ราคาของวันที่สั่ง ไม่ใช่ราคาวันนี้
   ⭐ นับใบ "อนุมัติแล้วขึ้นไป" = อนุมัติแล้ว / ส่งแล้ว / รับของแล้ว (เจ้าของเคาะ 7 ต.ค. 69)
      ไม่นับ ร่าง / รออนุมัติ / ตีกลับ / ยกเลิก — ของพวกนั้นร้านไม่ได้ตัด จึงไม่มีในบิล
   ⭐ ช่วงวันที่เทียบด้วย **วันที่รับของ** (received_at · วันตามเวลาไทย) ตามที่เจ้าของเคาะ
      ใบที่อยู่ในขอบเขตแต่ยังไม่รับของ (อนุมัติแล้ว/ส่งแล้ว) = ไม่มีวันให้เทียบ → แยกไว้กอง "ยังไม่รับของ" ไม่เอามารวมยอด
      ไม่ได้ใส่ช่วงวันที่เลย = รวมทุกใบในขอบเขต (ไม่มีอะไรต้องเทียบ)
   ⭐ ราคาต่อแผ่นเท่ากัน = บรรทัดเดียว · ราคาต่าง = แยกบรรทัด + ข้อความบอก (บิลร้านก็แยกบรรทัดแบบนี้)
   ⭐ ไม่แตะ DOM ไม่แตะฐาน — รับ array ของแถว glass_pattern_orders ตรง ๆ เทสด้วย node ได้ */
const USAGE_STATES=['อนุมัติแล้ว','ส่งแล้ว','รับของแล้ว'];        /* "อนุมัติแล้วขึ้นไป" */
const USAGE_DATE_FIELDS=['received_at','sent_at','created_at'];   /* ช่องวันที่ที่ยอมให้ใช้เทียบช่วง (ตั้งต้น = วันที่รับของ) */

/* timestamp → วันตามเวลาไทย 'YYYY-MM-DD' ('' = ว่าง/อ่านไม่ออก) — ตัวจริงของทั้งแอป (หน้าเว็บเรียกตัวนี้ ห้ามมีสูตรชุดที่สอง)
   รับได้ทั้ง timestamptz ('2026-10-07T03:00:00Z') และวันเปล่า ('2026-10-07' = เที่ยงคืน UTC → เวลาไทยยังวันเดิม) */
function bkkDay(ts){
  if(ts==null||ts==='')return '';
  const d=ts instanceof Date?ts:new Date(String(ts));
  if(!(d instanceof Date)||isNaN(d.getTime()))return '';
  try{const s=d.toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'});return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:d.toISOString().slice(0,10);}
  catch(e){return d.toISOString().slice(0,10);}
}

function sheetUsage(orders,opts){
  const o=(opts&&typeof opts==='object')?opts:{};
  const states=(Array.isArray(o.statuses)&&o.statuses.length)?[...new Set(o.statuses.map(idOf).filter(Boolean))]:USAGE_STATES.slice();
  const df=USAGE_DATE_FIELDS.indexOf(idOf(o.date_field))>=0?idOf(o.date_field):USAGE_DATE_FIELDS[0];
  const dayRe=/^\d{4}-\d{2}-\d{2}$/;
  let from=dayRe.test(idOf(o.from))?idOf(o.from):'',to=dayRe.test(idOf(o.to))?idOf(o.to):'';
  const msgs=[];
  if(from&&to&&from>to){const t=from;from=to;to=t;msgs.push('วันที่เริ่มอยู่หลังวันที่จบ — สลับให้เป็น '+from+' ถึง '+to);}
  /* ชื่อ/ลำดับสี: ใช้ settings.glass_colors ที่หน้าเว็บส่งมา · ไม่ส่ง = 3 สีตั้งต้น */
  const cIdx=new Map(),cNm=new Map();
  (Array.isArray(o.colors)&&o.colors.length?o.colors:DEFAULT_COLORS).forEach(function(c,i){
    const k=idOf(c&&typeof c==='object'?c.key:c);
    if(k&&!cIdx.has(k)){cIdx.set(k,i);cNm.set(k,String((c&&typeof c==='object'&&c.name)||k));}
  });
  const colOrd=k=>cIdx.has(k)?cIdx.get(k):1e6,colNm=k=>cNm.has(k)?cNm.get(k):(k||'ไม่ระบุสี');
  const nn=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n):0;};
  const nnn=v=>Math.max(0,nn(v));

  /* ---------- ยุบบรรทัดแพทเทิร์นของใบเดียว → บรรทัดแผ่นใหญ่ ---------- */
  function rowsOf(row,id){
    const g=new Map();
    (Array.isArray(row.lines)?row.lines:[]).forEach(function(L){
      if(!L||typeof L!=='object')return;
      const sheets=nnn(L.sheets);
      if(!sheets)return;                                   /* แผ่น 0 = ไม่ได้สั่ง จึงไม่อยู่ในบิล */
      const ck=idOf(L.color),sid=idOf(L.sheet_size_id),unit=nnn(L.unit_price_satang);
      const nm=String(L.sheet_name||'').trim()||(sid?'แผ่น '+sid:'ไม่ระบุขนาดแผ่น');
      /* ยอดเงิน: ใช้ amount_satang ที่บันทึกในใบเป็นความจริง (ยอดใบคิดจากตัวนี้) · ไม่มี/ไม่ใช่จำนวนเต็ม = แผ่น×ราคา
         ต่างกัน = ข้อความเตือน (ของจริงไม่ควรเกิด แต่ถ้าเกิดต้องเห็น ไม่ใช่กลืนเงียบ) */
      const raw=L.amount_satang,calc=sheets*unit;
      let amt=calc;
      if(Number.isInteger(raw)&&raw>=0){amt=raw;
        if(raw!==calc)msgs.push(id+' · '+nm+' '+colNm(ck)+': ยอดที่บันทึกในใบ '+bahtTxt(raw)+' ไม่เท่ากับ '+sheets+' แผ่น × '+bahtTxt(unit)+' = '+bahtTxt(calc)+' — สรุปนี้ใช้ยอดที่บันทึกในใบ');}
      const k=(sid||'ชื่อ:'+nm)+'|'+ck+'|'+unit,cur=g.get(k);
      const code=String(L.code||L.pattern_id||'').trim();
      if(cur){cur.sheets+=sheets;cur.amount_satang+=amt;if(code)cur._c.set(code,(cur._c.get(code)||0)+sheets);}
      else{const c=new Map();if(code)c.set(code,sheets);
        g.set(k,{key:k,sheet_size_id:sid,sheet_name:nm,color:ck,color_name:colNm(ck),unit_price_satang:unit,sheets:sheets,amount_satang:amt,_c:c});}
    });
    const out=[...g.values()].map(function(r){
      r.codes=[...r._c.entries()].map(e=>({code:e[0],sheets:e[1]})).sort((a,b)=>natCmp(a.code,b.code));
      delete r._c;return r;});
    out.sort((a,b)=>natCmp(a.sheet_name,b.sheet_name)||colOrd(a.color)-colOrd(b.color)||byStr(a.color,b.color)||a.unit_price_satang-b.unit_price_satang);
    return out;
  }

  /* ---------- คัดใบตามสถานะ + ช่วงวันที่ ---------- */
  const kept=[],pending=[],skipped={status:0,date:0,noline:0,noline_ids:[]};
  (Array.isArray(orders)?orders:[]).forEach(function(row){
    if(!row||typeof row!=='object')return;
    const st=idOf(row.status);
    if(states.indexOf(st)<0){skipped.status++;return;}
    const id=idOf(row.id)||'(ไม่มีเลขใบ)';
    const rws=rowsOf(row,id);
    const ord={id:id,status:st,
      day:bkkDay(row[df]),date_field:df,
      created_day:bkkDay(row.created_at),sent_day:bkkDay(row.sent_at),received_day:bkkDay(row.received_at),
      eta_date:idOf(row.eta_date),
      supplier:String(((row.supplier&&typeof row.supplier==='object')?row.supplier.name:'')||''),
      created_by_name:String(row.created_by_name||''),note:String(row.note||''),
      rows:rws,sheets:rws.reduce((a,r)=>a+r.sheets,0),amount_satang:rws.reduce((a,r)=>a+r.amount_satang,0),
      total_satang:nn(row.total_satang)};
    if(!rws.length){skipped.noline++;skipped.noline_ids.push(id);return;}   /* ใบอนุมัติแล้วที่ไม่มีรายการ = ไม่มีอะไรให้เทียบบิล */
    if(ord.amount_satang!==ord.total_satang)
      msgs.push(id+': ยอดรวมที่บันทึกในใบ '+bahtTxt(ord.total_satang)+' ไม่เท่ากับผลรวมรายการ '+bahtTxt(ord.amount_satang)+' — สรุปนี้รวมจากรายการในใบ');
    if(!ord.day){
      if(from||to){pending.push(ord);return;}    /* ใส่ช่วงวันที่ไว้ แต่ใบนี้ยังไม่มีวันให้เทียบ → แยกกอง ไม่รวมยอด */
    }else{
      if(from&&ord.day<from){skipped.date++;return;}
      if(to&&ord.day>to){skipped.date++;return;}
    }
    kept.push(ord);
  });
  kept.sort((a,b)=>byStr(a.day||'~',b.day||'~')||natCmp(a.id,b.id));
  pending.sort((a,b)=>natCmp(a.id,b.id));

  /* ---------- รวมทุกใบ → บรรทัดแผ่นใหญ่ของทั้งช่วง (ตัวนี้คือตัวที่เอาไปกระทบบิล) ---------- */
  const G=new Map();
  kept.forEach(function(ord){
    ord.rows.forEach(function(r){
      const cur=G.get(r.key);
      if(cur){cur.sheets+=r.sheets;cur.amount_satang+=r.amount_satang;cur.order_ids.push(ord.id);
        r.codes.forEach(c=>cur._c.set(c.code,(cur._c.get(c.code)||0)+c.sheets));}
      else{const c=new Map();r.codes.forEach(x=>c.set(x.code,x.sheets));
        G.set(r.key,{key:r.key,sheet_size_id:r.sheet_size_id,sheet_name:r.sheet_name,color:r.color,color_name:r.color_name,
          unit_price_satang:r.unit_price_satang,sheets:r.sheets,amount_satang:r.amount_satang,order_ids:[ord.id],_c:c});}
    });
  });
  const rows=[...G.values()].map(function(r){
    r.codes=[...r._c.entries()].map(e=>({code:e[0],sheets:e[1]})).sort((a,b)=>natCmp(a.code,b.code));
    r.orders=r.order_ids.length;delete r._c;return r;});
  rows.sort((a,b)=>natCmp(a.sheet_name,b.sheet_name)||colOrd(a.color)-colOrd(b.color)||byStr(a.color,b.color)||a.unit_price_satang-b.unit_price_satang);

  /* ยอดย่อยต่อขนาดแผ่น (รวมทุกสี) — ให้หน้าเว็บ/CSV ใช้ ไม่ต้องบวกเองอีกชุด */
  const S=new Map();
  rows.forEach(function(r){
    const k=r.sheet_size_id||'ชื่อ:'+r.sheet_name,cur=S.get(k);
    if(cur){cur.sheets+=r.sheets;cur.amount_satang+=r.amount_satang;}
    else S.set(k,{sheet_size_id:r.sheet_size_id,sheet_name:r.sheet_name,sheets:r.sheets,amount_satang:r.amount_satang});
  });
  const sheets_by_size=[...S.values()].sort((a,b)=>natCmp(a.sheet_name,b.sheet_name));
  /* ยอดย่อยต่อสี (รวมทุกขนาด) */
  const C=new Map();
  rows.forEach(function(r){
    const cur=C.get(r.color);
    if(cur){cur.sheets+=r.sheets;cur.amount_satang+=r.amount_satang;}
    else C.set(r.color,{color:r.color,color_name:r.color_name,sheets:r.sheets,amount_satang:r.amount_satang});
  });
  const sheets_by_color=[...C.values()].sort((a,b)=>colOrd(a.color)-colOrd(b.color)||byStr(a.color,b.color));

  /* ---------- ข้อความประกอบ ---------- */
  /* แผ่น×สี เดียวกันแต่หลายราคาในช่วงเดียว = ต้องบอก ไม่ใช่เฉลี่ยให้ (บิลร้านก็แยกบรรทัด) */
  const P=new Map();
  rows.forEach(function(r){
    const k=(r.sheet_size_id||'ชื่อ:'+r.sheet_name)+'|'+r.color;
    if(!P.has(k))P.set(k,{name:r.sheet_name,color_name:r.color_name,prices:new Set()});
    P.get(k).prices.add(r.unit_price_satang);
  });
  P.forEach(function(v){
    if(v.prices.size>1)msgs.push(v.name+' '+v.color_name+': ในช่วงนี้มี '+v.prices.size+' ราคาต่อแผ่น ('+
      [...v.prices].sort((a,b)=>a-b).map(p=>bahtTxt(p)).join(' · ')+') — แยกบรรทัดให้แล้ว เทียบบิลทีละราคา');
  });
  if(pending.length)msgs.push('อีก '+pending.length+' ใบ ('+pending.map(x=>x.id).join(' · ')+') อยู่ในขอบเขตแต่ยังไม่ได้กด "รับของแล้ว" จึงไม่มีวันที่รับของให้เทียบช่วง — ไม่รวมในยอดข้างบน (รวมได้ '+
    pending.reduce((a,x)=>a+x.sheets,0)+' แผ่น '+bahtTxt(pending.reduce((a,x)=>a+x.amount_satang,0))+' บาท)');
  if(skipped.noline)msgs.push('ข้าม '+skipped.noline+' ใบที่ไม่มีรายการสั่งเลย ('+skipped.noline_ids.join(' · ')+')');

  const totals={orders:kept.length,sheets:rows.reduce((a,r)=>a+r.sheets,0),
    amount_satang:rows.reduce((a,r)=>a+r.amount_satang,0),rows:rows.length,
    sizes:sheets_by_size.length,colors:sheets_by_color.length};
  return {from:from,to:to,date_field:df,statuses:states,
    rows:rows,sheets_by_size:sheets_by_size,sheets_by_color:sheets_by_color,
    orders:kept,pending:pending,skipped:skipped,totals:totals,messages:msgs};
}

/* ==================== API ==================== */
const GlassEngine={
  /* ค่าคงที่ */
  MM_PER_IN,MM2_PER_SQFT,SQIN_PER_SQFT,CUT_STOCK_TOL_MM,DIRECTIONS,DEFAULT_COLORS,PASTEL,
  /* ฟังก์ชันช่วยหน่วย */
  mmOfCm,cmTxt,cmFixed,pieceKey,normalizeKey,pieceName,inToMm,mmOfInch,sqftOf,sqftOfInches,esc,
  roundTolMm,inchRoundErrMm,labelRoundErrMm,   /* ค่าคลาดจากการปัดเศษ (ทาง ค · 13 ก.ย. 69) — แทน roundTol(n) เดิม */
  fullLengthMm,                                /* ความยาวชิ้นเต็มแผ่น = ปัดลงจากนิ้ว (เจ้าของยืนยัน 13 ก.ย. 69 · 72 นิ้ว = 1828) */
  labelOk,                                     /* ป้ายตัวเลขตามรูป ("43.05") ใช้ได้ไหม — รูป PNG ส่งไลน์ (TASK 9) ใช้กติกาเดียวกับผัง SVG */
  LAYOUT_LEVELS,                               /* ผังนี้อ่านได้กี่ขั้น (2 = แถบ→ซอย · 3 = มี sections) — หน้าเว็บเช็คตอนบูต */
  sizeDiffMm,pieceDiffMm,nearStock,
  samePiece,findSamePiece,groupSamePieces,     /* ชิ้นเดียวกันในสต๊อก ≤ 2 มม. ต่อด้าน (เจ้าของเคาะ 13 ก.ย. 69) */
  /* layout */
  normalizeLayout,remapLayout,
  partsOf,sectionsOf,isSplitLayout,              /* ผัง 3 ขั้น "ส่วน" (21 ต.ค. 69) — partsOf คือตัวเดินผังกลาง ห้ามเขียนตัววนชุดที่สองที่อื่น */
  DIRECTIONS,DIR_V,DIR_H,
  /* ส่วนที่ 1 — ผังตัด */
  patternYield,patternUsedPct,patternCutSizes,validatePattern,pieceColor,patternColors,renderPatternSVG,
  patternRects,                                /* ตำแหน่งชิ้นเป็น มม. — ตัววาดรูปทุกตัวต้องใช้ตัวนี้ ห้ามมีสูตรวางชิ้นชุดที่สอง */
  /* ส่วนที่ 2 — ทางเลือกการสั่ง (TASK 5) */
  computeNeeds,computeOptions,applyLines,explain,summarize,
  capOfMax,OPT_OVER_PCT,OPT_OVER_MAX,               /* เพดานเป็นเส้นห้ามข้าม + % ที่ยืดได้ (เจ้าของเคาะ 28 ก.ย. 69) */
  natCmp,bahtTxt,TRIPLE_BUDGET,OPT_POOL,GREEDY_WORK,LS_WORK,LS_STARTS,EXH_BUDGET,_searchColor,
  /* ส่วนที่ 4 — สรุปการใช้กระจกแผ่นใหญ่ เทียบบิลร้าน (7 ต.ค. 69) */
  sheetUsage,bkkDay,USAGE_STATES,USAGE_DATE_FIELDS,
  /* ส่วนที่ 3 — สร้างผังใหม่จากขนาดที่ต้องการ (TASK 12) */
  generatePatterns,NEW_PIECE_PREFIX,GEN_MAX_RESULTS,GEN_RESULTS_CAP,GEN_WORK,GEN_EXACT_WORK,GEN_EXACT_STATES,GEN_EXACT_PATS,
  STATES:{SHORT:ST_SHORT,OK:ST_OK,OVER:ST_OVER,UNSET:ST_UNSET}
};
root.GlassEngine=GlassEngine;
if(typeof module!=='undefined'&&module.exports)module.exports=GlassEngine;
})(typeof globalThis!=='undefined'?globalThis:(typeof window!=='undefined'?window:this));
