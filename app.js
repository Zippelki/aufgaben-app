// Meine Aufgaben: lokale Speicherung mit optionalem Abgleich über Supabase.
const STATUS = ["Nicht begonnen", "In Bearbeitung", "Erledigt", "Archiviert"];
const SCLS = { "Nicht begonnen": "s-nb", "In Bearbeitung": "s-ib", "Erledigt": "s-er", "Archiviert": "s-ar" };
const PRIO = ["Hoch", "Mittel", "Niedrig"];
const PCLS = { Hoch: "p-h", Mittel: "p-m", Niedrig: "p-n" };
const FIELDS = ["titel", "status", "prio", "faellig", "begonnen", "abgeschlossen", "notiz", "erstellt", "geaendert", "geloescht"];
const DEFAULT_AUTO = { beginn: true, abschluss: true, zurueck: true, archiv: true, archivTage: 14, eilig: true, eiligTage: 2 };
const AUTO_TEXT = {
  beginn: "Status auf „In Bearbeitung“ setzt „Begonnen am“ auf heute (wenn leer)",
  abschluss: "Status auf „Erledigt“ setzt „Abgeschlossen am“ auf heute",
  zurueck: "Wird eine erledigte Aufgabe wieder geöffnet, wird „Abgeschlossen am“ geleert",
  archiv: "Erledigte Aufgaben werden nach {archivTage} Tagen automatisch archiviert",
  eilig: "Aufgaben, die in {eiligTage} Tagen oder früher fällig sind, bekommen Priorität „Hoch“",
};
const LS_TASKS = "aufgaben_v1", LS_AUTO = "automationen_v1";

let all = {};            // id -> Aufgabe (inkl. gelöschter, mit _dirty Markierung)
let auto = { ...DEFAULT_AUTO, geaendert: "" , _dirty: false };
let view = "liste", filter = "offen", editing = null;
let sb = null, session = null, syncState = "lokal", syncTimer = null, syncing = false;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
const now = () => new Date().toISOString();
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isOpen = (t) => t.status === "Nicht begonnen" || t.status === "In Bearbeitung";
const overdue = (t) => isOpen(t) && t.faellig && t.faellig < today();
const tasks = () => Object.values(all).filter((t) => !t.geloescht);

function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2800); }

/* ---------- lokale Speicherung ---------- */
function loadLocal() {
  try { all = JSON.parse(localStorage.getItem(LS_TASKS) || "{}"); } catch { all = {}; }
  try { auto = { ...DEFAULT_AUTO, ...JSON.parse(localStorage.getItem(LS_AUTO) || "{}") }; } catch {}
}
function persist() {
  try { localStorage.setItem(LS_TASKS, JSON.stringify(all)); localStorage.setItem(LS_AUTO, JSON.stringify(auto)); } catch {}
}
function put(t) { all[t.id] = { ...t, _dirty: true }; persist(); render(); scheduleSync(); }

