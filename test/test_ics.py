"""Tests fuer Kalender-Dateien (.ics): Lesen, Schreiben, Import, Export und Kalender-Links (Abos).

Start:  python3 -m unittest test.test_ics -v   (oder alles: bash test/alle_tests.sh)
Nur erfundene Termine, leere Test-Datenbank im Temp-Ordner. Kalender-Links werden von einem
kleinen Test-Server auf diesem Rechner geliefert (kein Internet noetig).
"""

import datetime as dt
import http.server
import os
import shutil
import sys
import tempfile
import threading
import unittest

os.environ["FK_LEISE"] = "1"
os.environ["no_proxy"] = os.environ["NO_PROXY"] = "127.0.0.1,localhost"
HIER = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HIER, "..", "server"))
sys.path.insert(0, HIER)
import ics  # noqa: E402
import server as fk  # noqa: E402
from test_server import Client  # noqa: E402

BEISPIEL = "\r\n".join([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261227",
    "SUMMARY:Weihnachten bei Oma", "UID:a1@test", "END:VEVENT",
    # Uhrzeit in UTC (Winter: +1 Stunde)
    "BEGIN:VEVENT", "DTSTART:20261205T143000Z", "DTEND:20261205T163000Z", "SUMMARY:Heimspiel",
    "LOCATION:Stadion\\, Block C", "DESCRIPTION:Erste Zeile\\nZweite Zeile", "UID:a2@test",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M", "DESCRIPTION:Erinnerung", "END:VALARM", "END:VEVENT",
    # Sommerzeit in UTC (+2 Stunden), Zeile umbrochen
    "BEGIN:VEVENT", "DTSTART:20260704T180000Z", "DTEND:20260704T200000Z",
    "SUMMARY:Sommerfest mit sehr langem Titel der ueber mehrere Zeilen umbrochen wird und noch weiter",
    " geht", "UID:a3@test", "END:VEVENT",
    # mit Zeitzone
    "BEGIN:VEVENT", "DTSTART;TZID=Europe/Berlin:20261210T090000", "DURATION:PT1H30M",
    "SUMMARY:Zahnarzt", "UID:a4@test", "END:VEVENT",
    # Geburtstag jaehrlich
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20000315", "SUMMARY:Geburtstag Testperson",
    "RRULE:FREQ=YEARLY", "UID:a5@test", "END:VEVENT",
    # woechentlich mit Anzahl
    "BEGIN:VEVENT", "DTSTART;TZID=Europe/Berlin:20261102T170000", "DTEND;TZID=Europe/Berlin:20261102T183000",
    "RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=MO", "SUMMARY:Training", "UID:a6@test", "END:VEVENT",
    # taeglich -> kann der Familienkalender nicht -> einmal
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261201", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Kur", "UID:a7@test",
    "END:VEVENT",
    # abgesagt / geaenderte Einzelstunde einer Serie / kaputt
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261202", "STATUS:CANCELLED", "SUMMARY:Abgesagt", "UID:a8@test",
    "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;TZID=Europe/Berlin:20261109T180000", "RECURRENCE-ID;TZID=Europe/Berlin:20261109T170000",
    "SUMMARY:Training", "UID:a6@test", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:kaputt", "SUMMARY:Kaputt", "END:VEVENT",
    "END:VCALENDAR", ""])


def nach_titel(liste):
    return {t["title"]: t for t in liste}


