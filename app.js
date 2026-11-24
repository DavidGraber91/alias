// app.js — המסכים והחיבור בין המשחק לדפדפן, בגרסת הרב-שחקנים.
//
// המצב של המשחק גר בחדר משותף (store.js). כל טלפון מציג אותו לפי התפקיד שלו:
//   מסביר/ה — הטלפון שלחץ "אני מסביר/ה". רק אצלו מוצגת המילה, ורק הוא מסמן נכון/דלג/אסור.
//   צופה    — כל שאר הטלפונים. רואים את הטיימר ואת המילים שכבר קיבלו תוצאה, בלי המילה הנוכחית.
// אין תור קבוע בין הטלפונים: בשלב ההכנה כל טלפון יכול לקחת את התור.
//
// כל הטקסטים נמצאים ב-strings.js (STR). הקובץ הזה משמש גם את האתר וגם את אפליקציית האנדרואיד.

import * as G from "./game.js";
import * as R from "./room.js";
import { quip } from "./quips.js";
import { openStore, isOnline, preload } from "./store.js";
import { STR, t as tpl } from "./strings.js";
import { WEB_URL } from "./app-config.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const $net = document.getElementById("net");
const KEY_SETTINGS = "alias.settings.v1";
const DENIED_MSG = STR.net.denied;
const KEY_LAST_ROOM = "alias.lastRoom.v1"; // ב-sessionStorage: רענון חוזר לחדר, לשונית חדשה לא "חוטפת" חדר של לשונית אחרת
const KEY_CLIENT = "alias.client.v1"; // ב-sessionStorage: כל לשונית/טלפון הוא "שחקן" נפרד

// window.AliasNative קיים רק בתוך אפליקציית האנדרואיד (ראו android/.../MainActivity.kt). באתר הוא undefined.
const native = window.AliasNative ?? null;
// באתר כל לשונית היא שחקן נפרד, ולכן sessionStorage. באפליקציה יש חלון אחד, ו-localStorage שורד גם סגירה של האפליקציה.
const ROOM_AREA = native ? "local" : "session";

const S = {
  levels: [],
  words: [],
  counts: {},
  settings: null,
  clientId: null,
  store: null, // החדר הפעיל
  code: null,
  room: null, // המצב האחרון שהתקבל מהחדר
  stopRoom: null,
  stopNet: null,
  viewKey: "",
  tick: null,
  fired: null, // מונע שליחה כפולה של "הזמן נגמר"
  lastSecs: -1,
  lastEntryCount: 0,
  wake: null,
};

/* ───────────── עזרים ───────────── */

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// מספרים עם סימן נשארים בכיוון קריאה תקין בתוך טקסט עברי
const num = (t) => `<span class="num">${t}</span>`;
const signed = (n) => num(n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const wordsLabel = (n) =>
  n === 0 ? STR.common.wordsNone : n === 1 ? STR.common.wordsOne : tpl(STR.common.words, { n });

function fmtEstimate({ min, max }) {
  if (min === max) return min === 1 ? STR.common.minutesAboutOne : tpl(STR.common.minutesAbout, { n: num(min) });
  return tpl(STR.common.minutesAbout, { n: num(`${min}–${max}`) });
}

const vibrate = (pattern) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* לא נתמך — לא קריטי */
  }
};

const load = (key, area = "local") => {
  try {
    return JSON.parse((area === "session" ? sessionStorage : localStorage).getItem(key));
  } catch {
    return null;
  }
};
const save = (key, value, area = "local") => {
  try {
    const store = area === "session" ? sessionStorage : localStorage;
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    /* אחסון חסום — המשחק עדיין עובד */
  }
};

function makeClientId() {
  const existing = load(KEY_CLIENT, ROOM_AREA);
  if (typeof existing === "string" && existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  save(KEY_CLIENT, id, ROOM_AREA);
  return id;
}

// הודעה קצרה. אלמנט popover קבוע בדף, כדי שיופיע מעל הכול וקורא מסך יקריא אותו (role="status").
let toastTimer = 0;
function toast(message, ms = 2200) {
  clearTimeout(toastTimer);
  $toast.textContent = message;
  try {
    $toast.showPopover();
  } catch {
    /* כבר פתוח, או שהדפדפן לא תומך — ההודעה עדיין מוצגת */
  }
  toastTimer = setTimeout(() => {
    try {
      $toast.hidePopover();
    } catch {
      /* ignore */
    }
    $toast.textContent = "";
  }, ms);
}

const quipHtml = (kind) => `<p class="quip">${esc(quip(kind))}</p>`;

function show(html, screen) {
  document.body.dataset.screen = screen;
  $app.innerHTML = `<main class="screen ${screen}">${html}</main>`;
}

const usableLevelIds = () => S.levels.filter((l) => (S.counts[l.id] ?? 0) > 0).map((l) => l.id);

/* ───────────── צליל, מסך דלוק, טיימרים ───────────── */

let audio = null;
function ensureAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    audio = null;
  }
}
function beep(freq = 880, ms = 150, volume = 0.15) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + ms / 1000);
}
function beepEnd() {
  beep(880, 180);
  setTimeout(() => beep(880, 180), 260);
  setTimeout(() => beep(620, 420), 520);
}

async function acquireWakeLock() {
  releaseWakeLock();
  if (native?.keepScreenOn) {
    // באפליקציה: דגל "מסך דלוק" של החלון (WebView לא תומך אמין ב-navigator.wakeLock)
    native.keepScreenOn(true);
    S.wake = { release: () => native.keepScreenOn(false) };
    return;
  }
  try {
    S.wake = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    S.wake = null;
  }
}
function releaseWakeLock() {
  try {
    S.wake?.release();
  } catch {
    /* כבר שוחרר */
  }
  S.wake = null;
}
const timedPhase = () => S.room?.phase === "PLAYING" || S.room?.phase === "LAST_CHANCE";
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && timedPhase()) acquireWakeLock();
});

function stopTimers() {
  clearInterval(S.tick);
  S.tick = null;
}

/* ───────────── חדר: חיבור, פעולות, סנכרון ───────────── */

