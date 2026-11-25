#!/usr/bin/env python3
"""Familienkalender - kleiner Server fuer den Raspberry Pi.

Nur Python-Standardbibliothek (keine Zusatzpakete noetig).
Daten liegen in einer SQLite-Datenbank AUSSERHALB des Projektordners
(Standard: ~/familienkalender-daten), damit nie Familiendaten auf GitHub landen.

Start:  python3 server.py
Einstellungen ueber Umgebungsvariablen:
  FK_PORT  (Standard 8502)
  FK_DATEN (Standard ~/familienkalender-daten)
  FK_HOST  (Standard 0.0.0.0)
"""

import datetime as dt
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HIER = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HIER, "static")

SESSION_TAGE = 90
SICHERUNGEN_BEHALTEN = 14
FARBEN = ["#FF5910", "#002D72", "#2ecc71", "#9b59b6", "#f39c12", "#1abc9c", "#e91e63", "#795548"]
WIEDERHOLUNG = ("none", "weekly", "monthly", "yearly")
COOKIE = "fk_sitzung"

STATIC_DATEIEN = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
    "/manifest.json": ("manifest.json", "application/manifest+json"),
}

DATUM = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ZEIT = re.compile(r"^\d{2}:\d{2}$")
BENUTZERNAME = re.compile(r"^[A-Za-z0-9._-]{3,30}$")
FARBE = re.compile(r"^#[0-9a-fA-F]{6}$")


# ---------------------------------------------------------------- Datenbank

