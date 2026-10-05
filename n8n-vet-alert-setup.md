# n8n — แจ้งทีมสัตวแพทย์ทาง LINE และอีเมล

เอกสารนี้อธิบายการต่อ **ระบบรายงานการปฏิบัติต่อสัตว์ทดลองของนักวิจัย** เข้ากับ **n8n**
เพื่อแจ้งเหตุฉุกเฉิน / ปัญหาสุขภาพสัตว์ทดลองถึงสัตวแพทย์ **ทาง LINE และอีเมลพร้อมกัน**
และเพิ่มสัตวแพทย์คนใหม่ได้ทันทีจากหน้าระบบ ไม่ต้องแก้ workflow

## ภาพรวม

```
นักวิจัยกด「ส่งแจ้งทีมสัตวแพทย์」
   │ 1) บันทึกเรื่องลง Firebase (alerts / guestAlerts)
   │ 2) POST { event:"alert", uid, id }  ──►  n8n  /webhook/lasc-vet-alert
   │                                          │ ตรวจรหัสเชื่อมต่อ
   │                                          │ อ่านเรื่องจริง + รายชื่อสัตวแพทย์จาก Firebase (database secret)
   │                                          │ กันส่งซ้ำ (notifyLog)
   │                                          ├─► LINE Messaging API  → สัตวแพทย์ / กลุ่ม LINE
   │ ◄── { ok, line:2, email:3 } ─────────────┤
   │                                          └─► ส่งอีเมล (SMTP)     → สัตวแพทย์
สัตวแพทย์พิมพ์「ลงทะเบียน ชื่อ」ใน LINE OA ──► n8n /webhook/lasc-line-webhook ──► vetRequests ──► เจ้าหน้าที่กดเพิ่มในระบบ
```

**ทำไมปลอดภัย:** ระบบรายงานฯ ส่งให้ n8n แค่ "เลขอ้างอิง" ของเรื่อง — ข้อความที่ส่งออกทาง LINE/อีเมล
n8n อ่านจากฐานข้อมูลเองทุกครั้ง จึงไม่มีใครปลอมข้อความแจ้งเตือนผ่าน webhook ได้
และแต่ละเรื่องแจ้งได้เพียงครั้งเดียว (บันทึกไว้ที่ `notifyLog`) · รหัสเชื่อมต่อจึงเป็นเพียงชั้นกรองเบื้องต้น

| เหตุการณ์ | เกิดเมื่อ | ส่งถึง |
|---|---|---|
| `alert` | แจ้งเหตุใหม่ | LINE + อีเมล ของสัตวแพทย์ที่เปิดรับระดับความเร่งด่วนนั้น |
| `status` | สัตวแพทย์เปลี่ยนสถานะเรื่อง | LINE ของทีม (ให้รู้ว่าใครรับเรื่องแล้ว) + อีเมลผู้แจ้ง (ถ้าติ๊ก) |
| `register` | นักวิจัยลงทะเบียนใหม่ | ผู้รับแจ้งที่ติ๊ก「แจ้งเมื่อมีนักวิจัยลงทะเบียนใหม่」 |
| `member` | เจ้าหน้าที่อนุมัติ / ไม่อนุมัติ / ระงับบัญชี | อีเมลนักวิจัย |
| `test` | กด🔔 ทดสอบ | สัตวแพทย์คนนั้น หรือทุกคน (จำกัดนาทีละครั้ง) |

---

## ขั้นที่ 0 — เตรียมเซิร์ฟเวอร์ n8n (ถ้ายังไม่มี)

n8n ต้องเข้าถึงได้จากอินเทอร์เน็ตผ่าน **https://** เพราะทั้งเบราว์เซอร์ของผู้ใช้และ LINE ต้องเรียกเข้ามาได้
และควรเปิดตลอด 24 ชม. เพราะใช้กับงานแจ้งเหตุฉุกเฉิน เลือกทางใดทางหนึ่ง

