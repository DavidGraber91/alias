// game.js — הלוגיקה של המשחק, בלי DOM.
// המצב כולו הוא אובייקטים פשוטים, ולכן אפשר לשמור אותו ב-localStorage כמו שהוא
// וקל לבדוק אותו (ראו tests/game.test.js).

export const LIMITS = { minTeams: 2, maxTeams: 6, minRounds: 1, maxRounds: 10 };
export const TURN_SECONDS_OPTIONS = [30, 45, 60, 90];
export const LAST_CHANCE_OPTIONS = [10, 20, 0]; // 0 = עד שהמסביר/ה לוחץ/ת
const SECONDS_PER_WORD = 8; // הערכה גסה: כמה מילים עוברות בתור

const LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳"];
export const defaultTeamName = (i) => `קבוצה ${LETTERS[i] ?? i + 1}`;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ───────────── הגדרות ───────────── */

export function defaultSettings(levelIds = []) {
  return {
    teams: [defaultTeamName(0), defaultTeamName(1)],
    rounds: 3,
    turnSeconds: 60,
    levels: [...levelIds],
    skip: "penalty", // "penalty" = עם קנס | "free" = בלי קנס | "off" = אסור לדלג
    lastChance: true,
    lastChanceSeconds: 10, // 10 | 20 | 0 (עד לחיצה)
    stealPoints: 1, // ניקוד לקבוצה אחרת שניחשה בהזדמנות האחרונה: 1 או 2
  };
}

// מנקה הגדרות שנטענו מהאחסון המקומי (או נערכו ידנית) כך שלא ישברו את המשחק.
export function sanitizeSettings(raw, validLevelIds = []) {
  const d = defaultSettings(validLevelIds);
  const s = { ...d, ...(raw && typeof raw === "object" ? raw : {}) };

  let teams = Array.isArray(s.teams) ? s.teams.map((t) => String(t ?? "")) : d.teams;
  teams = teams.slice(0, LIMITS.maxTeams);
  while (teams.length < LIMITS.minTeams) teams.push(defaultTeamName(teams.length));
  s.teams = teams;

  s.rounds = clamp(Math.round(Number(s.rounds)) || d.rounds, LIMITS.minRounds, LIMITS.maxRounds);
  s.turnSeconds = TURN_SECONDS_OPTIONS.includes(s.turnSeconds) ? s.turnSeconds : d.turnSeconds;
  s.levels = Array.isArray(s.levels) ? s.levels.filter((id) => validLevelIds.includes(id)) : [];
  if (s.levels.length === 0) s.levels = [...validLevelIds];
  s.skip = ["penalty", "free", "off"].includes(s.skip) ? s.skip : d.skip;
  s.lastChance = Boolean(s.lastChance);
  s.lastChanceSeconds = LAST_CHANCE_OPTIONS.includes(s.lastChanceSeconds)
    ? s.lastChanceSeconds
    : d.lastChanceSeconds;
  s.stealPoints = s.stealPoints === 2 ? 2 : 1;
  return s;
}

/* ───────────── הערכת זמן ───────────── */

export const totalTurns = (s) => s.teams.length * s.rounds;

// זמן משחק משוער בדקות, כטווח. כולל מעבר בין תורות והזדמנות אחרונה.
export function estimateMinutes(s) {
  const turns = totalTurns(s);
  const lcLow = s.lastChance ? 5 : 0;
  const lcHigh = s.lastChance ? s.lastChanceSeconds || 15 : 0;
  const low = turns * (s.turnSeconds + 20 + lcLow);
  const high = turns * (s.turnSeconds + 35 + lcHigh);
  const min = Math.max(1, Math.round(low / 60));
  const max = Math.max(min, Math.round(high / 60));
  return { min, max };
}

// כמה מילים המשחק צפוי לצרוך, בערך
export const wordsNeeded = (s) => totalTurns(s) * Math.ceil(s.turnSeconds / SECONDS_PER_WORD);

/* ───────────── מילים ───────────── */