class LesenTest(unittest.TestCase):
    def test_beispiel(self):
        termine, h = ics.lesen(BEISPIEL)
        self.assertEqual(h, {"abgesagt": 1, "einzeln": 1, "fehlerhaft": 1, "vereinfacht": 1})
        t = nach_titel(termine)
        self.assertEqual(len(termine), 7)
        w = t["Weihnachten bei Oma"]
        self.assertEqual((w["start_date"], w["end_date"], w["all_day"]), ("2026-12-24", "2026-12-26", True))
        s = t["Heimspiel"]
        self.assertEqual((s["start_time"], s["end_time"], s["all_day"]), ("15:30", "17:30", False))
        self.assertEqual(s["location"], "Stadion, Block C")
        self.assertEqual(s["notes"], "Erste Zeile\nZweite Zeile")
        lang = [x for x in termine if x["title"].startswith("Sommerfest")][0]
        self.assertTrue(lang["title"].endswith("noch weitergeht"))
        self.assertEqual(lang["start_time"], "20:00")
        z = t["Zahnarzt"]
        self.assertEqual((z["start_time"], z["end_time"]), ("09:00", "10:30"))
        g = t["Geburtstag Testperson"]
        self.assertEqual((g["repeat"], g["repeat_until"], g["end_date"]), ("yearly", None, "2000-03-15"))
        tr = t["Training"]
        self.assertEqual((tr["repeat"], tr["repeat_until"], tr["uid"]), ("weekly", "2027-01-04", "a6@test"))
        k = t["Kur"]
        self.assertEqual((k["repeat"], k["start_date"]), ("none", "2026-12-01"))

    def test_keine_kalender_datei(self):
        with self.assertRaises(ValueError):
            ics.lesen("Hallo, das ist nur Text")

    def test_sommerzeit_ohne_zeitzonen_daten(self):
        f = ics._utc_nach_berlin_ohne_zoneinfo
        self.assertEqual(f(dt.datetime(2026, 7, 4, 18, 0)).hour, 20)
        self.assertEqual(f(dt.datetime(2026, 12, 5, 14, 0)).hour, 15)
        self.assertEqual(f(dt.datetime(2026, 3, 29, 0, 59)).hour, 1)   # kurz vor Umstellung
        self.assertEqual(f(dt.datetime(2026, 3, 29, 1, 0)).hour, 3)    # danach

    def test_wiederholungen(self):
        start = dt.date(2026, 1, 31)
        self.assertEqual(ics._wiederholung("FREQ=MONTHLY;COUNT=2", start), ("monthly", "2026-02-28"))
        self.assertEqual(ics._wiederholung("FREQ=YEARLY;UNTIL=20301231", start), ("yearly", "2030-12-31"))
        self.assertIsNone(ics._wiederholung("FREQ=WEEKLY;INTERVAL=2", start))
        self.assertIsNone(ics._wiederholung("FREQ=WEEKLY;BYDAY=MO,WE", start))
        self.assertIsNone(ics._wiederholung("FREQ=MONTHLY;BYDAY=1SA", start))

    def test_umlaute_und_windows_zeichen(self):
        roh = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261201\nSUMMARY:Grüße\nEND:VEVENT\nEND:VCALENDAR"
        for kodierung in ("utf-8", "cp1252"):
            self.assertEqual(ics.lesen(ics.text_aus_bytes(roh.encode(kodierung)))[0][0]["title"], "Grüße")


class SchreibenTest(unittest.TestCase):
    def test_hin_und_zurueck(self):
        termine, _ = ics.lesen(BEISPIEL)
        for i, t in enumerate(termine):
            t["id"] = i
        text = ics.schreiben(termine)
        for zeile in text.split("\r\n"):
            self.assertLessEqual(len(zeile.encode()), 75, zeile)
        wieder, h = ics.lesen(text)
        self.assertEqual(h, {"abgesagt": 0, "einzeln": 0, "fehlerhaft": 0, "vereinfacht": 0})
        felder = ["title", "start_date", "end_date", "all_day", "start_time", "end_time", "location", "notes",
                  "repeat", "repeat_until", "uid"]
        self.assertEqual([{k: t[k] for k in felder} for t in wieder], [{k: t[k] for k in felder} for t in termine])

    def test_umlaute_lange_zeile(self):
        t = {"id": 1, "title": "Ä" * 100, "start_date": "2026-12-01", "end_date": "2026-12-01", "all_day": True,
             "notes": "", "location": "", "repeat": "none"}
        text = ics.schreiben([t])
        self.assertEqual(ics.lesen(text)[0][0]["title"], "Ä" * 100)


class TestKalenderServer(http.server.BaseHTTPRequestHandler):
    inhalt = BEISPIEL.encode()

    def do_GET(self):
        if self.path != "/spielplan.ics":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar")
        self.end_headers()
        self.wfile.write(TestKalenderServer.inhalt)

    def log_message(self, *a):
        pass


