// Prueft die verschluesselte Variante im echten Browser (Chromium, Handy-Format) mit Test-Zertifikat:
// alte Adresse -> Weiterleitung auf die https-Adresse, Anmeldung, Installierbarkeit (Chrome-Pruefung),
// WhatsApp-Text mit neuem Link, Seite "Keine Verbindung" wenn der Server aus ist.
// Start:  node test/https_oberflaeche_test.js [ordner-fuer-bildschirmfotos]
const { chromium, devices } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");

// Hinweis: In der Cloud-Testumgebung kann der Browser keine erfundenen Namen auf den eigenen Rechner umleiten.
// Darum ergeben hier Unter-Name "127" + Domain "0.0.1" zusammen die Adresse 127.0.0.1.
// Echte Namen + echte Zertifikatspruefung testet test/test_https.py.
const NAME = "127.0.0.1";
const HTTP = 19000 + Math.floor(Math.random() * 500), HTTPS = HTTP + 500;
const fotos = process.argv[2];

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fk-https-"));
  const z = path.join(tmp, "zertifikate"), zd = path.join(z, "0.0.1");
  fs.mkdirSync(zd, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-days", "2", "-subj", "/CN=beispiel.test", "-addext", "subjectAltName=DNS:beispiel.test,DNS:*.beispiel.test",
    "-keyout", path.join(zd, "privkey.pem"), "-out", path.join(zd, "fullchain.pem")], { stdio: "ignore" });
  fs.writeFileSync(path.join(z, "domain"), "0.0.1\n");
  const start = () => spawn("python3", [path.join(__dirname, "..", "server", "server.py")], {
    env: Object.assign({}, process.env, { FK_PORT: String(HTTP), FK_HTTPS_PORT: String(HTTPS), FK_HOST: "127.0.0.1",
      FK_ZERTIFIKATE: z, FK_NAME: "127", FK_DATEN: path.join(tmp, "daten"), FK_LEISE: "1" }), stdio: "inherit" });
  let srv = start();
  const browser = await chromium.launch({ args: ["--ignore-certificate-errors", "--no-proxy-server"] });
  const fehler = [];
  try {
    for (let i = 0; i < 50; i++) { try { await fetch("http://127.0.0.1:" + HTTP + "/api/status"); break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
    const ctx = await browser.newContext(Object.assign({}, devices["Galaxy S9+"], { locale: "de-DE", ignoreHTTPSErrors: true }));
    const a = await ctx.newPage();
    a.on("pageerror", (e) => fehler.push(e.message));
    a.on("dialog", (d) => d.accept());

    // 1. alte Adresse -> neue verschluesselte Adresse
    await a.goto("http://127.0.0.1:" + HTTP + "/");
    assert.strictEqual(new URL(a.url()).origin, "https://" + NAME + ":" + HTTPS, "keine Weiterleitung: " + a.url());

    // 2. Anmeldung (erstes Profil = Verwalter) klappt verschluesselt
    await a.waitForSelector("#form-registrieren:not(.versteckt)");
    await a.fill("#form-registrieren [name=display_name]", "Alex");
    await a.fill("#form-registrieren [name=username]", "alex");
    await a.fill("#form-registrieren [name=password]", "geheim123");
    await a.fill("#form-registrieren [name=password2]", "geheim123");
    await a.click("#form-registrieren button[type=submit]");
    await a.waitForSelector("#ansicht-kalender:not(.versteckt)");
    const cookies = await ctx.cookies();
    assert.ok(cookies.find((c) => c.name === "fk_sitzung").secure, "Cookie nicht 'Secure'");

    // 3. Installierbar? Hintergrund-Helfer aktiv + Chrome meldet keine Hinderungsgründe
    const swOk = await a.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
    assert.ok(swOk, "Service Worker nicht aktiv");
    const cdp = await ctx.newCDPSession(a);
    const inst = await cdp.send("Page.getInstallabilityErrors");
    assert.deepStrictEqual(inst.installabilityErrors.map((e) => e.errorId), [], "nicht installierbar");
    const man = await cdp.send("Page.getAppManifest");
    assert.deepStrictEqual(man.errors, [], "Manifest-Fehler");

    // 4. WhatsApp-Text enthält den neuen Link
    await a.click("#menue");
    await a.fill("#form-mitglied [name=display_name]", "Kim");
    await a.click("#form-mitglied button[type=submit]");
    await a.waitForSelector("#zugang:not(.versteckt)");
    const text = await a.textContent("#zugang-text");
    assert.ok(text.includes("https://" + NAME + ":" + HTTPS), "neuer Link fehlt");
    assert.match(text, /Installieren/);
    await a.click("#zugang-zu");
    await a.click("#einst-zu");

    // 5. Installier-Hinweis erscheint, wenn Chrome das Installieren anbietet
    await a.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; e.userChoice = Promise.resolve({}); window.dispatchEvent(e); });
    await a.waitForSelector("#installieren:not(.versteckt)");
    if (fotos) await a.screenshot({ path: path.join(fotos, "9-installieren.png") });
    await a.click("#installieren-nein");
    await a.reload();
    await a.waitForSelector("#ansicht-kalender:not(.versteckt)");
    await a.evaluate(() => { const e = new Event("beforeinstallprompt"); window.dispatchEvent(e); });
    assert.strictEqual(await a.locator("#installieren.versteckt").count(), 1, "'Nicht jetzt' wird nicht gemerkt");

    // 6. Pi aus -> freundliche Seite "Keine Verbindung"
    srv.kill(); await new Promise((r) => srv.on("exit", r));
    await a.reload().catch(() => {});
    await a.waitForSelector("text=Keine Verbindung");
    // Gestaltung kommt aus dem Zwischenspeicher (Überschrift in Mets-Blau)
    await a.waitForFunction(() => getComputedStyle(document.querySelector("h1")).color === "rgb(0, 45, 114)");
    if (fotos) await a.screenshot({ path: path.join(fotos, "10-offline.png") });
    srv = start();

    assert.deepStrictEqual(fehler, [], "Fehler im Browser: " + fehler.join(" | "));
    console.log("https-Oberflaechen-Test: alles OK");
  } catch (e) {
    console.error("https-Oberflaechen-Test FEHLGESCHLAGEN:", e.stack);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
