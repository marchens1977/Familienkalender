# Projekt-Tagebuch: Familienkalender

## 1. Zweck

Gemeinsamer Familienkalender, der auf dem **Raspberry Pi** des Nutzers zu Hause läuft
(Server-Details stehen im privaten Server-Projekt des Nutzers, **nicht hier**). Nutzer legen ein Profil an, der Verwalter gibt sie frei,
alle Freigegebenen pflegen einen gemeinsamen Kalender. Bedienung im Handy-Browser.

## 2. Grundregeln des Nutzers

- Nutzer ist **kein Programmierer**: einfaches Deutsch, Fachbegriffe kurz erklären, kleine nummerierte Schritte
  mit „Du machst:“ / „Ich mache:“. Bei Unklarheit kurz nachfragen statt raten. Vor größeren Änderungen in 2–3 Sätzen sagen, was geplant ist.
- Geräte: nur **Handy** und **Raspberry Pi**. Kein PC. Arbeit über GitHub.
- Befehle für den Pi immer komplett zum Kopieren geben und sagen, was sie tun. Claude erreicht den Pi nicht direkt.
- Vor jeder Code-Änderung fragen: direkt auf `main` oder Branch mit Pull Request (Nutzer merged selbst).
- Nach jeder Änderung sagen, ob der Nutzer noch etwas tun muss (mergen, `aktualisieren.sh` auf dem Pi).
- Nichts löschen oder überschreiben ohne Rückfrage.
- **Keine persönlichen Daten** (Namen, Adressen, Geburtstage, Familiendaten) ins Repository – es ist **öffentlich**.
  Echte Kalenderdaten liegen nur auf dem Pi in `~/familienkalender-daten`. In Tests nur erfundene, neutrale Namen.
- **Keine Server-Daten** ins Repository: keine IP-Adressen, Netzbereiche, Gerätenamen, Benutzernamen des Pi,
  Router-/VPN-Details, Kontonamen, Namen privater Projekte. Skripte ermitteln solche Werte auf dem Pi selbst.
  Der Test `test/test_datenschutz.py` prüft das automatisch (Adressen, E-Mails, Gerätekennungen, Datenbank-Dateien).
- Keine Schlüssel/Passwörter in den Code oder ins Repository.
- Apps mit eigenen Daten brauchen Export und Import (vorhanden).
- Tests und Hilfsprogramme gehören ins Projekt, werden hier beschrieben und nach jeder Änderung ausgeführt.
- Nur „funktioniert“ melden, wenn wirklich getestet. Ungetestetes offen sagen und in die Test-Liste unten.
- Vorher Bescheid sagen, wenn etwas Geld kostet.
- Am Ende jeder Aufgabe: was geändert wurde, was der Nutzer tun/testen soll, Link zur App, und ob die Sitzung archiviert werden kann.

## 3. Aktueller Stand (2026-11-25)

Läuft auf dem Pi (installiert 2026-11-25). Neue Funktionen werden automatisch getestet und kommen per Auto-Update auf den Pi.

- Anmelden/Registrieren, erstes Profil = Verwalter, weitere warten auf Freigabe
- Verwaltung: freigeben, ablehnen, sperren, löschen, zum Verwalter/Mitglied machen, neues Startpasswort
- **Verwalter legt Familienmitglieder direkt an** (Name, Benutzername wird vorgeschlagen, optional Verwalter).
  Server erzeugt ein Startpasswort (10 Zeichen, ohne verwechselbare Zeichen). Fertiger Text mit Link,
  Benutzername, Startpasswort und Anleitung → Knopf „Per WhatsApp senden“ (wa.me) oder „Kopieren“.
- Beim ersten Anmelden mit Startpasswort **muss** ein eigenes Passwort gewählt werden (Dialog nicht wegdrückbar)
- Profil: Anzeigename, eigene Farbe, Passwort ändern
- **Drei Ansichten** (Umschalter unter der Kopfzeile, die gewählte Ansicht wird gemerkt):
  - **Monat:** Raster, Tagesliste, „Demnächst“ (30 Tage). Ausgewählten Tag nochmal antippen oder „Tagesansicht ›“ = Tagesansicht
  - **Woche:** Liste Mo–So untereinander (Entscheidung Nutzer 2026-11-25, statt Stundenplan mit 7 Spalten); Tag antippen = Tagesansicht
  - **Tag:** Stundenplan 0–24 Uhr, ganztägige Termine oben, Termine als Blöcke (Überschneidungen nebeneinander),
    orange Linie = jetzt, springt zur passenden Uhrzeit. Auf eine Stunde tippen = neuer Termin zu dieser Uhrzeit
  - Pfeile und Wischen blättern je nach Ansicht Monat / Woche / Tag weiter
- Termine: ganztägig oder mit Uhrzeit, mehrtägig, Ort, Notiz, „Wer ist dabei?“, Wiederholung
  (wöchentlich, monatlich, jährlich, optional „bis“)