const CONNECT_TIMEOUT_MS = 8000;

// מחכה לערך הראשון מהחדר, בלי להישאר מנוי
function peek(store) {
  return new Promise((resolve, reject) => {
    let stop = null;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => stop?.());
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("timeout")), CONNECT_TIMEOUT_MS);
    stop = store.subscribe((state) => finish(resolve, state), (err) => finish(reject, err));
  });
}

function attach(store, code) {
  detach();
  S.store = store;
  S.code = code;
  S.room = null;
  S.viewKey = "";
  S.fired = null;
  S.stopRoom = store.subscribe(onRoom, onStoreError);
  S.stopNet = store.onConnection((ok) => {
    $net.textContent = ok ? "" : STR.net.offline;
  });
  save(KEY_LAST_ROOM, code, ROOM_AREA);
}

function detach() {
  stopTimers();
  releaseWakeLock();
  S.stopRoom?.();
  S.stopNet?.();
  S.store?.close();
  S.store = S.stopRoom = S.stopNet = null;
  S.code = null;
  S.room = null;
  S.viewKey = "";
  $net.textContent = "";
}

/** מצטרף לחדר קיים. מחזיר { ok: true } או { ok: false, reason: "notfound" | "offline" } */
async function joinRoom(code) {
  let store;
  try {
    store = await openStore(code);
    const state = await peek(store);
    if (state === null) {
      store.close();
      return { ok: false, reason: "notfound" };
    }
    attach(store, code);
    return { ok: true };
  } catch (err) {
    console.error(err);
    store?.close();
    return { ok: false, reason: err?.message === "permission_denied" ? "denied" : "offline" };
  }
}

/** יוצר חדר חדש מההגדרות ומתחבר אליו */
async function createRoom(settings) {
  const initial = R.createRoomState(settings, S.words);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = R.newCode();
    const store = await openStore(code);
    const res = await store.transact((cur) => (cur ? null : initial)); // לא דורסים חדר קיים
    if (res.committed) {
      attach(store, code);
      return true;
    }
    store.close();
  }
  return false;
}

function onStoreError(err) {
  console.error(err);
  if (err?.message === "permission_denied") toast(DENIED_MSG, 6000);
}

function leaveRoom() {
  save(KEY_LAST_ROOM, null, ROOM_AREA);
  detach();
  goHome();
}

/** שולח פעולה לחדר. מחזיר true אם התקבלה. */
async function dispatch(action) {
  if (!S.store) return false;
  const full = {
    ti: S.room?.game.turnIndex,
    ...action,
    by: S.clientId,
    now: S.store.serverNow(),
  };
  try {
    const res = await S.store.transact((cur) => R.reduce(cur, full));
    return res.committed;
  } catch (err) {
    console.error(err);
    toast(STR.net.actionFailed);
    return false;
  }
}

function onRoom(state) {
  if (state === null) {
    // החדר נמחק מתחת לרגליים שלנו
    if (S.store) {
      toast(STR.net.roomClosed);
      save(KEY_LAST_ROOM, null, ROOM_AREA);
      detach();
      goHome();
    }
    return;
  }
  S.room = state;
  renderRoom();
}

/* ───────────── תצוגה לפי מצב החדר ───────────── */

const viewKeyOf = (st, role) => [st.phase, role, st.game.turnIndex, st.game.tiebreak].join("|");

function renderRoom() {
  const st = S.room;
  if (!st) return;
  const role = R.roleOf(st, S.clientId);
  const key = viewKeyOf(st, role);
  if (key !== S.viewKey) {
    S.viewKey = key;
    enterView(st, role);
  } else {
    updateView(st, role);
  }
  if (timedPhase()) {
    if (!S.wake) acquireWakeLock();
    if (!S.tick) S.tick = setInterval(tickRoom, 100);
    tickRoom();
  } else {
    stopTimers();
    releaseWakeLock();
  }
}

function enterView(st, role) {
  switch (st.phase) {
    case "READY":
      return goReady(st);
    case "PLAYING":
      return role === "explainer" ? goPlaying(st) : goWatching(st);
    case "LAST_CHANCE":
      return role === "explainer" ? goLastChance(st) : goLastChanceWatching(st);
    case "SUMMARY":
      return goSummary(st, role);
    case "TIEBREAK":
      return goTiebreak(st);
    case "GAMEOVER":
      return goGameOver(st);
    default:
      return goHome();
  }
}

function updateView(st, role) {
  if (st.phase === "PLAYING") {
    if (role === "explainer") refreshWord(st, true);
    else refreshLog(st);
  } else if (st.phase === "SUMMARY") {
    rerenderSummary(st, role);
  }
}

/* ───────────── רכיבים משותפים ───────────── */

// פס החדר: הקוד, העתקה, שיתוף ויציאה. הכפתורים מוגדרים בהצהרה (command/commandfor), בלי JS לכל כפתור.
function roomBar() {
  return `
    <div class="roombar">
      <span class="pill">${STR.roomBar.room} <span class="num" id="room-code">${esc(S.code)}</span></span>
      <span class="copy">
        <button type="button" class="link copy-button" command="--copy" commandfor="room-code">${STR.roomBar.copyCode}</button>
        <span class="tip" role="status"></span>
      </span>
      <button type="button" class="link" data-action="share">${STR.roomBar.share}</button>
      <button type="button" class="link" command="show-modal" commandfor="leave-dialog">${STR.roomBar.leave}</button>
    </div>`;
}

// מי שהמסביר/ה נעלם/ה (הטלפון כבה, נסגר הדף) יכול לקחת את השליטה
const takeoverHtml = () => `
  <details class="help">
    <summary>${STR.takeover.summary}</summary>
    <p>${STR.takeover.text}</p>
    <button type="button" class="btn" data-action="takeover">${STR.takeover.button}</button>
  </details>`;

function entryLines(st, editable) {
  const g = st.game;
  const entries = editable ? g.turn.entries : R.resolvedEntries(st);
  return entries
    .map((e, i) =>
      editable
        ? `<button type="button" class="entry" data-action="cycle" data-value="${i}"><span>${esc(e.word)}</span>${badge(e, g)}</button>`
        : `<li class="entry"><span>${esc(e.word)}</span>${badge(e, g)}</li>`,
    )
    .join("");
}

