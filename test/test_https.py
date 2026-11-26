"""Prueft den https-Betrieb mit einem selbst erzeugten Test-Zertifikat (erfundene Domain).

- Zertifikat wird nur genutzt, wenn FK_ZERTIFIKATE gesetzt ist (setzt pi/installieren.sh)
- verschluesselte Verbindung, Cookie mit "Secure"
- alte http-Adresse leitet weiter (Seiten, API, Status fuer offene alte Seiten)
- kaputtes Zertifikat: Kalender laeuft trotzdem weiter (http)
- Installier-Dateien (Manifest, Service Worker, Symbole) werden ausgeliefert
Start:  python3 -m unittest discover -s test
"""

import http.client
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

os.environ["FK_LEISE"] = "1"
HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, "..", "server"))
import server as fk  # noqa: E402

DOMAIN = "beispiel.test"
NAME = "kalender." + DOMAIN


def zertifikat_anlegen(ordner):
    z = os.path.join(ordner, DOMAIN)
    os.makedirs(z)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-nodes", "-days", "2", "-subj", "/CN=" + DOMAIN,
                    "-addext", "subjectAltName=DNS:%s,DNS:*.%s" % (DOMAIN, DOMAIN),
                    "-keyout", os.path.join(z, "privkey.pem"), "-out", os.path.join(z, "fullchain.pem")],
                   check=True, capture_output=True)
    with open(os.path.join(ordner, "domain"), "w") as f:
        f.write(DOMAIN + "\n")
    return os.path.join(z, "fullchain.pem"), os.path.join(z, "privkey.pem")