- Alle 60 Sekunden und beim Zurückkehren in die App werden Änderungen der anderen geladen
- **Automatische Updates:** Pi prüft stündlich GitHub (`main`). Startet die neue Version nicht, holt er die alte zurück.
  Offene Kalender am Handy merken eine neue Version (`/api/status` → `version`) und laden sich selbst neu.
- Export (alle Mitglieder) als JSON-Datei, Import (nur Verwalter, überspringt Doppelte, überschreibt nichts)
- Tägliche Sicherung der Datenbank auf dem Pi: `~/familienkalender-daten/sicherungen/` (letzte 14)

## 4. Wichtige Entscheidungen

- **Design:** Farben der New York Mets – Blau `#002D72` (Kopfzeile, Überschriften, Knöpfe), Orange `#FF5910`
  (Akzente, „+“-Knopf, heutiger Tag, Auswahl). Nur die Farben, keine Logos.
- **Läuft auf dem Pi, nicht auf GitHub Pages**, weil eine gemeinsame Datenbank gebraucht wird. Kein fremder Dienst.
- **Python nur mit Standardbibliothek** (kein pip nötig) + **SQLite**. Robust und wartungsarm auf dem Pi.
- Standard-Port **8502** (änderbar über `FK_PORT`). Firewall (ufw): nur aus dem eigenen Heimnetz; das Netz erkennt
  `pi/installieren.sh` auf dem Pi automatisch (änderbar über `FK_NETZ`). VPN-Geräte bekommen Heimnetz-Adressen.
- Zugriffsschutz doppelt: (1) nur Heimnetz/VPN, (2) Konto mit Passwort + Freigabe durch Verwalter.
- **Familie von außerhalb (Entscheidung 2026-11-25): eigenes VPN pro Person** (WireGuard aus dem Router), nicht
  übers offene Internet. Der Nutzer schickt jedem die VPN-Datei und den Zugangstext per WhatsApp.
- **Wichtig wegen Auto-Update:** Was auf `main` landet, ist spätestens nach einer Stunde live bei der ganzen Familie.
  Deshalb vor jedem Speichern auf `main` immer `bash test/alle_tests.sh` – nur bei „alles OK“ speichern.
- Startpasswort per WhatsApp ist vertretbar, weil es beim ersten Anmelden ersetzt werden muss.
- Passwörter nur als scrypt-Hash gespeichert. Sitzung per Cookie (HttpOnly, SameSite=Strict, 90 Tage).
  Schreibzugriffe brauchen die Kopfzeile `X-Familienkalender: 1` (Schutz gegen fremde Webseiten).
  Max. 10 Fehlversuche pro 15 Minuten beim Anmelden.
- Verbindung ist **http** (nicht https). Im eigenen WLAN (WPA-verschlüsselt) und im VPN (verschlüsselt) vertretbar.
- Alle freigegebenen Mitglieder dürfen alle Termine bearbeiten und löschen (Familie = Vertrauen).
- Wiederholende Termine: Änderungen/Löschen gelten immer für die ganze Serie.
- Repository ist **öffentlich** (nur Code). Der Pi lädt per `git clone` über https, kein Schlüssel nötig.
  Die Skripte arbeiten im Ordner, in dem sie liegen (keine festen Pfade oder Adressen).

## 5. Aufbau

| Datei | Zweck |
|---|---|
| `server/server.py` | Server + Schnittstelle (`/api/...`) + Datenbank + tägliche Sicherung |
| `server/static/` | Oberfläche: `index.html`, `app.js`, `style.css`, `icon.svg`, `manifest.json` |
| `pi/installieren.sh` | Einmalige Einrichtung auf dem Pi (Dienst `familienkalender`, Firewall) |
| `pi/aktualisieren.sh` | Neueste Version sofort von Hand holen + Neustart |
| `pi/auto_aktualisieren.sh` | Stündliches Auto-Update (Zeitplan `familienkalender-update.timer`), mit Rückkehr zur alten Version bei Fehler |
| `pi/pruefen.sh` | Läuft der Dienst? Letzte Sicherungen? |
| `test/` | Automatische Tests |

Einstellungen über Umgebungsvariablen: `FK_PORT` (8502), `FK_DATEN` (~/familienkalender-daten), `FK_HOST` (0.0.0.0).

## 6. Tests

Alles auf einmal: `bash test/alle_tests.sh` (optional mit Ordner für Bildschirmfotos als Zusatz).

- `test/test_datenschutz.py`: durchsucht alle Dateien des Repositorys nach Heimnetz-Adressen, E-Mail-Adressen,
  Gerätekennungen und Datenbank-Dateien. Schlägt fehl, sobald so etwas auftaucht.

- `test/test_server.py` (Python unittest, 12 Tests): Registrierung, Freigabe, Rechte, Sperren, Anmeldebremse,
  Schutz gegen fremde Seiten, Termine anlegen/ändern/löschen, Eingabeprüfungen, Profil/Passwort,
  Export/Import, Verwalter-Aktionen, Sicherung. Jeweils mit leerer Temp-Datenbank.
