import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../game.js";
import * as R from "../room.js";

const words = Array.from({ length: 60 }, (_, i) => ({ word: `מילה${i}`, level: 1 }));
const settings = (extra = {}) => ({
  ...G.sanitizeSettings({ teams: ["א", "ב", "ג"], rounds: 1, turnSeconds: 30 }, [1]),
  ...extra,
});
const fresh = (extra) => R.createRoomState(settings(extra), words);
const NOW = 1_000_000;
const A = "phone-a";
const B = "phone-b";

function claimed(by = A, extra) {
  return R.reduce(fresh(extra), { type: "claim", by, now: NOW });
}

test("הראשון שלוחץ על claim מקבל את התור, והשני נדחה", () => {
  const s0 = fresh();
  const s1 = R.reduce(s0, { type: "claim", by: A, now: NOW });
  assert.equal(s1.phase, "PLAYING");
  assert.equal(s1.explainer, A);
  assert.equal(s1.endsAt, NOW + 30_000);
  assert.equal(R.reduce(s1, { type: "claim", by: B, now: NOW }), null);
});

test("reduce לא משנה את המצב שהוא קיבל", () => {
  const s0 = fresh();
  const copy = structuredClone(s0);
  R.reduce(s0, { type: "claim", by: A, now: NOW });
  assert.deepEqual(s0, copy);
});

test("רק המסביר/ה יכול/ה לסמן מילים, ולחיצה כפולה לא מסמנת את המילה הבאה", () => {
  const s = claimed();
  assert.equal(R.reduce(s, { type: "answer", by: B, result: "correct", n: 1 }), null);
  const s2 = R.reduce(s, { type: "answer", by: A, result: "correct", n: 1 });
  assert.equal(s2.game.turn.entries[0].result, "correct");
  // אותה לחיצה שוב (n=1 ישן) נדחית
  assert.equal(R.reduce(s2, { type: "answer", by: A, result: "correct", n: 1 }), null);
  assert.equal(R.resolvedEntries(s2).length, 1);
});

test("צופים רואים רק מילים שכבר קיבלו תוצאה", () => {
  const s = claimed();
  assert.equal(R.resolvedEntries(s).length, 0);
  const s2 = R.reduce(s, { type: "answer", by: A, result: "taboo", n: 1 });
  assert.deepEqual(R.resolvedEntries(s2).map((e) => e.result), ["taboo"]);
});

test("סיום תור: המסביר/ה בזמן, אחרים רק אחרי זמן החסד", () => {
  const s = claimed();
  const ti = s.game.turnIndex;
  const end = s.endsAt;
  assert.equal(R.reduce(s, { type: "endTurn", by: A, ti, now: end - 5000 }), null);
  assert.equal(R.reduce(s, { type: "endTurn", by: B, ti, now: end + 100 }), null);
  assert.ok(R.reduce(s, { type: "endTurn", by: A, ti, now: end + 100 }));
  assert.ok(R.reduce(s, { type: "endTurn", by: B, ti, now: end + R.GRACE_MS }));
});

test("endTurn של תור ישן נדחה", () => {
  const s = claimed();
  assert.equal(R.reduce(s, { type: "endTurn", by: A, ti: 99, now: s.endsAt + 10 }), null);
});

test("הזדמנות אחרונה → סיכום → אישור מחזיר להכנה עם ניקוד", () => {
  let s = claimed();
  const ti = s.game.turnIndex;
  s = R.reduce(s, { type: "answer", by: A, result: "correct", n: 1 });
  s = R.reduce(s, { type: "endTurn", by: A, ti, now: s.endsAt });
  assert.equal(s.phase, "LAST_CHANCE");
  assert.equal(s.lcEndsAt, s.endsAt + 10_000);
  // קבוצה 1 (לא המסבירה) ניחשה
  assert.equal(R.reduce(s, { type: "resolveLast", by: B, ti, teamIdx: 1, now: s.endsAt }), null);
  s = R.reduce(s, { type: "resolveLast", by: A, ti, teamIdx: 1, now: s.endsAt });
  assert.equal(s.phase, "SUMMARY");
  assert.equal(R.reduce(s, { type: "confirm", by: B, ti }), null);
  s = R.reduce(s, { type: "confirm", by: A, ti });
  assert.equal(s.phase, "READY");
  assert.equal(s.explainer, null);
  assert.equal(s.game.turnIndex, 1);
  assert.deepEqual(s.game.teams.map((t) => t.score), [1, 1, 0]);
});

test("בלי הזדמנות אחרונה עוברים ישר לסיכום", () => {
  const s = claimed(A, { lastChance: false });
  const ti = s.game.turnIndex;
  const s2 = R.reduce(s, { type: "endTurn", by: A, ti, now: s.endsAt });
  assert.equal(s2.phase, "SUMMARY");
});

test("טלפון אחר סוגר הזדמנות אחרונה מוגבלת בזמן אם המסביר/ה נעלם", () => {
  let s = claimed();
  const ti = s.game.turnIndex;
  s = R.reduce(s, { type: "endTurn", by: A, ti, now: s.endsAt });
  assert.equal(R.reduce(s, { type: "resolveLast", by: B, ti, teamIdx: null, now: s.lcEndsAt + 100 }), null);
  const done = R.reduce(s, { type: "resolveLast", by: B, ti, teamIdx: null, now: s.lcEndsAt + R.GRACE_MS });
  assert.equal(done.phase, "SUMMARY");
});

test("takeover מעביר את השליטה לטלפון אחר, ורק בשלבי תור", () => {
  const s = claimed();
  const t = R.reduce(s, { type: "takeover", by: B });
  assert.equal(t.explainer, B);
  assert.ok(R.reduce(t, { type: "answer", by: B, result: "correct", n: 1 }));
  assert.equal(R.reduce(fresh(), { type: "takeover", by: B }), null);
});

test("מנה לא תקפה: teamIdx, index ו-type לא מוכרים נדחים", () => {
  let s = claimed();
  const ti = s.game.turnIndex;
  s = R.reduce(s, { type: "endTurn", by: A, ti, now: s.endsAt });
  assert.equal(R.reduce(s, { type: "resolveLast", by: A, ti, teamIdx: 7, now: 0 }), null);
  assert.equal(R.reduce(s, { type: "nope", by: A }), null);
  assert.equal(R.reduce(null, { type: "claim", by: A, now: 0 }), null);
});

test("משחק שלם עד הסוף, כולל תיקו וסיבוב הכרעה", () => {
  let s = fresh({ lastChance: false, teams: ["א", "ב"], rounds: 1 });
  const play = (by, result) => {
    s = R.reduce(s, { type: "claim", by, now: NOW });
    const ti = s.game.turnIndex;
    if (result) s = R.reduce(s, { type: "answer", by, result, n: s.game.turn.entries.length });
    s = R.reduce(s, { type: "endTurn", by, ti, now: s.endsAt });
    s = R.reduce(s, { type: "confirm", by, ti });
  };
  play(A, "correct");
  play(B, "correct");
  assert.equal(s.phase, "TIEBREAK");
  s = R.reduce(s, { type: "tiebreakGo" });
  assert.equal(s.phase, "READY");
  play(A, "correct");
  play(B, null);
  assert.equal(s.phase, "GAMEOVER");
  assert.deepEqual(G.leaders(s.game), [0]);
});

test("קוד חדר: שש ספרות", () => {
  assert.match(R.newCode(), /^[0-9]{6}$/);
  assert.ok(R.isValidCode("012345"));
  assert.ok(!R.isValidCode("12345"));
  assert.ok(!R.isValidCode("12345a"));
});
