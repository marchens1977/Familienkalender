#!/bin/bash
# Fuehrt alle automatischen Pruefungen aus. Aufruf: bash test/alle_tests.sh
set -e
# bricht beim ersten Fehler ab
cd "$(dirname "$0")/.."
echo "== Server-Tests =="; python3 -m unittest discover -s test
echo "== Skripte (Tippfehler-Pruefung) =="; for f in pi/*.sh; do bash -n "$f"; done; echo ok
echo "== Oberflaeche im Browser =="; node test/oberflaeche_test.js "$@"
echo "== Andere Kalender (.ics) und Kalender-Links im Browser =="; node test/ics_oberflaeche_test.js "$@"
echo "== Verschluesselte Variante (https) im Browser =="; node test/https_oberflaeche_test.js "$@"
