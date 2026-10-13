// Şarkı yükleme: perde → MIDI, tel ve yay yönü türetme, start_beat ekleme.
// Saf modül: tarayıcı API'si kullanmaz, dosyayı main.js okur.

export const STRING_NAMES = ['Sol', 'Re', 'La', 'Mi'];
// Açık tellerin MIDI numaraları: G3, D4, A4, E5. İndeks = mask'teki bit.
export const OPEN_MIDI = [55, 62, 69, 76];

export const ERROR_TYPES = [
  'wrong_string', 'neighbor_touch', 'early', 'late', 'wrong_bow_dir', 'uneven_speed',
];

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export class SongError extends Error {}

// "A4" → 69, "F#5" → 78, "Bb3" → 58. Geçersizse SongError.
export function pitchToMidi(pitch) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(pitch);
  if (!m) throw new SongError(`Geçersiz perde: "${pitch}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + acc;
}

// Açık sesi perdeden yüksek olmayan en tiz tel. G3'ün altı için -1.
export function stringForMidi(midi) {
  for (let s = OPEN_MIDI.length - 1; s >= 0; s--) {
    if (OPEN_MIDI[s] <= midi) return s;
  }
  return -1;
}

const flip = (bow) => (bow === 'D' ? 'U' : 'D');

function requireField(raw, key, check, what) {
  if (!(key in raw)) throw new SongError(`Eksik alan: "${key}"`);
  if (!check(raw[key])) throw new SongError(`"${key}" ${what} olmalı`);
}

// Ham JSON nesnesini doğrular ve notaları türetilmiş alanlarla döndürür.
export function parseSong(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SongError('Şarkı bir JSON nesnesi olmalı');
  }
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const isPosNum = (v) => typeof v === 'number' && v > 0;
  requireField(raw, 'id', isStr, 'boş olmayan metin');
  requireField(raw, 'title', isStr, 'boş olmayan metin');
  requireField(raw, 'bpm', isPosNum, 'pozitif sayı');
  requireField(raw, 'beats_per_bar', Number.isInteger, 'tamsayı');
  requireField(raw, 'level', Number.isInteger, 'tamsayı');
  requireField(raw, 'targets', (v) => Array.isArray(v) && v.every((t) => ERROR_TYPES.includes(t)),
    'bilinen hata türlerinin listesi');
  requireField(raw, 'notes', (v) => Array.isArray(v) && v.length > 0, 'boş olmayan liste');

  const notes = [];
  let beat = 0;
  let nextBow = 'D'; // ilk nota çekerek başlar

  raw.notes.forEach((entry, i) => {
    const index = i + 1;
    const where = `${index}. nota`;
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) {
      throw new SongError(`${where}: [perde, vuruş] ya da [perde, vuruş, {...}] olmalı`);
    }
    const [pitch, dur, opts = {}] = entry;
    if (!isPosNum(dur)) throw new SongError(`${where}: süre pozitif sayı olmalı`);
    if (typeof opts !== 'object' || opts === null) throw new SongError(`${where}: üçüncü eleman nesne olmalı`);

    const note = { index, pitch, rest: pitch === 'R', midi: null, string: null, bow: null,
      start_beat: beat, dur_beats: dur };
    beat += dur;

    if (note.rest) { // sus: tel yok, yay yönü değişmez
      notes.push(note);
      return;
    }

    try {
      note.midi = pitchToMidi(pitch);
    } catch (e) {
      throw new SongError(`${where}: ${e.message}`);
    }

    if (opts.string !== undefined) {
      const s = STRING_NAMES.indexOf(opts.string);
      if (s < 0) throw new SongError(`${where}: bilinmeyen tel "${opts.string}"`);
      if (OPEN_MIDI[s] > note.midi) {
        throw new SongError(`${where}: ${pitch}, ${opts.string} telinin açık sesinden pes`);
      }
      note.string = s;
    } else {
      note.string = stringForMidi(note.midi);
      if (note.string < 0) throw new SongError(`${where}: ${pitch} kemanın en pes sesi G3'ün altında`);
    }

    if (opts.bow !== undefined) {
      if (opts.bow !== 'D' && opts.bow !== 'U') throw new SongError(`${where}: bow "D" ya da "U" olmalı`);
      nextBow = opts.bow;
    }
    note.bow = nextBow;
    nextBow = flip(nextBow);

    notes.push(note);
  });

  return {
    id: raw.id, title: raw.title, bpm: raw.bpm, beats_per_bar: raw.beats_per_bar,
    level: raw.level, targets: [...raw.targets], notes, total_beats: beat,
  };
}
