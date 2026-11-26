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
  **Der Nutzer tippt sie in Termux am Handy** → Pi-Befehle immer mit `ssh -t pi '…'` davor geben (`-t`, damit sudo nach dem Passwort fragen kann), z. B.
  `ssh -t pi 'bash ~/familienkalender/pi/aktualisieren.sh'` (Entscheidung Nutzer 2026-11-26). Mehrere Befehle in eine
  Zeile mit `&&`; einfache Anführungszeichen im Befehl vermeiden.
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
- Termine: ganztägig oder mit Uhrzeit, mehrtägig, Ort, Notiz, „Für wen?“, Wiederholung
  (wöchentlich, monatlich, jährlich, optional „bis“)
- **„Für wen?“ (seit 2026-11-26):** Personen werden als farbige Schilder angetippt (✓ + gefüllt = ausgewählt).
  Niemand ausgewählt = **ganze Familie** → hellblaues Schild „Alle“, hellblauer Streifen. Neue Termine starten mit „Alle“.
  In Listen (Tag, Woche, Demnächst), Tagesansicht-Blöcken und Kalender-Links stehen die Namen als Schilder in der
  Farbe der Person (Schrift automatisch hell/dunkel). Mehrere Personen: Streifen links in allen Farben untereinander.
- Alle 60 Sekunden und beim Zurückkehren in die App werden Änderungen der anderen geladen
- **Hinweis „Keine Verbindung“** (oranger Balken oben), wenn der Kalender nicht erreichbar ist (z. B. unterwegs ohne
  WireGuard); prüft dann alle 10 Sekunden und sofort, wenn das Handy wieder online ist; verschwindet von selbst.
  Beim Öffnen ohne Verbindung zeigt die installierte App die Seite „Keine Verbindung“ (siehe https).
  Eine Web-App kann WireGuard **nicht** selbst einschalten (Handy-Sicherheit) → Lösung am Handy, siehe Server-Projekt
- **Automatische Updates:** Pi prüft stündlich GitHub (`main`). Startet die neue Version nicht, holt er die alte zurück.
  Offene Kalender am Handy merken eine neue Version (`/api/status` → `version`) und laden sich selbst neu.
- Export (alle Mitglieder) als JSON-Datei, Import (nur Verwalter, überspringt Doppelte, überschreibt nichts)
- **Andere Kalender (.ics, seit 2026-11-26):** Einstellungen → „Andere Kalender“. Export „Als .ics exportieren“ (alle),
  Import einer .ics-Datei (nur Verwalter): erst Vorschau („X neue Termine gefunden … übernehmen?“), Doppelte (gleiche
  UID oder gleicher Titel+Datum+Uhrzeit) werden übersprungen. Wiederholung jede Woche/Monat/Jahr wird übernommen,
  andere Regeln (täglich, alle 2 Wochen …) nur als einzelner Termin. Abgesagte und geänderte Einzeltermine einer Serie
  werden weggelassen. Zeiten werden in deutsche Zeit umgerechnet (Sommer-/Winterzeit).
