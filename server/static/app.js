"use strict";
/* Familienkalender - Oberflaeche (laeuft im Handy-Browser, Daten kommen vom Pi) */

const $ = (s) => document.querySelector(s);
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
  "September", "Oktober", "November", "Dezember"];
const TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONATE_KURZ = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];

const zustand = {
  ich: null, mitglieder: [], termine: [],
  jahr: 0, monat: 0, // monat 0-11
  gewaehlt: "", bearbeitet: null,
  ansicht: localStorage.getItem("fk_ansicht") || "monat", // monat | woche | tag
  scrollTag: "",
};
const STUNDE_PX = 56;

// ------------------------------------------------------------ Server-Anfragen
async function api(methode, pfad, daten) {
  const opt = { method: methode, headers: { "X-Familienkalender": "1" }, credentials: "same-origin" };
  if (daten !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(daten);
  }
  let r;
  try {
    r = await fetch(pfad, opt);
  } catch (e) {
    throw Object.assign(new Error("Keine Verbindung zum Kalender. Nicht zu Hause? Dann bitte zuerst WireGuard (VPN) einschalten."), { status: 0 });
  }
  let inhalt = {};
  try { inhalt = await r.json(); } catch (e) { /* leer */ }
  if (inhalt.umzug) { location.href = inhalt.umzug; } // Kalender hat eine neue (verschlüsselte) Adresse
  if (!r.ok) throw Object.assign(new Error(inhalt.fehler || "Fehler " + r.status), { status: r.status });
  return inhalt;
}

// ------------------------------------------------------------ Datums-Helfer (UTC, damit Zeitumstellung nicht stört)
function d2s(d) { return d.toISOString().slice(0, 10); }
function s2d(s) { const [y, m, t] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, t)); }
function plusTage(s, n) { const d = s2d(s); d.setUTCDate(d.getUTCDate() + n); return d2s(d); }
function tageZwischen(a, b) { return Math.round((s2d(b) - s2d(a)) / 864e5); }
function heute() { const j = new Date(); return d2s(new Date(Date.UTC(j.getFullYear(), j.getMonth(), j.getDate()))); }
function schoen(s, mitJahr) {
  const d = s2d(s);
  return TAGE[d.getUTCDay()] + ", " + d.getUTCDate() + ". " + MONATE[d.getUTCMonth()] + (mitJahr ? " " + d.getUTCFullYear() : "");
}

// Alle Vorkommen eines Termins, die den Zeitraum [von, bis] berühren
function vorkommen(e, von, bis) {
  const dauer = tageZwischen(e.start_date, e.end_date);
  const liste = [];
  if (e.repeat === "none") {
    if (e.start_date <= bis && e.end_date >= von) liste.push({ s: e.start_date, en: e.end_date, e });
    return liste;
  }
  const [y, m, t] = e.start_date.split("-").map(Number);
  const grenze = e.repeat_until && e.repeat_until < bis ? e.repeat_until : bis;
  const [vy, vm] = von.split("-").map(Number);
  let i0 = 0;
  if (e.repeat === "weekly") i0 = Math.floor((tageZwischen(e.start_date, von) - dauer) / 7) - 1;
  if (e.repeat === "monthly") i0 = (vy - y) * 12 + (vm - m) - Math.ceil(dauer / 28) - 1;
  if (e.repeat === "yearly") i0 = vy - y - Math.ceil(dauer / 365) - 1;
  i0 = Math.max(0, i0);
  for (let i = i0; i < i0 + 3000; i++) {
    let d;
    if (e.repeat === "weekly") d = s2d(plusTage(e.start_date, 7 * i));
    else if (e.repeat === "monthly") d = new Date(Date.UTC(y, m - 1 + i, t));
    else d = new Date(Date.UTC(y + i, m - 1, t));
    const s = d2s(d);
    if (s > grenze) break;
    if (d.getUTCDate() !== t) continue; // z. B. 31. im Februar oder 29.2. im Nicht-Schaltjahr
    const en = plusTage(s, dauer);
    if (en >= von) liste.push({ s, en, e });
  }
  return liste;
}

function vorkommenNachTag(von, bis) {
  const karte = {};
  for (const e of zustand.termine) {
    for (const v of vorkommen(e, von, bis)) {
      let tag = v.s < von ? von : v.s;
      const ende = v.en > bis ? bis : v.en;
      while (tag <= ende) { (karte[tag] = karte[tag] || []).push(v); tag = plusTage(tag, 1); }
    }
  }
  for (const k in karte) karte[k].sort(sortierung);
  return karte;
}

function sortierung(a, b) {
  const za = a.e.all_day ? "" : a.e.start_time, zb = b.e.all_day ? "" : b.e.start_time;
  return a.s.localeCompare(b.s) || za.localeCompare(zb) || a.e.title.localeCompare(b.e.title);
}

function person(id) { return zustand.mitglieder.find((p) => p.id === id); }
function farbe(e) {
  const p = person(e.participants[0]) || person(e.created_by);
  return p ? p.color : "#002D72";
}
function zeitText(v) {
  const e = v.e;
  let t = e.all_day ? "ganztägig" : e.start_time + (e.end_time && e.end_time !== e.start_time ? "–" + e.end_time : "") + " Uhr";
  if (v.s !== v.en) t += " · " + schoen(v.s) + " bis " + schoen(v.en);
  return t;
}

