// Parçaları birbirine bağlar. Tarayıcıya özgü çağrılar (ses, ekran, depolama)
// yalnızca burada ve ui.js / audio.js / sources/ içinde yapılır.

import { USE_IMU } from './thresholds.js';

// Yön kalibrasyonu Aşama 9'da eklenecek; simülatörün ekseni zaten bilinir.
const DIR_CALIBRATED = true;
import { parseSong, OPEN_MIDI, STRING_NAMES } from './song.js';
import { createAudio, speedToLevel, levelToCutoff, LEVEL_CONTACT_ONLY } from './audio.js';
import { createParser, createRateMeter } from './protocol.js';
import { createSimulator } from './sources/simulator.js';
import { createSerialSource, isSupported as serialSupported } from './sources/serial.js';
import { createRecorder, parseRecording, createReplayer } from './sources/replay.js';
import { createMotion } from './motion.js';
import { createFingerTracker, playedMidi } from './fingers.js';
import {
  LESSONS, createLessonRunner, emptyProgress, completeStep, completeLesson, XP_PER_STEP,
} from './lessons.js';
import { createBird, renderPath, renderLesson } from './school.js';
import { createStrokeSegmenter } from './strokes.js';
import { createSession } from './session.js';
import { evaluate, TYPE_LABELS } from './rules.js';
import {
  templateTeacher, attemptNo, previousAttempt, nextOptions, buildModelInput, askQuestion,
  modelStatus, DEFAULT_MODEL,
} from './teacher.js';
import {
  renderSongPicker, renderSongTable, renderAudioPanel, renderRawPanel, renderMotionPanel,
  renderPlayPanel, highlightNote, renderResultPanel, renderTeacherSettings, markNoteErrors, renderError,
  renderTopbar, renderNotice, renderFingerPanel, renderTutor, renderStaff,
} from './ui.js';

const $ = (id) => document.getElementById(id);
const status = $('status');
const playBox = $('play');
const resultBox = $('result');
const songBox = $('notes');
const rawBox = $('source');
const settingsBox = $('settings');
const motionBox = $('motion');
const audioBox = $('audiotest');

// --- Ekranlar: Öğren, Çal, Atölye
const SCREEN_KEY = 'yay-ogretmeni:screen';
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((sc) => { sc.hidden = sc.dataset.screen !== name; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === name));
  try { localStorage.setItem(SCREEN_KEY, name); } catch { /* yoksay */ }
  if (name === 'workshop') motionPanel.markDirty();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));

// --- İlerleme: biten dersler, XP, gün serisi (localStorage)
const PROGRESS_KEY = 'yay-ogretmeni:progress';
let progress = emptyProgress();
try { progress = { ...progress, ...JSON.parse(localStorage.getItem(PROGRESS_KEY)) }; } catch { /* varsayılan */ }
function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* yoksay */ }
  $('xp').textContent = `⭐ ${progress.xp}`;
  $('streak').textContent = `🔥 ${progress.streak}`;
  pathView?.update(progress);
}
const today = () => new Date().toISOString().slice(0, 10);

// Derslerin baktığı olaylar
const playedLog = [];   // kesinleşen notalar: { string, finger }
let attemptsDone = 0;
let questionsAsked = 0;

// --- Ses: AudioContext yalnızca kullanıcı tıklamasıyla başlatılabilir. Bu yüzden ses,
// "Sesi aç", "Simülatörü başlat", "Karta bağlan" ya da "Denemeyi başlat" tıklamasıyla açılır.
let audio = null;
let audioOn = false;
async function ensureAudio() {
  if (!audio) audio = createAudio(); // tıklama işleyicisinin içinde, beklemeden oluşturulur
  audioOn = true;
  await audio.resume();
  return audio;
}
async function toggleSound() {
  if (audioOn && audio) {
    audioOn = false;
    stopFree();
    await audio.suspend();
  } else {
    await ensureAudio();
  }
}

