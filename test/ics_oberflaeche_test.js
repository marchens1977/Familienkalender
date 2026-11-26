// Prueft im echten Browser (Chromium, Handy-Groesse): .ics importieren, .ics exportieren, Kalender-Link (Abo).
// Start:  node test/ics_oberflaeche_test.js [ordner-fuer-bildschirmfotos]
// Startet einen Test-Server mit leerer Datenbank und einen kleinen "Spielplan-Server" auf diesem Rechner.
// Nur erfundene Termine.
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const PORT = 19000 + Math.floor(Math.random() * 1000);
const URL = "http://127.0.0.1:" + PORT + "/";
const fotos = process.argv[2];

function tag(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10).replace(/-/g, ""); }

const DATEI = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//DE",
  "BEGIN:VEVENT", "UID:t1@test", "DTSTART;VALUE=DATE:" + tag(2), "SUMMARY:Ausflug Zoo", "END:VEVENT",
  "BEGIN:VEVENT", "UID:t2@test", "DTSTART;TZID=Europe/Berlin:" + tag(3) + "T100000",
  "DTEND;TZID=Europe/Berlin:" + tag(3) + "T113000", "SUMMARY:Kinderarzt", "LOCATION:Praxis", "END:VEVENT",
  "BEGIN:VEVENT", "UID:t3@test", "DTSTART;VALUE=DATE:" + tag(4), "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Ferienkurs", "END:VEVENT",
  "END:VCALENDAR", ""].join("\r\n");

const SPIELPLAN = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//DE",
  "BEGIN:VEVENT", "UID:s1@test", "DTSTART;TZID=Europe/Berlin:" + tag(5) + "T153000",
  "DTEND;TZID=Europe/Berlin:" + tag(5) + "T173000", "SUMMARY:Testverein - Gastmannschaft", "END:VEVENT",
  "BEGIN:VEVENT", "UID:s2@test", "DTSTART;TZID=Europe/Berlin:" + tag(12) + "T183000",
  "SUMMARY:Auswärtsverein - Testverein", "END:VEVENT",
  "END:VCALENDAR", ""].join("\r\n");

async function warteAufServer() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL + "api/status"); return; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("Server startet nicht");
}

