import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSong, pitchToMidi, SongError } from '../web/song.js';

const song = (notes, extra = {}) => ({
  id: 't', title: 'Test', bpm: 60, beats_per_bar: 4, level: 1, targets: [], notes, ...extra,
});
const one = (pitch, opts) => parseSong(song([opts ? [pitch, 1, opts] : [pitch, 1]])).notes[0];

test('pitchToMidi: A4 = 69, C4 = 60, F#5 = 78, Bb3 = 58', () => {
  assert.equal(pitchToMidi('A4'), 69);
  assert.equal(pitchToMidi('C4'), 60);
  assert.equal(pitchToMidi('F#5'), 78);
  assert.equal(pitchToMidi('Bb3'), 58);
  assert.throws(() => pitchToMidi('H4'), SongError);
});

test('sınır perdeler doğru tele gider', () => {
  const cases = { G3: 0, 'C#4': 0, D4: 1, 'G#4': 1, A4: 2, 'D#5': 2, E5: 3, A6: 3 };
  for (const [pitch, s] of Object.entries(cases)) {
    assert.equal(one(pitch).string, s, pitch);
  }
});

test('F#3 (G3 altı) hata verir', () => {
  assert.throws(() => one('F#3'), SongError);
});

test('elle yazılan tel önceliklidir', () => {
  assert.equal(one('A4', { string: 'Re' }).string, 1);
});

test('elle yazılan tel perdenin altında açık ses veriyorsa hata', () => {
  assert.throws(() => one('D4', { string: 'La' }), SongError);
  assert.throws(() => one('A4', { string: 'Do' }), SongError);
});

test('yay yönü dönüşümlüdür ve elle yazılan değerden devam eder', () => {
  const s = parseSong(song([
    ['A4', 1], ['A4', 1], ['A4', 1], ['A4', 1, { bow: 'U' }], ['A4', 1], ['A4', 1],
  ]));
  assert.deepEqual(s.notes.map((n) => n.bow), ['D', 'U', 'D', 'U', 'D', 'U']);
  const t = parseSong(song([['A4', 1], ['A4', 1, { bow: 'U' }], ['A4', 1]]));
  assert.deepEqual(t.notes.map((n) => n.bow), ['D', 'U', 'D']);
  const u = parseSong(song([['A4', 1], ['A4', 1, { bow: 'D' }], ['A4', 1]]));
  assert.deepEqual(u.notes.map((n) => n.bow), ['D', 'D', 'U']);
});

test('sus start_beat değerini ilerletir, yay yönünü değiştirmez', () => {
  const s = parseSong(song([['A4', 1], ['R', 2], ['A4', 1.5], ['A4', 1]]));
  assert.deepEqual(s.notes.map((n) => n.start_beat), [0, 1, 3, 4.5]);
  assert.equal(s.notes[1].rest, true);
  assert.equal(s.notes[1].string, null);
  assert.deepEqual(s.notes.filter((n) => !n.rest).map((n) => n.bow), ['D', 'U', 'D']);
  assert.equal(s.total_beats, 5.5);
});

test('hatalı dosya reddedilir', () => {
  assert.throws(() => parseSong(null), SongError);
  assert.throws(() => parseSong([]), SongError);
  const { bpm, ...noBpm } = song([['A4', 1]]);
  assert.throws(() => parseSong(noBpm), /bpm/);
  assert.throws(() => parseSong(song([])), /notes/);
  assert.throws(() => parseSong(song([['A4', 0]])), /1\. nota/);
  assert.throws(() => parseSong(song([['A4']])), SongError);
  assert.throws(() => parseSong(song([['A4', 1]], { targets: ['yanlis'] })), /targets/);
  assert.throws(() => parseSong(song([['A4', 1, { bow: 'X' }]])), SongError);
});

test('songs/ altındaki bütün dosyalar yüklenir', () => {
  const dir = new URL('../web/songs/', import.meta.url);
  const files = JSON.parse(readFileSync(new URL('index.json', dir)));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const s = parseSong(JSON.parse(readFileSync(new URL(f, dir))));
    assert.equal(`${s.id}.json`, f);
  }
});

test('Daha Dün Annemizin: tel ve vuruşlar', () => {
  const raw = JSON.parse(readFileSync(new URL('../web/songs/daha_dun.json', import.meta.url)));
  const s = parseSong(raw);
  assert.equal(s.notes.length, 14);
  assert.equal(s.total_beats, 16);
  assert.deepEqual(s.notes.map((n) => n.string), [2, 2, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(s.notes[7].start_beat, 8); // D5, üçüncü ölçünün başı
});