- **Kalender-Links / Abos (seit 2026-11-26, nur Verwalter):** Name + Link (https:// oder webcal://) + „Wer ist dabei“.
  Der Pi holt den Link sofort und dann **alle 6 Stunden** (`abo_schleife`), trägt neue Termine ein, aktualisiert
  geänderte (z. B. verlegte Anstoßzeit) und entfernt **künftige** Termine, die nicht mehr im Link stehen (vergangene bleiben).
  Klappt ein Abruf nicht, bleiben die Termine unverändert und der Fehler steht in der Liste. „Jetzt abrufen“ und
  „Löschen“ (löscht den Link mit seinen Terminen, mit Rückfrage). Im Termin steht „Kommt automatisch aus dem Kalender-Link …“.
- Tägliche Sicherung der Datenbank auf dem Pi: `~/familienkalender-daten/sicherungen/` (letzte 14)
- **Installierbare Web-App mit https (seit 2026-11-26, auf dem Pi aktiv):** Liegt auf dem Pi ein Zertifikat
  (vom privaten Server-Projekt in `~/zertifikate/`), läuft der Kalender verschlüsselt unter `https://kalender.<domain>`
  (Standard-Port 443, Link ohne Zusatz). Die alte http-Adresse leitet weiter; offene alte Seiten wechseln selbst.
  Manifest mit PNG-Symbolen (192, 512, maskable), Hintergrund-Helfer `sw.js` (speichert **keine** Termine, nur die
  Seite „Keine Verbindung“ mit Gestaltung), oranger Hinweis „Als App installieren“ (✕ = 2 Wochen Ruhe).
  WhatsApp-Text zeigt automatisch den neuen Link + Tipp „Installieren“.

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
- **WireGuard-Zugang (QR-Code/Datei) wird nie per WhatsApp/E-Mail verschickt** (= Hausschlüssel), sondern persönlich
  eingerichtet (Entscheidung Nutzer 2026-11-26). Der Zugangstext sagt deshalb „richten wir einmal gemeinsam ein“.
- Passwörter nur als scrypt-Hash gespeichert. Sitzung per Cookie (HttpOnly, SameSite=Strict, 90 Tage).
  Schreibzugriffe brauchen die Kopfzeile `X-Familienkalender: 1` (Schutz gegen fremde Webseiten).
  Max. 10 Fehlversuche pro 15 Minuten beim Anmelden.
- **https über eigenes Zertifikat** (Entscheidung 2026-11-26, statt APK). Domain/Zertifikat kommen aus dem privaten
  Server-Projekt; der Server liest den Domainnamen auf dem Pi aus `~/zertifikate/domain` → **steht nie in diesem Projekt**.
  https wird nur aktiv, wenn `pi/installieren.sh` es eingerichtet hat (`FK_ZERTIFIKATE` gesetzt) – so kann das Auto-Update
  nichts kaputt machen. Klappt https nicht (Zertifikat kaputt, Port belegt), läuft der Kalender automatisch mit http weiter.
  Port 443 per `AmbientCapabilities=CAP_NET_BIND_SERVICE` (kein root), Firewall nur Heimnetz. Cookie dann mit `Secure`.
  Erneuert das Server-Projekt das Zertifikat, startet es den Dienst `familienkalender` selbst neu.
  Ohne Zertifikat: weiterhin http (im eigenen WLAN bzw. VPN verschlüsselt, aber nicht als App installierbar).
- Alle freigegebenen Mitglieder dürfen alle Termine bearbeiten und löschen (Familie = Vertrauen).
- Termine ohne ausgewählte Person gelten für die ganze Familie (Entscheidung Nutzer 2026-11-26), Farbe dann nicht mehr
  die des Erstellers, sondern hellblau (Mets-Blau ist schon eine Personenfarbe).
- Wiederholende Termine: Änderungen/Löschen gelten immer für die ganze Serie.
- **.ics-Format** (Entscheidung 2026-11-26): eigener Leser/Schreiber `server/ics.py` (nur Standardbibliothek, kein pip).
  Kalender-Links werden vom Pi aus abgerufen (ausgehend, Firewall unverändert); die Links (z. B. geheime Google-Adresse)
  liegen nur in der Datenbank auf dem Pi, nie im Repository. Termine aus Links gehören dem Link: Änderungen in der App
  überschreibt der nächste Abruf. Kalender-Links verwalten und .ics importieren: nur Verwalter (wie JSON-Import).
- Klender (bisherige Familien-App): ob sie .ics exportieren kann, ist unbekannt (Nutzer prüft). Umweg falls nicht:
  Klender mit Google Kalender verbinden und von dort exportieren bzw. Google-Adresse im iCal-Format als Link eintragen.
- Repository ist **öffentlich** (nur Code). Der Pi lädt per `git clone` über https, kein Schlüssel nötig.
- **Öffentlich oder privat?** (besprochen 2026-11-26): bleibt **vorerst öffentlich** (Entscheidung Nutzer). Privat wäre
  kostenlos möglich (GitHub Free), aber **vorher** braucht der Pi einen Deploy Key (nur Lesen, nur dieses Repository),
  sonst holt das Auto-Update nichts mehr. Reihenfolge: Skripte umbauen → Schlüssel auf dem Pi erzeugen → bei GitHub
  eintragen (Settings → Deploy keys, ohne Schreibrecht) → Pi umstellen + prüfen → erst dann auf privat stellen.
  Generell für weitere Pi-Apps: ein Deploy Key pro Repository (empfohlen) statt eines gemeinsamen Tokens; Ablauf
  dafür im privaten Server-Projekt bauen. GitHub Pages geht im kostenlosen Konto nur mit öffentlichen Repositorys.
  Die Skripte arbeiten im Ordner, in dem sie liegen (keine festen Pfade oder Adressen).

## 5. Aufbau

| Datei | Zweck |
|---|---|
| `server/server.py` | Server + Schnittstelle (`/api/...`) + Datenbank + tägliche Sicherung |
| `server/static/` | Oberfläche: `index.html`, `app.js`, `style.css`, `icon.svg`, `manifest.json` |
| `pi/installieren.sh` | Einmalige Einrichtung auf dem Pi (Dienst `familienkalender`, Firewall) |
| `pi/aktualisieren.sh` | Neueste Version sofort von Hand holen + Neustart |
| `pi/auto_aktualisieren.sh` | Stündliches Auto-Update (Zeitplan `familienkalender-update.timer`), mit Rückkehr zur alten Version bei Fehler |
| `pi/pruefen.sh` | Läuft der Dienst? Letzte Sicherungen? Updates? Verschlüsselung (https) ok? |
| `server/static/sw.js`, `offline.html`, `icon-*.png` | Installier-Funktion: Hintergrund-Helfer, Seite „Keine Verbindung“, App-Symbole |
| `werkzeuge/symbole_erzeugen.js` | Erzeugt die PNG-Symbole aus `icon.svg` (`node werkzeuge/symbole_erzeugen.js server/static`) |
| `server/ics.py` | Kalender-Dateien (.ics) lesen und schreiben (Import, Export, Kalender-Links) |
| `test/` | Automatische Tests |

Einstellungen über Umgebungsvariablen: `FK_PORT` (8502), `FK_DATEN` (~/familienkalender-daten), `FK_HOST` (0.0.0.0);
für https (setzt `pi/installieren.sh`): `FK_ZERTIFIKATE`, `FK_HTTPS_PORT` (443), `FK_NAME` (kalender), `FK_HTTPS=0` = aus.

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
  Wochenansicht (7 Tage, Blättern), Tagesansicht (Block-Position/-Höhe, Tippen auf Stunde, Ansicht gemerkt),
  „Für wen?“: neu = niemand ausgewählt, Schild mit Namen, zwei Personen = zwei Schilder + bunter Streifen).
