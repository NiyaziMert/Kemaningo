import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { templateTeacher, nextOptions, levelUp, attemptNo, previousAttempt, TIPS } from '../web/teacher.js';
import { ERROR_TYPES } from '../web/song.js';

const dir = new URL('../web/songs/', import.meta.url);
const exercises = JSON.parse(readFileSync(new URL('index.json', dir)))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir))));
const ex = (id) => exercises.find((e) => e.id === id);

const result = (played, withError, findings = []) => ({
  summary: { notes_played: played, notes_with_error: withError, notes_clean: played - withError },
  findings,
});
const lateFinding = { id: 'F1', type: 'late', fact: '3 notada (3, 7, 11) geç girdin; ortalama 130 ms.' };

test('en az beş başlangıç egzersizi var ve her hata türü en az birinde hedefleniyor', () => {
  assert.ok(exercises.length >= 5);
  for (const t of ERROR_TYPES) assert.ok(exercises.some((e) => e.targets.includes(t)), t);
});

test('her hata türü için en az bir ipucu', () => {
  for (const t of ERROR_TYPES) assert.ok(TIPS[t]?.length >= 1, t);
});

test('metin: odak bulgunun olgu cümlesi + ilk ipucu', () => {
  const out = templateTeacher({ result: result(16, 3, [lateFinding]), exercise: ex('daha_dun'), exercises, bpm: 60, history: [] });
  assert.equal(out.feedback, `${lateFinding.fact} ${TIPS.late[0]}`);
  assert.equal(out.focus_finding, 'F1');
});

test('bulgu yoksa hata bulunmadığını söyler', () => {
  const out = templateTeacher({ result: result(14, 0), exercise: ex('daha_dun'), exercises, bpm: 60, history: [] });
  assert.match(out.feedback, /Hata bulunmadı/);
  assert.equal(out.focus_finding, null);
});

test('hatalı nota oranı > %30: aynı egzersiz, tempo 8 düşer', () => {
  const out = templateTeacher({ result: result(10, 4, [lateFinding]), exercise: ex('daha_dun'), exercises, bpm: 60, history: [] });
  assert.deepEqual([out.next_exercise_id, out.next_bpm], ['daha_dun', 52]);
});

test('%10 ile %30 arası (sınırlar dahil): aynı egzersiz, aynı tempo', () => {
  for (const [p, e] of [[10, 1], [10, 3], [20, 4]]) {
    const out = templateTeacher({ result: result(p, e, [lateFinding]), exercise: ex('daha_dun'), exercises, bpm: 60, history: [] });
    assert.deepEqual([out.next_exercise_id, out.next_bpm], ['daha_dun', 60], `${e}/${p}`);
  }
});

test('%10\'un altı: tempo 6 artar; art arda ikinci kezse bir üst seviye', () => {
  const first = templateTeacher({ result: result(16, 1), exercise: ex('acik_dortluk'), exercises, bpm: 60, history: [] });
  assert.deepEqual([first.next_exercise_id, first.next_bpm], ['acik_dortluk', 66]);
  const history = [{ exercise_id: 'acik_dortluk', bpm: 60, notes_played: 16, notes_with_error: 0 }];
  const second = templateTeacher({ result: result(16, 1), exercise: ex('acik_dortluk'), exercises, bpm: 66, history });
  assert.equal(ex(second.next_exercise_id).level, 2);
  // Önceki deneme %10'un üstündeyse seviye atlanmaz.
  const worse = [{ exercise_id: 'acik_dortluk', bpm: 60, notes_played: 16, notes_with_error: 5 }];
  const third = templateTeacher({ result: result(16, 1), exercise: ex('acik_dortluk'), exercises, bpm: 66, history: worse });
  assert.deepEqual([third.next_exercise_id, third.next_bpm], ['acik_dortluk', 72]);
});

test('tempo 40 ile 120 arasında kalır', () => {
  const slow = templateTeacher({ result: result(10, 9, [lateFinding]), exercise: ex('daha_dun'), exercises, bpm: 44, history: [] });
  assert.equal(slow.next_bpm, 40);
  const fast = templateTeacher({ result: result(10, 0), exercise: ex('daha_dun'), exercises, bpm: 118, history: [] });
  assert.equal(fast.next_bpm, 120);
});

test('en üst seviyede seviye atlanamaz, tempo artar', () => {
  const history = [{ exercise_id: 'daha_dun', bpm: 60, notes_played: 14, notes_with_error: 0 }];
  const out = templateTeacher({ result: result(14, 0), exercise: ex('daha_dun'), exercises, bpm: 60, history });
  assert.deepEqual([out.next_exercise_id, out.next_bpm], ['daha_dun', 66]);
});

