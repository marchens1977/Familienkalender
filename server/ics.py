"""Lesen und Schreiben von Kalender-Dateien im Standardformat iCalendar (.ics).

Nur Python-Standardbibliothek. Dieses Format koennen fast alle Kalender (Google, Apple, Outlook,
Spielplan-Abos ...) exportieren bzw. als Link anbieten.

lesen(text)      -> (termine, hinweise)   termine im Format des Familienkalenders
schreiben(liste) -> text                  .ics-Datei aus Terminen des Familienkalenders

Grenzen (bewusst einfach gehalten, weil der Familienkalender nur einfache Wiederholungen kennt):
- Wiederholungen: jede Woche / jeden Monat / jedes Jahr (mit "bis" oder Anzahl). Andere Regeln
  (z. B. taeglich, alle 2 Wochen) werden als einzelner Termin uebernommen und gezaehlt.
- Einzelne geaenderte oder ausgelassene Termine einer Serie werden nicht uebernommen.
- Abgesagte Termine (STATUS:CANCELLED) werden uebersprungen.
"""

import datetime as dt
import re

ZEITZONE = "Europe/Berlin"

try:
    from zoneinfo import ZoneInfo
    _BERLIN = ZoneInfo(ZEITZONE)
except Exception:  # pragma: no cover - ohne Zeitzonen-Daten: eigene Regel unten
    ZoneInfo = None
    _BERLIN = None


# ---------------------------------------------------------------- Zeitzonen

def _letzter_sonntag(jahr, monat):
    d = dt.date(jahr, monat, 31)
    return d - dt.timedelta(days=(d.weekday() + 1) % 7)


def _utc_nach_berlin_ohne_zoneinfo(utc):
    """Mitteleuropaeische Zeit: Sommerzeit vom letzten Sonntag im Maerz bis letzten Sonntag im Oktober (je 01:00 UTC)."""
    beginn = dt.datetime.combine(_letzter_sonntag(utc.year, 3), dt.time(1))
    ende = dt.datetime.combine(_letzter_sonntag(utc.year, 10), dt.time(1))
    return utc + dt.timedelta(hours=2 if beginn <= utc < ende else 1)


def nach_berlin(zeit, tzid=None, utc=False):
    """Wandelt eine Uhrzeit (ohne Zeitzone) in deutsche Ortszeit um. Ohne Angabe bleibt sie wie sie ist."""
    if utc:
        if _BERLIN is not None:
            return zeit.replace(tzinfo=dt.timezone.utc).astimezone(_BERLIN).replace(tzinfo=None)
        return _utc_nach_berlin_ohne_zoneinfo(zeit)
    if tzid and _BERLIN is not None:
        tzid = tzid.strip('"')
        if tzid in (ZEITZONE, "W. Europe Standard Time", "Europe/Brussels", "Europe/Paris", "Europe/Amsterdam",
                    "Europe/Vienna", "Europe/Zurich"):
            return zeit  # gleiche Zeit wie in Deutschland
        try:
            return zeit.replace(tzinfo=ZoneInfo(tzid)).astimezone(_BERLIN).replace(tzinfo=None)
        except Exception:
            return zeit  # unbekannte Zeitzone: Uhrzeit so lassen
    return zeit


# ---------------------------------------------------------------- Lesen

def _zeilen(text):
    """Entfaltet umbrochene Zeilen (Fortsetzung beginnt mit Leerzeichen oder Tab)."""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    zeilen = []
    for z in text.split("\n"):
        if z[:1] in (" ", "\t") and zeilen:
            zeilen[-1] += z[1:]
        elif z.strip():
            zeilen.append(z)
    return zeilen


def _eigenschaft(zeile):
    """'DTSTART;TZID=Europe/Berlin:20261201T100000' -> ('DTSTART', {'TZID': 'Europe/Berlin'}, '2026...')"""
    in_anf = False
    for i, c in enumerate(zeile):
        if c == '"':
            in_anf = not in_anf
        elif c == ":" and not in_anf:
            kopf, wert = zeile[:i], zeile[i + 1:]
            break
    else:
        return None
    teile = kopf.split(";")
    params = {}
    for p in teile[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.upper()] = v
    return teile[0].upper(), params, wert


def _text(wert):
    aus = []
    i = 0
    while i < len(wert):
        c = wert[i]
        if c == "\\" and i + 1 < len(wert):
            n = wert[i + 1]
            aus.append("\n" if n in "nN" else n)
            i += 2
            continue
        aus.append(c)
        i += 1
    return "".join(aus).strip()


def _zeitpunkt(wert, params):
    """-> (datum, uhrzeit oder None) in deutscher Zeit"""
    wert = wert.strip()
    if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", wert):
        return dt.datetime.strptime(wert[:8], "%Y%m%d").date(), None
    m = re.fullmatch(r"(\d{8})T(\d{4})(\d{2})?(Z?)", wert)
    if not m:
        raise ValueError("Zeitangabe unbekannt: " + wert)
    z = dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M")
    z = nach_berlin(z, params.get("TZID"), utc=bool(m.group(4)))
    return z.date(), z.time()


