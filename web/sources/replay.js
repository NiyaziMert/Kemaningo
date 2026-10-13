// Kayıt ve oynatma. Kayıt dosyası düz metindir, her satır:
//   <t_host ms>\t<ham satır>
// İlk satırlar '#' ile başlayan açıklamadır. t_host'suz düz satırlar da kabul edilir.

export const RECORDING_HEADER = '# yay-ogretmeni kayıt v1';

export function createRecorder() {
  let entries = [];
  return {
    push(line, t_host) { entries.push({ t_host, line }); },
    clear() { entries = []; },
    get count() { return entries.length; },
    toText() {
      const body = entries.map((e) => `${e.t_host.toFixed(3)}\t${e.line}`).join('\n');
      return `${RECORDING_HEADER}\n${body}\n`;
    },
  };
}

export function parseRecording(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '' || raw.startsWith('#')) continue;
    const tab = raw.indexOf('\t');
    if (tab < 0) entries.push({ t_host: null, line: raw });
    else entries.push({ t_host: Number(raw.slice(0, tab)), line: raw.slice(tab + 1) });
  }
  return entries;
}

// Testler ve araçlar için: bütün satırları kaydedilen t_host ile anında verir.
export function replayAll(entries, onLine) {
  for (const { line, t_host } of entries) onLine(line, t_host);
}

// Tarayıcıda gerçek hızda oynatma. Satırların arası kayıttaki t_host farkıyla
// (yoksa 5 ms) korunur; aşağı akışa şimdiki zaman verilir ki ses ve oturum
// canlı kaynaktaki gibi çalışsın.
export function createReplayer({
  entries, onLine, onEnd = () => {},
  now = () => performance.now(),
  schedule = (fn) => setInterval(fn, 5),
  cancel = (id) => clearInterval(id),
}) {
  const offsets = [];
  let base = null;
  entries.forEach((e, i) => {
    if (e.t_host !== null && base === null) base = e.t_host;
    offsets.push(e.t_host !== null ? e.t_host - base : i * 5);
  });

  let timer = null;
  let i = 0;
  let t0 = 0;

  function tick() {
    const t = now();
    while (i < entries.length && offsets[i] <= t - t0) {
      onLine(entries[i].line, t);
      i += 1;
    }
    if (i >= entries.length) { stop(); onEnd(); }
  }

  function stop() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  return {
    start() { if (timer === null) { t0 = now() - (offsets[i] ?? 0); timer = schedule(tick); } },
    stop,
    get running() { return timer !== null; },
    get progress() { return entries.length ? i / entries.length : 1; },
    tick,
  };
}
