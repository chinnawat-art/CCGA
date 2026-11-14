/* erp-link.js — เชื่อมยอดกระจกกับ ERP โรงงาน (CCGA · chinnawat-art.github.io/CCGA) — เจ้าของเลือก "ทางเลือก A" 26 ต.ค. 69
   แอปยังแยกกันอยู่ (คนละ Supabase คนละบัญชี) — ไฟล์นี้แค่ส่งข้อมูลถึงกัน 2 ทาง:
   ① ⤵️ ดึงยอดจาก ERP (หน้า 🧾) : อ่านยอดกระจกใน ERP → จับคู่ชิ้นงานด้วยกติกาเดิม (findSamePiece ≤ 2 มม.) → ทับยอดในตาราง ① (แก้ต่อได้)
   ② 🏭 รับเข้าสต็อก ERP (ใบ รับของแล้ว) : ขึ้นรายการชิ้นที่ได้จากใบ (after[].produced) → คนแก้จำนวนได้ → ยืนยัน → ERP บวกยอด
      ERP กันรับใบเดิมซ้ำเอง (rpc_receive_glass_order) และตรวจสิทธิ์ "🪟 รับกระจกเข้าสต็อก" ที่ฐานข้อมูล
   ล็อกอิน ERP ครั้งเดียวต่อเครื่อง (session เก็บแยกคีย์ glass.erp-auth ไม่ปนกับบัญชีของแอปนี้)
   ไม่แตะเครื่องคิด (shared/glass-engine.js) · ไม่เขียนตาราง glass_* ของแอปนี้ · ทุกตัวเลขมาจาก ERP หรือจาก snapshot ในใบ */
(function(){
'use strict';

   /* publishable (role anon) ของ ERP — ตัวเดียวกับที่เว็บ ERP ใช้อยู่แล้ว */
let erp=null,erpUser=null,erpNext=null;
/* วันเปิดใช้ระบบเชื่อม — ใบที่รับของก่อนวันนี้ "ห้าม" รับเข้า ERP (ของพวกนั้นอยู่ในยอดที่นับ/ปรับไปแล้ว รับซ้ำ = ยอดเกินของจริง) */
const ERP_LINK_START='2026-10-26';
function bkkDay(ts){try{return new Date(ts).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});}catch(e){return '';}}
window.erpCanReceive=function(o){return !!(o&&o.status==='รับของแล้ว'&&o.received_at&&bkkDay(o.received_at)>=ERP_LINK_START);};

function client(){
  erp=(window.auth&&window.auth.supabase)||null;   /* ERP: ใช้ตัวเชื่อมของหน้า (ล็อกอินเดียวกับ ERP) */
  return erp;
}
async function session(){
  const c=client();if(!c)return null;
  try{const {data}=await c.auth.getSession();erpUser=data&&data.session?data.session.user:null;}catch(e){erpUser=null;}
  return erpUser;
}
function authErr(e){const m=String((e&&(e.message||e.code))||'');return /JWT|jwt|401|not authenticated|Invalid Refresh Token/i.test(m);}
function msgOf(e){return String((e&&e.message)||e||'ไม่ทราบสาเหตุ');}

/* ---------- ล็อกอิน ERP (กล่องของแอป) ---------- */
function loginBox(next,why){
  erpNext=next;
  openModal('<h3>🏭 เชื่อมบัญชี ERP โรงงาน</h3>'+
    '<p class="muted" style="margin:6px 0 0">'+esc(why||'ใช้บัญชีเดียวกับที่เข้าเว็บ ERP (หน้าจัดการสต็อก) — ล็อกอินครั้งเดียวต่อเครื่อง')+'</p>'+
    '<label>อีเมลบัญชี ERP</label><input id="erpEmail" type="email" autocomplete="username">'+
    '<label>รหัสผ่าน</label><input id="erpPass" type="password" autocomplete="current-password" onkeydown="if(event.key===\'Enter\')erpDoLogin()">'+
    '<p id="erpLoginErr" class="hidden" style="color:var(--bad);margin:6px 0 0"></p>'+
    '<div class="apbtns"><button class="okbtn" data-nolock onclick="erpDoLogin()">🔐 เข้าสู่ระบบ ERP</button>'+
      '<button class="ghost" data-nolock onclick="closeModal()">ยกเลิก</button></div>');
  const i=$('erpEmail');if(i)i.focus();
}
window.erpDoLogin=async function(){
  const email=String(($('erpEmail')||{}).value||'').trim(),pass=String(($('erpPass')||{}).value||'');
  const err=$('erpLoginErr');
  const show=t=>{if(err){err.textContent=t;err.classList.remove('hidden');}};
  if(!email||!pass)return show('กรอกอีเมลและรหัสผ่านของบัญชี ERP ก่อน');
  const c=client();if(!c)return show('โหลดตัวเชื่อมฐานข้อมูลไม่ได้ — ต่อเน็ตแล้วรีเฟรชหน้า');
  const {data,error}=await c.auth.signInWithPassword({email:email,password:pass});
  if(error)return show('เข้าสู่ระบบ ERP ไม่ได้: '+(/Invalid login/i.test(error.message)?'อีเมลหรือรหัสผ่านไม่ถูกต้อง':error.message));
  erpUser=data&&data.user;closeModal();
  toast('✓ เชื่อมบัญชี ERP แล้ว ('+(erpUser&&erpUser.email||email)+')');
  const n=erpNext;erpNext=null;if(typeof n==='function')n();
};
window.erpLogout=async function(){
  const c=client();if(c){try{await c.auth.signOut();}catch(e){}}
  erpUser=null;Object.keys(receipts).forEach(k=>delete receipts[k]);toast('ออกจากบัญชี ERP บนเครื่องนี้แล้ว');render();
};