def _dauer(wert):
    m = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", wert.strip())
    if not m:
        return None
    w, d, h, mi, s = (int(x or 0) for x in m.groups()[1:])
    return dt.timedelta(weeks=w, days=d, hours=h, minutes=mi, seconds=s)


def _monate_plus(datum, n):
    m = datum.month - 1 + n
    j = datum.year + m // 12
    m = m % 12 + 1
    tag = min(datum.day, [31, 29 if j % 4 == 0 and (j % 100 or j % 400 == 0) else 28, 31, 30, 31, 30,
                          31, 31, 30, 31, 30, 31][m - 1])
    return dt.date(j, m, tag)


WOCHENTAGE = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def _wiederholung(regel, start):
    """RRULE -> (repeat, repeat_until) oder None, wenn der Familienkalender das nicht abbilden kann."""
    teile = {}
    for p in regel.split(";"):
        if "=" in p:
            k, v = p.split("=", 1)
            teile[k.upper()] = v.upper()
    art = {"WEEKLY": "weekly", "MONTHLY": "monthly", "YEARLY": "yearly"}.get(teile.get("FREQ"))
    if not art or teile.get("INTERVAL", "1") != "1":
        return None
    erlaubt = {"FREQ", "INTERVAL", "UNTIL", "COUNT", "WKST", "BYDAY", "BYMONTHDAY", "BYMONTH"}
    if set(teile) - erlaubt:
        return None
    if "BYDAY" in teile and (art != "weekly" or teile["BYDAY"] != WOCHENTAGE[start.weekday()]):
        return None
    if "BYMONTHDAY" in teile and teile["BYMONTHDAY"] != str(start.day):
        return None
    if "BYMONTH" in teile and (art != "yearly" or teile["BYMONTH"] != str(start.month)):
        return None
    bis = None
    if "UNTIL" in teile:
        bis = _zeitpunkt(teile["UNTIL"], {})[0]
    elif "COUNT" in teile:
        n = max(int(teile["COUNT"]) - 1, 0) if teile["COUNT"].isdigit() else 0
        if art == "weekly":
            bis = start + dt.timedelta(weeks=n)
        elif art == "monthly":
            bis = _monate_plus(start, n)
        else:
            bis = _monate_plus(start, 12 * n)
    return art, (bis.isoformat() if bis else None)


def _termin(e):
    """Ein VEVENT (Liste von Eigenschaften) -> Termin-Daten, 'abgesagt', 'einzeln' oder None"""
    werte = {}
    for name, params, wert in e:
        werte.setdefault(name, (params, wert))
    if "RECURRENCE-ID" in werte:
        return "einzeln"
    if werte.get("STATUS", ({}, ""))[1].strip().upper() == "CANCELLED":
        return "abgesagt"
    if "DTSTART" not in werte:
        return None
    s_datum, s_zeit = _zeitpunkt(werte["DTSTART"][1], werte["DTSTART"][0])
    e_datum, e_zeit = s_datum, s_zeit
    if "DTEND" in werte:
        e_datum, e_zeit = _zeitpunkt(werte["DTEND"][1], werte["DTEND"][0])
    elif "DURATION" in werte and _dauer(werte["DURATION"][1]) is not None:
        ende = dt.datetime.combine(s_datum, s_zeit or dt.time()) + _dauer(werte["DURATION"][1])
        e_datum, e_zeit = ende.date(), (ende.time() if s_zeit else None)
        if s_zeit is None and ende.date() > s_datum:
            e_datum = ende.date()
    ganztags = s_zeit is None
    if ganztags:
        # Ende ist bei ganztaegigen Terminen "exklusiv" (Termin am 1.12. endet am 2.12.)
        if "DTEND" in werte or "DURATION" in werte:
            e_datum = e_datum - dt.timedelta(days=1)
        e_datum = max(e_datum, s_datum)
    elif e_zeit is None:
        e_zeit = s_zeit
    if not ganztags:
        ende = dt.datetime.combine(e_datum, e_zeit)
        if ende < dt.datetime.combine(s_datum, s_zeit):
            e_datum, e_zeit = s_datum, s_zeit
        elif e_zeit == dt.time(0, 0) and e_datum > s_datum:
            # endet um Mitternacht -> im Kalender bis 23:59 am Vortag
            e_datum, e_zeit = e_datum - dt.timedelta(days=1), dt.time(23, 59)
    titel = _text(werte.get("SUMMARY", ({}, ""))[1]) or "(ohne Titel)"
    t = {
        "title": titel[:120],
        "start_date": s_datum.isoformat(),
        "end_date": e_datum.isoformat(),
        "all_day": ganztags,
        "start_time": None if ganztags else s_zeit.strftime("%H:%M"),
        "end_time": None if ganztags else e_zeit.strftime("%H:%M"),
        "location": _text(werte.get("LOCATION", ({}, ""))[1])[:120],
        "notes": _text(werte.get("DESCRIPTION", ({}, ""))[1])[:2000],
        "repeat": "none",
        "repeat_until": None,
        "uid": _text(werte.get("UID", ({}, ""))[1])[:300] or None,
        "vereinfacht": False,
    }
    if "RRULE" in werte:
        w = _wiederholung(werte["RRULE"][1], s_datum)
        if w is None:
            t["vereinfacht"] = True
        else:
            t["repeat"], t["repeat_until"] = w
            if t["repeat_until"] and t["repeat_until"] < t["start_date"]:
                t["repeat"], t["repeat_until"] = "none", None
    return t