- Server-Tests auch für: Mitglied anlegen, Startpasswort, Pflicht-Passwortwechsel, Versionskennung, Ergänzung alter Datenbanken.
- `test/test_auto_update.py`: prüft `pi/auto_aktualisieren.sh` mit Test-Git und Attrappen (nichts Neues / gutes Update /
  kaputtes Update → zurück zur alten Version).
- `test/oberflaeche_test.js` (Playwright/Chromium im Handy-Format): kompletter Ablauf mit drei Personen
  (registrieren, Termin anlegen, Geburtstag jährlich, Freigabe, zweite Person bearbeitet, Export,
  Verwalter legt Mitglied an + WhatsApp-Text, Anmeldung mit Startpasswort + eigenes Passwort, Löschen,
  Wochenansicht (7 Tage, Blättern), Tagesansicht (Block-Position/-Höhe, Tippen auf Stunde, Ansicht gemerkt)).
- Pi-Skripte: nur Tippfehler-Prüfung (`bash -n`), echter Test auf dem Pi durch den Nutzer.

## 7. Offene Punkte / Ideen

- Einzelnen Termin aus einer Serie löschen/verschieben (geht noch nicht)
- Erinnerungen/Benachrichtigungen aufs Handy (bräuchte https bzw. eigene Lösung)
- Suche
- Einladungs-Link mit Einmal-Code (noch weniger Tipparbeit als Benutzername + Startpasswort)
- Eventuell https, falls gewünscht

## 8. Test-Liste für dich (am Handy abhaken)

- [x] Pi: Installationsbefehl aus der README ausgeführt, Meldung „FERTIG ✅“ (2026-11-25)
- [x] Pi: Installationsskript nach dem Update **noch einmal** ausgeführt (2026-11-25) → Meldung „Automatische Updates: stündlich ✅“
- [ ] Verwalter: ☰ → „Familienmitglied anlegen“ → Zugangsdaten erscheinen → „Per WhatsApp senden“ öffnet WhatsApp mit dem Text
- [ ] Familienmitglied: Anmeldung mit Startpasswort → muss eigenes Passwort wählen → sieht den Kalender
- [ ] Familienmitglied außerhalb: WireGuard-Datei importiert, VPN an → Link öffnet den Kalender
- [ ] Woche/Tag: Umschalter „Monat | Woche | Tag“ ist da; Wischen und Pfeile blättern; in der Tagesansicht auf eine Stunde tippen legt einen Termin an
- [ ] Auto-Update: nach der nächsten Änderung durch Claude ist sie spätestens nach ~1 Stunde da, ohne dass du etwas tust
- [ ] Handy (zu Hause, VPN aus): die Adresse, die das Installationsskript am Ende anzeigt, öffnet die Anmeldeseite
- [ ] Design: Kopfzeile Blau mit oranger Linie, „+“-Knopf und heutiger Tag Orange
- [ ] Eigenes Profil angelegt → du bist Verwalter und siehst den Kalender
- [ ] Chrome-Menü ⋮ → „Zum Startbildschirm hinzufügen“ → Symbol startet den Kalender
- [ ] Termin anlegen, ändern, löschen klappt; Datum wird deutsch angezeigt
- [ ] Geburtstag mit „jedes Jahr“ erscheint auch im nächsten Jahr
- [ ] Zweites Profil (z. B. auf einem anderen Handy) anlegen → „wartet auf Freigabe“ → du gibst frei → Anmeldung klappt
- [ ] Beide sehen die Termine des anderen (spätestens nach 1 Minute)
- [ ] Einstellungen → Exportieren lädt eine Datei herunter
- [ ] Unterwegs mit VPN an: Kalender öffnet sich; mit VPN aus: Kalender ist **nicht** erreichbar
- [ ] Nach einem Neustart des Pi läuft der Kalender wieder von selbst
- [ ] Nach 1–2 Tagen: `bash ~/familienkalender/pi/pruefen.sh` zeigt Sicherungen

## 9. Verlauf

| Datum | Was |
|---|---|
| 2026-11-25 | Projekt gestartet: Server, Oberfläche, Pi-Skripte, Tests. Alle automatischen Tests grün. Noch nicht auf dem Pi installiert |
| 2026-11-25 | Datenschutz: alle Adressen, Geräte-/Kontodaten und echten Namen entfernt, Skripte erkennen Netz/Adresse selbst, Datenschutz-Test ergänzt. Design auf Mets-Farben (Blau/Orange) umgestellt |
| 2026-11-25 | Auf dem Pi installiert, „FERTIG ✅“ (Nutzer-Foto) |
| 2026-11-25 | Verwalter legt Mitglieder mit Startpasswort an, WhatsApp-Text, Pflicht-Passwortwechsel; stündliches Auto-Update mit Rückfall; Handy lädt neue Version selbst. 19 Server-/Skript-Tests + Browser-Test grün |
| 2026-11-25 | Update auf dem Pi eingespielt (4b6fc19), Auto-Update-Zeitplan aktiv ✅ (Nutzer-Foto) |
| 2026-11-25 | Wochenansicht (Liste Mo–So) und Tagesansicht (Stundenplan) ergänzt, Ansicht wird gemerkt. Alle Tests grün |
