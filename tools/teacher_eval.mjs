// On örnek girdiyi yerel modele gönderir, doğrulayıcıdan geçirir, süreyi ölçer.
//   node tools/teacher_eval.mjs [--model gemma3:4b] [--only 3] [--zero-shot]
//   node tools/teacher_eval.mjs --qa      soru-cevap: 6 soru, süre ve denetim
// Ollama çalışıyor ve model indirilmiş olmalı.

import { readFileSync } from 'node:fs';
import { evaluate } from '../web/rules.js';
import { parseSong } from '../web/song.js';
import { buildModelInput, nextOptions, askModel, askQuestion, DEFAULT_MODEL, modelStatus } from '../web/teacher.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const model = arg('model', DEFAULT_MODEL);
const only = arg('only', null);
const oneShot = !process.argv.includes('--zero-shot');

const dir = new URL('../web/songs/', import.meta.url);
const exercises = JSON.parse(readFileSync(new URL('index.json', dir)))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir))));
const ex = (id) => exercises.find((e) => e.id === id);

// Şarkının notalarından kusursuz kayıtlar (tel ve yay song.js ile türetilir);
// bozmak için mutate[sıra](kayıt) değişen alanları döndürür.
function records(id, bpm, mutate = {}) {
  const beatMs = 60000 / bpm;
  return parseSong(ex(id)).notes.filter((n) => !n.rest).map((n) => {
    const r = {
      index: n.index,
      expected: { string: n.string, bow: n.bow, midi: n.midi, start_beat: n.start_beat, dur_beats: n.dur_beats },
      onset_ms: n.start_beat * beatMs, timing_error_ms: 10, wrong_strokes: [],
      neighbor_ms: 0, neighbor_string: null, bow_dir: n.bow, dir_conf: 0.95,
      dur_ms: n.dur_beats * beatMs - 50, accel_rms: 0.25, gap_count: 0, max_gap_ms: 0,
    };
    return mutate[n.index] ? { ...r, ...mutate[n.index](r) } : r;
  });
}

const late = (ms) => () => ({ timing_error_ms: ms });
const wrong = (s) => () => ({ wrong_strokes: [{ string: s, dur_ms: 250 }], timing_error_ms: null });
const neighbor = (ms, s) => () => ({ neighbor_ms: ms, neighbor_string: s });
const flip = () => (r) => ({ bow_dir: r.expected.bow === 'D' ? 'U' : 'D' });
const both = (a, b) => (r) => ({ ...a(r), ...b(r) });
const unsure = () => ({ dir_conf: 0.5, accel_rms: null, dur_ms: 300 });

const samples = [
  ['Plandaki örnek: komşu tel + geç + düzensiz', 'gecis_komsu', 60,
    { 3: both(neighbor(35, 1), late(130)), 7: both(neighbor(35, 1), late(130)),
      11: both(neighbor(35, 1), late(130)), 15: neighbor(35, 1),
      16: () => ({ accel_rms: 0.9 }) }, { bpm: 60, notes_with_error: 8 }],
  ['Bulgusuz', 'daha_dun', 60, {}, { bpm: 60, notes_with_error: 2 }],
  ['Yalnızca değerlendirilmeyen ölçümler', 'acik_dortluk', 60,
    Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [i, unsure])), null],
  ['Yanlış tel', 'daha_dun', 60, { 3: wrong(2), 8: wrong(3) }, null],
  ['Geç girişler', 'ritim_karisik', 60, { 2: late(160), 4: late(180), 5: late(150), 7: late(140), 9: late(170) }, null],
  ['Erken girişler', 'acik_dortluk', 72, { 4: late(-140), 8: late(-150), 12: late(-130) }, { bpm: 66, notes_with_error: 1 }],
  ['Yön kayması', 'acik_dortluk', 60, Object.fromEntries([5, 6, 7, 8, 9, 10].map((i) => [i, flip()])), null],
  ['Düzensiz hız', 'acik_uzun', 60, { 2: () => ({ accel_rms: 1.2 }), 5: () => ({ accel_rms: 1.1 }),
    9: () => ({ accel_rms: 1.3 }), 13: () => ({ accel_rms: 1.2 }) }, null],
  ['Karışık: yanlış tel, komşu, geç', 'daha_dun', 60,
    { 3: wrong(2), 8: wrong(3), 4: neighbor(25, 2), 5: neighbor(30, 2), 6: neighbor(20, 2),
      9: late(150), 10: late(160), 11: late(140), 12: late(170) }, { bpm: 60, notes_with_error: 6 }],
  ['Yüksek hata oranı', 'daha_dun', 66,
    Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [i, late(200)])), { bpm: 60, notes_with_error: 3 }],
];

