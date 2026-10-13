import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFingerTracker, playedMidi } from '../web/fingers.js';
import { createSimEngine } from '../web/sources/simulator.js';
import { createParser } from '../web/protocol.js';

const s = (mask, fmask) => ({ mask, fmask, finger: 0 });

test('sopa teldeyken parmak = en yüksek LOW şerit; hiçbiri yoksa boş tel', () => {
  const tr = createFingerTracker();
  assert.equal(tr.process(s(4, 0b0100)).finger, 3);
  assert.equal(tr.process(s(4, 0b1011)).finger, 4);
  assert.equal(tr.process(s(4, 0b0001)).finger, 1);
  assert.equal(tr.process(s(4, 0)).finger, 0);
});

test('sopa telde değilken parmak son değerinde tutulur (temas boşluğunda perde titremez)', () => {
  const tr = createFingerTracker();
  tr.process(s(4, 0b0010));
  assert.equal(tr.process(s(0, 0)).finger, 2);
  assert.equal(tr.process(s(0, 0)).finger, 2);
  assert.equal(tr.process(s(1, 0)).finger, 0); // sopa başka tele değdi, şerit yok: boş tel
});

test('şeritsiz kaynak (fmask = null): parmak 0, "yok" bildirilir', () => {
  const tr = createFingerTracker();
  assert.equal(tr.process(s(4, null)).finger, 0);
  assert.equal(tr.state.available, false);
});

test('çalınan nota: açık tel + 0, 2, 4, 5, 7 yarım ses', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((f) => playedMidi(69, f)), [69, 71, 73, 74, 76]); // A4 B4 C#5 D5 E5
  assert.equal(playedMidi(55, 4), 62); // Sol telinde 4. parmak = boş Re
});

test('simülatör: 3 tuşu basılıyken ve sopa La telindeyken zincirden parmak 3; sopa yokken fmask 0', () => {
  const e = createSimEngine({ rng: () => 0.5 });
  const tr = createFingerTracker();
  let last = null;
  const p = createParser({ onSample: (x) => { last = tr.process(x); } });
  e.input.fingers = [3];
  p.push(e.next(), 0);
  assert.equal(last.fmask, 0); // sopa telde değil: folyo LOW olamaz
  e.input.mask = 4;
  p.push(e.next(), 0);
  assert.equal(last.fmask, 0b0100);
  assert.equal(last.finger, 3);
});
