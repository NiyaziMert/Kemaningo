// Bülbül'ün dersleri: sistemi sıfırdan, adım adım öğreten etkileşimli dersler. Saf modül.
//
// Her adımda Bülbül bir şey söyler (say) ve çoğu adım bir koşul bekler (wait). Koşul, uygulamanın
// o anki durumundan (world) ve adım başladığındaki durumdan (start) hesaplanır:
//   world = {
//     sourceLive,             kart bağlı ya da simülatör çalışıyor
//     sim,                    kaynak simülatör mü (klavye ipuçları için)
//     audioOn,                ses açık
//     mask,                   o an sopanın değdiği teller (bit 0 Sol … bit 3 Mi)
//     played: [{ string, finger, midi }],  kesinleşen notalar (en eski başta)
//     attempts,               biten deneme sayısı
//     questions,              Bülbül'e sorulan soru sayısı
//   }
// Koşul sağlanınca "Devam" açılır.

import { STRING_NAMES, OPEN_MIDI } from './song.js';
import { FINGER_SEMITONES } from './thresholds.js';

export const XP_PER_STEP = 10;

const FINGER_KEYS = ['', '1', '2', '3', '4'];
const STRING_KEYS = ['A', 'S', 'D', 'F'];
export const noteMidi = (string, finger) => OPEN_MIDI[string] + FINGER_SEMITONES[finger];

// Simülatörde bir notanın klavye karşılığı.
export function simKeys(string, finger = 0) {
  return `${finger ? `${FINGER_KEYS[finger]} basılıyken ` : ''}${STRING_KEYS[string]} + → (çek)`;
}

export const LESSONS = [
  {
    id: 'tanis', title: 'Tanışalım', icon: '👋',
    steps: [
      { say: 'Merhaba! Ben Bülbül. Sana bu keman aletini sıfırdan öğreteceğim. Hazırsan başlayalım!' },
      { say: 'Aletin üç parçası var: dört bakır tel, iletken bir sopa (yayın yerine) ve sapın üstünde dört folyo şerit.',
        widget: 'parts' },
      { say: 'Sopa bir tele değince o telin sesi çıkar. Sopayı telde ne kadar tutarsan nota o kadar sürer.' },
      { say: 'Bakır teli bir folyoya bastırırsan nota incelir; tıpkı kemanda parmağınla tele basmak gibi. 1. folyo eşiğe en yakın olandır.' },
    ],
  },
  {
    id: 'baglan', title: 'Bağlan ve dinle', icon: '🔌',
    steps: [
      { say: 'Önce aleti bilgisayara bağlayalım. Kartı USB ile tak ve "Karta bağlan"a bas. Kartın yoksa simülatörle de öğrenebilirsin.',
        widget: 'connect', wait: { type: 'source' }, done: 'Bağlandık! Artık aletten gelen her şeyi görüyorum.' },
      { say: 'Şimdi sesi açalım. Tarayıcılar sesi ancak bir tıklamayla başlatır.',
        widget: 'sound', wait: { type: 'sound' }, done: 'Ses açık. Kulakların hazır mı?' },
    ],
  },
  {
    id: 'ilk-ses', title: 'İlk ses', icon: '🎻',
    steps: [
      { say: 'Sopayı La teline değdir. La, soldan üçüncü tel.', widget: 'strings',
        wait: { type: 'touch', string: 2 }, sim: 'D + →', done: 'İşte bu! La teline değdin.' },
      { say: 'Şimdi sopayı La telinde bir saniye kadar tut ve bir yöne çek. Çok kısa dokunuşlar nota sayılmaz.',
        widget: 'strings', wait: { type: 'note', string: 2, finger: 0 }, sim: simKeys(2), done: 'Harika, ilk notan: La (A4)!' },
    ],
  },
  {
    id: 'dort-tel', title: 'Dört tel', icon: '🎶',
    steps: [
      { say: 'Kemanın dört teli kalından inceye Sol, Re, La ve Mi. Hepsini birer kez çal.', widget: 'strings',
        wait: { type: 'all-strings' }, sim: 'A, S, D, F tuşlarından biri + →', done: 'Dört teli de çaldın. Kulağın ısınıyor!' },
      { say: 'Sopa iki tele birden değerse, uzun süre değdiğin tel çalar. Tellere tek tek değmeye çalış.' },
    ],
  },
  {
    id: 'parmak', title: 'Parmaklar', icon: '✋',
    steps: [
      { say: "La telinin bakır telini 1. folyoya bastır ve sopayla La'ya değ. Nota bir ton incelir: Si (B4).",
        widget: 'fingers', target: { string: 2, finger: 1 }, wait: { type: 'note', string: 2, finger: 1 },
        sim: simKeys(2, 1), done: 'Si! İlk parmağın.' },
      { say: 'Şimdi 2. folyo: Do diyez (C#5).', widget: 'fingers', target: { string: 2, finger: 2 },
        wait: { type: 'note', string: 2, finger: 2 }, sim: simKeys(2, 2), done: 'Çok iyi!' },
      { say: '3. folyo: Re (D5).', widget: 'fingers', target: { string: 2, finger: 3 },
        wait: { type: 'note', string: 2, finger: 3 }, sim: simKeys(2, 3), done: 'Süper!' },
      { say: '4. folyo: Mi (E5). Bu nota boş Mi teliyle aynı sestir!', widget: 'fingers', target: { string: 2, finger: 4 },
        wait: { type: 'note', string: 2, finger: 4 }, sim: simKeys(2, 4), done: 'Dört parmağı da öğrendin!' },
      { say: 'Kural basit: telin boş sesi + parmak. Boş, 1, 2, 3 ve 4 sırasıyla 0, 2, 4, 5 ve 7 yarım ses ekler.',
        widget: 'finger-table' },
    ],
  },
  {
    id: 'porte', title: 'Porte', icon: '🎼',
    steps: [
      { say: 'Çaldığın her nota beş çizgili portede görünür. Başındaki işaret sol anahtarı. Sıradaki notaları çal: La, Si, Do diyez.',
        widget: 'staff', wait: { type: 'sequence', notes: [[2, 0], [2, 1], [2, 2]] },
        sim: `${simKeys(2)}, sonra 1 ve 2 ile`, done: 'Portede bir merdiven çıktın!' },
      { say: 'Şimdi aşağı in: Do diyez, Si, La.', widget: 'staff',
        wait: { type: 'sequence', notes: [[2, 2], [2, 1], [2, 0]] }, sim: '2, 1, sonra boş La', done: 'Mükemmel. Portede gezinmeyi öğrendin.' },
    ],
  },
  {
    id: 'sarki', title: 'İlk şarkı', icon: '⭐',
    steps: [
      { say: 'Artık bir egzersiz çalmaya hazırsın. Çal ekranında "Tek telde dörtlük notalar"ı seçtim. "Denemeyi başlat"a bas, dört vuruş say, sonra metronomla birlikte La telini çal.',
        widget: 'goto-play', wait: { type: 'attempt' }, done: 'Denemeyi bitirdin! Sonucunu Çal ekranında görebilirsin.' },
      { say: 'Deneme bitince sana neyi iyi yaptığını ve neye dikkat etmen gerektiğini söylerim. Sonraki egzersizi ve tempoyu da öneririm.' },
    ],
  },
  {
    id: 'sor', title: "Bülbül'e sor", icon: '💬',
    steps: [
      { say: 'Bir şeye takılırsan bana sorabilirsin. Örneğin: "C#5 hangi tel ve parmakla çalınır?"',
        widget: 'ask', wait: { type: 'question' }, done: 'Güzel soru! Her zaman buradayım.' },
      { say: 'Tebrikler, temel dersleri bitirdin! Artık Çal ekranında şarkılar çalabilir, istediğin zaman bana soru sorabilirsin.' },
    ],
  },
];

