import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0";
const [{ initializeApp }, dbm, authm] = await Promise.all([
  import(`${SDK}/firebase-app.js`),
  import(`${SDK}/firebase-database.js`),
  import(`${SDK}/firebase-auth.js`),
]);

const $ = (id) => document.getElementById(id);
const PHASES = {
  READY: "מוכנים לתור", PLAYING: "תור פעיל", LAST_CHANCE: "הזדמנות אחרונה",
  SUMMARY: "סיכום תור", TIEBREAK: "תיקו", GAMEOVER: "נגמר",
};
const ACTIVE_MS = 30 * 60 * 1000; // חדר שעודכן לאחרונה לפני פחות מ-30 דקות מסומן כפעיל
const INACTIVE_MS = 3 * 60 * 60 * 1000; // חדר שלא עודכן מעל 3 שעות נחשב לא פעיל ונמחק בכפתור

const app = initializeApp(firebaseConfig);
const auth = authm.getAuth(app);
const db = dbm.getDatabase(app);
let started = false;
let currentRows = [];

$("login").onclick = () => authm.signInWithPopup(auth, new authm.GoogleAuthProvider());

authm.onAuthStateChanged(auth, (user) => {
  if (!user) {
    $("login").hidden = false;
    $("status").textContent = "צריך להתחבר.";
    return;
  }
  $("login").hidden = true;
  $("status").textContent = `מחובר/ת: ${user.email}`;
  if (started) return;
  started = true;
  dbm.onValue(
    dbm.ref(db, "rooms"),
    (snap) => render(snap.val() ?? {}),
    (err) => ($("status").textContent = `שגיאה: ${err.message}`),
  );
  dbm.onValue(dbm.ref(db, "stats/created"), (snap) => {
    const el = $("created");
    if (el) el.textContent = snap.val() ?? 0;
  });
});

$("cleanup").onclick = cleanupInactive;

function parseState(room) {
  try { return JSON.parse(room.s); } catch { return null; }
}

function render(rooms) {
  const rows = Object.entries(rooms).map(([code, room]) => {
    const st = parseState(room);
    const last = room.u ?? room.t ?? 0;
    const phase = st?.phase ?? "?";
    const running = phase !== "GAMEOVER" && Date.now() - last < ACTIVE_MS;
    return { code, room, st, last, phase, running };
  }).sort((a, b) => b.last - a.last);
  currentRows = rows;

  const active = rows.filter((r) => r.running).length;
  const inactive = rows.filter((r) => Date.now() - r.last >= INACTIVE_MS).length;

  const summary = $("summary");
  summary.hidden = false;
  summary.innerHTML = "";
  for (const [label, value] of [
    ["משחקים במסד", rows.length],
    ["פעילים עכשיו", active],
    ["לא פעילים מעל 3 שעות", inactive],
  ]) {
    const p = document.createElement("p");
    p.textContent = `${label}: ${value}`;
    summary.append(p);
  }
  const created = document.createElement("p");
  created.append("נוצרו בסך הכול: ");
  const span = document.createElement("span");
  span.id = "created";
  span.className = "num";
  span.textContent = "…";
  created.append(span);
  summary.append(created);

  $("cleanup").disabled = inactive === 0;
  $("rooms").replaceChildren(...rows.map(cardFor));
}

// מוחק בבת אחת את כל החדרים שלא עודכנו מעל 3 שעות. עדכון רב-נתיבי עם null מוחק כל נתיב.
async function cleanupInactive() {
  const targets = currentRows.filter((r) => Date.now() - r.last >= INACTIVE_MS);
  if (targets.length === 0) {
    $("status").textContent = "אין חדרים לא פעילים למחיקה.";
    return;
  }
  if (!confirm(`למחוק ${targets.length} חדרים שלא עודכנו מעל 3 שעות? אי אפשר לשחזר.`)) return;
  $("cleanup").disabled = true;
  try {
    const updates = Object.fromEntries(targets.map((r) => [r.code, null]));
    await dbm.update(dbm.ref(db, "rooms"), updates);
    $("status").textContent = `נמחקו ${targets.length} חדרים.`;
  } catch (err) {
    console.error(err);
    $("status").textContent = `המחיקה נכשלה: ${err.message}`;
    $("cleanup").disabled = false;
  }
}

function cardFor({ code, room, st, last, phase, running }) {
  const card = document.createElement("article");
  card.className = `card ${running ? "running" : "over"}`;

  const title = document.createElement("h2");
  title.textContent = `חדר ${code}`;
  title.className = "num";
  card.append(title);

  const line = (text) => {
    const p = document.createElement("p");
    p.textContent = text;
    card.append(p);
  };
  line(`סטטוס: ${PHASES[phase] ?? phase}${running ? " (פעיל)" : ""}`);
  line(`נוצר: ${new Date(room.t ?? 0).toLocaleString("he-IL")}`);
  line(`עודכן: ${last ? new Date(last).toLocaleString("he-IL") : "-"}`);
  if (st?.game) {
    const g = st.game;
    line(`סיבוב: ${Math.floor(g.turnIndex / g.teams.length) + 1} מתוך ${g.settings.rounds}`);
    line(`ניקוד: ${g.teams.map((t) => `${t.name} ${t.score}`).join(" · ")}`);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.textContent = "מחיקת החדר";
  del.onclick = async () => {
    if (!confirm(`למחוק את חדר ${code}?`)) return;
    await dbm.remove(dbm.ref(db, `rooms/${code}`));
  };
  card.append(del);
  return card;
}