def lesen(text):
    """Liest eine .ics-Datei. Gibt (termine, hinweise) zurueck.

    hinweise = {"abgesagt": n, "einzeln": n, "fehlerhaft": n, "vereinfacht": n}
    Wirft ValueError, wenn es gar keine Kalender-Datei ist.
    """
    zeilen = _zeilen(text)
    if not any(z.strip().upper() == "BEGIN:VCALENDAR" for z in zeilen[:50]):
        raise ValueError("Das ist keine Kalender-Datei (.ics).")
    termine = []
    hinweise = {"abgesagt": 0, "einzeln": 0, "fehlerhaft": 0, "vereinfacht": 0}
    aktuell = None
    tiefe = 0
    for z in zeilen:
        e = _eigenschaft(z)
        if e is None:
            continue
        name, _, wert = e
        if name == "BEGIN":
            if wert.strip().upper() == "VEVENT" and aktuell is None:
                aktuell, tiefe = [], 0
            elif aktuell is not None:
                tiefe += 1  # z. B. Erinnerung (VALARM) im Termin
            continue
        if name == "END" and aktuell is not None:
            if tiefe:
                tiefe -= 1
                continue
            try:
                t = _termin(aktuell)
            except (ValueError, OverflowError):
                t = None
            if t is None:
                hinweise["fehlerhaft"] += 1
            elif isinstance(t, str):
                hinweise[t] += 1
            else:
                hinweise["vereinfacht"] += t.pop("vereinfacht")
                termine.append(t)
            aktuell = None
            continue
        if aktuell is not None and not tiefe:
            aktuell.append(e)
    return termine, hinweise


def text_aus_bytes(roh):
    for kodierung in ("utf-8-sig", "cp1252"):
        try:
            return roh.decode(kodierung)
        except UnicodeDecodeError:
            continue
    return roh.decode("latin-1")


# ---------------------------------------------------------------- Schreiben

VTIMEZONE = [
    "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
    "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET",
    "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
]


def _esc(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _falten(zeile):
    """Zeilen laenger als 75 Byte umbrechen (Regel des Formats), ohne Umlaute zu zerteilen."""
    aus, rest, grenze = [], zeile, 75
    while len(rest.encode()) > grenze:
        n = grenze
        while len(rest[:n].encode()) > grenze:
            n -= 1
        aus.append(rest[:n])
        rest = " " + rest[n:]
        grenze = 75
    aus.append(rest)
    return "\r\n".join(aus)


def schreiben(termine, name="Familienkalender", jetzt=None):
    jetzt = (jetzt or dt.datetime.now(dt.timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    z = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Familienkalender//DE", "CALSCALE:GREGORIAN",
         "METHOD:PUBLISH", "X-WR-CALNAME:" + _esc(name), "X-WR-TIMEZONE:" + ZEITZONE] + VTIMEZONE
    for t in termine:
        s = t["start_date"].replace("-", "")
        z += ["BEGIN:VEVENT", "UID:" + _esc(t.get("uid") or "familienkalender-%s" % t["id"]), "DTSTAMP:" + jetzt]
        if t["all_day"]:
            ende = (dt.date.fromisoformat(t["end_date"]) + dt.timedelta(days=1)).strftime("%Y%m%d")
            z += ["DTSTART;VALUE=DATE:" + s, "DTEND;VALUE=DATE:" + ende]
        else:
            z += ["DTSTART;TZID=%s:%sT%s00" % (ZEITZONE, s, t["start_time"].replace(":", "")),
                  "DTEND;TZID=%s:%sT%s00" % (ZEITZONE, t["end_date"].replace("-", ""),
                                             (t["end_time"] or t["start_time"]).replace(":", ""))]
        z.append("SUMMARY:" + _esc(t["title"]))
        if t.get("location"):
            z.append("LOCATION:" + _esc(t["location"]))
        if t.get("notes"):
            z.append("DESCRIPTION:" + _esc(t["notes"]))
        if t.get("repeat") in ("weekly", "monthly", "yearly"):
            regel = "RRULE:FREQ=" + t["repeat"].upper()
            if t.get("repeat_until"):
                bis = t["repeat_until"].replace("-", "")
                regel += ";UNTIL=" + (bis if t["all_day"] else bis + "T225959Z")
            z.append(regel)
        z.append("END:VEVENT")
    z.append("END:VCALENDAR")
    return "\r\n".join(_falten(x) for x in z) + "\r\n"
