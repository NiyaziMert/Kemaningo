# Yay Öğretmeni: Öğrenilenler

## Bu proje ne yapıyor

Bu proje, ESP32-S3'ün yay sopasından okuduğu tel temasını ve IMU verisini tarayıcıya gönderir. Tarayıcı bu veriden yay çekişlerini çıkarır, keman sesi sentezler ve hataları bulur. Yerel dil modeli de bulguları öğrenciye Türkçe anlatır.

```
Tel pinleri + MPU6050 → ESP32-S3 → USB serial (S satırı) → Tarayıcı (Web Serial)
  → motion → strokes → session → audio
  → rules → teacher → Ollama (127.0.0.1:11434)
```

Durum: Aşama 0 (iskelet) ve Aşama 1 (şarkı yükleyici) bitti.

## Kavramlar

### ES module (`"type": "module"`)

**Tanım:** ES module, `import` / `export` anahtar kelimeleriyle başka dosyalara değer açan ve onlardan değer alan JavaScript dosyasıdır.

```
thresholds.js (export) → main.js (import)        [tarayıcı]
thresholds.js (export) → skeleton.test.js (import) [Node]
```

1. `package.json` içindeki `"type": "module"`, Node'a `.js` dosyalarını ES module olarak yüklemesini söyler.
2. Tarayıcı aynı dosyayı `<script type="module">` ile yükler.
3. Sonuç: tek bir dosya hem tarayıcıda hem Node'da değişmeden çalışır.

**Terimler:**
- CommonJS: Node'un eski modül sistemi (`require`, `module.exports`); bu projede kullanılmaz.
- Named export: `export const T_GAP_MS = 80` gibi isimle dışarı açılan değer.

**Sınır durumu:** `"type": "module"` olmasaydı Node `import` satırında `SyntaxError` verirdi.

### Saf modül ve test edilebilirlik (pure module)

**Tanım:** Saf modül, `window`, `document`, ses ya da depolama gibi tarayıcıya özgü hiçbir API'ye dokunmayan, yalnızca veri alıp veri döndüren modüldür.

```
protocol, motion, strokes, song, session, rules  → saf, Node'da test edilir
audio, ui, sources/*, main                        → tarayıcıya özgü
```

1. Saf modüller yalnızca birbirini ve `thresholds.js`'i import eder.
2. Tarayıcı API'leri `main.js` üzerinden bağlanır (dependency injection).
3. `node --test` saf modülleri tarayıcı açmadan doğrudan çalıştırır.

**Terimler:**
- Dependency injection: Bir modülün ihtiyaç duyduğu dış bağımlılığı kendisi oluşturmaması, dışarıdan parametre olarak alması.
- Side effect: Fonksiyonun dönüş değeri dışında dünyayı değiştirmesi (ekrana yazma, ses çalma).

**Sınır durumu:** Saf bir modüle `document` eklenirse Node testi `ReferenceError: document is not defined` ile düşer. Bu hata kuralın bozulduğunu hemen gösterir.

### Test runner (`node --test`)

**Tanım:** Test runner, test dosyalarını bulan, içindeki `test()` bloklarını çalıştıran ve geçen/kalan sayısını raporlayan programdır.

```
npm test → node --test test/ → *.test.js → assert → pass / fail
```

1. `npm test`, `package.json`'daki `test` script'ini çalıştırır.
2. Node, `test/` altındaki test dosyalarını bulur.
3. Her `assert.equal(gerçek, beklenen)` eşit değilse test fail olur.

