// Ses: gerçek keman örnekleri (VSCO 2 CE, CC0; web/samples/violin/KAYNAK.md) ve metronom.
// Örnekler yüklenene kadar ya da yüklenemezse çıkarmalı sentez çalar.
// Saf yardımcılar (speedToLevel, levelToCutoff, createBeatClock, nearestSample, bakeLoop,
// normalizeGain) Node'da test edilir; AudioContext'e yalnızca createAudio() dokunur.

export const LEVEL_MIN = 0.25;          // çekiş sürerken nota susmaz
export const LEVEL_CONTACT_ONLY = 0.7;  // USE_IMU = false kipinde sabit düzey
export const SPEED_FULL = 0.5;          // m/s, tam düzey
export const CUTOFF_MIN = 1500;         // Hz
export const CUTOFF_MAX = 5000;         // Hz
export const SMOOTH_MS = 20;            // düzey ve parlaklık yumuşatma
export const ATTACK_MS = 15;            // tıkırtısız başlangıç
export const RELEASE_MS = 80;           // kapanış
const MASTER = 0.3;                     // tepe süzgeçlerinin kazancı için pay

// Keman gövdesini andıran sabit tepeler: hava rezonansı, gövde, köprü bölgesi.
const BODY_PEAKS = [
  { freq: 275, q: 4, gain: 6 },
  { freq: 460, q: 3, gain: 4 },
  { freq: 3000, q: 1.5, gain: 5 },
];

export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);

// --- Keman örnekleri: yayla, vibratolu, forte. Aradaki perdeler hız değişimiyle (≤ ±2 yarım ses).
export const SAMPLE_NOTES = [
  ['G3', 55], ['A3', 57], ['C4', 60], ['E4', 64], ['G4', 67], ['A4', 69],
  ['C5', 72], ['E5', 76], ['G5', 79], ['A5', 81], ['C6', 84],
];
export const SAMPLE_URL = 'samples/violin';
export const SAMPLE_LOOP = { start: 3.0, end: 8.0, xfade: 0.25 }; // sn; dosyalar 8,5 sn
export const SAMPLE_RMS = 0.12;     // eşitlenmiş gürlük (0,5–3 sn arası RMS)
const SAMPLE_CUTOFF = [2500, 12000]; // yay hızı düzeyine göre parlaklık (Hz)
const SAMPLE_RELEASE_S = 0.15;
const SAMPLE_XFADE_S = 0.03;         // başka örneğe geçerken çapraz geçiş
const SAMPLE_GLIDE_TAU = 0.008 / 3;  // aynı örnekte perde kayması: ~8 ms

// En yakın örnek; eşitlikte alttaki (hızlandırmak yavaşlatmaktan doğal duyulur).
export function nearestSample(midi) {
  let best = SAMPLE_NOTES[0];
  for (const n of SAMPLE_NOTES) if (Math.abs(n[1] - midi) < Math.abs(best[1] - midi)) best = n;
  return { name: best[0], midi: best[1], rate: 2 ** ((midi - best[1]) / 12) };
}

// Döngü noktasını tıkırtısız yapar: [start, end) döngüsünün son xfade kadarı, start'tan
// önceki kısımla eşit güçte karıştırılır; end'den start'a atlama sürekli olur. Yerinde değiştirir.
export function bakeLoop(data, sampleRate, { start, end, xfade } = SAMPLE_LOOP) {
  const n = Math.round(xfade * sampleRate);
  const s0 = Math.round(start * sampleRate);
  const e0 = Math.round(end * sampleRate);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * (Math.PI / 2);
    data[e0 - n + i] = data[e0 - n + i] * Math.cos(a) + data[s0 - n + i] * Math.sin(a);
  }
  return data;
}

