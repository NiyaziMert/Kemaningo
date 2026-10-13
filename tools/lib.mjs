// Araçların ortak parçaları: kayıt dosyasını okuma ve uygulamadaki zinciri çalıştırma.
import { readFileSync } from 'node:fs';
import { parseRecording } from '../web/sources/replay.js';
import { createParser } from '../web/protocol.js';
import { createMotion } from '../web/motion.js';
import { createStrokeSegmenter } from '../web/strokes.js';

export const readRecording = (path) => parseRecording(readFileSync(path, 'utf8'));

// Kayıttaki ilk H satırının imu_ok değeri; H yoksa null.
export function imuOkOf(entries) {
  for (const { line } of entries) {
    if (line.startsWith('H,')) return line.split(',')[3] === '1';
  }
  return null;
}

// Satırları ayrıştırıcı → hareket → bölütlemeden geçirir.
export function runPipeline(entries, { useImu }) {
  const samples = [];
  const health = [];
  const events = [];
  const motion = createMotion();
  const strokes = createStrokeSegmenter({ onEvent: (e) => events.push(e), useImu });
  const parser = createParser({
    onSample: (s) => { if (useImu) motion.process(s); samples.push(s); strokes.push(s); },
    onHealth: (h) => health.push(h),
  });
  entries.forEach(({ line, t_host }, i) => parser.push(line, t_host ?? i * 5));
  return { samples, health, events, stats: parser.stats };
}

export const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

export function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}
