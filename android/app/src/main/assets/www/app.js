// app.js — המסכים והחיבור בין המשחק לדפדפן, בגרסת הרב-שחקנים.
//
// המצב של המשחק גר בחדר משותף (store.js). כל טלפון מציג אותו לפי התפקיד שלו:
//   מסביר/ה — הטלפון שלחץ "אני מסביר/ה". רק אצלו מוצגת המילה, ורק הוא מסמן נכון/דלג/אסור.
//   צופה    — כל שאר הטלפונים. רואים את הטיימר ואת המילים שכבר קיבלו תוצאה, בלי המילה הנוכחית.
// אין תור קבוע בין הטלפונים: בשלב ההכנה כל טלפון יכול לקחת את התור.

import * as G from "./game.js";
import * as R from "./room.js";
import { quip } from "./quips.js";
import { openStore, forgetLocal, isOnline } from "./store.js";

const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const $net = document.getElementById("net");
// באיזה דף אנחנו: index.html (רגיל) או boys-vs-girls.html (<html data-mode="gender">).
// מה שבתוך חדר קיים נקבע לפי ההגדרות ששמורות בחדר עצמו, לא לפי הדף, כך שאפשר להצטרף לחדר מכל דף.
const MODE = document.documentElement.dataset.mode === "gender" ? "gender" : "classic";
const WORDS_FILE = MODE === "gender" ? "words-gender.json" : "words.json";
const LEVELS_FILE = MODE === "gender" ? "levels-gender.json" : "levels.json"; // בבנים נגד בנות הקובץ הזה אופציונלי
const KEY_SETTINGS = MODE === "gender" ? "alias.settings.gender.v1" : "alias.settings.v1";
const DENIED_MSG = "Firebase חוסם את החדר. בדקו שפרסמתם את הכללים (Rules ← Publish) ושה-databaseURL נכון.";
const KEY_LAST_OFFLINE = "alias.lastRoomOffline.v1"; // ב-sessionStorage: החדר האחרון הוא משחק אופליין (מקומי, בלי רשת)
const KEY_LAST_ROOM = "alias.lastRoom.v1"; // ב-sessionStorage: רענון חוזר לחדר, לשונית חדשה לא "חוטפת" חדר של לשונית אחרת
const KEY_CLIENT = "alias.client.v1"; // ב-sessionStorage: כל לשונית/טלפון הוא "שחקן" נפרד

