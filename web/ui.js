// Ekran çizimi. DOM'a yalnızca bu dosya ve main.js dokunur.

import { STRING_NAMES } from './song.js';

const BOW_LABEL = { D: '↓ çekerek', U: '↑ iterek' };
const BOW_ARROW = { D: '↓', U: '↑' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const FINGER_LABEL = ['boş tel', '1. parmak', '2. parmak', '3. parmak', '4. parmak'];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const cardHead = (title, ...extra) => el('div', { className: 'card-head' }, el('h2', { textContent: title }), ...extra);

// ---------------------------------------------------------------- Üst çubuk

// Ses düğmesi ve durum etiketleri (kaynak, IMU kipi).
export function renderTopbar(container, { onSoundToggle, onTestTone }) {
  const sound = el('button', { className: 'sound' });
  sound.addEventListener('click', () => onSoundToggle());
  const test = el('button', { className: 'test-tone', textContent: '♪ Dene', title: '1 saniyelik La sesi çal' });
  test.addEventListener('click', () => onTestTone());
  const fill = el('span');
  const meter = el('span', { className: 'meter', title: 'Ses seviyesi (çıkıştaki sinyal)' }, fill);
  const source = el('span', { className: 'chip' });
  const mode = el('span', { className: 'chip' });
  container.replaceChildren(source, mode, el('span', { className: 'sound-group' }, meter, test, sound));
  return {
    update({ audioOn, audioState, level, sourceLabel, sourceLive, imuMode }) {
      sound.textContent = audioOn ? '🔊 Ses açık' : '🔇 Sesi aç';
      sound.classList.toggle('primary', !audioOn);
      sound.title = audioOn ? `Sesi kapat (ses bağlamı: ${audioState})` : 'Tarayıcılar sesi ancak bir tıklamayla başlatır';
      // RMS'yi görünür ölçeğe çevir: 0,005 → %0, 0,3 → %100 (logaritmik)
      const pct = level > 0.005 ? Math.min(100, (Math.log10(level / 0.005) / Math.log10(60)) * 100) : 0;
      fill.style.width = `${pct}%`;
      meter.classList.toggle('warn', audioOn && audioState !== 'running');
      source.textContent = sourceLabel;
      source.classList.toggle('live', sourceLive);
      mode.textContent = imuMode ? 'IMU kipi' : 'Yalnızca temas';
    },
  };
}

export function renderNotice(container, text) {
  container.textContent = text;
  container.hidden = !text;
}

// ---------------------------------------------------------------- Çal

export function renderSongPicker(container, entries, onPick) {
  const select = el('select', { id: 'song-select' });
  for (const { file, title } of entries) {
    select.append(el('option', { value: file, textContent: title }));
  }
  select.addEventListener('change', () => onPick(select.value));
  container.replaceChildren(el('label', { className: 'field' }, el('span', { textContent: 'Şarkı' }), select));
  return select;
}

// Çalma paneli: şarkı ve tempo, dört telli şema, yay yönü, ilerleme, sonraki notalar.
export function renderPlayPanel(container, h) {
  const pickerSlot = el('div', { className: 'picker' });
  const bpmInput = el('input', { type: 'number', min: 40, max: 120, step: 1 });
  const startBtn = el('button', { className: 'primary big', textContent: 'Denemeyi başlat' });
  startBtn.addEventListener('click', () => h.onStart());
  const stopBtn = el('button', { className: 'big', textContent: 'Durdur', hidden: true });
  stopBtn.addEventListener('click', () => h.onStop());

  const info = el('p', { className: 'play-info' });
  const now = el('p', { className: 'now-playing' });
  const bar = el('span');
  const progress = el('div', { className: 'progress' }, bar);
  const strings = STRING_NAMES.map((name, i) => el('div', { className: `pstring s${i}` },
    el('i', { className: 'wire' }), el('span', { textContent: name })));
  const bowArrow = el('div', { className: 'bow-arrow' });
  const bowText = el('div', { className: 'bow-text' });
  const bow = el('div', { className: 'bow' }, bowArrow, bowText);
  const next = el('div', { className: 'next' });
  const summary = el('p', { className: 'summary muted' });

  container.replaceChildren(
    cardHead('Çal'),
    el('div', { className: 'play-controls' },
      pickerSlot,
      el('label', { className: 'field tempo' }, el('span', { textContent: 'Tempo (vuruş/dk)' }), bpmInput),
      el('div', { className: 'play-buttons' }, startBtn, stopBtn)),
    el('div', { className: 'play-status' }, info, progress, now),
    el('div', { className: 'play' }, el('div', { className: 'pstrings' }, ...strings), bow),
    next,
    summary,
  );

  return {
    pickerSlot,
    getBpm: () => Math.max(40, Math.min(120, Math.round(Number(bpmInput.value) || 60))),
    setBpm: (b) => { bpmInput.value = b; },
    update(v) {
      const busy = v.state === 'countin' || v.state === 'playing';
      startBtn.hidden = busy;
      stopBtn.hidden = !busy;
      bpmInput.disabled = busy;
      container.classList.toggle('busy', busy);
      info.textContent = v.state === 'countin' ? `Hazırlık: ${v.countdown}`
        : v.state === 'playing' ? `Nota ${Math.min(v.pointer + 1, v.total)} / ${v.total}`
          : v.state === 'done' ? 'Deneme bitti.'
            : 'Serbest çalma: sopanın değdiği tel ve bastığın şerit hangi notayı veriyorsa o çalar. Şarkı için "Denemeyi başlat".';
      progress.hidden = !busy && v.state !== 'done';
      bar.style.width = `${v.total ? Math.round((Math.min(v.pointer, v.total) / v.total) * 100) : 0}%`;
      strings.forEach((node, i) => {
        const touched = ((v.mask ?? 0) >> i) & 1;
        node.classList.toggle('expected', v.expected?.string === i);
        node.classList.toggle('touched', !!touched);
        node.classList.toggle('sounding', !!(v.sounding && touched));
      });
      bow.hidden = !v.expected;
      bowArrow.textContent = v.expected ? BOW_ARROW[v.expected.bow] : '';
      bowText.textContent = v.expected ? (v.expected.bow === 'D' ? 'çekerek' : 'iterek') : '';
      next.replaceChildren(...(v.next.length ? [el('span', { className: 'muted', textContent: 'Sıradaki' }),
        ...v.next.map((n) => el('span', { className: 'note-chip',
          textContent: `${n.pitch} · ${STRING_NAMES[n.string]} ${BOW_ARROW[n.bow]}` }))] : []));
      summary.textContent = v.summary ?? '';
      now.textContent = v.now
        ? `Çalınan: ${STRING_NAMES[v.now.string]} teli · ${FINGER_LABEL[v.now.finger]} · ${midiName(v.now.midi)}`
        : `Parmak: ${FINGER_LABEL[v.finger ?? 0]}`;
      now.classList.toggle('on', !!v.now);
    },
  };
}

// ---------------------------------------------------------------- Notalar

export function renderSongTable(container, song) {
  const head = el('tr', {}, ...['#', 'Perde', 'Tel', 'Yay', 'Vuruş', 'Süre', 'Hata']
    .map((h) => el('th', { textContent: h })));
  const rows = song.notes.map((n) => el('tr', { className: n.rest ? 'rest' : '', id: `note-${n.index}` },
    el('td', { className: 'num', textContent: n.index }),
    el('td', { textContent: n.rest ? 'Sus' : n.pitch }),
    el('td', { textContent: n.rest ? '–' : STRING_NAMES[n.string] }),
    el('td', { textContent: n.rest ? '–' : BOW_LABEL[n.bow] }),
    el('td', { className: 'num', textContent: n.start_beat }),
    el('td', { className: 'num', textContent: n.dur_beats }),
    el('td', { className: 'err' }),
  ));
  container.replaceChildren(
    cardHead(song.title, el('span', { className: 'muted',
      textContent: `${song.bpm} vuruş/dk · ${song.beats_per_bar}/4 · seviye ${song.level} · ${song.notes.length} nota` })),
    el('div', { className: 'table-wrap' },
      el('table', { className: 'notes' }, el('thead', {}, head), el('tbody', {}, ...rows))),
  );
}

// Nota tablosunda sıradaki notayı işaretler.
export function highlightNote(index) {
  const cur = document.querySelector('tr.current');
  if (cur?.id === `note-${index}`) return;
  cur?.classList.remove('current');
  document.getElementById(`note-${index}`)?.classList.add('current');
}

// Nota tablosunda hatalı notaları işaretler. perNote: rules.evaluate().perNote
export function markNoteErrors(perNote, labels) {
  document.querySelectorAll('table.notes tbody tr').forEach((r) => {
    r.classList.remove('has-error');
    const cell = r.querySelector('td.err');
    if (cell) cell.textContent = '';
  });
  for (const p of perNote) {
    const row = document.getElementById(`note-${p.index}`);
    if (!row) continue;
    row.querySelector('td.err').textContent = p.errors.map((t) => labels[t]).join(', ');
    row.classList.toggle('has-error', p.errors.length > 0);
  }
}

// ---------------------------------------------------------------- Sonuç

// Deneme sonucu: öğretmen metni, öneri, bulgular, değerlendirilemeyenler. (Soru-cevap en
// üstteki öğretmen kartındadır; buradaki soru kutusu setQaEnabled(false) ile gizlidir.)
export function renderResultPanel(container, { onApply, onAsk }) {
  container.replaceChildren();
  container.hidden = true;
  let teacher = null;
  const feedback = el('p', { className: 'feedback' });
  const next = el('p', { className: 'next-step' });
  const source = el('p', { className: 'source muted' });
  const applyBtn = el('button', { className: 'primary', textContent: 'Öneriyi uygula' });
  applyBtn.addEventListener('click', () => onApply(teacher.next_exercise_id, teacher.next_bpm));

  const question = el('input', { type: 'text', placeholder: 'Öğretmene sor… (ör. Neden geç kaldım?)' });
  const askBtn = el('button', { textContent: 'Sor' });
  const answer = el('p', { className: 'answer' });
  async function ask() {
    const q = question.value.trim();
    if (!q) return;
    askBtn.disabled = true;
    answer.textContent = 'Yanıt bekleniyor…';
    const r = await onAsk(q);
    answer.textContent = r.text ?? `Yanıt verilemedi: ${r.errors.join(' · ')}`;
    askBtn.disabled = false;
  }
  askBtn.addEventListener('click', ask);
  question.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
  const qa = el('div', { className: 'qa' }, el('div', { className: 'qa-row' }, question, askBtn), answer);

  function setTeacher(t, nextTitle, note) {
    teacher = t;
    feedback.textContent = t.feedback;
    next.replaceChildren(el('strong', { textContent: 'Sonraki: ' }),
      `${nextTitle}, ${t.next_bpm} vuruş/dk. `, el('span', { className: 'muted', textContent: t.reason }));
    source.textContent = note;
  }

  return {
    clear() { container.replaceChildren(); container.hidden = true; },
    setTeacher,
    setQaEnabled(on) { qa.hidden = !on; },
    show({ result, teacher: t, nextTitle, note, labels, qaEnabled }) {
      const { summary, findings } = result;
      const ne = summary.not_evaluated;
      const neText = [['timing', 'zamanlama'], ['bow_dir', 'yay yönü'], ['bow_speed', 'yay hızı']]
        .filter(([k]) => ne[k] > 0).map(([k, w]) => `${w} ${ne[k]}`).join(' · ');
      setTeacher(t, nextTitle, note);
      answer.textContent = '';
      qa.hidden = !qaEnabled;
      container.hidden = false;
      container.replaceChildren(
        cardHead('Sonuç', el('div', { className: 'score' },
          el('span', { className: 'ok', textContent: `${summary.notes_clean} temiz` }),
          el('span', { className: summary.notes_with_error ? 'bad' : 'muted',
            textContent: `${summary.notes_with_error} hatalı` }),
          el('span', { className: 'muted', textContent: `/ ${summary.notes_played} nota` }))),
        el('div', { className: 'teacher' }, feedback, next, el('div', { className: 'row' }, applyBtn, source)),
        qa,
        el('h3', { textContent: 'Bulgular' }),
        findings.length
          ? el('ul', { className: 'findings' }, ...findings.map((f) => el('li', { className: `f-${f.type}` },
            el('span', { className: 'tag', textContent: labels[f.type] }), el('span', { textContent: f.fact }))))
          : el('p', { className: 'muted', textContent: 'Bulgu yok.' }),
        neText ? el('p', { className: 'muted small', textContent: `Değerlendirilemeyen ölçümler (nota): ${neText}` }) : null,
      );
    },
  };
}

// ---------------------------------------------------------------- Ayarlar

// Öğretmen ayarı: soru-cevap için yerel dil modeli.
export function renderTeacherSettings(container, { settings, onChange }) {
  const use = el('input', { type: 'checkbox', checked: settings.useModel });
  const name = el('input', { type: 'text', value: settings.model });
  const status = el('p', { className: 'muted small' });
  const changed = () => onChange({ useModel: use.checked, model: name.value.trim() });
  use.addEventListener('change', changed);
  name.addEventListener('change', changed);
  container.replaceChildren(
    cardHead('Öğretmen ayarı'),
    el('p', { className: 'muted small', textContent:
      'Öğretmen metnini kurallar yazar. Yerel dil modeli yalnızca soru-cevapta kullanılır.' }),
    el('label', { className: 'check' }, use, el('span', { textContent: 'Soru-cevap için yerel model' })),
    el('label', { className: 'field' }, el('span', { textContent: 'Model' }), name),
    status,
  );
  return { setStatus(text) { status.textContent = `Durum: ${text}`; } };
}

// ---------------------------------------------------------------- Öğretmen (Gemma)

// Çal ekranının üstünde: Bülbül, konuşma balonu (öğretmen metni ve yanıtlar), soru kutusu.
// bird: school.js createBird() nesnesi (döngüsel import olmasın diye dışarıdan verilir).
export function renderTutor(container, { onAsk, bird }) {
  const status = el('span', { className: 'chip' });
  const bubble = el('div', { className: 'bubble' });
  const question = el('input', { type: 'text', placeholder: 'Bülbül\'e sor… (ör. D5 hangi parmakla çalınır?)' });
  const askBtn = el('button', { className: 'primary', textContent: 'Sor' });
  async function ask() {
    const q = question.value.trim();
    if (!q) return;
    askBtn.disabled = true;
    bird.mood('think');
    bubble.textContent = 'Düşünüyorum…';
    const r = await onAsk(q);
    bubble.textContent = r.text ?? `Şu an yanıt veremedim: ${r.errors.join(' · ')}`;
    bird.speak(bubble.textContent);
    askBtn.disabled = false;
  }
  askBtn.addEventListener('click', ask);
  question.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
  const qa = el('div', { className: 'qa-row' }, question, askBtn);
  container.replaceChildren(
    el('div', { className: 'card-head' }, el('h2', { textContent: 'Bülbül' }), status),
    el('div', { className: 'tutor-row' }, bird.node, bubble),
    qa,
  );
  bubble.textContent = 'Bir şarkı seç ve "Denemeyi başlat"a bas. Bitince sana nasıl gittiğini anlatırım. Takılırsan bana sor!';
  return {
    setStatus({ model, ready, reason }) {
      status.textContent = ready ? `${model} · hazır` : `${model} · ${reason}`;
      status.classList.toggle('live', ready);
      qa.hidden = !ready;
    },
    setFeedback(text) { bubble.textContent = text; bird.speak(text); },
    cheer() { bird.cheer(); },
  };
}

// ---------------------------------------------------------------- Porte

// Sol anahtarlı porte: çalınan notalar soldan sağa, en yenisi sağda.
const STAFF = { w: 960, h: 190, top: 60, gap: 14, x0: 96, dx: 46 };
const LETTERS = 'CDEFGAB';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

// MIDI → portedeki basamak (E4 alt çizgi = 0) ve diyez.
export function staffStep(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { step: octave * 7 + LETTERS.indexOf(name[0]) - (4 * 7 + 2), sharp: name.length > 1 };
}

export function renderStaff(container) {
  const max = Math.floor((STAFF.w - STAFF.x0 - 20) / STAFF.dx);
  const notes = []; // { midi, string, finger, live }
  const root = svg('svg', { viewBox: `0 0 ${STAFF.w} ${STAFF.h}`, class: 'staff', role: 'img', 'aria-label': 'Çalınan notalar' });
  const empty = el('p', { className: 'muted small staff-empty', textContent: 'Henüz nota çalınmadı.' });
  container.replaceChildren(el('div', { className: 'card-head' }, el('h2', { textContent: 'Çaldığın notalar' })), root, empty);
  const bottom = STAFF.top + 4 * STAFF.gap;            // E4 çizgisi
  const y = (step) => bottom - step * (STAFF.gap / 2);

  function draw() {
    root.replaceChildren();
    for (let i = 0; i < 5; i++) {
      root.append(svg('line', { x1: 10, x2: STAFF.w - 10, y1: STAFF.top + i * STAFF.gap, y2: STAFF.top + i * STAFF.gap, class: 'staff-line' }));
    }
    root.append(svg('text', { x: 18, y: bottom + 17, class: 'clef' }, '𝄞'));
    notes.forEach((n, i) => {
      const x = STAFF.x0 + i * STAFF.dx;
      const { step, sharp } = staffStep(n.midi);
      const cls = n.live ? 'note live' : 'note';
      const g = svg('g', { class: cls });
      // Ek çizgiler: aşağıda C4 (−2) ve altı, yukarıda A5 (10) ve üstü
      for (let s = -2; s >= step; s -= 2) g.append(svg('line', { x1: x - 12, x2: x + 12, y1: y(s), y2: y(s), class: 'ledger' }));
      for (let s = 10; s <= step; s += 2) g.append(svg('line', { x1: x - 12, x2: x + 12, y1: y(s), y2: y(s), class: 'ledger' }));
      if (sharp) g.append(svg('text', { x: x - 20, y: y(step) + 5, class: 'accidental' }, '♯'));
      g.append(svg('ellipse', { cx: x, cy: y(step), rx: 7.5, ry: 5.5, transform: `rotate(-20 ${x} ${y(step)})` }));
      const up = step < 4; // B4 (orta çizgi) altındaki notaların sapı yukarı
      g.append(svg('line', { x1: up ? x + 7 : x - 7, x2: up ? x + 7 : x - 7, y1: y(step), y2: y(step) + (up ? -34 : 34), class: 'stem' }));
      g.append(svg('text', { x, y: STAFF.h - 22, class: 'note-name' }, midiName(n.midi)));
      g.append(svg('text', { x, y: STAFF.h - 6, class: 'note-pos' },
        `${STRING_NAMES[n.string]}${n.finger ? ` ${n.finger}` : ''}`));
      root.append(g);
    });
    empty.hidden = notes.length > 0;
  }
  draw();

  return {
    push(n) {
      notes.forEach((x) => { x.live = false; });
      notes.push({ ...n, live: true });
      while (notes.length > max) notes.shift();
      draw();
    },
    release() {
      if (notes.some((x) => x.live)) {
        notes.forEach((x) => { x.live = false; });
        draw();
      }
    },
    clear() { notes.length = 0; draw(); },
    get recent() { return notes.map((n) => midiName(n.midi)); },
  };
}

// ---------------------------------------------------------------- Parmak şeritleri

const STRIP_CM = ['3,5', '7', '8,5', '11'];

// Tanılama: hangi folyo LOW (bakır tel bastırılı ve sopa o telde) ve o anki parmak.
export function renderFingerPanel(container) {
  const current = el('div', { className: 'finger-now' });
  const strips = STRIP_CM.map((cm, i) => el('div', { className: 'strip' },
    el('strong', { textContent: `${i + 1}` }), el('small', { textContent: `${cm} cm` })));
  const info = el('p', { className: 'muted small' });
  container.replaceChildren(
    cardHead('Parmak şeritleri', current),
    el('div', { className: 'strip-row' }, ...strips),
    info,
  );
  return {
    update({ state }) {
      current.textContent = state.available ? FINGER_LABEL[state.finger] : '–';
      current.classList.toggle('on', state.finger > 0);
      // Değen folyolar soluk, geçerli parmak (en yüksek değen folyo) dolu renkte.
      strips.forEach((n, i) => {
        n.classList.toggle('on', ((state.fmask ?? 0) >> i) & 1);
        n.classList.toggle('active', state.finger === i + 1 && !!(((state.fmask ?? 0) >> i) & 1));
      });
      info.textContent = state.available
        ? 'Bakır teli bir folyoya bastırıp sopayla o tele değ. Tel aradaki folyolara da değebilir; geçerli olan en yüksek numaralı folyodur (dolu renkli kutu). Sopa telde değilken son parmak tutulur.'
        : 'Şerit verisi yok: kartta 0.10.0 ya da üstü firmware olmalı (ya da simülatörü başlat).';
    },
  };
}

// ---------------------------------------------------------------- Kaynak

// Kaynak paneli: kart, simülatör, kayıt oynatma; dokunulan teller; ham veri ayrıntısı.
export function renderRawPanel(container, h) {
  const serialBtn = el('button', { className: 'primary', textContent: 'Karta bağlan', disabled: !h.serialSupported });
  serialBtn.addEventListener('click', () => h.onSerialToggle());
  const serialInfo = el('p', { className: 'muted small' });
  const simBtn = el('button', { textContent: 'Simülatörü başlat' });
  simBtn.addEventListener('click', () => h.onSimToggle());
  const noise = el('input', { type: 'checkbox' });
  noise.addEventListener('change', () => h.onOption('contactNoise', noise.checked));
  const jitter = el('input', { type: 'checkbox' });
  jitter.addEventListener('change', () => h.onOption('speedJitter', jitter.checked));

  const fileInput = el('input', { type: 'file', accept: '.txt,text/plain', className: 'file' });
  const fileBtn = el('button', { textContent: 'Kayıt oynat…' });
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (file) h.onReplayFile(file.name, await file.text());
    fileInput.value = '';
  });
  const stopReplayBtn = el('button', { textContent: 'Oynatmayı durdur', hidden: true });
  stopReplayBtn.addEventListener('click', () => h.onReplayStop());

  const strings = STRING_NAMES.map((name) => el('span', { className: 'string', textContent: name }));
  const lastLine = el('code', { textContent: '–' });
  const dd = () => el('dd', { textContent: '–' });
  const rate = dd();
  const lines = dd();
  const accel = dd();
  const health = dd();
  const rec = dd();

  const downloadBtn = el('button', { textContent: 'Kaydı indir' });
  downloadBtn.addEventListener('click', () => h.onDownload());
  const clearBtn = el('button', { textContent: 'Temizle' });
  clearBtn.addEventListener('click', () => h.onClear());

  container.replaceChildren(
    cardHead('Kaynak'),
    el('div', { className: 'row' }, serialBtn),
    serialInfo,
    el('div', { className: 'row' }, simBtn, fileBtn, stopReplayBtn, fileInput),
    el('div', { className: 'row checks' },
      el('label', { className: 'check' }, noise, el('span', { textContent: 'temas gürültüsü' })),
      el('label', { className: 'check' }, jitter, el('span', { textContent: 'hız dalgalanması' }))),
    el('p', { className: 'muted small keys', innerHTML:
      'Simülatör: <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> Sol Re La Mi · '
      + '<kbd>→</kbd> çekerek · <kbd>←</kbd> iterek · <kbd>Shift</kbd> hızlı · '
      + '<kbd>1</kbd>–<kbd>4</kbd> parmak' }),
    el('div', { className: 'strings' }, ...strings),
    el('details', { className: 'raw' },
      el('summary', { textContent: 'Ham veri' }),
      el('dl', {},
        el('dt', { textContent: 'Satır hızı' }), rate,
        el('dt', { textContent: 'Satırlar' }), lines,
        el('dt', { textContent: 'İvme' }), accel,
        el('dt', { textContent: 'H' }), health,
        el('dt', { textContent: 'Kayıt' }), rec),
      el('p', { className: 'small' }, 'Son satır: ', lastLine),
      el('div', { className: 'row' }, downloadBtn, clearBtn)),
  );

  return {
    update(s) {
      simBtn.textContent = s.simRunning ? 'Simülatörü durdur' : 'Simülatörü başlat';
      simBtn.classList.toggle('active', s.simRunning);
      if (h.serialSupported) {
        serialBtn.textContent = s.serial.connected ? 'Bağlantıyı kes' : 'Karta bağlan';
        serialBtn.classList.toggle('primary', !s.serial.connected);
        const id = s.serial.info?.usbVendorId
          ? ` (USB ${s.serial.info.usbVendorId.toString(16)}:${s.serial.info.usbProductId.toString(16)})` : '';
        const kb = `${(s.serial.bytes / 1024).toFixed(1)} kB, ${s.serial.lines} satır alındı`;
        serialInfo.textContent = s.serial.connected
          ? (s.serial.data ? `Kart bağlı${id}; veri geliyor (${kb}).`
            : s.serial.silent ? `Port açık${id} ama satır gelmiyor (${kb}). Kartta yay.ino çalışıyor mu? `
              + 'Başka bir program (live.sh, PlatformIO, live.py) portu açık tutuyor olabilir.'
              : `Port açık${id}; veri bekleniyor… (${kb})`)
          : s.serial.state === 'closed' && s.serial.reason ? `Bağlantı kapandı: ${s.serial.reason}.`
          : s.serial.state === 'lost' ? 'Kart çıkarıldı.'
            : s.serial.state === 'error' ? `Hata: ${s.serial.message}`
              : 'ESP32-S3 kartını USB ile tak, sonra bağlan.';
      } else {
        serialInfo.textContent = 'Bu tarayıcı karta bağlanamaz (Web Serial yok). Kart için Chrome ya da Edge kullan.';
      }
      serialInfo.classList.toggle('error', !!(s.serial.silent || s.serial.state === 'error'));
      fileBtn.hidden = !!s.replay;
      stopReplayBtn.hidden = !s.replay;
      strings.forEach((node, i) => node.classList.toggle('on', ((s.mask ?? 0) >> i) & 1));
      lastLine.textContent = s.lastLine || '–';
      rate.textContent = `${s.rate.toFixed(0)}/sn`;
      lines.textContent = `S ${s.stats.s} · H ${s.stats.h} · bozuk ${s.stats.bad} · diğer ${s.stats.other}`;
      accel.textContent = s.acc
        ? `${s.acc[0].toFixed(2)} · ${s.acc[1].toFixed(2)} · ${s.acc[2].toFixed(2)} m/s²` : '–';
      health.textContent = s.health
        ? `fw ${s.health.fw} · imu_ok ${s.health.imu_ok ? 1 : 0} · i2c_err ${s.health.i2c_err}` : '–';
      rec.textContent = s.replay
        ? `oynatılıyor: ${s.replay.name} (%${Math.round(s.replay.progress * 100)})`
        : `${s.recCount} satır (${(s.recCount / 200).toFixed(1)} sn)`;
    },
  };
}