const status = await modelStatus({ model });
if (!status.ok) {
  console.error(`Model kullanılamıyor: ${status.reason}`);
  process.exit(1);
}

function inputFor(k) {
  const [, id, bpm, mutate, previous] = samples[k];
  const recs = records(id, bpm, mutate);
  const result = evaluate(recs, { bpm, useImu: true, dirCalibrated: true });
  return buildModelInput({
    exercise: ex(id), bpm, noteCount: recs.length, attemptNo: previous ? 2 : 1, result, previous,
    options: nextOptions(ex(id), result.findings, exercises, bpm),
  });
}

if (process.argv.includes('--qa')) {
  const questions = [
    [0, 'En çok neye dikkat etmeliyim?'],
    [0, 'Neden geç kaldım?'],
    [0, 'Entonasyonum nasıldı?'],
    [8, 'Vibratom nasıldı?'],
    [1, 'C#5 notasını hangi tel ve parmakla çalarım?'],
    [8, 'Kaç notayı temiz çaldım?'],
    [1, 'Bir sonraki adımda ne yapayım?'],
  ];
  const ts = [];
  let ok = 0;
  for (const [k, q] of questions) {
    const t0 = Date.now();
    const r = await askQuestion(q, inputFor(k), { model });
    ts.push(Date.now() - t0);
    if (r.text) ok += 1;
    console.log(`\n${r.text ? '✔' : '✖'} [örnek ${k + 1}] ${q} — ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
    console.log(`  ${r.text ?? `RED: ${r.errors.join(' · ')} — ${r.raw ?? ''}`}`);
  }
  ts.sort((a, b) => a - b);
  console.log(`\n${ok}/${questions.length} denetimden geçti · medyan ${(ts[Math.floor(ts.length / 2)] / 1000).toFixed(1)} sn`);
  process.exit(0);
}

let passed = 0;
const times = [];
for (const [k, [name, id, bpm, mutate, previous]] of samples.entries()) {
  if (only && Number(only) !== k + 1) continue;
  const recs = records(id, bpm, mutate);
  const result = evaluate(recs, { bpm, useImu: true, dirCalibrated: true });
  const input = buildModelInput({
    exercise: ex(id), bpm, noteCount: recs.length, attemptNo: previous ? 2 : 1, result, previous,
    options: nextOptions(ex(id), result.findings, exercises, bpm),
  });
  const r = await askModel(input, { model, oneShot });
  const ms = r.attempts.reduce((s, a) => s + a.ms, 0);
  times.push(ms);
  if (r.output) passed += 1;
  console.log(`\n${r.output ? '✔' : '✖'} ${k + 1}. ${name} — ${(ms / 1000).toFixed(1)} sn, ${r.attempts.length} istek`);
  console.log(`  bulgular: ${result.findings.map((f) => `${f.id} ${f.type}`).join(', ') || '(yok)'}`
    + ` · değerlendirilmeyen: ${JSON.stringify(result.summary.not_evaluated)}`);
  for (const a of r.attempts) if (a.errors.length) console.log(`  red: ${a.errors.join(' · ')}`);
  const out = r.output ?? (() => { try { return JSON.parse(r.attempts.at(-1).raw); } catch { return null; } })();
  if (out) {
    console.log(`  feedback: ${out.feedback}`);
    console.log(`  odak ${out.focus_finding} · sonraki ${out.next_exercise_id} @ ${out.next_bpm} · ${out.reason}`);
  }
  if (k === 0 && !only) {
    const q = await askQuestion('Entonasyonum nasıldı?', input, { model });
    console.log(`  soru-cevap (ölçülmeyen konu): ${q.text ?? `RED ${q.errors.join(' · ')} — ${q.raw}`}`);
  }
}
const sorted = [...times].sort((a, b) => a - b);
console.log(`\n${passed}/${times.length} doğrulayıcıdan geçti · medyan ${(sorted[Math.floor(sorted.length / 2)] / 1000).toFixed(1)} sn`
  + ` · en uzun ${(sorted.at(-1) / 1000).toFixed(1)} sn (hedef 10 sn)`);
process.exit(passed === times.length ? 0 : 1);