/* ───────────── בית ושיתוף ───────────── */

function goHome() {
  stopTimers();
  releaseWakeLock();
  S.viewKey = "";
  show(
    `
    <div class="hero">
      <h1 class="title-sticker">${STR.home.title}</h1>
      <p class="tagline">${STR.home.tagline.join("<br>")}</p>
      ${quipHtml("home")}
    </div>
    <div class="stack">
      <button class="btn primary big" data-action="new">${STR.home.newGame}</button>
      <form class="join" data-form="join" aria-labelledby="join-title">
        <h2 id="join-title">${STR.home.joinTitle}</h2>
        <div class="join-row">
          <input class="field num-input" id="join-code" name="code" inputmode="numeric" pattern="[0-9]{${R.CODE_LENGTH}}" maxlength="${R.CODE_LENGTH}" minlength="${R.CODE_LENGTH}" required autocomplete="off" spellcheck="false" aria-label="${tpl(STR.home.joinAria, { n: R.CODE_LENGTH })}" aria-invalid="false" data-error="join-format-error" placeholder="${"0".repeat(R.CODE_LENGTH)}">
          <button class="btn" type="submit">${STR.home.joinButton}</button>
        </div>
        <p class="error-msg" id="join-format-error"><span role="img" aria-label="${STR.common.error}">⚠️</span> ${tpl(STR.home.joinFormatError, { n: R.CODE_LENGTH })}</p>
        <p class="error-msg shown" id="join-error" role="alert"></p>
      </form>
      <button class="btn ghost" data-action="howto">${STR.home.howTo}</button>
      <button class="btn ghost" data-action="share">${STR.home.shareGame}</button>
      ${native ? "" : `<a class="link seo-link" href="how-to-play.html">${STR.home.fullRules}</a>`}
      ${isOnline ? "" : `<p class="note-local">${STR.home.localNote}</p>`}
    </div>`,
    "home",
  );
  window.scrollTo(0, 0);
}

function goHowTo() {
  stopTimers();
  S.viewKey = "";
  show(
    `
    <header class="topbar"><button class="link" data-action="home">${STR.common.back}</button></header>
    <h1 class="page-title">${STR.howTo.title}</h1>
    <section class="panel howto">
      <ul>${STR.howTo.items.map((item) => `<li>${item}</li>`).join("")}</ul>
    </section>`,
    "howto",
  );
  window.scrollTo(0, 0);
}

function shareUrl() {
  // לאפליקציה אין כתובת ציבורית משלה, ולכן משתפים את כתובת האתר (WEB_URL ב-app-config.js). בלי כתובת משתפים רק טקסט.
  const base = native ? WEB_URL : location.href;
  if (!base) return "";
  const url = new URL(base);
  url.hash = "";
  url.search = "";
  if (S.code) url.searchParams.set("room", S.code);
  return url.toString();
}

async function share() {
  const url = shareUrl();
  const text = S.code ? tpl(STR.share.textWithCode, { code: S.code }) : STR.share.text;
  if (native?.share) {
    native.share(text, url); // חלון השיתוף של אנדרואיד
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: STR.share.title, text, url });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(STR.share.copied);
  } catch {
    const dialog = document.getElementById("share-dialog");
    const input = dialog.querySelector("input");
    input.value = url;
    dialog.showModal();
    input.select();
  }
}

/* ───────────── הגדרות ───────────── */

function goSetup() {
  stopTimers();
  S.viewKey = "";
  show(setupHtml(), "setup");
  window.scrollTo(0, 0);
}

function rerenderSetup() {
  const y = window.scrollY;
  // המסך נבנה מחדש אחרי כל שינוי, אז זוכרים איזה פקד היה בפוקוס ומחזירים אליו אותו (למקלדת ולקוראי מסך)
  const a = document.activeElement;
  let selector = null;
  if (a?.dataset?.level !== undefined) selector = `[data-level="${CSS.escape(a.dataset.level)}"]`;
  else if (a?.dataset?.action) {
    selector = `[data-action="${a.dataset.action}"]`;
    if (a.dataset.value !== undefined) selector += `[data-value="${CSS.escape(a.dataset.value)}"]`;
  }
  show(setupHtml(), "setup");
  window.scrollTo(0, y);
  if (selector) {
    const next = $app.querySelector(selector);
    if (next && !next.disabled) next.focus({ preventScroll: true });
  }
}