- `test/test_https.py`: https mit selbst erzeugtem Test-Zertifikat (erfundene Domain `beispiel.test`, Kette wird geprüft):
  nur mit `FK_ZERTIFIKATE`, Cookie `Secure`, unverschlüsselte Anfrage stört nicht, Weiterleitung der alten Adresse
  (Seiten, API, Status), Rückfall auf http bei kaputtem Zertifikat, Installier-Dateien.
- `test/https_oberflaeche_test.js` (Chromium): Weiterleitung, Anmeldung, **Chrome-Prüfung „installierbar“ ohne Fehler**,
  WhatsApp-Text mit neuem Link, Installier-Hinweis, Seite „Keine Verbindung“ mit Gestaltung.
  Hinweis: In der Cloud-Testumgebung kann der Browser keine erfundenen Namen umleiten → Test läuft mit 127.0.0.1.
- `test/test_ics.py` (10 Tests): .ics lesen (ganztägig, UTC/Sommerzeit, Zeitzone, Dauer, umbrochene Zeilen,
  Wiederholungen, abgesagt, Einzeltermin einer Serie, kaputt, Umlaute/Windows-Zeichen), schreiben + wieder lesen,
  Import (Vorschau, Rechte, nichts doppelt), Export, Kalender-Link mit Test-Server auf 127.0.0.1 (neu, geändert,
  entfernt, Link nicht erreichbar, falscher Inhalt, webcal://, Löschen), Ergänzung alter Datenbanken.
- `test/ics_oberflaeche_test.js` (Chromium): .ics-Datei importieren (Rückfrage, Ergebnis, zweites Mal nichts doppelt),
  Kalender-Link anlegen + „Jetzt abrufen“, Export als .ics, Termine in „Demnächst“ (Schild „Alle“ bzw. Name),
  Hinweis im Termin, Link löschen.
- Pi-Skripte: nur Tippfehler-Prüfung (`bash -n`), echter Test auf dem Pi durch den Nutzer.

## 7. Offene Punkte / Ideen

- Einzelnen Termin aus einer Serie löschen/verschieben (geht noch nicht)
- .ics: tägliche Wiederholungen / „alle 2 Wochen“ kann der Kalender noch nicht (werden einmal eingetragen)
- Klender: Export-Möglichkeit klären (siehe Entscheidungen)
- Repository evtl. später privat (siehe Entscheidungen, Deploy Key)
- Erinnerungen/Benachrichtigungen aufs Handy (bräuchte https bzw. eigene Lösung)
- Suche
- Einladungs-Link mit Einmal-Code (noch weniger Tipparbeit als Benutzername + Startpasswort)
- (Erledigt 2026-11-26: Mainz-05-Spielplan als Kalender-Link über calovo, mainz05.de/termine → „Pflichtspiele Profis“ →
  „Weitere Formate“ → „URL“. Ersatz falls nötig: FotMob, Team 9905, „synccalendar“ → ICS)
- Familie außerhalb: prüfen, ob `kalender.<domain>` per VPN auflöst (WireGuard-Datei sollte die FritzBox als DNS nutzen)
- Weitere Pi-Apps (z. B. Kicktipp) können dasselbe Sammel-Zertifikat nutzen; dann braucht es für Port 443 einen
  gemeinsamen Verteiler (Reverse Proxy) – erst angehen, wenn es soweit ist
- (Erledigt 2026-11-26: installierbare Web-App per https. Eine APK wurde bewusst verworfen.)

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
- [x] (2026-11-26) **https einschalten:** Befehl auf dem Pi (siehe Chat) → „Zertifikat gefunden ✅“, „Verschlüsselte Verbindung geprüft ✅“
- [x] (2026-11-26) Handy (zu Hause, VPN aus): `https://kalender.<domain>` öffnet den Kalender, Hinweis „Installieren“ erscheint (Foto)
- [ ] Alte Adresse (http + Nummer) leitet automatisch auf die neue weiter
- [ ] Oranger Hinweis „Installieren“ (oder ⋮ → „App installieren“) → Symbol auf dem Startbildschirm, App öffnet **ohne Adresszeile**
- [ ] Nach Installation einmal neu anmelden nötig? (wegen neuer Adresse vermutlich ja – einmalig)
- [ ] WLAN aus + VPN aus → App zeigt „Keine Verbindung“ mit Hinweis auf WireGuard
- [ ] App offen, dann WLAN aus (VPN aus) → nach spätestens 1 Minute oranger Balken „Keine Verbindung … WireGuard einschalten“; WLAN wieder an → Balken verschwindet
- [ ] Mit VPN unterwegs: `https://kalender.<domain>` öffnet sich
- [ ] `ssh -t pi 'bash ~/familienkalender/pi/pruefen.sh'` zeigt „Verschlüsselt (https) ✅“
- [ ] Termin anlegen, ändern, löschen klappt; Datum wird deutsch angezeigt
- [x] (2026-11-26) (Für wen) Neuer Termin: niemand angetippt → Schild „Alle“; zwei Personen angetippt → zwei farbige Namens-Schilder, Streifen zweifarbig
- [x] (2026-11-26) (Für wen) Farben gut lesbar? Schilder groß genug? → „sieht sehr gut aus“
- [ ] (.ics) ☰ → „Andere Kalender“ → „Als .ics exportieren“ lädt eine Datei herunter
- [ ] (.ics) Klender: gibt es dort „Exportieren“/„Teilen“ als .ics? (Ergebnis Claude sagen)
- [ ] (.ics) Google-Kalender-Datei importiert → Rückfrage mit Anzahl → Termine sind da, Uhrzeiten stimmen
- [ ] (.ics) Dieselbe Datei nochmal → „Keine neuen Termine“
- [x] (2026-11-26) (Link) Mainz-05-Spielplan-Link eingetragen → „Gespeichert ✓ … Termine eingetragen“, Anstoßzeiten stimmen
- [ ] (Link) Nach einem Tag: in der Liste steht ein neues „zuletzt geholt“
- [ ] Geburtstag mit „jedes Jahr“ erscheint auch im nächsten Jahr
- [ ] Zweites Profil (z. B. auf einem anderen Handy) anlegen → „wartet auf Freigabe“ → du gibst frei → Anmeldung klappt
- [ ] Beide sehen die Termine des anderen (spätestens nach 1 Minute)
- [ ] Einstellungen → Exportieren lädt eine Datei herunter
- [ ] Unterwegs mit VPN an: Kalender öffnet sich; mit VPN aus: Kalender ist **nicht** erreichbar
- [ ] Nach einem Neustart des Pi läuft der Kalender wieder von selbst
- [ ] Nach 1–2 Tagen: `ssh -t pi 'bash ~/familienkalender/pi/pruefen.sh'` zeigt Sicherungen

## 9. Verlauf

| Datum | Was |
|---|---|
| 2026-11-25 | Projekt gestartet: Server, Oberfläche, Pi-Skripte, Tests. Alle automatischen Tests grün. Noch nicht auf dem Pi installiert |
| 2026-11-25 | Datenschutz: alle Adressen, Geräte-/Kontodaten und echten Namen entfernt, Skripte erkennen Netz/Adresse selbst, Datenschutz-Test ergänzt. Design auf Mets-Farben (Blau/Orange) umgestellt |
| 2026-11-25 | Auf dem Pi installiert, „FERTIG ✅“ (Nutzer-Foto) |
| 2026-11-25 | Verwalter legt Mitglieder mit Startpasswort an, WhatsApp-Text, Pflicht-Passwortwechsel; stündliches Auto-Update mit Rückfall; Handy lädt neue Version selbst. 19 Server-/Skript-Tests + Browser-Test grün |
| 2026-11-25 | Update auf dem Pi eingespielt (4b6fc19), Auto-Update-Zeitplan aktiv ✅ (Nutzer-Foto) |
| 2026-11-25 | Wochenansicht (Liste Mo–So) und Tagesansicht (Stundenplan) ergänzt, Ansicht wird gemerkt. Alle Tests grün |
| 2026-11-25 | Entscheidung: installierbare Web-App über eigene Domain + https (statt APK). Einrichtung der Domain zuerst im privaten Server-Projekt, danach Umbau hier |
| 2026-11-26 | Server-Projekt meldet: Sammel-Zertifikat auf dem Pi fertig. Hier umgebaut: https mit Zertifikat vom Pi (Port 443, Link ohne Zusatz), Weiterleitung der alten Adresse, Rückfall auf http, Installier-Funktion (Manifest, PNG-Symbole, Service Worker, Seite „Keine Verbindung“, Hinweis „Installieren“), Installations-/Prüfskript erweitert. Beim Testen gefunden: Test-Browser der Cloud kann erfundene Namen nicht umleiten (Umgebung, nicht Kalender). 25 Server-/Skript-Tests + 2 Browser-Tests grün. Am selben Abend eingeschaltet (siehe nächste Zeilen) |
| 2026-11-26 | Auf dem Pi eingeschaltet (Foto): Zertifikat gefunden ✅, verschlüsselte Verbindung geprüft ✅. **Fehler:** Skript fand per `ssh pi '…'` die Firewall nicht (`/usr/sbin` fehlt im Suchpfad) → https-Freigabe fehlte. Behoben (Suchpfad ergänzt, Freigaben werden am Ende angezeigt). **Regel:** Pi-Skripte müssen auch über `ssh pi '…'` laufen |
| 2026-11-26 | WhatsApp-Text: WireGuard „richten wir einmal gemeinsam ein“ (statt Datei schicken). Neuer Hinweis „Keine Verbindung – WireGuard einschalten“ in der offenen App. Tests grün |
| 2026-11-26 | Nach erneutem Lauf: Firewall-Freigabe 443 eingetragen („Rule added“, 443 + 8502 nur Heimnetz). Am Handy lädt `https://kalender.<domain>` ✅, Hinweis „Installieren“ erscheint ✅. Installieren selbst + App ohne Adresszeile: Rückmeldung offen |
| 2026-11-26 | Andere Kalender: .ics-Import (mit Vorschau) und -Export, Kalender-Links (Abos, z. B. Spielplan) holt der Pi alle 6 Stunden. Neue Tests `test_ics.py` + `ics_oberflaeche_test.js`, alle Tests grün. Direkt auf `main` (Entscheidung Nutzer) |
| 2026-11-26 | „Für wen?“: Namens-Schilder in Personenfarbe statt kleiner Punkte, Auswahl als antippbare Schilder, niemand = „Alle“ (ganze Familie, auch Standard für neue Termine), mehrfarbiger Streifen. Alle Tests grün, direkt auf `main` |
| 2026-11-26 | Pi-Befehle ab jetzt immer als `ssh -t pi '…'` (Nutzer tippt in Termux; `-t` für sudo). Update auf dem Pi kam per Auto-Update („Bereits aktuell“). Mainz-05-Link: offizielle Quelle calovo („Weitere Formate“ → „URL“), Eintragen durch Nutzer offen. Besprochen: Repository bleibt vorerst öffentlich; privat ginge kostenlos mit Deploy Key auf dem Pi (Reihenfolge siehe Entscheidungen) |
| 2026-11-26 | Nutzer-Rückmeldung: Namens-Schilder „sehen sehr gut aus“ ✅. Mainz-05-Spielplan (calovo-Link) eingetragen, Spiele kommen automatisch ✅ |
