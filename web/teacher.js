// Öğretmen: şablon öğretmen ve yerel dil modeli (Ollama). Model hata tespit etmez.
//
// Uygulamada öğretmen metnini her zaman şablon yazar; model yalnızca soru-cevapta
// kullanılır (askQuestion). askModel (metni modele yazdırma) değerlendirme aracı
// tools/teacher_eval.mjs için durur: gemma3:4b'de sayı/anlam hataları ve 10 sn'yi aşan
// yanıtlar görüldü (plan, Risk 3). Daha güçlü bir model denenirse buradan açılır.
//
// Saf modül: geçmiş (localStorage) main.js'den gelir; fetch parametre olarak verilebilir.
//
// Çıktı (model ve şablon aynı biçim):
//   { feedback, focus_finding, next_exercise_id, next_bpm, reason }

export const BPM_MIN = 40;
export const BPM_MAX = 120;

// Her hata türü için ipuçları. İlki şablon öğretmende gösterilir.
export const TIPS = {
  wrong_string: [
    'Çekmeden önce sopanın açısını beklenen tele göre ayarla; ekrandaki mavi teli kontrol et.',
    'Tel değiştireceğin notayı önceden gör ve bir önceki notanın sonunda yeni tele hazırlan.',
  ],
  neighbor_touch: [
    'Tel değiştirmeden önce sopanın açısını yeni tele göre ayarla, sonra çek.',
    'Sopayı çaldığın telin iki komşusuna eşit uzaklıkta tut.',
  ],
  late: [
    'Metronomla birlikte içinden say; tel değişimini bir önceki vuruşta hazırla.',
    'Notayı metronomun tıkırtısıyla aynı anda başlat; tıkırtıyı duyup sonra başlama.',
  ],
  early: [
    'Metronomun tıkırtısını bekle; yayı tıkırtıyla birlikte başlat.',
    'Uzun notalarda yayın sonuna kadar sabırla git; notayı kısa kesme.',
  ],
  wrong_bow_dir: [
    'Her notadan önce ekrandaki oka bak: aşağı ok çekerek, yukarı ok iterek.',
    'Yön her notada değişir; bir notayı yanlış yönde çaldıysan bir sonrakini yine sıraya göre çal.',
  ],
  uneven_speed: [
    'Yayı vuruşlara eşit böl: her vuruşta aynı uzunlukta yol al.',
    'Yay boyunca hızı sabit tut; ortada hızlanıp sonda yavaşlama.',
  ],
};

const clampBpm = (b) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(b)));

// Geçmiş: [{ exercise_id, bpm, notes_with_error, notes_played, at }], en yeni sonda.
export function previousAttempt(history, exerciseId) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].exercise_id === exerciseId) return history[i];
  }
  return null;
}

export function attemptNo(history, exerciseId) {
  return history.filter((h) => h.exercise_id === exerciseId).length + 1;
}

const errorRatio = (a) => (a.notes_played ? a.notes_with_error / a.notes_played : 0);

// Modele sunulacak seçenekler (plan: "Seçenekleri kod hazırlar"): aynı egzersiz, en sık
// iki bulgunun türünü hedefleyen birer egzersiz ve bir üst seviyeden bir egzersiz.
export function nextOptions(exercise, findings, exercises, bpm) {
  const out = [exercise];
  const add = (ex) => { if (ex && !out.some((o) => o.id === ex.id)) out.push(ex); };
  for (const f of findings.slice(0, 2)) {
    add(exercises.find((e) => e.id !== exercise.id && e.targets.includes(f.type)));
  }
  add(levelUp(exercise, findings, exercises));
  return {
    exercises: out.map(({ id, title, targets }) => ({ id, title, targets })),
    bpm_min: clampBpm(bpm - 12),
    bpm_max: clampBpm(bpm + 6),
  };
}

