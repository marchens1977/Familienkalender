#!/bin/bash
# Automatisches Update (laeuft stuendlich ueber den Zeitplan "familienkalender-update.timer").
# Holt neue Versionen von GitHub. Startet der Kalender danach nicht, wird die alte Version
# automatisch zurueckgeholt. Die Daten (Termine, Profile) werden dabei nie veraendert.
# Protokoll ansehen:  journalctl -u familienkalender-update -n 30 --no-pager
set -u
ORDNER="$(cd "$(dirname "$0")/.." && pwd)"
BENUTZER="$(stat -c %U "$ORDNER")"
PORT="${FK_PORT:-8502}"
alsbenutzer() { runuser -u "$BENUTZER" -- "$@"; }

vorher="$(alsbenutzer git -C "$ORDNER" rev-parse HEAD)"
if ! alsbenutzer git -C "$ORDNER" pull --ff-only -q; then
  echo "GitHub nicht erreichbar oder Konflikt - naechster Versuch in einer Stunde."
  exit 0
fi
nachher="$(alsbenutzer git -C "$ORDNER" rev-parse HEAD)"
if [ "$vorher" = "$nachher" ]; then
  exit 0  # nichts Neues
fi

echo "Neue Version $(alsbenutzer git -C "$ORDNER" log -1 --format='%h %s')"
systemctl restart familienkalender
for i in $(seq 1 15); do
  sleep 2
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/status"; then
    echo "Update erfolgreich ✅"
    exit 0
  fi
done

echo "❌ Neue Version startet nicht - gehe zurueck auf ${vorher:0:7}"
alsbenutzer git -C "$ORDNER" reset -q --hard "$vorher"
systemctl restart familienkalender
exit 1