// Serbest çalma: deneme açık değilken çalınan nota (tel + parmak) seslendirilir.
// Sopa teldeyken parmak değişirse perde hemen değişir.
let freeId = null;
let freeNote = null; // { string, finger, midi }
function stopFree() {
  if (freeId !== null) audio?.noteOff();
  freeId = null;
  freeNote = null;
}
function freePlay(e) {
  if (!audioOn || !audio) return;
  if (e.type === 'stroke_start') {
    const finger = raw.finger ?? 0;
    freeNote = { string: e.string, finger, midi: playedMidi(OPEN_MIDI[e.string], finger) };
    audio.setLevel(imuMode ? speedToLevel(0) : LEVEL_CONTACT_ONLY);
    audio.noteOn(freeNote.midi);
    freeId = e.id;
  } else if (e.type === 'stroke_update' && e.id === freeId && imuMode) {
    audio.setLevel(speedToLevel(e.speed));
  } else if (e.type === 'stroke_end' && e.id === freeId) {
    stopFree();
  }
}
function retuneFree(finger) {
  if (!freeNote || finger === freeNote.finger) return;
  freeNote.finger = finger;
  freeNote.midi = playedMidi(OPEN_MIDI[freeNote.string], finger);
  audio?.noteOn(freeNote.midi); // çalarken noteOn: frekans 5 ms'de kayar, ses kesilmez
}

// --- Parmak şeritleri: bakır tel × folyo teması (fmask)
const fingers = createFingerTracker();