function setupHtml() {
  const s = S.settings;
  const est = G.estimateMinutes(s);
  const pool = G.poolFor(S.words, s.levels).length;
  const needed = G.wordsNeeded(s);
  const canStart = s.levels.length > 0 && pool > 0;

  const chip = (action, value, label, on) =>
    `<button type="button" class="chip${on ? " on" : ""}" data-action="${action}" data-value="${value}" aria-pressed="${on}">${label}</button>`;

  const stepper = (name, value, min, max) => `
    <div class="stepper">
      <button type="button" class="step" data-action="${name}-dec" aria-label="${STR.common.less}" ${value <= min ? "disabled" : ""}>−</button>
      <output>${value}</output>
      <button type="button" class="step" data-action="${name}-inc" aria-label="${STR.common.more}" ${value >= max ? "disabled" : ""}>+</button>
    </div>`;

  const teamFields = s.teams
    .map(
      (name, i) =>
        `<input class="field" data-team="${i}" value="${esc(name)}" maxlength="20" placeholder="${esc(G.defaultTeamName(i))}" aria-label="${tpl(STR.setup.teamAria, { n: i + 1 })}" autocomplete="off">`,
    )
    .join("");

  const levelCards = S.levels
    .map((l) => {
      const count = S.counts[l.id] ?? 0;
      const on = s.levels.includes(l.id);
      return `
      <label class="level${on ? " on" : ""}${count === 0 ? " off" : ""}">
        <input class="sr" type="checkbox" data-level="${esc(l.id)}" ${on ? "checked" : ""} ${count === 0 ? "disabled" : ""}>
        <span class="tick" aria-hidden="true">${on ? "✓" : ""}</span>
        <span class="icon" aria-hidden="true">${esc(l.icon ?? "📝")}</span>
        <span class="info"><b>${esc(l.name)}</b>${l.description ? `<small>${esc(l.description)}</small>` : ""}</span>
        <span class="count">${wordsLabel(count)}</span>
      </label>`;
    })
    .join("");

  const poolNote = canStart
    ? `<p class="note">${tpl(STR.setup.poolSelected, { words: wordsLabel(pool) })}</p>`
    : `<p class="note">${STR.setup.poolNone}</p>`;
  const poolWarning =
    canStart && pool < needed
      ? `<p class="warning">${tpl(STR.setup.poolWarning, { pool: wordsLabel(pool), needed: num(needed) })}</p>`
      : "";

  const lastChanceOptions = s.lastChance
    ? `
      <p class="sub">${STR.setup.lastChanceSeconds}</p>
      <div class="chips">${G.LAST_CHANCE_OPTIONS.map((v) =>
        chip("lc-secs", v, v === 0 ? STR.setup.untilTap : tpl(STR.common.seconds, { n: num(v) }), s.lastChanceSeconds === v),
      ).join("")}</div>
      <p class="sub">${tpl(STR.setup.stealPoints, { delta: signed(1) })}</p>
      <div class="chips">${[1, 2].map((v) => chip("steal", v, signed(v), s.stealPoints === v)).join("")}</div>`
    : "";

  return `
    <header class="topbar"><button class="link" data-action="home">${STR.common.back}</button></header>
    <h1 class="page-title">${STR.setup.title}</h1>

    <section class="panel">
      <h2>${STR.setup.teams}</h2>
      <div class="row"><span>${STR.setup.teamsCount}</span>${stepper("teams", s.teams.length, G.LIMITS.minTeams, G.LIMITS.maxTeams)}</div>
      ${teamFields}
    </section>

    <section class="panel">
      <h2>${STR.setup.rounds}</h2>
      <div class="row"><span>${STR.setup.roundsRow}</span>${stepper("rounds", s.rounds, G.LIMITS.minRounds, G.LIMITS.maxRounds)}</div>
      <div class="estimate"><span>${STR.setup.estimate}</span><b>${fmtEstimate(est)}</b></div>
      <p class="sub">${tpl(STR.setup.turnsTotal, { n: num(G.totalTurns(s)) })}</p>
    </section>

    <section class="panel">
      <h2>${STR.setup.turnTime}</h2>
      <div class="chips">${G.TURN_SECONDS_OPTIONS.map((v) =>
        chip("turn-secs", v, tpl(STR.common.seconds, { n: num(v) }), s.turnSeconds === v),
      ).join("")}</div>
    </section>

    <section class="panel">
      <h2>${STR.setup.levels}</h2>
      <p class="sub">${STR.setup.levelsHint}</p>
      <div class="levels">${levelCards}</div>
      ${poolNote}
      ${poolWarning}
    </section>

    <section class="panel">
      <h2>${STR.setup.skip}</h2>
      <div class="chips">
        ${chip("skip-mode", "penalty", tpl(STR.setup.skipPenalty, { delta: signed(-1) }), s.skip === "penalty")}
        ${chip("skip-mode", "free", STR.setup.skipFree, s.skip === "free")}
        ${chip("skip-mode", "off", STR.setup.skipOff, s.skip === "off")}
      </div>
    </section>

    <section class="panel">
      <div class="row">
        <label class="switch-label" for="lc-switch"><h2>${STR.setup.lastChance}</h2></label>
        <input type="checkbox" switch role="switch" class="switch" id="lc-switch" data-switch="lc" ${s.lastChance ? "checked" : ""}>
      </div>
      <p class="sub">${STR.setup.lastChanceHint}</p>
      ${lastChanceOptions}
    </section>

    <div class="footer">
      <button class="btn primary big" data-action="start" ${canStart ? "" : "disabled"}>${STR.setup.start}</button>
    </div>`;
}

async function startGame() {
  const s = S.settings;
  if (G.poolFor(S.words, s.levels).length === 0) return;
  save(KEY_SETTINGS, s);
  try {
    const ok = await createRoom(s);
    if (!ok) toast(STR.net.createFailed, 3200);
  } catch (err) {
    console.error(err);
    toast(err?.message === "permission_denied" ? DENIED_MSG : STR.net.createFailedOffline, 6000);
  }
}

/* ───────────── הכנה לתור ───────────── */

function goReady(st) {
  const g = st.game;
  const idx = G.currentTeamIdx(g);
  const round = G.roundInfo(g);
  const roundText = round.tiebreak
    ? STR.ready.tiebreakRound
    : tpl(STR.ready.round, { n: num(round.number), total: num(round.total) });
  const skipText = { penalty: STR.ready.skipPenalty, free: STR.ready.skipFree, off: STR.ready.skipOff }[g.settings.skip];
  const rows = g.teams
    .map(
      (t, i) =>
        `<div class="score-row${i === idx ? " now" : ""}"><span>${esc(t.name)}</span><b>${num(t.score)}</b></div>`,
    )
    .join("");

  show(
    `
    ${roomBar()}
    <header class="topbar"><span class="pill">${roundText}</span></header>
    <div class="center">
      <p class="lead">${STR.ready.turnOf}</p>
      <h1 class="team-title">${esc(g.teams[idx].name)}</h1>
      <div class="pills">
        <span class="pill">${tpl(STR.common.seconds, { n: num(g.settings.turnSeconds) })}</span>
        <span class="pill">${skipText}</span>
        ${g.settings.lastChance ? `<span class="pill">${STR.ready.lastChancePill}</span>` : ""}
      </div>
      <div class="score-list">${rows}</div>
      <p class="lead">${STR.ready.lead.join("<br>")}</p>
      ${quipHtml("ready")}
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="claim">${STR.ready.claim}</button>
    </div>`,
    "ready",
  );
  window.scrollTo(0, 0);
}

