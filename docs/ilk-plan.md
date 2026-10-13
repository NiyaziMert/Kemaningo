> **Not:** Bu, projenin başında yazılan ilk plandır. Bazı kararlar sonradan değişti:
> sol el artık kapsam dışı değil (parmak şeritleri eklendi), parmak şeritleri kapasitif okuma yerine
> bakır tel × folyo teması ile okunuyor ve keman sesi sentez yerine gerçek kayıtlardan geliyor.
> Güncel durum için [README](../README.md) dosyasına bak.

# Keman Yayı Aleti ve Öğretmeni: Yazılım Planı

Oct 10, 2026 · @Prompt Engineers

ESP32 ham veriyi USB seri üzerinden satır satır gönderir. Tarayıcıdaki tek sayfalık uygulama bu satırlardan yay çekişlerini ayırır, sesi sentezler ve hata kurallarını çalıştırır. Yerel dil modeli yalnızca kuralların bulduğunu anlatır ve sonraki egzersizi seçer; araya senin yazacağın bir sunucu girmez.

Klavye simülatörü ile donanım aynı satır formatını üretir. Bu yüzden 0–7. aşamalar donanım olmadan biter, 8–10. aşamalar tahta kurulunca başlar.

## Boş bıraktığın üç bilgi

Kart modeli, işlemci/RAM ve deneyim mimariyi değiştirmiyor; yalnızca aşağıdaki kararları koşullu yapıyor. Hiçbirini tahmin etmedim.

| Boş bilgi | Etkilediği karar | Koşul ve sonuç |
| --- | --- | --- |
| ESP32-S3 kartının modeli | Seri bağlantı ayarı ve pinler | Kullandığın USB portu doğrudan çipe bağlıysa Arduino'da "USB CDC On Boot" açılır ve baud hızı aktarımı sınırlamaz. Port bir USB–UART köprü çipinden geçiyorsa ayar kapalı kalır, baud hızı 921600 seçilir. Pin numaralarını plan vermez; kartının pin şemasından sen seçersin (Aşama 8). |
| İşlemci ve RAM | Dil modelinin boyutu | Apple Silicon işlemcide bellek arttıkça daha büyük model seçilir. Intel işlemcide ya da model belleğe sığmıyorsa model kullanılmaz, şablon öğretmen çalışır. Ayrıntı Karar 7'de. |
| Deneyim | Araçlar ve ayrılacak süre | Arduino'ya yeniysen Arduino IDE, değilsen PlatformIO. Web deneyimin azsa Aşama 2 ve 5'e fazladan zaman ayır. Mimari ve diller değişmez. |

## Genel mimari

Üç parça var: ESP32 yazılımı, tarayıcı uygulaması ve yerel model sunucusu (Ollama). Sayfayı hazır bir statik sunucu komutu sunar. Kararların tamamı tarayıcıda verilir; kart yalnızca ölçer, model yalnızca anlatır.

&#91;embedded content: mimari · 3 kaynak, 6 modül, 1 model sunucusu\]

Çalarken yalnızca üst sıra çalışır. Alt sıra deneme bitince bir kez çalışır ve model yalnızca o zaman çağrılır. `ui.js` ile `main.js` şemada yok: biri ekranı çizer, diğeri parçaları bağlar.

### Parçalar

| Parça | Nerede çalışır | Görevi |
| --- | --- | --- |
| Firmware (`yay.ino`) | ESP32-S3 | Dört tel pinini 1 kHz'de, MPU6050'yi 200 Hz'de okur ve 5 ms'de bir `S` satırı gönderir. Karar vermez. |
| Girdi kaynakları (`serial.js`, `simulator.js`, `replay.js`) | Tarayıcı | Üçü de aynı `S` satırını üretir: gerçek kart, klavye, kayıt dosyası. |
| Hareket (`motion.js`) | Tarayıcı | Ham ivme ve açısal hızdan sopanın ekseni boyunca hızı ve durağanlığı kestirir. |
| Yay bölütleme (`strokes.js`) | Tarayıcı | Temas ve hızdan "çekiş başladı" ve "çekiş bitti" olaylarını çıkarır. |
| Oturum (`session.js`) | Tarayıcı | Sıradaki notayı tutar, doğru telde sesi başlatır, her nota için kayıt oluşturur. |
| Ses (`audio.js`) | Tarayıcı | Notayı sentezler, ses düzeyini yay hızına bağlar, metronomu çalar. |
| Kurallar (`rules.js`) | Tarayıcı | Nota kayıtlarından hata bulgularını çıkarır. Deneme bitince bir kez çalışır. |
| Öğretmen (`teacher.js`) | Tarayıcı | Bulguları Türkçe cümleye çevirir, modele gönderir, çıktıyı doğrular. Model yoksa şablon metni gösterir. |
| Ollama | Mac'te ayrı süreç, `127.0.0.1:11434` | Yerel modeli çalıştırır. Yalnızca deneme bittikten sonra çağrılır. |

### Veri akışı

1. Kart ya da simülatör 5 ms'de bir `S` satırı üretir.
2. `protocol.js` satırı örneğe çevirir; `motion.js` hız ve durağanlık bilgisini ekler.
3. `strokes.js` örneklerden çekiş olayları üretir.
4. `session.js` çekişin telini beklenen telle karşılaştırır; doğruysa `audio.js` sıradaki notayı çalar.
5. Çekiş bitince o notanın kaydı tamamlanır.
6. Deneme bitince `rules.js` bulguları çıkarır ve ekranda hemen gösterir.
7. `teacher.js` bulguları modele gönderir; öğretmen metni ile sonraki egzersiz ve tempo önerisi döner.

### Mesaj 1: karttan uygulamaya `S` satırı

Metin satırı, saniyede 200 kez. Biçim `S,t_us,mask,ax,ay,az,gx,gy,gz`, örnek `S,8412345,4,-310,95,8120,14,-3,22`.

| Alan | Tür | Anlam |
| --- | --- | --- |
| `t_us` | tamsayı | Kart açıldığından beri geçen mikrosaniye |
| `mask` | 0–15 | Son 5 ms'de temas görülen teller. Bit 0 Sol, bit 1 Re, bit 2 La, bit 3 Mi |
| `ax` `ay` `az` | int16 | Ham ivme. ±4 g aralığında 8192 birim 1 g eder |
| `gx` `gy` `gz` | int16 | Ham açısal hız. ±500 °/s aralığında 65,5 birim 1 °/s eder |

Kart saniyede bir de durum satırı yollar: `H,t_us,fw,imu_ok,i2c_err`. `fw` firmware sürümü, `imu_ok` MPU6050'nin yanıt verip vermediği (0 ya da 1), `i2c_err` açılıştan beri I2C okuma hatası sayısıdır. `S,` ya da `H,` ile başlamayan satırlar sayılır ve atlanır. Zaman damgası 32 bitlik sayaçtan geliyorsa yaklaşık 71 dakikada başa döner; ayrıştırıcı ardışık farkı bu taşmayı gözeterek alır.

### Mesaj 2: örnek (uygulama içi)

`protocol.js` ve `motion.js` her `S` satırından bu nesneyi üretir.

| Alan | Tür | Anlam |
| --- | --- | --- |
| `t` | ms | Kartın saati. Yalnızca örnekler arası süre için kullanılır |
| `t_host` | ms | Satırın tarayıcıya ulaştığı an (`performance.now()`). Zamanlama ölçümleri bunu kullanır |
| `mask` | 0–15 | `S` satırındaki ile aynı |
| `acc` | \[x, y, z\] m/s² | İvme |
| `gyro` | \[x, y, z\] rad/s | Açısal hız, dinlenme sapması çıkarılmış |
| `v` | m/s | Sopanın ekseni boyunca hız kestirimi. Artı değer çekerek yay |
| `still` | boolean | Sopa durağan mı |

### Mesaj 3: çekiş olayları

`strokes.js` üç olay yayınlar; `session.js` ve `audio.js` dinler.

| Olay | Alanlar |
| --- | --- |
| `stroke_start` | `id`, `t_host`, `string` (0 Sol … 3 Mi), `cause` (`contact`, `reversal`, `string_change`, `resume`) |
| `stroke_update` | `id`, `speed` (m/s; çekiş içinde sızdırılmadan toplanan hızın mutlak değeri). Her örnekte bir kez |
| `stroke_end` | `id`, `t_host`, `cause` (`gap`, `reversal`, `string_change`, `pause`), `dur_ms`, `dir` (`D` çekerek, `U` iterek, `null` bilinmiyor), `dir_conf` (0–1), `accel_rms` (m/s²), `gap_count`, `max_gap_ms`, `other_ms` (dört elemanlı dizi: çekiş sırasında diğer tellerdeki temas süresi) |

### Mesaj 4: nota kaydı

`session.js` şarkıdaki her nota için bir kayıt tutar. Kurallar yalnızca bu kayıtları okur.

| Alan | Tür | Anlam |
| --- | --- | --- |
| `index` | 1'den başlar | Notanın şarkıdaki sırası |
| `expected` | nesne | Beklenen `string`, `bow`, `midi`, `start_beat`, `dur_beats` |
| `onset_ms` | ms | Deneme başından notanın başladığı ana |
| `timing_error_ms` | ms ya da `null` | Eksi erken, artı geç. `null` değerlendirilmedi demek |
| `wrong_strokes` | liste | Bu nota beklenirken yanlış telde yapılan çekişler: `string`, `dur_ms` |
| `neighbor_ms` | ms | Çekiş sırasında ve girişte komşu tele değme süresi toplamı |
| `neighbor_string` | 0–3 ya da `null` | Değilen komşu tel |
| `bow_dir` | `D`, `U`, `null` | Ölçülen yay yönü. `null` güvenilir ölçülemedi demek |
| `dur_ms` | ms | Çekişin süresi |
| `accel_rms` | m/s² ya da `null` | Çekişin orta bölümünde eksenel ivmenin RMS değeri |
| `gap_count`, `max_gap_ms` | sayı, ms | Çekiş içindeki temas boşlukları. Teşhis içindir |

Modele giden ve modelden dönen JSON "Öğretmen" bölümünde.

## Zor noktalardaki kararlar

Sekiz kararın her biri öneri, gerekçe ve vazgeçilen alternatif olarak yazıldı. Sayısal eşiklerin hepsi başlangıç değeridir; nasıl ayarlanacakları "Hata kuralları" bölümünde.

