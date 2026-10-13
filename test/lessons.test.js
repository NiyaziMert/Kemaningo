import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LESSONS, checkWait, createLessonRunner, snapshot, emptyProgress, completeStep, completeLesson,
  lessonStates, noteMidi, XP_PER_STEP,
} from '../web/lessons.js';

const world = (o = {}) => ({ sourceLive: false, sim: false, audioOn: false, mask: 0, played: [], attempts: 0, questions: 0, ...o });
const n = (string, finger) => ({ string, finger, midi: noteMidi(string, finger) });

test('her dersin kimliği eşsiz, her adımın sözü var, koşul türleri tanınıyor', () => {
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LESSONS) {
    for (const s of l.steps) {
      assert.ok(s.say.length > 10, `${l.id}: söz boş`);
      if (s.wait) assert.doesNotThrow(() => checkWait(s.wait, world(), snapshot(world())));
    }
  }
});

test('koşullar: kaynak, ses, anlık temas', () => {
  const st = snapshot(world());
  assert.equal(checkWait({ type: 'source' }, world({ sourceLive: true }), st), true);
  assert.equal(checkWait({ type: 'sound' }, world(), st), false);
  assert.equal(checkWait({ type: 'touch', string: 2 }, world({ mask: 4 }), st), true);
  assert.equal(checkWait({ type: 'touch', string: 2 }, world({ mask: 2 }), st), false);
});

test('nota koşulu yalnızca adım başladıktan sonra çalınanlara bakar', () => {
  const before = world({ played: [n(2, 3)] });
  const st = snapshot(before);
  assert.equal(checkWait({ type: 'note', string: 2, finger: 3 }, before, st), false);
  assert.equal(checkWait({ type: 'note', string: 2, finger: 3 }, world({ played: [n(2, 3), n(2, 3)] }), st), true);
  assert.equal(checkWait({ type: 'note', string: 2, finger: 3 }, world({ played: [n(2, 3), n(2, 2)] }), st), false);
});

test('dört tel ve sıra koşulları', () => {
  const st = snapshot(world());
  assert.equal(checkWait({ type: 'all-strings' }, world({ played: [n(0, 0), n(1, 0), n(2, 0)] }), st), false);
  assert.equal(checkWait({ type: 'all-strings' }, world({ played: [n(0, 0), n(1, 0), n(3, 2), n(2, 0)] }), st), true);
  const seq = { type: 'sequence', notes: [[2, 0], [2, 1], [2, 2]] };
  assert.equal(checkWait(seq, world({ played: [n(2, 0), n(3, 0), n(2, 1), n(2, 2)] }), st), true);
  assert.equal(checkWait(seq, world({ played: [n(2, 1), n(2, 0), n(2, 2)] }), st), false);
});

test('ders yürütücü: koşul sağlanınca justDone bir kez; next sonraki adıma geçer', () => {
  const r = createLessonRunner(LESSONS.find((l) => l.id === 'ilk-ses'));
  r.begin(world());
  assert.deepEqual(r.check(world({ mask: 0 })), { ok: false, justDone: false });
  assert.deepEqual(r.check(world({ mask: 4 })), { ok: true, justDone: true });
  assert.deepEqual(r.check(world({ mask: 4 })), { ok: true, justDone: false });
  // Tel bırakıldı: adım başarılı kalır.
  assert.deepEqual(r.check(world({ mask: 0 })), { ok: true, justDone: false });
  r.next(world());
  assert.equal(r.index, 1);
  assert.equal(r.check(world({ played: [n(2, 0)] })).ok, true);
  r.next(world());
  assert.equal(r.finished, true);
});

test('ilerleme: XP, gün serisi, ders yolu', () => {
  let p = emptyProgress();
  p = completeStep(p, '2026-10-12');
  assert.deepEqual([p.xp, p.streak], [XP_PER_STEP, 1]);
  p = completeStep(p, '2026-10-12');
  assert.deepEqual([p.xp, p.streak], [2 * XP_PER_STEP, 1]);
  p = completeStep(p, '2026-10-13');
  assert.equal(p.streak, 2);
  p = completeStep(p, '2026-10-15'); // bir gün atlandı
  assert.equal(p.streak, 1);
  assert.deepEqual(lessonStates(p).slice(0, 2), ['open', 'locked']);
  p = completeLesson(p, 'tanis');
  assert.deepEqual(lessonStates(p).slice(0, 3), ['done', 'open', 'locked']);
});