class HttpsTest(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp()
        self.zert = os.path.join(self.t, "zertifikate")
        self.kette, self.schluessel = zertifikat_anlegen(self.zert)
        self.alt = {k: os.environ.get(k) for k in ("FK_ZERTIFIKATE", "FK_HTTPS", "FK_NAME")}
        self.server = []

    def tearDown(self):
        for s in self.server:
            s.shutdown()
            s.server_close()
        for k, v in self.alt.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.t)

    def starten(self, srv):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.server.append(srv)
        return srv.server_address[1]

    def https_anfrage(self, port, methode, pfad, daten=None, cookie=None):
        kontext = ssl.create_default_context(cafile=self.kette)
        kontext.check_hostname = False  # wir verbinden ueber 127.0.0.1, die Kette wird trotzdem geprueft
        c = http.client.HTTPSConnection("127.0.0.1", port, context=kontext, timeout=10)
        h = {"X-Familienkalender": "1"}
        if cookie:
            h["Cookie"] = cookie
        body = json.dumps(daten) if daten is not None else None
        if body:
            h["Content-Type"] = "application/json"
        c.request(methode, pfad, body=body, headers=h)
        r = c.getresponse()
        roh = r.read()
        c.close()
        return r, roh

    def test_einstellungen(self):
        os.environ.pop("FK_ZERTIFIKATE", None)
        self.assertIsNone(fk.https_einstellungen(), "ohne Installationsskript kein https")
        os.environ["FK_ZERTIFIKATE"] = self.zert
        name, kette, schluessel = fk.https_einstellungen()
        self.assertEqual(name, NAME)
        self.assertEqual(kette, self.kette)
        os.environ["FK_NAME"] = "familie"
        self.assertEqual(fk.https_einstellungen()[0], "familie." + DOMAIN)
        os.environ["FK_HTTPS"] = "0"
        self.assertIsNone(fk.https_einstellungen())
        os.environ["FK_HTTPS"] = "1"
        with open(os.path.join(self.zert, "domain"), "w") as f:
            f.write("../boese")
        self.assertIsNone(fk.https_einstellungen())

    def test_verschluesselt_mit_sicherem_cookie(self):
        daten = os.path.join(self.t, "daten")
        port = self.starten(fk.Server(("127.0.0.1", 0), daten, fk.ssl_kontext_bauen(self.kette, self.schluessel)))
        # unverschluesselte Anfrage an den https-Anschluss darf den Server nicht stoeren
        s = socket.create_connection(("127.0.0.1", port), timeout=5)
        s.sendall(b"GET / HTTP/1.0\r\n\r\n")
        s.close()
        r, _ = self.https_anfrage(port, "GET", "/")
        self.assertEqual(r.status, 200)
        r, _ = self.https_anfrage(port, "POST", "/api/registrieren",
                                  {"username": "alex", "display_name": "Alex", "password": "geheim123"})
        self.assertEqual(r.status, 201)
        r, _ = self.https_anfrage(port, "POST", "/api/anmelden", {"username": "alex", "password": "geheim123"})
        cookie = r.getheader("Set-Cookie")
        self.assertIn("Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        r, roh = self.https_anfrage(port, "GET", "/api/ich", cookie=cookie.split(";")[0])
        self.assertEqual((r.status, json.loads(roh)["username"]), (200, "alex"))

    def test_http_cookie_ohne_secure(self):
        port = self.starten(fk.Server(("127.0.0.1", 0), os.path.join(self.t, "daten")))
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        h = {"X-Familienkalender": "1", "Content-Type": "application/json"}
        c.request("POST", "/api/registrieren", json.dumps({"username": "alex", "display_name": "A", "password": "geheim123"}), h)
        c.getresponse().read()
        c.request("POST", "/api/anmelden", json.dumps({"username": "alex", "password": "geheim123"}), h)
        r = c.getresponse()
        r.read()
        self.assertNotIn("Secure", r.getheader("Set-Cookie"))

    def test_alte_adresse_leitet_weiter(self):
        port = self.starten(fk.UmleitungsServer(("127.0.0.1", 0), "https://" + NAME + "/"))
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", "/")
        r = c.getresponse(); r.read()
        self.assertEqual((r.status, r.getheader("Location")), (302, "https://%s/" % NAME))
        c.request("GET", "/app.js")
        r = c.getresponse(); r.read()
        self.assertEqual(r.getheader("Location"), "https://%s/app.js" % NAME)
        c.request("GET", "/irgendwas/../geheim")
        r = c.getresponse(); r.read()
        self.assertEqual(r.getheader("Location"), "https://%s/" % NAME)
        c.request("GET", "/api/status")
        r = c.getresponse()
        d = json.loads(r.read())
        self.assertEqual((r.status, d["umzug"]), (200, "https://" + NAME))
        c.request("POST", "/api/termine", "{}", {"Content-Type": "application/json"})
        r = c.getresponse()
        d = json.loads(r.read())
        self.assertEqual((r.status, d["umzug"]), (409, "https://" + NAME))

    def test_kaputtes_zertifikat_rueckfall_auf_http(self):
        with open(self.schluessel, "w") as f:
            f.write("kaputt")
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        s = socket.socket(); s.bind(("127.0.0.1", 0)); https_port = s.getsockname()[1]; s.close()
        env = dict(os.environ, FK_ZERTIFIKATE=self.zert, FK_PORT=str(port), FK_HTTPS_PORT=str(https_port),
                   FK_HOST="127.0.0.1", FK_DATEN=os.path.join(self.t, "daten2"))
        p = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server", "server.py")], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for _ in range(50):
                try:
                    c = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                    c.request("GET", "/api/status")
                    r = c.getresponse()
                    d = json.loads(r.read())
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                self.fail("Server startet nicht")
            self.assertEqual(r.status, 200)
            self.assertNotIn("umzug", d)  # normaler Kalender, keine Weiterleitung
        finally:
            p.terminate()
            ausgabe = p.communicate(timeout=5)[0]
        self.assertIn("laufe weiter mit http", ausgabe)

    def test_installier_dateien(self):
        port = self.starten(fk.Server(("127.0.0.1", 0), os.path.join(self.t, "daten")))
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", "/manifest.json")
        r = c.getresponse()
        m = json.loads(r.read())
        self.assertEqual(m["display"], "standalone")
        groessen = {(i["sizes"], i.get("purpose", "any")) for i in m["icons"]}
        self.assertTrue({("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")} <= groessen)
        for i in m["icons"]:
            c.request("GET", i["src"])
            r = c.getresponse(); inhalt = r.read()
            self.assertEqual(r.status, 200, i["src"])
            if i["src"].endswith(".png"):
                self.assertEqual(inhalt[:8], b"\x89PNG\r\n\x1a\n")
        c.request("GET", "/sw.js")
        r = c.getresponse(); inhalt = r.read().decode()
        self.assertEqual(r.getheader("Service-Worker-Allowed"), "/")
        self.assertIn('addEventListener("fetch"', inhalt)
        c.request("GET", "/offline.html")
        r = c.getresponse(); self.assertIn("WireGuard", r.read().decode())


if __name__ == "__main__":
    unittest.main()
