// Canlı temas izleyici: kartın satırlarını stdin'den okur, temas başlayınca ve bitince
// yazar, kesinleşen notaları sayar. Donanımı (tel, yay, GND kablosu) denerken kullanılır.
//   tools/live.sh            (kartı kendisi açar)
//   ... | node tools/live.mjs
import { createInterface } from 'node:readline';
import { createParser } from '../web/protocol.js';
import { createStrokeSegmenter } from '../web/strokes.js';
import { STRING_NAMES } from '../web/song.js';
import { createFingerTracker } from '../web/fingers.js';

// --touch: her 0,5 sn'de folyoların durumunu (fmask) yazar.
const showTouch = process.argv.includes('--touch');
const fingers = createFingerTracker();
let lastFinger = 0;
let lastTouchPrint = 0;

let lastMask = 0;
let since = 0;
let notes = 0;
let sawData = false;
const t0 = Date.now();
const clock = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const names = (m) => STRING_NAMES.filter((_, i) => m & (1 << i)).join('+') || '–';

const strokes = createStrokeSegmenter({
  useImu: false,
  onEvent(e) {
    if (e.type === 'stroke_end') {
      if (e.confirmed) notes += 1;
      console.log(`${clock()}  ${e.confirmed ? `♪ NOTA #${notes}` : '  (kısa, nota sayılmadı)'}`
        + ` ${STRING_NAMES[e.string]} ${e.dur_ms} ms · temas kesintisi ${e.gap_count} kez`);
    }
  },
});

const parser = createParser({
  onSample(s) {
    if (!sawData) { sawData = true; console.log(`${clock()}  veri geliyor; tele dokunmayı dene (çıkış: Ctrl+C)`); }
    fingers.process(s);
    if (s.finger !== lastFinger) {
      console.log(`${clock()}  PARMAK ${s.finger ? `${s.finger}. şerit` : 'boş tel'}`);
      lastFinger = s.finger;
    }
    if (showTouch && s.fmask !== null && s.t - lastTouchPrint >= 500) {
      lastTouchPrint = s.t;
      console.log(`${clock()}  folyo ${[1, 2, 3, 4].map((f) => ((s.fmask >> (f - 1)) & 1 ? f : '·')).join(' ')}`);
    }
    if (s.mask !== lastMask) {
      if (s.mask) console.log(`${clock()}  TEMAS ${names(s.mask)}`);
      else console.log(`${clock()}  temas bitti (${s.t - since} ms)`);
      since = s.t;
      lastMask = s.mask;
    }
    strokes.push(s);
  },
});

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => parser.push(line, Date.now()));
rl.on('close', () => console.log(`\nToplam ${notes} nota.`));