class ServerIcsTest(unittest.TestCase):
    def setUp(self):
        self.ordner = tempfile.mkdtemp()
        self.srv = fk.Server(("127.0.0.1", 0), self.ordner)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.quelle = http.server.HTTPServer(("127.0.0.1", 0), TestKalenderServer)
        threading.Thread(target=self.quelle.serve_forever, daemon=True).start()
        self.link = "http://127.0.0.1:%d/spielplan.ics" % self.quelle.server_address[1]
        TestKalenderServer.inhalt = BEISPIEL.encode()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.quelle.shutdown()
        self.quelle.server_close()
        shutil.rmtree(self.ordner)

    def neu(self):
        return Client(self.srv.server_address[1])

    def konten(self):
        a = self.neu()
        a("POST", "/api/registrieren", {"username": "alex", "display_name": "Alex", "password": "geheim123"})
        a("POST", "/api/anmelden", {"username": "alex", "password": "geheim123"})
        s, b, _ = a("POST", "/api/admin/benutzer", {"username": "kim", "display_name": "Kim", "password": "kimstart1"})
        k = self.neu()
        k("POST", "/api/anmelden", {"username": "kim", "password": "kimstart1"})
        return a, k, b["id"]

    def test_import_und_export(self):
        a, k, _ = self.konten()
        # nur Verwalter darf importieren
        self.assertEqual(k("POST", "/api/import-ics", {"ics": BEISPIEL})[0], 403)
        self.assertEqual(a("POST", "/api/import-ics", {"ics": "kein Kalender"})[0], 400)
        s, d, _ = a("POST", "/api/import-ics", {"ics": BEISPIEL, "nur_pruefen": True})
        self.assertEqual((s, d["neu"], d["gespeichert"]), (200, 7, False))
        self.assertEqual(len(a("GET", "/api/termine")[1]), 0)  # Vorschau speichert nichts
        s, d, _ = a("POST", "/api/import-ics", {"ics": BEISPIEL})
        self.assertEqual((d["neu"], d["uebersprungen"], d["vereinfacht"], d["fehlerhaft"]), (7, 0, 1, 1))
        # zweimal importieren -> nichts doppelt
        s, d, _ = a("POST", "/api/import-ics", {"ics": BEISPIEL})
        self.assertEqual((d["neu"], d["uebersprungen"]), (0, 7))
        # Export als .ics (darf jedes Mitglied) und wieder einlesen
        s, roh, r = k("GET", "/api/export.ics")
        self.assertEqual(s, 200)
        self.assertTrue(r.getheader("Content-Type").startswith("text/calendar"))
        self.assertIn("attachment", r.getheader("Content-Disposition"))
        termine, _ = ics.lesen(roh.decode())
        self.assertEqual(len(termine), 7)
        self.assertIn("Heimspiel", {t["title"] for t in termine})
        # eigener Export zurueck importieren -> alles schon vorhanden
        self.assertEqual(a("POST", "/api/import-ics", {"ics": roh.decode()})[1]["neu"], 0)

    def test_kalender_link(self):
        a, k, kim_id = self.konten()
        self.assertEqual(k("GET", "/api/abos")[0], 403)
        self.assertEqual(a("POST", "/api/abos", {"name": "Spielplan", "url": "ftp://x"})[0], 400)
        s, abo, _ = a("POST", "/api/abos", {"name": "Spielplan", "url": self.link, "participants": [kim_id]})
        self.assertEqual(s, 201, abo)
        self.assertTrue(abo["last_status"].startswith("OK: 7 neu"), abo["last_status"])
        self.assertEqual(abo["anzahl"], 7)
        self.assertEqual(a("POST", "/api/abos", {"name": "Nochmal", "url": self.link})[0], 409)
        termine = k("GET", "/api/termine")[1]
        self.assertEqual(len(termine), 7)
        self.assertTrue(all(t["abo_name"] == "Spielplan" and t["participants"] == [kim_id] for t in termine))
        # nochmal abrufen ohne Aenderung -> nichts neu, nichts doppelt
        s, abo, _ = a("POST", "/api/abos/%d/abrufen" % abo["id"])
        self.assertEqual(abo["last_status"], "OK: 0 neu, 0 geändert, 0 entfernt, "
                         "1 mit besonderer Wiederholung nur einmal eingetragen, 1 fehlerhaft übersprungen")
        # Spielplan aendert sich: Anstoss verlegt, ein kuenftiges Spiel faellt weg, vergangenes bleibt
        jahr = dt.date.today().year + 1
        TestKalenderServer.inhalt = "\r\n".join([
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT", "DTSTART:%d0105T173000Z" % jahr, "SUMMARY:Heimspiel", "UID:a2@test", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20000315", "SUMMARY:Geburtstag Testperson", "RRULE:FREQ=YEARLY",
            "UID:a5@test", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART;VALUE=DATE:%d0301" % jahr, "SUMMARY:Neues Spiel", "UID:neu@test", "END:VEVENT",
            "END:VCALENDAR"]).encode()
        s, abo, _ = a("POST", "/api/abos/%d/abrufen" % abo["id"])
        self.assertTrue(abo["last_status"].startswith("OK: 1 neu, 1 geändert"), abo["last_status"])
        titel = {t["title"]: t for t in k("GET", "/api/termine")[1]}
        self.assertEqual(titel["Heimspiel"]["start_time"], "18:30")
        self.assertIn("Neues Spiel", titel)
        # Weihnachten 2026 liegt (noch) in der Zukunft -> entfernt; Sommerfest Juli 2026 vergangen -> bleibt
        heute = dt.date.today().isoformat()
        for t in ("Weihnachten bei Oma", "Zahnarzt", "Training", "Kur"):
            if t in titel:
                self.assertLess(titel[t]["end_date"], heute, t)
        # Link nicht erreichbar -> Fehlermeldung, Termine bleiben
        self.quelle.shutdown()
        self.quelle.server_close()
        vorher = len(k("GET", "/api/termine")[1])
        s, abo, _ = a("POST", "/api/abos/%d/abrufen" % abo["id"])
        self.assertTrue(abo["last_status"].startswith("Abruf fehlgeschlagen"), abo["last_status"])
        self.assertEqual(len(k("GET", "/api/termine")[1]), vorher)
        # Liste und Loeschen (mit den Terminen des Links)
        self.assertEqual(len(a("GET", "/api/abos")[1]), 1)
        s, d, _ = a("DELETE", "/api/abos/%d" % abo["id"])
        self.assertEqual((s, d["geloeschte_termine"]), (200, vorher))
        self.assertEqual(k("GET", "/api/termine")[1], [])

    def test_link_falscher_inhalt(self):
        a, _, _ = self.konten()
        s, abo, _ = a("POST", "/api/abos", {"name": "Falsch", "url": self.link.replace("spielplan", "gibtsnicht")})
        self.assertEqual(s, 201)
        self.assertTrue(abo["last_status"].startswith("Abruf fehlgeschlagen"), abo["last_status"])
        TestKalenderServer.inhalt = b"<html>Keine Kalenderdatei</html>"
        s, abo, _ = a("POST", "/api/abos", {"name": "Webseite", "url": "webcal" + self.link[4:]})
        self.assertEqual(abo["url"], "https" + self.link[4:])  # webcal:// wird zu https://

    def test_abo_termine_alte_datenbank(self):
        # Datenbank ohne die neuen Spalten wird ergaenzt
        import sqlite3
        ordner = tempfile.mkdtemp()
        try:
            db = sqlite3.connect(os.path.join(ordner, "kalender.db"))
            db.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, start_date TEXT NOT NULL, "
                       "end_date TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 1, start_time TEXT, end_time TEXT, "
                       "location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', "
                       "repeat TEXT NOT NULL DEFAULT 'none', repeat_until TEXT, participants TEXT NOT NULL DEFAULT '[]', "
                       "created_by INTEGER, updated_by INTEGER, updated_at TEXT NOT NULL)")
            db.commit()
            db.close()
            fk.Datenbank(ordner)
            db = sqlite3.connect(os.path.join(ordner, "kalender.db"))
            spalten = [z[1] for z in db.execute("PRAGMA table_info(events)")]
            db.close()
            self.assertIn("uid", spalten)
            self.assertIn("abo_id", spalten)
        finally:
            shutil.rmtree(ordner)


if __name__ == "__main__":
    unittest.main()