### Karar 1: Aktarım, Web Serial üzerinden düz metin satırı

**Öneri.** Kart USB seri üzerinden satır satır metin gönderir, tarayıcı bunu Web Serial ile doğrudan okur. Tarayıcı olarak Chrome ya da Edge gerekir.

| Seçenek | Gecikme | Sürekli hız ve yön verisi | Tarayıcı desteği | Kurulum |
| --- | --- | --- | --- | --- |
| USB MIDI + Web MIDI | Düşük olmasını beklerim; ölçmedim | Zayıf. MIDI değerleri 7 ya da 14 bittir; 16 bitlik altı eksen ile maske için SysEx içinde özel kodlama gerekir | Chrome 43+, Edge 79+, Firefox 108+. Safari'de yok ([caniuse](https://caniuse.com/midi)) | Kartın çipe doğrudan bağlı USB portu ve TinyUSB ayarı şart. Seri hata ayıklama ayrı porta kalır |
| Web Serial (öneri) | Düşük olmasını beklerim; Aşama 8'de ölçülecek | Uygun. Satıra istediğin alanı yazarsın | Chrome 89+, Edge 89+, masaüstü Firefox 151+. Safari'de yok ([caniuse](https://caniuse.com/web-serial)) | Ek süreç yok; köprü çipli kartta sürücü gerekebilir. Sayfada bir kez "Bağlan" tıklanır |
| Yerel sunucu + WebSocket | Web Serial'e ek bir süreç atlaması | Uygun | Safari dahil hepsi | Python ya da Node süreci ve bağımlılıkları. İki şey birden başlatılır |

**Gerekçe.** Ham veriyi tarayıcıya taşımak, bölütleme eşiklerini kartı yeniden yüklemeden ayarlamayı ve kayıtları yeniden oynatmayı sağlar. Web Serial araya süreç koymaz; aynı satırları Arduino'nun seri ekranında da okursun. Kart modelin belli olmadığı için iki port türünde de çalışması ayrıca işe yarar.

**Vazgeçilen alternatif.** USB MIDI hazır nota olayı taşımak için tasarlanmıştır; onu seçmek bölütlemeyi ve yön kestirimini firmware'e taşımayı gerektirir. Yerel sunucu + WebSocket yalnızca Safari şartsa gerekir ve yedek yol olarak durur: kısa bir Python köprüsü `S` satırlarını WebSocket'e aktarır, uygulamada yalnızca `serial.js` değişir.

**Satır hızı.** Bir `S` satırı 35–58 bayt tutar; saniyede 200 satır en çok 12 kB/sn eder. Çipin kendi USB'sinde bu sorun değildir. UART köprüsünde 115200 baud yaklaşık 11,5 kB/sn taşır ve yetmez; 921600 seç.

### Karar 2: Temas gürültüsü, çekişi boşluk ve yön birlikte ayırır

**Öneri.** Bir çekiş şudur: aynı telde, aynı yönde, 80 ms'den uzun temas kopmadan ve 150 ms'den uzun durmadan süren hareket. Kararı tarayıcıdaki `strokes.js` verir; firmware yalnızca elektriksel sıçramayı temizler.

Firmware tel pinlerini 1 kHz'de örnekler ve art arda 2 düşük örneği temas sayar. 5 ms'lik pencerede bir kez bile temas görüldüyse maskeye 1 yazar; böylece birkaç milisaniyelik kesiklikler tarayıcıya hiç ulaşmaz. Daha uzun boşluklar için karar tablosu:

| Temas boşluğu | Boşluktan önceki ve sonraki yön | Karar |
| --- | --- | --- |
| Yok | Aynı | Aynı çekiş |
| Yok | Değişti | Yeni çekiş (yay değişimi) |
| 80 ms'den kısa | Aynı | Aynı çekiş; boşluk gürültü sayılır |
| 80 ms'den kısa | Değişti | Yeni çekiş |
| 80 ms ya da uzun | Aynı | Yeni çekiş (sopa kaldırılıp yeniden kondu) |
| 80 ms ya da uzun | Değişti | Yeni çekiş |

**Yön değişimi ile temas kopmasının ilişkisi.** Arka arkaya gelen hızlı notalar fiziksel olarak yön değişimiyle ayrılır. Aynı yönde ikinci bir çekiş ise sopayı kaldırıp geri getirmeyi gerektirir, yani yavaştır. Bu yüzden boşluk eşiği cömert tutulabilir; süre eşiğine yalnızca yönün aynı kaldığı üçüncü ve beşinci satırlar bağlıdır.

Tabloyu tamamlayan kurallar:

- **Başlangıç:** temas var ve sopa hareket ediyor. Sopa tele konup bekliyorsa ses çıkmaz; nota hareketle başlar.
- **Geçici ilk 100 ms:** ses hemen başlar, ama çekiş 100 ms dolunca kesinleşir. Bu süre dolmadan çekiş biterse, yani temas kalıcı olarak koparsa ya da sopa durağanlaşırsa, çekiş iptal edilir: ses kesilir ve şarkı ilerlemez. Bu sürede hızın işaret değiştirmesi çekişi bölmez, yalnızca yönünü belirler.
- **Boşluğa yakın yön değişimi:** yön değişimi bir boşluğun 60 ms yakınındaysa yeni çekişin başlangıcı temasın geri geldiği andır.
- **Havadaki hareket:** temas yokken görülen yön değişimi nota üretmez, yalnızca yön durumunu günceller.
- **Durma:** telde 150 ms'den uzun durma çekişi bitirir; sonraki hareket yeni çekiştir.
- **Tel devri:** nota çalarken başka tele geçiş için o telin 30 ms tek başına temas etmesi gerekir. Çalan nota yokken beklenen tele değildiği an çekiş o tele yazılır; diğer teldeki temas "komşu teması" sayılır.

**Gerekçe.** Kararı tarayıcıda vermek, eşikleri kayıtlar üzerinde yeniden deneyerek ayarlamayı sağlar. Yönü kullanmak, süre eşiğinin tek başına çözemediği iki durumu ayırır: kısa boşluklu yay değişimi ve kesintisiz yay değişimi.

**Vazgeçilen alternatif.** Yalnızca süreye bakan tek bir bekleme eşiği. Kısa tutulursa kesik temaslı uzun notayı böler, uzun tutulursa hızlı notaları birleştirir. Yine de yedek olarak durur: Aşama 8'de alet yalnızca temasla çalışır ve notalar arasında sopayı kaldırman gerekir.

**Sınırı.** Durma ile yön değişimini ayırmak yön kestirimine bağlıdır. Riskli kısım budur; Karar 3 ve Risk 1 bunu ele alır.

### Karar 3: Yay yönü ve hızı, sopanın ekseni boyunca ivmeden

**Öneri.** Yön ve hız tek sinyalden çıkar: sopanın uzun ekseni boyunca, yerçekimi çıkarılmış ivmenin toplamı. Hesap tarayıcıda, `motion.js` içinde yapılır ve her örnekte beş adımdır:

1. **Yerçekimi takibi.** Yerçekimi vektörü jiroskopla döndürülür. Yalnızca sopa durağanken ivmeölçerin okuduğu değere doğru her örnekte 0,05 oranında çekilir. Hareket sırasında düzeltme yapılmaz, çünkü yay yönündeki ivme eğim gibi görünür.
2. **Eksenel ivme.** Ölçülen ivmeden yerçekimi çıkarılır, kalan sopanın eksenine izdüşürülür.
3. **Hız.** Eksenel ivme toplanır; toplam 3 sn zaman sabitiyle sıfıra sızar. Sızıntı, küçük bir ivme sapmasının hızı sınırsız kaydırmasını önler.
4. **Sıfırlama.** Sopa 150 ms durağan kalırsa hız sıfıra çekilir.
5. **Yön.** Hızın işaretidir. Hız 0,05 m/s altındaysa yön "bilinmiyor" sayılır.

"Durağan" şu demektir: son 60 ms'de ivme büyüklüğünün standart sapması ve açısal hız, dinlenme kalibrasyonunda ölçülen gürültünün 3 katının altında. Çekerek yay, temas noktasının sopanın el ucundan uzak ucuna doğru kaymasıdır; hız bu yönde artı sayılır.

**Sızıntının bedeli.** Sabit hızlı çekişte kestirim söner: 1 sn sonra gerçek hızın yaklaşık %70'ini, 2 sn sonra yarısını gösterir. Bu yüzden ses düzeyi ikinci bir toplamdan beslenir: çekiş başında aynı değerden başlar ve çekiş bitene kadar sızdırılmaz.

**Tutuş açısı neden bozmaz.** Sopayı kendi ekseni etrafında çevirmek eksenel bileşeni değiştirmez. Tel değiştirirken sopanın eğimi değişir; jiroskop bunu örnekten örneğe izler. Manyetometre gerekmez, çünkü hesapta pusula yönü yok, yalnızca yerçekimine göre eğim var.

**Kalibrasyon.** Sonuçlar tarayıcıda saklanır.

| Adım | Ne zaman | Sen ne yaparsın | Ne hesaplanır |
| --- | --- | --- | --- |
| Dinlenme | Her oturum başında, 2 sn | Sopayı tahtanın üstüne bırakırsın | Jiroskop sapması, başlangıç yerçekimi vektörü, durağanlık eşiği |
| Yön | Bir kez; MPU6050'nin sopadaki yeri değişirse yeniden | Bir tele, her birinden önce durarak, üç kez çekerek yay çekersin | Sopanın ekseni (ivmenin en çok değiştiği sensör ekseni) ve artı yönü |
| Eksen ofseti | Yalnızca hız fazla kayıyorsa | Sopayı ucu yukarı 2 sn, ucu aşağı 2 sn tutarsın | Eksenel ivmenin ofseti ve ölçeği |

**Durmayı yön değişiminden ayırmak.** İvmeölçer sabit hızlı hareketi durmadan ayıramaz. Uzun bir notanın sonunda telde durmak, sızıntı yüzünden ters yöne hareket gibi görünebilir. İki önlem var:

- Yön değişimi ancak ters yöndeki hız, biten çekişin tepe hızının yarısına ulaşırsa kabul edilir. Bu önlem yaklaşık 2 sn'ye kadar olan çekişlerde yeter.
- Daha uzun notalarda ikinci önlem devreye girer: Karar 2'deki 100 ms'lik geçici sürede durağanlık görülürse çekiş iptal edilir.

**Tel değişiminden sonra sapma.** Hareket sırasında eğimi yalnızca jiroskop izler; jiroskobun ölçek hatası tel değişiminden sonra küçük bir ivme sapması bırakabilir. Kayıtlarda görülürse hareket sırasında çok yavaş bir düzeltme eklenir.

**Gerekçe.** Yön değişimi ivmede büyük ve kısa bir darbedir: hız eksi 0,3'ten artı 0,3 m/s'ye 150 ms'de geçerse ortalama ivme 4 m/s² eder. Mutlak hız ise kayar: 0,5 derecelik eğim hatası her saniye yaklaşık 0,09 m/s hata biriktirir. Bu yüzden hızın büyüklüğü yalnızca ses düzeyinde kullanılır, yön için işaretine bakılır; "düzensiz hız" kuralı toplama değil doğrudan ivmeye bakar.

**Vazgeçilen alternatif.** MPU6050'nin çip içi hareket işlemcisi (DMP). Yönelimi hazır verir, ama projeyi bir kütüphaneye ve onun kartla uyumuna bağlar; süzgeci de ayarlanamaz. Yerçekimini çıkarmadan ivmenin işaretine bakmak daha da basittir, ama tel değişiminde eğim değişince yanlış yön verir.

### Karar 4: Gecikme hedefi 30 ms

**Öneri.** Sopanın tele değmesinden sesin hoparlörden çıkmasına kadar medyan 30 ms, en kötü durumda 45 ms. Bütçe beş parçaya bölünür:

| Parça | Bütçe (ms) | Nasıl ölçülür |
| --- | --- | --- |
| Temas onayı (2 örnek) ve paket bekleme (5 ms pencere) | 5 | Hesapla bulunur: en çok 7, ortalama 4 |
| USB, işletim sistemi ve tarayıcının satırı teslim etmesi | 4 | Aşama 8'deki uçtan uca ölçümden kalan pay |
| Ayrıştırma, hareket, bölütleme ve nota kararı | 2 | `performance.now()` farkı |
| Kararın ses iş parçacığına ulaşması | 3 | Bir ses işleme bloğu: 128 örnek, yaklaşık 2,7–2,9 ms |
| Ses çıkışı | 16 | Konsolda `baseLatency + outputLatency` |
| **Toplam** | **30** | Telefonla ses kaydı (Aşama 8) |

**Neden 30 ms.** Kaba kural olarak 10 ms'nin altı fark edilmez, 50 ms'nin üstü geç kalmış hissi verir. Yaylı çalgıda ses zaten yavaş yükseldiği için 30 ms rahat bir hedeftir. Bu sayılar genel kabule dayanır; son sözü kendi kulağın söyler.

**Bütçeyi koruyan iki tasarım kararı.**

- Ses, yön beklenmeden başlar. Perdeyi uygulama seçtiği için başlangıçta tel bilgisi yeter; yön çekişin ilk 200 ms'sinden okunur ve yalnızca kayda gider.
- Zamanlama kuralı gecikmeden neredeyse etkilenmez. Aralık hatasında sabit gecikme birbirini götürür; ızgara hatasına en çok 14 ms'lik sabit bir kayma olarak girer ve tolerans en az 80 ms'dir.

**İkinci hedef: 60 ms.** Yön değişimiyle ya da telde bekleyen sopanın harekete geçmesiyle başlayan notalarda algılama payı eklenir. Bu pay, ivme süzgecinin 4,9 ms gecikmesi ile hızın 0,05 m/s'yi geçmesi için gereken süredir.

**Bütçe aşılırsa**, kazanç sırasıyla:

1. Ses çıkışını değiştir. Bluetooth ses çıkışı bütçenin birkaç katı gecikme ekleyebilir; dahili hoparlör ya da kablolu kulaklık kullan.
2. Kart, maske değiştiği an fazladan bir `S` satırı yollasın. Paket beklemesi kalkar.
3. Seri okumayı ve bölütlemeyi bir Web Worker'a taşı. Ekran çizimi kararı geciktiremez.

**Vazgeçilen alternatif.** 10 ms hedefi. Tarayıcıda ses çıkışı tek başına bunu aşabilir; tutturmak tarayıcı dışında bir ses uygulaması gerektirir ve yaylı seste fark yaratması beklenmez.

### Karar 5: Şarkı formatı kısa bir JSON, tel perdeden türetilir

**Öneri.** Her şarkı ve egzersiz tek bir JSON dosyasıdır. Notalar `[perde, vuruş]` çiftleri olarak yazılır; tel ve yay yönü yüklenirken türetilir, istenen notada elle yazılır.

```json
{
  "id": "daha_dun",
  "title": "Daha Dün Annemizin",
  "bpm": 60,
  "beats_per_bar": 4,
  "level": 3,
  "targets": ["wrong_string", "late"],
  "notes": [
    ["A4", 1], ["A4", 1], ["E5", 1], ["E5", 1],
    ["F#5", 1], ["F#5", 1], ["E5", 2],
    ["D5", 1], ["D5", 1], ["C#5", 1], ["C#5", 1],
    ["B4", 1], ["B4", 1], ["A4", 2]
  ]
}
```

| Alan | Zorunlu | Anlam |
| --- | --- | --- |
| `id`, `title` | Evet | Kimlik ve ekranda görünen ad |
| `bpm` | Evet | Varsayılan tempo |
| `beats_per_bar` | Evet | Hazırlık sayımı ve metronom vurgusu için |
| `level`, `targets` | Evet | Öğretmenin seçim yaparken kullandığı seviye ve egzersizin hedeflediği hata türleri |
| `notes[i][0]` | Evet | Perde (`A4`, `F#5`) ya da sus için `R` |
| `notes[i][1]` | Evet | Süre, vuruş cinsinden |
| `notes[i][2].string` | Hayır | Teli elle belirler: `Sol`, `Re`, `La`, `Mi` |
| `notes[i][2].bow` | Hayır | Yay yönünü elle belirler: `D` çekerek, `U` iterek |

Elle yazım örneği: `["A4", 1, {"string": "Re"}]` La4'ü Re telinde çaldırır. Yükleyici her notaya `start_beat` değerini süreleri toplayarak ekler. `songs/index.json` dosya adlarını listeler; tarayıcı bir klasörün içeriğini kendisi listeleyemediği için gerekir.

**Tel türetme kuralı.** Açık sesi perdeden yüksek olmayan en tiz tel seçilir:

| Perde | Tel |
| --- | --- |
| G3 – C#4 | Sol |
| D4 – G#4 | Re |
| A4 – D#5 | La |
| E5 ve üstü | Mi |
| G3'ün altı | Hata; şarkı yüklenmez |

**Yay yönü kuralı.** İlk nota çekerek başlar, sonraki her nota yön değiştirir. `bow` yazılan notada dönüşüm o değerden devam eder. Sus yönü değiştirmez.

**Gerekçe.** Türetme kuralı, kemanda birinci pozisyonda açık teli tercih eden düzenle aynı sonucu verir ve başlangıç parçalarının çoğuna uyar. Elle yazım, tek bir nota için tel değiştirmek istemediğin yerler içindir. Format ayrıştırıcı gerektirmez; `JSON.parse` yeter.

**Vazgeçilen alternatif.** MusicXML ya da MIDI dosyası. Hazır parça bulmak kolaylaşır, ama ikisi de ayrıştırıcı kütüphane ister ve MIDI dosyası tel ile yay yönünü hiç taşımaz. Tel atamasını tümüyle elle yazmak da elendi: her notaya bir alan ekler ve yanlış yazılması kolaydır.

### Karar 6: Ses örnek dosyasından değil sentezden gelir

**Öneri.** Tarayıcının hazır Web Audio düğümleriyle çıkarmalı sentez. Zincir: testere dişi osilatör, parlaklığı ayarlayan alçak geçiren süzgeç, keman gövdesini taklit eden iki ya da üç sabit tepe süzgeci, kazanç. Osilatör hep çalışır; nota başlatmak frekansı değiştirip kazancı açmaktır.

Yay hızına tepki üç eşlemeyle sağlanır:

| Girdi | Etkilediği şey | Başlangıç eşlemesi |
| --- | --- | --- |
| Yay hızı | Ses düzeyi | Hız 0,5 m/s'ye bölünür, 0,25 ile 1 arasına sıkıştırılır, 20 ms yumuşatılır |
| Yay hızı | Parlaklık | Süzgeç kesimi ses düzeyiyle birlikte 1,5 kHz'den 5 kHz'e çıkar |
| Çekişin bitmesi | Kapanış | Kazanç 80 ms'de sıfıra iner |

Ses düzeyinin alt sınırı 0,25'tir: çekiş sürerken hız kestirimi kaysa bile nota susmaz. Yalnızca temasla çalışılan kipte düzey sabit 0,7'dir.

**Gerekçe.** Yaylı telin dalgası testere dişine yakındır, bu yüzden sentez makul bir başlangıç verir. Sürekli kontrol sentezde doğaldır ve nota süresi serbesttir. Dosya, lisans ve yükleme süresi yoktur; AudioWorklet de gerekmediği için kod azdır.

**Vazgeçilen alternatif.** Örnek dosyası. Tını daha gerçekçi olur, ama süresi belirsiz notalar için döngü noktası, perde başına dosya ve lisans gerekir; yay hızına da yalnızca ses düzeyiyle tepki verir. Fiziksel modelleme (yaylı tel dalga kılavuzu) hıza en doğal tepkiyi verir, ama AudioWorklet ve ince ayar ister; sentez yetmezse sonraki adım odur.

**Sınırı.** Tını gerçek keman gibi olmayacak. Hedef, kemanı andıran ve yaya tepki veren bir sestir.

### Karar 7: Yerel dil modeli, Ollama üzerinde RAM'e göre seçilen bir Gemma

**Öneri.** Çalıştırıcı Ollama. Varsayılan olarak yalnızca `127.0.0.1:11434` adresini dinler ([SSS](https://docs.ollama.com/faq)), JSON şemasına bağlı çıktı üretir ([belge](https://docs.ollama.com/capabilities/structured-outputs)) ve yerel adreslerden gelen tarayıcı isteklerine izin verir ([kaynak kodu](https://github.com/ollama/ollama/blob/main/envconfig/config.go)). Uygulama onu `fetch` ile doğrudan çağırır.

Model, boş bıraktığın işlemci ve RAM bilgisine bağlıdır:

| Bilgisayarın | İlk aday | Karşılaştırma adayı |
| --- | --- | --- |
| Apple Silicon, 8 GB | [`gemma3:4b`](https://ollama.com/library/gemma3), 3,4 GB | [`qwen3:4b`](https://ollama.com/library/qwen3), 2,5 GB |
| Apple Silicon, 16 GB ya da üstü | [`gemma4:12b`](https://ollama.com/library/gemma4), 7,7–8,0 GB | `gemma3:12b`, 8,2 GB |
| Intel işlemci ya da 8 GB'den az | Model yok; şablon öğretmen | Denemek istersen `gemma3:1b`, 0,8 GB |

Boyutlar Ollama kitaplığındaki indirme boyutlarıdır. Kaba kural: model dosyası toplam RAM'in yarısını geçmesin; kalanı macOS, tarayıcı ve modelin çalışma belleği kullanır. Gemma 4'ün en küçük sürümü (`gemma4:e2b`, 4,6 GB) 8 GB'lik makinede bu sınırı aştığı için orada ilk aday Gemma 3'tür.

**Neden önce Gemma.** Gemma 3 için 140'tan fazla dil desteği beyan ediliyor; [TR-MMLU çalışmasında](https://arxiv.org/html/2501.00593v2) `gemma2:9b` Türkçe sorularda `llama3.1`'i geçmiş. Bunlar senin görevindeki Türkçe kalitesini kanıtlamaz. Seçimi Aşama 7'deki 10 örnekli deneme belirler.

**İstek ayarları.**

| Alan | Değer | Neden |
| --- | --- | --- |
| `format` | Çıktının JSON şeması | Çıktı şemaya uymaya zorlanır |
| `stream` | `false` | Yapılandırılmış çıktı tek parça alınır |
| `options.temperature` | 0 | Ollama belgesinin yapılandırılmış çıktı için önerisi |
| `think` | `false` | Düşünme kipi olan modellerde (Gemma 4, Qwen3) kipi kapatır ve yanıtı kısaltır |
| `options.num_ctx` | 4096 | Girdi ile çıktının toplamı bunun çok altında kalır |

**Ne zaman çağrılır.** Model yalnızca deneme bitince çağrılır; çalarken işlemciyi sesle paylaşmaz. Bulgular ekranda hemen görünür, öğretmen metni gelince eklenir. Yanıt süresi hedefi 10 sn'dir; daha küçük modele inme kararını bu sayıyla verirsin.

**RAM yetmezse**, sırayla:

1. Bir boy küçük modele in: 12B'den 4B'ye, 4B'den 1B'ye.
2. İstekte `keep_alive: 0` gönder. Model her yanıttan sonra bellekten atılır; bedeli her çağrıda yeniden yükleme süresidir.
3. Modeli kapat. Şablon öğretmen aynı bulguları hazır cümlelerle gösterir ve sonraki egzersizi kuralla seçer. Soru-cevap çalışmaz; aletin geri kalanı etkilenmez.

**Gerekçe.** Ollama tek kurulumla bu projenin istediği üç şeyi hazır verir: şemalı çıktı, yerel HTTP ucu ve tarayıcıdan doğrudan erişim. Bulut modelleri ayrı bir seçenektir; bu projede kullanılmaz ve ayarlardan kapatılabilir.

**Vazgeçilen alternatif.** llama.cpp sunucusunu ya da LM Studio'yu doğrudan kullanmak. Aynı modelleri çalıştırırlar, ama kurulum ve ayar adımları daha fazladır. Modele ham nota kayıtlarını vermek de elendi: küçük modeller uzun listelerde sayım hatası yapabilir, bu yüzden sayma ve gruplama kodda yapılır ve modele en çok altı bulgu gider.

### Karar 8: Donanımsız geliştirme, `S` satırı üreten klavye simülatörü

**Öneri.** Simülatör, kartın gönderdiği satırın aynısını üretir; uygulamanın geri kalanı kaynağın ne olduğunu bilmez. Üç kaynak aynı biçimi konuşur:

| Kaynak | Ne zaman kullanılır | Girdi |
| --- | --- | --- |
| `simulator.js` | Aşama 3–7, elle deneme | Klavye |
| `replay.js` | Testler ve eşik ayarı | Kayıt dosyası ya da test verisi |
| `serial.js` | Aşama 8 ve sonrası | Gerçek kart |

Simülatörün tuşları:

| Tuş | Anlam |
| --- | --- |
| A, S, D, F | Sol, Re, La, Mi teline temas; tuş basılıyken sürer |
| Sağ ok | Çekerek hareket |
| Sol ok | İterek hareket |
| Shift | Hızlı hareket |

Ekranda iki seçenek kutusu bulunur: "temas gürültüsü" 2–30 ms'lik rastgele boşluklar ekler, "hız dalgalanması" hareketi düzensizleştirir. Sentetik ivme basit tutulur: sopa yatay sayılır, bir eksene hızın türevi, bir eksene 1 g yazılır, jiroskop sıfırdır.

Gelen ham satırlar bellekte tutulur ve "Kaydı indir" ile dosyaya yazılır. Aynı dosya `replay.js` ile geri oynatılır; donanım gelince eşik ayarının aracı budur.

**Gerekçe.** En riskli kod hareket kestirimi ile bölütlemedir. Simülatör ham satır ürettiği için bu kod donanım gelmeden her denemede çalışır ve testlerle sabitlenir.

**Vazgeçilen alternatif.** Simülatörün doğrudan `stroke_start` ve `stroke_end` olayı üretmesi. Yazması daha kolaydır, ama hareket ve bölütleme kodu ilk kez donanımla çalışmış olurdu.

**Sınırı.** Sentetik veri kusursuzdur, gerçek sopa değildir. Bu yüzden test verisine bilerek kusur eklenir (boşluk, 0,1 m/s² sapma, gürültü) ve eşikler Aşama 9'da gerçek kayıtlarla yeniden ayarlanır.

## Klasör yapısı ve seçimler

İki programlama dili var: kartta C++ (Arduino), tarayıcıda düz JavaScript. Tarayıcı tarafında çatı, derleme adımı ve projeye eklenen bağımlılık yok.

```text
yay-ogretmeni/
  package.json             "type": "module", test ve start komutları
  firmware/yay/yay.ino     kart yazılımı, tek dosya
  web/
    index.html  style.css
    main.js                parçaları birbirine bağlar
    thresholds.js          tüm eşikler tek yerde
    protocol.js            S ve H satırı ayrıştırma
    sources/serial.js      Web Serial
    sources/simulator.js   klavye
    sources/replay.js      kayıt dosyası
    motion.js              yerçekimi, hız, durağanlık
    strokes.js             yay bölütleme
    song.js                şarkı yükleme, tel ve yay türetme
    session.js             sıradaki nota, nota kaydı
    audio.js               sentez ve metronom
    rules.js               kurallar, bulgular, Türkçe olgu cümleleri
    teacher.js             şablon öğretmen, Ollama çağrısı, doğrulama
    ui.js                  ekran
    songs/                 index.json ve şarkı dosyaları
  test/                    fixtures.js ve *.test.js
  tools/                   replay.mjs, gap_histogram.mjs, teacher_eval.mjs
  recordings/              donanımdan alınan ham kayıtlar
```

Tek yapısal kural: `protocol`, `motion`, `strokes`, `song`, `session` ve `rules` tarayıcıya özgü hiçbir şeye dokunmaz. Ses, ekran ve depolama çağrıları `main.js` üzerinden bağlanır; böylece Node testleri aynı dosyaları doğrudan içe aktarır.

| Konu | Seçim | Gerekçe |
| --- | --- | --- |
| Kart yazılımı | Arduino çatısı, C++ | Kod kısadır (yaklaşık 150 satır) ve ESP32-S3 için hazır kart desteği vardır |
| MPU6050 erişimi | Kütüphane yok; `Wire` ile doğrudan kaydedici okuma | Beş kaydedici yazıp 14 bayt okumak yeter; kütüphanenin kart ve modülle uyumunu doğrulama derdi kalkar |
| Kart aracı | Arduino'ya yeniysen Arduino IDE, değilsen PlatformIO | İkisi de aynı kodu derler; fark alışkanlıktır |
| Uygulama | Düz HTML, CSS ve JavaScript modülleri | Tek sayfa, az ekran; öğrenilecek ve bozulacak şey azalır |
| Tarayıcı arayüzleri | Web Serial, Web Audio, `fetch`, `localStorage` | Hepsi tarayıcıda hazırdır |
| Testler | Node'un yerleşik test koşucusu (`node --test`) | Bağımlılık gerektirmez |
| Statik sunucu | `npx http-server web -a 127.0.0.1 -p 8000 -c-1` | Web Serial güvenli bağlam ister, yerel adres bunu sağlar; sunucu kodu yazılmaz |
| Dil modeli | Ollama | Karar 7 |
| Kayıt | Deneme özetleri `localStorage`'da; ham satırlar bellekte, istenince dosyaya | Veritabanı ve sunucu gerekmez |

Kuralları ve öğretmeni Python'da yazmak da düşünülebilirdi. Bu, ikinci bir süreç ve arada bir mesaj sınırı getirirdi; kurallar zaten dizi alıp liste döndüren kısa fonksiyonlardır. Python biliyorsan kayıt dosyalarını pandas ile açıp çizdirebilirsin, ama plan bunu gerektirmez.

## Aşamalar

On bir aşama var: 0–7 yalnızca bilgisayarla biter, 8–10 tahta kurulunca başlar. Her aşama kendi başına çalışır ve bir sonrakine geçmeden doğrulanır.

&#91;embedded content: yol haritası · 11 aşama, 1 geçit\]

Kutulardaki alt satır, bitti ölçütünün kısaltılmışıdır; tam ölçütler ve testler aşağıda.

### Aşama 0: İskelet

**Yapılacaklar.** Klasörleri ve `package.json` dosyasını oluştur; `test` komutu `node --test`, `start` komutu statik sunucu olsun. Boş bir `index.html` ile `main.js` ve tek bir örnek test ekle.

**Bitti ölçütü.** `npm test` geçiyor. `npm start` sonrası `http://127.0.0.1:8000` açılıyor ve konsol temiz.

**Test.** İki komutu çalıştır.

### Aşama 1: Şarkı yükleyici

**Yapılacaklar.** `song.js`: perde adını MIDI numarasına çevir, teli ve yay yönünü Karar 5'teki kurallarla türet, `start_beat` ekle, hatalı dosyayı reddet. İki dosya yaz: bir açık tel egzersizi ve "Daha Dün Annemizin".

**Bitti ölçütü.** Sayfa, seçilen şarkının notalarını tablo olarak gösteriyor: sıra, perde, tel, yay yönü, başlangıç vuruşu.

**Test.** `song.test.js`: sınır perdeler doğru tele gidiyor (G3 ve C#4 Sol, D4 ve G#4 Re, A4 ve D#5 La, E5 Mi); elle yazılan tel önceliklidir; yay yönü dönüşümlüdür ve elle yazılan değerden devam eder; sus `start_beat` değerini ilerletir; F#3 hata verir.

### Aşama 2: Ses ve metronom

**Yapılacaklar.** `audio.js`: Karar 6'daki zincir ve üç fonksiyon: `noteOn(midi)`, `setLevel(0–1)`, `noteOff()`. Metronom vuruşlarını ses saatine göre önceden planla. Geçici test düğmeleri ve bir "yay hızı" kaydırıcısı ekle. Ses bağlamını kullanıcı tıklamasıyla başlat.

**Bitti ölçütü.** Nota tıkırtısız başlayıp bitiyor. Kaydırıcı ses düzeyini ve parlaklığı kesintisiz değiştiriyor. Metronom 60 vuruş/dk ayarında 2 dakikada 120 vuruş veriyor. Konsolda `baseLatency` ve `outputLatency` yazıyor.

**Test.** Kulakla ve sayarak. İki gecikme değerini not et ve Karar 4'teki 16 ms'lik payla karşılaştır.

### Aşama 3: Satır biçimi, simülatör, kayıt ve oynatma

**Yapılacaklar.** `protocol.js` ile `S` ve `H` satırlarını ayrıştır. `simulator.js` klavyeden saniyede 200 `S` satırı üretsin. Ham satırları bellekte tut, dosyaya indir, `replay.js` ile geri oynat. Maskeyi, son satırı ve satır hızını gösteren bir ham veri paneli ekle.

**Bitti ölçütü.** Tel ve ok tuşu basılıyken panelde doğru maske ve sıfırdan farklı ivme görünüyor. Satır hızı 200 ± 5. İndirilen kayıt oynatılınca aynı örnek dizisi çıkıyor.

**Test.** `protocol.test.js`: geçerli satır, eksik alanlı satır, bozuk satır (sayılır ve atlanır). Kayıt ile oynatmanın eşitliği için ayrı bir test.

### Aşama 4: Hareket kestirimi ve yay bölütleme

**Yapılacaklar.** `motion.js` (Karar 3) ve `strokes.js` (Karar 2). `test/fixtures.js` içine sentetik `S` akışı üreten yardımcılar yaz: çekiş üret, boşluk ekle, ivmeye sapma ve gürültü ekle. Ham veri paneline hız grafiği ekle.

**Bitti ölçütü.** Aşağıdaki on test geçiyor. Simülatörde "temas gürültüsü" açıkken 20 çekiş 20 `stroke_start` üretiyor.

**Test.** `strokes.test.js`, her biri sentetik veriyle:

1. 30 ms boşluklu tek çekiş 1 çekiş verir.
2. 30 ms boşluk ve yön değişimi 2 çekiş verir.
3. Boşluksuz yön değişimi 2 çekiş verir.
4. Aynı yönde 200 ms boşluk 2 çekiş verir.
5. 20 ms komşu tel teması 1 çekiş verir ve `other_ms` dolar.
6. Tel devri 2 çekiş verir.
7. Telde 200 ms durma 2 çekiş verir.
8. 0,1 m/s² sapma eklenmiş 2 sn'lik çekiş 1 çekiş verir ve yönü doğrudur.
9. 50 ms'lik temas kesinleşen çekiş vermez.
10. 2 sn'lik çekişin sonunda telde durma, kesinleşen ikinci bir çekiş vermez.

### Aşama 5: Çalınabilir alet

**Yapılacaklar.** `session.js`: sıradaki nota işaretçisi; doğru telde `noteOn` ve 100 ms sonra kesinleştirme; yanlış telde ses yok, ilerleme yok; `stroke_update` ile `setLevel`; her nota için kayıt. `ui.js`: beklenen teli ve o an değilen teli dört telli bir şemada, yay yönünü okla, sonraki dört notayı sırayla göster. Bir ölçülük hazırlık sayımı ve metronom ekle. Deneme, son notanın çekişi bitince sona erer.

**Bitti ölçütü.** Simülatörle örnek şarkı baştan sona çalınıyor. Yanlış telde şarkı ilerlemiyor. Deneme sonunda nota sayısı kadar kayıt var.

**Test.** `session.test.js`: doğru çekiş dizisi bütün notaları çaldırır; araya giren yanlış tel çekişi o notanın `wrong_strokes` listesine girer; 100 ms'den kısa çekiş şarkıyı ilerletmez. Kusursuz çalınmış bir kaydın oynatılması 0 yanlış tel verir.

### Aşama 6: Hata kuralları ve şablon öğretmen

**Yapılacaklar.** `rules.js`: altı kural, bulguların türe göre toplanması ve her bulgu için Türkçe olgu cümlesi. `teacher.js` içinde şablon öğretmen: olgu cümlelerini ve ipucunu gösterir, sonraki egzersiz ile tempoyu kuralla seçer. Deneme özetini `localStorage`'a yaz. Nota tablosunda hatalı notaları işaretle.

**Bitti ölçütü.** Simülatörde bilerek yapılan her hata türü ekranda doğru bulgu olarak çıkıyor. Kusursuz kayıt 0 bulgu veriyor.

**Test.** `rules.test.js`: her kural için eşiğin hemen altı ve hemen üstü; her "değerlendirilmedi" koşulu; art arda ters yönlerin tek bulguda toplanması.

### Aşama 7: Dil modeli öğretmeni

**Yapılacaklar.** Ollama'yı kur ve Karar 7'deki tabloya göre modeli indir. `teacher.js`: sistem talimatı, girdi JSON'u, `format` şeması ve çıktı doğrulaması; hata, zaman aşımı ya da geçersiz çıktıda şablona dönüş. Bir soru kutusu ekle. `tools/teacher_eval.mjs` on örnek girdiyi modele gönderip doğrulayıcıdan geçirsin; örneklerden biri bulgusuz, biri yalnızca değerlendirilmeyen ölçümlerle olsun.

**Bitti ölçütü.** On örneğin onu doğrulayıcıdan geçiyor ve metinleri okuyunca doğru buluyorsun. Yanıt 10 sn'nin altında geliyor. Ollama kapalıyken uygulama şablon metinle çalışmaya devam ediyor.

**Test.** `teacher.test.js` model gerektirmez: geçersiz egzersiz kimliği, aralık dışı tempo ve girdide olmayan sayı reddedilir. `teacher_eval.mjs` çıktısını elle oku: Türkçe düzgün mü, listede olmayan bir hata geçiyor mu.

### Aşama 8: Donanım 1, temas ve gecikme

**Yapılacaklar.**

- Dört tel pinini ve I2C pinlerini kartının pin şemasından seç. ESP32-S3'te başlatma pinlerinden (GPIO0, 3, 45, 46), USB pinlerinden (GPIO19, 20) ve flaş pinlerinden (GPIO26–32, bazı modüllerde 33–37) kaçın ([Espressif GPIO belgesi](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html)).
- `yay.ino`: zamanlamayı micros() farkıyla tutan bir döngüde 1 kHz temas örnekleme, `S` satırı (ivme ve jiroskop alanları 0) ve `H` satırı.
- `serial.js`: "Bağlan" düğmesi ve sonraki açılışlarda izinli porta kendiliğinden bağlanma. Port aynı anda tek programa açılır; bağlanmadan önce Arduino'nun seri ekranını kapat.
- Aleti yalnızca temasla çalıştır (`thresholds.js` içinde `USE_IMU = false`): nota temasla başlar, ses düzeyi sabittir, notalar arasında sopayı kaldırırsın.
- 20 uzun çekiş ve 20 kaldır-koy kaydet. `gap_histogram.mjs` ile boşluk sürelerine bak ve `T_GAP_MS` değerini seç.
- Uçtan uca gecikmeyi ölç.

**Bitti ölçütü.** 50 ayrı çekiş 50 nota veriyor. Sopa tellere değmeden dururken 2 dakikada hiç nota çıkmıyor. Satır hızı 200 ± 2 ve `t_us` atlamasız ilerliyor. Ölçülen gecikme Karar 4'teki bütçeyle karşılaştırıldı.

**Test.** Sayarak. Gecikme için telefonla ses kaydı al: sopanın tele vurma tıkırtısı ile hoparlör sesi arasındaki farkı bir ses düzenleyicide 10 vuruş için ölç. Bu bir kerelik ölçüm yöntemidir, ürünün özelliği değildir.

### Aşama 9: Donanım 2, MPU6050 ile yön ve hız

**Yapılacaklar.**

- Firmware'de MPU6050'yi uyandır. Aralıkları ±4 g ve ±500 °/s yap, alçak geçiren süzgeci 44 Hz'e (`DLPF_CFG = 3`), örnekleme hızını 200 Hz'e (`SMPLRT_DIV = 4`) ayarla.
- Her 5 ms'de 14 baytı oku; okuma başarısızsa `i2c_err` sayacını artır. I2C hızını 400 kHz ile dene, sayaç artıyorsa 100 kHz'e in.
- Uygulamaya dinlenme ve yön kalibrasyonunu ekle.
- Üç kayıt al: 40 dönüşümlü çekiş, telde durarak biten 10 uzun nota, 10 kaldır-koy.
- Eşikleri bu kayıtlarla ayarla, sonra `USE_IMU = true` yap.

MPU6050 kaydedicileri (I2C adresi 0x68; modülün AD0 ucu yüksekse 0x69):

| Kaydedici | Adres | Yazılacak değer | Anlamı |
| --- | --- | --- | --- |
| `PWR_MGMT_1` | 0x6B | 0x01 | Uykudan çıkarır, saat kaynağı olarak X jiroskobunu seçer |
| `SMPLRT_DIV` | 0x19 | 4 | 1 kHz bölü 5, yani 200 Hz |
| `CONFIG` | 0x1A | 3 | Alçak geçiren süzgeç: ivme 44 Hz, jiroskop 42 Hz |
| `GYRO_CONFIG` | 0x1B | 0x08 | ±500 °/s |
| `ACCEL_CONFIG` | 0x1C | 0x08 | ±4 g |
| `ACCEL_XOUT_H` | 0x3B | Okunur, 14 bayt | İvme x, y, z; sıcaklık; jiroskop x, y, z. Her biri 16 bit, yüksek bayt önce |
| `WHO_AM_I` | 0x75 | Okunur | 0x68 beklenir |

Adresler ve süzgeç değerleri [i2cdevlib kaynağından](https://github.com/jrowberg/i2cdevlib/blob/master/Arduino/MPU6050/MPU6050.h) alındı; üreticinin kaydedici haritasıyla karşılaştır.

**Bitti ölçütü.** 40 çekişin en az 38'inde yön doğru ve sayılan çekiş 39 ile 41 arasında. 10 uzun notada hayalet nota yok. Ses düzeyi yay hızıyla duyulur biçimde değişiyor. `i2c_err` 5 dakikada artmıyor.

**Test.** `tools/replay.mjs` kayıtları işleyip çekişleri sayar; bir eşik değişince aynı kayıtlar yeniden koşulur. Kayıtlar `recordings/` altında kalır ve sonraki değişiklikler için test verisi olur.

### Aşama 10: Gerçek kayıtlarla kural ayarı ve prova

**Yapılacaklar.** Her kural için bilerek temiz ve bilerek hatalı denemeler kaydet. Eşikleri "Hata kuralları" bölümündeki yöntemle güncelle; temiz ile hatalıyı ayıramayan kuralı kapat. Şarkıyı baştan sona çal ve öğretmenin metnini oku.

**Bitti ölçütü.** Üç temiz denemede hatalı işaretlenen nota oranı %10'un altında. Bilerek yapılan hataların en az %80'i yakalanıyor. Öğretmen metninde ölçülmeyen bir konuya dair cümle yok.

**Test.** Kayıtları yeniden oynat; beklenen ve bulunan hataları yan yana yaz.

## Hata kuralları

Altı kural var ve hepsi yalnızca nota kayıtlarını okur. Her kuralın bir de "değerlendirilmez" koşulu vardır: ölçüm güvenilir değilse kural hata demez, susar.

Tanımlarda "kabul edilen çekiş", beklenen telde kesinleşen ve notayı çalan çekiştir.

| Kural | Hangi veriden | Tetiklenme koşulu | Değerlendirilmez |
| --- | --- | --- | --- |
| Yanlış tel (`wrong_string`) | `wrong_strokes`: nota beklenirken başka telde kesinleşen, yani 100 ms'yi geçen çekişler | Liste boş değilse | Hiçbir durumda; temas ölçümü her zaman vardır |
| Komşu tele değme (`neighbor_touch`) | `neighbor_ms`: kabul edilen çekiş sırasında bitişik teldeki temas süresi, artı çekişten önceki 80 ms içinde bitişik telde iptal edilen dokunuşların süresi | `neighbor_ms` 15 ms ya da fazla | Hiçbir durumda |
| Erken giriş (`early`) | `timing_error_ms`: aralık hatası ile ızgara hatasından mutlak değeri küçük olan. Aralık hatası, önceki notanın başlangıcından bu yana geçen süre eksi iki notanın `start_beat` farkı çarpı vuruş süresidir. Izgara hatası, notanın başlangıcı eksi metronom ızgarasındaki yeridir. İlk notada yalnızca ızgara hatası kullanılır | Hata eksi toleransın altında. Tolerans: 80 ms ile beklenen aralığın %12'sinden büyük olanı; ilk notada aralık yerine bir vuruş alınır | İki nota arasında yanlış tel çekişi varsa |
| Geç giriş (`late`) | Aynı | Hata artı toleransın üstünde | İki nota arasında yanlış tel çekişi varsa; gecikme 2 vuruştan uzunsa (ara verilmiş sayılır) |
| Ters yay yönü (`wrong_bow_dir`) | `bow_dir`: çekişin ilk 200 ms'sindeki hız işaretlerinin çoğunluğu. `dir_conf`: o örneklerden çoğunlukla aynı işarette ve 0,05 m/s üstünde olanların oranı | `dir_conf` 0,8 ya da fazla ve `bow_dir` beklenen yönden farklı | `dir_conf` 0,8'in altında; `USE_IMU = false`; yön kalibrasyonu yapılmamış |
| Düzensiz yay hızı (`uneven_speed`) | `accel_rms`: çekişin ilk ve son 100 ms'si atılır; kalan bölümde eksenel ivme 5 örneklik hareketli ortalamayla yumuşatılır, ortalaması çıkarılır, karekök ortalama karesi alınır | `accel_rms` 0,7 m/s²'nin üstünde | Çekiş 400 ms'den kısa; `USE_IMU = false` |

**Zamanlama örneği.** 60 vuruş/dk'da iki dörtlük nota arasında beklenen aralık 1000 ms, tolerans 120 ms'dir. İkinci nota 1150 ms sonra başlarsa aralık hatası +150 ms'dir. Izgara hatası da 120 ms'yi aşıyorsa "geç" tetiklenir; nota vuruşa denk geldiyse tetiklenmez.

**Zamanlama neden iki ölçümle değerlendirilir.** Yalnızca ızgaraya bakılsaydı tek bir gecikme sonraki bütün notaları "geç" yapardı. Yalnızca önceki notaya bakılsaydı, geciken öğrencinin vuruşa geri dönmesi "erken" sayılırdı. Küçük olanı almak iki yanlış alarmı da önler.

Izgaradaki yer, hazırlık sayımının bittiği an artı `start_beat` çarpı vuruş süresidir. Bu seçimin bedeli, metronomdan yavaş yavaş kaymanın tek tek notalarda görünmemesidir.

**Düzensiz hız neden ivmeden ölçülür.** Sabit hız, sıfır ivme demektir; düzensizlik doğrudan ivmede görünür ve hız kestirimindeki kayma ölçüme girmez. Örnek: hız saniyede iki kez 0,15 m/s oynuyorsa `accel_rms` yaklaşık 1,3 m/s² olur.

### Bulguların toplanması

- Her hata türü için en çok bir bulgu üretilir: kaç notada, hangi notalarda, ortalama değer, kaçı tel değiştirilen notada.
- Art arda 3 ya da daha çok ters yön tek bir bulgudur ve "şu notadan itibaren yön kaydı" diye raporlanır.
- Yanlış tel, aynı notanın zamanlamasını değerlendirme dışı bırakır; bir hata iki kez sayılmaz.
- Odak bulgu, en çok notayı etkileyendir. Eşitlikte sıra: yanlış tel, ters yön, komşu tele değme, geç, erken, düzensiz hız.
- Değerlendirilmeyen ölçümler hata sayılmaz; sayıları ayrı tutulur.

### Eşikler ve ayar

Bütün eşikler `thresholds.js` içinde sabittir. Başlangıç değerleri tahmindir; gerçek değerler Aşama 8–10'da kayıtlardan çıkar.

| Eşik | Başlangıç | Kullanıldığı yer | Nasıl ayarlanır |
| --- | --- | --- | --- |
| `T_GAP_MS` | 80 | Çekişi bitiren temas boşluğu | Aşama 8: uzun çekişlerdeki en uzun boşluk ile kaldır-koy'daki en kısa boşluğun ortası |
| `T_MIN_STROKE_MS` | 100 | Çekişin kesinleşmesi | Hayalet nota çıkıyorsa artır, kısa notalar kaçıyorsa azalt |
| `T_PAUSE_MS` | 150 | Telde durma ve hız sıfırlama | Yavaş çekişler bölünüyorsa artır |
| `T_SWITCH_MS` | 30 | Tel devri | Tel geçişlerinde nota bölünüyorsa artır |
| `T_ASSOC_MS` | 60 | Yön değişiminin boşlukla eşlenmesi | Yön değişimli notaların zamanlaması saçılıyorsa artır |
| `V_MIN` | 0,05 m/s | Hareket ve yön | Aşama 9: elde hareketsiz tutulan sopanın kaydında hız kestiriminin en büyük değerinin 2 katı |
| `REV_RATIO` | 0,5 | Yön değişiminin kabulü | "10 uzun nota" kaydında hayalet nota çıkıyorsa artır; "40 çekiş" kaydında çekiş kaçıyorsa azalt |
| `T_TOUCH_MS` | 15 | Komşu tele değme | Temiz çekişlerde tetikleniyorsa artır |
| `TIMING_TOL` | 80 ms ya da aralığın %12'si | Erken ve geç | En iyi üç denemende mutlak hatanın 90. yüzdeliği |
| `DIR_CONF_MIN` | 0,8 | Ters yön | "40 çekiş" kaydında güvenilir sayılanlar arasında yanlış yön %2'yi geçmesin |
| `ACCEL_RMS_MAX` | 0,7 m/s² | Düzensiz hız | 20 düzgün ve 20 kesik kesik çekiş kaydet; düzgünlerin 90. yüzdeliği ile kesiklerin 10. yüzdeliğinin ortası |

Ayar döngüsü hep aynıdır: kaydet, `tools/replay.mjs` ile işle, eşiği değiştir, aynı kayıtları yeniden işle. Bir kuralın temiz ve hatalı dağılımları örtüşüyorsa eşik aranmaz; kural kapatılır ve o ölçüm "değerlendirilmedi" olur.

## Öğretmen

Kod, bulguları ve Türkçe olgu cümlelerini üretir; model bu cümleleri öğretmen diliyle anlatır ve sunulan seçenekler arasından sonraki egzersizi seçer. Model hata tespit etmez ve çıktısı gösterilmeden önce kodla doğrulanır.

### Modele giden JSON

| Alan | Anlam |
| --- | --- |
| `session` | Denemenin kimliği: `exercise_id`, `title`, `bpm`, `note_count`, `attempt_no` |
| `summary.notes_clean`, `summary.notes_with_error` | Temiz ve hatalı nota sayısı |
| `summary.counts` | Altı hata türünün her biri için nota sayısı |
| `summary.not_evaluated` | Değerlendirilemeyen nota sayısı: `timing`, `bow_dir`, `bow_speed` |
| `findings[].id` | `F1`, `F2` gibi kimlik |
| `findings[].type` | Altı hata türünden biri |
| `findings[].count`, `findings[].notes` | Kaç notada ve hangi notalarda |
| `findings[].avg_ms` ya da `findings[].avg` | Ortalama ölçüm |
| `findings[].at_string_change` | Bu notalardan kaçı tel değiştirilen nota |
| `findings[].fact` | Kodun yazdığı Türkçe olgu cümlesi |
| `findings[].tips` | O hata türü için senin yazdığın ipuçları |
| `previous` | Aynı egzersizin önceki denemesi: `bpm`, `notes_with_error`; yoksa `null` |
| `next_options.exercises[]` | Seçilebilecek egzersizler: `id`, `title`, `targets` |
| `next_options.bpm_min`, `next_options.bpm_max` | Seçilebilecek tempo aralığı |

Seçenekleri kod hazırlar: aynı egzersiz, en sık iki bulgunun türünü hedefleyen birer egzersiz ve bir üst seviyeden bir egzersiz; aynı egzersiz iki kez yazılmaz. Tempo aralığı şimdiki temponun 12 altı ile 6 üstüdür ve 40 ile 120 arasında kalır.

### Örnek girdi

```json
{
  "session": {"exercise_id": "gecis_komsu", "title": "Komşu tel geçişleri",
              "bpm": 60, "note_count": 16, "attempt_no": 3},
  "summary": {
    "notes_clean": 11,
    "notes_with_error": 5,
    "counts": {"wrong_string": 0, "neighbor_touch": 4, "early": 0,
               "late": 3, "wrong_bow_dir": 0, "uneven_speed": 1},
    "not_evaluated": {"timing": 0, "bow_dir": 1, "bow_speed": 0}
  },
  "findings": [
    {"id": "F1", "type": "neighbor_touch", "count": 4, "notes": [3, 7, 11, 15],
     "avg_ms": 35, "at_string_change": 4,
     "fact": "4 notada (3, 7, 11, 15) La telini çalarken Re teline de değdin; ortalama 35 ms. Dördü de Re'den La'ya geçtiğin notalar.",
     "tips": ["Tel değiştirmeden önce sopanın açısını yeni tele göre ayarla, sonra çek."]},
    {"id": "F2", "type": "late", "count": 3, "notes": [3, 7, 11],
     "avg_ms": 130, "at_string_change": 3,
     "fact": "3 notada (3, 7, 11) geç girdin; ortalama 130 ms. Üçü de tel değiştirdiğin notalar.",
     "tips": ["Metronomla birlikte içinden say; tel değişimini bir önceki vuruşta hazırla."]},
    {"id": "F3", "type": "uneven_speed", "count": 1, "notes": [16],
     "avg": 0.9, "at_string_change": 0,
     "fact": "1 notada (16) yay hızın düzensizdi.",
     "tips": ["Yayı vuruşlara eşit böl: her vuruşta aynı uzunlukta yol al."]}
  ],
  "previous": {"bpm": 60, "notes_with_error": 8},
  "next_options": {
    "exercises": [
      {"id": "gecis_komsu", "title": "Komşu tel geçişleri",
       "targets": ["wrong_string", "neighbor_touch"]},
      {"id": "acik_dortluk", "title": "Tek telde dörtlük notalar",
       "targets": ["early", "late", "wrong_bow_dir"]},
      {"id": "daha_dun", "title": "Daha Dün Annemizin",
       "targets": ["wrong_string", "late"]}
    ],
    "bpm_min": 48,
    "bpm_max": 66
  }
}
```

### Sistem talimatı taslağı

```text
Sen sabırlı bir keman öğretmenisin. Öğrencin sol elini kullanmıyor; yalnızca yay
çalışıyor: doğru tel, doğru zaman, doğru yay yönü ve düzgün yay hızı.

Her denemeden sonra sana bir JSON verilir. İçindeki "findings" listesi, ölçümlerden
kurallarla çıkarılmış hataların tamamıdır. Senin işin hata bulmak değil, bu listeyi
öğrenciye anlatmaktır.

Kurallar:
1. Yalnızca "findings" içindeki hatalardan söz et. Listede olmayan bir hata, nota
   numarası ya da sayı yazma. Liste boşsa hata bulunmadığını söyle.
2. Ölçülmeyen konularda yorum yapma: entonasyon, sol el, ses tonu, duruş, yay tutuşu.
3. "not_evaluated" altındaki ölçümler güvenilir alınamadı. Onlar hakkında iyi ya da
   kötü hüküm verme.
4. Tek bir bulguya odaklan ve kimliğini "focus_finding" alanına yaz. İstersen bir
   bulguya daha tek cümleyle değin.
5. Düzeltme önerisini yalnızca odak bulgunun "tips" alanından al; kendi tekniğini
   uydurma.
6. "feedback" 2-4 cümle olsun: önce "summary" içinden iyi giden bir şey, sonra odak
   bulgu, sonra ipucu.
7. Sonraki egzersizi yalnızca "next_options.exercises" içinden, tempoyu yalnızca
   "bpm_min" ile "bpm_max" arasından seç. Hatalı nota çoksa tempoyu düşür; hiç yoksa
   aynı tut ya da artır.
8. Öğrenciye "sen" diye hitap et ve sade Türkçe kullan. Tel adları Sol, Re, La, Mi;
   yay yönleri çekerek ve iterek.
9. Yanıtın yalnızca istenen JSON olsun.
```

Ollama belgesi şemayı talimatın sonuna metin olarak da eklemeyi öneriyor; `teacher.js` bunu kendiliğinden ekler.

### Modelden dönen JSON

| Alan | Kısıt |
| --- | --- |
| `feedback` | Türkçe, 2–4 cümle |
| `focus_finding` | Girdideki bulgu kimliklerinden biri; bulgu yoksa `null` |
| `next_exercise_id` | `next_options.exercises` içindeki kimliklerden biri |
| `next_bpm` | `bpm_min` ile `bpm_max` arasında tamsayı |
| `reason` | Seçimin tek cümlelik gerekçesi |

### Örnek çıktı

Yukarıdaki girdi için beklenen türden bir yanıt:

```json
{
  "feedback": "16 notanın 11'i temizdi ve hiç yanlış tele gitmedin. En çok Re'den La'ya geçerken zorlandın: 3, 7, 11 ve 15. notalarda La'yı çalarken Re teline de değdin. Tel değiştirmeden önce sopanın açısını La teline göre ayarla, sonra çek. Aynı geçişlerde biraz geç de kaldın; daha yavaş tempoda ikisi birlikte düzelir.",
  "focus_finding": "F1",
  "next_exercise_id": "gecis_komsu",
  "next_bpm": 52,
  "reason": "Hatalar tel geçişlerinde toplandığı için aynı egzersizi daha yavaş tekrarlıyoruz."
}
```

### Çıktının doğrulanması

`teacher.js` yanıtı göstermeden önce beş şeye bakar:

1. JSON şemaya uyuyor.
2. `focus_finding` girdideki kimliklerden biri.
3. `next_exercise_id` seçeneklerin içinde ve `next_bpm` aralıkta.
4. `feedback` içindeki her sayı girdide ya da seçilen tempoda geçiyor.
5. `feedback` 600 karakteri geçmiyor ve ölçülmeyen konuların kelimelerini içermiyor (entonasyon, sol el, akort, vibrato).

Biri tutmazsa istek bir kez yinelenir; yine tutmazsa şablon metin gösterilir. Bulgu listesi ekranda her zaman öğretmen metninin yanında durur; metin yanılsa bile ölçülen şey görünür.

### Şablon öğretmen

Model yokken ya da çıktısı reddedilince çalışır. Metni, odak bulgunun `fact` cümlesi ile ilk ipucudur. Sonraki adımı hatalı nota oranı belirler:

| Hatalı nota oranı | Sonraki adım |
| --- | --- |
| %30'un üstü | Aynı egzersiz, tempo 8 düşer |
| %10 ile %30 arası | Aynı egzersiz, aynı tempo |
| %10'un altı | Tempo 6 artar; aynı egzersiz art arda iki kez bu orana indiyse bir üst seviyeden egzersiz |

### Soru-cevap

Soru kutusu aynı modele ikinci bir kısa talimatla gider: son denemenin JSON'una ve egzersiz listesine dayan, ölçülmeyen bir şey sorulursa bu aletin onu ölçmediğini söyle, en çok 4 cümle yaz. Yanıt serbest metindir; sayı ve kelime denetimi yine uygulanır.

### Başlangıç egzersizleri

Öğretmenin seçebilmesi için en az beş dosya gerekir. `targets` alanı, egzersizin hangi hata türlerine iyi geldiğini söyler.

| Kimlik | Başlık | `targets` | Seviye |
| --- | --- | --- | --- |
| `acik_uzun` | Açık tellerde uzun yaylar | `uneven_speed` | 1 |
| `acik_dortluk` | Tek telde dörtlük notalar | `early`, `late`, `wrong_bow_dir` | 1 |
| `gecis_komsu` | Komşu tel geçişleri | `wrong_string`, `neighbor_touch` | 2 |
| `ritim_karisik` | Dörtlük ve ikilik karışık ritim | `early`, `late` | 2 |
| `daha_dun` | Daha Dün Annemizin | `wrong_string`, `late` | 3 |

## Riskler ve yedek yollar

En olası üç başarısızlık noktası yön kestirimi, temas sinyali ve yerel modelin Türkçesidir. Üçü de donanıma ya da senin bilgisayarına bağlı olduğu için bu plan onları önceden çözemez; ne zaman anlaşılacaklarını ve o gün ne yapılacağını yazar.

### Risk 1: Yön ve hız yalnızca MPU6050 ile güvenilir çıkmayabilir

**Neden olası.** Hız kestirimi zamanla kayar ve ivmeölçer durmayı sabit hızlı hareketten ayıramaz. Simülatörün verisi bu kusurları taşımaz; sorun ancak Aşama 9'da görünür.

**Nasıl anlaşılır.** 40 çekişlik kayıtta yön doğruluğu 38'in altında kalır ya da uzun notaların sonunda hayalet nota çıkar.

**Yedek yol.**

1. "Durarak çal" kipi: yön değişimiyle nota başlatma kapatılır. Her nota durağan başlangıçtan ya da temasın geri gelmesinden başlar; yön yalnızca o ilk ivme darbesinden okunur. Bu, sinyalin en güvenilir anıdır. Bedeli, her yay değişiminde kısa bir duraklamadır.
2. O da tutmazsa `USE_IMU = false` kalır. Yön ve hız kuralları "değerlendirilmedi" olur; yanlış tel, komşu tele değme ve zamanlama kuralları etkilenmez.

### Risk 2: Temas sinyali beklenenden kesik gelebilir

**Neden olası.** Sürtünen iki yüzeyin temasının ne kadar kesildiği, bandın yüzeyine ve bastırma kuvvetine bağlıdır. Boşlukların süre dağılımı ölçülmeden bilinemez.

**Nasıl anlaşılır.** Aşama 8'deki histogramda uzun çekişlerin boşlukları ile kaldır-koy boşlukları örtüşür; 50 çekiş 50 nota vermez.

**Yedek yol.**

1. `T_GAP_MS` değerini histogramın gösterdiği yere çek.
2. Dağılımlar örtüşüyorsa eşiği uzun çekişlerdeki en uzun boşluğun üstüne çıkar ve Aşama 9'u öne al; hızlı notaları yön değişimi ayırır. Bedeli, aynı yönde art arda iki nota için sopayı belirgin biçimde kaldırıp beklemektir.
3. Bu da yetmezse sorun yazılımla çözülmez. Temas yüzeyi ve pin girişindeki elektriksel koşullar gözden geçirilir; bu bir donanım kararıdır ve planın dışındadır.

### Risk 3: Yerel model Türkçede, hızda ya da bellekte yetersiz kalabilir

**Neden olası.** Küçük modellerin bu görevdeki Türkçe kalitesini sınamadım; işlemcin ve RAM'in de belli değil.

**Nasıl anlaşılır.** Aşama 7'de on örnekten bazıları doğrulayıcıdan geçmez, metinlerde bozuk Türkçe görülür ya da yanıt 10 sn'yi aşar.

**Yedek yol.**

1. Modelin işini daralt: `feedback` metnini şablon yazar; model yalnızca egzersiz ve tempoyu seçer, soruları yanıtlar.
2. Karar 7'deki karşılaştırma adayını ya da bir boy farklı modeli dene.
3. Modeli kapat ve şablon öğretmenle devam et. Aşama 6'nın Aşama 7'den önce gelmesinin nedeni budur.

## Varsayımlar

Aşağıdaki on sekiz kabul mesajında yazmıyor; plan bunlara dayanıyor. Yanlış olanı söylersen sağ sütundaki yer değişir.

| Varsayım | Yanlışsa ne değişir |
| --- | --- |
| Öğretmen Türkçe konuşacak | Model seçimi ve sistem talimatı |
| Chrome ya da Edge kullanabilirsin; Safari şart değil | Aktarım: Python köprüsü ve WebSocket gerekir |
| Yanlış telde ses çıkmaz ve şarkı ilerlemez. Mesajın doğru telde olanı söylüyor, yanlış telde olanı söylemiyor | `session.js` içindeki tek karar ve "yanlış tel" kuralı |
| Sopa tele konup bekliyorsa ses çıkmaz; nota hareketle başlar | Çekişin başlangıç koşulu |
| Bir metronom ve bir ölçülük hazırlık sayımı var; "doğru zaman" buna ve önceki notaya göre ölçülür | Erken ve geç kurallarının tanımı |
| Teller standart keman akorduna karşılık gelir: Sol3, Re4, La4, Mi5 | Tel türetme tablosu |
| Her nota tek yay çekişidir; tek yayda birden çok nota ve çift ses yok | Şarkı formatı ve bölütleme |
| 100 ms'den kısa nota çalınmayacak | `T_MIN_STROKE_MS` |
| Çekerek yay, temas noktasının sopanın el ucundan uzak ucuna kaymasıdır | Yön kalibrasyonundaki işaret |
| Tel pinleri dahili pull-up ile okunur; harici direnç ya da kondansatör yok | Firmware'deki pin kipi |
| MPU6050 sopaya, eksenlerinden biri sopanın uzun eksenine yaklaşık paralel olacak ve oynamayacak biçimde sabitlenir | Yön kalibrasyonu tam bir eksen bulma adımına döner |
| İletken bant, sopanın tele değebilen bölümünü kesintisiz kaplar | Temas boşlukları uzar; Risk 2 |
| Kart yalnızca veri gönderir; tarayıcıdan karta komut gitmez | Satır biçimine komut eklenir |
| Saniyede 200 örnek yeterlidir | Satır hızı ve baud hesabı |
| Ses dahili hoparlörden ya da kablolu kulaklıktan çıkar | Gecikme bütçesindeki ses çıkışı payı |
| Kurulumda bir kez internet kullanılabilir (Arduino kart desteği, Node, Ollama, model); çalışırken gerekmez | Kurulum adımları |
| Tek kullanıcı var; geçmiş tarayıcının `localStorage` alanında tutulur | Kayıt yeri |
| Sayısal eşiklerin hepsi benim başlangıç tahminimdir; hiçbiri ölçülmedi | Aşama 8–10'da kayıtlarla değişir |

## Doğrulanacaklar

Bu on yedi maddeyi kesin sayma: bir kısmını kaynaklardan okudum, bir kısmı tasarımın dayandığı beklentidir; hiçbiri senin donanımında ve bilgisayarında sınanmadı. Her biri ilgili aşamanın içinde, belirtilen yöntemle doğrulanır.

| İddia | Nasıl doğrulanır | Ne zaman |
| --- | --- | --- |
| Node sürümün `node --test` komutunu tanıyor | `node --version` 20 ya da üstü olmalı | Aşama 0 |
| `baseLatency + outputLatency` 16 ms dolayında | Konsolda oku | Aşama 2 |
| Ollama yerel modeller için hesap istemiyor | Kurulumda gör; belgesi yerelde çalıştığını söylüyor, hesap konusunu açık yazmıyor | Aşama 7 |
| Tarayıcıdan Ollama'ya giden istek engellenmiyor | Sayfadan bir istek at; engellenirse `OLLAMA_ORIGINS` değişkenini `launchctl setenv` ile ayarla | Aşama 7 |
| Seçilen model `format` şemasına uyuyor ve `think: false` ayarını kabul ediyor | `teacher_eval.mjs` | Aşama 7 |
| Seçilen modelin Türkçesi yeterli ve yanıt 10 sn altında | On örneği oku, süreyi ölç | Aşama 7 |
| Model ile tarayıcı birlikte belleğe sığıyor | Etkinlik Monitörü'nde bellek baskısına bak | Aşama 7 |
| Ollama kitaplığındaki model adları ve boyutları hâlâ Karar 7'deki gibi | Kitaplık sayfasına bak | Aşama 7 |
| Kartının USB portu türü ve "USB CDC On Boot" ayarı; köprü çipi varsa macOS onu sürücüsüz tanıyor ve 921600 baud destekliyor | Kartın belgesi; Arduino seri ekranında satırlar bozulmadan akıyor mu | Aşama 8 |
| Seçtiğin pinler kartında boş ve dahili pull-up destekliyor | Kartın pin şeması | Aşama 8 |
| Chrome ya da Edge kartı görüyor ve portu açıyor; port açılınca kart yükleme kipine düşmüyor | "Bağlan" sonrası `H` satırları geliyor mu; gerekirse `setSignals` ile DTR ve RTS'yi kapat | Aşama 8 |
| `S` satırları saniyede 200 kez, kayıpsız ve yığılmadan geliyor | `t_us` farkları 5000 µs dolayında mı; varış aralıklarının dağılımı | Aşama 8 |
| Uçtan uca gecikme 30 ms hedefini tutuyor | Telefonla ses kaydı | Aşama 8 |
| Uzun çekişlerdeki boşluklar ile kaldır-koy boşlukları süre olarak ayrışıyor | `gap_histogram.mjs` | Aşama 8 |
| MPU6050 kaydedici değerleri ve ölçek katsayıları doğru: 8192 birim/g, 65,5 birim/(°/s), `DLPF_CFG = 3` ile 44 Hz. Modülün `WHO_AM_I` yanıtı 0x68 | Üreticinin kaydedici haritası; sopa masadayken ivme büyüklüğü 1 g okunuyor mu | Aşama 9 |
| I2C, sopaya giden kabloda 400 kHz'de hatasız çalışıyor | `i2c_err` sayacı | Aşama 9 |
| Durağanlık ölçüsü durmayı yavaş ve düzgün hareketten ayırabiliyor | "10 uzun nota" kaydı | Aşama 9 |

Firefox 151 ve sonrası da Web Serial'i destekliyor ([Mozilla](https://hacks.mozilla.org/2026/05/web-serial-support-in-firefox/)); ayrıntılarını sınamadım, plan Chrome ya da Edge'i hedefliyor.

## Kaynaklar

Teknik iddialar için açıp okuduğum sayfalar:

- Tarayıcı desteği: [caniuse Web Serial](https://caniuse.com/web-serial), [caniuse Web MIDI](https://caniuse.com/midi), [MDN Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API), [Chrome Web Serial rehberi](https://developer.chrome.com/docs/capabilities/serial), [MDN outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)
- Ollama: [SSS](https://docs.ollama.com/faq), [yapılandırılmış çıktı](https://docs.ollama.com/capabilities/structured-outputs), [düşünme kipi](https://docs.ollama.com/capabilities/thinking), [varsayılan izinli kökenler](https://github.com/ollama/ollama/blob/main/envconfig/config.go)
- Modeller: [gemma3](https://ollama.com/library/gemma3), [gemma4](https://ollama.com/library/gemma4/tags), [qwen3](https://ollama.com/library/qwen3), [Gemma 4 model kartı](https://ai.google.dev/gemma/docs/core/model_card_4), [TR-MMLU](https://arxiv.org/html/2501.00593v2)
- ESP32-S3: [GPIO kısıtları](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html), [USB Serial/JTAG](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/usb-serial-jtag-console.html), [Arduino `Serial` eşlemesi](https://github.com/espressif/arduino-esp32/blob/master/cores/esp32/HardwareSerial.h), [Arduino USB CDC](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html)
- MPU6050: [i2cdevlib kaynak açıklamaları](https://github.com/jrowberg/i2cdevlib/blob/master/Arduino/MPU6050/MPU6050.cpp)