/* ---------- Automatisierungen ---------- */
function applyRules(oldT, t) {
  const msgs = [], h = today();
  if (auto.beginn && t.status === "In Bearbeitung" && (!oldT || oldT.status !== "In Bearbeitung") && !t.begonnen) { t.begonnen = h; msgs.push("Begonnen am gesetzt"); }
  if (auto.abschluss && t.status === "Erledigt" && (!oldT || oldT.status !== "Erledigt")) { t.abgeschlossen = h; msgs.push("Abgeschlossen am gesetzt"); }
  if (auto.zurueck && oldT && oldT.status === "Erledigt" && isOpen(t) && t.abgeschlossen) { t.abgeschlossen = ""; msgs.push("Abgeschlossen am geleert"); }
  if (auto.eilig && isOpen(t) && t.faellig && t.faellig <= addDays(h, +auto.eiligTage) && t.prio !== "Hoch") { t.prio = "Hoch"; msgs.push("Priorität auf Hoch gesetzt"); }
  return msgs;
}
function runTimedRules() {
  const h = today(); let n = 0;
  for (const t of tasks()) {
    const nt = { ...t };
    if (auto.archiv && t.status === "Erledigt" && t.abgeschlossen && t.abgeschlossen <= addDays(h, -auto.archivTage)) nt.status = "Archiviert";
    if (auto.eilig && isOpen(t) && t.faellig && t.faellig <= addDays(h, +auto.eiligTage) && t.prio !== "Hoch") nt.prio = "Hoch";
    if (nt.status !== t.status || nt.prio !== t.prio) { nt.geaendert = now(); all[t.id] = { ...nt, _dirty: true }; n++; }
  }
  if (n) { persist(); render(); scheduleSync(); toast(n + " Aufgabe(n) automatisch angepasst"); }
}
function changeTask(t, patch) {
  const nt = { ...(t || {}), ...patch, geaendert: now() };
  const msgs = applyRules(t, nt);
  put(nt);
  if (msgs.length) toast("Automatisch: " + msgs.join(", "));
}
function saveAuto() { auto.geaendert = now(); auto._dirty = true; persist(); scheduleSync(); }

/* ---------- Abgleich mit Supabase ---------- */
function setSync(state, text) {
  syncState = state;
  $("#syncDot").className = "dot " + ({ ok: "ok", busy: "busy", err: "err" }[state] || "");
  $("#syncText").textContent = text;
}
function scheduleSync() { if (!session) return; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800); }
const toRow = (t) => { const r = { id: t.id }; for (const f of FIELDS) r[f] = t[f] ?? (f === "geloescht" ? false : ""); if (!r.geaendert) r.geaendert = now(); if (!r.erstellt) r.erstellt = r.geaendert; return r; };

async function sync() {
  if (!sb || !session || syncing) return;
  if (!navigator.onLine) { setSync("err", "Offline"); return; }
  syncing = true; setSync("busy", "Abgleich ...");
  try {
    const dirty = Object.values(all).filter((t) => t._dirty);
    if (dirty.length) {
      const { error } = await sb.from("aufgaben").upsert(dirty.map(toRow));
      if (error) throw error;
      for (const t of dirty) if (all[t.id] && all[t.id].geaendert === t.geaendert) delete all[t.id]._dirty;
    }
    if (auto._dirty) {
      const { _dirty, geaendert, ...a } = auto;
      const { error } = await sb.from("einstellungen").upsert({ user_id: session.user.id, automationen: a, geaendert });
      if (error) throw error;
      auto._dirty = false;
    }
    const { data, error } = await sb.from("aufgaben").select("*");
    if (error) throw error;
    for (const r of data) {
      const l = all[r.id];
      if (!l || (!l._dirty && (r.geaendert || "") > (l.geaendert || ""))) {
        const t = { id: r.id }; for (const f of FIELDS) t[f] = r[f] ?? ""; t.geloescht = !!r.geloescht; all[r.id] = t;
      }
    }
    const s = await sb.from("einstellungen").select("*").maybeSingle();
    if (!s.error && s.data && !auto._dirty && (s.data.geaendert || "") > (auto.geaendert || "")) auto = { ...DEFAULT_AUTO, ...s.data.automationen, geaendert: s.data.geaendert, _dirty: false };
    persist(); render();
    setSync("ok", "Synchron");
  } catch (e) {
    console.error(e); setSync("err", "Abgleich fehlgeschlagen");
  } finally { syncing = false; }
}

async function initSupabase() {
  const c = window.APP_CONFIG || {};
  if (!c.supabaseUrl || !c.supabaseAnonKey) { setSync("lokal", "Nur lokal"); return; }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    sb = createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((_e, s) => { session = s; updateSyncLabel(); if (s) sync(); });
    updateSyncLabel();
    if (session) await sync();
  } catch (e) { console.error(e); setSync("err", "Abgleich nicht erreichbar"); }
}
function updateSyncLabel() { if (!sb) setSync("lokal", "Nur lokal"); else if (!session) setSync("err", "Nicht angemeldet"); else setSync("ok", "Synchron"); }