| ทาง | เหมาะกับ | ข้อดี | ข้อเสีย |
|---|---|---|---|
| **ก. n8n Cloud** (บริการของ n8n เอง) | เริ่มใช้เร็วที่สุด ไม่มีคนดูแลเซิร์ฟเวอร์ | สมัครแล้วใช้ได้ทันที มี https ให้ อัปเดต/สำรองให้เอง มีช่วงทดลองใช้ฟรี | มีค่าบริการรายเดือน · **แก้ Environment variables ไม่ได้** ต้องกรอกค่าลงในบล็อก `CFG` ของโหนด Code แทน |
| **ข. ติดตั้งบนเซิร์ฟเวอร์/VM ของหน่วยงาน** | มี IT ดูแล ต้องการเก็บข้อมูลไว้ในองค์กร | ฟรี ควบคุมเองได้เต็มที่ ใช้ `$env` ได้ | ต้องขอ VM + ชื่อโดเมนย่อย + ใบรับรอง https และมีคนดูแล |
| **ค. รันบนเครื่องในศูนย์ฯ + Cloudflare Tunnel** | ทดลองใช้ก่อนโดยไม่เสียค่าบริการ | ฟรี ไม่ต้องเปิดพอร์ตที่ไฟร์วอลล์ | เครื่องต้องเปิดตลอด ถ้าเครื่องดับ/เน็ตหลุด การแจ้งเตือนจะหยุด — ไม่แนะนำเป็นระบบถาวรของงานฉุกเฉิน |

**ทาง ก — n8n Cloud**
1. สมัครที่ <https://n8n.io> → สร้าง workspace → จะได้ที่อยู่เช่น `https://xxxx.app.n8n.cloud`
2. ข้ามขั้นที่ 3 (Environment variables) ไปเลย — ให้กรอกค่าทั้งหมดในบล็อก `CFG` ที่หัวโหนด Code ของ **ทั้งสอง workflow** แทน
3. Webhook URL ที่ใช้จะเป็น `https://xxxx.app.n8n.cloud/webhook/lasc-vet-alert` และ `…/webhook/lasc-line-webhook`

**ทาง ข — ติดตั้งเองด้วย Docker** (ตัวอย่างใช้ Caddy ทำ https ให้อัตโนมัติ)
```bash
# 1) ชี้ DNS ของโดเมนย่อย เช่น n8n.psu.ac.th มาที่ IP ของเซิร์ฟเวอร์ก่อน
docker network create web
docker run -d --restart unless-stopped --name caddy --network web \
  -p 80:80 -p 443:443 -v caddy_data:/data \
  caddy caddy reverse-proxy --from n8n.psu.ac.th --to n8n:5678
docker run -d --restart unless-stopped --name n8n --network web \
  -e N8N_HOST="n8n.psu.ac.th" -e WEBHOOK_URL="https://n8n.psu.ac.th/" \
  -e N8N_PROTOCOL="https" -e GENERIC_TIMEZONE="Asia/Bangkok" -e TZ="Asia/Bangkok" \
  -e N8N_BLOCK_ENV_ACCESS_IN_NODE="false" \
  -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```
เปิด `https://n8n.psu.ac.th` แล้วตั้งบัญชีผู้ดูแลครั้งแรก จากนั้นเพิ่มตัวแปรในขั้นที่ 3 (เพิ่ม `-e` แล้วสร้างคอนเทนเนอร์ใหม่)

**ทาง ค — Cloudflare Tunnel**
ติดตั้ง n8n ด้วย Docker บนเครื่องในศูนย์ฯ (ไม่ต้องเปิดพอร์ต) แล้วสมัคร Cloudflare (ฟรี) →
Zero Trust → Networks → Tunnels → สร้าง tunnel ชี้ไปที่ `http://localhost:5678` จะได้ที่อยู่ `https://…` มาใช้เป็น Webhook URL

> เลือกทางไหนก็ได้ แต่ต้องจดที่อยู่ `https://…` ของ n8n ไว้ใช้ในขั้นที่ 1 และขั้นที่ 5

## ขั้นที่ 1 — สร้าง LINE Official Account + Messaging API

