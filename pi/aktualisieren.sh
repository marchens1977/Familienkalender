#!/bin/bash
# Neueste Version von GitHub holen und Familienkalender neu starten. Daten bleiben unberuehrt.
# Aufruf:  bash ~/familienkalender/pi/aktualisieren.sh
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
sudo systemctl restart familienkalender
sleep 2
systemctl is-active familienkalender && echo "Aktualisiert ✅ ($(git log -1 --format='%h %s'))"