// --- Deneme geçmişi: localStorage (tek kullanıcı). Erişilemezse geçmişsiz çalışılır.
const HISTORY_KEY = 'yay-ogretmeni:attempts';
const HISTORY_MAX = 500;
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? []; } catch { return []; }
}
function saveAttempt(entry) {
  try {
    const h = [...loadHistory(), entry].slice(-HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch (e) {
    console.warn('Deneme özeti kaydedilemedi', e);
  }
}

// --- Öğretmen ayarı (localStorage)
// Öğretmen metnini, sonraki egzersizi ve tempoyu her zaman şablon öğretmen üretir.
// Yerel model yalnızca soru-cevapta kullanılır (plan, Risk 3 yedek yolu 1): Aşama 7'deki
// 10 örnekli denemede gemma3:4b metinde sayı ve anlam hataları yaptı, yanıt 10 sn'yi aştı.
const SETTINGS_KEY = 'yay-ogretmeni:settings';
let settings = { useModel: true, model: DEFAULT_MODEL };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; } catch { /* varsayılan */ }
let lastModelInput = null; // soru-cevap son denemenin girdisine dayanır
let modelReady = false;

async function refreshModelStatus() {
  let reason = 'kapalı';
  if (!settings.useModel) {
    modelReady = false;
    teacherSettings.setStatus('kapalı: soru kutusu gizli');
  } else {
    const st = await modelStatus({ model: settings.model });
    modelReady = st.ok;
    reason = st.reason ?? '';
    teacherSettings.setStatus(st.ok ? 'hazır' : `${st.reason}; soru kutusu gizli`);
  }
  resultPanel.setQaEnabled(false); // soru-cevap en üstteki öğretmen kartında
  tutor.setStatus({ model: settings.model, ready: modelReady, reason });
}

// Soru-cevap bağlamı: son deneme; deneme yoksa serbest çalmada son çalınan notalar.
function tutorContext() {
  return lastModelInput ?? { durum: 'Henüz deneme yok; serbest çalma.', son_calinan_notalar: staff.recent };
}

// --- Oturum (Aşama 5–7)
let exercises = [];  // songs/ altındaki dosyaların ham JSON'u + dosya adı
let songFile = null;
let song = null;
let session = null;
let gridZero = null; // hazırlık sayımının bittiği an (performance.now ms)
let summary = null;

function summarize(records) {
  const played = records.filter((r) => r.onset_ms !== null);
  const wrong = records.reduce((n, r) => n + r.wrong_strokes.length, 0);
  const timed = played.filter((r) => r.timing_error_ms !== null);
  const avg = timed.length
    ? Math.round(timed.reduce((s, r) => s + Math.abs(r.timing_error_ms), 0) / timed.length) : null;
  return `${played.length}/${records.length} nota çalındı · yanlış tel çekişi ${wrong}`
    + (avg === null ? '' : ` · ortalama zamanlama sapması ${avg} ms`);
}

function finishAttempt(records, bpm) {
  summary = summarize(records);
  const result = evaluate(records, { bpm, useImu: imuMode, dirCalibrated: DIR_CALIBRATED });
  const history = loadHistory();
  const exercise = exercises.find((e) => e.id === song.id);
  const teacher = templateTeacher({ result, exercise, exercises, bpm, history });
  const input = buildModelInput({
    exercise, bpm, noteCount: records.length, attemptNo: attemptNo(history, song.id), result,
    previous: previousAttempt(history, song.id),
    options: nextOptions(exercise, result.findings, exercises, bpm),
  });
  lastModelInput = input;
  saveAttempt({
    exercise_id: song.id,
    attempt_no: attemptNo(history, song.id),
    at: new Date().toISOString(),
    bpm,
    note_count: records.length,
    notes_played: result.summary.notes_played,
    notes_with_error: result.summary.notes_with_error,
    counts: result.summary.counts,
    not_evaluated: result.summary.not_evaluated,
  });
  markNoteErrors(result.perNote, TYPE_LABELS);
  const titleOf = (id) => exercises.find((e) => e.id === id)?.title ?? id;
  resultPanel.show({
    result, teacher, labels: TYPE_LABELS, nextTitle: titleOf(teacher.next_exercise_id),
    note: 'Şablon öğretmen', qaEnabled: false,
  });
  tutor.setFeedback(teacher.feedback);
  attemptsDone += 1;
  console.log('Deneme', { records, result, teacher, input });
}

async function startAttempt() {
  if (!song) return;
  const a = await ensureAudio();
  stopAttempt();
  stopFree();
  summary = null;
  resultPanel.clear();
  lastModelInput = null;
  markNoteErrors([], TYPE_LABELS);
  const bpm = playPanel.getBpm();
  session = createSession({
    song: { ...song, bpm },
    audio: a,
    useImu: imuMode,
    onEnd: (records) => {
      a.metronomeStop();
      finishAttempt(records, bpm);
    },
  });
  // Metronom 100 ms sonra başlar; bir ölçü hazırlık sayımı, sonra ızgaranın sıfırı.
  a.metronomeStart({ bpm, beatsPerBar: song.beats_per_bar });
  gridZero = performance.now() + 100 + song.beats_per_bar * (60000 / bpm);
  session.start(gridZero);
}

function stopAttempt() {
  audio?.metronomeStop();
  session?.stop();
}

const playPanel = renderPlayPanel(playBox, { onStart: startAttempt, onStop: stopAttempt });
// Bülbül'e soru: tel–parmak ve ölçülmeyen konu soruları kodla, diğerleri modelle yanıtlanır.
function askTutor(q) {
  questionsAsked += 1;
  return askQuestion(q, tutorContext(), { model: settings.model });
}
const tutor = renderTutor($('tutor'), { onAsk: askTutor, bird: createBird(110) });
$('brand-bird').append(createBird(38).node);
const staff = renderStaff($('staff'));
// Portedeki canlı nota: çekiş sürerken parmak değişirse yeni nota eklenir.
let liveStroke = null; // { string, finger }
function staffNote(string, finger) {
  const n = { midi: playedMidi(OPEN_MIDI[string], finger), string, finger };
  staff.push(n);
  lessonView.pushNote(n);
}
const topbar = renderTopbar($('topbar'), {
  onSoundToggle: toggleSound,
  async onTestTone() { // 1 sn La: sesin üretilip duyulduğunu ayırt etmek için
    const a = await ensureAudio();
    a.setLevel(0.8);
    a.noteOn(69);
    setTimeout(() => { if (freeId === null && !session?.sounding) a.noteOff(); }, 1000);
  },
});
renderNotice($('notice'), serialSupported() ? ''
  : 'Bu tarayıcı karta bağlanamaz: Web Serial yalnızca Chrome ve Edge\'de var. '
    + 'Simülatör, ses ve öğretmen burada da çalışır; yayla çalmak için sayfayı Chrome ya da Edge\'de aç.');
const teacherSettings = renderTeacherSettings(settingsBox, {
  settings,
  onChange(next) {
    settings = { ...settings, ...next, model: next.model || DEFAULT_MODEL };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* yoksay */ }
    refreshModelStatus();
  },
});

const resultPanel = renderResultPanel(resultBox, {
  onAsk: (q) => (lastModelInput
    ? askQuestion(q, lastModelInput, { model: settings.model })
    : Promise.resolve({ text: null, errors: ['önce bir deneme bitir'] })),
  async onApply(exerciseId, bpm) {
    const ex = exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    if (ex.file !== songFile) {
      document.getElementById('song-select').value = ex.file;
      await loadSong(ex.file);
    }
    playPanel.setBpm(bpm);
  },
});
refreshModelStatus();

