// Erzeugt die PNG-App-Symbole aus server/static/icon.svg (nach Aenderung am Symbol einmal ausfuehren).
// Aufruf: node werkzeuge/symbole_erzeugen.js server/static
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ordner = process.argv[2];
const svg = fs.readFileSync(path.join(ordner, "icon.svg"), "utf8").replace("<svg ", '<svg width="100%" height="100%" ');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const bild = async (groesse, datei, maskable) => {
    await p.setViewportSize({ width: groesse, height: groesse });
    // maskable: Hintergrund voll, Symbol in der sicheren Mitte (80 %)
    const html = maskable
      ? `<body style="margin:0;background:#002D72;display:flex;align-items:center;justify-content:center;width:${groesse}px;height:${groesse}px"><div style="width:62%;height:62%;background:#fff;border-radius:18%;padding:4%">${svg}</div></body>`
      : `<body style="margin:0;background:transparent;width:${groesse}px;height:${groesse}px">${svg}</body>`;
    await p.setContent(html);
    await p.screenshot({ path: path.join(ordner, datei), omitBackground: !maskable });
  };
  await bild(192, "icon-192.png");
  await bild(512, "icon-512.png");
  await bild(512, "icon-maskable-512.png", true);
  await b.close();
})();
