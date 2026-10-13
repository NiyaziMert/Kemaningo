// yay.ino'yu taklit edilmiş zamanla çalıştırır, Serial çıktısını stdout'a yazar.
// Senaryo:
//   500–503 ms   La teline 1 ms'lik tek düşük örnek (sıçrama): temas sayılmamalı
//   1000–1500 ms sopa La teline değiyor (GPIO6 LOW), 1200. ms'de 3 ms'lik kesinti
//   1100–1400 ms La teli 3. folyoya bastırılı: sopa değerken GPIO12 de LOW
//   2000. ms     loop 3 ms takılır (seri yazma gecikmesi taklidi): satır atlanmamalı
// Başlangıç saati 2^32'ye yakın: micros() taşması da sınanır.
#include "Arduino.h"
#include <iostream>

namespace host {
uint32_t now_us = 0;
std::string out;
int tx_free = 1024;
int (*pin_level)(int, uint32_t) = nullptr;
}

static const uint32_t T0 = 0xFFFFFFFFu - 1500000u;  // taşma 1,5. saniyede

static bool bowOnLa(uint32_t ms) {
  return ms >= 1000 && ms < 1500 && !(ms >= 1200 && ms < 1203);
}

static int level(int pin, uint32_t t) {
  uint32_t ms = (t - T0) / 1000;
  if (pin == 6) return (ms == 500 || bowOnLa(ms)) ? LOW : HIGH;
  if (pin == 12) return (bowOnLa(ms) && ms >= 1100 && ms < 1400) ? LOW : HIGH;
  return HIGH;
}

#include "../../firmware/yay/yay.ino"

int main() {
  host::pin_level = level;
  host::now_us = T0;
  setup();
  uint32_t step = 0;
  while (host::now_us - T0 < 3000000u) {
    loop();
    step++;
    host::now_us += 37 + (step % 5) * 11;           // döngü süresi 37–81 µs
    if (host::now_us - T0 >= 2000000u && host::now_us - T0 < 2000100u) host::now_us += 3000;
  }
  std::cout << host::out;
  return 0;
}
