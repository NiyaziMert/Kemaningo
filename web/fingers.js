// Parmak şeritleri: S satırındaki fmask'ten "kaçıncı parmak" (0 = boş tel, 1–4). Saf modül.
//
// Bakır tel parmakla bir folyoya bastırılınca ikisi değer. Sopanın değdiği tel GND'de olduğu için
// o folyo LOW olur ve fmask'te biti 1 olur. Bu yüzden:
//   - sopa bir teldeyken (mask ≠ 0): parmak = fmask'te en yüksek numaralı şerit (yoksa boş tel)
//   - sopa telde değilken (mask = 0): folyo okunamaz; parmak son değerinde tutulur. Yay temasındaki
//     kısa boşluklarda perde boş tele düşüp titremesin diye.
// Sıçrama süzgeci firmware'de (art arda 2 düşük örnek); burada ek bekleme yoktur.

import { FINGER_SEMITONES } from './thresholds.js';

export function createFingerTracker() {
  let finger = 0;
  let fmask = 0;
  let available = false;

  function process(s) {
    if (s.fmask === null || s.fmask === undefined) { // şeritsiz kaynak (eski firmware ya da kayıt)
      available = false;
      s.finger = 0;
      return s;
    }
    available = true;
    fmask = s.fmask;
    if (s.mask !== 0) finger = fmask ? 32 - Math.clz32(fmask) : 0; // en yüksek bit: 1–4
    s.finger = finger;
    return s;
  }

  return {
    process,
    get state() { return { available, fmask, finger }; },
  };
}

// Çalınan notanın MIDI numarası: açık tel + parmağın yarım sesi.
export const playedMidi = (openMidi, finger) => openMidi + FINGER_SEMITONES[finger];