(async () => {
  const daten = fs.mkdtempSync(path.join(os.tmpdir(), "fk-test-"));
  const datei = path.join(daten, "export-aus-anderem-kalender.ics");
  fs.writeFileSync(datei, DATEI);
  const spielplan = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/calendar" });
    res.end(SPIELPLAN);
  });
  await new Promise((r) => spielplan.listen(0, "127.0.0.1", r));
  const link = "http://127.0.0.1:" + spielplan.address().port + "/spielplan.ics";
  const env = Object.assign({}, process.env, { FK_PORT: String(PORT), FK_DATEN: daten, FK_HOST: "127.0.0.1", FK_LEISE: "1" });
  env.no_proxy = env.NO_PROXY = "127.0.0.1,localhost";
  const srv = spawn("python3", [path.join(__dirname, "..", "server", "server.py")], { env, stdio: "inherit" });
  const browser = await chromium.launch();
  const fehler = [];
  const dialoge = [];
  try {
    await warteAufServer();
    const ctx = await browser.newContext(Object.assign({}, devices["Galaxy S9+"], { locale: "de-DE", acceptDownloads: true }));
    const a = await ctx.newPage();
    a.on("pageerror", (e) => fehler.push(e.message));
    a.on("console", (m) => { if (m.type() === "error" && !/status of 401/.test(m.text())) fehler.push(m.text()); });
    a.on("dialog", (d) => { dialoge.push(d.message()); d.accept(); });
    await a.goto(URL);

    // Verwalter anlegen
    await a.waitForSelector("#form-registrieren:not(.versteckt)");
    await a.fill("#form-registrieren [name=display_name]", "Alex");
    await a.fill("#form-registrieren [name=username]", "alex");
    await a.fill("#form-registrieren [name=password]", "geheim123");
    await a.fill("#form-registrieren [name=password2]", "geheim123");
    await a.click("#form-registrieren button[type=submit]");
    await a.waitForSelector("#ansicht-kalender:not(.versteckt)");

    // 1. .ics-Datei importieren: erst Vorschau-Frage, dann Ergebnis
    await a.click("#menue");
    await a.waitForSelector("#import-ics-knopf:not(.versteckt)");
    await a.setInputFiles("#import-ics-datei", datei);
    await a.waitForFunction(() => /importiert/.test(document.querySelector("#import-ics-meldung").textContent));
    assert.match(dialoge[0], /3 neue Termine gefunden/);
    assert.match(dialoge[0], /übernehmen\?/);
    const meldung = await a.textContent("#import-ics-meldung");
    assert.match(meldung, /3 Termine importiert/);
    assert.match(meldung, /1 mit besonderer Wiederholung/);
    if (fotos) await a.screenshot({ path: path.join(fotos, "ics-1-import.png") });
    // nochmal dieselbe Datei -> nichts doppelt, keine Frage
    await a.setInputFiles("#import-ics-datei", datei);
    await a.waitForFunction(() => /Keine neuen Termine/.test(document.querySelector("#import-ics-meldung").textContent));
    assert.match(await a.textContent("#import-ics-meldung"), /3 schon vorhanden/);
    assert.strictEqual(dialoge.length, 1);

    // 2. Kalender-Link anlegen -> Termine sofort da, Liste zeigt Status
    await a.fill("#form-abo [name=name]", "Testverein");
    await a.fill("#form-abo [name=url]", link);
    await a.check("#abo-teilnehmer input");
    await a.click("#form-abo button[type=submit]");
    await a.waitForFunction(() => /Gespeichert/.test(document.querySelector("#abo-meldung").textContent));
    assert.match(await a.textContent("#abo-meldung"), /2 Termine eingetragen/);
    await a.waitForSelector("#abo-liste li:has-text('Testverein')");
    assert.match(await a.textContent("#abo-liste li"), /2 Termine/);
    assert.match(await a.textContent("#abo-liste li"), /2 neu/);
    await a.click("#abo-liste li button:has-text('Jetzt abrufen')");
    await a.waitForFunction(() => /0 neu/.test(document.querySelector("#abo-liste li").textContent));
    await a.locator("#form-abo").scrollIntoViewIfNeeded();
    if (fotos) await a.screenshot({ path: path.join(fotos, "ics-2-kalender-link.png") });

    // 3. Export als .ics enthält alles
    const [download] = await Promise.all([a.waitForEvent("download"), a.click("#export-ics")]);
    const ics = fs.readFileSync(await download.path(), "utf8");
    assert.match(ics, /^BEGIN:VCALENDAR/);
    for (const t of ["Ausflug Zoo", "Kinderarzt", "Ferienkurs", "Testverein - Gastmannschaft"]) assert.ok(ics.includes(t), t);
    assert.match(download.suggestedFilename(), /\.ics$/);
    await a.click("#einst-zu");

    // 4. Termine erscheinen in "Demnächst", Termin aus Link zeigt Hinweis
    await a.waitForSelector("#demnaechst li:has-text('Kinderarzt')");
    await a.click("#demnaechst li:has-text('Gastmannschaft')");
    await a.waitForSelector("#dlg-termin[open]");
    assert.match(await a.textContent("#termin-info"), /Kalender-Link „Testverein“/);
    await a.click("#termin-abbrechen");

    // 5. Link löschen -> seine Termine sind weg, importierte bleiben
    await a.click("#menue");
    await a.click("#abo-liste li button:has-text('Löschen')");
    await a.waitForSelector("#abo-liste li", { state: "detached" });
    assert.match(dialoge[dialoge.length - 1], /2 Termine/);
    await a.click("#einst-zu");
    await a.waitForSelector("#demnaechst li:has-text('Gastmannschaft')", { state: "detached" });
    await a.waitForSelector("#demnaechst li:has-text('Kinderarzt')");

    assert.deepStrictEqual(fehler, [], "Fehler im Browser: " + fehler.join(" | "));
    console.log("ics-Oberflaechen-Test: alles OK");
  } catch (e) {
    console.error("ics-Oberflaechen-Test FEHLGESCHLAGEN:", e.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    spielplan.close();
    fs.rmSync(daten, { recursive: true, force: true });
  }
})();
