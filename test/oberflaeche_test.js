// Prueft die Handy-Oberflaeche im echten Browser (Chromium, Handy-Groesse).
// Start:  node test/oberflaeche_test.js [ordner-fuer-bildschirmfotos]
// Startet selbst einen Test-Server mit leerer Datenbank in einem Temp-Ordner.
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = "http://127.0.0.1:" + PORT + "/";
const fotos = process.argv[2];

async function warteAufServer() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL + "api/status"); return; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("Server startet nicht");
}

(async () => {
  const daten = fs.mkdtempSync(path.join(os.tmpdir(), "fk-test-"));
  const srv = spawn("python3", [path.join(__dirname, "..", "server", "server.py")], {
    env: Object.assign({}, process.env, { FK_PORT: String(PORT), FK_DATEN: daten, FK_HOST: "127.0.0.1", FK_LEISE: "1" }),
    stdio: "inherit",
  });
  const browser = await chromium.launch();
  const fehler = [];
  try {
    await warteAufServer();
    const handy = devices["Galaxy S9+"];
    const ctxA = await browser.newContext(Object.assign({}, handy, { locale: "de-DE" }));
    const a = await ctxA.newPage();
    a.on("pageerror", (e) => fehler.push(e.message));
    // erwartete Antworten wie 401 (noch nicht angemeldet) sind keine Fehler
    a.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]|ERR_INTERNET_DISCONNECTED/.test(m.text())) fehler.push(m.text()); });
    a.on("dialog", (d) => d.accept());
    await a.goto(URL);

    // 1. Erstes Profil = Verwalter
    await a.waitForSelector("#form-registrieren:not(.versteckt)");
    assert.match(await a.textContent("#login-hinweis"), /Verwalter/);
    if (fotos) await a.screenshot({ path: path.join(fotos, "1-registrieren.png") });
    await a.fill("#form-registrieren [name=display_name]", "Alex");
    await a.fill("#form-registrieren [name=username]", "alex");
    await a.fill("#form-registrieren [name=password]", "geheim123");
    await a.fill("#form-registrieren [name=password2]", "geheim123");
    await a.click("#form-registrieren button[type=submit]");
    await a.waitForSelector("#ansicht-kalender:not(.versteckt)");
    assert.strictEqual(await a.locator("#raster .tag").count(), 42);

    // 2. Termin anlegen (heute, mit Uhrzeit)
    await a.click("#neu");
    await a.fill("#form-termin [name=title]", "Elternabend");
    await a.uncheck("#form-termin [name=all_day]");
    await a.fill("#form-termin [name=start_time]", "19:00");
    await a.fill("#form-termin [name=end_time]", "20:30");
    await a.fill("#form-termin [name=location]", "Schule");
    // "Für wen?": neu ist niemand ausgewählt (= ganze Familie); Alex als Schild antippen
    assert.strictEqual(await a.locator("#teilnehmer input:checked").count(), 0);
    await a.click("#teilnehmer label.wahl:has-text('Alex')");
    assert.strictEqual(await a.locator("#teilnehmer input:checked").count(), 1);
    if (fotos) await a.screenshot({ path: path.join(fotos, "2-termin.png") });
    await a.click("#form-termin button[type=submit]");
    await a.waitForSelector("#tag-liste li:has-text('Elternabend')");
    assert.match(await a.textContent("#tag-liste"), /19:00–20:30 Uhr · Schule/);
    assert.strictEqual(await a.textContent("#tag-liste li .schild"), "Alex");
    assert.strictEqual(await a.locator("#raster .tag.heute .mini").count(), 1);

    // 2b. Wochenansicht: 7 Tage untereinander, Termin am heutigen Tag
    const heuteIso = await a.getAttribute("#raster .tag.heute", "data-tag");
    await a.click(".ansichten button[data-ansicht=woche]");
    await a.waitForSelector("#bereich-woche:not(.versteckt)");
    assert.strictEqual(await a.locator("#bereich-woche .woche-tag").count(), 7);
    assert.match(await a.textContent("#bereich-woche .woche-tag.heute"), /Elternabend.*19:00–20:30/);
    assert.match(await a.textContent("#bereich-woche .woche-tag >> nth=0"), /^Mo, /);
    if (fotos) await a.screenshot({ path: path.join(fotos, "7-woche.png") });
    const ersterTag = await a.getAttribute("#bereich-woche .woche-tag >> nth=0", "data-tag");
    await a.click("#monat-vor");
    const naechsterMontag = await a.getAttribute("#bereich-woche .woche-tag >> nth=0", "data-tag");
    assert.strictEqual((new Date(naechsterMontag) - new Date(ersterTag)) / 864e5, 7);
    await a.click("#heute");

    // 2c. Tagesansicht: Stundenplan, Termin als Block um 19 Uhr
    await a.click("#bereich-woche .woche-tag.heute h3");
    await a.waitForSelector("#bereich-tag:not(.versteckt)");
    assert.ok(await a.locator(".ansichten button[data-ansicht=tag].aktiv").count() === 1);
    const block = a.locator("#stunden .block", { hasText: "Elternabend" });
    assert.strictEqual(await block.count(), 1);
    const oben = await block.evaluate((b) => parseFloat(b.style.top));
    assert.ok(Math.abs(oben - 19 * 56) < 3, "Block steht nicht bei 19 Uhr: " + oben);
    const hoehe = await block.evaluate((b) => parseFloat(b.style.height));
    assert.ok(Math.abs(hoehe - 1.5 * 56) < 4, "Block ist nicht 1,5 Stunden hoch: " + hoehe);
    if (fotos) await a.screenshot({ path: path.join(fotos, "8-tag.png") });
    // Tippen auf 10 Uhr -> neuer Termin mit 10:00–11:00
    await a.click("#stunden .stunde[data-stunde='10'] span");
    assert.strictEqual(await a.inputValue("#form-termin [name=start_time]"), "10:00");
    assert.strictEqual(await a.inputValue("#form-termin [name=end_time]"), "11:00");
    assert.strictEqual(await a.isChecked("#form-termin [name=all_day]"), false);
    assert.strictEqual(await a.inputValue("#form-termin [name=start_date]"), heuteIso);
    await a.click("#termin-abbrechen");
    // ein Tag weiter: kein Elternabend
    await a.click("#monat-vor");
    assert.strictEqual(await a.locator("#stunden .block").count(), 0);
    // Ansicht wird gemerkt (nach Neuladen weiter Tagesansicht)
    await a.reload();
    await a.waitForSelector("#bereich-tag:not(.versteckt)");
    // zurück zur Monatsansicht, nochmal auf ausgewählten Tag tippen = Tagesansicht
    await a.click(".ansichten button[data-ansicht=monat]");
    await a.click("#heute");
    await a.click("#raster .tag.heute");
    await a.waitForSelector("#bereich-tag:not(.versteckt)");
    await a.click(".ansichten button[data-ansicht=monat]");
    await a.waitForSelector("#bereich-monat:not(.versteckt)");

    // 3. Geburtstag mit jährlicher Wiederholung -> erscheint im nächsten Jahr gleichen Monats
    await a.click("#neu");
    await a.fill("#form-termin [name=title]", "Test-Geburtstag");
    await a.fill("#form-termin [name=start_date]", "1950-01-15");
    await a.selectOption("#form-termin [name=repeat]", "yearly");
    await a.click("#form-termin button[type=submit]");
    await a.waitForTimeout(300);
    const jetzt = new Date();
    let schritte = (12 - jetzt.getMonth()) % 12; // bis zum nächsten Januar
    for (let i = 0; i < schritte; i++) await a.click("#monat-vor");
    assert.match(await a.textContent("#monat-titel"), /Jan\. /);
    assert.strictEqual(await a.locator("#raster .tag[data-tag$='-01-15'] .mini").count(), 1);
    await a.click("#heute");

    // 4. Zweite Person registriert sich -> muss warten
    const ctxB = await browser.newContext(Object.assign({}, handy, { locale: "de-DE" }));
    const b = await ctxB.newPage();
    b.on("pageerror", (e) => fehler.push(e.message));
    await b.goto(URL);
    await b.click("#zu-registrieren");
    await b.fill("#form-registrieren [name=display_name]", "Sam");
    await b.fill("#form-registrieren [name=username]", "sam");
    await b.fill("#form-registrieren [name=password]", "sam123456");
    await b.fill("#form-registrieren [name=password2]", "sam123456");
    await b.click("#form-registrieren button[type=submit]");
    await b.waitForSelector("#login-hinweis:has-text('freigeben')");
    await b.fill("#form-login [name=username]", "sam");
    await b.fill("#form-login [name=password]", "sam123456");
    await b.click("#form-login button[type=submit]");
    await b.waitForSelector("#login-fehler:has-text('Freigabe')");

    // 5. Verwalter gibt frei
    await a.click("#menue");
    await a.waitForSelector("#benutzer-liste li:has-text('Sam')");
    if (fotos) await a.screenshot({ path: path.join(fotos, "3-verwaltung.png") });
    await a.click("#benutzer-liste li:has-text('Sam') button:has-text('Freigeben')");
    await a.waitForSelector("#benutzer-liste li:has-text('Sam') .status.active");
    await a.click("#einst-zu");

    // 6. Sam kann sich anmelden und sieht den Termin
    await b.click("#form-login button[type=submit]");
    await b.waitForSelector("#ansicht-kalender:not(.versteckt)");
    await b.waitForSelector("#tag-liste li:has-text('Elternabend')");

    // 7. Sam ändert den Termin, Alex sieht das nach dem Neuladen
    await b.click("#tag-liste li:has-text('Elternabend')");
    await b.fill("#form-termin [name=title]", "Elternabend Klasse 3");
    await b.click("#teilnehmer label.wahl:has-text('Sam')"); // jetzt für zwei Personen
    await b.click("#form-termin button[type=submit]");
    await b.waitForSelector("#tag-liste li:has-text('Klasse 3')");
    assert.deepStrictEqual(await b.locator("#tag-liste li .schild").allTextContents(), ["Alex", "Sam"]);
    assert.strictEqual(await b.locator("#tag-liste li.bunt").count(), 1); // Streifen in beiden Farben
    if (fotos) await b.screenshot({ path: path.join(fotos, "12-schilder.png") });
    await a.reload();
    await a.waitForSelector("#tag-liste li:has-text('Klasse 3')");
    if (fotos) await a.screenshot({ path: path.join(fotos, "4-kalender.png") });

    // 8. Export funktioniert
    await a.click("#menue");
    const [download] = await Promise.all([a.waitForEvent("download"), a.click("#export")]);
    const inhalt = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    assert.strictEqual(inhalt.termine.length, 2);
    await a.click("#einst-zu");

    // 8b. Verwalter legt ein Familienmitglied direkt an -> Zugangsdaten + WhatsApp-Knopf
    await a.click("#menue");
    await a.fill("#form-mitglied [name=display_name]", "Kim Müller");
    assert.strictEqual(await a.inputValue("#form-mitglied [name=username]"), "kimmueller");
    await a.click("#form-mitglied button[type=submit]");
    await a.waitForSelector("#zugang:not(.versteckt)");
    const zugang = await a.textContent("#zugang-text");
    assert.match(zugang, /Benutzername: kimmueller/);
    assert.ok(zugang.includes(URL.replace(/\/$/, "")), "Link fehlt im Text");
    const startpw = zugang.match(/Startpasswort: (\S+)/)[1];
    assert.match(await a.getAttribute("#zugang-whatsapp", "href"), /^https:\/\/wa\.me\/\?text=Hallo%20Kim/);
    if (fotos) await a.screenshot({ path: path.join(fotos, "5-zugang.png") });
    await a.waitForSelector("#benutzer-liste li:has-text('Kim Müller') .status.active");
    await a.click("#zugang-zu");
    await a.click("#einst-zu");

    // 8c. Kim meldet sich mit Startpasswort an und muss eigenes Passwort wählen
    const ctxC = await browser.newContext(Object.assign({}, handy, { locale: "de-DE" }));
    const k = await ctxC.newPage();
    k.on("pageerror", (e) => fehler.push(e.message));
    await k.goto(URL);
    await k.fill("#form-login [name=username]", "kimmueller");
    await k.fill("#form-login [name=password]", startpw);
    await k.click("#form-login button[type=submit]");
    await k.waitForSelector("#dlg-erstpasswort[open]");
    await k.keyboard.press("Escape"); // darf nicht wegdrückbar sein
    assert.ok(await k.locator("#dlg-erstpasswort[open]").count() === 1);
    await k.fill("#form-erstpasswort [name=pw1]", "kims-eigenes-pw");
    await k.fill("#form-erstpasswort [name=pw2]", "kims-eigenes-pw");
    if (fotos) await k.screenshot({ path: path.join(fotos, "6-erstes-passwort.png") });
    await k.click("#form-erstpasswort button[type=submit]");
    await k.waitForSelector("#dlg-erstpasswort:not([open])", { state: "attached" });
    await k.waitForSelector("#tag-liste li:has-text('Klasse 3')");
    // nach Neuladen kein Passwort-Dialog mehr
    await k.reload();
    await k.waitForSelector("#ansicht-kalender:not(.versteckt)");
    await k.waitForTimeout(300);
    assert.strictEqual(await k.locator("#dlg-erstpasswort[open]").count(), 0);

    // 8d. Verbindung weg (z. B. unterwegs ohne WireGuard) -> oranger Hinweis, kommt sie wieder -> Hinweis weg
    assert.match(zugang, /gemeinsam ein/);
    assert.doesNotMatch(zugang, /Datei/);
    await ctxA.setOffline(true);
    await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await a.waitForSelector("#verbindung:not(.versteckt)");
    assert.match(await a.textContent("#verbindung"), /WireGuard/);
    if (fotos) await a.screenshot({ path: path.join(fotos, "11-keine-verbindung.png") });
    await ctxA.setOffline(false); // Handy meldet "wieder online" -> App sieht sofort nach, Hinweis verschwindet
    await a.waitForSelector("#verbindung.versteckt", { state: "attached" });
    // Knopf "Nochmal" prüft ebenfalls (Hinweis bleibt weg, weil Verbindung da ist)
    await a.evaluate(() => document.getElementById("verbindung-nochmal").click());
    await a.waitForTimeout(300);
    assert.strictEqual(await a.locator("#verbindung.versteckt").count(), 1);

    // 9. Löschen
    await a.click("#tag-liste li:has-text('Klasse 3')");
    await a.click("#termin-loeschen");
    await a.waitForSelector("#tag-liste li.leer");

    assert.deepStrictEqual(fehler, [], "Fehler im Browser: " + fehler.join(" | "));
    console.log("Oberflaechen-Test: alles OK");
  } catch (e) {
    console.error("Oberflaechen-Test FEHLGESCHLAGEN:", e.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(daten, { recursive: true, force: true });
  }
})();