// ------------------------------------------------------------ Anzeige
function zeige(id) {
  for (const a of ["#ansicht-login", "#ansicht-kalender"]) $(a).classList.toggle("versteckt", a !== id);
}

function zeichneKalender() {
  const a = zustand.ansicht;
  $(".ansichten").style.top = $(".kopf").offsetHeight + "px"; // Umschalter klebt unter der Kopfzeile
  for (const n of ["monat", "woche", "tag"]) $("#bereich-" + n).classList.toggle("versteckt", n !== a);
  document.querySelectorAll(".ansichten button").forEach((b) => b.classList.toggle("aktiv", b.dataset.ansicht === a));
  const d = s2d(zustand.gewaehlt);
  zustand.jahr = d.getUTCFullYear();
  zustand.monat = d.getUTCMonth();
  if (a === "woche") zeichneWoche();
  else if (a === "tag") zeichneTag();
  else zeichneMonat();
}

function zeigeAnsicht(a) {
  zustand.ansicht = a;
  localStorage.setItem("fk_ansicht", a);
  zustand.scrollTag = "";
  window.scrollTo(0, 0);
  zeichneKalender();
}

function montag(tag) { return plusTage(tag, -((s2d(tag).getUTCDay() + 6) % 7)); }
function kurzDatum(tag) { const d = s2d(tag); return d.getUTCDate() + ". " + MONATE_KURZ[d.getUTCMonth()]; }

// ---- Wochenansicht: Liste Mo–So
function zeichneWoche() {
  const von = montag(zustand.gewaehlt), bis = plusTage(von, 6);
  const dv = s2d(von), db = s2d(bis);
  $("#monat-titel").textContent = dv.getUTCDate() + "." + (dv.getUTCMonth() === db.getUTCMonth() ? "" : (dv.getUTCMonth() + 1) + ".") +
    "–" + db.getUTCDate() + "." + (db.getUTCMonth() + 1) + ".";
  const karte = vorkommenNachTag(von, bis);
  const h = heute();
  const bereich = $("#bereich-woche");
  bereich.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const tag = plusTage(von, i);
    const box = document.createElement("div");
    box.className = "woche-tag";
    box.dataset.tag = tag;
    if (tag === h) box.classList.add("heute");
    const t = document.createElement("h3");
    t.textContent = schoen(tag);
    if (tag === h) { const m = document.createElement("span"); m.className = "marke"; m.textContent = "heute"; t.append(m); }
    t.addEventListener("click", () => { zustand.gewaehlt = tag; zeigeAnsicht("tag"); });
    const ul = document.createElement("ul");
    ul.className = "liste";
    fuelleListe(ul, karte[tag] || [], false, "keine Termine");
    box.append(t, ul);
    bereich.append(box);
  }
}

// ---- Tagesansicht: Stundenplan
function minuten(z) { const [h, m] = z.split(":").map(Number); return h * 60 + m; }
function zeichneTag() {
  const tag = zustand.gewaehlt;
  const d = s2d(tag);
  $("#monat-titel").textContent = TAGE[d.getUTCDay()] + ", " + kurzDatum(tag);
  const alle = vorkommenNachTag(tag, tag)[tag] || [];
  // ganztägig oder mittlerer Tag eines mehrtägigen Termins -> oben als Liste
  const ganz = alle.filter((v) => v.e.all_day || (v.s !== tag && v.en !== tag));
  const zeit = alle.filter((v) => !ganz.includes(v)).map((v) => {
    const start = v.s === tag ? minuten(v.e.start_time) : 0;
    let ende = v.en === tag ? minuten(v.e.end_time || v.e.start_time) : 24 * 60;
    if (ende <= start) ende = Math.min(start + 30, 24 * 60);
    return { v, start, ende };
  }).sort((a, b) => a.start - b.start || b.ende - a.ende);
  const ul = $("#tag-ganztags");
  ul.replaceChildren();
  if (ganz.length) fuelleListe(ul, ganz, false, "");
  // Überschneidungen nebeneinander: Gruppen bilden, in Spuren verteilen
  let gruppe = [], gruppenEnde = -1;
  const fertig = () => { const n = Math.max(...gruppe.map((x) => x.spur)) + 1; gruppe.forEach((x) => { x.n = n; }); gruppe = []; };
  for (const x of zeit) {
    if (gruppe.length && x.start >= gruppenEnde) fertig();
    const spuren = [];
    gruppe.forEach((y) => { if (y.ende > x.start) spuren[y.spur] = true; });
    x.spur = 0;
    while (spuren[x.spur]) x.spur++;
    gruppe.push(x);
    gruppenEnde = Math.max(gruppenEnde, x.ende);
  }
  if (gruppe.length) fertig();

  const plan = $("#stunden");
  plan.replaceChildren();
  for (let h = 0; h < 24; h++) {
    const zeile = document.createElement("div");
    zeile.className = "stunde";
    zeile.dataset.stunde = h;
    const l = document.createElement("span");
    l.textContent = String(h).padStart(2, "0") + ":00";
    zeile.append(l);
    zeile.addEventListener("click", () => oeffneTermin(null, String(h).padStart(2, "0") + ":00"));
    plan.append(zeile);
  }
  for (const x of zeit) {
    const b = document.createElement("div");
    b.className = "block";
    b.style.top = (x.start / 60 * STUNDE_PX + 1) + "px";
    b.style.height = Math.max((x.ende - x.start) / 60 * STUNDE_PX - 2, 24) + "px";
    b.style.left = "calc(3.6em + (100% - 3.8em) * " + x.spur + " / " + x.n + ")";
    b.style.width = "calc((100% - 3.8em) / " + x.n + " - 3px)";
    b.style.borderLeftColor = farbe(x.v.e);
    const t = document.createElement("b");
    t.textContent = x.v.e.title;
    const u = document.createElement("small");
    u.textContent = zeitText(x.v) + (x.v.e.location ? " · " + x.v.e.location : "");
    b.append(t, u);
    b.addEventListener("click", (ev) => { ev.stopPropagation(); oeffneTermin(x.v.e); });
    plan.append(b);
  }
  const jetztD = new Date();
  if (tag === heute()) {
    const linie = document.createElement("div");
    linie.className = "jetzt";
    linie.style.top = ((jetztD.getHours() * 60 + jetztD.getMinutes()) / 60 * STUNDE_PX) + "px";
    plan.append(linie);
  }
  // beim Wechsel des Tages zu einer sinnvollen Uhrzeit springen (heute: jetzt, sonst 7 Uhr / erster Termin)
  if (zustand.scrollTag !== tag) {
    zustand.scrollTag = tag;
    let ziel = tag === heute() ? Math.max(jetztD.getHours() - 1, 0) : 7;
    if (tag !== heute() && zeit.length) ziel = Math.min(ziel, Math.floor(zeit[0].start / 60));
    const kopf = $(".kopf").offsetHeight + $(".ansichten").offsetHeight;
    window.scrollTo(0, Math.max(0, plan.getBoundingClientRect().top + window.scrollY - kopf + ziel * STUNDE_PX - 8));
  }
}