async function claim() {
  if (S.room?.phase !== "READY") return;
  ensureAudio();
  const ok = await dispatch({ type: "claim" });
  if (!ok) toast(STR.net.alreadyClaimed);
}

/* ───────────── משחק: המסביר/ה ───────────── */

function wordSize(word) {
  return word.length > 14 ? "w-s" : word.length > 8 ? "w-m" : "w-l";
}

function goPlaying(st) {
  const g = st.game;
  const team = g.teams[g.turn.teamIdx];
  const skip = g.settings.skip;
  const skipButton =
    skip === "off"
      ? ""
      : `<button class="btn" data-action="skip">${STR.play.skip}${skip === "penalty" ? `<small>${signed(-1)}</small>` : ""}</button>`;

  show(
    `
    <div class="play-top">
      <span class="pill">${esc(team.name)}</span>
      <span class="pill" id="tally"></span>
    </div>
    <div class="timer-wrap" id="timer-wrap">
      <div class="timer" id="timer">${g.settings.turnSeconds}</div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <div class="word-box">
      <div class="word-card" id="card"><div class="word" id="word"></div></div>
    </div>
    <div class="actions">
      <button class="btn good big" data-action="correct">${STR.play.correct}</button>
      <div class="row2${skipButton ? "" : " one"}">
        ${skipButton}
        <button class="btn bad" data-action="taboo">${STR.play.taboo}<small>${signed(-2)}</small></button>
      </div>
    </div>`,
    "play",
  );
  window.scrollTo(0, 0);
  S.lastSecs = -1;
  S.lastEntryCount = -1;
  refreshWord(st, false);
}

function refreshWord(st, animate) {
  const entry = G.currentEntry(st.game);
  const word = document.getElementById("word");
  const card = document.getElementById("card");
  if (!entry || !word || !card) return;
  const count = st.game.turn.entries.length;
  const changed = count !== S.lastEntryCount;
  S.lastEntryCount = count;
  if (!changed) return;
  word.textContent = entry.word;
  word.className = `word ${wordSize(entry.word)}`;
  const correct = st.game.turn.entries.filter((e) => e.result === "correct").length;
  const tally = document.getElementById("tally");
  if (tally) tally.innerHTML = `✓ ${num(correct)}`;
  if (animate) {
    card.classList.toggle("alt");
    card.classList.remove("pop");
    void card.offsetWidth; // מאתחל את האנימציה
    card.classList.add("pop");
  }
}

function answer(result) {
  const st = S.room;
  if (st?.phase !== "PLAYING" || R.roleOf(st, S.clientId) !== "explainer") return;
  vibrate(result === "taboo" ? [30, 40, 30] : 20);
  dispatch({ type: "answer", result, n: st.game.turn.entries.length });
  // מדי פעם עקיצה קצרה באמצע המשחק, לא על כל מילה ולא כשכבר יש אחת על המסך
  if (result === "correct" && Math.random() < 0.18 && $toast.textContent === "") toast(quip("play"), 2000);
}

/* ───────────── משחק: הצופים ───────────── */

function goWatching(st) {
  const g = st.game;
  const team = g.teams[g.turn.teamIdx];
  show(
    `
    ${roomBar()}
    <div class="play-top">
      <span class="pill">${esc(team.name)}</span>
      <span class="pill" id="tally"></span>
    </div>
    <div class="timer-wrap" id="timer-wrap">
      <div class="timer" id="timer">${g.settings.turnSeconds}</div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <p class="lead center-text">${STR.play.watching}</p>
    <ol class="entries log" id="log" role="log" aria-label="${STR.play.logAria}"></ol>
    ${takeoverHtml()}`,
    "watch",
  );
  window.scrollTo(0, 0);
  S.lastEntryCount = -1;
  refreshLog(st);
}

function refreshLog(st) {
  const log = document.getElementById("log");
  if (!log) return;
  const resolved = R.resolvedEntries(st);
  if (resolved.length === S.lastEntryCount) return;
  S.lastEntryCount = resolved.length;
  const correct = resolved.filter((e) => e.result === "correct").length;
  const tally = document.getElementById("tally");
  if (tally) tally.innerHTML = `✓ ${num(correct)}`;
  // החדשה למעלה, כדי שלא צריך לגלול
  const g = st.game;
  log.innerHTML =
    resolved.length === 0
      ? `<li class="entry empty">${STR.play.logEmpty}</li>`
      : [...resolved]
          .reverse()
          .map((e) => `<li class="entry"><span>${esc(e.word)}</span>${badge(e, g)}</li>`)
          .join("");
}

/* ───────────── טיימר (בכל הטלפונים) ───────────── */

// כל טלפון מחשב את הזמן שנשאר מ-endsAt ומשעת השרת, לכן הטיימרים זהים וכיבוי מסך לא עוצר אותם.
// המסביר/ה סוגר/ת את השלב בזמן. אם הוא/היא נעלמ/ת, טלפון אחר סוגר אחרי זמן חסד.
function fireOnce(key, action) {
  if (S.fired === key) return;
  S.fired = key;
  dispatch(action).then((ok) => {
    if (!ok) setTimeout(() => S.fired === key && (S.fired = null), 1000);
  });
}