// Bir üst seviyeden egzersiz; varsa en sık bulgunun türünü hedefleyen tercih edilir.
export function levelUp(exercise, findings, exercises) {
  const higher = exercises.filter((e) => e.level > exercise.level);
  if (!higher.length) return null;
  const level = Math.min(...higher.map((e) => e.level));
  const candidates = higher.filter((e) => e.level === level);
  const top = findings[0]?.type;
  return candidates.find((e) => top && e.targets.includes(top)) ?? candidates[0];
}

// Şablon öğretmen (plan: "Şablon öğretmen" tablosu).
export function templateTeacher({ result, exercise, exercises, bpm, history }) {
  const { summary, findings } = result;
  const focus = findings[0] ?? null;
  const ratio = errorRatio(summary);
  const pct = Math.round(ratio * 100);

  const feedback = focus
    ? `${focus.fact} ${TIPS[focus.type][0]}`
    : `Hata bulunmadı: ${summary.notes_played} notanın hepsi temizdi.`;

  let next = { id: exercise.id, bpm };
  let reason;
  if (ratio > 0.3) {
    next.bpm = clampBpm(bpm - 8);
    reason = `Hatalı nota oranı %${pct}; aynı egzersizi daha yavaş tekrarlıyoruz.`;
  } else if (ratio >= 0.1) {
    reason = `Hatalı nota oranı %${pct}; aynı egzersizi aynı tempoda tekrarlıyoruz.`;
  } else {
    const prev = previousAttempt(history, exercise.id);
    const up = prev && errorRatio(prev) < 0.1 ? levelUp(exercise, findings, exercises) : null;
    if (up) {
      next = { id: up.id, bpm: clampBpm(up.bpm) };
      reason = 'Bu egzersizde art arda iki kez %10\'un altında kaldın; bir üst seviyeye geçiyoruz.';
    } else {
      next.bpm = clampBpm(bpm + 6);
      reason = `Hatalı nota oranı %${pct}; tempoyu artırıyoruz.`;
    }
  }

  return {
    feedback,
    focus_finding: focus?.id ?? null,
    next_exercise_id: next.id,
    next_bpm: next.bpm,
    reason,
    source: 'template',
  };
}

// ---------------------------------------------------------------- Dil modeli

export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_MODEL = 'gemma3:4b';
export const MODEL_TIMEOUT_MS = 30000; // ilk çağrıda model diskten yüklenir
export const FEEDBACK_MAX_CHARS = 600;
// Bu alet bunları ölçmez; metinde geçerse çıktı reddedilir.
export const UNMEASURED_WORDS = ['entonasyon', 'akort', 'vibrato'];

export const SYSTEM_PROMPT = `Sen sabırlı bir keman öğretmenisin. Alet doğru teli, sol eldeki parmağın hangi
şeride bastığını, doğru zamanı, doğru yay yönünü ve düzgün yay hızını ölçer.

Her denemeden sonra sana bir JSON verilir. İçindeki "findings" listesi, ölçümlerden
kurallarla çıkarılmış hataların tamamıdır. Senin işin hata bulmak değil, bu listeyi
öğrenciye anlatmaktır.

Kurallar:
1. Yalnızca "findings" içindeki hatalardan söz et. Listede olmayan bir hata, nota
   numarası ya da sayı yazma. Liste boşsa hata bulunmadığını söyle.
2. Ölçülmeyen konularda yorum yapma: entonasyon (parmağın şerit üstündeki tam yeri), akort,
   vibrato, ses tonu, duruş, yay tutuşu.
3. "not_evaluated" altındaki ölçümler güvenilir alınamadı. Onlar hakkında iyi ya da
   kötü hüküm verme.
4. Tek bir bulguya odaklan ve kimliğini "focus_finding" alanına yaz. İstersen bir
   bulguya daha tek cümleyle değin.
5. Düzeltme önerisini yalnızca odak bulgunun "tips" alanından al; kendi tekniğini
   uydurma.
6. "feedback" 2-4 cümle olsun: önce "summary" içinden iyi giden bir şey, sonra odak
   bulgu, sonra ipucu.
7. Sonraki egzersizi yalnızca "next_options.exercises" içinden, tempoyu yalnızca
   "bpm_min" ile "bpm_max" arasından seç. Hatalı nota çoksa tempoyu düşür; hiç yoksa
   aynı tut ya da artır.
8. Öğrenciye "sen" diye hitap et ve sade Türkçe kullan. Tel adları Sol, Re, La, Mi;
   yay yönleri çekerek ve iterek.
9. Yanıtın yalnızca istenen JSON olsun.`;

