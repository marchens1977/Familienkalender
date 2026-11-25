#!/bin/bash
# Fuehrt alle automatischen Pruefungen aus. Aufruf: bash test/alle_tests.sh
set -e
cd "$(dirname "$0")/.."
echo "== Server-Tests =="; python3 -m unittest discover -s test
echo "== Skripte (Tippfehler-Pruefung) =="; for f in pi/*.sh; do bash -n "$f"; done; echo ok
echo "== Oberflaeche im Browser =="; node test/oberflaeche_test.js "$@"