// Örnekler arası gürlük farkını gidermek için çarpan (0,5–3 sn arasının RMS'i SAMPLE_RMS olur).
export function normalizeGain(data, sampleRate, target = SAMPLE_RMS) {
  const a = Math.round(0.5 * sampleRate);
  const b = Math.min(data.length, Math.round(3 * sampleRate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.max(1, b - a));
  return rms > 0 ? target / rms : 1;
}

export function speedToLevel(speed) {
  const level = Math.abs(speed) / SPEED_FULL;
  return Math.min(1, Math.max(LEVEL_MIN, level));
}

// Düzey 0 → 1,5 kHz, 1 → 5 kHz; üstel, çünkü perde algısı logaritmik.
export function levelToCutoff(level) {
  const l = Math.min(1, Math.max(0, level));
  return CUTOFF_MIN * (CUTOFF_MAX / CUTOFF_MIN) ** l;
}

// Vuruş zamanları startTime + n·period ile hesaplanır, toplanmaz; kayma birikmez.
export function createBeatClock({ bpm, beatsPerBar, startTime }) {
  const period = 60 / bpm;
  let n = 0;
  return {
    period,
    // until'den önceki, henüz verilmemiş vuruşları döndürür.
    take(until) {
      const out = [];
      while (startTime + n * period < until) {
        out.push({ n, time: startTime + n * period, accent: n % beatsPerBar === 0 });
        n += 1;
      }
      return out;
    },
  };
}

// Param'ı o anki değerinde dondurur; ardından gelen rampa sıçramasız başlar.
function hold(param, t) {
  const v = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
}

export function createAudio() {
  const ctx = new AudioContext({ latencyHint: 'interactive' });

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.Q.value = 0.7;
  lowpass.frequency.value = levelToCutoff(LEVEL_MIN);
  const peaks = BODY_PEAKS.map(({ freq, q, gain }) => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  });
  const amp = ctx.createGain();
  amp.gain.value = 0;

  [osc, lowpass, ...peaks, amp, ctx.destination].reduce((a, b) => a.connect(b));
  osc.start(); // osilatör hep çalışır; nota = frekans + kazanç

  // Seviye göstergesi: çıkışa paralel bir analizör. Ses duyulmuyorsa sinyalin üretilip
  // üretilmediğini ayırt etmeye yarar.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  amp.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  function meter() {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length); // RMS, 0–1
  }

  let level = LEVEL_MIN;
  let sounding = false;
  const tau = SMOOTH_MS / 1000 / 3; // setTargetAtTime: 3·tau'da %95

  // --- Keman örnekleri: örnek sesi → ses → düzey (yay hızı) → parlaklık → çıkış
  const buffers = new Map(); // ad → AudioBuffer (eşitlenmiş, döngüsü hazır)
  let samplesState = 'yükleniyor';
  const sLevel = ctx.createGain();
  sLevel.gain.value = LEVEL_MIN;
  const sTone = ctx.createBiquadFilter();
  sTone.type = 'lowpass';
  sTone.Q.value = 0.5;
  sTone.frequency.value = SAMPLE_CUTOFF[0];
  sLevel.connect(sTone).connect(ctx.destination);
  sTone.connect(analyser);
  let voice = null; // { src, gain, name }

  (async () => {
    try {
      await Promise.all(SAMPLE_NOTES.map(async ([name]) => {
        const res = await fetch(`${SAMPLE_URL}/${name}.wav`);
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        const data = buffer.getChannelData(0);
        const k = normalizeGain(data, buffer.sampleRate);
        for (let i = 0; i < data.length; i++) data[i] *= k;
        bakeLoop(data, buffer.sampleRate);
        buffers.set(name, buffer);
      }));
      samplesState = 'hazır';
    } catch (e) {
      samplesState = 'yüklenemedi';
      console.warn('Keman örnekleri yüklenemedi; sentez kullanılacak', e);
    }
  })();

  function stopVoice(v, t, fade) {
    hold(v.gain.gain, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    v.src.stop(t + fade + 0.02);
  }

  function sampleNoteOn(midi, t) {
    const smp = nearestSample(midi);
    if (voice && sounding && voice.name === smp.name) { // aynı örnek: perdeyi kaydır
      voice.src.playbackRate.setTargetAtTime(smp.rate, t, SAMPLE_GLIDE_TAU);
      return;
    }
    const legato = voice && sounding;
    if (voice) stopVoice(voice, t, legato ? SAMPLE_XFADE_S : 0.01);
    const src = ctx.createBufferSource();
    src.buffer = buffers.get(smp.name);
    src.loop = true;
    src.loopStart = SAMPLE_LOOP.start;
    src.loopEnd = SAMPLE_LOOP.end;
    src.playbackRate.value = smp.rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + (legato ? SAMPLE_XFADE_S : ATTACK_MS / 1000));
    src.connect(gain).connect(sLevel);
    src.start(t);
    voice = { src, gain, name: smp.name };
  }

  function noteOn(midi) {
    // Safari bağlamı sekme değişince ya da uykudan sonra askıya alır; bir kez kullanıcı
    // tıklamasıyla başlatılmış bağlam yeniden açılabilir.
    if (ctx.state !== 'running') ctx.resume();
    const t = ctx.currentTime;
    if (samplesState === 'hazır') {
      sampleNoteOn(midi, t);
      sounding = true;
      return;
    }
    const f = midiToFreq(midi);
    if (sounding) {
      // Çalan notadan geçiş: frekansı 5 ms'de kaydır, kazancı kesme.
      hold(osc.frequency, t);
      osc.frequency.linearRampToValueAtTime(f, t + 0.005);
    } else {
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(f, t);
    }
    hold(amp.gain, t);
    amp.gain.linearRampToValueAtTime(level * MASTER, t + ATTACK_MS / 1000);
    sounding = true;
  }

  function setLevel(value) {
    level = Math.min(1, Math.max(0, value));
    const t = ctx.currentTime;
    sLevel.gain.setTargetAtTime(level, t, tau);
    sTone.frequency.setTargetAtTime(SAMPLE_CUTOFF[0] * (SAMPLE_CUTOFF[1] / SAMPLE_CUTOFF[0]) ** level, t, tau);
    lowpass.frequency.setTargetAtTime(levelToCutoff(level), t, tau);
    if (sounding) {
      hold(amp.gain, t);
      amp.gain.setTargetAtTime(level * MASTER, t, tau);
    }
  }

  function noteOff() {
    const t = ctx.currentTime;
    if (voice) {
      stopVoice(voice, t, SAMPLE_RELEASE_S);
      voice = null;
    }
    hold(amp.gain, t);
    amp.gain.linearRampToValueAtTime(0, t + RELEASE_MS / 1000);
    sounding = false;
  }

  // --- Metronom: 25 ms'de bir uyanan zamanlayıcı, 100 ms ilerisini ses saatine planlar.
  const LOOKAHEAD_S = 0.1;
  const TICK_MS = 25;
  let timer = null;

  function click(time, accent) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    o.connect(g).connect(ctx.destination);
    o.start(time);
    o.stop(time + 0.035);
  }

  function metronomeStart({ bpm, beatsPerBar }, onBeat = () => {}) {
    metronomeStop();
    const clock = createBeatClock({ bpm, beatsPerBar, startTime: ctx.currentTime + 0.1 });
    const tick = () => {
      for (const beat of clock.take(ctx.currentTime + LOOKAHEAD_S)) {
        click(beat.time, beat.accent);
        // Ekran bildirimi vuruşun çaldığı ana denk getirilir.
        const delay = Math.max(0, (beat.time - ctx.currentTime) * 1000);
        setTimeout(() => onBeat(beat), delay);
      }
    };
    tick();
    timer = setInterval(tick, TICK_MS);
    return clock;
  }

  function metronomeStop() {
    clearInterval(timer);
    timer = null;
  }

  // Başarı sesi (dersler): iki kısa sinüs notası, keman sesinden bağımsız.
  function chime() {
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [[1046.5, 0], [1318.5, 0.09]].forEach(([f, dt]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(0.18, t + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    });
  }

  function latency() {
    return { base: ctx.baseLatency, output: ctx.outputLatency };
  }

  return {
    ctx, noteOn, setLevel, noteOff, metronomeStart, metronomeStop, latency,
    resume: () => ctx.resume(),
    suspend: () => ctx.suspend(),
    meter,
    chime,
    get samples() { return samplesState; },
    get running() { return ctx.state === 'running'; },
    get state() { return ctx.state; },
  };
}