/* ---------- Konto Dialog ---------- */
function openAccount() {
  const b = $("#accBody");
  if (!sb) {
    b.innerHTML = '<p>Der Abgleich ist noch nicht eingerichtet. Deine Aufgaben werden nur auf diesem Gerät gespeichert.</p>';
  } else if (!session) {
    b.innerHTML = '<p>Melde dich an, damit deine Aufgaben auf Mac und iPhone gleich sind.</p>' +
      '<div class="field"><label for="a_mail">E-Mail</label><input type="email" id="a_mail" autocomplete="username"></div>' +
      '<div class="field"><label for="a_pw">Passwort</label><input type="password" id="a_pw" autocomplete="current-password"></div>' +
      '<p><button class="btn" id="a_login">Anmelden</button> <button class="btn ghost" id="a_signup">Konto anlegen</button></p>';
    $("#a_login").onclick = () => auth("login");
    $("#a_signup").onclick = () => auth("signup");
  } else {
    b.innerHTML = '<p>Angemeldet als <b>' + esc(session.user.email) + '</b>.</p>' +
      '<p><button class="btn" id="a_sync">Jetzt abgleichen</button> <button class="btn ghost" id="a_out">Abmelden</button></p>' +
      '<div class="field"><label for="a_newpw">Neues Passwort</label><input type="password" id="a_newpw" autocomplete="new-password"></div>' +
      '<p><button class="btn ghost" id="a_setpw">Passwort ändern</button></p>';
    $("#a_sync").onclick = () => sync();
    $("#a_setpw").onclick = async () => {
      const password = $("#a_newpw").value;
      if (password.length < 6) return toast("Mindestens 6 Zeichen");
      const r = await sb.auth.updateUser({ password });
      toast(r.error ? "Fehler: " + r.error.message : "Passwort geändert");
    };
    $("#a_out").onclick = async () => { await sb.auth.signOut(); openAccount(); };
  }
  $("#account").classList.add("open");
}
async function auth(kind) {
  const email = $("#a_mail").value.trim(), password = $("#a_pw").value;
  if (!email || !password) return toast("Bitte E-Mail und Passwort eingeben");
  const r = kind === "login" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (r.error) return toast(r.error.code === "invalid_credentials" ? "E-Mail oder Passwort falsch" : "Fehler: " + r.error.message);
  if (kind === "signup" && !r.data.session) toast("Bitte bestätige die E-Mail, die dir gerade geschickt wurde");
  else { toast("Angemeldet"); $("#account").classList.remove("open"); }
}
$("#syncBtn").onclick = openAccount;
$("#accClose").onclick = () => $("#account").classList.remove("open");

/* ---------- Ansicht ---------- */
function filtered() {
  const q = $("#q").value.trim().toLowerCase(), h = today(), w = addDays(h, 7);
  const l = tasks().filter((t) => !q || (t.titel + " " + (t.notiz || "")).toLowerCase().includes(q));
  if (view === "board") return l.filter((t) => t.status !== "Archiviert");
  const f = { offen: isOpen, heute: (t) => isOpen(t) && t.faellig && t.faellig <= h, woche: (t) => isOpen(t) && t.faellig && t.faellig <= w,
    hoch: (t) => isOpen(t) && t.prio === "Hoch", erledigt: (t) => t.status === "Erledigt" || t.status === "Archiviert", alle: () => true }[filter];
  return l.filter(f);
}
function sortTasks(l) {
  const pr = { Hoch: 0, Mittel: 1, Niedrig: 2 }, k = (t) => t.faellig || "9999";
  return l.slice().sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : (pr[a.prio] ?? 3) - (pr[b.prio] ?? 3) || a.titel.localeCompare(b.titel)));
}
const byId = (id) => all[id];

