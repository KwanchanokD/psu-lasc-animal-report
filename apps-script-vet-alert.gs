/**
 * PSU:LASC — ตัวกลางแจ้งทีมสัตวแพทย์ทาง LINE + อีเมล (Google Apps Script)
 * =====================================================================
 * ทำหน้าที่เดียวกับ workflow ของ n8n แต่ฟรีและไม่ต้องมีเซิร์ฟเวอร์:
 *
 *   ระบบรายงานฯ  ──POST {event,uid,id}──►  สคริปต์นี้  ──► อ่านข้อมูลจริงจาก Firebase
 *                                                      ├─► LINE Messaging API (push)
 *                                                      └─► อีเมล (MailApp)
 *   LINE OA ──webhook──► สคริปต์นี้ ──► บันทึกคำขอ「ลงทะเบียน」ไว้ที่ vetRequests → เจ้าหน้าที่อนุมัติในระบบ
 *
 * ระบบส่งมาแค่ "เลขอ้างอิง" ของเรื่อง เนื้อหาที่ส่งออกสคริปต์อ่านจากฐานข้อมูลเองทุกครั้ง
 * จึงปลอมข้อความแจ้งเตือนผ่าน URL นี้ไม่ได้ และแต่ละเรื่องแจ้งได้ครั้งเดียว (บันทึกที่ notifyLog)
 *
 * ── วิธีติดตั้ง (ทำครั้งเดียว ~15 นาที) ──────────────────────────────
 * 1. เข้า https://script.google.com → New project → วางโค้ดนี้ทับทั้งหมด → ตั้งชื่อโปรเจกต์
 * 2. แก้ค่าในบล็อก CONFIG ด้านล่างให้ครบ (หรือใส่ใน Project Settings → Script properties ชื่อเดียวกัน
 *    ซึ่งปลอดภัยกว่า เพราะค่าจะไม่ติดไปกับโค้ดเวลาแชร์)
 * 3. เลือกฟังก์ชัน setupTest แล้วกด Run หนึ่งครั้ง → อนุญาตสิทธิ์ (Authorize) → ดูผลใน Execution log
 *    ต้องขึ้นว่าอ่าน Firebase ได้ และส่งอีเมลทดสอบถึงตัวเองได้
 * 4. Deploy → New deployment → เลือก Web app
 *       Execute as    : Me
 *       Who has access: Anyone
 *    → คัดลอก Web app URL (ลงท้ายด้วย /exec)
 * 5. ในระบบรายงานฯ (เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่) → แท็บ「👥 สมาชิก / สัตวแพทย์」
 *    → การ์ด「⚙️ ตั้งค่าการแจ้งเตือน」→ วาง URL ในช่อง Webhook URL และใส่รหัสเชื่อมต่อให้ตรงกับ ALERT_KEY
 *    → บันทึก → กด「🔔 ทดสอบส่งถึงผู้รับแจ้งทุกคน」
 * 6. ที่ LINE Developers Console → แท็บ Messaging API → ช่อง Webhook URL ใส่ URL เดียวกันนี้
 *    → เปิด Use webhook → กด Verify (ต้องขึ้น Success)
 *
 * ⚠ ทุกครั้งที่แก้โค้ด ต้อง Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *   มิฉะนั้น URL เดิมจะยังรันโค้ดเวอร์ชันเก่า
 *
 * โควตา: ส่งอีเมล ~100 ฉบับ/วัน (บัญชี Gmail ทั่วไป) หรือ ~1,500 ฉบับ/วัน (Google Workspace)
 *        เรียก API ภายนอก (LINE/Firebase) ~20,000 ครั้ง/วัน — เหลือเฟือสำหรับงานแจ้งเหตุ
 */

