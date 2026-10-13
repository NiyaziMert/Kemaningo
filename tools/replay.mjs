// Kayıt dosyasını uygulamanın zincirinden geçirir ve raporlar.
//   node tools/replay.mjs recordings/kayit.txt [--imu | --no-imu] [--list]
// IMU kipi verilmezse kayıttaki H satırından (imu_ok) seçilir.
import { readRecording, imuOkOf, runPipeline, percentile } from './lib.mjs';
import { STRING_NAMES } from '../web/song.js';

const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!path) {
  console.error('Kullanım: node tools/replay.mjs <kayıt.txt> [--imu | --no-imu] [--list]');
  process.exit(1);
}
const entries = readRecording(path);
const fromFile = imuOkOf(entries);
const useImu = process.argv.includes('--imu') ? true : process.argv.includes('--no-imu') ? false : fromFile ?? true;
const { samples, health, events, stats } = runPipeline(entries, { useImu });

// Satır akışı
const sLines = entries.filter((e) => e.line.startsWith('S,'));
const tUs = sLines.map((e) => Number(e.line.split(',')[1]));
const jumps = tUs.slice(1).map((t, i) => (t - tUs[i] + 2 ** 32) % 2 ** 32).filter((d) => d !== 5000);
const hostT = sLines.map((e) => e.t_host).filter((t) => t !== null);
const durS = samples.length ? (samples.at(-1).t - samples[0].t) / 1000 : 0;
const arrivals = hostT.slice(1).map((t, i) => t - hostT[i]);

console.log(`Kayıt: ${path}`);
console.log(`  satır: S ${stats.s} · H ${stats.h} · bozuk ${stats.bad} · diğer ${stats.other}`);
console.log(`  süre ${durS.toFixed(1)} sn · satır hızı ${(stats.s / Math.max(durS, 1e-9)).toFixed(1)}/sn (hedef 200 ± 2)`);
console.log(`  t_us atlaması (fark ≠ 5000 µs): ${jumps.length}${jumps.length ? ` · örnek: ${jumps.slice(0, 5).join(', ')}` : ''}`);
if (arrivals.length) {
  console.log(`  varış aralığı (ms): p50 ${percentile(arrivals, 50).toFixed(1)} · p95 ${percentile(arrivals, 95).toFixed(1)}`
    + ` · en büyük ${Math.max(...arrivals).toFixed(1)}`);
}
if (health.length) {
  const h = health.at(-1);
  console.log(`  H: fw ${h.fw} · imu_ok ${h.imu_ok ? 1 : 0} · i2c_err ${h.i2c_err}`);
}

// Çekişler
const ends = events.filter((e) => e.type === 'stroke_end');
const ok = ends.filter((e) => e.confirmed);
const byCause = (list) => Object.entries(list.reduce((m, e) => ({ ...m, [e.cause]: (m[e.cause] ?? 0) + 1 }), {}))
  .map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`\nIMU kipi: ${useImu ? 'açık' : 'kapalı (yalnızca temas)'}${fromFile === null ? '' : ` · kayıttaki imu_ok ${fromFile ? 1 : 0}`}`);
console.log(`  stroke_start ${events.filter((e) => e.type === 'stroke_start').length}`
  + ` · kesinleşen ${ok.length} · iptal ${ends.length - ok.length}`);
console.log(`  bitiş nedenleri (kesinleşen): ${byCause(ok) || '–'}`);
if (ok.length) {
  const d = ok.map((e) => e.dur_ms);
  console.log(`  süre (ms): en kısa ${Math.min(...d)} · p50 ${percentile(d, 50)} · en uzun ${Math.max(...d)}`);
}
if (process.argv.includes('--list')) {
  for (const e of ends) {
    console.log(`  #${e.id} ${STRING_NAMES[e.string]} ${e.t.toFixed(0)} ms · ${e.dur_ms} ms · ${e.cause}`
      + ` · ${e.confirmed ? 'kesin' : 'İPTAL'} · boşluk ${e.gap_count}/${e.max_gap_ms} ms · yön ${e.dir ?? '–'}`);
  }
}