// "ölçmüyor", "ölçemiyorum", "değerlendiremedim", "yapmıyor" …
const NOT_MEASURED_RE = /ölçm[üu]yor|ölçemi|ölçmez|ölçmedi|değerlendirem|değerlendirmiyor|değerlendirmedi|yapmıyor/;

export const QA_PROMPT = `Sen sabırlı bir keman öğretmenisin. Sana öğrencinin son çalışmasının JSON'u
verilir; içinde tel ve parmak tablosu da vardır. Öğrencinin sorusunu yalnızca bunlara dayanarak
yanıtla. Nota = telin boş sesi + parmağın yarım sesi; hangi notanın hangi tel ve parmakla
çalındığını tablodan bul. Nasıl çalışılacağı sorulursa yalnızca "ipuclari" içindeki önerileri
kullan; kendi tekniğini uydurma. Öğrencinin çalmadığı şeyi çalmış gibi anlatma. Bu alet teli, sol eldeki parmağın hangi şeride bastığını, zamanlamayı,
yay yönünü ve yay hızının düzgünlüğünü ölçer; ölçmediği bir şey (entonasyon, akort, vibrato,
ses tonu, duruş) sorulursa bu aletin onu ölçmediğini söyle. JSON'da olmayan bir sayı yazma. JSON'dan ve alan adlarından
(notes_clean, summary gibi) söz etme. En çok 4 cümle yaz; sade Türkçe kullan ve öğrenciye
"sen" diye hitap et.`;

// Plandaki "Modele giden JSON".
export function buildModelInput({ exercise, bpm, noteCount, attemptNo: no, result, previous, options }) {
  const { summary, findings } = result;
  return {
    session: { exercise_id: exercise.id, title: exercise.title, bpm, note_count: noteCount, attempt_no: no },
    summary: {
      notes_clean: summary.notes_clean,
      notes_with_error: summary.notes_with_error,
      counts: summary.counts,
      not_evaluated: summary.not_evaluated,
    },
    findings: findings.slice(0, 6).map((f) => {
      const out = { id: f.id, type: f.type, count: f.count, notes: f.notes };
      if (f.avg_ms !== undefined) out.avg_ms = f.avg_ms;
      if (f.avg !== undefined) out.avg = f.avg;
      out.at_string_change = f.at_string_change;
      out.fact = f.fact;
      out.tips = TIPS[f.type];
      return out;
    }),
    previous: previous ? { bpm: previous.bpm, notes_with_error: previous.notes_with_error } : null,
    next_options: options,
  };
}

// Girdiye göre daraltılmış çıktı şeması: kimlikler ve egzersizler enum olarak verilir.
export function outputSchema(input) {
  return {
    type: 'object',
    properties: {
      feedback: { type: 'string' },
      focus_finding: { enum: [...input.findings.map((f) => f.id), null] },
      next_exercise_id: { enum: input.next_options.exercises.map((e) => e.id) },
      next_bpm: { type: 'integer', minimum: input.next_options.bpm_min, maximum: input.next_options.bpm_max },
      reason: { type: 'string' },
    },
    required: ['feedback', 'focus_finding', 'next_exercise_id', 'next_bpm', 'reason'],
  };
}

// Metindeki sayılar: "130", "0,9", "3." → [130, 0.9, 3]
export function numbersIn(text) {
  return (String(text).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
}

// Girdi JSON'unda geçen bütün sayılar (olgu cümlelerinin içindekiler dahil).
function inputNumbers(input) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'number') out.add(v);
    else if (typeof v === 'string') numbersIn(v).forEach((n) => out.add(n));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return out;
}

