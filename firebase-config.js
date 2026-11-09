/* =====================================================================
   การตั้งค่า Firebase ของ "ระบบรายงานการปฏิบัติต่อสัตว์ทดลองของนักวิจัย" (แยกไฟล์ไว้ให้เปลี่ยนโปรเจกต์ได้ง่าย)

   ▶ ใช้โปรเจกต์ Firebase ของระบบนี้โดยเฉพาะ: psu-lasc-animal-report
     ข้อมูลอยู่ใต้โหนด animalReport · ใช้กฎจากไฟล์ firebase-rules.json
     (แยกจากโปรเจกต์ psu-lasc-animal ของระบบยาและระบบจองเครื่องมือแล้ว — บัญชีผู้ใช้จึงแยกกันด้วย)

   ▶ ถ้าต้องย้อนกลับไปใช้โปรเจกต์ร่วมชั่วคราว
     1) เปลี่ยนค่าด้านล่างกลับเป็นของ psu-lasc-animal
     2) เปลี่ยน LASC_CLOUD_ROOT เป็น 'data/animalReport'
     3) ใช้กฎจากไฟล์ firebase-rules-shared-project.json
     ไม่ต้องแก้ index.html เลย

   ค่าชุดนี้เป็นค่าสาธารณะของเว็บแอป (ฝังอยู่ในหน้าเว็บ) ความปลอดภัยจริงมาจาก Rules ของฐานข้อมูล
   ส่วน Database secret ที่ n8n ใช้เป็นความลับ ห้ามใส่ในไฟล์นี้
   ===================================================================== */
window.LASC_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB2mcXlT6HDkWCMbOyTdNm9rCocc_mMnbw",
  authDomain: "psu-lasc-animal-report.firebaseapp.com",
  databaseURL: "https://psu-lasc-animal-report-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "psu-lasc-animal-report",
  storageBucket: "psu-lasc-animal-report.firebasestorage.app",
  messagingSenderId: "439986345734",
  appId: "1:439986345734:web:5686e106d322258f44f087"
};

/* ตำแหน่งข้อมูลของระบบนี้ในฐานข้อมูล
   - โปรเจกต์แยกของระบบนี้ (ที่ใช้อยู่) : 'animalReport'
   - โปรเจกต์ร่วมกับระบบอื่น (ของเดิม)  : 'data/animalReport'                     */
window.LASC_CLOUD_ROOT = 'animalReport';

/* ───────────────────────────────────────────────────────────────────────
   App Check (reCAPTCHA v3) — เกราะกันสคริปต์ภายนอกเขียนฐานข้อมูล
   จำเป็นเพราะโหนด guestAlerts เปิดให้เขียนได้โดยไม่ต้องเข้าสู่ระบบ
   (เพื่อให้แจ้งเหตุฉุกเฉินได้ทันทีแม้ยังไม่มีบัญชี) ใครก็ยิงเข้ามาได้ถ้าไม่มีเกราะนี้

   วิธีเปิดใช้ (ทำครั้งเดียว ประมาณ 5 นาที)
     1) Firebase Console → App Check → แท็บ Apps → เลือกเว็บแอปของระบบนี้ → Register
        เลือกผู้ให้บริการเป็น reCAPTCHA v3 แล้วทำตามขั้นตอนจนได้ "site key"
     2) นำ site key มาใส่ในบรรทัดล่างนี้ (เป็นค่าสาธารณะ ใส่ในไฟล์นี้ได้ ไม่ใช่ความลับ)
     3) กลับไปที่ App Check → แท็บ APIs → Realtime Database → Enforce
        แนะนำให้ดูสถิติในแท็บ Apps สัก 1–2 วันก่อนกด Enforce จะได้เห็นว่าคำขอจริงผ่านครบแล้ว

   ปล่อยว่างไว้ได้ ระบบทำงานปกติทุกอย่าง เพียงแต่ยังไม่มีเกราะชั้นนี้
   ─────────────────────────────────────────────────────────────────────── */
window.LASC_APPCHECK_KEY = '6LcvZRcuAAAAAOieaWcxAvjUeK9BD3kIZypvzZXL';
