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
};

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
    throw Object.assign(new Error("Keine Verbindung zum Pi. Bist du im Heimnetz oder im VPN?"), { status: 0 });
  }
  let inhalt = {};
  try { inhalt = await r.json(); } catch (e) { /* leer */ }
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
    zelle.addEventListener("click", () => { zustand.gewaehlt = tag; zeichneKalender(); });
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
}

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

// ------------------------------------------------------------ Monat wechseln
function monatPlus(n) {
  let m = zustand.monat + n, j = zustand.jahr;
  while (m < 0) { m += 12; j--; }
  while (m > 11) { m -= 12; j++; }
  zustand.monat = m; zustand.jahr = j;
  zustand.gewaehlt = d2s(new Date(Date.UTC(j, m, 1)));
  zeichneKalender();
}
$("#monat-zurueck").addEventListener("click", () => monatPlus(-1));
$("#monat-vor").addEventListener("click", () => monatPlus(1));
$("#heute").addEventListener("click", () => {
  const j = new Date(); zustand.jahr = j.getFullYear(); zustand.monat = j.getMonth(); zustand.gewaehlt = heute(); zeichneKalender();
});
// Wischen nach links/rechts wechselt den Monat
let wischX = null;
$("#raster").addEventListener("touchstart", (ev) => { wischX = ev.touches[0].clientX; }, { passive: true });
$("#raster").addEventListener("touchend", (ev) => {
  if (wischX === null) return;
  const dx = ev.changedTouches[0].clientX - wischX;
  wischX = null;
  if (Math.abs(dx) > 60) monatPlus(dx < 0 ? 1 : -1);
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

function oeffneTermin(e) {
  zustand.bearbeitet = e || null;
  formT.reset();
  $("#termin-fehler").textContent = "";
  $("#termin-ueberschrift").textContent = e ? "Termin bearbeiten" : "Neuer Termin";
  $("#termin-loeschen").classList.toggle("versteckt", !e);
  const t = e || { title: "", start_date: zustand.gewaehlt, end_date: zustand.gewaehlt, all_day: true,
    start_time: "", end_time: "", repeat: "none", repeat_until: "", location: "", notes: "",
    participants: [zustand.ich.id] };
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
  }
  $("#termin-info").textContent = info;
  zeitFelderAnpassen();
  $("#dlg-termin").showModal();
}

$("#neu").addEventListener("click", () => oeffneTermin(null));
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
  const admin = zustand.ich.role === "admin";
  $("#verwaltung").classList.toggle("versteckt", !admin);
  $("#import-knopf").classList.toggle("versteckt", !admin);
  if (admin) await zeigeBenutzer();
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
      if (b.status === "active") knopf("Neues Passwort", async () => {
        const pw = prompt("Neues Passwort für " + b.display_name + " (mind. 8 Zeichen):");
        if (pw) { await aktion("passwort", { password: pw }); alert("Passwort geändert. Sag es " + b.display_name + " persönlich."); }
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

$("#abmelden").addEventListener("click", async () => {
  try { await api("POST", "/api/abmelden"); } catch (e) { /* egal */ }
  $("#dlg-einstellungen").close();
  zustand.ich = null;
  await start();
});

// Alle 60 Sekunden neu laden, damit Änderungen der anderen ankommen
setInterval(() => {
  if (zustand.ich && document.visibilityState === "visible" && !$("#dlg-termin").open) ladeDaten().catch(() => {});
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (zustand.ich && document.visibilityState === "visible") ladeDaten().catch(() => {});
});

start();
