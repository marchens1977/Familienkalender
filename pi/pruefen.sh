#!/bin/bash
# Zeigt, ob der Familienkalender laeuft, und die letzten Sicherungen.
# Aufruf:  bash ~/familienkalender/pi/pruefen.sh
systemctl is-active familienkalender && echo "Dienst laeuft ✅" || echo "Dienst laeuft NICHT ❌"
curl -s -o /dev/null -w "Webseite antwortet: %{http_code}\n" "http://127.0.0.1:${FK_PORT:-8502}/api/status"
echo "Letzte Sicherungen:"; ls -1t "$HOME/familienkalender-daten/sicherungen" 2>/dev/null | head -3
journalctl -u familienkalender -n 5 --no-pager 2>/dev/null
echo "Automatische Updates:"; systemctl list-timers familienkalender-update.timer --no-pager 2>/dev/null | head -2
journalctl -u familienkalender-update -n 5 --no-pager 2>/dev/null
# Verschluesselte Adresse (nur wenn ein Zertifikat eingerichtet ist)
ZERT="${FK_ZERTIFIKATE:-$HOME/zertifikate}"
if [ -f "$ZERT/domain" ] && systemctl show -p Environment familienkalender | grep -q FK_HTTPS_PORT; then
  D="$(tr -d '[:space:]' < "$ZERT/domain")"; N="${FK_NAME:-kalender}"
  P="$(systemctl show -p Environment familienkalender | grep -o 'FK_HTTPS_PORT=[0-9]*' | cut -d= -f2)"
  if curl -s -o /dev/null --max-time 5 --resolve "$N.$D:$P:127.0.0.1" "https://$N.$D:$P/api/status"; then
    echo "Verschluesselt (https) ✅  https://$N.$D$([ "$P" != 443 ] && echo ":$P")"
  else
    echo "Verschluesselt (https) ❌ antwortet nicht oder Zertifikat passt nicht"
  fi
else
  echo "Verschluesselung (https): nicht eingerichtet"
fi
