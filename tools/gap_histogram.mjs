// Temas boşluklarının süre dağılımı ve T_GAP_MS önerisi (Aşama 8, Risk 2).
//   node tools/gap_histogram.mjs --long uzun.txt --lift kaldir.txt [--string 2]
// uzun.txt: sopayı kaldırmadan çekilen uzun çekişler (içindeki boşluklar gürültüdür).
// kaldir.txt: notalar arasında sopayı kaldırıp koyma (boşluklar gerçek nota sonudur).
// Boşluk: iki temas arasında maskede telin biti 0 olan ardışık örnekler (5 ms çözünürlük).
import { readRecording, arg, percentile } from './lib.mjs';
import { parseLine } from '../web/protocol.js';
import { STRING_NAMES } from '../web/song.js';
import { T_GAP_MS } from '../web/thresholds.js';

const string = Number(arg('string', 2));
const files = { long: arg('long'), lift: arg('lift') };
if (!files.long && !files.lift) {
  console.error('Kullanım: node tools/gap_histogram.mjs --long uzun.txt --lift kaldir.txt [--string 2]');
  process.exit(1);
}

export function gapsOf(entries, s) {
  const gaps = [];
  let seenContact = false;
  let run = 0;
  for (const { line } of entries) {
    const p = parseLine(line);
    if (p?.type !== 'S') continue;
    if (p.mask & (1 << s)) {
      if (seenContact && run > 0) gaps.push(run * 5);
      seenContact = true;
      run = 0;
    } else if (seenContact) {
      run += 1;
    }
  }
  return gaps; // sondaki (kapanmayan) boşluk sayılmaz
}

const BINS = [5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500, Infinity];
function histogram(gaps) {
  const counts = BINS.map(() => 0);
  for (const g of gaps) counts[BINS.findIndex((b) => g <= b)] += 1;
  const max = Math.max(1, ...counts);
  let lo = 0;
  return BINS.map((b, i) => {
    const label = `${String(lo).padStart(3)}–${b === Infinity ? '   ' : String(b).padEnd(3)} ms`;
    lo = b;
    return counts[i] ? `  ${label} ${'█'.repeat(Math.ceil((counts[i] / max) * 40))} ${counts[i]}` : null;
  }).filter(Boolean).join('\n');
}

console.log(`Tel: ${STRING_NAMES[string]} (bit ${string}) · şimdiki T_GAP_MS = ${T_GAP_MS}`);
const result = {};
for (const [kind, path] of Object.entries(files)) {
  if (!path) continue;
  const gaps = gapsOf(readRecording(path), string);
  result[kind] = gaps;
  const title = kind === 'long' ? 'Uzun çekişler (gürültü boşlukları)' : 'Kaldır-koy (nota arası boşluklar)';
  console.log(`\n${title}: ${path}`);
  if (!gaps.length) { console.log('  boşluk yok'); continue; }
  console.log(`  ${gaps.length} boşluk · en kısa ${Math.min(...gaps)} · p50 ${percentile(gaps, 50)}`
    + ` · p95 ${percentile(gaps, 95)} · en uzun ${Math.max(...gaps)} ms`);
  console.log(histogram(gaps));
}

if (result.long && result.lift && result.lift.length) {
  const longMax = result.long.length ? Math.max(...result.long) : 0;
  const liftMin = Math.min(...result.lift);
  console.log('');
  if (longMax < liftMin) {
    const t = Math.round((longMax + liftMin) / 2 / 5) * 5;
    console.log(`Dağılımlar ayrık: uzun çekişte en uzun boşluk ${longMax} ms, kaldır-koyda en kısa ${liftMin} ms.`);
    console.log(`Öneri: T_GAP_MS = ${t} (ortası, 5 ms'ye yuvarlandı).`);
  } else {
    console.log(`Dağılımlar örtüşüyor: uzun çekişte ${longMax} ms'lik boşluk, kaldır-koyda ${liftMin} ms'lik boşluk var.`);
    console.log('Risk 2: eşiği uzun çekişlerdeki en uzun boşluğun üstüne çıkar ve Aşama 9\'u öne al,');
    console.log('ya da temas yüzeyini ve pin girişini gözden geçir (donanım kararı).');
  }
}