const S = {
  levels: [],
  words: [],
  counts: {},
  settings: null,
  clientId: null,
  store: null, // החדר הפעיל
  offline: false, // החדר הפעיל הוא משחק אופליין: בטלפון אחד, שמור במכשיר, בלי Firebase
  nextOffline: false, // המשחק שעומדים להגדיר יהיה אופליין
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
const wordsLabel = (n) => (n === 0 ? "אין מילים" : n === 1 ? "מילה אחת" : `${n} מילים`);

function fmtEstimate({ min, max }) {
  if (min === max) return min === 1 ? "כדקה" : `כ-${num(min)} דקות`;
  return `כ-${num(`${min}–${max}`)} דקות`;
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
  const existing = load(KEY_CLIENT, "session");
  if (typeof existing === "string" && existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() ?? `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  save(KEY_CLIENT, id, "session");
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

// ניסוח לפי סוג היחידה: קבוצה, או זוג (בבנים נגד בנות במצב זוגות)
function unitOf(settings) {
  return G.isGender(settings) && settings.format === "couples"
    ? { guessed: "איזה זוג ניחש נכון?", explaining: "הזוג המסביר", winner: "הזוג המנצח", tie: "תיקו בין הזוגות", leading: "הזוגות האלה מובילים", each: "כל אחד משחק" }
    : { guessed: "איזו קבוצה ניחשה נכון?", explaining: "הקבוצה המסבירה", winner: "הקבוצה המנצחת", tie: "תיקו בין הקבוצות", leading: "הקבוצות האלה מובילות", each: "כל אחת משחקת" };
}

// הכיתוב של העולם שממנו המילים בתור הנוכחי (רק בבנים נגד בנות)
const WORLD = {
  male: {
    who: "הבן", world: "עולם הבנים", icon: "👦", explains: "מסביר: הבן",
    press: "הבן לוחץ על הכפתור.", pressTeam: "מי מהבנים שרוצה להסביר לוחץ על הכפתור.",
  },
  female: {
    who: "הבת", world: "עולם הבנות", icon: "👧", explains: "מסבירה: הבת",
    press: "הבת לוחצת על הכפתור.", pressTeam: "מי מהבנות שרוצה להסביר לוחצת על הכפתור.",
  },
};
// explainerGender = מי מסביר. המילים תמיד מהעולם של המין השני.
const worldPill = (explainerGender) =>
  explainerGender ? `<span class="pill world">${WORLD[G.oppositeGender(explainerGender)].icon} מילים מ${WORLD[G.oppositeGender(explainerGender)].world}</span>` : "";

// ניסוח לפי מין המסביר. כשהמין ידוע אין צורך ב"/ה" ו"/ת". כשלא ידוע (משחק רגיל) נשארות שתי הצורות.
function speaker(gender) {
  if (gender === "male")
    return { explainer: "המסביר", previous: "המסביר הקודם", iExplain: "אני מסביר", theirs: "שלו", checks: "בודק ומאשר", whoUnresponsive: "הטלפון של המסביר לא מגיב?", becomesWatcher: "יהפוך לצופה" };
  if (gender === "female")
    return { explainer: "המסבירה", previous: "המסבירה הקודמת", iExplain: "אני מסבירה", theirs: "שלה", checks: "בודקת ומאשרת", whoUnresponsive: "הטלפון של המסבירה לא מגיב?", becomesWatcher: "תהפוך לצופה" };
  return { explainer: "המסביר/ה", previous: "המסביר/ה הקודם/ת", iExplain: "אני מסביר/ה", theirs: "שלו/ה", checks: "בודק/ת ומאשר/ת", whoUnresponsive: "הטלפון המסביר/ה לא מגיב?", becomesWatcher: "יהפוך/תהפוך לצופה" };
}

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

function attach(store, code, offline = false) {
  detach();
  S.store = store;
  S.code = code;
  S.offline = offline;
  S.room = null;
  S.viewKey = "";
  S.fired = null;
  S.stopRoom = store.subscribe(onRoom, onStoreError);
  S.stopNet = store.onConnection((ok) => {
    $net.textContent = ok ? "" : "אין חיבור. מנסים להתחבר מחדש…";
  });
  save(KEY_LAST_ROOM, code, "session");
  save(KEY_LAST_OFFLINE, offline ? true : null, "session");
}

// החדר האחרון נשכח (יציאה, חדר שנסגר, קוד שלא נמצא)
function forgetLastRoom() {
  save(KEY_LAST_ROOM, null, "session");
  save(KEY_LAST_OFFLINE, null, "session");
}

function detach() {
  if (S.offline && S.code) forgetLocal(S.code); // משחק אופליין נמחק מהמכשיר כשיוצאים ממנו
  stopTimers();
  releaseWakeLock();
  S.stopRoom?.();
  S.stopNet?.();
  S.store?.close();
  S.store = S.stopRoom = S.stopNet = null;
  S.code = null;
  S.offline = false;
  S.room = null;
  S.viewKey = "";
  $net.textContent = "";
}

/** מצטרף לחדר קיים. מחזיר { ok: true } או { ok: false, reason: "notfound" | "offline" } */
async function joinRoom(code, { offline = false } = {}) {
  let store;
  try {
    store = await openStore(code, { offline });
    const state = await peek(store);
    if (state === null) {
      store.close();
      return { ok: false, reason: "notfound" };
    }
    attach(store, code, offline);
    return { ok: true };
  } catch (err) {
    console.error(err);
    store?.close();
    return { ok: false, reason: err?.message === "permission_denied" ? "denied" : "offline" };
  }
}

/** יוצר חדר חדש מההגדרות ומתחבר אליו */
async function createRoom(settings, { offline = false } = {}) {
  const initial = R.createRoomState(settings, S.words);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = R.newCode();
    const store = await openStore(code, { offline });
    const res = await store.transact((cur) => (cur ? null : initial)); // לא דורסים חדר קיים
    if (res.committed) {
      attach(store, code, offline);
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
  forgetLastRoom();
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
    toast("הפעולה לא נשלחה. בדקו את החיבור.");
    return false;
  }
}

function onRoom(state) {
  if (state === null) {
    // החדר נמחק מתחת לרגליים שלנו
    if (S.store) {
      toast("החדר נסגר");
      forgetLastRoom();
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
  if (S.offline)
    return `
    <div class="roombar">
      <span class="pill">📴 משחק אופליין</span>
      <button type="button" class="link" command="show-modal" commandfor="leave-dialog">יציאה</button>
    </div>`;
  return `
    <div class="roombar">
      <span class="pill">חדר <span class="num" id="room-code">${esc(S.code)}</span></span>
      <span class="copy">
        <button type="button" class="link copy-button" command="--copy" commandfor="room-code">העתקת הקוד</button>
        <span class="tip" role="status"></span>
      </span>
      <button type="button" class="link" data-action="share">שיתוף</button>
      <button type="button" class="link" command="show-modal" commandfor="leave-dialog">יציאה</button>
    </div>`;
}

// מי שהמסביר/ה נעלם/ה (הטלפון כבה, נסגר הדף) יכול לקחת את השליטה
const takeoverHtml = (explainerGender = null) => {
  const w = speaker(explainerGender);
  return `
  <details class="help">
    <summary>${w.whoUnresponsive}</summary>
    <p>אפשר לקחת את השליטה בשלב הזה. ${w.previous} ${w.becomesWatcher}.</p>
    <button type="button" class="btn" data-action="takeover">אני לוקח/ת את השליטה</button>
  </details>`;
};

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

const joinFormHtml = () => `
      <form class="join" data-form="join" aria-labelledby="join-title">
        <h2 id="join-title">יש לכם קוד משחק?</h2>
        <div class="join-row">
          <input class="field num-input" id="join-code" name="code" inputmode="numeric" pattern="[0-9]{${R.CODE_LENGTH}}" maxlength="${R.CODE_LENGTH}" minlength="${R.CODE_LENGTH}" required autocomplete="off" spellcheck="false" aria-label="קוד משחק, ${R.CODE_LENGTH} ספרות" aria-invalid="false" data-error="join-format-error" placeholder="${"0".repeat(R.CODE_LENGTH)}">
          <button class="btn" type="submit">הצטרפות</button>
        </div>
        <p class="error-msg" id="join-format-error"><span role="img" aria-label="שגיאה">⚠️</span> הקוד הוא ${R.CODE_LENGTH} ספרות.</p>
        <p class="error-msg shown" id="join-error" role="alert"></p>
      </form>`;

// כפתור משחק אופליין. מוצג רק כש-Firebase מוגדר, כי בלי Firebase כל משחק הוא ממילא מקומי.
// כשהדפדפן יודע שאין אינטרנט, הכפתור הופך לראשי.
function offlineHtml() {
  if (!isOnline) return "";
  const down = navigator.onLine === false;
  return `
      <button class="btn ${down ? "primary big" : "ghost"}" data-action="offline">📴 משחק אופליין (טלפון אחד)</button>
      ${down ? `<p class="note-local">אין חיבור לאינטרנט כרגע. משחק אופליין עובד גם בלי רשת.</p>` : ""}`;
}

const localNoteHtml = () =>
  isOnline ? "" : `<p class="note-local">מצב מקומי: אפשר לבדוק עם כמה לשוניות באותו דפדפן. כדי לשחק בין טלפונים צריך להגדיר Firebase (ראו README).</p>`;

// שאלות ותשובות בדף הבית של בנים נגד בנות. הטקסט גם נראה לשחקנים וגם נקרא על ידי גוגל (הדף נבנה ב-JS).
const GENDER_FAQ = [
  ["איך משחקים בנים נגד בנות?", "מחלקים לשתי קבוצות, בנים ובנות, והן משחקות בתורות. כשבן מסביר, כל המילים שלו מגיעות מהעולם של הבנות, וכשבת מסבירה, המילים מהעולם של הבנים. מסבירים בלי להגיד את המילה, והקבוצה מנחשת כמה שיותר לפני שהזמן נגמר."],
  ["אפשר לשחק בזוגות של בן ובת?", "כן. במצב זוגות כל זוג הוא קבוצה. בכל תור של הזוג מתחלפים: פעם הבן מסביר מילה מעולם הבנות, ופעם הבת מסבירה מילה מעולם הבנים, ובן הזוג או בת הזוג מנסים לנחש. מי שמכיר את העולם של בן הזוג או בת הזוג הכי טוב, מנצח."],
  ["כמה אנשים צריך כדי לשחק?", "מארבעה שחקנים ומעלה. מספיק טלפון אחד שעובר בין השחקנים, ואפשר גם לשחק מכמה טלפונים עם קוד משחק."],
  ["צריך להירשם או להוריד אפליקציה?", "לא. המשחק חינם, בעברית, ועובד ישר בדפדפן בלי הרשמה ובלי התקנה."],
  ["למה זה משחק מילים מעניין למסיבה?", "כי המסביר יוצא מאזור הנוחות. אי אפשר להסתמך על ידע אישי, וצריך לתאר מילה מעולם זר. ככה נולדים הרגעים המצחיקים שמתאימים לערב חברים, שבת משפחתית, מסיבת רווקים או רווקות, חתונה ויום הולדת."],
];

function goHome() {
  stopTimers();
  releaseWakeLock();
  S.viewKey = "";
  S.nextOffline = false;
  if (MODE === "gender") return goGenderHome();
  show(
    `
    <div class="hero">
      <h1 class="title-sticker">אליאס</h1>
      <p class="tagline">מסבירים, מנחשים, זורמים.<br>משחק מילים לקבוצות, אפשר גם מכמה טלפונים.</p>
      ${quipHtml("home")}
    </div>
    <div class="stack">
      <button class="btn ${isOnline && navigator.onLine === false ? "ghost" : "primary big"}" data-action="new">משחק חדש</button>
      ${offlineHtml()}
      ${joinFormHtml()}
      <button class="btn ghost" data-action="howto">איך משחקים?</button>
      <button class="btn ghost" data-action="share">שתפו את המשחק</button>
      <a class="btn ghost" href="boys-vs-girls.html">👦 בנים נגד בנות 👧 – משחק מילים לזוגות ולמסיבות</a>
      <a class="link seo-link" href="how-to-play.html">חוקי המשחק המלאים</a>
      ${localNoteHtml()}
    </div>`,
    "home",
  );
  window.scrollTo(0, 0);
}

function goGenderHome() {
  const faq = GENDER_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
  show(
    `
    <div class="hero">
      <h1 class="title-sticker long">בנים נגד בנות</h1>
      <p class="tagline">משחק מילים למסיבה: הבן מסביר מילה מהעולם של הבנות, והבת מסבירה מילה מהעולם של הבנים.</p>
      ${quipHtml("home")}
    </div>
    <div class="stack">
      <button class="btn ${isOnline && navigator.onLine === false ? "ghost" : "primary big"}" data-action="new">משחק חדש</button>
      ${offlineHtml()}
      ${joinFormHtml()}
      <button class="btn ghost" data-action="share">שתפו את המשחק</button>
      <a class="btn ghost" href="./">חזרה לאליאס הרגיל</a>
      ${localNoteHtml()}
    </div>
    <article class="panel doc">
      <section>
        <h2>משחק מילים בנים נגד בנות</h2>
        <p>שני מצבי משחק: <b>קבוצת בנים מול קבוצת בנות</b>, או <b>זוגות של בן ובת</b>. בכל תור הבן מסביר מילה מעולם הבנות והבת מסבירה מילה מעולם הבנים, בלי להגיד אותה. אותו אליאס שאתם מכירים: ניקוד, דילוג, הזדמנות אחרונה, ואפשר גם מכמה טלפונים.</p>
      </section>
      <section>
        <h2>שאלות נפוצות</h2>
        ${faq}
      </section>
      <p><a href="how-to-play.html">חוקי אליאס המלאים</a> · <a href="./">אליאס, המשחק הרגיל</a></p>
    </article>`,
    "home",
  );
  window.scrollTo(0, 0);
}

function goHowTo() {
  stopTimers();
  S.viewKey = "";
  show(
    `
    <header class="topbar"><button class="link" data-action="home">חזרה</button></header>
    <h1 class="page-title">איך משחקים?</h1>
    <section class="panel howto">
      <ul>
        <li>מחלקים לקבוצות. בכל תור משחקת קבוצה אחת.</li>
        <li>טלפון אחד יוצר חדר, ושאר הטלפונים מצטרפים עם הקוד. אין חובה שכולם יתחברו: מי שרוצה.</li>
        <li>בכל תור, מי שרוצה להסביר לוחץ/ת "אני מסביר/ה". רק אצלו/ה מופיעות המילים, ובשאר הטלפונים רואים את הטיימר ואת המילים שכבר נוחשו.</li>
        <li>המסביר/ה מסביר/ה את המילה בלי להגיד אותה או חלק ממנה. ניחשו? "נכון" ונקודה. קשה מדי? "דלג". אמרו את המילה עצמה? "אסור", ונקודה יורדת.</li>
        <li>כשהזמן נגמר, המילה האחרונה נשארת על המסך וכל הקבוצות יכולות לנחש. מי שניחשה נכון מקבלת נקודה.</li>
        <li>אחרי מספר הסיבובים שבחרתם, הקבוצה עם הכי הרבה נקודות מנצחת. בתיקו בראש יש סיבוב הכרעה.</li>
      </ul>
    </section>`,
    "howto",
  );
  window.scrollTo(0, 0);
}

function shareUrl() {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  if (S.code) url.searchParams.set("room", S.code);
  return url.toString();
}

async function share() {
  const url = shareUrl();
  try {
    if (navigator.share) {
      await navigator.share({ title: "אליאס", text: S.code ? `בואו לשחק אליאס! קוד החדר: ${S.code}` : "בואו לשחק אליאס!", url });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("הקישור הועתק");
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
  // בבנים נגד בנות צריך לפחות מילה אחת מכל עולם, ושני העולמות נצרכים בערך חצי חצי
  const worlds = G.isGender(s) ? G.genderCounts(S.words, s.levels) : null;
  const canStart = s.levels.length > 0 && pool > 0 && (!worlds || (worlds.male > 0 && worlds.female > 0));

  const chip = (action, value, label, on) =>
    `<button type="button" class="chip${on ? " on" : ""}" data-action="${action}" data-value="${value}" aria-pressed="${on}">${label}</button>`;

  const stepper = (name, value, min, max) => `
    <div class="stepper">
      <button type="button" class="step" data-action="${name}-dec" aria-label="פחות" ${value <= min ? "disabled" : ""}>−</button>
      <output>${value}</output>
      <button type="button" class="step" data-action="${name}-inc" aria-label="יותר" ${value >= max ? "disabled" : ""}>+</button>
    </div>`;

  const gender = G.isGender(s);
  const couples = gender && s.format === "couples";
  const fixedTeams = gender && s.format === "teams"; // תמיד שתי קבוצות: בנים ובנות
  const unitLabel = couples ? "זוג" : "קבוצה";
  const teamFields = s.teams
    .map((name, i) => {
      const label = fixedTeams ? (i === 0 ? "שם קבוצת הבנים" : "שם קבוצת הבנות") : `שם ${unitLabel} ${i + 1}`;
      const icon = fixedTeams ? (i === 0 ? "👦 " : "👧 ") : "";
      return `${icon ? `<span class="sub">${icon}${label}</span>` : ""}<input class="field" data-team="${i}" value="${esc(name)}" maxlength="20" placeholder="${esc(G.defaultNameFor(s, i))}" aria-label="${label}" autocomplete="off">`;
    })
    .join("");

  const formatPanel = gender
    ? `
    <section class="panel">
      <h2>איך משחקים?</h2>
      <div class="chips">
        ${chip("format", "teams", "👦 בנים מול 👧 בנות", s.format === "teams")}
        ${chip("format", "couples", "💑 זוגות של בן ובת", s.format === "couples")}
      </div>
      <p class="sub">${
        couples
          ? "כל זוג הוא קבוצה. בכל תור של הזוג מתחלפים: פעם הבן מסביר מילה מעולם הבנות, ופעם הבת מסבירה מילה מעולם הבנים."
          : "קבוצת הבנים מסבירה מילים מעולם הבנות, וקבוצת הבנות מסבירה מילים מעולם הבנים. התורות מתחלפים."
      }</p>
    </section>`
    : "";

  const teamsPanel = `
    <section class="panel">
      <h2>${couples ? "זוגות" : "קבוצות"}</h2>
      ${fixedTeams ? "" : `<div class="row"><span>${couples ? "כמה זוגות" : "כמה קבוצות"}</span>${stepper("teams", s.teams.length, G.LIMITS.minTeams, G.LIMITS.maxTeams)}</div>`}
      ${teamFields}
    </section>`;

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
    ? worlds
      ? `<p class="note">נבחרו ${wordsLabel(worlds.female)} מעולם הבנות ו-${wordsLabel(worlds.male)} מעולם הבנים</p>`
      : `<p class="note">נבחרו ${wordsLabel(pool)}</p>`
    : worlds && s.levels.length > 0
      ? `<p class="note">ברמות שנבחרו חסרות מילים מאחד העולמות. בחרו עוד רמה.</p>`
      : `<p class="note">בחרו לפחות רמה אחת.</p>`;
  const poolWarning = !canStart
    ? ""
    : worlds
      ? Math.min(worlds.male, worlds.female) < Math.ceil(needed / 2)
        ? `<p class="warning">המשחק עשוי להזדקק לכ-${num(Math.ceil(needed / 2))} מילים מכל עולם. חלק מהמילים יחזרו.</p>`
        : ""
      : pool < needed
        ? `<p class="warning">ברמות שנבחרו יש ${wordsLabel(pool)}, והמשחק עשוי להזדקק לכ-${num(needed)}. חלק מהמילים יחזרו.</p>`
        : "";

  const lastChanceOptions = s.lastChance
    ? `
      <p class="sub">כמה זמן אפשר לנחש אחרי שהזמן נגמר</p>
      <div class="chips">${G.LAST_CHANCE_OPTIONS.map((v) =>
        chip("lc-secs", v, v === 0 ? "עד לחיצה" : `${num(v)} שניות`, s.lastChanceSeconds === v),
      ).join("")}</div>
      <p class="sub">נקודות לקבוצה אחרת שניחשה. הקבוצה המסבירה מקבלת תמיד ${signed(1)}.</p>
      <div class="chips">${[1, 2].map((v) => chip("steal", v, signed(v), s.stealPoints === v)).join("")}</div>`
    : "";

  return `
    <header class="topbar"><button class="link" data-action="home">חזרה</button></header>
    <h1 class="page-title">${gender ? "הגדרות – בנים נגד בנות" : "הגדרות משחק"}</h1>

    ${S.nextOffline && isOnline ? `<p class="note">📴 משחק אופליין: טלפון אחד, בלי אינטרנט ובלי קוד משחק.</p>` : ""}
    ${formatPanel}
    ${teamsPanel}

    <section class="panel">
      <h2>סיבובים</h2>
      <div class="row"><span>בכל סיבוב ${couples ? "כל זוג משחק" : "כל קבוצה משחקת"} תור</span>${stepper("rounds", s.rounds, G.LIMITS.minRounds, G.LIMITS.maxRounds)}</div>
      <div class="estimate"><span>זמן משחק משוער</span><b>${fmtEstimate(est)}</b></div>
      <p class="sub">${num(G.totalTurns(s))} תורות בסך הכול</p>
    </section>

    <section class="panel">
      <h2>זמן לתור</h2>
      <div class="chips">${G.TURN_SECONDS_OPTIONS.map((v) =>
        chip("turn-secs", v, `${num(v)} שניות`, s.turnSeconds === v),
      ).join("")}</div>
    </section>

    <section class="panel">
      <h2>רמות</h2>
      <p class="sub">אפשר לבחור כמה רמות. המילים מתערבבות ביניהן.</p>
      <div class="levels">${levelCards}</div>
      ${poolNote}
      ${poolWarning}
    </section>

    <section class="panel">
      <h2>דילוג</h2>
      <div class="chips">
        ${chip("skip-mode", "penalty", `עם קנס ${signed(-1)}`, s.skip === "penalty")}
        ${chip("skip-mode", "free", "בלי קנס", s.skip === "free")}
        ${chip("skip-mode", "off", "אסור לדלג", s.skip === "off")}
      </div>
    </section>

    <section class="panel">
      <div class="row">
        <label class="switch-label" for="lc-switch"><h2>הזדמנות אחרונה</h2></label>
        <input type="checkbox" switch role="switch" class="switch" id="lc-switch" data-switch="lc" ${s.lastChance ? "checked" : ""}>
      </div>
      <p class="sub">כשהזמן נגמר, המילה נשארת על המסך וכל הקבוצות יכולות לנחש.</p>
      ${lastChanceOptions}
    </section>

    <div class="footer">
      <button class="btn primary big" data-action="start" ${canStart ? "" : "disabled"}>מתחילים!</button>
    </div>`;
}

async function startGame() {
  const s = S.settings;
  if (G.poolFor(S.words, s.levels).length === 0) return;
  if (G.isGender(s)) {
    const w = G.genderCounts(S.words, s.levels);
    if (w.male === 0 || w.female === 0) return toast("חסרות מילים מאחד העולמות ברמות שנבחרו", 3200);
  }
  save(KEY_SETTINGS, s);
  try {
    const ok = await createRoom(s, { offline: S.nextOffline });
    if (!ok) toast("לא הצלחנו ליצור חדר. נסו שוב.", 3200);
    else S.nextOffline = false;
  } catch (err) {
    console.error(err);
    toast(
      err?.message === "permission_denied"
        ? DENIED_MSG
        : "לא הצלחנו ליצור חדר. בדקו את החיבור, או חזרו למסך הראשי ושחקו אופליין.",
      6000,
    );
  }
}

/* ───────────── הכנה לתור ───────────── */

function goReady(st) {
  const g = st.game;
  const idx = G.currentTeamIdx(g);
  const round = G.roundInfo(g);
  const roundText = round.tiebreak ? "סיבוב הכרעה" : `סיבוב ${num(round.number)} מתוך ${num(round.total)}`;
  const skipText = { penalty: "דילוג עם קנס", free: "דילוג בלי קנס", off: "בלי דילוג" }[g.settings.skip];
  const explainerGender = G.explainerGenderAt(g, g.turnIndex); // null מחוץ למצב בנים נגד בנות
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
      <p class="lead">התור של</p>
      <h1 class="team-title">${esc(g.teams[idx].name)}</h1>
      ${
        explainerGender
          ? `<p class="turn-who">${WORLD[explainerGender].icon} ${WORLD[explainerGender].explains}</p>
             <p class="lead">המילים מ${WORLD[G.oppositeGender(explainerGender)].world}</p>`
          : ""
      }
      <div class="pills">
        <span class="pill">${num(g.settings.turnSeconds)} שניות</span>
        <span class="pill">${skipText}</span>
        ${g.settings.lastChance ? `<span class="pill">הזדמנות אחרונה</span>` : ""}
      </div>
      <div class="score-list">${rows}</div>
      <p class="lead">${
        !explainerGender
          ? "מי שרוצה להסביר לוחץ/ת על הכפתור."
          : g.settings.format === "couples"
            ? WORLD[explainerGender].press
            : WORLD[explainerGender].pressTeam
      }<br>המילים יופיעו רק על הטלפון ${speaker(explainerGender).theirs}. כל השאר לא מציצים!</p>
      ${quipHtml("ready")}
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="claim">${speaker(explainerGender).iExplain}, מתחילים!</button>
    </div>`,
    "ready",
  );
  window.scrollTo(0, 0);
}

async function claim() {
  if (S.room?.phase !== "READY") return;
  ensureAudio();
  const ok = await dispatch({ type: "claim" });
  if (!ok) toast("טלפון אחר כבר לקח את התור");
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
      : `<button class="btn" data-action="skip">דלג${skip === "penalty" ? `<small>${signed(-1)}</small>` : ""}</button>`;

  show(
    `
    <div class="play-top">
      <span class="pill">${esc(team.name)}</span>
      <span class="pill" id="tally"></span>
    </div>
    ${worldPill(g.turn.explainerGender) ? `<div class="pills">${worldPill(g.turn.explainerGender)}</div>` : ""}
    <div class="timer-wrap" id="timer-wrap">
      <div class="timer" id="timer">${g.settings.turnSeconds}</div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <div class="word-box">
      <div class="word-card" id="card"><div class="word" id="word"></div></div>
    </div>
    <div class="actions">
      <button class="btn good big" data-action="correct">נכון</button>
      <div class="row2${skipButton ? "" : " one"}">
        ${skipButton}
        <button class="btn bad" data-action="taboo">אסור<small>${signed(-2)}</small></button>
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
    ${worldPill(g.turn.explainerGender) ? `<div class="pills">${worldPill(g.turn.explainerGender)}</div>` : ""}
    <div class="timer-wrap" id="timer-wrap">
      <div class="timer" id="timer">${g.settings.turnSeconds}</div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <p class="lead center-text">טלפון אחר מקריא את המילים. אפשר לנחש בקול!</p>
    <ol class="entries log" id="log" role="log" aria-label="מילים שכבר נוחשו"></ol>
    ${takeoverHtml(g.turn.explainerGender)}`,
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
      ? `<li class="entry empty">עוד אין מילים</li>`
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
  const unit = unitOf(g.settings);
  const teamButtons = g.teams
    .map(
      (t, i) => `
      <button class="btn team-btn" data-action="lc-team" data-value="${i}">
        <span>✓ ${esc(t.name)}${i === explaining ? `<small>${unit.explaining}</small>` : ""}</span>
        ${signed(i === explaining ? 1 : g.settings.stealPoints)}
      </button>`,
    )
    .join("");

  show(
    `
    <p class="lc-banner">הזמן נגמר!</p>
    <p class="lc-sub">כולם יכולים לנחש, גם ${unit.explaining}.</p>
    ${secs > 0 ? `<div class="timer-wrap"><div class="timer" id="lc-timer">${secs}</div></div>` : ""}
    <div class="word-card" id="card"><div class="word ${wordSize(entry.word)}">${esc(entry.word)}</div></div>
    ${quipHtml("lastchance")}
    <p class="lead">${unit.guessed}</p>
    <div class="stack">
      ${teamButtons}
      <button class="btn ghost on-light" data-action="lc-none">אף אחד לא ניחש</button>
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
    <p class="lc-banner">הזמן נגמר!</p>
    <p class="lc-sub">המילה האחרונה על הטלפון של ${speaker(st.game.turn.explainerGender).explainer}. כולם יכולים לנחש.</p>
    ${secs > 0 ? `<div class="timer-wrap"><div class="timer" id="lc-timer">${secs}</div></div>` : ""}
    ${quipHtml("lastchance")}
    <ol class="entries log" role="log" aria-label="מילים שכבר נוחשו">${[...R.resolvedEntries(st)]
      .reverse()
      .map((e) => `<li class="entry"><span>${esc(e.word)}</span>${badge(e, st.game)}</li>`)
      .join("")}</ol>
    ${takeoverHtml(st.game.turn.explainerGender)}`,
    "lastchance",
  );
  window.scrollTo(0, 0);
}

/* ───────────── סיכום תור ───────────── */

function badge(entry, game) {
  const s = game.settings;
  switch (entry.result) {
    case "correct":
      return `<span class="badge b-correct">✓ נכון ${signed(1)}</span>`;
    case "skip":
      return `<span class="badge b-skip">דילוג${s.skip === "penalty" ? ` ${signed(-1)}` : ""}</span>`;
    case "taboo":
      return `<span class="badge b-taboo">✗ אסור ${signed(-2)}</span>`;
    case "stolen":
      return `<span class="badge b-stolen">${esc(game.teams[entry.teamId]?.name ?? "")} ${signed(s.stealPoints)}</span>`;
    default:
      return `<span class="badge b-missed">לא נוחשה</span>`;
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
    <h1 class="page-title">סיכום התור</h1>
    ${
      hasEntries
        ? `<p class="lead">${editable ? "לחצו על מילה כדי לתקן את התוצאה שלה." : `${speaker(g.turn.explainerGender).explainer} ${speaker(g.turn.explainerGender).checks} את התוצאות.`}</p>
           <${editable ? "div" : "ol"} class="entries" id="entries">${entryLines(st, editable)}</${editable ? "div" : "ol"}>`
        : `<p class="lead">לא נאספו מילים בתור הזה.</p>`
    }
    <div class="deltas" id="deltas">${deltaChips || `<span class="delta">אין שינוי בניקוד</span>`}</div>
    ${quipHtml("summary")}
    ${
      editable
        ? `<div class="footer"><button class="btn primary big" data-action="confirm-turn">אישור והמשך</button></div>`
        : takeoverHtml(g.turn.explainerGender)
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
  const unit = unitOf(g.settings);
  const names = leaders.map((i) => `<h2 class="team-title sm">${esc(g.teams[i].name)}</h2>`).join("");
  show(
    `
    ${roomBar()}
    <div class="center grow">
      <h1 class="page-title">תיקו!</h1>
      <p class="lead">${unit.leading} עם ${num(g.teams[leaders[0]].score)} נקודות.<br>${unit.each} עוד תור הכרעה אחד.</p>
      ${names}
      ${quipHtml("tiebreak")}
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="tiebreak-go">לסיבוב ההכרעה</button>
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
      <p class="lead">${winners.length === 1 ? unitOf(g.settings).winner : unitOf(g.settings).tie}</p>
      ${headline}
      <div class="score-list">${table}</div>
      ${quipHtml("over")}
    </div>
    <div class="stack">
      <button class="btn primary big" data-action="new-from-room">משחק חדש</button>
      <button class="btn ghost" data-action="share">שתפו את המשחק</button>
      <button class="btn ghost" data-action="leave">דף הבית</button>
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
  if (n > teams.length) teams.push(G.defaultNameFor(S.settings, teams.length));
  else teams.length = n;
  rerenderSetup();
}

// בנים נגד בנות: מעבר בין קבוצות לזוגות. השמות חוזרים לברירת המחדל של המצב החדש.
function changeFormat(format) {
  if (!G.GENDER_FORMATS.includes(format) || S.settings.format === format) return;
  S.settings.format = format;
  const count = format === "teams" ? 2 : Math.max(G.LIMITS.minTeams, S.settings.teams.length);
  S.settings.teams = Array.from({ length: count }, (_, i) => G.defaultNameFor(S.settings, i));
  rerenderSetup();
}

function changeRounds(delta) {
  S.settings.rounds = clamp(S.settings.rounds + delta, G.LIMITS.minRounds, G.LIMITS.maxRounds);
  rerenderSetup();
}

const ACTIONS = {
  // בית
  new() {
    // בלי אינטרנט אין טעם לנסות Firebase: עוברים למשחק אופליין
    S.nextOffline = isOnline && navigator.onLine === false;
    if (S.nextOffline) toast("אין אינטרנט, מתחילים משחק אופליין", 3200);
    goSetup();
  },
  offline() {
    S.nextOffline = true;
    goSetup();
  },
  "new-from-room"() {
    S.nextOffline = S.offline; // ממשיכים באותו סוג משחק: אופליין נשאר אופליין
    forgetLastRoom();
    detach();
    goSetup();
  },
  home: () => goHome(),
  howto: () => goHowTo(),
  share: () => share(),
  leave: () => leaveRoom(),

  // הגדרות
  format: (v) => changeFormat(v),
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
    if (ok) toast("עכשיו אתם המסבירים");
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
    err.innerHTML = `<span role="img" aria-label="שגיאה">⚠️</span> ${
      ({ notfound: "לא נמצא חדר עם הקוד הזה. בדקו את הספרות.", denied: DENIED_MSG })[res.reason] ?? "לא הצלחנו להתחבר. בדקו את החיבור ונסו שוב."
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
  let message = ok ? "הועתק" : "ההעתקה נכשלה";
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
    await navigator.clipboard.writeText(text);
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
      <h1 class="page-title">לא הצלחתי לטעון את המשחק</h1>
      <p class="lead">קבצי הרמות והמילים לא נטענו${MODE === "gender" ? ` (הדף הזה צריך את <span class="num">${WORDS_FILE}</span> באותה תיקייה)` : ""}. אם פתחתם את הדף ישירות מהמחשב, צריך להריץ שרת מקומי, למשל:</p>
      <p class="pill"><span class="num">python -m http.server 8000</span></p>
    </div>`,
    "error",
  );
}

// בבנים נגד בנות הרמות נבנות מהרמות שמופיעות בקובץ המילים. אם יש levels-gender.json הוא קובע שם, תיאור ואייקון לפי ה-id.
function deriveGenderLevels(words, named) {
  const byId = new Map((named ?? []).filter((l) => l && l.id !== undefined).map((l) => [String(l.id), l]));
  const ids = [...new Set(words.map((w) => w.level))].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
  return ids.map((id) => ({ icon: "🎲", name: `רמה ${id}`, ...byId.get(String(id)), id }));
}

async function init() {
  S.clientId = makeClientId();
  try {
    if (MODE === "gender") {
      const [words, named] = await Promise.all([fetchJson(WORDS_FILE), fetchJson(LEVELS_FILE).catch(() => null)]);
      // רק מילים שמסומנות בעולם ברור ("female" או "male"). כפילויות (אותה מילה באותו עולם) מסוננות.
      const seen = new Set();
      S.words = words.filter((w) => {
        if (!w || typeof w.word !== "string" || !w.word.trim() || w.level === undefined) return false;
        if (w.gender !== "male" && w.gender !== "female") return false;
        const key = `${w.gender}|${w.word.trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      S.levels = deriveGenderLevels(S.words, named);
    } else {
      const [levels, words] = await Promise.all([fetchJson(LEVELS_FILE), fetchJson(WORDS_FILE)]);
      S.levels = levels.filter((l) => l && l.id !== undefined && l.name);
      S.words = words.filter((w) => w && typeof w.word === "string" && w.word.trim() && w.level !== undefined);
    }
  } catch (err) {
    console.error(err);
    renderLoadError();
    return;
  }
  S.counts = G.countByLevel(S.words);
  S.settings = G.sanitizeSettings(load(KEY_SETTINGS), usableLevelIds(), MODE);

  // קישור עם ?room=123456 מצטרף ישר. אחרת חוזרים לחדר האחרון, אם הוא עדיין קיים.
  const params = new URLSearchParams(location.search);
  const fromLink = params.get("room");
  const code = R.isValidCode(fromLink) ? fromLink : load(KEY_LAST_ROOM, "session");
  const offline = !R.isValidCode(fromLink) && load(KEY_LAST_OFFLINE, "session") === true;
  if (fromLink !== null) history.replaceState(null, "", location.pathname);
  if (R.isValidCode(code)) {
    const res = await joinRoom(code, { offline });
    if (res.ok) return;
    if (res.reason === "notfound") forgetLastRoom();
    goHome();
    if (res.reason === "denied") toast(DENIED_MSG, 6000);
    else if (fromLink !== null) toast(res.reason === "notfound" ? "לא נמצא חדר עם הקוד הזה" : "לא הצלחנו להתחבר לחדר", 3200);
    return;
  }
  goHome();
}

// כשהחיבור לאינטרנט נקטע או חוזר ואנחנו במסך הבית, מעדכנים אותו כדי שכפתור האופליין יתאים
for (const ev of ["online", "offline"]) {
  window.addEventListener(ev, () => {
    if (document.body.dataset.screen === "home") goHome();
  });
}

init();