var CONFIG = {
  /* Firebase Realtime Database — ดูที่ firebase-config.js ของระบบ */
  FB_DB_URL:    'https://psu-lasc-animal-report-default-rtdb.asia-southeast1.firebasedatabase.app',
  /* Database secret: Firebase Console → ⚙ Project settings → Service accounts → Database secrets → Show */
  FB_DB_SECRET: '',
  /* ตำแหน่งข้อมูล: โปรเจกต์แยก = animalReport · โปรเจกต์ใช้ร่วม = data/animalReport */
  FB_ROOT:      'animalReport',

  /* รหัสเชื่อมต่อ — ตั้งเองได้ ต้องใส่ค่าเดียวกันในช่อง「รหัสเชื่อมต่อ」ของระบบรายงานฯ */
  ALERT_KEY:    'lasc-alert-2569',

  /* LINE Messaging API → Channel access token (long-lived) */
  LINE_TOKEN:   '',

  /* ที่อยู่ระบบรายงานฯ (ใช้ทำลิงก์ในข้อความแจ้งเตือน) */
  APP_URL:      'https://kwanchanokd.github.io/psu-lasc-animal-report/',

  /* ชื่อผู้ส่งอีเมลที่ผู้รับจะเห็น และอีเมลสำหรับตอบกลับ */
  SENDER_NAME:  'ศูนย์สัตว์ทดลอง ม.อ. — แจ้งเหตุสุขภาพสัตว์',
  REPLY_TO:     '',

  /* ── ดึงทะเบียนโครงการจาก "ระบบตรวจติดตามการดำเนินการต่อสัตว์ฯ" (psu-lasc-app) ──
     เว้น SRC_DB_SECRET ว่างไว้ = ปิดการซิงก์ (ส่วนอื่นของสคริปต์ยังทำงานปกติ)
     หา secret ได้ที่ Firebase Console ของโปรเจกต์ psu-lasc-animal → Project settings
     → Service accounts → Database secrets                                            */
  SRC_DB_URL:    'https://psu-lasc-animal-default-rtdb.asia-southeast1.firebasedatabase.app',
  SRC_DB_SECRET: '',
  SRC_PATH:      'data/projects'
};

var MAX_AGE_MIN = 30;             /* แจ้งเฉพาะเรื่องที่บันทึกภายใน 30 นาที */
var MAX_GUEST_PER_10MIN = 10;     /* กันการแจ้งรัว ๆ จากผู้แจ้งที่ยังไม่ได้เป็นสมาชิก */