// --- Kaynak → kayıt → ayrıştırıcı → hareket → bölütleme → oturum ve paneller
const recorder = createRecorder();
const rateMeter = createRateMeter();
const motionPanel = renderMotionPanel(motionBox);
const fingerPanel = renderFingerPanel($('fingers'));
const raw = { lastLine: '', mask: 0, acc: null, health: null, finger: 0 };
let parser;
let replay = null; // { name, player }
// IMU kipi kaynağa göre: kart H satırında imu_ok=0 gönderirse alet yalnızca temasla
// çalışır (Aşama 8). USE_IMU genel anahtardır; false ise IMU hiç kullanılmaz.
let imuMode = USE_IMU;
let motion;
let strokes;

function onStrokeEvent(e) {
  motionPanel.pushEvent(e);
  if (e.type === 'stroke_start') {
    liveStroke = { id: e.id, string: e.string, finger: raw.finger ?? 0, confirmed: false };
    staffNote(liveStroke.string, liveStroke.finger);
  } else if (e.type === 'stroke_confirm' && liveStroke?.id === e.id) {
    liveStroke.confirmed = true;
    playedLog.push({ string: liveStroke.string, finger: liveStroke.finger });
  } else if (e.type === 'stroke_end') {
    liveStroke = null;
    staff.release();
    lessonView.releaseNote();
  }
  if (session?.state === 'playing') session.handle(e);
  else freePlay(e);
}

// Hareket ve bölütleme yeniden kurulur (IMU kipi değişince ya da kaynak değişince).
function resetMotion() {
  stopFree();
  motion = createMotion();
  strokes = createStrokeSegmenter({
    onEvent: onStrokeEvent,
    getExpected: () => session?.getExpected() ?? null,
    useImu: imuMode,
  });
}

function setImuMode(on) {
  on = USE_IMU && on;
  if (on === imuMode) return;
  imuMode = on;
  stopAttempt(); // açık deneme eski kiple başladı
  resetMotion();
  console.log(`IMU kipi: ${imuMode ? 'açık' : 'kapalı (yalnızca temas)'}`);
}

// Kaynak değişince bütün durum sıfırlanır: kart saati, yerçekimi, hız, açık çekiş.
function resetPipeline(useImu = USE_IMU) {
  imuMode = USE_IMU && useImu;
  resetMotion();
  motionPanel.clear();
  parser = createParser({
    onSample: (s) => {
      fingers.process(s);
      raw.finger = s.finger;
      retuneFree(s.finger);
      if (liveStroke && s.finger !== liveStroke.finger) {
        liveStroke.finger = s.finger;
        staffNote(liveStroke.string, s.finger);
        // Kesinleşmiş çekişte parmak değişimi yeni bir notadır.
        if (liveStroke.confirmed) playedLog.push({ string: liveStroke.string, finger: s.finger });
      }
      motion.process(s);
      strokes.push(s);
      motionPanel.pushSample(s);
      raw.mask = s.mask;
      raw.acc = s.acc;
    },
    onHealth: (h) => {
      raw.health = h;
      setImuMode(h.imu_ok);
    },
  });
}
resetPipeline();

function onLine(line, t_host) {
  if (!replay) recorder.push(line, t_host); // oynatılan satır yeniden kaydedilmez
  if (line.startsWith('S,')) rateMeter.push(t_host);
  raw.lastLine = line;
  parser.push(line, t_host);
}

const sim = createSimulator({ onLine });
function startSim() {
  if (sim.running) return;
  ensureAudio();
  stopReplay();
  if (serial.connected) serial.disconnect('simülatöre geçildi');
  resetPipeline();
  sim.start();
}

// Kart (Aşama 8). IMU kipi ilk H satırı gelene kadar kapalı başlar.
const serialState = { state: 'closed', message: '', data: false, silent: false };
const serial = createSerialSource({
  onLine,
  onStatus(st) {
    Object.assign(serialState, { message: '', silent: false, reason: '' }, st);
    console.log('Seri port', st);
  },
});
async function startSerial(connectFn) {
  sim.stop();
  stopReplay();
  resetPipeline(false);
  try {
    return await connectFn();
  } catch (e) {
    if (e.name !== 'NotFoundError') { // NotFoundError: seçim penceresi kapatıldı
      Object.assign(serialState, { state: 'error', message: e.message });
    }
    return false;
  }
}