// ---------------------------------------------------------------- Geliştirici: ses testi

export function renderAudioPanel(container, h) {
  const startBtn = el('button', { textContent: 'Sesi başlat' });
  const controls = el('div', { className: 'controls', hidden: true });

  const noteBtns = h.notes.map(({ label, midi }) => {
    const b = el('button', { textContent: label });
    b.addEventListener('click', () => h.onNote(midi));
    return b;
  });
  const offBtn = el('button', { textContent: 'Bitir' });
  offBtn.addEventListener('click', h.onNoteOff);

  const slider = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0 });
  const speedInfo = el('span', { className: 'muted small' });
  slider.addEventListener('input', () => { speedInfo.textContent = h.onSpeed(Number(slider.value)); });
  speedInfo.textContent = h.onSpeed(0);

  const bpmInput = el('input', { type: 'number', min: 40, max: 120, value: 60 });
  const metroBtn = el('button', { textContent: 'Metronom başlat' });
  const beatInfo = el('span', { className: 'beat muted', textContent: 'vuruş: 0' });
  let running = false;
  metroBtn.addEventListener('click', () => {
    running = !running;
    metroBtn.textContent = running ? 'Metronom durdur' : 'Metronom başlat';
    if (running) h.onMetronomeStart(Number(bpmInput.value));
    else h.onMetronomeStop();
  });

  const latencyInfo = el('span', { className: 'muted small' });
  const latencyBtn = el('button', { textContent: 'Gecikmeyi oku' });
  latencyBtn.addEventListener('click', () => { latencyInfo.textContent = h.onLatency(); });

  controls.append(
    el('div', { className: 'row' }, ...noteBtns, offBtn),
    el('div', { className: 'row' }, el('span', { textContent: 'Yay hızı' }), slider, speedInfo),
    el('div', { className: 'row' }, el('span', { textContent: 'Tempo' }), bpmInput, metroBtn, beatInfo),
    el('div', { className: 'row' }, latencyBtn, latencyInfo),
  );

  startBtn.addEventListener('click', async () => {
    await h.onStart();
    startBtn.hidden = true;
    controls.hidden = false;
    latencyInfo.textContent = h.onLatency();
  });

  container.replaceChildren(cardHead('Ses testi'), startBtn, controls);

  return {
    showBeat(beat, elapsedS) {
      beatInfo.textContent = `vuruş: ${beat.n + 1} · ${elapsedS.toFixed(1)} sn`;
      beatInfo.classList.toggle('accent', beat.accent);
    },
  };
}