const lower = (s) => s.toLocaleLowerCase('tr');

// Denemede hiç görülmeyen hata türlerinin anahtar kelimeleri. Olumsuz olmayan bir
// cümlede geçerse metin, olmayan bir hatadan söz ediyor demektir.
export const CLAIM_WORDS = {
  wrong_string: ['yanlış tel'],
  neighbor_touch: ['komşu tel'],
  late: ['geç gir', 'geç kal', 'gecikme', 'geciktin'],
  early: ['erken'],
  wrong_bow_dir: ['ters yön', 'yönün kay', 'yönü yanlış', 'yönünü yanlış', 'ters yay'],
  uneven_speed: ['düzensiz'],
};
// "hiç", "yok", "değil", olumsuz fiil ekleri: gitmedin, yapmadın, kalmıyor …
const NEGATION_RE = /\bhiç\b|\byok\b|değil|m[ae]d[iı]|m[ıiuü]yor|m[ae]z\b|m[ae]m[ıi]ş/;

// Kelime bir sözcüğün başında mı? "geçerken" içindeki "erken" sayılmaz. (\b, ç/ş/ğ
// gibi harfleri sözcük karakteri saymadığı için Unicode harf sınıfı kullanılır.)
const startsWord = (sentence, word) => new RegExp(`(?<!\\p{L})${word}`, 'u').test(sentence);

export function checkClaims(text, input, question = '') {
  const counts = input.summary?.counts ?? {};
  const asked = lower(question);
  const errors = [];
  for (const sentence of lower(text).split(/(?<=[.!?])\s+/)) {
    if (NEGATION_RE.test(sentence)) continue;
    for (const [type, words] of Object.entries(CLAIM_WORDS)) {
      if (counts[type] > 0) continue;
      const w = words.find((x) => startsWord(sentence, x) && !asked.includes(x));
      if (w) errors.push(`bulguda olmayan hata: "${w}"`);
    }
  }
  return [...new Set(errors)];
}

// Serbest metin denetimi (öğretmen metni ve soru-cevap için ortak): 4. ve 5. madde.
export function checkText(text, allowedNumbers, maxChars = FEEDBACK_MAX_CHARS) {
  const errors = [];
  if (text.length > maxChars) errors.push(`metin ${text.length} karakter (en çok ${maxChars})`);
  const bad = numbersIn(text).filter((n) => !allowedNumbers.has(n));
  if (bad.length) errors.push(`girdide olmayan sayı: ${bad.join(', ')}`);
  const words = UNMEASURED_WORDS.filter((w) => lower(text).includes(w));
  if (words.length) errors.push(`ölçülmeyen konu: ${words.join(', ')}`);
  // İç ayrıntı: alan adları (notes_clean) ya da "JSON" öğrenciye gösterilmez.
  const internal = text.match(/\b[a-z]+_[a-z_]+\b|\bJSON\b/g);
  if (internal) errors.push(`iç alan adı: ${[...new Set(internal)].join(', ')}`);
  return errors;
}

// Plandaki beş denetim. { ok, errors }
export function validateOutput(out, input) {
  const errors = [];
  // 1. Şema
  if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, errors: ['JSON nesnesi değil'] };
  for (const k of ['feedback', 'reason']) {
    if (typeof out[k] !== 'string' || !out[k].trim()) errors.push(`${k} boş ya da metin değil`);
  }
  if (!Number.isInteger(out.next_bpm)) errors.push('next_bpm tamsayı değil');
  if (errors.length) return { ok: false, errors };
  // 2. Odak bulgu
  const ids = input.findings.map((f) => f.id);
  if (ids.length ? !ids.includes(out.focus_finding) : out.focus_finding !== null) {
    errors.push(`focus_finding geçersiz: ${out.focus_finding}`);
  }
  // 3. Egzersiz ve tempo
  const opts = input.next_options;
  if (!opts.exercises.some((e) => e.id === out.next_exercise_id)) {
    errors.push(`next_exercise_id seçeneklerde yok: ${out.next_exercise_id}`);
  }
  if (out.next_bpm < opts.bpm_min || out.next_bpm > opts.bpm_max) {
    errors.push(`next_bpm aralık dışında: ${out.next_bpm}`);
  }
  // 4–5. Sayılar, uzunluk, ölçülmeyen konular
  const allowed = inputNumbers(input);
  allowed.add(out.next_bpm);
  errors.push(...checkText(out.feedback, allowed));
  errors.push(...checkClaims(out.feedback, input));
  return { ok: errors.length === 0, errors };
}