test('seviye atlarken en sık bulgunun türünü hedefleyen egzersiz seçilir', () => {
  const up = levelUp(ex('acik_dortluk'), [{ type: 'neighbor_touch' }], exercises);
  assert.equal(up.id, 'gecis_komsu');
  assert.equal(levelUp(ex('acik_dortluk'), [{ type: 'late' }], exercises).id, 'ritim_karisik');
});

test('nextOptions: plandaki örnek (60 vuruş/dk → 48–66), tekrar yok', () => {
  const findings = [{ type: 'neighbor_touch' }, { type: 'late' }];
  const o = nextOptions(ex('gecis_komsu'), findings, exercises, 60);
  assert.equal(o.bpm_min, 48);
  assert.equal(o.bpm_max, 66);
  assert.equal(o.exercises[0].id, 'gecis_komsu');
  const ids = o.exercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('daha_dun')); // bir üst seviye
});

test('geçmiş: deneme numarası ve önceki deneme', () => {
  const h = [{ exercise_id: 'a', bpm: 60 }, { exercise_id: 'b', bpm: 50 }, { exercise_id: 'a', bpm: 66 }];
  assert.equal(attemptNo(h, 'a'), 3);
  assert.equal(previousAttempt(h, 'a').bpm, 66);
  assert.equal(previousAttempt(h, 'c'), null);
});

// ---------------------------------------------------------------- Dil modeli (model gerektirmez)
import { buildModelInput, validateOutput, askModel, askQuestion, outputSchema, numbersIn } from '../web/teacher.js';

// Plandaki örnek girdi.
const planFindings = [
  { id: 'F1', type: 'neighbor_touch', count: 4, notes: [3, 7, 11, 15], avg_ms: 35, at_string_change: 4,
    fact: "4 notada (3, 7, 11, 15) La telini çalarken Re teline de değdin; ortalama 35 ms. Hepsi tel değiştirdiğin notalar." },
  { id: 'F2', type: 'late', count: 3, notes: [3, 7, 11], avg_ms: 130, at_string_change: 3,
    fact: '3 notada (3, 7, 11) geç girdin; ortalama 130 ms. Hepsi tel değiştirdiğin notalar.' },
  { id: 'F3', type: 'uneven_speed', count: 1, notes: [16], avg: 0.9, at_string_change: 0,
    fact: '1 notada (16) yay hızın düzensizdi.' },
];
const planInput = buildModelInput({
  exercise: ex('gecis_komsu'), bpm: 60, noteCount: 16, attemptNo: 3,
  result: {
    summary: { notes_clean: 11, notes_with_error: 5,
      counts: { wrong_string: 0, neighbor_touch: 4, early: 0, late: 3, wrong_bow_dir: 0, uneven_speed: 1 },
      not_evaluated: { timing: 0, bow_dir: 1, bow_speed: 0 } },
    findings: planFindings,
  },
  previous: { bpm: 60, notes_with_error: 8 },
  options: nextOptions(ex('gecis_komsu'), planFindings, exercises, 60),
});
const planOutput = {
  feedback: "16 notanın 11'i temizdi ve hiç yanlış tele gitmedin. En çok Re'den La'ya geçerken zorlandın: 3, 7, 11 ve 15. notalarda La'yı çalarken Re teline de değdin. Tel değiştirmeden önce sopanın açısını La teline göre ayarla, sonra çek. Aynı geçişlerde biraz geç de kaldın; daha yavaş tempoda ikisi birlikte düzelir.",
  focus_finding: 'F1',
  next_exercise_id: 'gecis_komsu',
  next_bpm: 52,
  reason: 'Hatalar tel geçişlerinde toplandığı için aynı egzersizi daha yavaş tekrarlıyoruz.',
};

test('girdi: plandaki alanlar, ipuçları eklenmiş', () => {
  assert.deepEqual(Object.keys(planInput), ['session', 'summary', 'findings', 'previous', 'next_options']);
  assert.equal(planInput.session.attempt_no, 3);
  assert.deepEqual(planInput.findings[0].tips, TIPS.neighbor_touch);
  assert.equal(planInput.next_options.bpm_min, 48);
});

test('şema: kimlikler ve egzersizler enum, tempo aralığı', () => {
  const s = outputSchema(planInput);
  assert.deepEqual(s.properties.focus_finding.enum, ['F1', 'F2', 'F3', null]);
  assert.equal(s.properties.next_bpm.minimum, 48);
  assert.equal(s.properties.next_bpm.maximum, 66);
});

