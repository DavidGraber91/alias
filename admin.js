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
const ACTIVE_MS = 30 * 60 * 1000; // חדר שלא עודכן 30 דקות נחשב לא פעיל

const app = initializeApp(firebaseConfig);
const auth = authm.getAuth(app);
const db = dbm.getDatabase(app);
let started = false;

$("login").onclick = () => authm.signInWithPopup(auth, new authm.GoogleAuthProvider());
$("login").hidden = false;

authm.onAuthStateChanged(auth, (user) => {
  if (!user) {
    $("status").textContent = "צריך להתחבר.";
    return;
  }
  $("login").hidden = true;
  $("status").textContent = `מחובר/ת: ${user.email}`;
  if (!started) {
    started = true;
    dbm.onValue(dbm.ref(db, "stats/created"), (snap) => {
        $("created").textContent = snap.val() ?? 0;
    });
    dbm.onValue(
      dbm.ref(db, "rooms"),
      (snap) => render(snap.val() ?? {}),
      (err) => ($("status").textContent = `שגיאה: ${err.message}`),
    );
  }
});

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

  const active = rows.filter((r) => r.running).length;
  $("summary").hidden = false;
  $("summary").innerHTML = "";
  for (const [label, value] of [["סה\"כ משחקים", rows.length], ["פעילים עכשיו", active]]) {
    const p = document.createElement("p");
    p.textContent = `${label}: ${value}`;
    $("summary").append(p);
  }

  const list = $("rooms");
  list.replaceChildren(...rows.map(cardFor));
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