export function countByLevel(words) {
  const counts = {};
  for (const w of words) counts[w.level] = (counts[w.level] ?? 0) + 1;
  return counts;
}

export function poolFor(words, levelIds) {
  const wanted = new Set(levelIds.map(String));
  return words.filter((w) => wanted.has(String(w.level)));
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ───────────── יצירת משחק ───────────── */

function normalizeTeamNames(names) {
  const seen = new Map();
  return names.map((raw, i) => {
    const name = String(raw ?? "").trim().slice(0, 20) || defaultTeamName(i);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} (${n})` : name;
  });
}

export function createGame(settings, words, rng = Math.random) {
  const names = normalizeTeamNames(settings.teams);
  const pool = poolFor(words, settings.levels);
  if (pool.length === 0) throw new Error("אין מילים ברמות שנבחרו");

  // תור = קבוצה אחת. בכל סיבוב כל קבוצה משחקת פעם אחת.
  const queue = [];
  for (let r = 0; r < settings.rounds; r++) {
    for (let t = 0; t < names.length; t++) queue.push(t);
  }

  return {
    settings: { ...settings, teams: names, levels: [...settings.levels] },
    teams: names.map((name) => ({ name, score: 0 })),
    queue, // סדר התורות (אינדקסים של קבוצות)
    turnIndex: 0,
    tiebreak: false,
    deck: shuffle(pool, rng), // מילים שעוד לא יצאו
    used: [], // מילים שכבר יצאו
    turn: null,
  };
}

export const currentTeamIdx = (game) => game.queue[game.turnIndex];
export const isGameOver = (game) => game.turnIndex >= game.queue.length;

export function roundInfo(game) {
  if (game.tiebreak) return { tiebreak: true, number: null, total: game.settings.rounds };
  return {
    tiebreak: false,
    number: Math.floor(game.turnIndex / game.teams.length) + 1,
    total: game.settings.rounds,
  };
}

/* ───────────── תור ───────────── */

function drawEntry(game, rng = Math.random) {
  if (game.deck.length === 0) {
    // המילים נגמרו: מערבבים מחדש את מה שכבר יצא
    game.deck = shuffle(game.used, rng);
    game.used = [];
  }
  const w = game.deck.pop();
  game.used.push(w);
  const entry = { word: w.word, level: w.level, result: null, teamId: null, lastChance: false };
  game.turn.entries.push(entry);
  return entry;
}

export function startTurn(game, rng = Math.random) {
  game.turn = { teamIdx: currentTeamIdx(game), entries: [] };
  return drawEntry(game, rng);
}

// המילה שמוצגת עכשיו (עוד בלי תוצאה), או null
export function currentEntry(game) {
  const entries = game.turn?.entries;
  const last = entries?.[entries.length - 1];
  return last && last.result === null ? last : null;
}

// "correct" | "skip" | "taboo" — ואז מושכים מילה חדשה
export function markCurrent(game, result, rng = Math.random) {
  const entry = currentEntry(game);
  if (!entry) return false;
  if (!["correct", "skip", "taboo"].includes(result)) return false;
  if (result === "skip" && game.settings.skip === "off") return false;
  entry.result = result;
  drawEntry(game, rng);
  return true;
}

function discardPending(game) {
  const entries = game.turn.entries;
  const last = entries[entries.length - 1];
  if (last && last.result === null) {
    entries.pop();
    const w = game.used.pop(); // המילה חוזרת לחבילה, כי אף אחד לא התמודד איתה
    if (w) game.deck.push(w);
  }
}

// נקרא כשהטיימר נגמר. מחזיר לאיזה שלב עוברים: "LAST_CHANCE" או "SUMMARY".
// כשיש מילה על המסך והזדמנות אחרונה פעילה — המילה נשארת וכולם יכולים לענות.
export function finishTimer(game) {
  const entry = currentEntry(game);
  if (!entry) return "SUMMARY";
  if (game.settings.lastChance) {
    entry.lastChance = true;
    return "LAST_CHANCE";
  }
  discardPending(game);
  return "SUMMARY";
}

// teamId = אינדקס הקבוצה שענתה נכון, או null אם אף אחד. לא משנה את הקלט.
export function resolveLastChance(turn, teamId) {
  const entries = turn.entries.map((e) => ({ ...e }));
  const entry = entries[entries.length - 1];
  if (entry && entry.result === null) {
    if (teamId === null || teamId === undefined) {
      entry.result = "missed";
      entry.teamId = null;
    } else if (teamId === turn.teamIdx) {
      entry.result = "correct";
      entry.teamId = null;
    } else {
      entry.result = "stolen";
      entry.teamId = teamId;
    }
  }
  return { ...turn, entries };
}

/* ───────────── ניקוד ───────────── */

// כמה נקודות כל קבוצה מקבלת (או מפסידה) בתור הזה
export function turnDeltas(turn, settings, teamCount) {
  const deltas = Array(teamCount).fill(0);
  for (const e of turn.entries) {
    switch (e.result) {
      case "correct":
        deltas[turn.teamIdx] += 1;
        break;
      case "taboo":
        deltas[turn.teamIdx] -= 1;
        break;
      case "skip":
        if (settings.skip === "penalty") deltas[turn.teamIdx] -= 1;
        break;
      case "stolen":
        if (deltas[e.teamId] !== undefined) deltas[e.teamId] += settings.stealPoints;
        break;
      default: // "missed" — אף אחד לא קיבל נקודה
    }
  }
  return deltas;
}

// האפשרויות שלוחצים עליהן בסיכום התור כדי לתקן מילה, לפי הסדר
export function resultOptions(entry, turn, settings, teamCount) {
  const options = [{ result: "correct", teamId: null }];
  if (entry.lastChance) {
    for (let t = 0; t < teamCount; t++) {
      if (t !== turn.teamIdx) options.push({ result: "stolen", teamId: t });
    }
  }
  if (settings.skip !== "off") options.push({ result: "skip", teamId: null });
  options.push({ result: "taboo", teamId: null });
  options.push({ result: "missed", teamId: null });
  return options;
}

// עובר לתוצאה הבאה של מילה בתור. לא משנה את הקלט.
export function cycleEntry(turn, index, settings, teamCount) {
  const entries = turn.entries.map((e) => ({ ...e }));
  const entry = entries[index];
  if (!entry) return turn;
  const options = resultOptions(entry, turn, settings, teamCount);
  const at = options.findIndex(
    (o) => o.result === entry.result && (o.result !== "stolen" || o.teamId === entry.teamId),
  );
  const next = options[(at + 1) % options.length];
  entry.result = next.result;
  entry.teamId = next.teamId;
  return { ...turn, entries };
}

// מאשר את התור: מוסיף את הנקודות ועובר לתור הבא
export function commitTurn(game) {
  const deltas = turnDeltas(game.turn, game.settings, game.teams.length);
  deltas.forEach((d, i) => {
    game.teams[i].score += d;
  });
  game.turn = null;
  game.turnIndex += 1;
  return deltas;
}

/* ───────────── סוף משחק ───────────── */

export function standings(game) {
  return game.teams
    .map((t, idx) => ({ ...t, idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
}

export function leaders(game) {
  const max = Math.max(...game.teams.map((t) => t.score));
  return game.teams.flatMap((t, i) => (t.score === max ? [i] : []));
}

// "CONTINUE" = יש עוד תורות | "TIEBREAK" = תיקו בראש, צריך סיבוב הכרעה | "OVER" = נגמר
export function checkEnd(game) {
  if (!isGameOver(game)) return "CONTINUE";
  if (!game.tiebreak && leaders(game).length > 1) return "TIEBREAK";
  return "OVER";
}

// סיבוב הכרעה אחד: רק הקבוצות שבתיקו בראש משחקות תור נוסף
export function startTiebreak(game) {
  if (game.tiebreak) return;
  game.tiebreak = true;
  game.queue.push(...leaders(game));
}
