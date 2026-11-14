// app.js — המסכים והחיבור בין המשחק (game.js) לדפדפן.
// כל מסך הוא פונקציה goXxx() שבונה HTML; לחיצות מטופלות במקום אחד (ACTIONS).

import * as G from "./game.js";

const $app = document.getElementById("app");
const KEY_SETTINGS = "alias.settings.v1";
const KEY_SAVE = "alias.save.v1";

const S = {
  levels: [],
  words: [],
  counts: {},
  settings: null,
  game: null,
  phase: "HOME",
  tick: null, // מזהה ה-interval של הטיימר הפעיל
  endsAt: 0, // מתי נגמר התור (Date.now)
  lcEndsAt: 0, // מתי נגמרת ההזדמנות האחרונה
  lastSecs: -1,
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

const load = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const save = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* אחסון חסום — המשחק עדיין עובד, רק בלי המשך אחרי רענון */
  }
};

// נשמר רק במעברי מסך שבהם אין טיימר רץ, כדי שרענון באמצע תור יחזיר להכנה לתור
const persist = () => save(KEY_SAVE, { game: S.game, phase: S.phase });

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (S.phase === "PLAYING" || S.phase === "LAST_CHANCE")) {
    acquireWakeLock();
  }
});

function stopTimers() {
  clearInterval(S.tick);
  S.tick = null;
}

/* ───────────── בית ושיתוף ───────────── */

function goHome() {
  stopTimers();
  releaseWakeLock();
  S.phase = "HOME";
  const saved = load(KEY_SAVE);
  const canResume = Boolean(saved?.game?.teams && saved.phase);
  show(
    `
    <div class="hero">
      <h1 class="title-sticker">אליאס</h1>
      <p class="tagline">מסבירים, מנחשים, מנצחים.<br>משחק מילים לקבוצות, על טלפון אחד.</p>
    </div>
    <div class="stack">
      ${canResume ? `<button class="btn primary big" data-action="resume">המשך משחק</button>` : ""}
      <button class="btn ${canResume ? "" : "primary big"}" data-action="new">משחק חדש</button>
      <button class="btn ghost" data-action="howto">איך משחקים?</button>
      <button class="btn ghost" data-action="share">שתפו את המשחק</button>
    </div>`,
    "home",
  );
  window.scrollTo(0, 0);
}

function goHowTo() {
  S.phase = "HOWTO";
  show(
    `
    <header class="topbar"><button class="link" data-action="home">חזרה</button></header>
    <h1 class="page-title">איך משחקים?</h1>
    <section class="panel howto">
      <ul>
        <li>מחלקים לקבוצות. בכל תור משחקת קבוצה אחת, ושחקן אחד ממנה מחזיק את הטלפון.</li>
        <li>מי שמחזיק/ה את הטלפון מסביר/ה את המילה שעל המסך בלי להגיד אותה או חלק ממנה.</li>
        <li>הקבוצה מנחשת. ניחשו? לוחצים "נכון" ומקבלים נקודה. קשה מדי? "דלג". אמרו את המילה עצמה? "אסור", ונקודה יורדת.</li>
        <li>כשהזמן נגמר, המילה האחרונה נשארת על המסך וכל הקבוצות יכולות לנחש. מי שניחשה נכון מקבלת נקודה.</li>
        <li>אחרי מספר הסיבובים שבחרתם, הקבוצה עם הכי הרבה נקודות מנצחת. בתיקו בראש יש סיבוב הכרעה.</li>
      </ul>
    </section>`,
    "howto",
  );
  window.scrollTo(0, 0);
}

