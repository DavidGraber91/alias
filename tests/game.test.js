import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../game.js";

const words = Array.from({ length: 40 }, (_, i) => ({ word: `מילה${i}`, level: (i % 2) + 1 }));
const settings = (extra = {}) => ({
  ...G.sanitizeSettings({ teams: ["א", "ב", "ג"], rounds: 2 }, [1, 2]),
  ...extra,
});

test("sanitizeSettings מתקן ערכים לא תקינים", () => {
  const s = G.sanitizeSettings(
    { teams: ["a"], rounds: 99, turnSeconds: 7, levels: [9], skip: "x", stealPoints: 5 },
    [1, 2],
  );
  assert.equal(s.teams.length, 2);
  assert.equal(s.rounds, 10);
  assert.equal(s.turnSeconds, 60);
  assert.deepEqual(s.levels, [1, 2]);
  assert.equal(s.skip, "penalty");
  assert.equal(s.stealPoints, 1);
});

test("estimateMinutes: 3 קבוצות × 3 סיבובים × 60 שניות", () => {
  const s = G.sanitizeSettings({ teams: ["א", "ב", "ג"], rounds: 3, turnSeconds: 60 }, [1]);
  assert.equal(G.totalTurns(s), 9);
  assert.deepEqual(G.estimateMinutes(s), { min: 13, max: 16 });
});

test("createGame בונה תור לכל קבוצה בכל סיבוב", () => {
  const g = G.createGame(settings(), words);
  assert.deepEqual(g.queue, [0, 1, 2, 0, 1, 2]);
  assert.equal(g.deck.length, 40);
});

test("הזדמנות אחרונה: המילה נשארת והקבוצה שענתה מקבלת נקודה", () => {
  const g = G.createGame(settings(), words);
  G.startTurn(g);
  assert.ok(G.markCurrent(g, "correct"));
  assert.ok(G.markCurrent(g, "taboo"));
  assert.ok(G.markCurrent(g, "skip"));
  assert.equal(G.finishTimer(g), "LAST_CHANCE");
  assert.equal(g.turn.entries.length, 4);

  const resolved = G.resolveLastChance(g.turn, 2);
  assert.equal(resolved.entries[3].result, "stolen");
  assert.equal(g.turn.entries[3].result, null, "הקלט לא משתנה");
  // נכון +1, אסור −1, דילוג −1 (עם קנס) → קבוצה 0: ‎−1. קבוצה 2 גנבה: ‎+1
  assert.deepEqual(G.turnDeltas(resolved, g.settings, 3), [-1, 0, 1]);
});

test("הקבוצה המסבירה שענתה בהזדמנות האחרונה מקבלת +1", () => {
  const g = G.createGame(settings(), words);
  G.startTurn(g);
  G.finishTimer(g);
  const resolved = G.resolveLastChance(g.turn, 0);
  assert.equal(resolved.entries[0].result, "correct");
  assert.deepEqual(G.turnDeltas(resolved, g.settings, 3), [1, 0, 0]);
});

test("ניקוד גנבה 2", () => {
  const g = G.createGame(settings({ stealPoints: 2 }), words);
  G.startTurn(g);
  G.finishTimer(g);
  const resolved = G.resolveLastChance(g.turn, 1);
  assert.deepEqual(G.turnDeltas(resolved, g.settings, 3), [0, 2, 0]);
});

test("אף אחד לא ענה: אין נקודות", () => {
  const g = G.createGame(settings(), words);
  G.startTurn(g);
  G.finishTimer(g);
  const resolved = G.resolveLastChance(g.turn, null);
  assert.equal(resolved.entries[0].result, "missed");
  assert.deepEqual(G.turnDeltas(resolved, g.settings, 3), [0, 0, 0]);
});

test("בלי הזדמנות אחרונה: המילה חוזרת לחבילה ולא נספרת", () => {
  const g = G.createGame(settings({ lastChance: false }), words);
  G.startTurn(g);
  G.markCurrent(g, "correct");
  const before = g.deck.length;
  assert.equal(G.finishTimer(g), "SUMMARY");
  assert.equal(g.turn.entries.length, 1);
  assert.equal(g.deck.length, before + 1);
  assert.equal(g.used.length, 1);
});

test("דילוג: חופשי, עם קנס, ואסור", () => {
  const free = G.createGame(settings({ skip: "free" }), words);
  G.startTurn(free);
  G.markCurrent(free, "skip");
  assert.deepEqual(G.turnDeltas(free.turn, free.settings, 3), [0, 0, 0]);

  const off = G.createGame(settings({ skip: "off" }), words);
  G.startTurn(off);
  assert.equal(G.markCurrent(off, "skip"), false);
});

test("כשהמילים נגמרות מערבבים מחדש ולא נשברים", () => {
  const tiny = G.createGame(settings(), [
    { word: "א", level: 1 },
    { word: "ב", level: 1 },
  ]);
  G.startTurn(tiny);
  for (let i = 0; i < 6; i++) assert.ok(G.markCurrent(tiny, "correct"));
  assert.equal(tiny.turn.entries.length, 7);
});

test("cycleEntry עובר על כל האפשרויות וחוזר להתחלה", () => {
  const g = G.createGame(settings(), words);
  G.startTurn(g);
  G.finishTimer(g);
  let turn = G.resolveLastChance(g.turn, null); // missed, מילה אחרונה
  const options = G.resultOptions(turn.entries[0], turn, g.settings, 3);
  assert.equal(options.length, 6); // נכון, גנבה × 2, דילוג, אסור, לא נוחשה
  for (let i = 0; i < options.length; i++) turn = G.cycleEntry(turn, 0, g.settings, 3);
  assert.equal(turn.entries[0].result, "missed");
});

test("commitTurn מוסיף נקודות ומקדם תור", () => {
  const g = G.createGame(settings(), words);
  G.startTurn(g);
  G.markCurrent(g, "correct");
  G.markCurrent(g, "correct");
  G.finishTimer(g);
  g.turn = G.resolveLastChance(g.turn, null);
  G.commitTurn(g);
  assert.equal(g.teams[0].score, 2);
  assert.equal(g.turnIndex, 1);
  assert.equal(g.turn, null);
});

test("תיקו בראש מוביל לסיבוב הכרעה רק לקבוצות שבתיקו", () => {
  const g = G.createGame(settings(), words);
  g.teams[0].score = 5;
  g.teams[1].score = 5;
  g.teams[2].score = 1;
  g.turnIndex = g.queue.length;
  assert.equal(G.checkEnd(g), "TIEBREAK");
  G.startTiebreak(g);
  assert.deepEqual(g.queue.slice(6), [0, 1]);
  assert.equal(G.checkEnd(g), "CONTINUE");
  g.turnIndex = g.queue.length;
  assert.equal(G.checkEnd(g), "OVER");
});

test("מנצחת אחת: המשחק נגמר", () => {
  const g = G.createGame(settings(), words);
  g.teams[1].score = 3;
  g.turnIndex = g.queue.length;
  assert.equal(G.checkEnd(g), "OVER");
  assert.deepEqual(G.leaders(g), [1]);
  assert.equal(G.standings(g)[0].idx, 1);
});