function tickRoom() {
  const st = S.room;
  if (!st || !S.store) return stopTimers();
  const role = R.roleOf(st, S.clientId);
  const now = S.store.serverNow();
  const ti = st.game.turnIndex;

  if (st.phase === "PLAYING") {
    const left = st.endsAt - now;
    const secs = Math.max(0, Math.ceil(left / 1000));
    const timer = document.getElementById("timer");
    const bar = document.getElementById("bar");
    const wrap = document.getElementById("timer-wrap");
    if (timer) timer.textContent = secs;
    if (bar) bar.style.setProperty("--p", Math.max(0, Math.min(1, left / (st.game.settings.turnSeconds * 1000))));
    if (wrap) wrap.classList.toggle("warn", secs <= 10);
    if (role === "explainer") {
      if (secs !== S.lastSecs) {
        S.lastSecs = secs;
        if (secs > 0 && secs <= 3) beep(660, 90);
      }
      if (left <= 0) {
        beepEnd();
        vibrate([250, 100, 250]);
        fireOnce(`end:${ti}`, { type: "endTurn" });
      }
    } else if (left <= -R.GRACE_MS) {
      fireOnce(`end:${ti}`, { type: "endTurn" });
    }
  } else if (st.phase === "LAST_CHANCE" && st.lcEndsAt > 0) {
    const left = st.lcEndsAt - now;
    const el = document.getElementById("lc-timer");
    if (el) el.textContent = Math.max(0, Math.ceil(left / 1000));
    if (role === "explainer" && left <= 0) {
      beep(440, 250);
      fireOnce(`lc:${ti}`, { type: "resolveLast", teamIdx: null });
    } else if (role !== "explainer" && left <= -R.GRACE_MS) {
      fireOnce(`lc:${ti}`, { type: "resolveLast", teamIdx: null });
    }
  }
}

/* ───────────── הזדמנות אחרונה ───────────── */

function goLastChance(st) {
  const g = st.game;
  const entry = G.currentEntry(g);
  const secs = g.settings.lastChanceSeconds;
  const explaining = g.turn.teamIdx;
  const teamButtons = g.teams
    .map(
      (t, i) => `
      <button class="btn team-btn" data-action="lc-team" data-value="${i}">
        <span>✓ ${esc(t.name)}${i === explaining ? `<small>${STR.lastChance.explainingTeam}</small>` : ""}</span>
        ${signed(i === explaining ? 1 : g.settings.stealPoints)}
      </button>`,
    )
    .join("");

  show(
    `
    <p class="lc-banner">${STR.lastChance.banner}</p>
    <p class="lc-sub">${STR.lastChance.sub}</p>
    ${secs > 0 ? `<div class="timer-wrap"><div class="timer" id="lc-timer">${secs}</div></div>` : ""}
    <div class="word-card" id="card"><div class="word ${wordSize(entry.word)}">${esc(entry.word)}</div></div>
    ${quipHtml("lastchance")}
    <p class="lead">${STR.lastChance.question}</p>
    <div class="stack">
      ${teamButtons}
      <button class="btn ghost on-light" data-action="lc-none">${STR.lastChance.nobody}</button>
    </div>`,
    "lastchance",
  );
  window.scrollTo(0, 0);
}

function goLastChanceWatching(st) {
  const secs = st.game.settings.lastChanceSeconds;
  show(
    `
    ${roomBar()}
    <p class="lc-banner">${STR.lastChance.banner}</p>
    <p class="lc-sub">${STR.lastChance.watchSub}</p>
    ${secs > 0 ? `<div class="timer-wrap"><div class="timer" id="lc-timer">${secs}</div></div>` : ""}
    ${quipHtml("lastchance")}
    <ol class="entries log" role="log" aria-label="${STR.play.logAria}">${[...R.resolvedEntries(st)]
      .reverse()
      .map((e) => `<li class="entry"><span>${esc(e.word)}</span>${badge(e, st.game)}</li>`)
      .join("")}</ol>
    ${takeoverHtml()}`,
    "lastchance",
  );
  window.scrollTo(0, 0);
}

/* ───────────── סיכום תור ───────────── */

function badge(entry, game) {
  const s = game.settings;
  switch (entry.result) {
    case "correct":
      return `<span class="badge b-correct">${tpl(STR.badges.correct, { delta: signed(1) })}</span>`;
    case "skip":
      return `<span class="badge b-skip">${s.skip === "penalty" ? tpl(STR.badges.skipPenalty, { delta: signed(-1) }) : STR.badges.skip}</span>`;
    case "taboo":
      return `<span class="badge b-taboo">${tpl(STR.badges.taboo, { delta: signed(-2) })}</span>`;
    case "stolen":
      return `<span class="badge b-stolen">${tpl(STR.badges.stolen, { team: esc(game.teams[entry.teamId]?.name ?? ""), delta: signed(s.stealPoints) })}</span>`;
    default:
      return `<span class="badge b-missed">${STR.badges.missed}</span>`;
  }
}

function goSummary(st, role) {
  show(summaryHtml(st, role), "summary");
  window.scrollTo(0, 0);
}

function summaryHtml(st, role) {
  const g = st.game;
  const turn = g.turn;
  const editable = role === "explainer";
  const deltas = G.turnDeltas(turn, g.settings, g.teams.length);
  const deltaChips = deltas
    .map((d, i) =>
      d === 0 ? "" : `<span class="delta ${d > 0 ? "up" : "down"}">${esc(g.teams[i].name)} ${signed(d)}</span>`,
    )
    .join("");
  const hasEntries = turn.entries.length > 0;

  return `
    ${roomBar()}
    <header class="topbar"><span class="pill">${esc(g.teams[turn.teamIdx].name)}</span></header>
    <h1 class="page-title">${STR.summary.title}</h1>
    ${
      hasEntries
        ? `<p class="lead">${editable ? STR.summary.leadEditable : STR.summary.leadViewer}</p>
           <${editable ? "div" : "ol"} class="entries" id="entries">${entryLines(st, editable)}</${editable ? "div" : "ol"}>`
        : `<p class="lead">${STR.summary.empty}</p>`
    }
    <div class="deltas" id="deltas">${deltaChips || `<span class="delta">${STR.summary.noChange}</span>`}</div>
    ${quipHtml("summary")}
    ${
      editable
        ? `<div class="footer"><button class="btn primary big" data-action="confirm-turn">${STR.summary.confirm}</button></div>`
        : takeoverHtml()
    }`;
}

// תיקון תוצאה: בונים מחדש את המסך, ומחזירים את הגלילה והפוקוס לאותה מילה
function rerenderSummary(st, role) {
  const y = window.scrollY;
  const a = document.activeElement;
  const index = a?.dataset?.action === "cycle" ? a.dataset.value : null;
  show(summaryHtml(st, role), "summary");
  window.scrollTo(0, y);
  if (index !== null) $app.querySelector(`[data-action="cycle"][data-value="${CSS.escape(index)}"]`)?.focus({ preventScroll: true });
}