// Plandaki örnek girdi ve çıktı; küçük modellere biçim ve ton için bir kez gösterilir.
export const EXAMPLE_INPUT = {
  session: { exercise_id: 'gecis_komsu', title: 'Komşu tel geçişleri', bpm: 60, note_count: 16, attempt_no: 3 },
  summary: {
    notes_clean: 11, notes_with_error: 5,
    counts: { wrong_string: 0, neighbor_touch: 4, early: 0, late: 3, wrong_bow_dir: 0, uneven_speed: 1 },
    not_evaluated: { timing: 0, bow_dir: 1, bow_speed: 0 },
  },
  findings: [
    { id: 'F1', type: 'neighbor_touch', count: 4, notes: [3, 7, 11, 15], avg_ms: 35, at_string_change: 4,
      fact: '4 notada (3, 7, 11, 15) La telini çalarken Re teline de değdin; ortalama 35 ms. Hepsi tel değiştirdiğin notalar.',
      tips: ['Tel değiştirmeden önce sopanın açısını yeni tele göre ayarla, sonra çek.'] },
    { id: 'F2', type: 'late', count: 3, notes: [3, 7, 11], avg_ms: 130, at_string_change: 3,
      fact: '3 notada (3, 7, 11) geç girdin; ortalama 130 ms. Hepsi tel değiştirdiğin notalar.',
      tips: ['Metronomla birlikte içinden say; tel değişimini bir önceki vuruşta hazırla.'] },
  ],
  previous: { bpm: 60, notes_with_error: 8 },
  next_options: {
    exercises: [
      { id: 'gecis_komsu', title: 'Komşu tel geçişleri', targets: ['wrong_string', 'neighbor_touch'] },
      { id: 'acik_dortluk', title: 'Tek telde dörtlük notalar', targets: ['early', 'late', 'wrong_bow_dir'] },
    ],
    bpm_min: 48, bpm_max: 66,
  },
};
export const EXAMPLE_OUTPUT = {
  feedback: "16 notanın 11'i temizdi ve hiç yanlış tele gitmedin. En çok Re telinden La teline geçerken zorlandın: 3, 7, 11 ve 15. notalarda La telini çalarken Re teline de değdin. Tel değiştirmeden önce sopanın açısını yeni tele göre ayarla, sonra çek. Aynı geçişlerde biraz geç de kaldın; daha yavaş tempoda ikisi birlikte düzelir.",
  focus_finding: 'F1',
  next_exercise_id: 'gecis_komsu',
  next_bpm: 52,
  reason: 'Hatalar tel geçişlerinde toplandığı için aynı egzersizi daha yavaş tekrarlıyoruz.',
};

