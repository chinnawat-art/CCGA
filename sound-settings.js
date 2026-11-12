// ═══ ตั้งเสียงแจ้งเตือนหน้าฝ่ายผลิต ทีละผู้ใช้ (เจ้าของขอ 12/11/2569) ═══════════
// แต่ละบัญชี (แต่ละแผนก) เลือกเสียงสำเร็จรูป หรืออัปโหลดไฟล์เสียงเองได้
// 3 เหตุการณ์: ออเดอร์ใหม่เข้า · เริ่มผลิต · ผลิตสำเร็จ  (ย้อนกลับใช้เสียงเดิมของระบบ)
// ค่าเก็บในตาราง user_sound_settings (1 คน 1 แถว) · ไฟล์เสียงเก็บใน bucket user-sounds/<รหัสผู้ใช้>/...
// ใช้ร่วมกับ production.js: ฟังก์ชันเสียงเดิมเรียก SoundPrefs.play(event) ก่อน ถ้าคืน true = เล่นเสียงที่ตั้งไว้แล้ว
(function () {
    'use strict';

    var BUCKET = 'user-sounds';
    var MAX_BYTES = 1024 * 1024;          // 1 MB (ตรงกับ bucket)
    var EVENTS = [
        { key: 'new_order', label: '📥 ออเดอร์ใหม่เข้า', speak: 'มีออเดอร์ใหม่' },
        { key: 'start', label: '🔨 เริ่มผลิต', speak: 'เริ่มผลิต' },
        { key: 'done', label: '✅ ผลิตสำเร็จ', speak: 'ผลิตสำเร็จ' }
    ];

    // เสียงสำเร็จรูป: สร้างจากเครื่องเอง ไม่ต้องโหลดไฟล์ (ไม่กินเน็ต)
    // n = [ความถี่, เริ่ม(วิ), ยาว(วิ), ความดัง, ชนิดคลื่น]
    var PRESETS = {
        default: { label: 'เสียงเดิมของระบบ' },
        chime: { label: 'กระดิ่ง 4 จังหวะ', n: [[783.99, 0, .28, .85, 'triangle'], [1046.5, .12, .32, .95, 'triangle'], [1318.51, .25, .55, 1, 'sine'], [1567.98, .4, .7, .9, 'sine']] },
        dingdong: { label: 'ออด ติ๊ง-ต่อง', n: [[987.77, 0, .9, 1, 'sine'], [783.99, .55, 1.2, 1, 'sine']] },
        beep3: { label: 'ปี๊บ 3 ครั้ง', n: [[1760, 0, .14, .8, 'square'], [1760, .24, .14, .8, 'square'], [1760, .48, .14, .8, 'square']] },
        alarm: { label: 'ไซเรนเตือน (ดังมาก)', sweep: true },
        coin: { label: 'ติ๊งเหรียญ', n: [[987.77, 0, .1, .8, 'square'], [1318.51, .08, .5, .8, 'square']] },
        bell: { label: 'ระฆัง', n: [[659.25, 0, 1.6, 1, 'sine'], [1318.5, 0, 1.1, .45, 'sine'], [1975.5, 0, .7, .25, 'sine']] },
        rise: { label: 'ไล่เสียงขึ้น', n: [[523.25, 0, .12, .7, 'triangle'], [659.25, .1, .12, .8, 'triangle'], [783.99, .2, .12, .85, 'triangle'], [1046.5, .3, .5, .95, 'sine']] },
        speak: { label: '🗣️ พูดเป็นคำ (เช่น มีออเดอร์ใหม่)' },
        none: { label: '🔇 ไม่มีเสียง' },
        file: { label: '📁 ไฟล์เสียงที่อัปโหลด' }
    };

    var db = null, uid = null, email = '';
    var settings = { volume: 1, events: {} };   // events[key] = { sound, repeat, file: { path, name } }
    var buffers = {};                            // event key → AudioBuffer ของไฟล์ที่อัปโหลด
    var loaded = false;

    function ctx() { return typeof getAudioContext === 'function' ? getAudioContext() : null; }
    function evCfg(key) { return (settings.events && settings.events[key]) || { sound: 'default', repeat: 1 }; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function playNotes(c, notes, at, vol) {
        notes.forEach(function (n) {
            var osc = c.createOscillator(), g = c.createGain();
            osc.type = n[4];
            osc.frequency.setValueAtTime(n[0], at + n[1]);
            g.gain.setValueAtTime(Math.max(0.0002, n[3] * vol), at + n[1]);
            g.gain.exponentialRampToValueAtTime(0.0001, at + n[1] + n[2]);
            osc.connect(g); g.connect(c.destination);
            osc.start(at + n[1]); osc.stop(at + n[1] + n[2] + 0.02);
        });
    }
    function playSweep(c, at, vol) {   // ไซเรน 2 รอบ ~1.6 วิ
        var osc = c.createOscillator(), g = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, at);
        osc.frequency.linearRampToValueAtTime(1500, at + .4);
        osc.frequency.linearRampToValueAtTime(700, at + .8);
        osc.frequency.linearRampToValueAtTime(1500, at + 1.2);
        osc.frequency.linearRampToValueAtTime(700, at + 1.6);
        g.gain.setValueAtTime(.35 * vol, at);
        g.gain.setValueAtTime(.35 * vol, at + 1.5);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.65);
        osc.connect(g); g.connect(c.destination);
        osc.start(at); osc.stop(at + 1.7);
    }
    function length(sound, buf) {
        if (sound === 'alarm') return 1.7;
        if (sound === 'file') return buf ? buf.duration : 0;
        var p = PRESETS[sound];
        return p && p.n ? Math.max.apply(null, p.n.map(function (n) { return n[1] + n[2]; })) : 0;
    }
    function speakText(text, times, vol) {
        if (!('speechSynthesis' in window)) return false;
        try {
            window.speechSynthesis.cancel();
            for (var i = 0; i < times; i++) {
                var u = new SpeechSynthesisUtterance(text);
                u.lang = 'th-TH'; u.volume = Math.min(1, vol); u.rate = 1;
                window.speechSynthesis.speak(u);
            }
            return true;
        } catch (e) { return false; }
    }

    // เล่นเสียงตามค่าที่ระบุ (ใช้ทั้งตอนแจ้งเตือนจริงและปุ่ม ▶ ทดลอง)
    function playCfg(key, cfg, buf, vol) {
        var sound = cfg.sound || 'default';
        var times = Math.min(3, Math.max(1, parseInt(cfg.repeat, 10) || 1));
        if (sound === 'none') return true;
        if (sound === 'speak') {
            var ev = EVENTS.filter(function (e) { return e.key === key; })[0];
            return speakText(ev ? ev.speak : 'แจ้งเตือน', times, vol);
        }
        var c = ctx();
        if (!c) return false;
        if (c.state === 'suspended') c.resume();
        var at = c.currentTime + 0.02;
        if (sound === 'file') {
            if (!buf) return false;   // ไฟล์ยังโหลดไม่เสร็จ/โหลดไม่ได้ → ใช้เสียงเดิมแทน
        } else if (!PRESETS[sound] || sound === 'default') {
            return false;
        }
        var gap = length(sound, buf) + 0.25;
        for (var i = 0; i < times; i++) {
            var t = at + i * gap;
            if (sound === 'file') {
                var src = c.createBufferSource(), g = c.createGain();
                src.buffer = buf; g.gain.value = vol;
                src.connect(g); g.connect(c.destination);
                src.start(t);
            } else if (sound === 'alarm') {
                playSweep(c, t, vol);
            } else {
                playNotes(c, PRESETS[sound].n, t, vol);
            }
        }
        return true;
    }

    function play(key) {
        if (!loaded) return false;
        var cfg = evCfg(key);
        if (!cfg.sound || cfg.sound === 'default') return false;
        try { return playCfg(key, cfg, buffers[key], settings.volume == null ? 1 : settings.volume); }
        catch (e) { console.warn('เล่นเสียงที่ตั้งไว้ไม่ได้:', e); return false; }
    }

    function decode(arrayBuf) {
        var c = ctx();
        if (!c) return Promise.reject(new Error('เบราว์เซอร์นี้เล่นเสียงไม่ได้'));
        return new Promise(function (ok, bad) {
            // Safari รุ่นเก่ารับแค่แบบ callback
            var p = c.decodeAudioData(arrayBuf.slice(0), ok, bad);
            if (p && p.then) p.then(ok, bad);
        });
    }

    async function loadFileBuffer(key) {
        var f = evCfg(key).file;
        if (!f || !f.path) return;
        try {
            var res = await db.storage.from(BUCKET).download(f.path);
            if (res.error || !res.data) throw res.error || new Error('ไม่พบไฟล์');
            buffers[key] = await decode(await res.data.arrayBuffer());
        } catch (e) {
            console.warn('โหลดไฟล์เสียงไม่ได้ (' + key + '):', e);
        }
    }

    async function init(client) {
        db = client;
        try {
            var s = await db.auth.getSession();
            var user = s && s.data && s.data.session && s.data.session.user;
            if (!user) return;
            uid = user.id; email = user.email || '';
            var r = await db.from('user_sound_settings').select('settings').eq('user_id', uid).maybeSingle();
            if (!r.error && r.data && r.data.settings) {
                settings = Object.assign({ volume: 1, events: {} }, r.data.settings);
                settings.events = settings.events || {};
            }
            loaded = true;
            await Promise.all(EVENTS.filter(function (e) { return evCfg(e.key).sound === 'file'; }).map(function (e) { return loadFileBuffer(e.key); }));
        } catch (e) {
            loaded = true;   // ตั้งเสียงไม่ได้ก็ใช้เสียงเดิม
            console.warn('โหลดค่าตั้งเสียงไม่ได้:', e);
        }
    }

    // ─── หน้าต่างตั้งเสียง ─────────────────────────────
    var draft = null;   // { volume, events: { key: { sound, repeat, file, newFile, newBuf } } }

    function injectStyle() {
        if (document.getElementById('sndStyle')) return;
        var st = document.createElement('style');
        st.id = 'sndStyle';
        st.textContent =
            '#sndModal{position:fixed;inset:0;z-index:10060;background:rgba(2,6,23,.7);display:none;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto}' +
            '#sndModal.show{display:flex}' +
            '#sndModal .snd-box{width:min(560px,100%);background:var(--bg-card,#0f172a);color:var(--text-main,#e2e8f0);border:1px solid var(--border,rgba(148,163,184,.25));border-radius:16px;padding:16px;margin:auto 0}' +
            '#sndModal h3{margin:0 0 4px;font-size:1.1rem}' +
            '#sndModal .snd-who{font-size:.8rem;opacity:.75;margin-bottom:12px}' +
            '#sndModal .snd-ev{border:1px solid var(--border,rgba(148,163,184,.25));border-radius:12px;padding:10px 12px;margin-bottom:10px}' +
            '#sndModal .snd-ev-head{font-weight:700;margin-bottom:8px}' +
            '#sndModal .snd-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
            '#sndModal select,#sndModal input[type=file]{font-family:inherit;padding:8px;border-radius:8px;border:1px solid var(--border,rgba(148,163,184,.35));background:var(--input-bg,rgba(255,255,255,.04));color:inherit;max-width:100%}' +
            '#sndModal select.snd-sound{flex:1 1 220px}' +
            '#sndModal .snd-file{margin-top:8px;font-size:.85rem}' +
            '#sndModal .snd-file small{display:block;opacity:.7;margin-top:3px}' +
            '#sndModal .snd-btn{font-family:inherit;cursor:pointer;padding:8px 12px;border-radius:8px;border:1px solid var(--border,rgba(148,163,184,.35));background:transparent;color:inherit;font-weight:600}' +
            '#sndModal .snd-btn.main{background:#6366f1;border-color:#6366f1;color:#fff}' +
            '#sndModal .snd-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}' +
            '#sndModal .snd-msg{font-size:.85rem;margin-top:8px;min-height:1.2em}' +
            '#sndModal .snd-vol{display:flex;align-items:center;gap:10px;margin:4px 0 12px}' +
            '#sndModal .snd-vol input{flex:1}';
        document.head.appendChild(st);
    }

    function soundOptions(sel) {
        return Object.keys(PRESETS).map(function (k) {
            return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(PRESETS[k].label) + '</option>';
        }).join('');
    }

    function render() {
        var m = document.getElementById('sndModal');
        var vol = Math.round((draft.volume == null ? 1 : draft.volume) * 100);
        m.innerHTML = '<div class="snd-box" role="dialog" aria-modal="true" aria-label="ตั้งเสียงแจ้งเตือน">'
            + '<h3>🎵 ตั้งเสียงแจ้งเตือน</h3>'
            + '<div class="snd-who">ตั้งเฉพาะบัญชี <b>' + esc(email || '-') + '</b> · เข้าบัญชีนี้เครื่องไหนก็ได้เสียงเดียวกัน · บัญชีอื่นไม่เปลี่ยน</div>'
            + '<div class="snd-vol">🔈 ความดัง <input type="range" min="10" max="100" step="5" value="' + vol + '" id="sndVol"> <b id="sndVolTxt">' + vol + '%</b></div>'
            + EVENTS.map(function (e) {
                var c = draft.events[e.key];
                var fileName = c.newFile ? c.newFile.name : (c.file && c.file.name);
                return '<div class="snd-ev" data-ev="' + e.key + '">'
                    + '<div class="snd-ev-head">' + e.label + '</div>'
                    + '<div class="snd-row">'
                    + '<select class="snd-sound" data-k="sound" aria-label="เสียง' + esc(e.label) + '">' + soundOptions(c.sound) + '</select>'
                    + '<select data-k="repeat" aria-label="ดังกี่ครั้ง">' + [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (n === (parseInt(c.repeat, 10) || 1) ? ' selected' : '') + '>ดัง ' + n + ' ครั้ง</option>'; }).join('') + '</select>'
                    + '<button type="button" class="snd-btn" data-test="' + e.key + '">▶ ทดลอง</button>'
                    + '</div>'
                    + (c.sound === 'file'
                        ? '<div class="snd-file">' + (fileName ? '🎧 ' + esc(fileName) : '<b>ยังไม่ได้เลือกไฟล์</b>')
                          + '<br><input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg" data-file="' + e.key + '">'
                          + '<small>MP3 / M4A / WAV ไม่เกิน 1 MB · แนะนำยาวไม่เกิน 5 วินาที</small></div>'
                        : '')
                    + '</div>';
            }).join('')
            + '<div class="snd-msg" id="sndMsg"></div>'
            + '<div class="snd-foot">'
            + '<button type="button" class="snd-btn" id="sndReset">ใช้เสียงเดิมทั้งหมด</button>'
            + '<button type="button" class="snd-btn" id="sndCancel">ยกเลิก</button>'
            + '<button type="button" class="snd-btn main" id="sndSave">💾 บันทึก</button>'
            + '</div></div>';
    }

    function msg(t) { var el = document.getElementById('sndMsg'); if (el) el.textContent = t; }

    function open() {
        injectStyle();
        var m = document.getElementById('sndModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'sndModal';
            document.body.appendChild(m);
            m.addEventListener('click', onClick);
            m.addEventListener('change', onChange);
            m.addEventListener('input', function (e) {
                if (e.target.id === 'sndVol') {
                    draft.volume = Number(e.target.value) / 100;
                    document.getElementById('sndVolTxt').textContent = e.target.value + '%';
                }
            });
        }
        if (!uid) { alert('ยังโหลดข้อมูลผู้ใช้ไม่เสร็จ ลองใหม่อีกครั้ง'); return; }
        ctx();   // ปลดล็อกเสียงด้วยการกดปุ่มนี้
        draft = { volume: settings.volume == null ? 1 : settings.volume, events: {} };
        EVENTS.forEach(function (e) {
            var c = evCfg(e.key);
            draft.events[e.key] = { sound: c.sound || 'default', repeat: c.repeat || 1, file: c.file || null, newFile: null, newBuf: null };
        });
        render();
        m.classList.add('show');
    }
    function close() { var m = document.getElementById('sndModal'); if (m) m.classList.remove('show'); draft = null; }

    function onChange(e) {
        var box = e.target.closest('[data-ev]');
        if (!box || !draft) return;
        var key = box.dataset.ev, c = draft.events[key];
        if (e.target.dataset.k === 'sound') { c.sound = e.target.value; render(); return; }
        if (e.target.dataset.k === 'repeat') { c.repeat = parseInt(e.target.value, 10) || 1; return; }
        if (e.target.dataset.file) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            if (f.size > MAX_BYTES) { msg('❌ ไฟล์ใหญ่เกิน 1 MB (' + (f.size / 1048576).toFixed(1) + ' MB) — ตัดให้สั้นลงก่อน'); e.target.value = ''; return; }
            msg('กำลังอ่านไฟล์...');
            f.arrayBuffer().then(decode).then(function (buf) {
                c.newFile = f; c.newBuf = buf;
                render();
                msg(buf.duration > 8 ? '⚠️ ไฟล์ยาว ' + buf.duration.toFixed(0) + ' วินาที — ใช้ได้ แต่แนะนำไม่เกิน 5 วินาที' : '✅ อ่านไฟล์ได้ (' + buf.duration.toFixed(1) + ' วินาที) กด ▶ ทดลอง ได้เลย');
            }, function () {
                msg('❌ เครื่องนี้เปิดไฟล์นี้ไม่ได้ — ลองแปลงเป็น MP3');
                e.target.value = '';
            });
        }
    }

    function onClick(e) {
        if (e.target.id === 'sndModal' || e.target.id === 'sndCancel') { close(); return; }
        if (e.target.id === 'sndSave') { save(e.target); return; }
        if (e.target.id === 'sndReset') {
            EVENTS.forEach(function (ev) { draft.events[ev.key] = { sound: 'default', repeat: 1, file: null, newFile: null, newBuf: null }; });
            draft.volume = 1;
            render(); msg('ตั้งเป็นเสียงเดิมแล้ว — กด 💾 บันทึก เพื่อใช้จริง');
            return;
        }
        var t = e.target.closest('[data-test]');
        if (t) {
            var key = t.dataset.test, c = draft.events[key];
            ctx();
            var vol = draft.volume == null ? 1 : draft.volume;
            if (c.sound === 'default') { playDefault(key); return; }
            var ok = playCfg(key, c, c.newBuf || buffers[key], vol);
            if (!ok) msg(c.sound === 'file' ? 'ยังไม่มีไฟล์เสียง — เลือกไฟล์ก่อน' : c.sound === 'speak' ? '❌ เครื่องนี้พูดภาษาไทยไม่ได้ — เลือกเสียงอื่น' : 'เล่นเสียงไม่ได้');
        }
    }

    function playDefault(key) {
        var fn = { new_order: 'playNotificationSound', start: 'playStartProductionSound', done: 'playSuccessSound' }[key];
        var saved = loaded; loaded = false;   // ข้ามค่าที่ตั้ง ให้เล่นเสียงเดิม
        try { if (typeof window[fn] === 'function') window[fn](true); } finally { loaded = saved; }
    }

    function extOf(f) {
        var m = /\.([a-z0-9]{2,4})$/i.exec(f.name || '');
        return m ? m[1].toLowerCase() : 'mp3';
    }
    var MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm' };

    async function save(btn) {
        if (!draft) return;
        for (var i = 0; i < EVENTS.length; i++) {
            var c0 = draft.events[EVENTS[i].key];
            if (c0.sound === 'file' && !c0.newFile && !(c0.file && c0.file.path)) { msg('❌ ' + EVENTS[i].label + ': เลือกไฟล์เสียงก่อน หรือเปลี่ยนเป็นเสียงอื่น'); return; }
        }
        btn.disabled = true; msg('กำลังบันทึก...');
        var oldPaths = EVENTS.map(function (e) { var f = evCfg(e.key).file; return f && f.path; }).filter(Boolean);
        try {
            var next = { volume: draft.volume, events: {} };
            var newBufs = {};
            for (var j = 0; j < EVENTS.length; j++) {
                var key = EVENTS[j].key, c = draft.events[key];
                var item = { sound: c.sound, repeat: c.repeat || 1 };
                if (c.sound === 'file') {
                    if (c.newFile) {
                        var ext = extOf(c.newFile);
                        var path = uid + '/' + key + '-' + Date.now() + '.' + ext;
                        var up = await db.storage.from(BUCKET).upload(path, c.newFile, { contentType: MIME[ext] || c.newFile.type || 'audio/mpeg', upsert: false });
                        if (up.error) throw up.error;
                        item.file = { path: path, name: c.newFile.name };
                        newBufs[key] = c.newBuf;
                    } else {
                        item.file = c.file;
                    }
                }
                next.events[key] = item;
            }
            var r = await db.from('user_sound_settings').upsert({ user_id: uid, settings: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (r.error) throw r.error;

            // ลบไฟล์เก่าที่ไม่ใช้แล้ว (ลบไม่ได้ก็ไม่เป็นไร)
            var keep = EVENTS.map(function (e) { var f = next.events[e.key].file; return f && f.path; }).filter(Boolean);
            var drop = oldPaths.filter(function (p) { return keep.indexOf(p) < 0; });
            if (drop.length) db.storage.from(BUCKET).remove(drop).catch(function () {});

            settings = next;
            EVENTS.forEach(function (e) {
                if (newBufs[e.key]) buffers[e.key] = newBufs[e.key];
                if (next.events[e.key].sound !== 'file') delete buffers[e.key];
            });
            close();
            if (typeof showToast === 'function') showToast('🎵 บันทึกเสียงแจ้งเตือนแล้ว', 'success');
        } catch (e) {
            var m = String((e && e.message) || e);
            msg(/user_sound_settings|relation|bucket|not found|schema cache/i.test(m)
                ? '❌ ระบบตั้งเสียงยังไม่พร้อม (ต้องรัน SQL ก่อน) — แจ้งผู้ดูแลระบบ'
                : '❌ บันทึกไม่สำเร็จ: ' + m);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    window.SoundPrefs = { init: init, play: play, open: open };
})();