> LINE Notify ปิดบริการแล้วตั้งแต่ 31 มี.ค. 2568 — ต้องใช้ **Messaging API** แทน

1. เข้า <https://developers.line.biz/console/> → สร้าง **Provider** (เช่น `PSU LASC`)
2. **Create a Messaging API channel** (ระบบจะสร้าง LINE Official Account ให้ด้วย) ตั้งชื่อเช่น `LASC แจ้งเหตุสัตว์ทดลอง`
3. แท็บ **Messaging API** →
   * **Channel access token (long-lived)** → กด **Issue** → คัดลอกไว้ (ใช้เป็น `LASC_LINE_TOKEN`)
   * **Webhook URL** → `https://<โดเมน n8n>/webhook/lasc-line-webhook` → **Use webhook: เปิด**
   * **Allow bot to join group chats: เปิด** (เพื่อใช้กับกลุ่ม LINE ของสัตวแพทย์)
4. ใน LINE Official Account Manager → **ตั้งค่าการตอบกลับ** → ปิด *ข้อความตอบกลับอัตโนมัติ* และ *ข้อความทักทาย*
   (ให้ n8n ตอบแทน)
5. หมายเหตุโควตา: แพ็กเกจฟรีส่ง push ได้จำนวนจำกัดต่อเดือน (ข้อความตอบกลับ `ลงทะเบียน` ไม่นับ)
   การแจ้งเข้า **กลุ่ม LINE** นับเป็น 1 ข้อความต่อสมาชิกในกลุ่ม — ตรวจสอบโควตาปัจจุบันในหน้า LINE OA

## ขั้นที่ 2 — Database secret ของ Firebase

n8n อ่าน/เขียนฐานข้อมูลผ่าน REST ด้วย **Database secret** (ข้ามกฎความปลอดภัย จึงต้องเก็บเป็นความลับ)

Firebase Console → ⚙ **Project settings** → **Service accounts** → **Database secrets** → **Show** → คัดลอก

> ใช้โปรเจกต์เดียวกับที่ระบบรายงานฯ ใช้อยู่ (ดู `firebase-config.js`)
> ถ้ายังใช้โปรเจกต์ร่วม `LASC_FB_ROOT=data/animalReport` · ถ้าย้ายไปโปรเจกต์แยกแล้ว `LASC_FB_ROOT=animalReport`

## ขั้นที่ 3 — ตั้งค่าตัวแปร (Environment variables **หรือ** บล็อก CFG)

> **n8n Cloud หรือเซิร์ฟเวอร์ที่ปิดการอ่าน `$env`** — ข้ามตารางคำสั่ง Docker ด้านล่างไป แล้วกรอกค่าชุดเดียวกันนี้
> ในบล็อก `CFG = { … }` ที่หัวโหนด **Code** ของทั้งสอง workflow (โค้ดจะใช้ `$env` ก่อนเสมอ ถ้าไม่มีจึงใช้ค่าใน `CFG`)
> ส่วนอีเมลผู้ส่ง ให้แก้ช่อง **From Email** ในโหนด「ส่งอีเมล (SMTP)」จาก `lasc@psu.ac.th` เป็นอีเมลจริงที่ใช้ส่ง

| ตัวแปร | ตัวอย่าง | ใช้ทำอะไร |
|---|---|---|
| `LASC_FB_DB_URL` | `https://psu-lasc-animal-report-default-rtdb.asia-southeast1.firebasedatabase.app` | ที่อยู่ Realtime Database |
| `LASC_FB_DB_SECRET` | `AbC123…` | Database secret จากขั้นที่ 2 |
| `LASC_FB_ROOT` | `animalReport` | ตำแหน่งข้อมูลของระบบ |
| `LASC_ALERT_KEY` | `lasc-alert-8f2c19a4` | รหัสเชื่อมต่อ — ใส่ค่าเดียวกันในหน้าระบบ |
| `LASC_LINE_TOKEN` | `xxxx…` | Channel access token จากขั้นที่ 1 |
| ~~`LASC_MAIL_FROM`~~ | — | ไม่ใช้แล้ว: แก้ช่อง **From Email** ในโหนด「ส่งอีเมล (SMTP)」โดยตรง (ต้องเป็นบัญชีของ SMTP ที่ใช้) |
| `LASC_APP_URL` | `https://kwanchanokd.github.io/psu-lasc-animal-report/` | ลิงก์ในข้อความแจ้งเตือน |
| ~~`LASC_APP_ORIGIN`~~ | — | ไม่ใช้แล้ว: ถ้าต้องการจำกัดโดเมนที่เรียก webhook ได้ ให้แก้ค่า `Access-Control-Allow-Origin` ในโหนด「ตอบกลับระบบรายงานฯ」จาก `*` เป็นโดเมนของระบบ |