// ---- Monatsansicht
function zeichneMonat() {
  const erster = new Date(Date.UTC(zustand.jahr, zustand.monat, 1));
  const versatz = (erster.getUTCDay() + 6) % 7;
  const von = plusTage(d2s(erster), -versatz);
  const bis = plusTage(von, 41);
  const karte = vorkommenNachTag(von, bis);
  const h = heute();
  $("#monat-titel").textContent = MONATE_KURZ[zustand.monat] + " " + zustand.jahr;
  const raster = $("#raster");
  raster.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const tag = plusTage(von, i);
    const zelle = document.createElement("button");
    zelle.type = "button";
    zelle.className = "tag";
    zelle.dataset.tag = tag;
    if (s2d(tag).getUTCMonth() !== zustand.monat) zelle.classList.add("fremd");
    if (tag === h) zelle.classList.add("heute");
    if (tag === zustand.gewaehlt) zelle.classList.add("gewaehlt");
    const nr = document.createElement("span");
    nr.className = "nr";
    nr.textContent = s2d(tag).getUTCDate();
    zelle.append(nr);
    const eintraege = karte[tag] || [];
    eintraege.slice(0, 3).forEach((v) => {
      const m = document.createElement("span");
      m.className = "mini";
      m.style.borderLeftColor = farbe(v.e);
      m.textContent = v.e.title;
      zelle.append(m);
    });
    if (eintraege.length > 3) {
      const m = document.createElement("span");
      m.className = "mehr";
      m.textContent = "+" + (eintraege.length - 3) + " weitere";
      zelle.append(m);
    }
    // 1x tippen = Tag auswählen, auf den ausgewählten Tag nochmal tippen = Tagesansicht
    zelle.addEventListener("click", () => {
      if (zustand.gewaehlt === tag) { zeigeAnsicht("tag"); return; }
      zustand.gewaehlt = tag; zeichneKalender();
    });
    raster.append(zelle);
  }
  // Liste für den gewählten Tag
  $("#tag-titel").textContent = schoen(zustand.gewaehlt, true);
  const tagesListe = vorkommenNachTag(zustand.gewaehlt, zustand.gewaehlt)[zustand.gewaehlt] || [];
  fuelleListe($("#tag-liste"), tagesListe, false, "Keine Termine. Tippe auf + für einen neuen Termin.");
  // Demnächst (30 Tage)
  const ab = h, ende = plusTage(h, 30);
  const bald = [];
  for (const e of zustand.termine) for (const v of vorkommen(e, ab, ende)) bald.push(v);
  bald.sort(sortierung);
  fuelleListe($("#demnaechst"), bald.slice(0, 15), true, "In den nächsten 30 Tagen steht nichts an.");
}

function fuelleListe(ul, eintraege, mitDatum, leerText) {
  ul.replaceChildren();
  if (!eintraege.length) {
    const li = document.createElement("li");
    li.className = "leer";
    li.textContent = leerText;
    ul.append(li);
    return;
  }
  for (const v of eintraege) {
    const li = document.createElement("li");
    li.style.borderLeftColor = farbe(v.e);
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = v.e.title + (v.e.repeat !== "none" ? " ↻" : "");
    const punkte = document.createElement("span");
    punkte.className = "punkte";
    for (const id of v.e.participants) {
      const p = person(id);
      if (!p) continue;
      const i = document.createElement("i");
      i.style.background = p.color;
      i.title = p.display_name;
      punkte.append(i);
    }
    t.append(punkte);
    const u = document.createElement("div");
    u.className = "u";
    const namen = v.e.participants.map((id) => (person(id) || {}).display_name).filter(Boolean);
    u.textContent = (mitDatum ? schoen(v.s) + " · " : "") + zeitText(v) +
      (v.e.location ? " · " + v.e.location : "") + (namen.length ? " · " + namen.join(", ") : "");
    li.append(t, u);
    li.addEventListener("click", () => oeffneTermin(v.e));
    ul.append(li);
  }
}

