// store-firebase.js — חדר ב-Firebase Realtime Database.
//
// המצב נשמר כמחרוזת JSON אחת בשדה `s`, ולא כעץ של אובייקטים. ב-Realtime Database מערכים ריקים
// ו-null נמחקים, והמצב של המשחק מלא בהם (entries: [], result: null). מחרוזת שומרת אותו כמו שהוא.
// כל פעולה רצה ב-runTransaction, כך ששני טלפונים שלוחצים באותו רגע לא דורכים זה על זה.
//
// הגרסה מקובעת (ולא latest) כדי ששינוי אצל ספק ה-CDN לא ישבור את המשחק בלי שנדע.
const SDK = "https://www.gstatic.com/firebasejs/11.10.0";

// ה-SDK (שני קבצים מ-CDN) נטען פעם אחת ונשמר כהבטחה, כך שאפשר להתחיל להוריד אותו כבר כשהדף עולה
// (preload), והמשחק לא יחכה לו כשלוחצים "משחק חדש". בלי חיבור לשרת: החיבור נפתח רק בפעולה הראשונה
// מול החדר, כדי שמי שרק גולש בדף הבית לא יתפוס חיבור פתוח (ב-Firebase יש תקרה של חיבורים בו-זמניים).
let sdkPromise = null;
let databasePromise = null;

function loadSdk() {
  if (!sdkPromise) {
    const p = Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-database.js`)]).then(
      ([app, db]) => ({ ...app, ...db }),
    );
    sdkPromise = p;
    p.catch(() => {
      if (sdkPromise === p) sdkPromise = null; // כישלון (רשת חלשה) לא נשמר, ופעולה הבאה תנסה שוב
    });
  }
  return sdkPromise;
}

function loadDatabase(config) {
  if (!databasePromise) {
    const p = loadSdk().then(({ initializeApp, getDatabase }) => getDatabase(initializeApp(config)));
    databasePromise = p;
    p.catch(() => {
      if (databasePromise === p) databasePromise = null;
    });
  }
  return databasePromise;
}

// מתחיל להוריד ולהכין את ה-SDK ברקע. לא זורק שגיאה, וקריאה חוזרת לא עושה כלום.
export function preload(config) {
  return loadDatabase(config).then(
    () => true,
    () => false,
  );
}

export async function open(code, config) {
  const [database, { ref, onValue, runTransaction, update, increment }] = await Promise.all([
    loadDatabase(config),
    loadSdk(),
  ]);
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

    countCreated: () => update(ref(database, "stats"), { created: increment(1) }),
  };

}
