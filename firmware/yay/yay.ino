// Keman yayı aleti: ESP32-S3 firmware'i. Karar vermez; yalnızca ölçer ve gönderir.
//
// Teller bakır teldir ve GPIO 4–7'ye bağlıdır (INPUT_PULLUP). Sopa GND'dedir; bir tele değince
// o telin pini LOW olur. Parmak şeritleri (folyo) GPIO 10–13'e bağlıdır (INPUT_PULLUP). Bakır tel
// parmakla bir folyoya bastırılınca ikisi değer; sopanın değdiği tel GND'de olduğu için o folyonun
// pini de LOW olur. Böylece:
//   tel    = sopanın değdiği tel (mask)
//   parmak = LOW olan folyo (fmask)
// Sopanın değmediği bir tel folyoya bastırılsa da HIGH kaldığı için folyoyu LOW'a çekmez.
//
// Teller ve folyolar 1 kHz'de okunur; art arda 2 düşük örnek temas sayılır; 5 ms'lik pencerede bir
// kez temas görülen bit maskeye yazılır.
//   S,t_us,mask,ax,ay,az,gx,gy,gz,fmask   5 ms'de bir (IMU alanları şimdilik 0)
//   H,t_us,fw,imu_ok,i2c_err              saniyede bir
//
// Kart: ESP32-S3, USB portu CH343 köprü çipinden geçiyor (USB 1a86:55d3).
// Arduino ayarı: "USB CDC On Boot" = Disabled, böylece Serial = UART0 = CH343.

#include <Arduino.h>

static const char *FW_VERSION = "0.10.0";
static const uint32_t BAUD = 921600;  // 115200 saniyede 200 satırı taşımaz (Karar 1)

// Teller: Sol, Re, La, Mi (mask'te bit 0–3).
static const int STRING_PINS[4] = {4, 5, 6, 7};
// Parmak şeritleri (folyo): 1., 2., 3., 4. parmak (fmask'te bit 0–3); eşikten 3,5 / 7 / 8,5 / 11 cm.
static const int STRIP_PINS[4] = {10, 11, 12, 13};

static const uint32_t SAMPLE_US = 1000;      // 1 kHz örnekleme
static const uint8_t SAMPLES_PER_LINE = 5;   // 5 ms'de bir S satırı
static const uint8_t DEBOUNCE_SAMPLES = 2;   // art arda 2 düşük örnek = temas
static const uint32_t HEALTH_US = 1000000;   // saniyede bir H satırı
static const uint32_t RESYNC_US = 50000;     // 50 ms'den fazla geride kalırsak yetişmeye çalışma

static uint32_t nextSampleUs;
static uint32_t nextHealthUs;
static uint8_t stringRun[4];   // her tel için art arda düşük örnek sayısı
static uint8_t stripRun[4];    // her şerit için art arda düşük örnek sayısı
static uint8_t windowMask;     // bu 5 ms'lik pencerede temas görülen teller
static uint8_t windowFinger;   // bu 5 ms'lik pencerede LOW görülen şeritler
static uint8_t windowSamples;

static void sendLine(const char *buf, int len) {
  // TX tamponu doluysa satır atlanır; örnekleme döngüsü yazmayı beklemez.
  if (Serial.availableForWrite() < len) return;
  Serial.write(reinterpret_cast<const uint8_t *>(buf), len);
}

// Dört pini okur; art arda DEBOUNCE_SAMPLES düşük okunan pinin bitini pencereye yazar.
static void sampleGroup(const int pins[4], uint8_t run[4], uint8_t &window) {
  for (int i = 0; i < 4; i++) {
    if (digitalRead(pins[i]) == LOW) {
      if (run[i] < DEBOUNCE_SAMPLES) run[i]++;
    } else {
      run[i] = 0;
    }
    if (run[i] >= DEBOUNCE_SAMPLES) window |= (1 << i);
  }
}

void setup() {
  Serial.setTxBufferSize(1024);  // begin'den önce: yazma döngüyü bloklamasın
  Serial.begin(BAUD);
  for (int i = 0; i < 4; i++) {
    pinMode(STRING_PINS[i], INPUT_PULLUP);
    pinMode(STRIP_PINS[i], INPUT_PULLUP);
  }
  nextSampleUs = micros();
  nextHealthUs = nextSampleUs;
}

void loop() {
  const uint32_t now = micros();
  if ((int32_t)(now - nextSampleUs) < 0) return;
  if ((int32_t)(now - nextSampleUs) > (int32_t)RESYNC_US) nextSampleUs = now;

  // Zaman damgası planlanan örnek anıdır: satırlar arası tam 5000 µs olur.
  const uint32_t t = nextSampleUs;
  nextSampleUs += SAMPLE_US;
  sampleGroup(STRING_PINS, stringRun, windowMask);
  sampleGroup(STRIP_PINS, stripRun, windowFinger);

  if (++windowSamples >= SAMPLES_PER_LINE) {
    char buf[64];
    int n = snprintf(buf, sizeof buf, "S,%lu,%u,0,0,0,0,0,0,%u\n", (unsigned long)t, windowMask, windowFinger);
    sendLine(buf, n);
    windowMask = 0;
    windowFinger = 0;
    windowSamples = 0;
  }

  if ((int32_t)(t - nextHealthUs) >= 0) {
    nextHealthUs += HEALTH_US;
    char buf[48];
    int n = snprintf(buf, sizeof buf, "H,%lu,%s,0,0\n", (unsigned long)t, FW_VERSION);
    sendLine(buf, n);
  }
}
