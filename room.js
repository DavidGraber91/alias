// room.js — המצב המשותף של חדר משחק, בלי DOM ובלי רשת.
//
// כל הטלפונים בחדר רואים את אותו אובייקט מצב. כל שינוי הוא "פעולה" (action) שעוברת ב-reduce(),
// פונקציה טהורה שמקבלת מצב ופעולה ומחזירה מצב חדש, או null אם הפעולה לא תקפה (למשל מישהו אחר כבר
// לקח את התור). האחסון (store.js) מריץ אותה בתוך טרנזקציה, ולכן אין צורך בשרת עם לוגיקה
// ולכן אין "טלפון ראשי" שחייב להישאר מחובר.
//
// אין תור קבוע בין הטלפונים: בשלב ההכנה (READY) כל טלפון יכול לקחת את התור ("claim"),
// ומי שלקח הוא המסביר/ה: רק אצלו מוצגות המילים.

import * as G from "./game.js";

export const STATE_VERSION = 1;

// אחרי שהזמן נגמר, אם המסביר/ה לא סגר את השלב, טלפון אחר רשאי לסגור אותו אחרי ההמתנה הזו.
export const GRACE_MS = 3000;
// סטייה קטנה מותרת בין שעון הטלפון לשעון השרת, כדי שהמסביר/ה יוכל לסגור "בדיוק בזמן".
const SKEW_MS = 500;

export const CODE_LENGTH = 6;
export const isValidCode = (s) => new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(String(s));

export function newCode(rng = Math.random) {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += Math.floor(rng() * 10);
  return s;
}

export function createRoomState(settings, words, rng = Math.random) {
  return {
    v: STATE_VERSION,
    phase: "READY", // READY | PLAYING | LAST_CHANCE | SUMMARY | TIEBREAK | GAMEOVER
    game: G.createGame(settings, words, rng),
    explainer: null, // מזהה הטלפון שמסביר עכשיו
    endsAt: 0, // שעת השרת שבה נגמר התור
    lcEndsAt: 0, // שעת השרת שבה נגמרת ההזדמנות האחרונה (0 = עד לחיצה)
  };
}

const isExplainer = (s, a) => s.explainer !== null && s.explainer === a.by;
const sameTurn = (s, a) => a.ti === s.game.turnIndex;

/** מחזיר מצב חדש, או null אם הפעולה לא תקפה עכשיו. לא משנה את הקלט. */
export function reduce(state, action, rng = Math.random) {
  if (!state || state.v !== STATE_VERSION || !action) return null;
  const s = structuredClone(state);
  const g = s.game;

  switch (action.type) {
    // כל טלפון יכול לקחת את התור. הראשון שלוחץ מנצח, והשאר מקבלים null.
    case "claim": {
      if (s.phase !== "READY") return null;
      G.startTurn(g, rng);
      s.phase = "PLAYING";
      s.explainer = action.by;
      s.endsAt = action.now + g.settings.turnSeconds * 1000;
      return s;
    }

    // action.n = כמה מילים היו בתור כשנלחץ הכפתור. מונע סימון כפול של המילה הבאה בלחיצה כפולה.
    case "answer": {
      if (s.phase !== "PLAYING" || !isExplainer(s, action)) return null;
      if (g.turn.entries.length !== action.n) return null;
      return G.markCurrent(g, action.result, rng) ? s : null;
    }

    case "endTurn": {
      if (s.phase !== "PLAYING" || !sameTurn(s, action)) return null;
      const early = isExplainer(s, action) && action.now >= s.endsAt - SKEW_MS;
      const takeover = action.now >= s.endsAt + GRACE_MS;
      if (!early && !takeover) return null;
      if (G.finishTimer(g) === "LAST_CHANCE") {
        s.phase = "LAST_CHANCE";
        const secs = g.settings.lastChanceSeconds;
        s.lcEndsAt = secs > 0 ? action.now + secs * 1000 : 0;
      } else {
        s.phase = "SUMMARY";
      }
      return s;
    }

    // action.teamIdx = הקבוצה שניחשה, או null אם אף אחד
    case "resolveLast": {
      if (s.phase !== "LAST_CHANCE" || !sameTurn(s, action)) return null;
      const t = action.teamIdx;
      if (t !== null && !(Number.isInteger(t) && t >= 0 && t < g.teams.length)) return null;
      const timedOut = s.lcEndsAt > 0 && action.now >= s.lcEndsAt + GRACE_MS;
      if (!isExplainer(s, action) && !timedOut) return null;
      g.turn = G.resolveLastChance(g.turn, t);
      s.phase = "SUMMARY";
      return s;
    }

    // תיקון תוצאה של מילה בסיכום התור
    case "cycle": {
      if (s.phase !== "SUMMARY" || !isExplainer(s, action) || !sameTurn(s, action)) return null;
      if (!Number.isInteger(action.index) || !g.turn.entries[action.index]) return null;
      g.turn = G.cycleEntry(g.turn, action.index, g.settings, g.teams.length);
      return s;
    }

    case "confirm": {
      if (s.phase !== "SUMMARY" || !isExplainer(s, action) || !sameTurn(s, action)) return null;
      G.commitTurn(g);
      const end = G.checkEnd(g);
      s.phase = end === "CONTINUE" ? "READY" : end === "TIEBREAK" ? "TIEBREAK" : "GAMEOVER";
      s.explainer = null;
      s.endsAt = 0;
      s.lcEndsAt = 0;
      return s;
    }

    case "tiebreakGo": {
      if (s.phase !== "TIEBREAK") return null;
      G.startTiebreak(g);
      s.phase = "READY";
      return s;
    }

    // המסביר/ה נעלם (הטלפון כבה, נסגר הדף). טלפון אחר לוקח את השליטה בשלב הנוכחי.
    case "takeover": {
      if (!["PLAYING", "LAST_CHANCE", "SUMMARY"].includes(s.phase)) return null;
      if (s.explainer === action.by) return null;
      s.explainer = action.by;
      return s;
    }

    default:
      return null;
  }
}

/* ───────────── עזרים לתצוגה ───────────── */

export const roleOf = (state, clientId) => (state?.explainer && state.explainer === clientId ? "explainer" : "viewer");

// הערכים שלא כדאי שצופים יראו על המסך: המילה הנוכחית שעוד לא קיבלה תוצאה
export const resolvedEntries = (state) => (state?.game?.turn?.entries ?? []).filter((e) => e.result !== null);