test('doğrulama: plandaki örnek çıktı geçer', () => {
  assert.deepEqual(validateOutput(planOutput, planInput), { ok: true, errors: [] });
});

test('doğrulama: geçersiz egzersiz kimliği reddedilir', () => {
  const v = validateOutput({ ...planOutput, next_exercise_id: 'uydurma' }, planInput);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /next_exercise_id/);
});

test('doğrulama: aralık dışı tempo reddedilir', () => {
  assert.equal(validateOutput({ ...planOutput, next_bpm: 70 }, planInput).ok, false);
  assert.equal(validateOutput({ ...planOutput, next_bpm: 47 }, planInput).ok, false);
  assert.equal(validateOutput({ ...planOutput, next_bpm: 52.5 }, planInput).ok, false);
});

test('doğrulama: girdide olmayan sayı reddedilir; seçilen tempo serbest', () => {
  const v = validateOutput({ ...planOutput, feedback: '9. notada da sorun vardı. Çok iyiydi.' }, planInput);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /girdide olmayan sayı: 9/);
  assert.equal(validateOutput({ ...planOutput, feedback: 'Tempoyu 52 yapıyoruz. Güzel.' }, planInput).ok, true);
});

test('doğrulama: odak bulgu, uzunluk ve ölçülmeyen konular', () => {
  assert.equal(validateOutput({ ...planOutput, focus_finding: 'F9' }, planInput).ok, false);
  assert.equal(validateOutput({ ...planOutput, feedback: 'a'.repeat(601) }, planInput).ok, false);
  assert.equal(validateOutput({ ...planOutput, feedback: 'Entonasyonun çok iyi.' }, planInput).ok, false);
  assert.equal(validateOutput({ ...planOutput, feedback: 'Vibrato güzeldi.' }, planInput).ok, false);
  const empty = { ...planInput, findings: [] };
  assert.equal(validateOutput({ ...planOutput, focus_finding: null, feedback: 'Hata yok, harika.' }, empty).ok, true);
  assert.equal(validateOutput({ ...planOutput, focus_finding: 'F1', feedback: 'Hata yok.' }, empty).ok, false);
});

test('numbersIn: virgüllü ondalık ve sıra sayıları', () => {
  assert.deepEqual(numbersIn("3. ve 15. notalarda 0,9 m/s², 11'i"), [3, 15, 0.9, 11]);
});

// Sahte Ollama: sırayla verilen yanıtları döndürür.
function fakeOllama(...contents) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const c = contents.shift();
    if (c instanceof Error) throw c;
    return { ok: true, json: async () => ({ message: { content: c } }) };
  };
  return { fetchImpl, calls };
}

test('askModel: istek ayarları plandaki gibi; geçerli yanıt kabul edilir', async () => {
  const { fetchImpl, calls } = fakeOllama(JSON.stringify(planOutput));
  const r = await askModel(planInput, { fetchImpl });
  assert.equal(r.output.source, 'model');
  assert.equal(r.output.next_bpm, 52);
  const req = calls[0];
  assert.equal(req.stream, false);
  assert.equal(req.think, false);
  assert.deepEqual(req.options, { temperature: 0, num_ctx: 4096 });
  assert.equal(req.format.properties.next_bpm.maximum, 66);
  assert.match(req.messages[0].content, /JSON şemasına uymalı/); // şema talimatın sonunda
});

test('askModel: ilk yanıt geçersizse bir kez yineler', async () => {
  const { fetchImpl, calls } = fakeOllama(JSON.stringify({ ...planOutput, next_bpm: 99 }), JSON.stringify(planOutput));
  const r = await askModel(planInput, { fetchImpl });
  assert.equal(calls.length, 2);
  assert.ok(r.output);
});

test('askModel: iki kez geçersizse ya da bağlantı yoksa çıktı null (şablona dönülür)', async () => {
  const bad = JSON.stringify({ ...planOutput, next_exercise_id: 'x' });
  const r1 = await askModel(planInput, fakeOllama(bad, bad));
  assert.equal(r1.output, null);
  const r2 = await askModel(planInput, fakeOllama(new TypeError('fetch failed')));
  assert.equal(r2.output, null);
  assert.equal(r2.attempts.length, 1);
  const r3 = await askModel(planInput, fakeOllama('bu JSON değil', 'yine değil'));
  assert.equal(r3.output, null);
});