**Terimler:**
- Assertion: Doğru olması gereken bir koşulu kontrol eden ifade.
- Fixture: Testlerin kullandığı hazır girdi verisi (Aşama 4'te `test/fixtures.js`).

**Sınır durumu:** Node 20'den eski sürümlerde `--test` bayrağı yoktur. Bu makinede Node 26.11.1 kurulu.

### Static server ve secure context

**Tanım:** Static server, diskteki dosyaları hiçbir işlem yapmadan HTTP ile sunan sunucudur.

```
Tarayıcı → GET http://127.0.0.1:8000/main.js → http-server → web/main.js
```

1. `npm start`, `http-server`'ı `web/` klasörü için 8000 port'unda başlatır.
2. `-a 127.0.0.1` yalnızca bu bilgisayardan gelen isteği kabul eder.
3. `-c-1` cache'i kapatır; dosyayı değiştirince yenilemek yeter.

**Terimler:**
- Secure context: HTTPS ya da `localhost`/`127.0.0.1` üzerinden açılan sayfa; Web Serial yalnızca burada çalışır.
- Loopback adresi: `127.0.0.1`, paketin ağ kartına çıkmadan aynı makineye döndüğü IP adresi.

**Sınır durumu:** `index.html` doğrudan `file://` ile açılırsa ES module import'ları CORS hatası verir. Bu yüzden sayfa hep sunucudan açılır.

### MIDI note number

**Tanım:** MIDI note number, her yarım sese karşılık gelen 0–127 arası tamsayıdır; C4 = 60, A4 = 69.

```
"F#5" → regex /^([A-G])(#|b)?(-?\d)$/ → 12·(5+1) + 5 + 1 = 78
```

1. Regex perdeyi üç gruba ayırır: harf, accidental (`#` ya da `b`), octave.
2. Harf C'den itibaren yarım ses ofsetine çevrilir (C=0, D=2 … B=11).
3. `12·(octave+1)` eklenir; `#` +1, `b` −1 yapar.

**Terimler:**
- Semitone (yarım ses): İki komşu MIDI numarası arasındaki perde farkı.
- Accidental: Perdeyi yarım ses yükselten (`#`) ya da alçaltan (`b`) işaret.

**Sınır durumu:** `H4` gibi regex'e uymayan perde `SongError` fırlatır.

### Tel türetme (greedy seçim)

**Tanım:** Tel türetme, açık sesi (MIDI: Sol 55, Re 62, La 69, Mi 76) perdeden yüksek olmayan en tiz teli seçen greedy kuraldır.

```
midi → Mi'den Sol'a doğru tara → ilk OPEN_MIDI[s] ≤ midi olan s
```

1. Döngü en tiz telden (indeks 3, Mi) başlar.
2. Açık sesi perdeye eşit ya da pes olan ilk tel seçilir.
3. Tel indeksi `S` satırındaki `mask` bitiyle aynıdır (bit 0 Sol … bit 3 Mi).

**Terimler:**
- Greedy algoritma: Her adımda o anki en iyi seçeneği alan, geri dönmeyen algoritma.
- Override: Türetilen değerin yerine elle yazılan değerin (`{"string": "Re"}`) kullanılması.

**Sınır durumu:** G3'ün (55) altındaki perde için hiçbir tel uymaz; şarkı yüklenmez. Elle yazılan tel perdeden tiz açık sese sahipse (D4 La telinde) de hata verilir.

### Validation ve fail fast

**Tanım:** Fail fast, hatalı girdiyi işin en başında, hatanın yerini söyleyen bir exception ile reddetme ilkesidir.

```
JSON.parse → parseSong (validate + derive) → SongError ya da notes[]
```

1. Zorunlu alanlar (`id`, `bpm`, `notes` …) tür kontrolünden geçer.
2. Her nota `[perde, vuruş, {...}?]` biçiminde mi diye bakılır.
3. Hata mesajı nota sırasını içerir: `"3. nota: Geçersiz perde"`.

**Terimler:**
- Exception: Normal akışı kesip çağırana hata nesnesi taşıyan mekanizma (`throw` / `catch`).
- Custom error class: `class SongError extends Error`; çağıranın şarkı hatasını diğer hatalardan ayırmasını sağlar.

**Sınır durumu:** `main.js` `SongError`'ı yakalar ve sayfada gösterir; diğer şarkılar yüklenmeye devam eder.

## Verinin yolculuğu

Şimdilik yalnızca şarkı verisi akıyor:

1. `main.js`, `songs/index.json`'u `fetch` ile okur (tarayıcı klasör listeleyemez).
2. Seçilen dosya `fetch` → `res.json()` ile JS nesnesine çevrilir.
3. `parseSong` alanları doğrular; her notaya `midi`, `string`, `bow`, `start_beat` ekler.
4. `ui.js` sonucu tablo olarak çizer.

Aşama 3'ten sonra sensör verisinin yolu buraya eklenecek.

## Dosya haritası

| Dosya | Ne iş yapar? |
|---|---|
| `package.json` | ES module ayarı, `test` ve `start` script'leri. |
| `web/index.html` | Tek sayfa; `main.js`'i module olarak yükler. |
| `web/style.css` | Açık ve koyu tema renkleri. |
| `web/main.js` | Entry point. Şarkıları `fetch` ile okur, `song.js` ve `ui.js`'i bağlar. |
| `web/thresholds.js` | Bütün eşiklerin başlangıç değerleri (`T_GAP_MS = 80` vb.). |
| `web/song.js` | Saf modül. Perde → MIDI, tel ve yay yönü türetme, `start_beat`, doğrulama. |
| `web/ui.js` | DOM çizimi: şarkı seçici ve nota tablosu. |
| `web/songs/*.json` | `index.json` (dosya listesi), `acik_uzun`, `daha_dun`. |
| `test/song.test.js` | Sınır perdeler, override, yay dönüşümü, sus, hatalı dosya: 10 test. |

## Karşılaşılan hatalar

- `node: command not found` → Node kurulu değildi → `brew install node` (v26.11.1).
- Headless doğrulama yapılamadı → makinede Chrome/Edge yok → Aşama 8'deki Web Serial için Chrome ya da Edge kurulmalı.

## Sözlük

- Accidental: Perdeyi yarım ses değiştiren `#` ya da `b` işareti.
- Assertion: Doğru olması gereken koşulu kontrol eden ifade.
- Cache: Bir yanıtın tekrar istenmesin diye saklanan kopyası.
- CommonJS: Node'un `require` tabanlı eski modül sistemi.
- CORS: Tarayıcının farklı kaynaktan yüklenen içeriğe koyduğu güvenlik kısıtı.
- Custom error class: `Error`'dan türetilen, hata türünü ayırt etmeye yarayan sınıf.
- Dependency injection: Bağımlılığın modüle dışarıdan verilmesi.
- Entry point: Programın çalışmaya başladığı dosya.
- ES module: `import`/`export` kullanan JavaScript dosyası.
- Exception: Akışı kesip hata nesnesini çağırana taşıyan mekanizma.
- Fail fast: Hatalı girdiyi en başta, yerini söyleyerek reddetme ilkesi.
- Fixture: Testlerin kullandığı hazır girdi verisi.
- Greedy algoritma: Her adımda o anki en iyi seçeneği alıp geri dönmeyen algoritma.
- Loopback adresi: Paketin aynı makineye döndüğü `127.0.0.1` adresi.
- MIDI note number: Yarım ses başına bir artan 0–127 perde numarası (A4 = 69).
- Override: Türetilen değerin elle verilen değerle ezilmesi.
- Regex: Metin kalıbını tanımlayan düzenli ifade.
- Semitone: İki komşu MIDI numarası arasındaki perde farkı.
- Pure module (saf modül): Tarayıcı API'sine dokunmayan, veri alıp veri döndüren modül.
- Secure context: Web Serial gibi hassas API'lerin çalıştığı HTTPS ya da localhost sayfası.
- Side effect: Fonksiyonun dönüş değeri dışında dış dünyayı değiştirmesi.
- Static server: Dosyaları olduğu gibi HTTP ile sunan sunucu.
- Test runner: Testleri bulup çalıştıran ve sonucu raporlayan program.

## Kendini test et

1. `rules.js` içine `localStorage.getItem(...)` eklersen `npm test` neden kırılır?
   → `rules.js` saf modüldür; Node'da `localStorage` yoktur, `ReferenceError` oluşur.
2. Sayfayı `file://` yerine neden `http://127.0.0.1:8000` ile açıyoruz?
   → ES module import'ları ve Web Serial bir secure context ile HTTP sunucusu ister.
3. `"type": "module"` satırı silinirse ne olur?
   → Node `.js` dosyalarını CommonJS sanar ve `import` satırında hata verir.
4. B4 (MIDI 71) hangi tele gider? `{"string": "Sol"}` override'ı geçerli mi?
   → La (69 ≤ 71 < 76). Sol override'ı geçerlidir, çünkü açık Sol (55) perdeden pestir.
5. `[["A4",1],["R",1],["A4",1]]` için yay yönleri ve `start_beat`'ler nedir?
   → Yönler D, (sus), U; `start_beat` 0, 1, 2. Sus yönü değiştirmez ama vuruşu ilerletir.