/* ==================== ตัวช่วยพื้นฐาน ==================== */
function cfg(k) {
  var v = '';
  try { v = PropertiesService.getScriptProperties().getProperty(k) || ''; } catch (e) {}
  return String(v || CONFIG[k] || '');
}
function fbUrl(path) {
  var db = cfg('FB_DB_URL').replace(/\/+$/, '');
  var root = cfg('FB_ROOT').replace(/^\/+|\/+$/g, '');
  return db + '/' + root + '/' + path + '.json?auth=' + encodeURIComponent(cfg('FB_DB_SECRET'));
}
function fbGet(path) {
  var res = UrlFetchApp.fetch(fbUrl(path), { method: 'get', muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Firebase ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 120));
  var t = res.getContentText();
  return t === 'null' ? null : JSON.parse(t);
}
function fbPut(path, value) {
  UrlFetchApp.fetch(fbUrl(path), {
    method: 'put', contentType: 'application/json',
    payload: JSON.stringify(value), muteHttpExceptions: true
  });
}
function logKey(s) { return String(s).replace(/[.#$\[\]\/]/g, '_'); }
/* true = ยังไม่เคยแจ้งเรื่องนี้ → จองคิวไว้เลย (กันแจ้งซ้ำ) */
function once(key) {
  var k = logKey(key);
  if (fbGet('notifyLog/' + k)) return false;
  fbPut('notifyLog/' + k, { at: new Date().toISOString() });
  return true;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toList(v) {
  if (v == null) return [];
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  if (typeof v === 'object') return Object.keys(v).map(function (k) { return v[k]; });
  return [];
}
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ==================== ข้อความ ==================== */
var TYPE = { emergency: '🚨 เหตุฉุกเฉิน', health: '🩺 ปัญหาสุขภาพสัตว์ทดลอง' };
var URG  = { critical: '🔴 วิกฤต', urgent: '🟠 เร่งด่วน', routine: '🔵 ทั่วไป' };
var STAT = { 'new': '🆕 รอรับเรื่อง', ack: '📥 รับเรื่องแล้ว', treating: '💉 กำลังดูแลรักษา', closed: '✅ ปิดเรื่องแล้ว' };

function appLink() {
  var u = cfg('APP_URL');
  return u ? u.replace(/\/?$/, '/') + 'index.html?tab=alert' : '';
}
function alertRows(a) {
  var rows = [
    ['เลขที่', a.docNo], ['ประเภท', TYPE[a.type]], ['ความเร่งด่วน', URG[a.urgency]],
    ['ลักษณะเหตุ', a.category],
    ['โครงการ', a.projectNo ? a.projectNo + ' ' + (a.projectName || '') : ''],
    ['สถานที่', a.location], ['กรง / รหัสสัตว์', a.cage],
    ['สัตว์', [a.species, a.sex, a.strain].filter(String).join(' · ') + (a.qty ? ' — ' + a.qty + ' ตัว' : '')],
    ['อาการ', toList(a.signs).join(', ')],
    ['เริ่มพบ', [a.onsetDate, a.onsetTime].filter(String).join(' ')],
    ['รายละเอียด', a.detail], ['ทำไปแล้ว', a.firstAid], ['ต้องการ', a.request],
    ['ผู้แจ้ง', (a.reporter || '') + ' โทร ' + (a.phone || '-') + (a.email ? ' · ' + a.email : '')],
    ['รูปภาพแนบ', toList(a.photos).length ? toList(a.photos).length + ' รูป (เปิดดูในระบบ)' : '']
  ];
  return rows.filter(function (r) { return r[1]; });
}
function htmlTable(rows) {
  return '<table style="border-collapse:collapse;max-width:720px;font-family:Sarabun,Tahoma,sans-serif;font-size:14px">' +
    rows.map(function (r) {
      return '<tr><th style="text-align:left;background:#f2f6fa;padding:6px 10px;border:1px solid #ccd;width:30%">' + esc(r[0]) + '</th>' +
             '<td style="padding:6px 10px;border:1px solid #ccd">' + esc(r[1]).replace(/\n/g, '<br>') + '</td></tr>';
    }).join('') + '</table>';
}
function wrapHtml(lead, inner) {
  var link = appLink();
  return '<div style="font-family:Sarabun,Tahoma,sans-serif;font-size:14px;color:#111"><p>' + lead + '</p>' + (inner || '') +
    (link ? '<p>เปิดระบบ: <a href="' + esc(link) + '">' + esc(link) + '</a></p>' : '') +
    '<p style="color:#777;font-size:12px">ส่งอัตโนมัติจากระบบรายงานการปฏิบัติต่อสัตว์ทดลอง PSU:LASC</p></div>';
}

/* ==================== ช่องทางส่ง ==================== */
function pushLine(to, text, state) {
  var token = cfg('LINE_TOKEN');
  if (!token || !to) return;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) state.line++;
    else state.errors.push('LINE ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 100));
  } catch (e) { state.errors.push('LINE: ' + e.message); }
}
function sendMail(to, subject, html, state) {
  if (!to || String(to).indexOf('@') < 0) return;
  try {
    var opt = { to: String(to), subject: String(subject).slice(0, 240), htmlBody: html, name: cfg('SENDER_NAME') };
    if (cfg('REPLY_TO')) opt.replyTo = cfg('REPLY_TO');
    MailApp.sendEmail(opt);
    state.email++;
  } catch (e) { state.errors.push('MAIL: ' + e.message); }
}
function activeVets(filter) {
  return toList(fbGet('vets')).filter(function (v) {
    return v && v.active !== false && (!filter || filter(v));
  });
}

/* ==================== รับคำขอ ==================== */
function doGet() {
  return jsonOut({ ok: true, service: 'PSU:LASC veterinary alert relay (Apps Script)' });
}
function doPost(e) {
  try {
    if (!e || !e.postData) return jsonOut({ ok: false, error: 'no payload' });

    /* --- คำขอจาก LINE (application/json มีคีย์ events) --- */
    var raw = e.postData.contents || '';
    if (raw && raw.charAt(0) === '{') {
      var body = {};
      try { body = JSON.parse(raw); } catch (err) {}
      if (body && body.events) return handleLine(body);
    }

    /* --- คำขอจากระบบรายงานฯ (form-urlencoded: payload=<json>) --- */
    var p = null;
    if (e.parameter && e.parameter.payload) { try { p = JSON.parse(e.parameter.payload); } catch (err) {} }
    if (!p && raw) { try { p = JSON.parse(raw); } catch (err) {} }
    if (!p || !p.event) return jsonOut({ ok: false, error: 'bad payload' });
    return handleApp(p);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function handleApp(p) {
  var state = { line: 0, email: 0, errors: [] };
  var done = function (ok, extra) {
    var out = { ok: ok, line: state.line, email: state.email, error: '', skipped: '' };
    for (var k in (extra || {})) out[k] = extra[k];
    if (state.errors.length && !out.error) out.error = state.errors.join(' · ');
    return jsonOut(out);
  };
  if (!cfg('FB_DB_URL') || !cfg('FB_DB_SECRET') || !cfg('ALERT_KEY')) {
    return done(false, { error: 'สคริปต์ยังตั้งค่า FB_DB_URL / FB_DB_SECRET / ALERT_KEY ไม่ครบ' });
  }
  if (String(p.key || '') !== cfg('ALERT_KEY')) return done(false, { error: 'รหัสเชื่อมต่อไม่ถูกต้อง' });

  var ID = /^[A-Za-z0-9_-]{1,64}$/;
  var event = String(p.event || '');
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e2) { return done(false, { error: 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่' }); }

  try {
    if (event === 'alert' || event === 'status') {
      var id = String(p.id || '');
      var guest = (p.guest === true || p.guest === 'true');
      var uid = String(p.uid || '');
      if (!ID.test(id) || (!guest && !ID.test(uid))) return done(false, { error: 'bad id' });
      var a = fbGet(guest ? 'guestAlerts/' + id : 'alerts/' + uid + '/' + id);
      if (!a || a.id !== id) return done(false, { error: 'ไม่พบเรื่องนี้ในฐานข้อมูล' });

      if (event === 'alert') {
        var age = (new Date().getTime() - new Date(a.createdAt || 0).getTime()) / 60000;
        if (!(age >= -5 && age <= MAX_AGE_MIN)) return done(true, { skipped: 'เรื่องเก่าเกิน ' + MAX_AGE_MIN + ' นาที' });
        if (guest) {
          var b = new Date(); b.setMinutes(Math.floor(b.getMinutes() / 10) * 10, 0, 0);
          var rk = 'guestRate/' + b.toISOString().slice(0, 16).replace(/[-:T]/g, '');
          var n = Number((fbGet('notifyLog/' + rk) || {}).n || 0);
          if (n >= MAX_GUEST_PER_10MIN) return done(true, { skipped: 'มีการแจ้งจากผู้แจ้งทั่วไปมากเกินไป — โปรดตรวจกล่องรับแจ้งในระบบ' });
          fbPut('notifyLog/' + rk, { n: n + 1 });
        }
        if (!once('alert_' + id)) return done(true, { skipped: 'แจ้งเรื่องนี้ไปแล้ว' });

        var level = (a.urgency === 'urgent' || a.urgency === 'routine') ? a.urgency : 'critical';
        var vets = activeVets(function (v) { return v[level] !== false; });
        if (!vets.length) return done(true, { skipped: 'ยังไม่มีสัตวแพทย์ในรายชื่อผู้รับแจ้ง' });

        var rows = alertRows(a);
        var head = URG[a.urgency] + ' แจ้ง' + String(TYPE[a.type] || '').replace(/^\S+\s/, '');
        var text = head + '\n' + rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
          (guest ? '\n(ผู้แจ้งทั่วไป — ยังไม่ได้เป็นสมาชิกที่อนุมัติ)' : '') +
          (appLink() ? '\n\nรับเรื่อง: ' + appLink() : '');
        var subject = '[LASC ' + URG[a.urgency] + '] แจ้ง' + String(TYPE[a.type] || '').replace(/^\S+\s/, '') +
          ' — ' + (a.category || toList(a.signs).slice(0, 2).join(', ') || a.species || '') + ' (' + a.docNo + ')';
        var html = wrapHtml('เรียน ทีมสัตวแพทย์ศูนย์สัตว์ทดลอง<br>มีการแจ้ง<b>' + esc(TYPE[a.type]) + '</b> ระดับ <b>' +
          esc(URG[a.urgency]) + '</b>' + (guest ? ' <i>(ผู้แจ้งทั่วไป)</i>' : ''), htmlTable(rows));
        vets.forEach(function (v) { pushLine(v.lineId, text, state); sendMail(v.email, subject, html, state); });
        return done(true);
      }

      /* status: แจ้งความคืบหน้าในทีมทาง LINE + แจ้งผลถึงผู้แจ้งทางอีเมล */
      var hist = toList(a.history);
      if (!once('status_' + id + '_' + hist.length)) return done(true, { skipped: 'แจ้งความคืบหน้านี้ไปแล้ว' });
      var st = STAT[a.status] || a.status;
      var last = hist[hist.length - 1] || {};
      var t = st + ' — ' + a.docNo + '\n' + (a.species || '') + ' ' + (a.qty || '') + ' ตัว · ' + (a.location || '') +
        (a.vetName ? '\nผู้รับผิดชอบ: ' + a.vetName : '') +
        (a.outcome && a.status === 'closed' ? '\nผล: ' + a.outcome : '') +
        (last.note ? '\nบันทึก: ' + last.note : '');
      activeVets(function (v) { return !!v.lineId; }).forEach(function (v) { pushLine(v.lineId, t, state); });
      if ((p.mail === true || p.mail === 'true') && a.email) {
        var lead = 'เรียน ' + esc(a.reporter || '') + '<br>ทีมสัตวแพทย์ได้อัปเดตเรื่องที่ท่านแจ้ง (' + esc(a.docNo) +
          ') เป็น <b>' + esc(st) + '</b>' + (a.vetName ? ' — ผู้รับผิดชอบ: ' + esc(a.vetName) : '') +
          (a.outcome && a.status === 'closed' ? '<br>ผลการดูแล: <b>' + esc(a.outcome) + '</b>' : '') +
          (a.vetNote ? '<br>บันทึก / คำแนะนำ: ' + esc(a.vetNote).replace(/\n/g, '<br>') : '') +
          (/Euthanasia|Died/.test(a.outcome || '') && a.status === 'closed'
            ? '<br><b>กรุณาบันทึกรายงานการปฏิบัติต่อสัตว์ทดลองในระบบด้วย</b>' : '');
        sendMail(a.email, '[LASC] อัปเดตเรื่องที่แจ้ง ' + a.docNo + ' — ' + st.replace(/^\S+\s/, ''),
          wrapHtml(lead, htmlTable(alertRows(a))), state);
      }
      return done(true);
    }

    if (event === 'test') {
      var vid = String(p.vetId || '');
      if (vid && !ID.test(vid)) return done(false, { error: 'bad vetId' });
      var minute = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      if (!once('test_' + (vid || 'all') + '_' + minute)) return done(true, { skipped: 'ทดสอบไปแล้วในนาทีนี้ — รอสักครู่แล้วลองใหม่' });
      var list = vid ? [fbGet('vets/' + vid)].filter(String) : activeVets(null);
      if (!list.length) return done(true, { skipped: 'ไม่พบผู้รับแจ้ง' });
      list.forEach(function (v) {
        pushLine(v.lineId, '🔔 ทดสอบการแจ้งเตือน PSU:LASC\nถึง: ' + (v.name || '') +
          '\nช่องทางนี้พร้อมรับแจ้งเหตุฉุกเฉิน/ปัญหาสุขภาพสัตว์แล้ว', state);
        sendMail(v.email, '[ทดสอบ] การแจ้งเตือนทีมสัตวแพทย์ PSU:LASC',
          wrapHtml('เรียน ' + esc(v.name || '') + '<br>ช่องทางอีเมลนี้พร้อมรับแจ้งเหตุฉุกเฉิน/ปัญหาสุขภาพสัตว์ทดลองแล้ว', ''), state);
      });
      return done(true);
    }

    if (event === 'register') {
      var ruid = String(p.uid || '');
      if (!ID.test(ruid)) return done(false, { error: 'bad uid' });
      var u = fbGet('users/' + ruid);
      if (!u) return done(false, { error: 'ไม่พบข้อมูลลงทะเบียน' });
      if (fbGet('members/' + ruid)) return done(true, { skipped: 'พิจารณาแล้ว' });
      if (!once('register_' + ruid)) return done(true, { skipped: 'แจ้งไปแล้ว' });
      var msg = '👥 มีนักวิจัยลงทะเบียนใหม่ รออนุมัติ\n' + (u.name || '') + ' · ' + (u.email || '') + '\n' +
        (u.org || '') + ' ' + (u.phone || '') +
        (cfg('APP_URL') ? '\n\nอนุมัติ: ' + cfg('APP_URL').replace(/\/?$/, '/') + 'index.html?tab=members' : '');
      activeVets(function (v) { return v.notifyMembers === true; }).forEach(function (v) {
        pushLine(v.lineId, msg, state);
        sendMail(v.email, '[LASC] นักวิจัยลงทะเบียนใหม่ — ' + (u.name || u.email || ''),
          wrapHtml(esc(msg).replace(/\n/g, '<br>'), ''), state);
      });
      return done(true);
    }

    if (event === 'member') {
      var muid = String(p.uid || '');
      if (!ID.test(muid)) return done(false, { error: 'bad uid' });
      var mu = fbGet('users/' + muid), mm = fbGet('members/' + muid);
      if (!mu || !mm || !mm.status) return done(false, { error: 'ไม่พบข้อมูล' });
      if (!once('member_' + muid + '_' + mm.status + '_' + (mm.at || ''))) return done(true, { skipped: 'แจ้งไปแล้ว' });
      var T = {
        approved:  ['บัญชีของท่านได้รับอนุมัติแล้ว', 'ท่านเข้าสู่ระบบรายงานการปฏิบัติต่อสัตว์ทดลองได้ทันที รายงานที่บันทึกไว้ในเครื่องจะส่งขึ้นระบบกลางให้อัตโนมัติ'],
        rejected:  ['บัญชีของท่านไม่ได้รับอนุมัติ', 'หากมีข้อสงสัย กรุณาติดต่อเจ้าหน้าที่ศูนย์สัตว์ทดลอง'],
        suspended: ['บัญชีของท่านถูกระงับการใช้งาน', 'กรุณาติดต่อเจ้าหน้าที่ศูนย์สัตว์ทดลอง']
      }[mm.status];
      if (!T) return done(true, { skipped: 'สถานะไม่ต้องแจ้ง' });
      sendMail(mu.email, '[LASC] ' + T[0],
        wrapHtml('เรียน ' + esc(mu.name || '') + '<br><b>' + T[0] + '</b><br>' + T[1], ''), state);
      return done(true);
    }

    if (event === 'syncProjects') {
      var minute = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      if (!once('syncProjects_' + minute)) return done(true, { skipped: 'เพิ่งซิงก์ไปเมื่อครู่ — รอสักครู่แล้วลองใหม่' });
      try {
        var r = syncProjectsFromMonitor();
        return done(true, { added: r.added, updated: r.updated, total: r.total, skipped: r.note || '' });
      } catch (e4) {
        return done(false, { error: String(e4 && e4.message || e4) });
      }
    }

    return done(false, { error: 'unknown event' });
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

/* =====================================================================
   ซิงก์ทะเบียนโครงการจากระบบตรวจติดตามการดำเนินการต่อสัตว์ฯ
   - เพิ่มโครงการใหม่ และเติมเฉพาะช่องที่ยังว่างของโครงการเดิม (ไม่ทับข้อมูลที่เจ้าหน้าที่แก้ไว้)
   - ไม่ลบโครงการที่หายไปจากต้นทาง
   - เรียกได้ทั้งจากปุ่มในระบบ และจากทริกเกอร์ตั้งเวลา (ดู setupProjectSyncTrigger)
   ===================================================================== */
var SYNC_FIELDS = ['projectNo', 'projectName', 'piName', 'piEmail', 'piPhone',
                   'species', 'sex', 'strain', 'approved', 'expiry', 'faculty'];

function syncProjectsFromMonitor() {
  var src = cfg('SRC_DB_URL').replace(/\/+$/, ''), sec = cfg('SRC_DB_SECRET');
  if (!src || !sec) throw new Error('ยังไม่ได้ตั้งค่า SRC_DB_URL / SRC_DB_SECRET ในสคริปต์ (ดูหัวไฟล์)');
  var path = cfg('SRC_PATH').replace(/^\/+|\/+$/g, '') || 'data/projects';
  var res = UrlFetchApp.fetch(src + '/' + path + '.json?auth=' + encodeURIComponent(sec), { method: 'get', muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('อ่านต้นทางไม่ได้ (HTTP ' + res.getResponseCode() + ') — ตรวจ SRC_DB_URL / SRC_DB_SECRET / SRC_PATH');
  var list = toList(JSON.parse(res.getContentText() || 'null')).filter(function (p) { return p && p.projectNo; });
  if (!list.length) return { added: 0, updated: 0, total: 0, note: 'ไม่พบโครงการที่ต้นทาง' };

  var dest = fbGet('projects') || {};
  var byNo = {};
  Object.keys(dest).forEach(function (k) {
    var p = dest[k];
    if (p && p.projectNo) byNo[String(p.projectNo).toLowerCase()] = k;
  });

  var added = 0, updated = 0, now = new Date().toISOString();
  list.forEach(function (s) {
    var no = String(s.projectNo).toLowerCase();
    var key = byNo[no];
    if (key) {
      /* มีอยู่แล้ว — เติมเฉพาะช่องที่ยังว่าง */
      var cur = dest[key], changed = false, patch = {};
      SYNC_FIELDS.forEach(function (f) {
        var has = cur[f] !== undefined && cur[f] !== '' && cur[f] !== 0;
        if (!has && s[f] !== undefined && s[f] !== '' && s[f] !== null) { patch[f] = s[f]; changed = true; }
      });
      if (changed) {
        Object.keys(patch).forEach(function (f) { cur[f] = patch[f]; });
        cur.updatedAt = now;
        fbPut('projects/' + key, cur);
        updated++;
      }
    } else {
      /* โครงการใหม่ — ใช้ id เดิมของต้นทางถ้าใช้เป็นคีย์ได้ เพื่อให้ซิงก์ซ้ำได้โดยไม่เกิดรายการซ้ำ */
      var id = (s.id && /^[A-Za-z0-9_-]{1,64}$/.test(String(s.id))) ? String(s.id)
             : 'm' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      var np = { id: id, createdAt: now, importedFrom: 'monitor' };
      SYNC_FIELDS.forEach(function (f) { np[f] = (s[f] === undefined || s[f] === null) ? '' : s[f]; });
      np.projectName = np.projectName || '(ไม่ระบุชื่อโครงการ)';
      np.approved = Number(np.approved) || 0;
      fbPut('projects/' + id, np);
      byNo[no] = id;
      added++;
    }
  });
  return { added: added, updated: updated, total: list.length };
}

/* กด Run ที่ฟังก์ชันนี้เพื่อซิงก์ด้วยมือ และดูผลใน Execution log */
function syncProjectsNow() {
  var r = syncProjectsFromMonitor();
  Logger.log('✅ ซิงก์ทะเบียนโครงการแล้ว — ต้นทาง ' + r.total + ' โครงการ · เพิ่มใหม่ ' + r.added + ' · เติมข้อมูล ' + r.updated + (r.note ? ' · ' + r.note : ''));
}

/* กด Run ที่ฟังก์ชันนี้ครั้งเดียว เพื่อให้ซิงก์อัตโนมัติทุก 6 ชั่วโมง (ลบของเดิมให้ก่อนกันซ้ำ) */
function setupProjectSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncProjectsNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncProjectsNow').timeBased().everyHours(6).create();
  Logger.log('✅ ตั้งซิงก์อัตโนมัติทุก 6 ชั่วโมงแล้ว (ยกเลิกได้ที่เมนู ⏰ Triggers)');
}

/* ==================== LINE webhook ==================== */
var LINE_HELP = 'ระบบแจ้งเหตุสัตว์ทดลอง PSU:LASC\n' +
  '• พิมพ์ "ลงทะเบียน ชื่อ-สกุล" เพื่อขอรับแจ้งเหตุฉุกเฉิน/ปัญหาสุขภาพสัตว์ทาง LINE\n' +
  '• ในกลุ่มสัตวแพทย์ พิมพ์ "ลงทะเบียน" เพื่อให้ทั้งกลุ่มรับแจ้ง\n' +
  '• พิมพ์ "ยกเลิก" เพื่อแจ้งขอหยุดรับแจ้ง';

function lineApi(method, path, payload) {
  var opt = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + cfg('LINE_TOKEN') }
  };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch('https://api.line.me' + path, opt);
  var t = res.getContentText();
  try { return JSON.parse(t); } catch (e) { return {}; }
}
function lineReply(token, text) {
  if (!token) return;
  lineApi('post', '/v2/bot/message/reply', { replyToken: token, messages: [{ type: 'text', text: text }] });
}
function handleLine(body) {
  var events = body.events || [];
  var handled = [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var src = ev.source || {};
    var lineId = src.groupId || src.roomId || src.userId || '';
    var type = (src.groupId || src.roomId) ? 'group' : 'user';
    if (!/^[UCR][0-9a-f]{32}$/.test(lineId)) continue;

    if (ev.type === 'follow' || ev.type === 'join') {
      lineReply(ev.replyToken, 'สวัสดีครับ 🙏\n' + LINE_HELP);
      handled.push(ev.type);
      continue;
    }
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') continue;

    var text = String(ev.message.text || '').trim();
    var m = text.match(/^(ลงทะเบียน|register)\s*([\s\S]*)$/i);
    if (m) {
      var displayName = '';
      try {
        if (type === 'user') displayName = (lineApi('get', '/v2/bot/profile/' + lineId) || {}).displayName || '';
        else if (src.groupId) displayName = (lineApi('get', '/v2/bot/group/' + lineId + '/summary') || {}).groupName || '';
      } catch (e) {}
      var byName = '';
      if (type === 'group' && src.userId) {
        try { byName = (lineApi('get', '/v2/bot/group/' + lineId + '/member/' + src.userId) || {}).displayName || ''; } catch (e) {}
      }
      fbPut('vetRequests/' + lineId, {
        lineId: lineId, type: type,
        displayName: displayName.slice(0, 100),
        name: m[2].trim().slice(0, 100),
        requestedBy: byName.slice(0, 100),
        at: new Date().toISOString()
      });
      lineReply(ev.replyToken, '✅ รับคำขอรับแจ้งเหตุแล้ว' + (type === 'group' ? ' (ทั้งกลุ่ม)' : '') +
        '\nรอเจ้าหน้าที่ศูนย์สัตว์ทดลองอนุมัติในระบบ — เมื่ออนุมัติแล้วจะเริ่มได้รับแจ้งเตือนทันที');
      handled.push('register');
      continue;
    }
    if (/^(ยกเลิก|unregister)$/i.test(text)) {
      fbPut('vetRequests/' + lineId, {
        lineId: lineId, type: type, displayName: '', name: '⛔ ขอยกเลิกการรับแจ้ง', at: new Date().toISOString()
      });
      lineReply(ev.replyToken, 'ส่งคำขอยกเลิกให้เจ้าหน้าที่แล้ว — เจ้าหน้าที่จะปิดการแจ้งเตือนของท่านในระบบ');
      handled.push('unregister');
      continue;
    }
    if (type === 'user' && /^(help|ช่วยเหลือ|วิธีใช้)$/i.test(text)) {
      lineReply(ev.replyToken, LINE_HELP);
      handled.push('help');
    }
  }
  return jsonOut({ ok: true, handled: handled });
}

/* ==================== ตรวจการตั้งค่า (กด Run ที่ฟังก์ชันนี้) ==================== */
function setupTest() {
  var miss = ['FB_DB_URL', 'FB_DB_SECRET', 'ALERT_KEY'].filter(function (k) { return !cfg(k); });
  if (miss.length) { Logger.log('❌ ยังไม่ได้ตั้งค่า: ' + miss.join(', ')); return; }
  try {
    var vets = toList(fbGet('vets'));
    Logger.log('✅ อ่าน Firebase ได้ — มีผู้รับแจ้งในระบบ ' + vets.length + ' รายการ');
  } catch (e) { Logger.log('❌ อ่าน Firebase ไม่ได้: ' + e.message + ' (ตรวจ FB_DB_URL / FB_DB_SECRET / FB_ROOT)'); return; }
  if (cfg('LINE_TOKEN')) {
    var info = lineApi('get', '/v2/bot/info');
    Logger.log(info && info.displayName ? '✅ LINE token ใช้ได้ — บัญชี: ' + info.displayName : '❌ LINE token ไม่ถูกต้อง');
  } else {
    Logger.log('ℹ️ ยังไม่ได้ใส่ LINE_TOKEN (ส่งเฉพาะอีเมล)');
  }
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({ to: me, subject: '[ทดสอบ] ตัวกลางแจ้งเหตุ PSU:LASC', htmlBody: wrapHtml('สคริปต์ทำงานได้ตามปกติ', ''), name: cfg('SENDER_NAME') });
  Logger.log('✅ ส่งอีเมลทดสอบไปที่ ' + me + ' แล้ว (เหลือโควตาวันนี้ ' + MailApp.getRemainingDailyQuota() + ' ฉบับ)');
}