// ------------------------------------------------------------ Daten laden
async function ladeDaten() {
  const [mitglieder, termine] = await Promise.all([api("GET", "/api/mitglieder"), api("GET", "/api/termine")]);
  zustand.mitglieder = mitglieder;
  zustand.termine = termine;
  zeichneKalender();
}

async function start() {
  try {
    zustand.ich = await api("GET", "/api/ich");
  } catch (e) {
    zustand.ich = null;
    if (e.status === 0) { $("#login-hinweis").textContent = e.message; zeige("#ansicht-login"); return; }
    try {
      const s = await api("GET", "/api/status");
      $("#login-hinweis").textContent = s.hat_benutzer ? "" :
        "Noch niemand registriert. Das erste Profil wird automatisch Verwalter (darf andere freigeben).";
      if (!s.hat_benutzer) wechsle(true);
    } catch (e2) { /* egal */ }
    zeige("#ansicht-login");
    return;
  }
  const j = new Date();
  zustand.jahr = j.getFullYear();
  zustand.monat = j.getMonth();
  zustand.gewaehlt = heute();
  zeige("#ansicht-kalender");
  await ladeDaten();
  if (zustand.ich.must_change_pw) {
    $("#form-erstpasswort").reset();
    $("#erstpasswort-fehler").textContent = "";
    $("#dlg-erstpasswort").showModal();
  }
}

// Erstes eigenes Passwort
$("#dlg-erstpasswort").addEventListener("cancel", (ev) => ev.preventDefault()); // nicht wegdrücken
$("#form-erstpasswort").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.pw1.value !== f.pw2.value) { $("#erstpasswort-fehler").textContent = "Die Passwörter sind nicht gleich."; return; }
  try {
    zustand.ich = await api("PUT", "/api/ich", { new_password: f.pw1.value });
    $("#dlg-erstpasswort").close();
  } catch (e) { $("#erstpasswort-fehler").textContent = e.message; }
});

// ------------------------------------------------------------ Anmelden / Registrieren
function wechsle(registrieren) {
  $("#form-login").classList.toggle("versteckt", registrieren);
  $("#form-registrieren").classList.toggle("versteckt", !registrieren);
  $("#login-fehler").textContent = "";
}
$("#zu-registrieren").addEventListener("click", (ev) => { ev.preventDefault(); wechsle(true); });
$("#zu-login").addEventListener("click", (ev) => { ev.preventDefault(); wechsle(false); });

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await api("POST", "/api/anmelden", { username: f.get("username"), password: f.get("password") });
    ev.target.reset();
    $("#login-hinweis").textContent = "";
    await start();
  } catch (e) { $("#login-fehler").textContent = e.message; }
});

$("#form-registrieren").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  if (f.get("password") !== f.get("password2")) { $("#login-fehler").textContent = "Die Passwörter sind nicht gleich."; return; }
  try {
    const r = await api("POST", "/api/registrieren", {
      username: f.get("username"), display_name: f.get("display_name"), password: f.get("password"),
    });
    if (r.freigegeben) {
      await api("POST", "/api/anmelden", { username: f.get("username"), password: f.get("password") });
      ev.target.reset();
      $("#login-hinweis").textContent = "";
      await start();
    } else {
      ev.target.reset();
      wechsle(false);
      $("#login-hinweis").textContent = "Profil angelegt! Der Verwalter muss dich jetzt noch freigeben. Danach kannst du dich anmelden.";
    }
  } catch (e) { $("#login-fehler").textContent = e.message; }
});

// ------------------------------------------------------------ Blättern / Ansicht wechseln
function monatPlus(n) {
  const d = s2d(zustand.gewaehlt);
  zustand.gewaehlt = d2s(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
  zeichneKalender();
}
function blaettern(n) {
  if (zustand.ansicht === "woche") zustand.gewaehlt = plusTage(zustand.gewaehlt, 7 * n);
  else if (zustand.ansicht === "tag") zustand.gewaehlt = plusTage(zustand.gewaehlt, n);
  else return monatPlus(n);
  zeichneKalender();
}
$("#monat-zurueck").addEventListener("click", () => blaettern(-1));
$("#monat-vor").addEventListener("click", () => blaettern(1));
$("#heute").addEventListener("click", () => { zustand.gewaehlt = heute(); zustand.scrollTag = ""; zeichneKalender(); });
document.querySelectorAll(".ansichten button").forEach((b) => b.addEventListener("click", () => zeigeAnsicht(b.dataset.ansicht)));
$("#zur-tagesansicht").addEventListener("click", () => zeigeAnsicht("tag"));
// Wischen nach links/rechts blättert (nur wenn eindeutig waagerecht)
let wisch = null;
$("#inhalt").addEventListener("touchstart", (ev) => { wisch = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; }, { passive: true });
$("#inhalt").addEventListener("touchend", (ev) => {
  if (!wisch) return;
  const dx = ev.changedTouches[0].clientX - wisch.x, dy = ev.changedTouches[0].clientY - wisch.y;
  wisch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) blaettern(dx < 0 ? 1 : -1);
});

