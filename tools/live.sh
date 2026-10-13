#!/bin/sh
# Kartı açar ve canlı temas izleyiciyi başlatır. Çıkış: Ctrl+C.
#   tools/live.sh [port] [--touch]   --touch: folyoların durumunu da yazar
ARGS=""
[ "$1" = "--touch" ] && { ARGS="--touch"; shift; }
PORT=${1:-$(ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* 2>/dev/null | head -1)}
[ -n "$PORT" ] || { echo "Kart bulunamadı"; exit 1; }
cd "$(dirname "$0")/.." || exit 1
echo "Port: $PORT (921600 baud). PlatformIO monitörü açıksa önce onu kapat."
arduino-cli monitor -p "$PORT" --config baudrate=921600 --raw 2>/dev/null | node tools/live.mjs $ARGS