async function ollamaChat({ model, system, user, format, fetchImpl, timeoutMs, examples = [] }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          ...examples.flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]),
          { role: 'user', content: user },
        ],
        ...(format ? { format } : {}),
        stream: false,
        think: false,
        options: { temperature: 0, num_ctx: 4096 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    return body.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// Modelden öğretmen çıktısı ister; doğrulamadan geçmezse bir kez yineler.
// Döner: { output | null, attempts: [{ ms, errors, raw }], error? }
export async function askModel(input, {
  model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, timeoutMs = MODEL_TIMEOUT_MS, now = () => Date.now(),
  oneShot = true,
} = {}) {
  const examples = oneShot ? [[JSON.stringify(EXAMPLE_INPUT), JSON.stringify(EXAMPLE_OUTPUT)]] : [];
  const schema = outputSchema(input);
  const system = `${SYSTEM_PROMPT}\n\nYanıtın şu JSON şemasına uymalı:\n${JSON.stringify(schema)}`;
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    const t0 = now();
    let raw = '';
    try {
      raw = await ollamaChat({ model, system, user: JSON.stringify(input), format: schema, fetchImpl, timeoutMs, examples });
      let out;
      try { out = JSON.parse(raw); } catch { out = null; }
      const v = out ? validateOutput(out, input) : { ok: false, errors: ['JSON ayrıştırılamadı'] };
      attempts.push({ ms: now() - t0, errors: v.errors, raw });
      if (v.ok) return { output: { ...out, source: 'model', model }, attempts };
    } catch (e) {
      // Bağlantı hatası ya da zaman aşımı: yinelemek anlamsız, şablona dön.
      attempts.push({ ms: now() - t0, errors: [e.name === 'AbortError' ? 'zaman aşımı' : e.message], raw });
      return { output: null, attempts, error: attempts.at(-1).errors[0] };
    }
  }
  return { output: null, attempts, error: 'doğrulama iki kez başarısız' };
}

// Soru-cevap bağlamında ipuçları Türkçe başlıklarla verilir; model iç adları yazmasın.
const TIPS_TR = {
  'yanlış tel': TIPS.wrong_string, 'komşu tele değme': TIPS.neighbor_touch, 'geç giriş': TIPS.late,
  'erken giriş': TIPS.early, 'ters yay yönü': TIPS.wrong_bow_dir, 'düzensiz yay hızı': TIPS.uneven_speed,
};

// Soru-cevap bağlamına eklenen tel ve parmak tablosu (birinci pozisyon, dört şerit).
export const FINGER_TABLE = {
  teller: { Sol: 'G3', Re: 'D4', La: 'A4', Mi: 'E5' },
  parmak_yarim_ses: { bos: 0, '1. parmak': 2, '2. parmak': 4, '3. parmak': 5, '4. parmak': 7 },
  notalar: {
    Sol: ['G3', 'A3', 'B3', 'C4', 'D4'], Re: ['D4', 'E4', 'F#4', 'G4', 'A4'],
    La: ['A4', 'B4', 'C#5', 'D5', 'E5'], Mi: ['E5', 'F#5', 'G#5', 'A5', 'B5'],
  },
  not: 'notalar listesinde sıra: boş tel, 1., 2., 3., 4. parmak',
};