// ------------------------------------------------------------ Termin-Formular
const formT = $("#form-termin");
function zeitFelderAnpassen() {
  const ganz = formT.all_day.checked;
  formT.querySelectorAll(".zeit").forEach((l) => l.classList.toggle("versteckt", ganz));
  formT.start_time.required = !ganz;
  $("#bis-zeile").classList.toggle("versteckt", formT.repeat.value === "none");
}
formT.all_day.addEventListener("change", zeitFelderAnpassen);
formT.repeat.addEventListener("change", zeitFelderAnpassen);
// Startdatum geändert: Enddatum wandert mit (Dauer bleibt gleich)
formT.start_date.addEventListener("change", () => {
  const alt = formT.start_date.dataset.alt, neu = formT.start_date.value;
  if (!neu) return;
  let dauer = 0;
  if (alt && formT.end_date.value) dauer = Math.max(0, tageZwischen(alt, formT.end_date.value));
  formT.end_date.value = plusTage(neu, dauer);
  formT.start_date.dataset.alt = neu;
});

function oeffneTermin(e, uhrzeit) {
  zustand.bearbeitet = e || null;
  formT.reset();
  $("#termin-fehler").textContent = "";
  $("#termin-ueberschrift").textContent = e ? "Termin bearbeiten" : "Neuer Termin";
  $("#termin-loeschen").classList.toggle("versteckt", !e);
  const t = e || { title: "", start_date: zustand.gewaehlt, end_date: zustand.gewaehlt, all_day: true,
    start_time: "", end_time: "", repeat: "none", repeat_until: "", location: "", notes: "",
    participants: [zustand.ich.id] };
  if (!e && uhrzeit) {
    t.all_day = false;
    t.start_time = uhrzeit;
    t.end_time = String(Math.min(Number(uhrzeit.slice(0, 2)) + 1, 23)).padStart(2, "0") + uhrzeit.slice(2);
  }
  formT.title.value = t.title;
  formT.start_date.value = t.start_date;
  formT.start_date.dataset.alt = t.start_date;
  formT.end_date.value = t.end_date;
  formT.all_day.checked = t.all_day;
  formT.start_time.value = t.start_time || "";
  formT.end_time.value = t.end_time || "";
  formT.repeat.value = t.repeat;
  formT.repeat_until.value = t.repeat_until || "";
  formT.location.value = t.location;
  formT.notes.value = t.notes;
  const box = $("#teilnehmer");
  box.replaceChildren();
  for (const p of zustand.mitglieder) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox"; c.value = p.id; c.checked = t.participants.includes(p.id);
    const punkt = document.createElement("i");
    punkt.style.cssText = "width:.8em;height:.8em;border-radius:50%;display:inline-block;background:" + p.color;
    l.append(c, punkt, document.createTextNode(p.display_name));
    box.append(l);
  }
  let info = "";
  if (e) {
    const wer = person(e.updated_by);
    info = "Zuletzt geändert" + (wer ? " von " + wer.display_name : "") + " am " +
      new Date(e.updated_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
    if (e.repeat !== "none") info += ". Achtung: Änderungen gelten für alle Wiederholungen.";
    if (e.abo_name) info += ". Kommt automatisch aus dem Kalender-Link „" + e.abo_name +
      "“ – Änderungen hier werden beim nächsten Abruf überschrieben.";
  }
  $("#termin-info").textContent = info;
  zeitFelderAnpassen();
  $("#dlg-termin").showModal();
}

$("#neu").addEventListener("click", () => oeffneTermin(null));
// (Tagesansicht: Tippen auf eine Stunde legt dort einen Termin an)
$("#termin-abbrechen").addEventListener("click", () => $("#dlg-termin").close());

formT.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const daten = {
    title: formT.title.value, start_date: formT.start_date.value,
    end_date: formT.end_date.value || formT.start_date.value, all_day: formT.all_day.checked,
    start_time: formT.start_time.value, end_time: formT.end_time.value || formT.start_time.value,
    repeat: formT.repeat.value, repeat_until: formT.repeat_until.value || null,
    location: formT.location.value, notes: formT.notes.value,
    participants: [...$("#teilnehmer").querySelectorAll("input:checked")].map((c) => Number(c.value)),
  };
  try {
    if (zustand.bearbeitet) await api("PUT", "/api/termine/" + zustand.bearbeitet.id, daten);
    else await api("POST", "/api/termine", daten);
    $("#dlg-termin").close();
    await ladeDaten();
  } catch (e) { $("#termin-fehler").textContent = e.message; }
});

$("#termin-loeschen").addEventListener("click", async () => {
  const e = zustand.bearbeitet;
  if (!e) return;
  const frage = e.repeat !== "none"
    ? "„" + e.title + "“ wiederholt sich. Wirklich ALLE Wiederholungen löschen?"
    : "„" + e.title + "“ wirklich löschen?";
  if (!confirm(frage)) return;
  try {
    await api("DELETE", "/api/termine/" + e.id);
    $("#dlg-termin").close();
    await ladeDaten();
  } catch (err) { $("#termin-fehler").textContent = err.message; }
});

