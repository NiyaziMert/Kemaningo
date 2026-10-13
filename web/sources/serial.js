// Gerçek kart: Web Serial ile S ve H satırlarını okur (Karar 1).
// Yalnızca Chrome ve Edge (masaüstü Firefox 151+). Port aynı anda tek programa açılır;
// bağlanmadan önce Arduino'nun seri ekranını kapat.

export const BAUD = 921600; // CH343 köprülü kart; çipe doğrudan bağlı USB'de baud önemsizdir
// Port açılınca önceki oturumdan köprü çipinde kalmış satırlar önce gelir (bayat tampon);
// bu süre içinde gelenler atılır.
export const STALE_MS = 300;
// Port açılırken kart yeniden başlayabilir; ilk satır 1–2 sn gecikebilir.
export const SILENT_MS = 4000;

export const isSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

// Parça parça gelen metni satırlara böler. Satır sonundaki \r atılır. Sonu gelmeyen
// çok uzun bir parça (gürültü) 1 kB'de atılır.
export function createLineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
      if (buf.length > 1024) buf = '';
    },
  };
}

export function createSerialSource({ onLine, onStatus = () => {} }) {
  let port = null;
  let reader = null;
  let reading = false;
  const stats = { bytes: 0, lines: 0 };

  async function readLoop() {
    reading = true;
    const decoder = new TextDecoder();
    // Bir parçadaki bütün satırlar aynı varış zamanını alır.
    let now = 0;
    const openedAt = performance.now();
    const splitter = createLineSplitter((line) => {
      if (now - openedAt < STALE_MS) return;
      if (!gotData) {
        gotData = true;
        onStatus({ state: 'connected', info: port?.getInfo(), data: true });
      }
      stats.lines += 1;
      onLine(line, now);
    });
    let reason = 'okuma akışı kapandı';
    while (port?.readable && reading) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          now = performance.now();
          stats.bytes += value.length;
          splitter.push(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        // Taşma, çerçeve hatası gibi hatalarda okuma yeni bir akışla sürer; kablo
        // çekilirse port.readable null olur ve döngü biter.
        reason = `${e.name}: ${e.message}`;
        console.warn('Seri okuma hatası', e);
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
    return reason;
  }

  let gotData = false;
  async function open(p) {
    port = p;
    gotData = false;
    stats.bytes = 0;
    stats.lines = 0;
    await port.open({ baudRate: BAUD, bufferSize: 16384 });
    // ESP32'nin otomatik reset devresi DTR ve RTS'ye bağlıdır: ikisi eşitken kart çalışır,
    // DTR=0 RTS=1 resette tutar. macOS portu açınca ikisi zaten 1'dir (arduino-cli de böyle
    // açar). Diğer sistemlerde de ikisi 1 yapılır; sırayla değişseler bile ara durum
    // (DTR=1 RTS=0) kartı resetlemez. İkisini 0 yapmak ise geçişte kartı bir kez resetliyordu.
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    } catch (e) {
      console.warn('setSignals desteklenmiyor', e);
    }
    const info = port.getInfo();
    onStatus({ state: 'connected', info, data: false });
    setTimeout(() => {
      if (port === p && !gotData) onStatus({ state: 'connected', info, data: false, silent: true });
    }, SILENT_MS);
    readLoop().then(async (reason) => {
      if (port !== p) return; // disconnect() zaten kapattı ve bildirdi
      // Okuma kendiliğinden bitti: portu da kapat, yoksa arayüz "bağlı" kalır ama okumaz.
      port = null;
      try { await p.close(); } catch { /* zaten kapalı */ }
      onStatus({ state: 'closed', reason });
    });
  }

  function onDisconnect(e) {
    if (e.target === port) {
      reading = false;
      port = null;
      onStatus({ state: 'lost' });
    }
  }
  if (isSupported()) navigator.serial.addEventListener('disconnect', onDisconnect);

  return {
    // Kullanıcı tıklamasıyla: tarayıcının port seçim penceresi açılır.
    async connect() {
      const p = await navigator.serial.requestPort();
      await open(p);
    },
    // Sayfa açılışında: daha önce izin verilmiş tek port varsa ona bağlan.
    async autoConnect() {
      if (!isSupported()) return false;
      const ports = await navigator.serial.getPorts();
      if (ports.length !== 1) return false;
      try {
        await open(ports[0]);
        return true;
      } catch (e) {
        onStatus({ state: 'error', message: e.message });
        return false;
      }
    },
    async disconnect(reason = 'bağlantı kesildi') {
      reading = false;
      const p = port;
      port = null;
      try { await reader?.cancel(); } catch { /* zaten kapalı */ }
      try { await p?.close(); } catch { /* zaten kapalı */ }
      onStatus({ state: 'closed', reason });
    },
    get connected() { return port !== null; },
    stats,
  };
}