ตัวอย่าง Docker (ต่อจากคำสั่งเดิมใน `n8n-proxy-setup.md` / `lasc-medicine/n8n-setup.md`)

```bash
docker run -d --restart unless-stopped --name n8n -p 5678:5678 \
  -e N8N_HOST="n8n.your-domain.ac.th" -e WEBHOOK_URL="https://n8n.your-domain.ac.th/" \
  -e GENERIC_TIMEZONE="Asia/Bangkok" -e TZ="Asia/Bangkok" \
  -e LASC_FB_DB_URL="https://....firebasedatabase.app" -e LASC_FB_DB_SECRET="..." -e LASC_FB_ROOT="animalReport" \
  -e LASC_ALERT_KEY="lasc-alert-8f2c19a4" -e LASC_LINE_TOKEN="..." \
  -e LASC_APP_URL="https://kwanchanokd.github.io/psu-lasc-animal-report/" \
  -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```

> โหนด Code ต้องอ่าน `$env` ได้ — ถ้าตั้ง `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` ไว้ ให้เปลี่ยนเป็น `false`

## ขั้นที่ 4 — นำเข้า workflow 2 ตัว

n8n → **Workflows** → **Import from File**

| ไฟล์ | Webhook | โหนด |
|---|---|---|
| `n8n-vet-alert-workflow.json` | `POST /webhook/lasc-vet-alert` | รับเหตุการณ์ → ตรวจสอบ ดึงข้อมูล และส่ง LINE → ตอบกลับระบบ → มีอีเมลหรือไม่ → **ส่งอีเมล (SMTP)** |
| `n8n-line-register-workflow.json` | `POST /webhook/lasc-line-webhook` | รับข้อความจาก LINE → บันทึกคำขอและตอบกลับ |

1. ในโหนด **ส่งอีเมล (SMTP)** เลือก credential SMTP (ใช้ตัวเดียวกับระบบยาได้ เช่น **PSU Mail (SMTP)**
   — ดูข้อควรระวังเรื่อง SMTP AUTH ของ Microsoft 365 ใน `lasc-medicine/n8n-setup.md`)
2. กด **Active** ทั้งสอง workflow
3. กลับไปที่ LINE Developers Console → Webhook URL → กด **Verify** ต้องได้ *Success*

## ขั้นที่ 5 — ตั้งค่าในระบบรายงานฯ

เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่ → แท็บ **「👥 สมาชิก / สัตวแพทย์ (แอดมิน)」** → การ์ด **「⚙️ ตั้งค่าการแจ้งเตือน (n8n)」**

* **n8n Webhook URL** = `https://<โดเมน n8n>/webhook/lasc-vet-alert`
* **รหัสเชื่อมต่อ** = ค่าเดียวกับ `LASC_ALERT_KEY`
* เบอร์โทรฉุกเฉิน (บรรทัดละ `ชื่อ | เบอร์`) · อีเมลสำรอง (ใช้ร่างอีเมลเมื่อ n8n ล่ม)
* กด **💾 บันทึก** → **🔔 ทดสอบส่งถึงผู้รับแจ้งทุกคน**

## ขั้นที่ 6 — เพิ่มสัตวแพทย์ (ทำได้ตลอด เพิ่มแล้วใช้ได้ทันที)

