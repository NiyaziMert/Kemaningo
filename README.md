# Kemaningo: Keman Öğretimi

Kemaningo, ESP32-S3 ile yapılmış keman benzeri bir çalgıdır. Sopa bir bakır tele değince o telin sesi çıkar. Teli bir parmak folyosuna bastırınca nota incelir. Tarayıcıdaki uygulama notayı gerçek keman kayıtlarıyla çalar, portede gösterir ve **Bülbül** adlı öğretmen kuş sistemi sıfırdan öğretir.

```
bakır teller (GPIO 4–7) ─┐
parmak folyoları (10–13) ─┼→ ESP32-S3 → USB seri (921600 baud) → Chrome / Edge (Web Serial)
sopa (GND) ───────────────┘                                         │
                                                                    ├→ temas ve parmak kararı → nota
                                                                    ├→ keman sesi (Web Audio)
                                                                    ├→ porte, dersler, hata kuralları
                                                                    └→ Bülbül (kurallar + isteğe bağlı Ollama)
```

Kart yalnızca ölçer ve satır gönderir. Bütün kararlar tarayıcıda verilir. Sunucu yoktur, hepsi `localhost`'ta çalışır.

> Durum: hobi projesi, çalışan bir prototip. Neyin donanımda doğrulandığı, neyin yalnızca simülatörle sınandığı aşağıda ayrı yazılı.

## Malzeme listesi

Aşağıdaki liste, çalışan prototipte kullanılanlardır. Ölçü ve marka bilgisi yalnızca bilindiği kadar yazıldı.