/* ───────────── תיקו וסוף משחק ───────────── */

function goTiebreak(st) {
  const g = st.game;
  const leaders = G.leaders(g);
  const names = leaders.map((i) => `<h2 class="team-title sm">${esc(g.teams[i].name)}</h2>`).join("");
  show(
    `
    ${roomBar()}
    <div class="center grow">
      <h1 class="page-title">${STR.tiebreak.title}</h1>
      <p class="lead">${tpl(STR.tiebreak.lead.join("<br>"), { score: num(g.teams[leaders[0]].score) })}</p>
      ${names}
      ${quipHtml("tiebreak")}
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="tiebreak-go">${STR.tiebreak.go}</button>
    </div>`,
    "tiebreak",
  );
  window.scrollTo(0, 0);
}

function goGameOver(st) {
  const g = st.game;
  const winners = G.leaders(g);
  const table = G.standings(g)
    .map(
      (t, i) =>
        `<div class="score-row${winners.includes(t.idx) ? " now" : ""}"><span>${num(i + 1)}. ${esc(t.name)}</span><b>${num(t.score)}</b></div>`,
    )
    .join("");
  const headline = winners.map((i) => `<h1 class="team-title">${esc(g.teams[i].name)}</h1>`).join("");

  show(
    `
    <div class="center grow">
      <p class="lead">${winners.length === 1 ? STR.gameOver.winner : STR.gameOver.tie}</p>
      ${headline}
      <div class="score-list">${table}</div>
      ${quipHtml("over")}
    </div>
    <div class="stack">
      <button class="btn primary big" data-action="new-from-room">${STR.gameOver.newGame}</button>
      <button class="btn ghost" data-action="share">${STR.gameOver.share}</button>
      <button class="btn ghost" data-action="leave">${STR.gameOver.home}</button>
    </div>`,
    "gameover",
  );
  window.scrollTo(0, 0);
}

/* ───────────── לחיצות ───────────── */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function changeTeams(delta) {
  const teams = S.settings.teams;
  const n = clamp(teams.length + delta, G.LIMITS.minTeams, G.LIMITS.maxTeams);
  if (n > teams.length) teams.push(G.defaultTeamName(teams.length));
  else teams.length = n;
  rerenderSetup();
}

function changeRounds(delta) {
  S.settings.rounds = clamp(S.settings.rounds + delta, G.LIMITS.minRounds, G.LIMITS.maxRounds);
  rerenderSetup();
}

const ACTIONS = {
  // בית
  new: () => goSetup(),
  "new-from-room"() {
    save(KEY_LAST_ROOM, null, ROOM_AREA);
    detach();
    goSetup();
  },
  home: () => goHome(),
  howto: () => goHowTo(),
  share: () => share(),
  leave: () => leaveRoom(),

  // הגדרות
  "teams-inc": () => changeTeams(1),
  "teams-dec": () => changeTeams(-1),
  "rounds-inc": () => changeRounds(1),
  "rounds-dec": () => changeRounds(-1),
  "turn-secs"(v) {
    S.settings.turnSeconds = Number(v);
    rerenderSetup();
  },
  "skip-mode"(v) {
    S.settings.skip = v;
    rerenderSetup();
  },
  "lc-secs"(v) {
    S.settings.lastChanceSeconds = Number(v);
    rerenderSetup();
  },
  steal(v) {
    S.settings.stealPoints = Number(v) === 2 ? 2 : 1;
    rerenderSetup();
  },
  start: () => startGame(),

  // תור
  claim: () => claim(),
  correct: () => answer("correct"),
  skip: () => answer("skip"),
  taboo: () => answer("taboo"),
  "lc-team": (v) => dispatch({ type: "resolveLast", teamIdx: Number(v) }),
  "lc-none": () => dispatch({ type: "resolveLast", teamIdx: null }),
  cycle: (v) => dispatch({ type: "cycle", index: Number(v) }),
  "confirm-turn": () => dispatch({ type: "confirm" }),
  "tiebreak-go": () => dispatch({ type: "tiebreakGo" }),
  async takeover() {
    ensureAudio();
    const ok = await dispatch({ type: "takeover" });
    if (ok) toast(STR.net.nowExplaining);
  },
};

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.action]?.(el.dataset.value, el);
});

$app.addEventListener("change", (e) => {
  const sw = e.target.closest("[data-switch]");
  if (sw) {
    S.settings.lastChance = sw.checked;
    rerenderSetup();
    return;
  }
  const box = e.target.closest("[data-level]");
  if (!box) return;
  const level = S.levels.find((l) => String(l.id) === box.dataset.level);
  if (!level) return;
  const set = new Set(S.settings.levels);
  if (box.checked) set.add(level.id);
  else set.delete(level.id);
  S.settings.levels = S.levels.map((l) => l.id).filter((id) => set.has(id));
  rerenderSetup();
});

$app.addEventListener("input", (e) => {
  const input = e.target.closest("[data-team]");
  if (input) S.settings.teams[Number(input.dataset.team)] = input.value;
  const code = e.target.closest("#join-code");
  if (code) {
    code.value = code.value.replace(/\D/g, "").slice(0, R.CODE_LENGTH); // רק ספרות
    const err = document.getElementById("join-error");
    if (err) err.textContent = "";
  }
});

/* ───────────── הצטרפות עם קוד: ולידציה אחרי אינטראקציה ───────────── */

// :user-invalid מציג שגיאה רק אחרי שהמשתמש סיים להקליד (או ניסה לשלוח). משקפים אותו גם ל-aria-invalid,
// כדי שקורא מסך יקבל את אותו מצב באותו רגע, ומקשרים את הודעת השגיאה רק כשהיא מוצגת.
function syncInvalid(el) {
  const invalid = el.matches(":user-invalid");
  el.setAttribute("aria-invalid", String(invalid));
  const errorId = el.dataset.error;
  if (errorId) {
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== errorId);
    if (invalid) ids.push(errorId);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  }
}
for (const type of ["blur", "change", "input", "invalid"]) {
  $app.addEventListener(type, (e) => e.target.matches?.("#join-code") && syncInvalid(e.target), true);
}