class Datenbank:
    def __init__(self, ordner):
        self.ordner = ordner
        os.makedirs(ordner, exist_ok=True)
        try:
            os.chmod(ordner, 0o700)
        except OSError:
            pass
        self.pfad = os.path.join(ordner, "kalender.db")
        self.lock = threading.Lock()
        with self.verbindung() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    pw_hash TEXT NOT NULL,
                    color TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    all_day INTEGER NOT NULL DEFAULT 1,
                    start_time TEXT,
                    end_time TEXT,
                    location TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    repeat TEXT NOT NULL DEFAULT 'none',
                    repeat_until TEXT,
                    participants TEXT NOT NULL DEFAULT '[]',
                    created_by INTEGER,
                    updated_by INTEGER,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def verbindung(self):
        db = sqlite3.connect(self.pfad, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def sicherung(self):
        """Taegliche Kopie der Datenbank, die letzten 14 bleiben erhalten."""
        ziel_ordner = os.path.join(self.ordner, "sicherungen")
        os.makedirs(ziel_ordner, exist_ok=True)
        ziel = os.path.join(ziel_ordner, "kalender-%s.db" % dt.date.today().isoformat())
        if os.path.exists(ziel):
            return ziel
        quelle = self.verbindung()
        kopie = sqlite3.connect(ziel)
        with kopie:
            quelle.backup(kopie)
        kopie.close()
        quelle.close()
        alte = sorted(f for f in os.listdir(ziel_ordner) if f.startswith("kalender-") and f.endswith(".db"))
        for f in alte[:-SICHERUNGEN_BEHALTEN]:
            os.remove(os.path.join(ziel_ordner, f))
        return ziel


def passwort_hash(passwort):
    salz = secrets.token_bytes(16)
    h = hashlib.scrypt(passwort.encode(), salt=salz, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$%s$%s" % (salz.hex(), h.hex())


def passwort_pruefen(passwort, gespeichert):
    try:
        _, salz, h = gespeichert.split("$")
        neu = hashlib.scrypt(passwort.encode(), salt=bytes.fromhex(salz), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(neu.hex(), h)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def jetzt_text():
    return dt.datetime.now().isoformat(timespec="seconds")


class Fehler(Exception):
    def __init__(self, status, text):
        super().__init__(text)
        self.status = status
        self.text = text


# ---------------------------------------------------------------- Pruefungen

def text(wert, name, maximal, pflicht=False):
    if wert is None:
        wert = ""
    if not isinstance(wert, str):
        raise Fehler(400, "%s ist ungueltig." % name)
    wert = wert.strip()
    if pflicht and not wert:
        raise Fehler(400, "%s fehlt." % name)
    if len(wert) > maximal:
        raise Fehler(400, "%s ist zu lang (max. %d Zeichen)." % (name, maximal))
    return wert


def datum(wert, name):
    if not isinstance(wert, str) or not DATUM.match(wert):
        raise Fehler(400, "%s ist kein gueltiges Datum." % name)
    try:
        dt.date.fromisoformat(wert)
    except ValueError:
        raise Fehler(400, "%s ist kein gueltiges Datum." % name)
    return wert


def zeit(wert, name):
    if not isinstance(wert, str) or not ZEIT.match(wert):
        raise Fehler(400, "%s ist keine gueltige Uhrzeit." % name)
    h, m = map(int, wert.split(":"))
    if h > 23 or m > 59:
        raise Fehler(400, "%s ist keine gueltige Uhrzeit." % name)
    return wert


def passwort_regel(pw):
    if not isinstance(pw, str) or len(pw) < 8:
        raise Fehler(400, "Das Passwort muss mindestens 8 Zeichen haben.")
    if len(pw) > 200:
        raise Fehler(400, "Das Passwort ist zu lang.")
    return pw


def termin_aus_daten(d, gueltige_ids):
    if not isinstance(d, dict):
        raise Fehler(400, "Termin ist ungueltig.")
    t = {
        "title": text(d.get("title"), "Titel", 120, pflicht=True),
        "start_date": datum(d.get("start_date"), "Startdatum"),
        "location": text(d.get("location"), "Ort", 120),
        "notes": text(d.get("notes"), "Notiz", 2000),
        "all_day": 1 if d.get("all_day", True) else 0,
        "start_time": None,
        "end_time": None,
        "repeat": d.get("repeat") or "none",
        "repeat_until": None,
    }
    t["end_date"] = datum(d.get("end_date") or t["start_date"], "Enddatum")
    if t["end_date"] < t["start_date"]:
        raise Fehler(400, "Das Ende liegt vor dem Anfang.")
    if not t["all_day"]:
        t["start_time"] = zeit(d.get("start_time"), "Startzeit")
        t["end_time"] = zeit(d.get("end_time") or t["start_time"], "Endzeit")
        if t["end_date"] == t["start_date"] and t["end_time"] < t["start_time"]:
            raise Fehler(400, "Die Endzeit liegt vor der Startzeit.")
    if t["repeat"] not in WIEDERHOLUNG:
        raise Fehler(400, "Wiederholung ist ungueltig.")
    if t["repeat"] != "none" and d.get("repeat_until"):
        t["repeat_until"] = datum(d.get("repeat_until"), "Wiederholen bis")
    teilnehmer = d.get("participants") or []
    if not isinstance(teilnehmer, list):
        raise Fehler(400, "Teilnehmer ungueltig.")
    t["participants"] = json.dumps(sorted({int(x) for x in teilnehmer if isinstance(x, int) and x in gueltige_ids}))
    return t


def termin_json(r):
    return {
        "id": r["id"], "title": r["title"], "start_date": r["start_date"], "end_date": r["end_date"],
        "all_day": bool(r["all_day"]), "start_time": r["start_time"], "end_time": r["end_time"],
        "location": r["location"], "notes": r["notes"], "repeat": r["repeat"],
        "repeat_until": r["repeat_until"], "participants": json.loads(r["participants"]),
        "created_by": r["created_by"], "updated_by": r["updated_by"], "updated_at": r["updated_at"],
    }


def benutzer_json(r, mit_details=False):
    d = {"id": r["id"], "display_name": r["display_name"], "color": r["color"]}
    if mit_details:
        d.update(username=r["username"], role=r["role"], status=r["status"], created_at=r["created_at"])
    return d


# ---------------------------------------------------------------- Anmeldeschutz

class Bremse:
    """Begrenzt Fehlversuche beim Anmelden (pro Adresse)."""

    def __init__(self, maximal=10, fenster=15 * 60):
        self.maximal = maximal
        self.fenster = fenster
        self.versuche = {}
        self.lock = threading.Lock()

    def gesperrt(self, ip):
        with self.lock:
            liste = [t for t in self.versuche.get(ip, []) if t > time.time() - self.fenster]
            self.versuche[ip] = liste
            return len(liste) >= self.maximal

    def fehlschlag(self, ip):
        with self.lock:
            self.versuche.setdefault(ip, []).append(time.time())

    def erfolg(self, ip):
        with self.lock:
            self.versuche.pop(ip, None)


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "Familienkalender"
    sys_version = ""

    # Kurze Protokollzeilen ohne Inhalte
    def log_message(self, fmt, *args):
        if os.environ.get("FK_LEISE"):
            return
        super().log_message(fmt, *args)

    @property
    def db(self):
        return self.server.datenbank

    # -- Antworten
    def sicherheits_kopfzeilen(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )

    def antwort(self, status, daten=None, extra=None, roh=None, typ="application/json; charset=utf-8"):
        # Waehrend einer Datenbank-Aktion erst merken und nach dem Speichern senden
        if getattr(self, "puffer", None) is not None:
            self.puffer.append((status, daten, extra, roh, typ))
            return
        body = roh if roh is not None else json.dumps(daten if daten is not None else {}, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.sicherheits_kopfzeilen()
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json_lesen(self, maximal=5 * 1024 * 1024):
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge > maximal:
            raise Fehler(413, "Zu viele Daten.")
        roh = self.rfile.read(laenge) if laenge else b"{}"
        try:
            return json.loads(roh.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            raise Fehler(400, "Ungueltige Daten.")

    def sitzungs_token(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie") or "")
        except cookies.CookieError:
            return None
        return c[COOKIE].value if COOKIE in c else None

    def aktueller_benutzer(self, db):
        token = self.sitzungs_token()
        if not token:
            return None
        r = db.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash(token), time.time()),
        ).fetchone()
        if r is None or r["status"] != "active":
            return None
        return r

    def anmelden_pflicht(self, db, admin=False):
        u = self.aktueller_benutzer(db)
        if u is None:
            raise Fehler(401, "Bitte anmelden.")
        if admin and u["role"] != "admin":
            raise Fehler(403, "Nur fuer Verwalter.")
        return u

    def cookie_setzen(self, token, loeschen=False):
        wert = "%s=%s; Path=/; HttpOnly; SameSite=Strict" % (COOKIE, "" if loeschen else token)
        wert += "; Max-Age=%d" % (0 if loeschen else SESSION_TAGE * 86400)
        return ("Set-Cookie", wert)

    # -- Verteiler
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.verarbeiten("GET")

    def do_POST(self):
        self.verarbeiten("POST")

    def do_PUT(self):
        self.verarbeiten("PUT")

    def do_DELETE(self):
        self.verarbeiten("DELETE")

    def verarbeiten(self, methode):
        pfad = urlparse(self.path).path
        try:
            if not pfad.startswith("/api/"):
                if methode != "GET":
                    raise Fehler(405, "Nicht erlaubt.")
                return self.statisch(pfad)
            # Schutz gegen fremde Webseiten (CSRF): Schreibzugriffe brauchen diese Kopfzeile.
            if methode != "GET" and self.headers.get("X-Familienkalender") != "1":
                raise Fehler(403, "Anfrage abgelehnt.")
            self.puffer = []
            try:
                with self.db.lock:
                    db = self.db.verbindung()
                    try:
                        with db:  # speichert am Ende, bei Fehler wird alles zurueckgenommen
                            self.api(methode, pfad, db)
                    finally:
                        db.close()
                gemerkt = self.puffer
            finally:
                self.puffer = None
            for a in gemerkt:
                self.antwort(*a)
        except Fehler as f:
            self.antwort(f.status, {"fehler": f.text})
        except Exception as e:  # pragma: no cover - Notfall
            self.log_error("Fehler: %r", e)
            self.antwort(500, {"fehler": "Interner Fehler."})

    def statisch(self, pfad):
        if pfad not in STATIC_DATEIEN:
            raise Fehler(404, "Nicht gefunden.")
        datei, typ = STATIC_DATEIEN[pfad]
        with open(os.path.join(STATIC, datei), "rb") as f:
            self.antwort(200, roh=f.read(), typ=typ)

    # -- API
    def api(self, m, pfad, db):
        teile = pfad.strip("/").split("/")[1:]  # ohne "api"
        ip = self.client_address[0]

        if teile == ["status"] and m == "GET":
            anzahl = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            return self.antwort(200, {"hat_benutzer": anzahl > 0})

        if teile == ["registrieren"] and m == "POST":
            d = self.json_lesen()
            name = d.get("username") or ""
            if not isinstance(name, str) or not BENUTZERNAME.match(name):
                raise Fehler(400, "Benutzername: 3-30 Zeichen, nur Buchstaben, Ziffern, . _ -")
            anzeige = text(d.get("display_name"), "Anzeigename", 40, pflicht=True)
            pw = passwort_regel(d.get("password"))
            if db.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
                raise Fehler(409, "Diesen Benutzernamen gibt es schon.")
            anzahl = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            erster = anzahl == 0
            db.execute(
                "INSERT INTO users(username, display_name, pw_hash, color, role, status, created_at) VALUES(?,?,?,?,?,?,?)",
                (name, anzeige, passwort_hash(pw), FARBEN[anzahl % len(FARBEN)],
                 "admin" if erster else "member", "active" if erster else "pending", jetzt_text()),
            )
            return self.antwort(201, {"freigegeben": erster, "admin": erster})

        if teile == ["anmelden"] and m == "POST":
            if self.server.bremse.gesperrt(ip):
                raise Fehler(429, "Zu viele Fehlversuche. Bitte 15 Minuten warten.")
            d = self.json_lesen()
            r = db.execute("SELECT * FROM users WHERE username=?", (str(d.get("username") or ""),)).fetchone()
            if r is None or not passwort_pruefen(str(d.get("password") or ""), r["pw_hash"]):
                self.server.bremse.fehlschlag(ip)
                raise Fehler(401, "Benutzername oder Passwort falsch.")
            if r["status"] == "pending":
                raise Fehler(403, "Dein Konto wartet noch auf Freigabe durch den Verwalter.")
            if r["status"] != "active":
                raise Fehler(403, "Dein Konto ist gesperrt.")
            self.server.bremse.erfolg(ip)
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE expires_at<?", (time.time(),))
            db.execute("INSERT INTO sessions VALUES(?,?,?)",
                       (token_hash(token), r["id"], time.time() + SESSION_TAGE * 86400))
            return self.antwort(200, benutzer_json(r, True), extra=[self.cookie_setzen(token)])

        if teile == ["abmelden"] and m == "POST":
            token = self.sitzungs_token()
            if token:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))
            return self.antwort(200, {}, extra=[self.cookie_setzen("", loeschen=True)])

        # Ab hier: nur angemeldet
        u = self.anmelden_pflicht(db)

        if teile == ["ich"]:
            if m == "GET":
                return self.antwort(200, benutzer_json(u, True))
            if m == "PUT":
                d = self.json_lesen()
                anzeige = text(d.get("display_name", u["display_name"]), "Anzeigename", 40, pflicht=True)
                farbe = d.get("color", u["color"])
                if not isinstance(farbe, str) or not FARBE.match(farbe):
                    raise Fehler(400, "Farbe ist ungueltig.")
                db.execute("UPDATE users SET display_name=?, color=? WHERE id=?", (anzeige, farbe, u["id"]))
                if d.get("new_password"):
                    if not passwort_pruefen(str(d.get("old_password") or ""), u["pw_hash"]):
                        raise Fehler(400, "Das alte Passwort stimmt nicht.")
                    db.execute("UPDATE users SET pw_hash=? WHERE id=?",
                               (passwort_hash(passwort_regel(d["new_password"])), u["id"]))
                    # andere Geraete abmelden
                    db.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
                               (u["id"], token_hash(self.sitzungs_token())))
                r = db.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
                return self.antwort(200, benutzer_json(r, True))

        if teile == ["mitglieder"] and m == "GET":
            rows = db.execute("SELECT * FROM users WHERE status='active' ORDER BY display_name").fetchall()
            return self.antwort(200, [benutzer_json(r) for r in rows])

        if teile and teile[0] == "termine":
            return self.termine(m, teile, db, u)

        if teile == ["export"] and m == "GET":
            rows = db.execute("SELECT * FROM events ORDER BY start_date").fetchall()
            mitglieder = db.execute("SELECT * FROM users WHERE status='active'").fetchall()
            daten = {
                "app": "Familienkalender", "version": 1, "exportiert_am": jetzt_text(),
                "mitglieder": [benutzer_json(r) for r in mitglieder],
                "termine": [termin_json(r) for r in rows],
            }
            roh = json.dumps(daten, ensure_ascii=False, indent=1).encode()
            name = "familienkalender-%s.json" % dt.date.today().isoformat()
            return self.antwort(200, roh=roh, extra=[("Content-Disposition", 'attachment; filename="%s"' % name)])

        if teile == ["import"] and m == "POST":
            if u["role"] != "admin":
                raise Fehler(403, "Nur fuer Verwalter.")
            d = self.json_lesen()
            liste = d.get("termine") if isinstance(d, dict) else None
            if not isinstance(liste, list):
                raise Fehler(400, "Das ist keine Familienkalender-Sicherung.")
            ids = {r[0] for r in db.execute("SELECT id FROM users WHERE status='active'")}
            neu = doppelt = 0
            for e in liste:
                t = termin_aus_daten(e, ids)
                gibt_es = db.execute(
                    "SELECT 1 FROM events WHERE title=? AND start_date=? AND IFNULL(start_time,'')=IFNULL(?,'')",
                    (t["title"], t["start_date"], t["start_time"])).fetchone()
                if gibt_es:
                    doppelt += 1
                    continue
                self.termin_speichern(db, t, u["id"])
                neu += 1
            return self.antwort(200, {"neu": neu, "uebersprungen": doppelt})

        if teile and teile[0] == "admin":
            if u["role"] != "admin":
                raise Fehler(403, "Nur fuer Verwalter.")
            return self.verwaltung(m, teile, db, u)

        raise Fehler(404, "Unbekannte Anfrage.")

    def termin_speichern(self, db, t, benutzer_id, termin_id=None):
        felder = ["title", "start_date", "end_date", "all_day", "start_time", "end_time",
                  "location", "notes", "repeat", "repeat_until", "participants"]
        werte = [t[f] for f in felder]
        if termin_id is None:
            cur = db.execute(
                "INSERT INTO events(%s, created_by, updated_by, updated_at) VALUES(%s)"
                % (",".join(felder), ",".join("?" * (len(felder) + 3))),
                werte + [benutzer_id, benutzer_id, jetzt_text()])
            return cur.lastrowid
        db.execute("UPDATE events SET %s, updated_by=?, updated_at=? WHERE id=?"
                   % ",".join("%s=?" % f for f in felder),
                   werte + [benutzer_id, jetzt_text(), termin_id])
        return termin_id

    def termine(self, m, teile, db, u):
        ids = {r[0] for r in db.execute("SELECT id FROM users WHERE status='active'")}
        if len(teile) == 1:
            if m == "GET":
                rows = db.execute("SELECT * FROM events ORDER BY start_date, start_time").fetchall()
                return self.antwort(200, [termin_json(r) for r in rows])
            if m == "POST":
                t = termin_aus_daten(self.json_lesen(), ids)
                neu = self.termin_speichern(db, t, u["id"])
                r = db.execute("SELECT * FROM events WHERE id=?", (neu,)).fetchone()
                return self.antwort(201, termin_json(r))
        if len(teile) == 2 and teile[1].isdigit():
            tid = int(teile[1])
            if not db.execute("SELECT 1 FROM events WHERE id=?", (tid,)).fetchone():
                raise Fehler(404, "Termin nicht gefunden.")
            if m == "PUT":
                t = termin_aus_daten(self.json_lesen(), ids)
                self.termin_speichern(db, t, u["id"], tid)
                r = db.execute("SELECT * FROM events WHERE id=?", (tid,)).fetchone()
                return self.antwort(200, termin_json(r))
            if m == "DELETE":
                db.execute("DELETE FROM events WHERE id=?", (tid,))
                return self.antwort(200, {})
        raise Fehler(404, "Unbekannte Anfrage.")

    def verwaltung(self, m, teile, db, u):
        if teile == ["admin", "benutzer"] and m == "GET":
            rows = db.execute("SELECT * FROM users ORDER BY status='active', created_at").fetchall()
            return self.antwort(200, [benutzer_json(r, True) for r in rows])
        if len(teile) == 3 and teile[1] == "benutzer" and teile[2].isdigit():
            bid = int(teile[2])
            ziel = db.execute("SELECT * FROM users WHERE id=?", (bid,)).fetchone()
            if ziel is None:
                raise Fehler(404, "Benutzer nicht gefunden.")
            if bid == u["id"]:
                raise Fehler(400, "Das eigene Konto kann hier nicht geaendert werden.")
            if m == "DELETE":
                db.execute("DELETE FROM users WHERE id=?", (bid,))
                return self.antwort(200, {})
            if m == "POST":
                d = self.json_lesen()
                aktion = d.get("aktion")
                if aktion == "freigeben":
                    db.execute("UPDATE users SET status='active' WHERE id=?", (bid,))
                elif aktion == "sperren":
                    db.execute("UPDATE users SET status='disabled' WHERE id=?", (bid,))
                    db.execute("DELETE FROM sessions WHERE user_id=?", (bid,))
                elif aktion == "zum_verwalter":
                    db.execute("UPDATE users SET role='admin' WHERE id=?", (bid,))
                elif aktion == "zum_mitglied":
                    db.execute("UPDATE users SET role='member' WHERE id=?", (bid,))
                elif aktion == "passwort":
                    db.execute("UPDATE users SET pw_hash=? WHERE id=?",
                               (passwort_hash(passwort_regel(d.get("password"))), bid))
                    db.execute("DELETE FROM sessions WHERE user_id=?", (bid,))
                else:
                    raise Fehler(400, "Unbekannte Aktion.")
                r = db.execute("SELECT * FROM users WHERE id=?", (bid,)).fetchone()
                return self.antwort(200, benutzer_json(r, True))
        raise Fehler(404, "Unbekannte Anfrage.")


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, adresse, datenordner):
        self.datenbank = Datenbank(datenordner)
        self.bremse = Bremse()
        super().__init__(adresse, Handler)


def sicherungs_schleife(datenbank):
    while True:
        try:
            datenbank.sicherung()
        except Exception as e:  # pragma: no cover
            print("Sicherung fehlgeschlagen:", e, flush=True)
        time.sleep(6 * 3600)


def main():
    port = int(os.environ.get("FK_PORT", "8502"))
    host = os.environ.get("FK_HOST", "0.0.0.0")
    daten = os.path.expanduser(os.environ.get("FK_DATEN", "~/familienkalender-daten"))
    server = Server((host, port), daten)
    threading.Thread(target=sicherungs_schleife, args=(server.datenbank,), daemon=True).start()
    print("Familienkalender laeuft auf Port %d, Daten in %s" % (port, daten), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