function stopReplay() {
  replay?.player.stop();
  replay = null;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

const rawPanel = renderRawPanel(rawBox, {
  onSimToggle() {
    if (sim.running) sim.stop();
    else startSim();
  },
  serialSupported: serialSupported(),
  async onSerialToggle() {
    if (serial.connected) await serial.disconnect('"Bağlantıyı kes" düğmesi');
    else {
      ensureAudio();
      await startSerial(() => serial.connect());
    }
  },
  onOption: (key, value) => { sim.engine.options[key] = value; },
  onReplayFile(name, text) {
    sim.stop();
    if (serial.connected) serial.disconnect('kayıt oynatmaya geçildi');
    stopReplay();
    resetPipeline(); // kayıttaki H satırı imu_ok=0 ise kip kendiliğinden kapanır
    const player = createReplayer({ entries: parseRecording(text), onLine, onEnd: () => { replay = null; } });
    replay = { name, player };
    player.start();
  },
  onReplayStop: stopReplay,
  onDownload: () => download(`kayit-${stamp()}.txt`, recorder.toText()),
  onClear: () => recorder.clear(),
});

// --- Dersler
let runner = null;
let lessonXp = 0;
const world = () => ({
  sourceLive: serial.connected || sim.running || !!replay,
  sim: sim.running,
  audioOn: audioOn && !!audio,
  mask: raw.mask,
  played: playedLog,
  attempts: attemptsDone,
  questions: questionsAsked,
});
function openLesson(lesson) {
  runner = createLessonRunner(lesson);
  runner.begin(world());
  lessonXp = 0;
  $('path').hidden = true;
  $('lesson').hidden = false;
}
function closeLesson() {
  runner = null;
  $('lesson').hidden = true;
  $('path').hidden = false;
  saveProgress();
}
const lessonView = renderLesson($('lesson'), {
  serialSupported: serialSupported(),
  onClose: closeLesson,
  onContinue() {
    if (!runner) return;
    if (runner.finished) {
      progress = completeLesson(progress, runner.lesson.id);
      closeLesson();
      return;
    }
    progress = completeStep(progress, today());
    lessonXp += XP_PER_STEP;
    runner.next(world());
    saveProgress();
    if (runner.finished) audio?.chime();
  },
  onConnect() {
    ensureAudio();
    startSerial(() => serial.connect());
  },
  onSimulator: startSim,
  onSound: ensureAudio,
  async onGotoPlay() {
    const file = 'acik_dortluk.json';
    if (songFile !== file) {
      $('song-select').value = file;
      await loadSong(file);
    }
    showScreen('play');
  },
  onAsk: askTutor,
});
const pathView = renderPath($('path'), {
  onOpen: openLesson,
  onReset() {
    progress = emptyProgress();
    if (runner) closeLesson();
    saveProgress();
  },
});
saveProgress();

function lessonFrame() {
  if (!runner) return;
  const finished = runner.finished;
  const r = finished ? { ok: true, justDone: false } : runner.check(world());
  if (r.justDone) audio?.chime();
  lessonView.update({
    lesson: runner.lesson, index: runner.index, step: runner.step, progress: finished ? 1 : runner.progress,
    ok: r.ok, justDone: r.justDone, finished, xpGained: lessonXp,
    sim: sim.running, mask: raw.mask, fmask: fingers.state.fmask,
    sounding: session?.state === 'playing' ? session.sounding : freeId !== null,
  });
}

function playView() {
  const recs = session?.records ?? [];
  const playing = session?.state === 'playing';
  const now = performance.now();
  const countin = playing && now < gridZero;
  const cur = playing ? recs[session.pointer] : null;
  const notes = song?.notes.filter((n) => !n.rest) ?? [];
  const nextFrom = playing ? session.pointer + 1 : 0;
  if (cur) highlightNote(cur.index);
  return {
    state: countin ? 'countin' : session?.state ?? 'idle',
    countdown: countin ? Math.ceil((gridZero - now) / session.beatMs) : null,
    title: song?.title,
    pointer: session?.pointer ?? 0,
    total: recs.length,
    expected: cur ? { string: cur.expected.string, bow: cur.expected.bow } : null,
    next: playing ? notes.slice(nextFrom, nextFrom + 4) : [],
    mask: raw.mask,
    sounding: session?.state === 'playing' ? session.sounding : freeId !== null,
    now: session?.state === 'playing' ? null : freeNote,
    finger: raw.finger,
    summary,
  };
}

(function draw() { // ekran saniyede ~60 kez çizilir; satır başına değil
  rawPanel.update({
    ...raw,
    rate: rateMeter.rate(performance.now()),
    stats: parser.stats,
    simRunning: sim.running,
    replay: replay && { name: replay.name, progress: replay.player.progress },
    recCount: recorder.count,
    serial: { ...serialState, connected: serial.connected, bytes: serial.stats.bytes, lines: serial.stats.lines },
    imuMode,
  });
  motionPanel.draw();
  playPanel.update(playView());
  fingerPanel.update({ state: fingers.state });
  lessonFrame();
  topbar.update({
    audioOn,
    audioState: audio?.state ?? 'yok',
    level: audioOn && audio ? audio.meter() : 0,
    sourceLabel: serial.connected ? 'Kart bağlı' : sim.running ? 'Simülatör' : replay ? 'Kayıt oynatılıyor' : 'Kaynak yok',
    sourceLive: serial.connected || sim.running || !!replay,
    imuMode,
  });
  requestAnimationFrame(draw);
})();

// --- Aşama 2: ses testi
const audioPanel = renderAudioPanel(audioBox, {
  notes: OPEN_MIDI.map((midi, s) => ({ label: STRING_NAMES[s], midi })),
  onStart: ensureAudio,
  onNote: (midi) => audio.noteOn(midi),
  onNoteOff: () => audio.noteOff(),
  onSpeed(speed) {
    const level = speedToLevel(speed);
    audio?.setLevel(level);
    return `${speed.toFixed(2)} m/s → düzey ${level.toFixed(2)}, kesim ${Math.round(levelToCutoff(level))} Hz`;
  },
  onMetronomeStart(bpm) {
    audio.metronomeStart({ bpm, beatsPerBar: 4 }, (beat) => {
      audioPanel.showBeat(beat, (beat.n * 60) / bpm);
    });
  },
  onMetronomeStop: () => audio.metronomeStop(),
  onLatency() {
    const { base, output } = audio.latency();
    const ms = (s) => (typeof s === 'number' ? `${(s * 1000).toFixed(1)} ms` : 'desteklenmiyor');
    const total = typeof output === 'number' ? ` · toplam ${((base + output) * 1000).toFixed(1)} ms (bütçe 16)` : '';
    const text = `baseLatency ${ms(base)} · outputLatency ${ms(output)}${total}`;
    console.log(text);
    return text;
  },
});

// --- Şarkılar
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadSong(file) {
  stopAttempt();
  session = null;
  summary = null;
  resultPanel.clear();
  try {
    song = parseSong(await fetchJson(`songs/${file}`));
    songFile = file;
    playPanel.setBpm(song.bpm);
    renderSongTable(songBox, song);
  } catch (e) {
    song = null;
    renderError(songBox, `${file} yüklenemedi: ${e.message}`);
  }
}

async function init() {
  const files = await fetchJson('songs/index.json');
  // Seçicide başlık göstermek için her dosyayı bir kez okuyoruz.
  const loaded = await Promise.all(files.map(async (file) => {
    try {
      return { file, ...parseSong(await fetchJson(`songs/${file}`)) };
    } catch {
      return { file, title: `${file} (okunamadı)`, broken: true };
    }
  }));
  // Öğretmen yalnızca yüklenebilen egzersizler arasından seçer.
  exercises = loaded.filter((e) => !e.broken);
  renderSongPicker(playPanel.pickerSlot, loaded, loadSong);
  await loadSong(files[0]);
  status.textContent = 'Hazır.';
  let first = LESSONS.every((l) => progress.done.includes(l.id)) ? 'play' : 'learn';
  try { first = localStorage.getItem(SCREEN_KEY) ?? first; } catch { /* yoksay */ }
  showScreen(first);
  // Daha önce izin verilmiş tek port varsa kendiliğinden bağlan.
  if (serialSupported() && (await navigator.serial.getPorts()).length === 1) {
    await startSerial(() => serial.autoConnect());
  }
}

init().catch((e) => {
  status.textContent = 'Başlatılamadı.';
  renderError(playBox, e.message);
  console.error(e);
});
