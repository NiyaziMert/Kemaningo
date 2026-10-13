#!/bin/sh
# Karttan tarayıcısız kayıt: satırları varış zamanıyla birlikte kayıt dosyasına yazar.
#   tools/record.sh <saniye> <dosya> [port]
# Örnek: tools/record.sh 60 recordings/uzun.txt
# Dosya, tarayıcıdaki "Kaydı indir" ile aynı biçimdedir; tools/replay.mjs ve
# tools/gap_histogram.mjs ile işlenir. Port aynı anda tek programa açılır: tarayıcıda
# karta bağlıysan önce bağlantıyı kes.
set -e
SECS=${1:?saniye}
OUT=${2:?dosya}
PORT=${3:-$(ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* 2>/dev/null | head -1)}
[ -n "$PORT" ] || { echo "Kart bulunamadı (/dev/cu.usbmodem*)"; exit 1; }

echo "Port: $PORT · $SECS sn kaydediliyor → $OUT"
TMP=$(mktemp)
# Monitör stdin'i karta yollar; stdin kapanırsa (arka planda çalışırken) hemen çıkar.
# Kayıt boyunca açık kalan ama hiçbir şey yazmayan bir girdi verilir.
sleep $((SECS + 30)) | arduino-cli monitor -p "$PORT" --config baudrate=921600 --raw 2>/dev/null \
  | perl -MTime::HiRes=time -ne 'BEGIN{$|=1} printf "%.3f\t%s", time*1000, $_' > "$TMP" &
# Monitörün açılması ~2 sn sürer; süre ilk satır gelince başlar.
i=0
while [ ! -s "$TMP" ]; do
  sleep 0.2; i=$((i + 1))
  [ $i -lt 50 ] || { echo "10 sn içinde veri gelmedi"; pkill -f "arduino-cli monitor -p $PORT"; exit 1; }
done
echo "Veri geliyor; kayıt başladı."
sleep "$SECS"
pkill -f "arduino-cli monitor -p $PORT" || true
sleep 1
{
  echo '# yay-ogretmeni kayıt v1'
  echo "# tools/record.sh · $(date '+%Y-%m-%d %H:%M') · $SECS sn"
  # İlk 300 ms atılır: port açılınca köprü çipinde ya da işletim sisteminde kalmış
  # önceki oturumun satırları (bayat tampon) önce gelir.
  awk -F'\t' 'NR==1{f=$1} $1-f<300{next} !b{b=$1} {printf "%.3f\t%s\n", $1-b, $2}' "$TMP"
} > "$OUT"
rm -f "$TMP"
echo "$(grep -c '	S,' "$OUT") S satırı yazıldı."
