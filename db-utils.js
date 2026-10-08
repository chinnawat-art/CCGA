// ═══ ตัวช่วยดึงข้อมูลจากฐานข้อมูลให้ครบทุกแถว ════════════════════════
// ปัญหา: ฐานข้อมูล (Supabase) ส่งข้อมูลให้สูงสุดครั้งละ 1,000 แถว
//        ถ้าขอทีเดียว แถวที่เกินจะหายไปเงียบ ๆ โดยไม่มีข้อความเตือน
//        (ต.ค. 2569 ออเดอร์มี 1,135 ใบ แดชบอร์ดและรายงานยอดขายจึงขาดไป 135 ใบ)
// วิธีใช้:
//   const { data, error } = await fetchAllRows(() =>
//       db.from('stock_orders').select('*').order('order_date').order('id'));
// ข้อควรระวัง:
//   1. ต้องส่ง "ฟังก์ชันที่สร้าง query ใหม่" ไม่ใช่ตัว query (สร้างใหม่ทุกหน้า)
//   2. ต้องมี .order() ปิดท้ายด้วยคอลัมน์ที่ไม่ซ้ำ เช่น id
//      ไม่งั้นแถวที่ค่าเรียงเท่ากันอาจสลับที่ระหว่างหน้า แล้วซ้ำหรือหล่นหาย
(function () {
    'use strict';

    async function fetchAllRows(makeQuery, pageSize) {
        const size = pageSize || 1000;
        let all = [];
        let from = 0;
        let maxSeen = 0;   // เพดานจริงของฐานข้อมูล = หน้าที่ใหญ่ที่สุดที่เคยได้
        for (let guard = 0; guard < 500; guard++) {
            const { data, error } = await makeQuery().range(from, from + size - 1);
            if (error) return { data: all, error };
            const rows = data || [];
            if (!rows.length) break;
            all = all.concat(rows);
            // เลื่อนตามจำนวนที่ได้จริง เผื่อฐานข้อมูลตั้งเพดานต่ำกว่าที่ขอ
            from += rows.length;
            maxSeen = Math.max(maxSeen, rows.length);
            // หน้านี้ได้น้อยกว่าเพดาน = หมดแล้ว
            // (ถ้าได้เท่าเพดานพอดี ขออีกหน้าเพื่อเช็ค ซึ่งจะได้หน้าว่างแล้วหยุด)
            if (rows.length < maxSeen) break;
        }
        return { data: all, error: null };
    }

    window.fetchAllRows = fetchAllRows;
})();