// Durumun adım başındaki kopyası: koşullar "adım başladıktan sonra olanlara" bakar.
export function snapshot(world) {
  return { played: world.played.length, attempts: world.attempts, questions: world.questions };
}

export function checkWait(wait, world, start) {
  if (!wait) return true;
  const since = world.played.slice(start.played);
  switch (wait.type) {
    case 'source': return !!world.sourceLive;
    case 'sound': return !!world.audioOn;
    case 'touch': return ((world.mask >> wait.string) & 1) === 1;
    case 'note': return since.some((n) => n.string === wait.string && n.finger === wait.finger);
    case 'all-strings': return [0, 1, 2, 3].every((s) => since.some((n) => n.string === s));
    case 'sequence': { // notalar bu sırayla çalınmış olmalı (araya başka nota girebilir)
      let i = 0;
      for (const n of since) {
        const [s, f] = wait.notes[i];
        if (n.string === s && n.finger === f) i += 1;
        if (i === wait.notes.length) return true;
      }
      return false;
    }
    case 'attempt': return world.attempts > start.attempts;
    case 'question': return world.questions > start.questions;
    default: throw new Error(`bilinmeyen koşul: ${wait.type}`);
  }
}

// Bir dersin adımlarını yürütür.
export function createLessonRunner(lesson) {
  let index = 0;
  let start = null;
  let doneShown = false;
  return {
    lesson,
    get index() { return index; },
    get step() { return lesson.steps[index]; },
    get progress() { return index / lesson.steps.length; },
    get finished() { return index >= lesson.steps.length; },
    begin(world) { start = snapshot(world); doneShown = false; },
    // { ok, justDone }: justDone yalnızca koşulun sağlandığı ilk karede true (ses ve kutlama için).
    // Koşul bir kez sağlanınca adım başarılı kalır (ör. tele değip bırakınca "Devam" kapanmaz).
    check(world) {
      if (!start) start = snapshot(world);
      const ok = doneShown || checkWait(lesson.steps[index]?.wait, world, start);
      const justDone = ok && !doneShown && !!lesson.steps[index]?.wait;
      if (justDone) doneShown = true;
      return { ok, justDone };
    },
    next(world) {
      index += 1;
      start = snapshot(world);
      doneShown = false;
    },
  };
}

// İlerleme: tamamlanan dersler, XP, gün serisi. Saf; saklama main.js'de.
export function emptyProgress() {
  return { done: [], xp: 0, streak: 0, lastDay: null };
}

export function completeStep(progress, today) {
  const p = { ...progress, xp: progress.xp + XP_PER_STEP };
  if (p.lastDay !== today) {
    const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
    p.streak = p.lastDay === yesterday ? p.streak + 1 : 1;
    p.lastDay = today;
  }
  return p;
}

export function completeLesson(progress, id) {
  return progress.done.includes(id) ? progress : { ...progress, done: [...progress.done, id] };
}

// Ders yolu: tamamlanan, açık (sıradaki) ve kilitli dersler.
export function lessonStates(progress) {
  const firstOpen = LESSONS.findIndex((l) => !progress.done.includes(l.id));
  return LESSONS.map((l, i) => (progress.done.includes(l.id) ? 'done' : i === firstOpen ? 'open' : 'locked'));
}

export const noteLabel = (string, finger) => `${STRING_NAMES[string]}${finger ? ` · ${finger}. parmak` : ' · boş'}`;
