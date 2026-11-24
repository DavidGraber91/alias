// store-firebase.js — חדר ב-Firebase Realtime Database.
//
// המצב נשמר כמחרוזת JSON אחת בשדה `s`, ולא כעץ של אובייקטים. ב-Realtime Database מערכים ריקים
// ו-null נמחקים, והמצב של המשחק מלא בהם (entries: [], result: null). מחרוזת שומרת אותו כמו שהוא.
// כל פעולה רצה ב-runTransaction, כך ששני טלפונים שלוחצים באותו רגע לא דורכים זה על זה.
//
// הגרסה מקובעת (ולא latest) כדי ששינוי אצל ספק ה-CDN לא ישבור את המשחק בלי שנדע.
const SDK = "https://www.gstatic.com/firebasejs/11.10.0";

// טוענים את הספרייה ופותחים את החיבור פעם אחת. preload() מתחיל את זה כבר בפתיחת האפליקציה,
// כך שעד שלוחצים "משחק חדש" הכול כבר מוכן (בלי זה, בחיבור סלולרי איטי יצירת חדר מחכה להורדת הספרייה).
let ready = null;
function init(config) {
  ready ??= (async () => {
    const [{ initializeApp }, db] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
    const database = db.getDatabase(initializeApp(config));
    db.onValue(db.ref(database, ".info/connected"), () => {}); // מנוי ראשון פותח את החיבור לשרת מיד
    return { db, database };
  })();
  ready.catch(() => (ready = null)); // כישלון (אין רשת) לא נשמר, ובפעם הבאה מנסים שוב
  return ready;
}

export const preload = (config) => init(config);

export async function open(code, config) {
  const { db, database } = await init(config);
  const { ref, onValue, runTransaction, set, increment } = db;

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
    subscribe(cb, onError) {
      // onError מקבל שגיאה כמו permission_denied, כדי שההודעה תוצג למשתמש
      return onValue(room, (snap) => cb(parse(snap.val())), (err) => onError?.(err));
    },
    async transact(fn) {
      let isNew = false;
      const res = await runTransaction(room, (cur) => {
        isNew = !cur; // הפונקציה יכולה לרוץ כמה פעמים; הערך מהריצה האחרונה (זו שנשמרה) הוא הנכון
        const next = fn(parse(cur));
        if (next === undefined || next === null) return; // מבטל את הטרנזקציה
        // t = זמן יצירה, u = עדכון אחרון (דף הניהול משתמש בו כדי לדעת אילו חדרים פעילים)
        return { s: JSON.stringify(next), t: cur?.t ?? Date.now(), u: Date.now() + offset };
      });
      if (res.committed && isNew) {
        // מונה "נוצרו בסך הכול" (stats/created). increment() מוסיף 1 בשרת, בלי לקרוא את הערך:
        // טרנזקציה הייתה דורשת הרשאת קריאה, ו-stats לא פתוח לקריאה למשחק (רק לאדמין).
        // כישלון לא מפריע למשחק, אבל נרשם ב-console כדי שאפשר יהיה לאבחן.
        set(ref(database, "stats/created"), increment(1)).catch((err) => console.warn("stats/created:", err?.message));
      }
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
