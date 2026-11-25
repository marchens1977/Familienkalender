#!/bin/bash
# Zeigt, ob der Familienkalender laeuft, und die letzten Sicherungen.
# Aufruf:  bash ~/familienkalender/pi/pruefen.sh
systemctl is-active familienkalender && echo "Dienst laeuft ✅" || echo "Dienst laeuft NICHT ❌"
curl -s -o /dev/null -w "Webseite antwortet: %{http_code}\n" "http://127.0.0.1:${FK_PORT:-8502}/api/status"
echo "Letzte Sicherungen:"; ls -1t "$HOME/familienkalender-daten/sicherungen" 2>/dev/null | head -3
journalctl -u familienkalender -n 5 --no-pager 2>/dev/null