/* ---------- อ่านยอดกระจกจาก ERP ----------
   รหัสใน ERP เช่น SLWD-กระจก-ใส-47.5x87.5 (ซม.) → สี + ขนาด มม. (ด้านสั้น×ด้านยาว) */
function parseRows(rows){
  return (rows||[]).map(function(r){
    const s=String(r.product_code||'')+' '+String(r.product_name||'');
    const m=/กระจก-?(?:สี)?(ใส|เขียว|ชาดำ|ฝ้า)[^\d]*?(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/.exec(s);
    if(!m)return null;
    const x=Math.round(Number(m[2])*10),y=Math.round(Number(m[3])*10);
    return {code:String(r.product_code),name:String(r.product_name||''),qty:Math.round(Number(r.quantity)||0),
            color:m[1],a_mm:Math.min(x,y),b_mm:Math.max(x,y)};
  }).filter(Boolean);
}
/* ⚠️ ฐาน ERP ส่งกลับได้ครั้งละ 1,000 แถว (กระจกมี 1,600+ รายการ) — ดึงทีละหน้าจนครบ เรียงตามรหัสให้หน้าไม่เหลื่อมกัน */
async function fetchGlass(){
  const all=[],size=1000;
  for(let from=0;from<20000;from+=size){
    const {data,error}=await client().rpc('rpc_glass_stock_for_order').order('product_code').range(from,from+size-1);
    if(error)throw error;
    const rows=data||[];all.push.apply(all,rows);
    if(rows.length<size)break;
  }
  return parseRows(all);
}

/* ---------- ① ⤵️ ดึงยอดจาก ERP → ทับยอดในตาราง ① (เจ้าของเลือก: ทับ แก้ต่อได้) ---------- */
window.erpPullStock=async function(){
  if(!await session())return loginBox(window.erpPullStock,'ดึงยอดกระจกจาก ERP ต้องล็อกอินบัญชี ERP ที่เข้าหน้า "จัดการสต็อก" ได้');
  if(!lockBusy())return;
  try{
    let items;
    try{items=await fetchGlass();}
    catch(e){
      if(authErr(e)){erpUser=null;return loginBox(window.erpPullStock,'session ERP หมดอายุ — ล็อกอินใหม่');}
      return toast('ดึงยอดจาก ERP ไม่ได้: '+msgOf(e),true);
    }
    const cols=activeColors(),act=pieces.filter(p=>p.active!==false);
    const sum={},src={};
    items.forEach(function(it){
      if(!cols.some(c=>c.key===it.color))return;            /* สีที่แอปนี้ไม่ใช้ (เช่น ฝ้า) — ข้าม */
      const p=GlassEngine.findSamePiece({a_mm:it.a_mm,b_mm:it.b_mm},act);
      if(!p)return;                                          /* ขนาดที่ไม่มีในทะเบียนชิ้นงาน — ข้าม */
      const k=p.id+'|'+it.color;sum[k]=(sum[k]||0)+it.qty;(src[k]=src[k]||[]).push(it.code);
    });
    let n=0;const missing=[];
    act.forEach(p=>cols.forEach(function(c){
      const k=p.id+'|'+c.key;
      if(k in sum){ordSet(p.id,c.key,String(Math.max(0,sum[k])));n++;}
      else missing.push((p.name||pieceName(p.a_mm,p.b_mm))+' '+(c.name||c.key));
    }));
    if(!n)return toast('ไม่พบกระจกใน ERP ที่ตรงกับชิ้นงานของแอปนี้ — ยังไม่ได้เปลี่ยนยอด',true);
    ordFill='เติมยอด '+n+' ช่อง จาก ERP ('+esc(erpUser&&erpUser.email||'')+' · '+new Date().toLocaleString('th-TH',{hour12:false})+')';
    ordDirtyFlag=true;ordDraftSave();render();
    toast('✓ ดึงยอดจาก ERP แล้ว '+n+' ช่อง'+(missing.length?' · ไม่พบใน ERP '+missing.length+' ช่อง (คงค่าเดิม)':'')+' — แก้ทับได้ก่อนกดคำนวณ');
  }finally{freeBusy();}
};

/* ---------- ② 🏭 รับเข้าสต็อก ERP (ใบ รับของแล้ว · ถามยืนยันทุกครั้ง) ---------- */
let rcvRows=[],rcvId='';
window.erpReceiveOrder=async function(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return toast('ไม่พบใบ '+id+' — กด 🔄 แล้วลองใหม่',true);
  if(o.status!=='รับของแล้ว')return toast('⛔ รับเข้าสต็อก ERP ได้เฉพาะใบที่ "รับของแล้ว" (ใบ '+id+' เป็น "'+o.status+'")',true);
  if(!window.erpCanReceive(o))return toast('⛔ ใบ '+id+' รับของก่อนวันเปิดใช้ระบบเชื่อม ('+ERP_LINK_START+') — ของอยู่ในยอดที่นับไว้แล้ว รับเข้า ERP ซ้ำไม่ได้',true);
  if(!await session())return loginBox(function(){window.erpReceiveOrder(id);},'รับกระจกเข้าสต็อก ERP ต้องล็อกอินบัญชี ERP ที่มีสิทธิ์ "🪟 รับกระจกเข้าสต็อก"');
  let rc,items;
  try{
    const r=await client().rpc('rpc_glass_order_receipt',{p_ref:id});
    if(r.error)throw r.error;rc=r.data||{};
    items=await fetchGlass();
  }catch(e){
    if(authErr(e)){erpUser=null;return loginBox(function(){window.erpReceiveOrder(id);},'session ERP หมดอายุ — ล็อกอินใหม่');}
    return toast('อ่านข้อมูลจาก ERP ไม่ได้: '+msgOf(e),true);
  }
  receipts[id]=rc.received?rc:{received:false};
  if(rc.received)
    return openModal('<h3>🏭 ใบ '+esc(id)+' รับเข้าสต็อก ERP แล้ว</h3>'+
      '<p style="margin:8px 0 0">รับเมื่อ <b>'+esc(new Date(rc.at).toLocaleString('th-TH',{hour12:false}))+'</b> โดย '+esc(rc.by||'-')+
      ' · '+(Number(rc.items)||0)+' รายการ รวม '+(Number(rc.pieces)||0)+' ชิ้น</p>'+
      '<p class="muted" style="margin:6px 0 0">ใบเดียวรับซ้ำไม่ได้ (ERP กันไว้) — ถ้ายอดผิด ให้แก้ในหน้าตรวจนับสต็อกของ ERP</p>'+
      '<div class="apbtns"><button class="ghost" data-nolock onclick="closeModal()">ปิด</button></div>');
  rcvId=id;
  rcvRows=(Array.isArray(o.after)?o.after:[]).filter(r=>Number(r.produced)>0).map(function(r){
    const p=pieces.find(x=>x.id===r.piece_id)||{};
    const cand=items.filter(it=>it.color===r.color&&GlassEngine.samePiece(it,p))
      .sort((a,b)=>(Math.abs(a.a_mm-p.a_mm)+Math.abs(a.b_mm-p.b_mm))-(Math.abs(b.a_mm-p.a_mm)+Math.abs(b.b_mm-p.b_mm)));
    return {name:p.name||(p.a_mm?pieceName(p.a_mm,p.b_mm):String(r.piece_id)),color:r.color,qty:Math.round(Number(r.produced)),
            code:cand.length?cand[0].code:'',onhand:cand.length?cand[0].qty:null};
  });
  if(!rcvRows.length)return toast('ใบ '+id+' ไม่มีรายการชิ้นที่ได้ (after ว่าง) — ไม่มีอะไรให้รับเข้า',true);
  const miss=rcvRows.filter(r=>!r.code).length;
  openModal('<h3>🏭 รับกระจกเข้าสต็อก ERP — ใบ '+esc(id)+'</h3>'+
    '<p class="muted" style="margin:6px 0 0">ตัวเลขตั้งต้น = ชิ้นที่ได้ตามใบสั่ง · <b>ของมาไม่ครบ/แตก ให้แก้จำนวนก่อนยืนยัน</b> · ใส่ 0 = ไม่รับรายการนั้น</p>'+
    '<div class="tblwrap" style="max-height:52vh;margin-top:8px"><table><thead><tr><th>ชิ้นงาน</th><th>สี</th><th>รหัสใน ERP</th><th class="r">ยอด ERP ตอนนี้</th><th class="r">รับเข้า</th></tr></thead><tbody>'+
    rcvRows.map((r,i)=>'<tr'+(r.code?'':' style="background:rgba(220,38,38,.08)"')+'><td>'+esc(r.name)+'</td><td>'+esc(r.color)+'</td>'+
      '<td style="font-size:12.5px">'+(r.code?esc(r.code):'<b style="color:var(--bad)">⚠ ไม่พบใน ERP — ไม่รับ</b>')+'</td>'+
      '<td class="r">'+(r.onhand==null?'—':r.onhand)+'</td>'+
      '<td class="r"><input id="erpRq_'+i+'" type="number" min="0" step="1" value="'+(r.code?r.qty:0)+'" '+(r.code?'':'disabled ')+'style="width:90px;text-align:right"></td></tr>').join('')+
    '</tbody></table></div>'+
    (miss?'<p style="color:var(--bad);margin:6px 0 0">⚠ '+miss+' รายการไม่พบขนาด/สีนี้ใน ERP — เพิ่มรายการในหน้าจัดการสต็อกของ ERP ก่อน แล้วค่อยกดรับใหม่</p>':'')+
    '<p id="erpRcvErr" class="hidden" style="color:var(--bad);margin:6px 0 0"></p>'+
    '<div class="apbtns"><button class="okbtn" data-nolock onclick="erpConfirmReceive()">✅ ยืนยันรับเข้าสต็อก ERP</button>'+
      '<button class="ghost" data-nolock onclick="closeModal()">ยังไม่รับ</button></div>');
};
window.erpConfirmReceive=async function(){
  const err=$('erpRcvErr'),show=t=>{if(err){err.textContent=t;err.classList.remove('hidden');}};
  const list=[];
  for(let i=0;i<rcvRows.length;i++){
    const r=rcvRows[i];if(!r.code)continue;
    const raw=String(($('erpRq_'+i)||{}).value||'').trim();
    if(!/^\d+$/.test(raw))return show('จำนวนของ '+r.name+' '+r.color+' ต้องเป็นจำนวนเต็ม 0 ขึ้นไป');
    const q=Number(raw);if(q>0)list.push({product_code:r.code,qty:q});
  }
  if(!list.length)return show('ไม่มีรายการที่จำนวนมากกว่า 0 — ยังไม่ได้รับอะไร');
  const total=list.reduce((s,x)=>s+x.qty,0);
  if(!confirm('รับกระจกเข้าสต็อก ERP '+list.length+' รายการ รวม '+total+' ชิ้น จากใบ '+rcvId+'?\n\nใบเดียวรับได้ครั้งเดียว'))return;
  if(!lockBusy())return;
  try{
    const {data,error}=await client().rpc('rpc_receive_glass_order',{p_ref:rcvId,p_items:list});
    if(error){
      if(authErr(error)){erpUser=null;closeModal();return loginBox(function(){window.erpReceiveOrder(rcvId);},'session ERP หมดอายุ — ล็อกอินใหม่');}
      return show(error.code==='42501'?'บัญชี ERP นี้ไม่มีสิทธิ์ "🪟 รับกระจกเข้าสต็อก" — ให้ CEO เปิดสิทธิ์ในหน้าจัดการสมาชิกของ ERP':'รับเข้าไม่ได้: '+msgOf(error));
    }
    closeModal();
    receipts[rcvId]={received:true,at:new Date().toISOString(),by:erpUser&&erpUser.email,pieces:data&&data.pieces||total};
    toast('🏭 รับเข้าสต็อก ERP แล้ว '+(data&&data.items||list.length)+' รายการ รวม '+(data&&data.pieces||total)+' ชิ้น ✓');
    render();
  }finally{freeBusy();}
};
/* ---------- ป้ายในรายการ 📜: ใบที่รับของแล้ว (ตั้งแต่วันเปิดเชื่อม) รับเข้า ERP แล้วหรือยัง (เจ้าของขอ 26 ต.ค. 69) ----------
   เช็คกับ ERP ทีละใบ (rpc_glass_order_receipt) เก็บผลไว้ในหน้า · ยังไม่ล็อกอิน ERP = บอกให้ล็อกอินก่อน ไม่เดา */
const receipts={};   /* id → {received, at, by, pieces} | 'checking' | 'error' */
let checkTimer=null;
function scheduleCheck(){
  if(checkTimer)return;
  checkTimer=setTimeout(async function(){
    checkTimer=null;
    const todo=orders.filter(o=>window.erpCanReceive(o)&&receipts[o.id]===undefined);
    if(!todo.length||!erpUser)return;
    todo.forEach(o=>{receipts[o.id]='checking';});
    for(const o of todo){
      try{const {data,error}=await client().rpc('rpc_glass_order_receipt',{p_ref:o.id});receipts[o.id]=error?'error':(data||{received:false});}
      catch(e){receipts[o.id]='error';}
    }
    if(typeof view!=='undefined'&&view==='orders')render();
  },150);
}
window.erpReceiptBadge=function(o){
  if(!window.erpCanReceive(o))return '';
  const q=jsq(o.id),st='display:block;margin-top:3px;font-size:12px;font-weight:700;';
  if(!erpUser)return '<span style="'+st+'color:var(--warn);cursor:pointer" onclick="erpLoginForBadges()" title="ล็อกอินบัญชี ERP เพื่อเช็คว่ารับเข้าสต็อกแล้วหรือยัง">🏭 ยังไม่ได้เช็คกับ ERP</span>';
  const r=receipts[o.id];
  if(r===undefined||r==='checking'){scheduleCheck();return '<span class="muted" style="'+st+'font-weight:400">🏭 กำลังเช็ค ERP…</span>';}
  if(r==='error')return '<span class="muted" style="'+st+'font-weight:400">🏭 เช็ค ERP ไม่ได้</span>';
  if(r.received)return '<span style="'+st+'color:var(--ok,#16a34a)" title="รับเข้าเมื่อ '+esc(new Date(r.at).toLocaleString('th-TH',{hour12:false}))+' · '+(Number(r.pieces)||0)+' ชิ้น">🏭 รับเข้า ERP แล้ว</span>';
  return '<span style="'+st+'color:var(--bad);cursor:pointer" onclick="erpReceiveOrder(\''+q+'\')" title="กดเพื่อรับกระจกเข้าสต็อก ERP">⚠️ ยังไม่รับเข้า ERP</span>';
};
/* บรรทัดสรุปบนหัวรายการ 📜 */
window.erpPendingLine=function(){
  const elig=orders.filter(o=>window.erpCanReceive(o));
  if(!elig.length)return '';
  if(!erpUser)return '<p style="margin:6px 0 0;color:var(--warn)">🏭 มีใบที่รับของแล้ว '+elig.length+' ใบ — <a href="#" onclick="erpLoginForBadges();return false">ล็อกอิน ERP</a> เพื่อเช็คว่ารับเข้าสต็อก ERP แล้วหรือยัง</p>';
  const pend=elig.filter(o=>receipts[o.id]&&receipts[o.id].received===false);
  return pend.length?'<p style="margin:6px 0 0;color:var(--bad)"><b>⚠️ มี '+pend.length+' ใบที่รับของแล้วแต่ยังไม่รับเข้าสต็อก ERP:</b> '+pend.map(o=>esc(o.id)).join(', ')+' — กดป้ายแดงในแถวเพื่อรับเข้า</p>':'';
};
window.erpLoginForBadges=function(){loginBox(function(){render();},'ล็อกอินบัญชี ERP เพื่อเช็คว่าใบไหนรับเข้าสต็อก ERP แล้ว');};

/* เรียกจาก ordReceive หลังกด "รับของแล้ว" สำเร็จ → ถามต่อทันทีว่าจะรับเข้า ERP เลยไหม (ไม่บังคับ กดภายหลังจากใบได้) */
window.erpAfterReceive=function(id){setTimeout(function(){window.erpReceiveOrder(id);},250);};
/* บรรทัดสถานะการเชื่อม (หน้า 🧾 ข้างปุ่มดึงยอด) */
window.erpStatusHtml=function(){
  return erpUser?'<span class="muted" style="font-size:12.5px">🏭 ERP: '+esc(erpUser.email||'')+' · <a href="#" onclick="erpLogout();return false">ออก</a></span>':'';
};
window.erpRefreshSession=session;   /* ERP: หน้าเรียกหลังล็อกอิน ERP พร้อม (auth-ready) */
})();