// ---------------------------------------------------------------- Geliştirici: hareket

// Hareket paneli: son 5 sn'nin hız grafiği ve çekiş olayları.
const PLOT_SAMPLES = 1000; // 5 sn
const PLOT_V_MAX = 0.8;    // m/s, dikey eksen ±

export function renderMotionPanel(container) {
  const canvas = el('canvas', { className: 'plot', height: 180 });
  const counts = el('p', { className: 'muted small' });
  const log = el('ol', { className: 'log' });
  container.replaceChildren(
    cardHead('Hareket ve çekişler'),
    el('p', { className: 'muted small', textContent:
      'Çizgi: hız kestirimi (artı = çekerek). Gri: durağan. Alt şerit: temas. '
      + 'Yeşil: çekiş başladı, koyu: bitti, kırmızı: iptal.' }),
    canvas, counts, log,
  );

  const samples = [];
  const marks = []; // { t, kind }
  const n = { start: 0, confirmed: 0, cancelled: 0 };
  let speed = null;
  let dirty = true;

  function pushSample(s) {
    samples.push({ t: s.t, v: s.v ?? 0, still: s.still, mask: s.mask });
    if (samples.length > PLOT_SAMPLES) samples.shift();
    dirty = true;
  }

  function pushEvent(e) {
    if (e.type === 'stroke_update') { speed = e.speed; return; }
    if (e.type === 'stroke_start') {
      n.start += 1;
      marks.push({ t: e.t, kind: 'start' });
    } else if (e.type === 'stroke_end') {
      speed = null;
      if (e.confirmed) n.confirmed += 1; else n.cancelled += 1;
      marks.push({ t: e.t, kind: e.confirmed ? 'end' : 'cancel' });
      const dir = e.dir ? `${BOW_ARROW[e.dir]} ${e.dir_conf.toFixed(2)}` : 'yön ?';
      const rms = e.accel_rms === null ? '–' : e.accel_rms.toFixed(2);
      log.prepend(el('li', { className: e.confirmed ? '' : 'cancelled', textContent:
        `#${e.id} ${STRING_NAMES[e.string] ?? ''} ${e.dur_ms} ms · ${e.cause} · ${dir}`
        + ` · rms ${rms} · boşluk ${e.gap_count}/${e.max_gap_ms} ms`
        + ` · diğer [${e.other_ms.join(',')}]${e.confirmed ? '' : ' · İPTAL'}` }));
      while (log.children.length > 8) log.lastChild.remove();
    }
    while (marks.length && samples.length && marks[0].t < samples[0].t) marks.shift();
    dirty = true;
  }

  function draw() {
    counts.textContent = `stroke_start ${n.start} · kesinleşen ${n.confirmed} · iptal ${n.cancelled}`
      + (speed === null ? '' : ` · şu an ${speed.toFixed(2)} m/s`);
    if (!dirty || !samples.length || !canvas.clientWidth) return; // kapalı panelde çizme
    dirty = false;
    const css = getComputedStyle(document.documentElement);
    const color = (name) => css.getPropertyValue(name).trim();
    const fg = color('--fg');
    const muted = color('--muted');
    const stringColors = [0, 1, 2, 3].map((i) => color(`--s${i}`));
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 180;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const t0 = samples[samples.length - 1].t - PLOT_SAMPLES * 5;
    const x = (t) => ((t - t0) / (PLOT_SAMPLES * 5)) * w;
    const plotH = h - 14;
    const y = (v) => plotH / 2 - (Math.max(-PLOT_V_MAX, Math.min(PLOT_V_MAX, v)) / PLOT_V_MAX) * (plotH / 2);

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = muted;
    for (const s of samples) if (s.still) ctx.fillRect(x(s.t), 0, Math.max(1, x(s.t + 5) - x(s.t)), plotH);
    ctx.globalAlpha = 1;
    for (const s of samples) {
      for (let i = 0; i < 4; i++) {
        if (s.mask & (1 << i)) {
          ctx.fillStyle = stringColors[i];
          ctx.fillRect(x(s.t), plotH + 3 + i * 2.5, Math.max(1, x(s.t + 5) - x(s.t)), 2.5);
        }
      }
    }
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    ctx.lineTo(w, y(0));
    ctx.stroke();
    for (const m of marks) {
      ctx.strokeStyle = m.kind === 'start' ? color('--ok') : m.kind === 'end' ? fg : color('--err');
      ctx.setLineDash(m.kind === 'cancel' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x(m.t), 0);
      ctx.lineTo(x(m.t), plotH);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = color('--accent');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.v)) : ctx.moveTo(x(s.t), y(s.v))));
    ctx.stroke();
  }

  function clear() {
    samples.length = 0;
    marks.length = 0;
    Object.assign(n, { start: 0, confirmed: 0, cancelled: 0 });
    speed = null;
    log.replaceChildren();
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  return { pushSample, pushEvent, draw, clear, markDirty() { dirty = true; } };
}

export function renderError(container, message) {
  container.replaceChildren(el('p', { className: 'error', textContent: message }));
}