$app.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form='join']");
  if (!form) return;
  e.preventDefault();
  const input = form.elements.code;
  const err = document.getElementById("join-error");
  syncInvalid(input);
  if (!input.checkValidity()) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  err.textContent = "";
  const res = await joinRoom(input.value);
  button.disabled = false;
  if (!res.ok) {
    err.innerHTML = `<span role="img" aria-label="${STR.common.error}">⚠️</span> ${
      ({ notfound: STR.net.joinNotFound, denied: DENIED_MSG })[res.reason] ?? STR.net.joinFailed
    }`;
    input.focus();
  }
});

/* ───────────── דיאלוגים והעתקה ───────────── */

const leaveDialog = document.getElementById("leave-dialog");
leaveDialog.addEventListener("close", () => {
  const choice = leaveDialog.returnValue;
  leaveDialog.returnValue = ""; // Esc לא מאפס ערך קודם בכל הדפדפנים
  if (choice === "leave") leaveRoom();
});

// כפתור "העתקה": הפקודה --copy מוגדרת בהצהרה בכפתור, והבועה שלידו היא גם ה-live region.
const copyTimers = new WeakMap();
let lastCopyMessage = "";

function reportCopy(button, ok) {
  const tip = button.nextElementSibling;
  clearTimeout(copyTimers.get(button));
  button.removeAttribute("data-copied");
  button.removeAttribute("data-failed");
  let message = ok ? STR.copy.done : STR.copy.failed;
  if (message === lastCopyMessage) message += " "; // VoiceOver מדלג על הודעה זהה לקודמת
  lastCopyMessage = message.trim();
  tip.textContent = "";
  button.setAttribute(ok ? "data-copied" : "data-failed", "");
  requestAnimationFrame(() => (tip.textContent = message));
  copyTimers.set(
    button,
    setTimeout(() => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      tip.textContent = "";
    }, 2000),
  );
}

async function copyText(button, target) {
  const text = target.matches("input, textarea") ? target.value : target.innerText.trim();
  if (!text) return;
  try {
    if (native?.copy) {
      if (!native.copy(text)) throw new Error("copy failed"); // אנדרואיד: לוח ההעתקה של המערכת
    } else {
      await navigator.clipboard.writeText(text);
    }
    reportCopy(button, true);
  } catch {
    reportCopy(button, false);
  }
}

if ("CommandEvent" in window) {
  // אירועי command לא עושים bubble, ולכן מאזינים בשלב ה-capture. event.source הוא הכפתור.
  document.addEventListener(
    "command",
    (event) => {
      if (event.command === "--copy") copyText(event.source, event.target);
    },
    true,
  );
} else {
  // דפדפן בלי Invoker Commands: אותו סימון, ואותן פעולות דרך click
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[command]");
    const target = button && document.getElementById(button.getAttribute("commandfor"));
    if (!target) return;
    if (button.getAttribute("command") === "--copy") copyText(button, target);
    else if (button.getAttribute("command") === "show-modal") target.showModal();
  });
}

/* ───────────── טקסטים סטטיים וכפתור חזרה ───────────── */

// אלמנטים ב-index.html עם data-str="קבוצה.מפתח" מקבלים את הטקסט מ-strings.js
function applyStaticStrings() {
  for (const el of document.querySelectorAll("[data-str]")) {
    const value = el.dataset.str.split(".").reduce((obj, key) => obj?.[key], STR);
    if (typeof value === "string") el.textContent = value;
  }
}
applyStaticStrings();

// כפתור "חזרה" של אנדרואיד. MainActivity קורא לפונקציה הזו: true = הדף טיפל בלחיצה, false = לצאת מהאפליקציה.
window.aliasOnBack = () => {
  const dialog = document.querySelector("dialog[open]");
  if (dialog) {
    dialog.close();
    return true;
  }
  if (S.code) {
    leaveDialog.showModal(); // בתוך חדר: שואלים אם לעזוב
    return true;
  }
  const screen = document.body.dataset.screen;
  if (screen === "setup" || screen === "howto") {
    goHome();
    return true;
  }
  return false;
};

/* ───────────── טעינה ───────────── */

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function renderLoadError() {
  show(
    `
    <div class="center grow">
      <h1 class="page-title">${STR.loadError.title}</h1>
      <p class="lead">${STR.loadError.text}</p>
      <p class="pill"><span class="num">python -m http.server 8000</span></p>
    </div>`,
    "error",
  );
}

async function init() {
  S.clientId = makeClientId();
  preload(); // מתחילים לטעון את Firebase כבר עכשיו, במקביל לטעינת המילים
  try {
    const [levels, words] = await Promise.all([fetchJson("levels.json"), fetchJson("words.json")]);
    S.levels = levels.filter((l) => l && l.id !== undefined && l.name);
    S.words = words.filter((w) => w && typeof w.word === "string" && w.word.trim() && w.level !== undefined);
  } catch (err) {
    console.error(err);
    renderLoadError();
    return;
  }
  S.counts = G.countByLevel(S.words);
  S.settings = G.sanitizeSettings(load(KEY_SETTINGS), usableLevelIds());

  // קישור עם ?room=123456 מצטרף ישר. אחרת חוזרים לחדר האחרון, אם הוא עדיין קיים.
  const params = new URLSearchParams(location.search);
  const fromLink = params.get("room");
  const code = R.isValidCode(fromLink) ? fromLink : load(KEY_LAST_ROOM, ROOM_AREA);
  if (fromLink !== null) history.replaceState(null, "", location.pathname);
  if (R.isValidCode(code)) {
    const res = await joinRoom(code);
    if (res.ok) return;
    if (res.reason === "notfound") save(KEY_LAST_ROOM, null, ROOM_AREA);
    goHome();
    if (res.reason === "denied") toast(DENIED_MSG, 6000);
    else if (fromLink !== null) toast(res.reason === "notfound" ? STR.net.linkNotFound : STR.net.linkFailed, 3200);
    return;
  }
  goHome();
}

init();
