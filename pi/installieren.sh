#!/bin/bash
# Familienkalender auf dem Raspberry Pi einrichten (einmalig).
# Aufruf (im heruntergeladenen Ordner):  bash ~/familienkalender/pi/installieren.sh
# Was passiert:
#  1. Programm = dieser Ordner, Daten in ~/familienkalender-daten (nie auf GitHub)
#  2. Dienst "familienkalender" startet automatisch beim Hochfahren
#  3. Firewall: Port nur aus dem eigenen Heimnetz erlaubt (wird hier auf dem Pi automatisch erkannt)
# Bewusst stehen KEINE Adressen oder Netzdaten im Skript - alles wird auf dem Pi ermittelt.
set -e
ORDNER="$(cd "$(dirname "$0")/.." && pwd)"
DATEN="$HOME/familienkalender-daten"
PORT="${FK_PORT:-8502}"

mkdir -p "$DATEN"
chmod 700 "$DATEN"

echo "Pruefe Python ..."
python3 -c "import sqlite3, hashlib; hashlib.scrypt(b'x', salt=b'y', n=2, r=1, p=1); print('Python ok')"

# Heimnetz automatisch erkennen (Netz der Standard-Verbindung), z. B. "a.b.c.0/24"
SCHNITTSTELLE="$(ip route show default | awk '{print $5; exit}')"
ADRESSE_MIT_MASKE="$(ip -o -4 addr show dev "$SCHNITTSTELLE" scope global | awk '{print $4; exit}')"
HEIMNETZ="${FK_NETZ:-$(python3 -c "import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)" "$ADRESSE_MIT_MASKE")}"
ADRESSE="${ADRESSE_MIT_MASKE%/*}"
echo "Erkannt: Heimnetz $HEIMNETZ, Adresse dieses Pi $ADRESSE"

echo "Richte Dienst ein (fragt evtl. nach deinem Passwort) ..."
sudo tee /etc/systemd/system/familienkalender.service > /dev/null <<DIENST
[Unit]
Description=Familienkalender
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$ORDNER/server
Environment=FK_PORT=$PORT
Environment=FK_DATEN=$DATEN
ExecStart=/usr/bin/python3 $ORDNER/server/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
DIENST

sudo systemctl daemon-reload
sudo systemctl enable --now familienkalender
sudo systemctl restart familienkalender

if command -v ufw > /dev/null; then
  sudo ufw allow from "$HEIMNETZ" to any port "$PORT" proto tcp comment 'Familienkalender'
else
  echo "Hinweis: Keine Firewall (ufw) gefunden. Bitte Claude fragen."
fi

sleep 2
if systemctl is-active --quiet familienkalender; then
  echo ""
  echo "FERTIG ✅  Familienkalender laeuft."
  echo "Am Handy oeffnen:  http://$ADRESSE:$PORT"
  echo "WICHTIG: Leg JETZT sofort dein eigenes Profil an - das erste Profil wird Verwalter."
else
  echo "❌ Dienst laeuft nicht. Bitte diese Ausgabe an Claude schicken:"
  sudo journalctl -u familienkalender -n 30 --no-pager
fi
