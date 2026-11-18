// store-firebase.js — חדר ב-Firebase Realtime Database.
//
// המצב נשמר כמחרוזת JSON אחת בשדה `s`, ולא כעץ של אובייקטים. ב-Realtime Database מערכים ריקים
// ו-null נמחקים, והמצב של המשחק מלא בהם (entries: [], result: null). מחרוזת שומרת אותו כמו שהוא.
// כל פעולה רצה ב-runTransaction, כך ששני טלפונים שלוחצים באותו רגע לא דורכים זה על זה.
//
// הגרסה מקובעת (ולא latest) כדי ששינוי אצל ספק ה-CDN לא ישבור את המשחק בלי שנדע.
const SDK = "https://www.gstatic.com/firebasejs/11.10.0";

export async function open(code, config) {
  const [{ initializeApp }, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const { getDatabase, ref, onValue, runTransaction } = db;

  const database = getDatabase(initializeApp(config));
  const room = ref(database, `rooms/${code}`);

  let offset = 0;
  const offStop = onValue(ref(database, ".info/serverTimeOffset"), (snap) => {
    offset = snap.val() || 0;
  });

  const parse = (val) => {
    try {
      return val?.s ? JSON.parse(val.s) : null;
    } catch {
      return null;
    }
  };

  return {
    code,
    subscribe(cb) {
      return onValue(room, (snap) => cb(parse(snap.val())));
    },
    async transact(fn) {
      const res = await runTransaction(room, (cur) => {
        const next = fn(parse(cur));
        if (next === undefined || next === null) return; // מבטל את הטרנזקציה
        return { s: JSON.stringify(next), t: cur?.t ?? Date.now() };
      });
      return { committed: res.committed, state: parse(res.snapshot.val()) };
    },
    serverNow: () => Date.now() + offset,
    onConnection(cb) {
      return onValue(ref(database, ".info/connected"), (snap) => cb(Boolean(snap.val())));
    },
    close() {
      offStop();
    },
  };
}