**ทาง LINE (แนะนำ)**
1. สัตวแพทย์สแกน QR เพิ่มเพื่อน LINE OA ของศูนย์ฯ แล้วพิมพ์ `ลงทะเบียน น.สพ.ชื่อ นามสกุล`
   — หรือเชิญ LINE OA เข้า **กลุ่มสัตวแพทย์** แล้วพิมพ์ `ลงทะเบียน` ในกลุ่ม (ทั้งกลุ่มจะรับแจ้ง)
2. บอทตอบว่า "รับคำขอแล้ว รอเจ้าหน้าที่อนุมัติ"
3. เจ้าหน้าที่เปิดการ์ด **「🩺 ทีมสัตวแพทย์ที่รับแจ้งเหตุ」** → คำขอขึ้นในหัวข้อ *คำขอเชื่อม LINE*
   → **➕ เพิ่มเป็นผู้รับแจ้ง** → ใส่อีเมล (ถ้ามี) เลือกระดับที่รับแจ้ง → **💾 บันทึก** → **🔔 ทดสอบ**

**เฉพาะอีเมล** — กรอกชื่อ + อีเมลในฟอร์มแล้วบันทึก ไม่ต้องใช้ LINE

ต่อผู้รับแจ้งแต่ละคนกำหนดได้ว่าจะรับระดับ 🔴 วิกฤต / 🟠 เร่งด่วน / 🔵 ทั่วไป · ปิดรับชั่วคราว (⏸) ·
และรับแจ้งเมื่อมีนักวิจัยลงทะเบียนใหม่ · ถ้าสัตวแพทย์พิมพ์ `ยกเลิก` ใน LINE คำขอจะขึ้นให้เจ้าหน้าที่กด **⏸ ปิดรับแจ้ง**

## แก้ปัญหา

| อาการ | สาเหตุ / ทางแก้ |
|---|---|
| หน้าระบบขึ้น「แจ้งเตือนอัตโนมัติไม่สำเร็จ (Failed to fetch)」 | URL ผิด / workflow ไม่ Active / ค่า `Access-Control-Allow-Origin` ในโหนดตอบกลับไม่ตรงโดเมนที่เปิดระบบ |
| 「รหัสเชื่อมต่อไม่ถูกต้อง」 | ค่าในระบบไม่ตรงกับ `LASC_ALERT_KEY` |
| 「ไม่พบเรื่องนี้ในฐานข้อมูล」 | `LASC_FB_DB_URL` / `LASC_FB_ROOT` ชี้ผิดโปรเจกต์หรือผิดตำแหน่ง |
| 「ยังไม่มีสัตวแพทย์ในรายชื่อผู้รับแจ้ง」 | ยังไม่ได้เพิ่ม หรือทุกคนปิดรับระดับความเร่งด่วนนั้นไว้ |
| LINE ไม่ส่ง แต่อีเมลส่ง | token หมดอายุ/ผิด · สัตวแพทย์บล็อก LINE OA · บอทถูกนำออกจากกลุ่ม · โควตาข้อความหมด (ดู error ใน Executions) |
| อีเมลไม่ส่ง | ตรวจ credential SMTP และช่อง From Email ในโหนดส่งอีเมล · ดูใน n8n → Executions (โหนดอีเมลตั้งไว้ให้ทำงานต่อแม้ส่งไม่สำเร็จ) |
| พิมพ์「ลงทะเบียน」แล้วบอทเงียบ | Webhook URL ใน LINE Console ไม่ถูก / ไม่ได้เปิด Use webhook / workflow LINE ไม่ Active |

> ถ้า n8n ล่ม ระบบยังบันทึกเรื่องเข้ากล่องรับแจ้งตามปกติ และให้ผู้แจ้งกด「✉ เปิดร่างอีเมล」+ ปุ่มโทรฉุกเฉินแทน
> หน้าจอเจ้าหน้าที่ที่เปิดแอปไว้ยังเด้งแจ้งเตือนพร้อมเสียงเหมือนเดิม