// Tel ve parmak soruları tablodan, kodla yanıtlanır (küçük model burada yanılıyordu):
//   "C#5 hangi tel ve parmakla?"     → nota adından konum(lar)
//   "Sol telinde 3. parmak hangi nota?" / "La teli boş" → konumdan nota
// Eşleşmezse null döner ve soru modele gider.
const STRING_ORDER = ['Sol', 'Re', 'La', 'Mi'];
const FINGER_WORD = ['boş tel', '1. parmak', '2. parmak', '3. parmak', '4. parmak'];
export function answerFingering(question) {
  const q = question.replace(/İ/g, 'i');
  const pos = /\b(Sol|Re|La|Mi)\s+tel\S*\s*(?:(?:de|da)\s+)?(?:([1-4])\s*\.?\s*parmak|boş)/i.exec(q);
  if (pos) {
    const string = STRING_ORDER.find((x) => x.toLowerCase() === pos[1].toLowerCase());
    const finger = pos[2] ? Number(pos[2]) : 0;
    const note = FINGER_TABLE.notalar[string][finger];
    return `${string} telinde ${FINGER_WORD[finger]}: ${note}.`;
  }
  const m = /\b([A-G])(#|♯)?([3-6])\b/.exec(question);
  if (m) {
    const note = `${m[1]}${m[2] ? '#' : ''}${m[3]}`;
    const where = STRING_ORDER.flatMap((string) => {
      const f = FINGER_TABLE.notalar[string].indexOf(note);
      return f < 0 ? [] : [`${string} telinde ${FINGER_WORD[f]}`];
    });
    if (!where.length) return `${note} dört şeritle çalınamıyor; şeritler her telde boş, 2, 4, 5 ve 7 yarım ses veriyor.`;
    // En tiz tel (en küçük parmak) önce: birinci pozisyonda olağan konum
    where.reverse();
    return where.length === 1 ? `${note}: ${where[0]}.` : `${note}: ${where[0]}. Öteki yol: ${where.slice(1).join(', ')}.`;
  }
  return null;
}

// Ölçülmeyen bir konu soruluyorsa yanıt sabittir; model burada "daha fazla bilgi gerek" gibi
// belirsiz yanıtlar veriyordu.
const UNMEASURED_TOPICS = [
  ['entonasyon', 'entonasyonu (parmağın şerit üstündeki tam yerini)'], ['akort', 'akordu'], ['akord', 'akordu'],
  ['vibrato', 'vibratoyu'], ['ses ton', 'ses tonunu'], ['tını', 'tınıyı'], ['duruş', 'duruşu'],
];
export function answerUnmeasured(question) {
  const q = lower(question);
  const hit = UNMEASURED_TOPICS.find(([w]) => q.includes(w));
  if (!hit) return null;
  return `Bu alet ${hit[1]} ölçmüyor. Ölçtükleri: hangi tele çaldığın, hangi parmak şeridine bastığın, `
    + 'zamanlaman, yay yönün ve yay hızının düzgünlüğü.';
}

// Soru-cevap: serbest metin, en çok 4 cümle; sayı ve kelime denetimi uygulanır.
export const QA_TIMEOUT_MS = 60000; // ilk soruda model belleğe yüklenir
export async function askQuestion(question, context, {
  model = DEFAULT_MODEL, fetchImpl = globalThis.fetch, timeoutMs = QA_TIMEOUT_MS,
} = {}) {
  const ruled = answerFingering(question) ?? answerUnmeasured(question);
  if (ruled) return { text: ruled, errors: [], source: 'tablo' };
  context = { ...context, tel_parmak_tablosu: FINGER_TABLE, ipuclari: TIPS_TR };
  const user = `Son çalışma:\n${JSON.stringify(context)}\n\nÖğrencinin sorusu: ${question}`;
  const allowed = inputNumbers(context);
  numbersIn(question).forEach((n) => allowed.add(n));
  const askedUnmeasured = UNMEASURED_WORDS.some((w) => lower(question).includes(w));
  let last = null;
  for (let i = 0; i < 2; i++) { // denetimden geçmezse bir kez yinelenir
    let text;
    try {
      text = (await ollamaChat({ model, system: QA_PROMPT, user, fetchImpl, timeoutMs })).trim();
    } catch (e) {
      return { text: null, errors: [e.name === 'AbortError' ? 'zaman aşımı' : e.message] };
    }
    const errors = [...checkText(text, allowed), ...checkClaims(text, context, question)]
      // Ölçülmeyen bir konu soruldu ve model "ölçmüyor" dedi: bu kelimelerin geçmesi doğaldır.
      .filter((e) => !(e.startsWith('ölçülmeyen konu') && askedUnmeasured && NOT_MEASURED_RE.test(lower(text))));
    if (!errors.length) return { text, errors: [] };
    last = { text: null, errors, raw: text };
  }
  return last;
}

// Ollama çalışıyor mu, model yüklü mü?
export async function modelStatus({ model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const { models = [] } = await res.json();
    return models.some((m) => m.name === model || m.model === model)
      ? { ok: true } : { ok: false, reason: `${model} indirilmemiş` };
  } catch {
    return { ok: false, reason: 'Ollama çalışmıyor' };
  }
}
