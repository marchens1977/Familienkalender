// Familienkalender - Hintergrund-Helfer (Service Worker)
// Macht die Web-App installierbar. Speichert KEINE Termine, nur die Seite "Keine Verbindung".
// Alles andere kommt immer frisch vom Pi (wichtig fuer automatische Updates).
const SPEICHER = "fk-offline-2";
const OFFLINE_DATEIEN = ["/offline.html", "/style.css", "/icon-192.png"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(SPEICHER).then((c) => c.addAll(OFFLINE_DATEIEN)));
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((namen) =>
    Promise.all(namen.filter((n) => n !== SPEICHER).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  // Nur beim Öffnen der Seite eingreifen: ist der Pi nicht erreichbar, freundliche Hinweis-Seite zeigen
  if (ev.request.mode === "navigate") {
    ev.respondWith(fetch(ev.request).catch(() => caches.match("/offline.html")));
    return;
  }
  // Gestaltung + Symbol für die Hinweis-Seite: immer frisch vom Pi, nur ohne Verbindung aus dem Speicher
  const pfad = new URL(ev.request.url).pathname;
  if (ev.request.method === "GET" && OFFLINE_DATEIEN.includes(pfad)) {
    ev.respondWith(fetch(ev.request).catch(() => caches.match(pfad)));
  }
});