test('askQuestion: ölçülmeyen konu sorulunca "ölçmüyor" yanıtı kabul edilir; uydurma sayı reddedilir', async () => {
  const ok = await askQuestion('Entonasyonum nasıl?', planInput,
    fakeOllama('Bu alet entonasyonu ölçmüyor; yalnızca yayını ölçüyor. Son denemende 16 notanın 11\'i temizdi.'));
  assert.ok(ok.text, ok.errors.join());
  const bad = await askQuestion('Nasıldım?', planInput,
    fakeOllama('Notaların 93 tanesi harikaydı.', 'Notaların 94 tanesi harikaydı.'));
  assert.equal(bad.text, null);
  // İlk yanıt alan adı içeriyor, ikincisi temiz: yinelemeyle kabul edilir.
  const retry = await askQuestion('Kaç nota temizdi?', planInput,
    fakeOllama('notes_clean değeri 11.', "16 notanın 11'i temizdi."));
  assert.equal(retry.text, "16 notanın 11'i temizdi.");
});

import { checkClaims } from '../web/teacher.js';

test('checkClaims: görülmeyen hatadan söz eden olumlu cümle reddedilir, olumsuz cümle serbest', () => {
  const none = { summary: { counts: { wrong_string: 0, neighbor_touch: 0, early: 0, late: 0, wrong_bow_dir: 0, uneven_speed: 0 } } };
  assert.deepEqual(checkClaims('Hem yanlış telleri hem de gecikmeleri düzeltmeye odaklanmalıyız.', none),
    ['bulguda olmayan hata: "yanlış tel"', 'bulguda olmayan hata: "gecikme"']);
  assert.deepEqual(checkClaims("16 notanın 11'i temizdi ve hiç yanlış tele gitmedin.", none), []);
  assert.deepEqual(checkClaims('Erken girmedin, zamanlaman iyiydi.', none), []);
  assert.deepEqual(checkClaims('Yay hızın düzensiz değildi.', none), []);
  // Hata gerçekten varsa söz edilebilir; soru o konuyu soruyorsa da serbest.
  assert.deepEqual(checkClaims('3. notada geç girdin.', planInput), []);
  assert.deepEqual(checkClaims('Erken girme sorunun yok gibi; ama dikkat et, erken başlamak kolaydır.', none, 'Erken mi girdim?'), []);
});

test('doğrulama: plandaki örnek çıktı claims denetiminden de geçer', () => {
  assert.deepEqual(validateOutput(planOutput, planInput).errors, []);
});

test('checkClaims: "geçerken" içindeki "erken" erken giriş sayılmaz', () => {
  const none = { summary: { counts: { early: 0 } } };
  assert.deepEqual(checkClaims('Re telinden La teline geçerken zorlandın.', none), []);
  assert.equal(checkClaims('Bazı notalarda erken girdin.', none).length, 1);
});

test('askQuestion: "değerlendiremedim" de "ölçmüyor" sayılır', async () => {
  const r = await askQuestion('Entonasyonum nasıldı?', planInput,
    fakeOllama('Entonasyonunu değerlendiremedim; bu alet yalnızca yayını ölçüyor.'));
  assert.ok(r.text, r.errors.join());
});

import { answerFingering } from '../web/teacher.js';

test('answerFingering: nota → konum, konum → nota; tablodan', () => {
  assert.equal(answerFingering('C#5 notasını hangi tel ve parmakla çalarım?'), 'C#5: La telinde 2. parmak.');
  assert.equal(answerFingering('D4 nasıl çalınır?'), 'D4: Re telinde boş tel. Öteki yol: Sol telinde 4. parmak.');
  assert.equal(answerFingering('Sol telinde 3. parmak hangi nota?'), 'Sol telinde 3. parmak: C4.');
  assert.equal(answerFingering('Mi teli boş hangi nota'), 'Mi telinde boş tel: E5.');
  assert.match(answerFingering('C5 nerede?'), /çalınamıyor/);
  assert.equal(answerFingering('Neden geç kaldım?'), null);
});

test('askQuestion: parmak sorusu modele gitmez', async () => {
  let called = false;
  const r = await askQuestion('F#4 hangi parmak?', {}, { fetchImpl: async () => { called = true; throw new Error('x'); } });
  assert.equal(r.text, 'F#4: Re telinde 2. parmak.');
  assert.equal(called, false);
});

import { answerUnmeasured } from '../web/teacher.js';

test('answerUnmeasured: ölçülmeyen konulara sabit yanıt', () => {
  assert.match(answerUnmeasured('Entonasyonum nasıl?'), /^Bu alet entonasyonu/);
  assert.match(answerUnmeasured('Vibratom nasıldı?'), /vibratoyu ölçmüyor/);
  assert.equal(answerUnmeasured('Neden geç kaldım?'), null);
});
