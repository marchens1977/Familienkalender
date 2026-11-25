"""Automatische Pruefung des Servers (Schnittstelle, Rechte, Sicherung).

Start:  python3 -m unittest discover -s test -v
Laeuft mit einer leeren Test-Datenbank in einem Temp-Ordner, echte Daten werden nie beruehrt.
"""

import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest

os.environ["FK_LEISE"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import server as fk  # noqa: E402


class Client:
    def __init__(self, port):
        self.port = port
        self.cookie = None

    def __call__(self, methode, pfad, daten=None, kopf=True):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {}
        if kopf:
            h["X-Familienkalender"] = "1"
        if self.cookie:
            h["Cookie"] = self.cookie
        body = None
        if daten is not None:
            body = json.dumps(daten)
            h["Content-Type"] = "application/json"
        c.request(methode, pfad, body=body, headers=h)
        r = c.getresponse()
        roh = r.read()
        sc = r.getheader("Set-Cookie")
        if sc:
            wert = sc.split(";")[0]
            self.cookie = None if wert.endswith("=") else wert
        try:
            inhalt = json.loads(roh) if roh else None
        except ValueError:
            inhalt = roh
        c.close()
        return r.status, inhalt, r


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.ordner = tempfile.mkdtemp()
        self.srv = fk.Server(("127.0.0.1", 0), self.ordner)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        shutil.rmtree(self.ordner)

    def neu(self):
        return Client(self.port)

    def konto(self, name, pw="geheim123", anmelden=True):
        c = self.neu()
        s, d, _ = c("POST", "/api/registrieren", {"username": name, "display_name": name.title(), "password": pw})
        self.assertEqual(s, 201, d)
        if anmelden:
            s, d, _ = c("POST", "/api/anmelden", {"username": name, "password": pw})
        return c, s, d

    def test_startseite_und_dateien(self):
        c = self.neu()
        for p in ["/", "/app.js", "/style.css", "/icon.svg", "/manifest.json"]:
            s, _, r = c("GET", p)
            self.assertEqual(s, 200, p)
            self.assertIn("default-src 'self'", r.getheader("Content-Security-Policy"))
        self.assertEqual(c("GET", "/../server.py")[0], 404)
        self.assertEqual(c("GET", "/server.py")[0], 404)

    def test_erster_wird_verwalter_weitere_warten(self):
        self.assertFalse(self.neu()("GET", "/api/status")[1]["hat_benutzer"])
        admin, s, d = self.konto("alex")
        self.assertEqual(s, 200)
        self.assertEqual(d["role"], "admin")
        self.assertEqual(d["status"], "active")
        # zweites Konto: wartet auf Freigabe, Anmeldung verweigert
        kim, s, d = self.konto("kim")
        self.assertEqual(s, 403)
        self.assertIn("Freigabe", d["fehler"])
        self.assertEqual(kim("GET", "/api/termine")[0], 401)
        # Verwalter gibt frei
        liste = admin("GET", "/api/admin/benutzer")[1]
        kim_id = [b for b in liste if b["username"] == "kim"][0]["id"]
        self.assertEqual(admin("POST", "/api/admin/benutzer/%d" % kim_id, {"aktion": "freigeben"})[0], 200)
        s, d, _ = kim("POST", "/api/anmelden", {"username": "kim", "password": "geheim123"})
        self.assertEqual(s, 200)
        self.assertEqual(d["role"], "member")
        # Mitglied darf nicht verwalten oder importieren
        self.assertEqual(kim("GET", "/api/admin/benutzer")[0], 403)
        self.assertEqual(kim("POST", "/api/import", {"termine": []})[0], 403)
        # Sperren wirft sofort raus
        admin("POST", "/api/admin/benutzer/%d" % kim_id, {"aktion": "sperren"})
        self.assertEqual(kim("GET", "/api/termine")[0], 401)
        s, d, _ = kim("POST", "/api/anmelden", {"username": "kim", "password": "geheim123"})
        self.assertEqual(s, 403)

    def test_doppelter_name_und_regeln(self):
        self.konto("alex")
        c = self.neu()
        self.assertEqual(c("POST", "/api/registrieren", {"username": "ALEX", "display_name": "x", "password": "geheim123"})[0], 409)
        self.assertEqual(c("POST", "/api/registrieren", {"username": "a b", "display_name": "x", "password": "geheim123"})[0], 400)
        self.assertEqual(c("POST", "/api/registrieren", {"username": "kurzpw", "display_name": "x", "password": "123"})[0], 400)

    def test_falsches_passwort_und_bremse(self):
        self.konto("alex", anmelden=False)
        c = self.neu()
        for _ in range(10):
            self.assertEqual(c("POST", "/api/anmelden", {"username": "alex", "password": "falsch"})[0], 401)
        self.assertEqual(c("POST", "/api/anmelden", {"username": "alex", "password": "geheim123"})[0], 429)

    def test_schutz_gegen_fremde_seiten(self):
        admin, _, _ = self.konto("alex")
        s, _, _ = admin("POST", "/api/termine", {"title": "x", "start_date": "2026-12-01"}, kopf=False)
        self.assertEqual(s, 403)
        _, _, r = self.neu()("POST", "/api/anmelden", {"username": "alex", "password": "geheim123"})
        cookie = r.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)

    def test_termine_anlegen_aendern_loeschen(self):
        admin, _, ich = self.konto("alex")
        s, t, _ = admin("POST", "/api/termine", {
            "title": "Zahnarzt", "start_date": "2026-12-03", "all_day": False,
            "start_time": "09:30", "end_time": "10:00", "participants": [ich["id"], 999]})
        self.assertEqual(s, 201, t)
        self.assertEqual(t["participants"], [ich["id"]])  # unbekannte Person wird entfernt
        self.assertEqual(t["end_date"], "2026-12-03")
        s, t2, _ = admin("PUT", "/api/termine/%d" % t["id"], dict(t, title="Zahnarzt neu"))
        self.assertEqual(s, 200)
        self.assertEqual(t2["title"], "Zahnarzt neu")
        self.assertEqual(len(admin("GET", "/api/termine")[1]), 1)
        self.assertEqual(admin("DELETE", "/api/termine/%d" % t["id"])[0], 200)
        self.assertEqual(admin("GET", "/api/termine")[1], [])
        self.assertEqual(admin("DELETE", "/api/termine/%d" % t["id"])[0], 404)

    def test_termin_pruefungen(self):
        admin, _, _ = self.konto("alex")
        falsch = [
            {"start_date": "2026-12-01"},
            {"title": "x", "start_date": "2026-13-01"},
            {"title": "x", "start_date": "2026-12-05", "end_date": "2026-12-01"},
            {"title": "x", "start_date": "2026-12-05", "all_day": False, "start_time": "25:00"},
            {"title": "x", "start_date": "2026-12-05", "all_day": False, "start_time": "10:00", "end_time": "09:00"},
            {"title": "x", "start_date": "2026-12-05", "repeat": "taeglich"},
            {"title": "x" * 200, "start_date": "2026-12-05"},
        ]
        for d in falsch:
            self.assertEqual(admin("POST", "/api/termine", d)[0], 400, d)

    def test_profil_und_passwort(self):
        admin, _, _ = self.konto("alex")
        s, d, _ = admin("PUT", "/api/ich", {"display_name": "Testname", "color": "#123456"})
        self.assertEqual((s, d["display_name"], d["color"]), (200, "Testname", "#123456"))
        self.assertEqual(admin("PUT", "/api/ich", {"color": "rot"})[0], 400)
        self.assertEqual(admin("PUT", "/api/ich", {"display_name": "Falsch", "new_password": "neuespw123",
                                                   "old_password": "falsch"})[0], 400)
        self.assertEqual(admin("GET", "/api/ich")[1]["display_name"], "Testname")  # bei Fehler nichts gespeichert
        self.assertEqual(admin("PUT", "/api/ich", {"new_password": "neuespw123", "old_password": "geheim123"})[0], 200)
        self.assertEqual(admin("GET", "/api/ich")[0], 200)  # eigene Sitzung bleibt
        self.assertEqual(self.neu()("POST", "/api/anmelden", {"username": "alex", "password": "neuespw123"})[0], 200)

    def test_abmelden(self):
        admin, _, _ = self.konto("alex")
        admin("POST", "/api/abmelden")
        self.assertEqual(admin("GET", "/api/ich")[0], 401)

    def test_export_import(self):
        admin, _, ich = self.konto("alex")
        admin("POST", "/api/termine", {"title": "Test-Geburtstag", "start_date": "1950-05-04", "repeat": "yearly"})
        admin("POST", "/api/termine", {"title": "Urlaub", "start_date": "2027-07-01", "end_date": "2027-07-14"})
        s, roh, r = admin("GET", "/api/export")
        self.assertEqual(s, 200)
        self.assertIn("attachment", r.getheader("Content-Disposition"))
        self.assertEqual(len(roh["termine"]), 2)
        # gleicher Import nochmal: nichts doppelt
        s, d, _ = admin("POST", "/api/import", roh)
        self.assertEqual((s, d["neu"], d["uebersprungen"]), (200, 0, 2))
        # Import in leeren Kalender
        for t in admin("GET", "/api/termine")[1]:
            admin("DELETE", "/api/termine/%d" % t["id"])
        s, d, _ = admin("POST", "/api/import", roh)
        self.assertEqual(d["neu"], 2)
        self.assertEqual(admin("POST", "/api/import", {"foo": 1})[0], 400)

    def test_verwalter_aktionen(self):
        admin, _, ich = self.konto("alex")
        self.konto("sam", anmelden=False)
        sam_id = [b for b in admin("GET", "/api/admin/benutzer")[1] if b["username"] == "sam"][0]["id"]
        self.assertEqual(admin("POST", "/api/admin/benutzer/%d" % ich["id"], {"aktion": "sperren"})[0], 400)
        admin("POST", "/api/admin/benutzer/%d" % sam_id, {"aktion": "freigeben"})
        admin("POST", "/api/admin/benutzer/%d" % sam_id, {"aktion": "passwort", "password": "sam123456"})
        sam = self.neu()
        self.assertEqual(sam("POST", "/api/anmelden", {"username": "sam", "password": "sam123456"})[0], 200)
        admin("POST", "/api/admin/benutzer/%d" % sam_id, {"aktion": "zum_verwalter"})
        self.assertEqual(sam("GET", "/api/admin/benutzer")[0], 200)
        self.assertEqual(admin("POST", "/api/admin/benutzer/%d" % sam_id, {"aktion": "quatsch"})[0], 400)
        self.assertEqual(admin("DELETE", "/api/admin/benutzer/%d" % sam_id)[0], 200)
        self.assertEqual(sam("GET", "/api/termine")[0], 401)

    def test_sicherung(self):
        admin, _, _ = self.konto("alex")
        admin("POST", "/api/termine", {"title": "x", "start_date": "2026-12-01"})
        pfad = self.srv.datenbank.sicherung()
        self.assertTrue(os.path.exists(pfad))
        import sqlite3
        db = sqlite3.connect(pfad)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
