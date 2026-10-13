// Okul arayüzü: Bülbül (öğretmen kuş), ders yolu ve ders ekranı. DOM'a dokunur.

import { LESSONS, lessonStates, noteMidi } from './lessons.js';
import { STRING_NAMES } from './song.js';
import { midiName, renderStaff } from './ui.js';

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// ---------------------------------------------------------------- Bülbül

// Özgün kuş çizimi (SVG). Durumlar: idle (sallanır, göz kırpar), talk (gaga oynar),
// happy (zıplar, kanat çırpar, nota çıkar), think (başını eğer).
const BIRD_SVG = `
<svg viewBox="0 0 120 120" aria-hidden="true">
  <g class="b-body">
    <path class="b-tail" d="M22 76 L6 70 L10 84 L4 92 L24 88 Z"/>
    <path class="b-tuft" d="M54 22 Q58 8 64 20 Q70 10 70 24 Z"/>
    <ellipse class="b-main" cx="60" cy="64" rx="40" ry="38"/>
    <ellipse class="b-belly" cx="62" cy="78" rx="25" ry="21"/>
    <ellipse class="b-wing b-wing-l" cx="26" cy="72" rx="12" ry="18"/>
    <ellipse class="b-wing b-wing-r" cx="96" cy="72" rx="12" ry="18"/>
    <circle class="b-cheek" cx="36" cy="66" r="6"/>
    <circle class="b-cheek" cx="86" cy="66" r="6"/>
    <g class="b-eye"><circle class="b-white" cx="46" cy="52" r="12"/><circle class="b-pupil" cx="48" cy="53" r="6"/><circle class="b-shine" cx="50" cy="50" r="2"/></g>
    <g class="b-eye"><circle class="b-white" cx="76" cy="52" r="12"/><circle class="b-pupil" cx="74" cy="53" r="6"/><circle class="b-shine" cx="76" cy="50" r="2"/></g>
    <rect class="b-lid" x="32" y="38" width="58" height="0" rx="6"/>
    <path class="b-beak-up" d="M53 62 L67 62 L60 71 Z"/>
    <path class="b-beak-lo" d="M55 68 L65 68 L60 75 Z"/>
    <path class="b-foot" d="M50 100 L48 108 M50 100 L53 108 M70 100 L68 108 M70 100 L73 108"/>
  </g>
  <text class="b-note" x="96" y="22">♪</text>
</svg>`;

export function createBird(size = 120) {
  const node = el('div', { className: 'bird idle', innerHTML: BIRD_SVG });
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  let timer = null;
  return {
    node,
    mood(m) {
      node.classList.remove('idle', 'talk', 'happy', 'think');
      node.classList.add(m);
    },
    // Konuşma: metin uzunluğuna göre gaga oynar, sonra beklemeye döner.
    speak(text) {
      clearTimeout(timer);
      this.mood('talk');
      timer = setTimeout(() => this.mood('idle'), Math.min(4000, 400 + text.length * 35));
    },
    cheer() {
      clearTimeout(timer);
      this.mood('happy');
      timer = setTimeout(() => this.mood('idle'), 1600);
    },
  };
}

// ---------------------------------------------------------------- Ders yolu

export function renderPath(container, { onOpen, onReset }) {
  const unit = el('div', { className: 'unit' },
    el('div', {}, el('small', { textContent: 'BÖLÜM 1' }), el('h2', { textContent: 'Aleti tanı ve çal' })),
    el('span', { className: 'unit-bird' }));
  const birdBox = createBird(64);
  unit.querySelector('.unit-bird').append(birdBox.node);
  const list = el('div', { className: 'path-list' });
  const reset = el('button', { className: 'reset-btn', textContent: 'İlerlemeyi sıfırla' });
  reset.addEventListener('click', () => {
    if (window.confirm('Bütün dersler, XP ve gün serisi sıfırlansın mı?')) onReset();
  });
  container.replaceChildren(unit, list, el('div', { className: 'row center path-foot' }, reset));
  return {
    update(progress) {
      const states = lessonStates(progress);
      list.replaceChildren(...LESSONS.map((l, i) => {
        const st = states[i];
        const btn = el('button', {
          className: `node ${st}`, disabled: st === 'locked',
          title: st === 'locked' ? 'Önceki dersi bitir' : l.title,
        }, el('span', { className: 'node-icon', textContent: st === 'done' ? '✓' : st === 'locked' ? '🔒' : l.icon }));
        btn.addEventListener('click', () => onOpen(l));
        const offset = [0, 60, 90, 60, 0, -60, -90, -60][i % 8];
        return el('div', { className: 'node-wrap' },
          el('div', { className: 'node-col', style: `transform: translateX(${offset}px)` },
            st === 'open' ? el('div', { className: 'node-start', textContent: 'BAŞLA' }) : null,
            btn, el('div', { className: 'node-title', textContent: l.title })));
      }));
    },
  };
}

