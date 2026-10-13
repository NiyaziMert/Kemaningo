// Bilgisayarda firmware mantığını sınamak için en küçük Arduino taklidi.
// Zaman, pin seviyeleri ve seri çıkış test programından yönetilir.
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>

#define LOW 0
#define HIGH 1
#define INPUT_PULLUP 2

namespace host {
extern uint32_t now_us;                    // micros() bunu döndürür
extern int (*pin_level)(int pin, uint32_t t_us);
extern std::string out;                     // Serial'a yazılanlar
extern int tx_free;                         // availableForWrite()
}

inline uint32_t micros() { return host::now_us; }
inline uint32_t millis() { return host::now_us / 1000; }
inline void pinMode(int, int) {}
inline int digitalRead(int pin) { return host::pin_level(pin, host::now_us); }


struct HostSerial {
  void setTxBufferSize(size_t) {}
  void begin(uint32_t) {}
  int availableForWrite() { return host::tx_free; }
  size_t write(const uint8_t *b, size_t n) { host::out.append(reinterpret_cast<const char *>(b), n); return n; }
};
inline HostSerial Serial;