// ------------------------------------------------------------ Einstellungen
const formP = $("#form-profil");
$("#menue").addEventListener("click", async () => {
  formP.reset();
  formP.display_name.value = zustand.ich.display_name;
  formP.color.value = zustand.ich.color;
  $("#profil-meldung").textContent = "";
  $("#import-meldung").textContent = "";
  $("#zugang").classList.add("versteckt");
  $("#mitglied-fehler").textContent = "";
  const admin = zustand.ich.role === "admin";
  $("#verwaltung").classList.toggle("versteckt", !admin);
  $("#import-knopf").classList.toggle("versteckt", !admin);
  $("#import-ics-knopf").classList.toggle("versteckt", !admin);
  $("#abos-bereich").classList.toggle("versteckt", !admin);
  $("#import-ics-meldung").textContent = "";
  $("#abo-meldung").textContent = "";
  if (admin) { await zeigeBenutzer(); await zeigeAbos(); }
  $("#dlg-einstellungen").showModal();
});
$("#einst-zu").addEventListener("click", () => $("#dlg-einstellungen").close());

formP.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const daten = { display_name: formP.display_name.value, color: formP.color.value };
  if (formP.new_password.value) { daten.new_password = formP.new_password.value; daten.old_password = formP.old_password.value; }
  try {
    zustand.ich = await api("PUT", "/api/ich", daten);
    formP.old_password.value = ""; formP.new_password.value = "";
    $("#profil-meldung").textContent = "Gespeichert ✓";
    await ladeDaten();
  } catch (e) { $("#profil-meldung").textContent = e.message; }
});

const STATUS = { pending: "wartet auf Freigabe", active: "aktiv", disabled: "gesperrt" };
async function zeigeBenutzer() {
  const liste = await api("GET", "/api/admin/benutzer");
  const ul = $("#benutzer-liste");
  ul.replaceChildren();
  for (const b of liste) {
    const li = document.createElement("li");
    li.className = "benutzer";
    li.style.borderLeftColor = b.color;
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = b.display_name + " (" + b.username + ")" + (b.role === "admin" ? " – Verwalter" : "");
    const s = document.createElement("span");
    s.className = "status " + b.status;
    s.textContent = STATUS[b.status] || b.status;
    t.append(s);
    li.append(t);
    if (b.must_change_pw) {
      const h = document.createElement("div"); h.className = "u"; h.textContent = "hat sich noch nicht mit eigenem Passwort angemeldet";
      li.append(h);
    }
    if (b.id === zustand.ich.id) {
      const u = document.createElement("div"); u.className = "u"; u.textContent = "Das bist du."; li.append(u);
    } else {
      const ak = document.createElement("div");
      ak.className = "aktionen";
      const knopf = (txt, fn, gefahr) => {
        const k = document.createElement("button"); k.type = "button"; k.textContent = txt;
        if (gefahr) k.className = "gefahr";
        k.addEventListener("click", async () => {
          try { await fn(); await zeigeBenutzer(); await ladeDaten(); } catch (e) { alert(e.message); }
        });
        ak.append(k);
      };
      const aktion = (a, extra) => api("POST", "/api/admin/benutzer/" + b.id, Object.assign({ aktion: a }, extra));
      if (b.status !== "active") knopf(b.status === "pending" ? "Freigeben" : "Entsperren", () => aktion("freigeben"));
      if (b.status === "active") knopf("Sperren", () => aktion("sperren"), true);
      if (b.status === "active") knopf(b.role === "admin" ? "Zum Mitglied machen" : "Zum Verwalter machen",
        () => aktion(b.role === "admin" ? "zum_mitglied" : "zum_verwalter"));
      if (b.status === "active") knopf("Neues Startpasswort", async () => {
        if (!confirm("Für " + b.display_name + " ein neues Startpasswort erzeugen? Das alte gilt dann nicht mehr.")) return;
        zeigeZugang(await aktion("passwort"));
      });
      knopf(b.status === "pending" ? "Ablehnen" : "Löschen", async () => {
        if (confirm("Profil von " + b.display_name + " wirklich löschen? Die Termine bleiben erhalten.")) {
          await api("DELETE", "/api/admin/benutzer/" + b.id);
        }
      }, true);
      li.append(ak);
    }
    ul.append(li);
  }
}

// Benutzername aus dem Namen vorschlagen (klein, ohne Umlaute/Leerzeichen)
const formM = $("#form-mitglied");
formM.display_name.addEventListener("input", () => {
  if (formM.username.dataset.selbst) return;
  formM.username.value = formM.display_name.value.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9._-]+/g, "").slice(0, 30);
});
formM.username.addEventListener("input", () => { formM.username.dataset.selbst = "1"; });

function zugangsText(name, benutzername, passwort) {
  return "Hallo " + name + "! 👋\n" +
    "Du hast jetzt Zugang zu unserem Familienkalender 📅\n\n" +
    "1. Nur wenn du NICHT bei uns im WLAN bist: zuerst die App „WireGuard“ einschalten " +
    "(richten wir einmal gemeinsam ein).\n" +
    "2. Diesen Link öffnen: " + location.origin + "\n" +
    "3. Anmelden mit\n   Benutzername: " + benutzername + "\n   Startpasswort: " + passwort + "\n" +
    "4. Danach ein eigenes Passwort wählen.\n" +
    "5. Tipp: Oben im Kalender auf „Installieren“ tippen (oder im Browser-Menü ⋮ „App installieren“) – " +
    "dann ist der Kalender wie eine App auf deinem Handy.";
}

