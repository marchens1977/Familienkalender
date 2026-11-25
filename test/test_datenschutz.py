"""Datenschutz-Pruefung: Im (oeffentlichen) Repository duerfen keine privaten Daten stehen.

Prueft alle Dateien, die Git verwaltet, auf:
  - Heimnetz-Adressen (private IPv4-Bereiche), ausser 127.0.0.1 / 0.0.0.0
  - E-Mail-Adressen
  - Geraete-Kennungen (MAC-Adressen)
  - Datenbank-Dateien (echte Kalenderdaten)
Start:  python3 -m unittest discover -s test
"""

import os
import re
import subprocess
import unittest

WURZEL = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

MUSTER = {
    "Heimnetz-Adresse": re.compile(
        r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b"),
    "E-Mail-Adresse": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}\b", re.I),
    "Geraete-Kennung (MAC)": re.compile(r"\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b", re.I),
}


def dateien():
    aus = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=WURZEL, capture_output=True, text=True, check=True).stdout
    return [f for f in aus.splitlines() if f and os.path.isfile(os.path.join(WURZEL, f))]


class Datenschutz(unittest.TestCase):
    def test_keine_privaten_daten(self):
        funde = []
        for f in dateien():
            if f.endswith((".db", ".sqlite", ".db-wal")):
                funde.append("%s: Datenbank-Datei gehoert nicht ins Repository" % f)
                continue
            try:
                with open(os.path.join(WURZEL, f), encoding="utf-8") as h:
                    zeilen = h.readlines()
            except UnicodeDecodeError:
                continue
            for nr, zeile in enumerate(zeilen, 1):
                for name, muster in MUSTER.items():
                    for treffer in muster.findall(zeile):
                        funde.append("%s:%d: %s gefunden: %s" % (f, nr, name, treffer))
        self.assertEqual(funde, [], "\n" + "\n".join(funde))


if __name__ == "__main__":
    unittest.main()