function render() {
  const ts = tasks(), open = ts.filter(isOpen).length, od = ts.filter(overdue).length;
  $("#sub").textContent = open + " offen" + (od ? ", davon " + od + " überfällig" : "") + " · " + ts.length + " insgesamt";
  $("#chips").style.display = view === "liste" ? "flex" : "none";
  const v = $("#view");
  if (view === "auto") {
    v.innerHTML = '<div class="auto">' + Object.keys(AUTO_TEXT).map((k) => {
      const txt = esc(AUTO_TEXT[k]).replace("{archivTage}", '<input type="number" min="1" max="365" data-n="archivTage" value="' + auto.archivTage + '">')
        .replace("{eiligTage}", '<input type="number" min="0" max="30" data-n="eiligTage" value="' + auto.eiligTage + '">');
      return '<label><input type="checkbox" data-k="' + k + '" ' + (auto[k] ? "checked" : "") + "><span>" + txt + "</span></label>";
    }).join("") + "</div>";
    v.querySelectorAll("[data-k]").forEach((c) => (c.onchange = () => { auto[c.dataset.k] = c.checked; saveAuto(); }));
    v.querySelectorAll("[data-n]").forEach((c) => (c.onchange = () => { auto[c.dataset.n] = Math.max(0, parseInt(c.value) || 0); saveAuto(); }));
    return;
  }
  const l = sortTasks(filtered());
  if (view === "liste") {
    if (!l.length) { v.innerHTML = '<div class="empty">' + (ts.length ? "Keine Aufgaben in dieser Ansicht." : "Noch keine Aufgaben. Melde dich oben rechts an oder lege eine neue Aufgabe an.") + "</div>"; return; }
    v.innerHTML = '<div class="tablewrap"><table><thead><tr><th>Aufgabe</th><th>Status</th><th class="hide-m">Priorität</th><th class="hide-m">Fällig</th><th class="hide-m">Begonnen</th><th class="hide-m">Abgeschlossen</th></tr></thead><tbody>' +
      l.map((t) => '<tr class="row" data-id="' + esc(t.id) + '"><td class="title">' + esc(t.titel) +
        '<div class="mmeta">' + (t.prio ? '<span class="tag ' + PCLS[t.prio] + '">' + t.prio + "</span> " : "") + (t.faellig ? '<span class="' + (overdue(t) ? "over" : "") + '">' + fmt(t.faellig) + "</span>" : "") + "</div></td>" +
        '<td><select data-st="' + esc(t.id) + '">' + STATUS.map((s) => "<option" + (s === t.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select></td>" +
        '<td class="hide-m">' + (t.prio ? '<span class="tag ' + PCLS[t.prio] + '">' + t.prio + "</span>" : "") + "</td>" +
        '<td class="hide-m ' + (overdue(t) ? "over" : "") + '">' + fmt(t.faellig) + "</td>" +
        '<td class="hide-m">' + fmt(t.begonnen) + '</td><td class="hide-m">' + fmt(t.abgeschlossen) + "</td></tr>").join("") + "</tbody></table></div>";
    v.querySelectorAll("tr.row").forEach((r) => (r.onclick = () => openPanel(byId(r.dataset.id))));
    v.querySelectorAll("[data-st]").forEach((s) => { s.onclick = (e) => e.stopPropagation(); s.onchange = () => changeTask(byId(s.dataset.st), { status: s.value }); });
  } else {
    const cols = STATUS.slice(0, 3);
    v.innerHTML = '<div class="board">' + cols.map((s, ci) => {
      const cs = l.filter((t) => t.status === s);
      return '<div class="col" data-col="' + s + '"><div class="colh"><span class="tag ' + SCLS[s] + '">' + s + '</span><span style="color:var(--muted)">' + cs.length + "</span></div>" +
        cs.map((t) => '<div class="card" draggable="true" data-id="' + esc(t.id) + '"><div class="title">' + esc(t.titel) + '</div><div class="meta">' +
          (t.prio ? '<span class="tag ' + PCLS[t.prio] + '">' + t.prio + "</span>" : "") + (t.faellig ? '<span class="' + (overdue(t) ? "over" : "") + '">' + fmt(t.faellig) + "</span>" : "") + "</div>" +
          '<div class="move">' + (ci > 0 ? '<button data-mv="' + cols[ci - 1] + '">Zurück</button>' : "") + (ci < 2 ? '<button data-mv="' + cols[ci + 1] + '">Weiter</button>' : "") + "</div></div>").join("") + "</div>";
    }).join("") + "</div>";
    v.querySelectorAll(".card").forEach((c) => {
      c.onclick = (e) => { const mv = e.target.closest("[data-mv]"); if (mv) { e.stopPropagation(); changeTask(byId(c.dataset.id), { status: mv.dataset.mv }); } else openPanel(byId(c.dataset.id)); };
      c.ondragstart = (e) => e.dataTransfer.setData("text/plain", c.dataset.id);
    });
    v.querySelectorAll(".col").forEach((col) => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add("drop"); };
      col.ondragleave = () => col.classList.remove("drop");
      col.ondrop = (e) => { e.preventDefault(); col.classList.remove("drop"); const t = byId(e.dataTransfer.getData("text/plain")); if (t && t.status !== col.dataset.col) changeTask(t, { status: col.dataset.col }); };
    });
  }
}