function zeigeZugang(b) {
  const t = zugangsText(b.display_name.split(" ")[0], b.username, b.startpasswort);
  $("#zugang-titel").textContent = "Zugangsdaten für " + b.display_name;
  $("#zugang-text").textContent = t;
  $("#zugang-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(t);
  $("#zugang").classList.remove("versteckt");
  $("#zugang").scrollIntoView({ block: "start" });
}
$("#zugang-zu").addEventListener("click", () => {
  $("#zugang").classList.add("versteckt");
  $("#zugang-text").textContent = "";
});
$("#zugang-kopieren").addEventListener("click", async () => {
  const t = $("#zugang-text").textContent;
  try { await navigator.clipboard.writeText(t); $("#zugang-kopieren").textContent = "Kopiert ✓"; }
  catch (e) { // ohne https darf der Browser manchmal nicht kopieren: Text markieren
    const bereich = document.createRange(); bereich.selectNodeContents($("#zugang-text"));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(bereich);
    $("#zugang-kopieren").textContent = "Markiert – jetzt lange drücken & kopieren";
  }
  setTimeout(() => { $("#zugang-kopieren").textContent = "Kopieren"; }, 4000);
});

formM.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("#mitglied-fehler").textContent = "";
  try {
    const b = await api("POST", "/api/admin/benutzer", {
      display_name: formM.display_name.value, username: formM.username.value, admin: formM.admin.checked,
    });
    formM.reset();
    delete formM.username.dataset.selbst;
    await zeigeBenutzer();
    await ladeDaten();
    zeigeZugang(b);
  } catch (e) { $("#mitglied-fehler").textContent = e.message; }
});

$("#import-datei").addEventListener("change", async (ev) => {
  const datei = ev.target.files[0];
  ev.target.value = "";
  if (!datei) return;
  try {
    const daten = JSON.parse(await datei.text());
    const r = await api("POST", "/api/import", daten);
    $("#import-meldung").textContent = r.neu + " Termine importiert, " + r.uebersprungen + " schon vorhanden (übersprungen).";
    await ladeDaten();
  } catch (e) {
    $("#import-meldung").textContent = e instanceof SyntaxError ? "Die Datei ist keine gültige Sicherung." : e.message;
  }
});

// ------------------------------------------------------------ Andere Kalender (.ics) und Kalender-Links
function icsMeldung(r) {
  const teile = [r.neu + (r.gespeichert ? " Termine importiert" : " neue Termine gefunden")];
  if (r.uebersprungen) teile.push(r.uebersprungen + " schon vorhanden (übersprungen)");
  if (r.vereinfacht) teile.push(r.vereinfacht + " mit besonderer Wiederholung (z. B. täglich) nur einmal eingetragen");
  if (r.abgesagt) teile.push(r.abgesagt + " abgesagte weggelassen");
  if (r.einzeln) teile.push(r.einzeln + " geänderte Einzeltermine einer Serie weggelassen");
  if (r.fehlerhaft) teile.push(r.fehlerhaft + " fehlerhafte übersprungen");
  return teile.join(", ") + ".";
}

$("#import-ics-datei").addEventListener("change", async (ev) => {
  const datei = ev.target.files[0];
  ev.target.value = "";
  if (!datei) return;
  const meldung = $("#import-ics-meldung");
  meldung.textContent = "Datei wird gelesen …";
  try {
    const ics = await datei.text();
    const pruefung = await api("POST", "/api/import-ics", { ics, nur_pruefen: true });
    if (!pruefung.neu) { meldung.textContent = "Keine neuen Termine. " + icsMeldung(pruefung); return; }
    if (!confirm(icsMeldung(pruefung) + "\n\nJetzt " + pruefung.neu + " Termine in den Familienkalender übernehmen?")) {
      meldung.textContent = "Nichts importiert.";
      return;
    }
    meldung.textContent = icsMeldung(await api("POST", "/api/import-ics", { ics }));
    await ladeDaten();
  } catch (e) { meldung.textContent = e.message; }
});

function abosTeilnehmer() {
  const box = $("#abo-teilnehmer");
  box.replaceChildren();
  for (const p of zustand.mitglieder) {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox"; c.value = p.id;
    const punkt = document.createElement("i");
    punkt.style.cssText = "width:.8em;height:.8em;border-radius:50%;display:inline-block;background:" + p.color;
    l.append(c, punkt, document.createTextNode(p.display_name));
    box.append(l);
  }
}

