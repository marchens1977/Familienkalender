"""Prueft pi/auto_aktualisieren.sh ohne echten Pi.

Baut ein Test-"GitHub" (lokales Git-Repository) und ersetzt systemctl, runuser und curl durch
Attrappen. Faelle: nichts Neues / gute neue Version / kaputte neue Version (-> Rueckkehr zur alten).
Start:  python3 -m unittest discover -s test
"""

import os
import shutil
import subprocess
import tempfile
import unittest

SKRIPT = os.path.join(os.path.dirname(__file__), "..", "pi", "auto_aktualisieren.sh")


def git(*args, cwd):
    return subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
                          cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class AutoUpdate(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp()
        self.quelle = os.path.join(self.t, "quelle")
        os.makedirs(os.path.join(self.quelle, "pi"))
        shutil.copy(SKRIPT, os.path.join(self.quelle, "pi"))
        git("init", "-q", "-b", "main", cwd=self.quelle)
        git("add", ".", cwd=self.quelle)
        git("commit", "-qm", "v1", cwd=self.quelle)
        self.pi = os.path.join(self.t, "pi-ordner")
        git("clone", "-q", self.quelle, self.pi, cwd=self.t)
        # Attrappen
        self.bin = os.path.join(self.t, "bin")
        os.makedirs(self.bin)
        self.protokoll = os.path.join(self.t, "neustarts.txt")
        self.attrappe("systemctl", 'echo "$@" >> %s' % self.protokoll)
        self.attrappe("runuser", 'shift 3; exec "$@"')  # runuser -u NAME -- befehl...
        self.attrappe("curl", '[ -e %s/KAPUTT ] && exit 7; exit 0' % self.pi)
        self.attrappe("sleep", "exit 0")

    def tearDown(self):
        shutil.rmtree(self.t)

    def attrappe(self, name, inhalt):
        p = os.path.join(self.bin, name)
        with open(p, "w") as f:
            f.write("#!/bin/bash\n" + inhalt + "\n")
        os.chmod(p, 0o755)

    def lauf(self):
        env = dict(os.environ, PATH=self.bin + os.pathsep + os.environ["PATH"])
        return subprocess.run(["bash", os.path.join(self.pi, "pi", "auto_aktualisieren.sh")],
                              env=env, capture_output=True, text=True)

    def neustarts(self):
        if not os.path.exists(self.protokoll):
            return 0
        return len(open(self.protokoll).read().splitlines())

    def neue_version(self, datei, nachricht):
        open(os.path.join(self.quelle, datei), "w").write("x")
        git("add", ".", cwd=self.quelle)
        git("commit", "-qm", nachricht, cwd=self.quelle)
        return git("rev-parse", "HEAD", cwd=self.quelle)

    def test_nichts_neues(self):
        r = self.lauf()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.neustarts(), 0)

    def test_gute_version(self):
        neu = self.neue_version("neu.txt", "v2")
        r = self.lauf()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Update erfolgreich", r.stdout)
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.pi), neu)
        self.assertEqual(self.neustarts(), 1)

    def test_kaputte_version_wird_zurueckgenommen(self):
        alt = git("rev-parse", "HEAD", cwd=self.pi)
        self.neue_version("KAPUTT", "v2 kaputt")
        r = self.lauf()
        self.assertEqual(r.returncode, 1)
        self.assertIn("gehe zurueck", r.stdout)
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.pi), alt)
        self.assertFalse(os.path.exists(os.path.join(self.pi, "KAPUTT")))
        self.assertEqual(self.neustarts(), 2)


if __name__ == "__main__":
    unittest.main()