/* ---------- Bearbeiten ---------- */
function openPanel(t) {
  editing = t || null;
  $("#ptitle").textContent = t ? "Aufgabe bearbeiten" : "Neue Aufgabe";
  $("#f_status").innerHTML = STATUS.map((s) => "<option>" + s + "</option>").join("");
  $("#f_prio").innerHTML = '<option value="">Keine</option>' + PRIO.map((s) => "<option>" + s + "</option>").join("");
  $("#f_titel").value = t?.titel || ""; $("#f_status").value = t?.status || "Nicht begonnen"; $("#f_prio").value = t?.prio ?? "Mittel";
  $("#f_faellig").value = t?.faellig || ""; $("#f_begonnen").value = t?.begonnen || ""; $("#f_abgeschlossen").value = t?.abgeschlossen || "";
  $("#f_notiz").value = t?.notiz || ""; $("#del").style.visibility = t ? "visible" : "hidden";
  $("#panel").classList.add("open");
  if (!t) setTimeout(() => $("#f_titel").focus(), 50);
}
const closePanel = () => $("#panel").classList.remove("open");
$("#cancel").onclick = closePanel;
$("#panel").onclick = (e) => { if (e.target.id === "panel") closePanel(); };
$("#account").onclick = (e) => { if (e.target.id === "account") $("#account").classList.remove("open"); };
$("#save").onclick = () => {
  const titel = $("#f_titel").value.trim(); if (!titel) { $("#f_titel").focus(); return; }
  const patch = { titel, status: $("#f_status").value, prio: $("#f_prio").value, faellig: $("#f_faellig").value,
    begonnen: $("#f_begonnen").value, abgeschlossen: $("#f_abgeschlossen").value, notiz: $("#f_notiz").value };
  closePanel();
  if (editing) changeTask(editing, patch);
  else changeTask(null, { id: newId(), erstellt: now(), geloescht: false, ...patch });
};
$("#del").onclick = () => { if (editing && confirm("Aufgabe wirklich löschen?")) { closePanel(); put({ ...editing, geloescht: true, geaendert: now() }); toast("Gelöscht"); } };
$("#neu").onclick = () => openPanel(null);
$("#q").oninput = render;
$("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; view = b.dataset.v; document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b)); render(); };
$("#chips").onclick = (e) => { const c = e.target.closest(".chip"); if (!c) return; filter = c.dataset.f; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); render(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); $("#account").classList.remove("open"); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { runTimedRules(); sync(); } });
window.addEventListener("online", () => sync());
setInterval(() => { if (document.visibilityState === "visible") sync(); }, 60000);

/* ---------- Start ---------- */
loadLocal();
render();
runTimedRules();
initSupabase();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