async function zeigeAbos() {
  abosTeilnehmer();
  const liste = await api("GET", "/api/abos");
  const ul = $("#abo-liste");
  ul.replaceChildren();
  for (const a of liste) {
    const li = document.createElement("li");
    li.className = "benutzer abo";
    const p = person(a.participants[0]);
    if (p) li.style.borderLeftColor = p.color;
    const t = document.createElement("div"); t.className = "t"; t.textContent = a.name;
    const u = document.createElement("div"); u.className = "u";
    u.textContent = a.anzahl + " Termine" + (a.last_ok ? " · zuletzt geholt " +
      new Date(a.last_ok).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "");
    const st = document.createElement("div");
    st.className = "u abo-status" + (a.last_status.startsWith("OK") ? "" : " fehler");
    st.textContent = a.last_status.startsWith("OK") ? "Letzter Abruf: " + a.last_status.slice(4) : a.last_status;
    const ak = document.createElement("div"); ak.className = "aktionen";
    const abrufen = document.createElement("button"); abrufen.type = "button"; abrufen.textContent = "Jetzt abrufen";
    abrufen.addEventListener("click", async () => {
      abrufen.disabled = true; abrufen.textContent = "Wird abgerufen …";
      try { await api("POST", "/api/abos/" + a.id + "/abrufen"); await zeigeAbos(); await ladeDaten(); }
      catch (e) { alert(e.message); abrufen.disabled = false; abrufen.textContent = "Jetzt abrufen"; }
    });
    const weg = document.createElement("button"); weg.type = "button"; weg.className = "gefahr"; weg.textContent = "Löschen";
    weg.addEventListener("click", async () => {
      if (!confirm("Kalender-Link „" + a.name + "“ und seine " + a.anzahl + " Termine aus dem Familienkalender löschen?")) return;
      try { await api("DELETE", "/api/abos/" + a.id); await zeigeAbos(); await ladeDaten(); } catch (e) { alert(e.message); }
    });
    ak.append(abrufen, weg);
    li.append(t, u, st, ak);
    ul.append(li);
  }
}

const formA = $("#form-abo");
formA.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const meldung = $("#abo-meldung");
  const knopf = formA.querySelector("button[type=submit]");
  meldung.textContent = "Link wird abgerufen …";
  knopf.disabled = true;
  try {
    const a = await api("POST", "/api/abos", {
      name: formA.name.value, url: formA.url.value,
      participants: [...$("#abo-teilnehmer").querySelectorAll("input:checked")].map((c) => Number(c.value)),
    });
    formA.reset();
    meldung.textContent = a.last_status.startsWith("OK")
      ? "Gespeichert ✓ " + a.anzahl + " Termine eingetragen. Ab jetzt holt der Pi Änderungen selbst."
      : "Gespeichert, aber: " + a.last_status + " Bitte den Link prüfen.";
    await zeigeAbos();
    await ladeDaten();
  } catch (e) { meldung.textContent = e.message; }
  knopf.disabled = false;
});

$("#abmelden").addEventListener("click", async () => {
  try { await api("POST", "/api/abmelden"); } catch (e) { /* egal */ }
  $("#dlg-einstellungen").close();
  zustand.ich = null;
  await start();
});

// Neue Programmversion auf dem Pi? Dann Seite neu laden (nur wenn gerade nichts eingegeben wird)
let version = null;
async function versionPruefen() {
  try {
    const s = await api("GET", "/api/status");
    if (s.umzug) { location.href = s.umzug; return true; }
    const offen = [...document.querySelectorAll("dialog")].some((d) => d.open);
    if (version && s.version !== version && !offen) { location.reload(); return true; }
    version = version || s.version;
  } catch (e) { /* Pi gerade nicht erreichbar */ }
  return false;
}
versionPruefen();

// Alle 60 Sekunden neu laden, damit Änderungen der anderen ankommen
// Hinweis, wenn der Kalender nicht erreichbar ist (z. B. unterwegs ohne WireGuard)
let ohneVerbindung = false;
function verbindungsHinweis(weg) {
  ohneVerbindung = weg;
  $("#verbindung").classList.toggle("versteckt", !weg);
}
async function auffrischen() {
  if (document.visibilityState !== "visible") return;
  if (await versionPruefen()) return;
  if (!zustand.ich || $("#dlg-termin").open) return;
  try {
    await ladeDaten();
    verbindungsHinweis(false);
  } catch (e) {
    if (e.status === 0) verbindungsHinweis(true);
  }
}
setInterval(auffrischen, 60000);
setInterval(() => { if (ohneVerbindung) auffrischen(); }, 10000); // ohne Verbindung öfter nachsehen
document.addEventListener("visibilitychange", auffrischen);
window.addEventListener("online", auffrischen);
$("#verbindung-nochmal").addEventListener("click", auffrischen);

start();

// ------------------------------------------------------------ Als App installieren
// Der Hintergrund-Helfer (sw.js) macht die Seite installierbar. Geht nur mit verschlüsselter Verbindung (https).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* ohne https nicht möglich – Kalender geht trotzdem */ });
}
let installierAngebot = null;
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault(); // eigenen, freundlicheren Hinweis zeigen
  installierAngebot = ev;
  const bis = Number(localStorage.getItem("fk_installieren_spaeter") || 0);
  if (Date.now() > bis) $("#installieren").classList.remove("versteckt");
});
$("#installieren-ja").addEventListener("click", async () => {
  $("#installieren").classList.add("versteckt");
  if (!installierAngebot) return;
  installierAngebot.prompt();
  await installierAngebot.userChoice.catch(() => {});
  installierAngebot = null;
});
$("#installieren-nein").addEventListener("click", () => {
  $("#installieren").classList.add("versteckt");
  localStorage.setItem("fk_installieren_spaeter", String(Date.now() + 14 * 864e5)); // 2 Wochen Ruhe
});
window.addEventListener("appinstalled", () => $("#installieren").classList.add("versteckt"));
