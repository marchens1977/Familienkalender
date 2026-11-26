# Familienkalender

Ein gemeinsamer Kalender für die Familie, der **auf dem eigenen Raspberry Pi zu Hause** läuft.
Kein fremder Dienst, keine Cloud: Die Termine liegen nur auf dem Pi.

- Jede Person legt im Handy-Browser ein eigenes **Profil** an (Name, Farbe, Passwort).
- Neue Profile müssen vom **Verwalter freigegeben** werden. Erst dann kommt man rein.
- Oder einfacher: Der **Verwalter legt Familienmitglieder selbst an** und schickt Link, Benutzername und
  Startpasswort mit einem Knopfdruck **per WhatsApp**. Beim ersten Anmelden wählt jeder sein eigenes Passwort.
- **Als App installierbar:** Liegt auf dem Pi ein Zertifikat (eigene Domain), läuft der Kalender verschlüsselt (https)
  und lässt sich mit „Installieren“ wie eine App aufs Handy legen – eigenes Symbol, keine Adresszeile.
- **Automatische Updates:** Der Pi holt neue Versionen stündlich von selbst; die Handys laden sie automatisch.
- Alle Freigegebenen sehen und pflegen denselben Kalender (Termine, ganztägig oder mit Uhrzeit,
  mehrtägig, Wiederholung wöchentlich/monatlich/jährlich, „Wer ist dabei?“).
- Erreichbar nur im **Heimnetz** oder unterwegs über ein **VPN** ins Heimnetz.
- **Export/Import** der Termine als Datei, dazu tägliche automatische Sicherung auf dem Pi (14 Tage).
- **Andere Kalender:** Import und Export im Standardformat **.ics** (z. B. Google Kalender) und **Kalender-Links**
  (z. B. Spielplan eines Vereins), die der Pi alle 6 Stunden selbst abruft.

> Diese App läuft **nicht auf GitHub Pages**, sondern auf dem Raspberry Pi (sie braucht eine Datenbank).
> Auf GitHub liegt nur das Programm – **keine Familiendaten**.

## Einrichten auf dem Pi (einmalig)

Per SSH auf den Pi verbinden, dann (`<KONTO>` = dein GitHub-Name):

```bash
git clone https://github.com/<KONTO>/Familienkalender.git ~/familienkalender; bash ~/familienkalender/pi/installieren.sh
```

Das Skript erkennt das Heimnetz selbst, richtet Autostart und Firewall ein und zeigt am Ende die
Adresse an, die du am Handy öffnest. **Sofort** das eigene Profil anlegen (das erste wird Verwalter).

> **Datenschutz:** In diesem Repository stehen bewusst keine Adressen, Namen oder Geräte-Daten.
> Ein automatischer Test (`test/test_datenschutz.py`) prüft das bei jedem Testlauf.

## Aktualisieren / Prüfen

Updates kommen automatisch (stündlich). Sofort von Hand oder zum Nachsehen:

```bash
bash ~/familienkalender/pi/aktualisieren.sh
bash ~/familienkalender/pi/pruefen.sh
```

## Technik (kurz)

- `server/server.py`: kleiner Python-Server, nur Standardbibliothek, Datenbank SQLite
- `server/static/`: die Handy-Oberfläche (HTML, CSS, JavaScript), Farben Blau/Orange im Stil der New York Mets
- `pi/`: Skripte zum Einrichten, Aktualisieren, Prüfen
- `test/`: automatische Tests (`bash test/alle_tests.sh`)
