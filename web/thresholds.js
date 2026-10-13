// Bütün eşikler tek yerde. Değerler başlangıç tahminidir; Aşama 8–10'da
// kayıtlardan yeniden ayarlanır (plan: "Eşikler ve ayar").

// Simülatör sentetik IMU verisi ürettiği için 0–7. aşamalarda açık.
// Aşama 8'de (yalnızca temas) false, Aşama 9'da yeniden true yapılır.
export const USE_IMU = true;

// --- Yay bölütleme (strokes.js, Karar 2)
export const T_GAP_MS = 80;         // çekişi bitiren temas boşluğu
export const T_MIN_STROKE_MS = 100; // çekişin kesinleşmesi
export const T_PAUSE_MS = 150;      // telde durma ve hız sıfırlama
export const T_SWITCH_MS = 30;      // tel devri
export const T_ASSOC_MS = 60;       // yön değişiminin boşlukla eşlenmesi
export const V_MIN = 0.05;          // m/s, hareket ve yön
export const REV_RATIO = 0.5;       // yön değişiminin kabulü
export const DIR_WINDOW_MS = 200;   // yay yönü çekişin ilk 200 ms'sinden okunur
export const RMS_TRIM_MS = 100;     // accel_rms: baştan ve sondan atılan süre
export const RMS_MA_SAMPLES = 5;    // accel_rms: hareketli ortalama uzunluğu

// --- Hareket kestirimi (motion.js, Karar 3)
export const STILL_WINDOW_MS = 60;  // durağanlık penceresi
export const STILL_K = 3;           // eşik = gürültünün 3 katı
export const GRAVITY_RATE = 0.05;   // durağanken yerçekimi düzeltme oranı
export const LEAK_TAU_S = 3;        // hız toplamının sızma zaman sabiti
// Dinlenme kalibrasyonu yokken kullanılan gürültü değerleri (eksen başına std).
export const ACC_NOISE_DEFAULT = 0.02;  // m/s²
export const GYRO_NOISE_DEFAULT = 0.005; // rad/s

// --- Parmak şeritleri (fingers.js)
// Boş tel ve 1.–4. parmak için yarım ses (şeritler: eşikten 3,5 / 7 / 8,5 / 11 cm).
export const FINGER_SEMITONES = [0, 2, 4, 5, 7];

// --- Hata kuralları (rules.js)
export const T_TOUCH_MS = 15;       // komşu tele değme
export const TIMING_TOL_MS = 80;    // erken/geç toleransının alt sınırı
export const TIMING_TOL_RATIO = 0.12; // ya da beklenen aralığın bu oranı
export const DIR_CONF_MIN = 0.8;    // ters yön
export const ACCEL_RMS_MAX = 0.7;   // m/s², düzensiz hız
