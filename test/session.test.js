import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSong } from '../web/song.js';
import { createSession, timingErrors } from '../web/session.js';
import { createRecorder, parseRecording, replayAll } from '../web/sources/replay.js';
import { createParser } from '../web/protocol.js';
import { createMotion } from '../web/motion.js';
import { createStrokeSegmenter } from '../web/strokes.js';
import { synth, run, songSegments, REST, LA, RE } from './fixtures.js';

const dahaDun = parseSong(JSON.parse(readFileSync(new URL('../web/songs/daha_dun.json', import.meta.url))));
const tiny = parseSong({
  id: 't', title: 'T', bpm: 60, beats_per_bar: 4, level: 1, targets: [],
  notes: [['A4', 1], ['A4', 1], ['E5', 1], ['A4', 1]],
});

function fakeAudio() {
  const calls = [];
  return {
    calls,
    noteOn: (midi) => calls.push(['on', midi]),
    noteOff: () => calls.push(['off']),
    setLevel: (l) => calls.push(['level', l]),
    ons: () => calls.filter((c) => c[0] === 'on').map((c) => c[1]),
  };
}

// Satırları zincirden geçirir; oturum ızgarası REST sonunda (300 ms) başlar.
function play(song, lines, opts = {}) {
  const audio = fakeAudio();
  let ended = null;
  const session = createSession({ song, audio, onEnd: (r) => { ended = r; }, ...opts });
  session.start(REST.ms);
  run(lines, { getExpected: session.getExpected, onEvent: session.handle, useImu: opts.useImu ?? true });
  return { session, audio, ended };
}

test('kusursuz çekiş dizisi bütün notaları çaldırır', () => {
  const { session, audio, ended } = play(dahaDun, synth(songSegments(dahaDun)));
  assert.equal(session.state, 'done');
  assert.ok(ended, 'onEnd çağrılmadı');
  assert.deepEqual(audio.ons(), dahaDun.notes.map((n) => n.midi));
  assert.equal(ended.length, 14);
  for (const r of ended) {
    assert.deepEqual(r.wrong_strokes, []);
    assert.ok(Math.abs(r.timing_error_ms) < 80, `nota ${r.index}: ${r.timing_error_ms} ms`);
    assert.ok(r.dur_ms > 300);
  }
  // Aynı teldeki yay değişimlerinde yön ölçülür ve beklenenle aynıdır.
  for (const r of ended.filter((x) => x.dir_conf >= 0.8)) assert.equal(r.bow_dir, r.expected.bow, `nota ${r.index}`);
  assert.ok(ended.filter((x) => x.dir_conf >= 0.8).length >= 10);
});

test('araya giren yanlış tel çekişi o notanın wrong_strokes listesine girer', () => {
  // 3. nota (E5, Mi) yerine önce 300 ms Re teline çekiş.
  const lines = synth(songSegments(tiny, { before: { 3: [{ ms: 300, mask: RE, v: 0.3 }] } }));
  const { session, audio, ended } = play(tiny, lines);
  assert.equal(session.state, 'done');
  assert.deepEqual(audio.ons(), [69, 69, 76, 69]); // yanlış telde ses yok
  assert.deepEqual(ended[2].wrong_strokes.map((w) => w.string), [1]);
  assert.equal(ended[2].timing_error_ms, null); // zamanlaması değerlendirilmez
  assert.equal(ended[0].wrong_strokes.length + ended[1].wrong_strokes.length + ended[3].wrong_strokes.length, 0);
});

test('100 ms\'den kısa çekiş şarkıyı ilerletmez', () => {
  // Başta havada hareket, 50 ms La teması, sonra kusursuz şarkı.
  const segs = [REST, { ms: 300, v: 0.3 }, { ms: 50, mask: LA, v: 0.3 }, { ms: 400, v: 0 },
    ...songSegments(tiny).slice(1)];
  const audio = fakeAudio();
  const session = createSession({ song: tiny, audio });
  session.start(REST.ms + 750);
  let pointerAfterBlip = null;
  run(synth(segs), {
    getExpected: session.getExpected,
    onEvent: (e) => {
      session.handle(e);
      if (e.type === 'stroke_end' && pointerAfterBlip === null) pointerAfterBlip = session.pointer;
    },
  });
  assert.equal(pointerAfterBlip, 0);
  assert.deepEqual(audio.ons(), [69, 69, 69, 76, 69]); // ses başladı, kesildi, ilerlemedi
  assert.equal(session.state, 'done');
  assert.ok(session.records.every((r) => r.wrong_strokes.length === 0));
});

test('kusursuz çalınmış kaydın oynatılması 0 yanlış tel verir', () => {
  const rec = createRecorder();
  synth(songSegments(dahaDun), { seed: 5 }).forEach((l, i) => rec.push(l, i * 5));
  const entries = parseRecording(rec.toText());

  const audio = fakeAudio();
  const session = createSession({ song: dahaDun, audio });
  session.start(REST.ms);
  const motion = createMotion();
  const strokes = createStrokeSegmenter({ onEvent: session.handle, getExpected: session.getExpected });
  const parser = createParser({ onSample: (s) => { motion.process(s); strokes.push(s); } });
  replayAll(entries, parser.push);

  assert.equal(session.state, 'done');
  assert.equal(session.records.reduce((n, r) => n + r.wrong_strokes.length, 0), 0);
});

test('komşu tele değme neighbor_ms ve neighbor_string olarak kaydedilir', () => {
  // 2. notada (La) 20 ms Re teması.
  const lines = synth(songSegments(tiny), { extra: [[REST.ms + 1500, 20, RE]] });
  const { ended } = play(tiny, lines);
  assert.ok(ended[1].neighbor_ms >= 20 && ended[1].neighbor_ms <= 30, `${ended[1].neighbor_ms}`);
  assert.equal(ended[1].neighbor_string, 1);
  assert.equal(ended[0].neighbor_ms, 0);
});

test('yalnızca temas kipinde düzey sabit 0,7 ve yön kaydedilmez', () => {
  const { audio, ended } = play(tiny, synth([REST,
    { ms: 600, mask: LA }, { ms: 400 }, { ms: 600, mask: LA }, { ms: 400 },
    { ms: 600, mask: 8 }, { ms: 400 }, { ms: 600, mask: LA }, { ms: 300 }]), { useImu: false });
  assert.ok(ended);
  assert.ok(audio.calls.filter((c) => c[0] === 'level').every((c) => c[1] === 0.7));
  assert.ok(ended.every((r) => r.bow_dir === null));
});

test('timingErrors: plandaki örnek (60 vuruş/dk, +150 ms aralık hatası)', () => {
  const prev = { onset_ms: 0, expected: { start_beat: 0 } };
  const late = { onset_ms: 1150, expected: { start_beat: 1 } };
  assert.deepEqual(timingErrors(late, prev, 1000), { grid_error_ms: 150, interval_error_ms: 150, timing_error_ms: 150 });
  // Öğrenci önceki notada gecikti, bu notada vuruşa döndü: ızgara hatası 0 seçilir.
  const prevLate = { onset_ms: 200, expected: { start_beat: 0 } };
  const back = { onset_ms: 1000, expected: { start_beat: 1 } };
  assert.equal(timingErrors(back, prevLate, 1000).timing_error_ms, 0);
});