// ---------------------------------------------------------------- Ders ekranı

const FINGER_LABEL = ['boş', '1.', '2.', '3.', '4.'];

export function renderLesson(container, h) {
  const bar = el('span');
  const close = el('button', { className: 'icon-btn', textContent: '✕', title: 'Dersten çık' });
  close.addEventListener('click', () => h.onClose());
  const bird = createBird(150);
  const bubble = el('div', { className: 'bubble' });
  const widget = el('div', { className: 'widget' });
  const hint = el('p', { className: 'hint' });
  const doneText = el('p', { className: 'done-text' });
  const cont = el('button', { className: 'primary big', textContent: 'Devam' });
  cont.addEventListener('click', () => h.onContinue());
  const footer = el('div', { className: 'lesson-footer' },
    el('div', { className: 'lesson-footer-inner' }, el('div', { className: 'footer-msg' }, doneText, hint), cont));

  container.replaceChildren(
    el('div', { className: 'lesson-top' }, close, el('div', { className: 'lesson-progress' }, bar)),
    el('div', { className: 'lesson-body' }, el('div', { className: 'tutor-row' }, bird.node, bubble), widget),
    footer,
  );

  let live = {}; // canlı parçalar: { strings, strips, staff }
  let lastStepKey = null;

  function stringRow() {
    const nodes = STRING_NAMES.map((n, i) => el('div', { className: `pstring s${i}` }, el('i', { className: 'wire' }), el('span', { textContent: n })));
    live.strings = nodes;
    return el('div', { className: 'pstrings' }, ...nodes);
  }
  function stripRow() {
    const nodes = [1, 2, 3, 4].map((f) => el('div', { className: 'strip' }, el('strong', { textContent: f }), el('small', { textContent: 'folyo' })));
    live.strips = nodes;
    return el('div', { className: 'strip-row' }, ...nodes);
  }

  function buildWidget(step) {
    live = {};
    switch (step.widget) {
      case 'parts':
        return el('div', { className: 'parts' },
          ...[['🎻', 'Dört bakır tel', 'Sol, Re, La, Mi. Kalından inceye.'],
            ['🪄', 'Sopa', 'Yayın yerine. Tele değince ses çıkar.'],
            ['✋', 'Dört folyo', 'Bakır teli bastırdığın yer notayı belirler.']]
            .map(([i, t, d]) => el('div', { className: 'part' }, el('span', { className: 'part-icon', textContent: i }),
              el('strong', { textContent: t }), el('small', { textContent: d }))));
      case 'connect': {
        const row = el('div', { className: 'row center' });
        if (h.serialSupported) {
          const b = el('button', { className: 'primary', textContent: 'Karta bağlan' });
          b.addEventListener('click', () => h.onConnect());
          row.append(b);
        }
        const sim = el('button', { textContent: 'Simülatörle öğren' });
        sim.addEventListener('click', () => h.onSimulator());
        row.append(sim);
        return row;
      }
      case 'sound': {
        const b = el('button', { className: 'primary big', textContent: '🔊 Sesi aç' });
        b.addEventListener('click', () => h.onSound());
        return el('div', { className: 'row center' }, b);
      }
      case 'strings':
        return stringRow();
      case 'fingers': {
        const t = step.target;
        return el('div', { className: 'stack center' },
          el('div', { className: 'target' },
            el('small', { textContent: 'HEDEF' }),
            el('strong', { textContent: midiName(noteMidi(t.string, t.finger)) }),
            el('span', { textContent: `${STRING_NAMES[t.string]} teli · ${FINGER_LABEL[t.finger]} parmak` })),
          stripRow(), stringRow());
      }
      case 'finger-table': {
        const head = el('tr', {}, el('th'), ...['boş', '1', '2', '3', '4'].map((x) => el('th', { textContent: x })));
        const rows = STRING_NAMES.map((n, s) => el('tr', {}, el('th', { textContent: n }),
          ...[0, 1, 2, 3, 4].map((f) => el('td', { textContent: midiName(noteMidi(s, f)) }))));
        return el('table', { className: 'finger-table' }, el('thead', {}, head), el('tbody', {}, ...rows));
      }
      case 'staff': {
        const box = el('div', { className: 'mini-staff' });
        live.staff = renderStaff(box);
        return box;
      }
      case 'goto-play': {
        const b = el('button', { className: 'primary', textContent: 'Çal ekranına git' });
        b.addEventListener('click', () => h.onGotoPlay());
        return el('div', { className: 'row center' }, b);
      }
      case 'ask': {
        const q = el('input', { type: 'text', placeholder: 'Bülbül\'e sor…', value: 'C#5 hangi tel ve parmakla çalınır?' });
        const b = el('button', { className: 'primary', textContent: 'Sor' });
        const ask = async () => {
          if (!q.value.trim()) return;
          b.disabled = true;
          bird.mood('think');
          bubble.textContent = 'Düşünüyorum…';
          const r = await h.onAsk(q.value.trim());
          bubble.textContent = r.text ?? `Şu an yanıt veremedim: ${r.errors.join(' · ')}`;
          bird.speak(bubble.textContent);
          b.disabled = false;
        };
        b.addEventListener('click', ask);
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
        return el('div', { className: 'qa-row' }, q, b);
      }
      default:
        return null;
    }
  }

  return {
    bird,
    // view: { lesson, index, step, progress, ok, justDone, sim, mask, fmask, sounding, finished, xpGained }
    update(v) {
      bar.style.width = `${Math.round(v.progress * 100)}%`;
      const key = `${v.lesson.id}:${v.finished ? 'son' : v.index}`;
      if (key !== lastStepKey) {
        lastStepKey = key;
        if (v.finished) {
          bubble.textContent = `"${v.lesson.title}" dersini bitirdin! +${v.xpGained} XP kazandın.`;
          widget.replaceChildren(el('div', { className: 'celebrate', textContent: '🎉' }));
          bird.cheer();
        } else {
          bubble.textContent = v.step.say;
          widget.replaceChildren(...[buildWidget(v.step)].filter(Boolean));
          bird.speak(v.step.say);
        }
      }
      if (v.justDone) bird.cheer();
      // Canlı parçalar
      live.strings?.forEach((n, i) => {
        const on = (v.mask >> i) & 1;
        n.classList.toggle('touched', !!on);
        n.classList.toggle('sounding', !!(on && v.sounding));
        n.classList.toggle('expected', v.step?.target?.string === i || v.step?.wait?.string === i);
      });
      const fm = v.fmask ?? 0;
      const top = fm ? 32 - Math.clz32(fm) : 0; // geçerli parmak: en yüksek değen folyo
      live.strips?.forEach((n, i) => {
        n.classList.toggle('on', !!((fm >> i) & 1));
        n.classList.toggle('active', top === i + 1);
      });
      // Alt şerit
      const waiting = !v.finished && v.step.wait && !v.ok;
      footer.classList.toggle('success', !v.finished && !!v.step.wait && v.ok);
      cont.disabled = waiting;
      cont.textContent = v.finished ? 'Derslere dön' : 'Devam';
      doneText.textContent = !v.finished && v.step.wait && v.ok ? `Harika! ${v.step.done ?? ''}` : '';
      hint.textContent = waiting
        ? `Bekliyorum…${v.sim && v.step.sim ? ` Simülatörde: ${v.step.sim}` : ''}` : '';
    },
    pushNote(n) { live.staff?.push(n); },
    releaseNote() { live.staff?.release(); },
    setAnswer(text) { bubble.textContent = text; bird.speak(text); },
  };
}
