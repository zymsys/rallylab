#!/usr/bin/env bash
# upload.sh — Copy firmware files to Pico W and reset
#
# Usage: ./firmware/upload.sh [PORT]
#   PORT defaults to /dev/cu.usbmodem1101

set -e

PORT="${1:-/dev/cu.usbmodem1101}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Uploading firmware to ${PORT}..."

for f in config.py uuid_gen.py json_format.py engine.py gpio_manager.py wifi_manager.py serial_handler.py http_handler.py main.py; do
    echo "  ${f}"
    mpremote connect "${PORT}" fs cp "${DIR}/${f}" ":${f}"
done

echo "Resetting device..."
mpremote connect "${PORT}" reset

echo "Done. Open serial with:  mpremote connect ${PORT}"