| Malzeme | Adet | Ne işe yarar |
|---|---|---|
| ESP32-S3 geliştirme kartı (USB bağlantısı CH343 seri köprü çipinden geçiyor, USB `1a86:55d3`) | 1 | Tel ve folyoları okur, satırları USB seri ile gönderir |
| Bakır tel | 4 | Keman telleri: Sol, Re, La, Mi |
| Alüminyum folyo şerit, 1 cm genişliğinde, sapa enine yapıştırılmış | 4 | Parmak şeritleri. Eşikten 3,5 / 7 / 8,5 / 11 cm uzaklıkta (1.–4. parmak) |
| İletken sopa (alüminyum folyoyla kaplı) | 1 | Yayın yerine geçer. GND'ye bağlıdır; tele değince o telin pinini LOW yapar |
| Jumper kablo | tel, şerit ve sopa için gerektiği kadar | Lehimsiz bağlantı. Alüminyum folyoya bantla tutturulan kablo oksit tabakası yüzünden temas etmeyebilir: timsah klips ya da bakır bant kullan |
| USB kablosu (veri destekli) | 1 | Kartı bilgisayara bağlar |
| MPU6050 ivme ve jiroskop sensörü *(isteğe bağlı, henüz bağlı değil)* | 1 | Yay yönü ve hızı için. SDA → GPIO 8, SCL → GPIO 9, VCC → 3V3, GND → GND |
| Bilgisayar (macOS'ta denendi) | 1 | Uygulamayı çalıştırır |
| Chrome ya da Edge | 1 | Web Serial yalnızca bunlarda var. Safari karta bağlanamaz, ama simülatör ve dersler Safari'de de açılır |

Yazılım araçları:

| Araç | Sürüm | Ne için |
|---|---|---|
| Node.js | 20 ya da üstü (26.11.1'de denendi) | Testler ve sayfa sunucusu |
| arduino-cli + `esp32:esp32` çekirdeği | 3.3.12'de denendi | Firmware'i derlemek ve yüklemek |
| Ollama + `gemma3:4b` *(isteğe bağlı)* | Ollama 0.40.2'de denendi | Bülbül'ün soru-cevabı. Yoksa soru kutusu gizlenir, geri kalan her şey çalışır |

### Bağlantılar

| Parça | GPIO | Not |
|---|---|---|
| Sol teli | 4 | `INPUT_PULLUP`, sopa değince LOW |
| Re teli | 5 | aynı |
| La teli | 6 | aynı |
| Mi teli | 7 | aynı |
| 1. parmak şeridi | 10 | `INPUT_PULLUP`, LOW olan şerit basılı sayılır |
| 2. parmak şeridi | 11 | aynı |
| 3. parmak şeridi | 12 | aynı |
| 4. parmak şeridi | 13 | aynı |
| MPU6050 SDA / SCL | 8 / 9 | I2C. Şimdilik firmware okumuyor |

## Nasıl çalışır

**Tel** = sopanın değdiği bakır tel. **Parmak** = o tel bir folyoya bastırılınca LOW olan folyo. Sopa bir tele değerken o telin bakırı GND'dedir; folyoya bastırılınca o folyonun pini de LOW olur. Sopanın değmediği bir tel folyoya bastırılsa da folyo LOW olmaz.

Birden fazla folyo değiyorsa **en yüksek numaralı folyo** geçerlidir. Örneğin 4. folyoya basınca tel aradaki 1–3. folyolara da değebilir; parmak yine 4 sayılır.

**Nota = telin boş sesi + parmağın yarım sesi** (boş, 1., 2., 3., 4. parmak için 0, 2, 4, 5, 7):

| Tel | Boş | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Sol | G3 | A3 | B3 | C4 | D4 |
| Re | D4 | E4 | F#4 | G4 | A4 |
| La | A4 | B4 | C#5 | D5 | E5 |
| Mi | E5 | F#5 | G#5 | A5 | B5 |

Kart saniyede 200 satır gönderir:

```
S,t_us,mask,ax,ay,az,gx,gy,gz,fmask    mask: sopanın değdiği teller, fmask: LOW olan folyolar (bit 0 = 1. parmak)
H,t_us,fw,imu_ok,i2c_err               saniyede bir durum satırı
```

## Yapılanlar

### Donanımda denenenler

- Kart saniyede 200 satır gönderiyor, `t_us` sıçramasız ilerliyor (kayıtlarda ölçüldü, `recordings/`).
- Dört bakır tel teması: sopa değince doğru telin biti 1 oluyor.
- Folyo matrisi (bakır tel × folyo): firmware 0.10.0 yüklendi ve kullanıldı. Aynı anda birden çok folyo değebiliyor; yazılım en yüksek numaralıyı alıyor.
- Chrome'da Web Serial ile karta bağlanma ve canlı tel teması.

### Yalnızca simülatör ve testlerle doğrulananlar

- Yay yönü ve yay hızı (`motion.js`, `strokes.js`): kod yazıldı ve sentetik veriyle sınandı. MPU6050 bağlı olmadığı için gerçek donanımda henüz çalışmıyor.
- Hata kuralları (`rules.js`): yanlış tel, komşu tele değme, erken, geç, ters yay yönü, düzensiz yay hızı.
- Şarkı denemesi, metronom ve öğretmenin sonuç metni.
- Gerçek keman sesi, porte, Bülbül ve ders sistemi: otomatik tarayıcı testlerinde (headless Chromium) çalışıyor, simülatörle baştan sona oynandı. Kartla elle uçtan uca denenmedi; sesin kulağa nasıl geldiği de kullanıcı tarafından henüz onaylanmadı.

### Yazılım

- **Uygulama (`web/`)**: saf JavaScript modülleri, derleme adımı ve bağımlılık yok. Hesaplayan modüller (`protocol`, `motion`, `strokes`, `fingers`, `session`, `rules`, `song`, `lessons`) tarayıcıya özgü hiçbir şeye dokunmaz; Node testleri onları doğrudan çalıştırır.
- **Nizolingo arayüzü**: Öğren, Çal ve Atölye ekranları, XP ve gün serisi, koyu tema, telefon genişliği.
- **Bülbül**: özgün çizilmiş öğretmen kuş. 8 etkileşimli ders sistemi sırayla öğretiyor ve her adımda alettan gerçek girdi bekliyor: Tanışalım, Bağlan ve dinle, İlk ses, Dört tel, Parmaklar, Porte, İlk şarkı, Bülbül'e sor.
- **Keman sesi**: 11 solo keman kaydı (G3–C6), ara perdeler hız değişimiyle. Kaydın 3–8. saniyeleri tıkırtısız bir döngüyle uzatılıyor. Yay hızı ses düzeyini ve parlaklığı belirliyor. Kayıtlar yüklenemezse sentez çalıyor.
- **Porte**: sol anahtarlı, çalınan notalar diyez ve ek çizgilerle çiziliyor.
- **Öğretmen**: metni, sonraki egzersizi ve tempoyu kurallar yazıyor. Yerel model (`gemma3:4b`) yalnızca soru-cevapta kullanılıyor ve yanıtı denetimden geçiyor. Tel–parmak ve "ölçmüyor" soruları modele gitmeden kodla yanıtlanıyor, çünkü küçük model bunlarda yanılıyordu.
- **Firmware (`firmware/yay/yay.ino`)**: 1 kHz tel ve folyo örnekleme, sıçrama süzgeci, tek satır biçimi.
- **Araçlar (`tools/`)**: terminalden kayıt, canlı temas izleyici, kayıt oynatma ve analiz, boşluk histogramı, öğretmen değerlendirmesi.
- **128 test**; firmware mantığı da bilgisayarda taklit Arduino ile test ediliyor.

### Denenip bırakılanlar

- **Kapasitif dokunmatik şerit** (`touchRead`): şeffaf bant, bakır tel ve jumper kabloları sinyali bozuyordu; bir şerit tüm taramayı donduruyordu. Bakır tel × folyo teması çok daha güvenilir çıktı.
- **Modelin öğretmen metnini yazması**: `gemma3:4b` metinde sayı ve anlam hataları yaptı, yanıt 10 sn'yi aştı. Bu yüzden metni kurallar yazıyor.

## Bilinen sınırlar

- Şarkı denemesinde şimdilik doğru **tele** değince sıradaki nota çalıyor. Beklenen parmak şarkı verisinde tutulmuyor; `wrong_finger` gibi parmak kuralları yok.
- Gecikme hedefi (tele değmeden sese 30 ms) telefonla **ölçülmedi**.
- Eşikler başlangıç tahminidir ve gerçek kayıtlarla ayarlanmadı (`web/thresholds.js`). Özellikle `T_GAP_MS` (notayı bitiren temas boşluğu, 80 ms) ölçülmedi.
- Yay yönü ve hızı gerçek MPU6050 ile test edilmedi.
- Otomatik tarayıcı testleri Chromium'da çalışıyor; Safari'de yalnızca erken bir sürümde elle denendi.
- Bağlantılar lehimsiz; kablo çıkması ölçümü bozabilir.
- Entonasyon (parmağın şerit üstündeki tam yeri), ton kalitesi ve gerçek keman desteği kapsam dışı.

## Çalıştırma

Gereken: Node.js 20+.

```
npm test        # 128 test; kart ya da tarayıcı gerekmez
npm start       # http://127.0.0.1:8000 adresinde sayfayı açar
```

Chrome ya da Edge'de `http://127.0.0.1:8000` adresini aç. Kartın yoksa Öğren ekranında "Simülatörle öğren" ya da Çal ekranında "Simülatörü başlat" ile klavyeden çalabilirsin:

| Tuş | Anlamı |
|---|---|
| `A` `S` `D` `F` | Sol, Re, La, Mi teline temas |
| `1` `2` `3` `4` | Parmak şeridi (sopa bir teldeyken) |
| `→` / `←` | Çekerek / iterek hareket |
| `Shift` | Hızlı hareket |

### Firmware'i karta yüklemek

```
arduino-cli core install esp32:esp32     # ilk kez
arduino-cli compile -b esp32:esp32:esp32s3:CDCOnBoot=default firmware/yay
arduino-cli upload  -b esp32:esp32:esp32s3:CDCOnBoot=default -p /dev/cu.usbmodemXXXX firmware/yay
```

`CDCOnBoot=default` (kapalı), `Serial`'in köprü çipine gitmesi içindir. Portu aynı anda tek program açabilir; yüklemeden önce tarayıcıdaki bağlantıyı kes ve seri monitörleri kapat.

### Terminal araçları

```
tools/live.sh [--touch]                          # kartı canlı izle: TEMAS, PARMAK, NOTA satırları
tools/record.sh 60 recordings/kayit.txt          # karttan 60 sn kayıt
node tools/replay.mjs recordings/kayit.txt       # kaydı uygulamanın zincirinden geçir, raporla
node tools/gap_histogram.mjs --long uzun.txt --lift kaldir.txt --string 2   # T_GAP_MS önerisi
node tools/teacher_eval.mjs [--qa]               # yerel modeli değerlendir (Ollama gerekir)
```

Ollama'yı soru-cevap için kullanmak istersen:

```
ollama pull gemma3:4b
ollama serve
```

## Klasörler

| Yol | İçeriği |
|---|---|
| `web/` | Uygulama: `index.html`, `main.js` (bağlantı), `audio.js`, `ui.js`, `school.js` ve yukarıda sayılan modüller |
| `web/songs/` | Beş egzersiz ve `index.json` (şarkı formatı: `[perde, vuruş]` çiftleri) |
| `web/samples/violin/` | Keman kayıtları ve `KAYNAK.md` |
| `firmware/yay/` | ESP32-S3 firmware'i |
| `test/` | Birim, entegrasyon ve firmware testleri |
| `tools/` | Terminal araçları |
| `recordings/` | Karttan alınan ham kayıtlar. `asama8_seritler_*` dosyaları eski kapasitif şerit denemesinin 13 alanlı satırlarını taşır; araçlar bunları da okur |
| `docs/ilk-plan.md` | Projenin ilk yazılım planı (kısmen eski, bkz. dosyanın başı) |
| `OGRENILENLER.md` | Öğrenme defteri; yalnızca ilk aşamaları kapsar |

## Kaynaklar ve lisans

- Keman örnekleri: [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE), Versilian Studios, **CC0 1.0** (kamu malı).
- Kuş (Bülbül) bu projeye özgü çizilmiş bir SVG'dir.
- Bu depodaki kod için henüz bir lisans seçilmedi.