async function share() {
  const url = location.href.split("#")[0];
  try {
    if (navigator.share) {
      await navigator.share({ title: "אליאס", text: "בואו לשחק אליאס!", url });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("הקישור הועתק");
  } catch {
    prompt("העתיקו את הקישור:", url);
  }
}

/* ───────────── הגדרות ───────────── */

function goSetup() {
  stopTimers();
  S.phase = "SETUP";
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
      <button type="button" class="step" data-action="${name}-dec" aria-label="פחות" ${value <= min ? "disabled" : ""}>−</button>
      <output>${value}</output>
      <button type="button" class="step" data-action="${name}-inc" aria-label="יותר" ${value >= max ? "disabled" : ""}>+</button>
    </div>`;

  const teamFields = s.teams
    .map(
      (name, i) =>
        `<input class="field" data-team="${i}" value="${esc(name)}" maxlength="20" placeholder="${esc(G.defaultTeamName(i))}" aria-label="שם קבוצה ${i + 1}" autocomplete="off">`,
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
    ? `<p class="note">נבחרו ${wordsLabel(pool)}</p>`
    : `<p class="note">בחרו לפחות רמה אחת.</p>`;
  const poolWarning =
    canStart && pool < needed
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
    <h1 class="page-title">הגדרות משחק</h1>

    <section class="panel">
      <h2>קבוצות</h2>
      <div class="row"><span>כמה קבוצות</span>${stepper("teams", s.teams.length, G.LIMITS.minTeams, G.LIMITS.maxTeams)}</div>
      ${teamFields}
    </section>

    <section class="panel">
      <h2>סיבובים</h2>
      <div class="row"><span>בכל סיבוב כל קבוצה משחקת תור</span>${stepper("rounds", s.rounds, G.LIMITS.minRounds, G.LIMITS.maxRounds)}</div>
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
        ${chip("skip", "penalty", `עם קנס ${signed(-1)}`, s.skip === "penalty")}
        ${chip("skip", "free", "בלי קנס", s.skip === "free")}
        ${chip("skip", "off", "אסור לדלג", s.skip === "off")}
      </div>
    </section>

    <section class="panel">
      <div class="row">
        <h2>הזדמנות אחרונה</h2>
        <button type="button" class="switch" role="switch" aria-checked="${s.lastChance}" aria-label="הזדמנות אחרונה" data-action="lc-toggle"></button>
      </div>
      <p class="sub">כשהזמן נגמר, המילה נשארת על המסך וכל הקבוצות יכולות לנחש.</p>
      ${lastChanceOptions}
    </section>

    <div class="footer">
      <button class="btn primary big" data-action="start" ${canStart ? "" : "disabled"}>מתחילים!</button>
    </div>`;
}

function startGame() {
  const s = S.settings;
  if (G.poolFor(S.words, s.levels).length === 0) return;
  save(KEY_SETTINGS, s);
  S.game = G.createGame(s, S.words);
  goReady();
}

/* ───────────── הכנה לתור ───────────── */

function goReady() {
  stopTimers();
  releaseWakeLock();
  S.phase = "READY";
  persist();
  const g = S.game;
  const idx = G.currentTeamIdx(g);
  const round = G.roundInfo(g);
  const roundText = round.tiebreak ? "סיבוב הכרעה" : `סיבוב ${num(round.number)} מתוך ${num(round.total)}`;
  const skipText = { penalty: "דילוג עם קנס", free: "דילוג בלי קנס", off: "בלי דילוג" }[g.settings.skip];
  const rows = g.teams
    .map(
      (t, i) =>
        `<div class="score-row${i === idx ? " now" : ""}"><span>${esc(t.name)}</span><b>${num(t.score)}</b></div>`,
    )
    .join("");

  show(
    `
    <header class="topbar">
      <span class="pill">${roundText}</span>
      <button class="link" data-action="quit">יציאה</button>
    </header>
    <div class="center">
      <p class="lead">התור של</p>
      <h1 class="team-title">${esc(g.teams[idx].name)}</h1>
      <div class="pills">
        <span class="pill">${num(g.settings.turnSeconds)} שניות</span>
        <span class="pill">${skipText}</span>
        ${g.settings.lastChance ? `<span class="pill">הזדמנות אחרונה</span>` : ""}
      </div>
      <div class="score-list">${rows}</div>
      <p class="lead">בחרו מי מסביר/ה והעבירו אליו/ה את הטלפון.<br>כל השאר לא מציצים!</p>
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="begin">מוכן/ה, מתחילים!</button>
    </div>`,
    "ready",
  );
  window.scrollTo(0, 0);
}

/* ───────────── משחק ───────────── */

function wordSize(word) {
  return word.length > 14 ? "w-s" : word.length > 8 ? "w-m" : "w-l";
}

function goPlaying() {
  S.phase = "PLAYING";
  const g = S.game;
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
  refreshWord(false);
  startTimer();
}

function refreshWord(animate = true) {
  const g = S.game;
  const entry = G.currentEntry(g);
  const word = document.getElementById("word");
  const card = document.getElementById("card");
  if (!entry || !word || !card) return;
  word.textContent = entry.word;
  word.className = `word ${wordSize(entry.word)}`;
  const correct = g.turn.entries.filter((e) => e.result === "correct").length;
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
  if (S.phase !== "PLAYING") return;
  if (!G.markCurrent(S.game, result)) return;
  vibrate(result === "taboo" ? [30, 40, 30] : 20);
  refreshWord();
}

// הטיימר מחשב לפי שעת הסיום ולא לפי ספירה, כדי שכיבוי מסך לא יעצור אותו
function startTimer() {
  stopTimers();
  S.endsAt = Date.now() + S.game.settings.turnSeconds * 1000;
  S.lastSecs = -1;
  acquireWakeLock();
  S.tick = setInterval(tickPlay, 100);
  tickPlay();
}

function tickPlay() {
  const left = S.endsAt - Date.now();
  if (left <= 0) {
    endPlay();
    return;
  }
  const secs = Math.ceil(left / 1000);
  const timer = document.getElementById("timer");
  const bar = document.getElementById("bar");
  const wrap = document.getElementById("timer-wrap");
  if (timer) timer.textContent = secs;
  if (bar) bar.style.width = `${(left / (S.game.settings.turnSeconds * 1000)) * 100}%`;
  if (wrap) wrap.classList.toggle("warn", secs <= 10);
  if (secs !== S.lastSecs) {
    S.lastSecs = secs;
    if (secs <= 3) beep(660, 90);
  }
}

function endPlay() {
  if (S.phase !== "PLAYING") return;
  stopTimers();
  beepEnd();
  vibrate([250, 100, 250]);
  if (G.finishTimer(S.game) === "LAST_CHANCE") goLastChance();
  else goSummary();
}

/* ───────────── הזדמנות אחרונה ───────────── */

function goLastChance() {
  S.phase = "LAST_CHANCE";
  const g = S.game;
  const entry = G.currentEntry(g);
  const secs = g.settings.lastChanceSeconds;
  const explaining = g.turn.teamIdx;
  const teamButtons = g.teams
    .map(
      (t, i) => `
      <button class="btn team-btn" data-action="lc-team" data-value="${i}">
        <span>✓ ${esc(t.name)}${i === explaining ? `<small>הקבוצה המסבירה</small>` : ""}</span>
        ${signed(i === explaining ? 1 : g.settings.stealPoints)}
      </button>`,
    )
    .join("");

  show(
    `
    <p class="lc-banner">הזמן נגמר!</p>
    <p class="lc-sub">כולם יכולים לנחש, גם הקבוצה המסבירה.</p>
    ${secs > 0 ? `<div class="timer-wrap"><div class="timer" id="lc-timer">${secs}</div></div>` : ""}
    <div class="word-card" id="card"><div class="word ${wordSize(entry.word)}">${esc(entry.word)}</div></div>
    <p class="lead">מי ניחש/ה נכון?</p>
    <div class="stack">
      ${teamButtons}
      <button class="btn ghost" style="color:inherit;border-color:currentColor" data-action="lc-none">אף אחד לא ניחש</button>
    </div>`,
    "lastchance",
  );
  window.scrollTo(0, 0);

  stopTimers();
  if (secs > 0) {
    S.lcEndsAt = Date.now() + secs * 1000;
    S.tick = setInterval(tickLast, 100);
    tickLast();
  }
}

function tickLast() {
  const left = S.lcEndsAt - Date.now();
  if (left <= 0) {
    beep(440, 250);
    resolveLast(null);
    return;
  }
  const el = document.getElementById("lc-timer");
  if (el) el.textContent = Math.ceil(left / 1000);
}

function resolveLast(teamIdx) {
  if (S.phase !== "LAST_CHANCE") return;
  stopTimers();
  S.game.turn = G.resolveLastChance(S.game.turn, teamIdx);
  if (teamIdx !== null) vibrate(30);
  goSummary();
}

/* ───────────── סיכום תור ───────────── */

function goSummary() {
  stopTimers();
  releaseWakeLock();
  S.phase = "SUMMARY";
  persist();
  show(summaryHtml(), "summary");
  window.scrollTo(0, 0);
}

function badge(entry, game) {
  const s = game.settings;
  switch (entry.result) {
    case "correct":
      return `<span class="badge b-correct">✓ נכון ${signed(1)}</span>`;
    case "skip":
      return `<span class="badge b-skip">דילוג${s.skip === "penalty" ? ` ${signed(-1)}` : ""}</span>`;
    case "taboo":
      return `<span class="badge b-taboo">אסור ${signed(-1)}</span>`;
    case "stolen":
      return `<span class="badge b-stolen">${esc(game.teams[entry.teamId]?.name ?? "")} ${signed(s.stealPoints)}</span>`;
    default:
      return `<span class="badge b-missed">לא נוחשה</span>`;
  }
}

function summaryHtml() {
  const g = S.game;
  const turn = g.turn;
  const deltas = G.turnDeltas(turn, g.settings, g.teams.length);
  const rows = turn.entries
    .map(
      (e, i) =>
        `<button class="entry" data-action="cycle" data-value="${i}"><span>${esc(e.word)}</span>${badge(e, g)}</button>`,
    )
    .join("");
  const deltaChips = deltas
    .map((d, i) =>
      d === 0 ? "" : `<span class="delta ${d > 0 ? "up" : "down"}">${esc(g.teams[i].name)} ${signed(d)}</span>`,
    )
    .join("");

  return `
    <header class="topbar">
      <span class="pill">${esc(g.teams[turn.teamIdx].name)}</span>
      <button class="link" data-action="quit">יציאה</button>
    </header>
    <h1 class="page-title">סיכום התור</h1>
    ${
      turn.entries.length
        ? `<p class="lead">לחצו על מילה כדי לתקן את התוצאה שלה.</p><div class="entries">${rows}</div>`
        : `<p class="lead">לא נאספו מילים בתור הזה.</p>`
    }
    <div class="deltas">${deltaChips || `<span class="delta">אין שינוי בניקוד</span>`}</div>
    <div class="footer">
      <button class="btn primary big" data-action="confirm-turn">אישור והמשך</button>
    </div>`;
}

function confirmTurn() {
  if (S.phase !== "SUMMARY") return;
  G.commitTurn(S.game);
  const end = G.checkEnd(S.game);
  if (end === "CONTINUE") goReady();
  else if (end === "TIEBREAK") goTiebreak();
  else goGameOver();
}

/* ───────────── תיקו וסוף משחק ───────────── */

function goTiebreak() {
  S.phase = "TIEBREAK";
  persist();
  const g = S.game;
  const leaders = G.leaders(g);
  const names = leaders.map((i) => `<h2 class="team-title sm">${esc(g.teams[i].name)}</h2>`).join("");
  show(
    `
    <div class="center grow">
      <h1 class="page-title">תיקו!</h1>
      <p class="lead">הקבוצות האלה מובילות עם ${num(g.teams[leaders[0]].score)} נקודות.<br>כל אחת משחקת עוד תור הכרעה אחד.</p>
      ${names}
    </div>
    <div class="footer">
      <button class="btn primary big" data-action="tiebreak-go">לסיבוב ההכרעה</button>
    </div>`,
    "tiebreak",
  );
  window.scrollTo(0, 0);
}

function goGameOver() {
  stopTimers();
  releaseWakeLock();
  S.phase = "GAMEOVER";
  save(KEY_SAVE, null);
  const g = S.game;
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
      <p class="lead">${winners.length === 1 ? "הקבוצה המנצחת" : "תיקו בין הקבוצות"}</p>
      ${headline}
      <div class="score-list">${table}</div>
    </div>
    <div class="stack">
      <button class="btn primary big" data-action="new">משחק חדש</button>
      <button class="btn ghost" data-action="share">שתפו את המשחק</button>
      <button class="btn ghost" data-action="home">דף הבית</button>
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
  home: () => goHome(),
  howto: () => goHowTo(),
  share: () => share(),
  resume() {
    const saved = load(KEY_SAVE);
    if (!saved?.game?.teams) return goHome();
    S.game = saved.game;
    if (saved.phase === "SUMMARY" && S.game.turn) return goSummary();
    if (saved.phase === "TIEBREAK") return goTiebreak();
    return goReady();
  },

  // הגדרות
  "teams-inc": () => changeTeams(1),
  "teams-dec": () => changeTeams(-1),
  "rounds-inc": () => changeRounds(1),
  "rounds-dec": () => changeRounds(-1),
  "turn-secs"(v) {
    S.settings.turnSeconds = Number(v);
    rerenderSetup();
  },
  skip(v) {
    if (S.phase === "SETUP") {
      S.settings.skip = v;
      rerenderSetup();
    } else answer("skip");
  },
  "lc-toggle"() {
    S.settings.lastChance = !S.settings.lastChance;
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
  quit() {
    if (confirm("לצאת מהמשחק? אפשר להמשיך אותו מדף הבית.")) goHome();
  },
  begin() {
    if (S.phase !== "READY") return;
    ensureAudio();
    G.startTurn(S.game);
    goPlaying();
  },
  correct: () => answer("correct"),
  taboo: () => answer("taboo"),
  "lc-team": (v) => resolveLast(Number(v)),
  "lc-none": () => resolveLast(null),
  cycle(v) {
    S.game.turn = G.cycleEntry(S.game.turn, Number(v), S.game.settings, S.game.teams.length);
    const y = window.scrollY;
    show(summaryHtml(), "summary");
    window.scrollTo(0, y);
    persist();
  },
  "confirm-turn": () => confirmTurn(),
  "tiebreak-go"() {
    G.startTiebreak(S.game);
    goReady();
  },
};

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.action]?.(el.dataset.value, el);
});

$app.addEventListener("change", (e) => {
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
});

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
      <p class="lead">קבצי הרמות והמילים לא נטענו. אם פתחתם את index.html ישירות מהמחשב, צריך להריץ שרת מקומי, למשל:</p>
      <p class="pill"><span class="num">python -m http.server 8000</span></p>
    </div>`,
    "error",
  );
}

async function init() {
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
  goHome();
}

init();
