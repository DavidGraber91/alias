// store.js — מקור האמת המשותף של חדר. שני מימושים עם אותו ממשק:
//   store-local.js    — localStorage, מסתנכרן בין לשוניות באותו דפדפן. עובד בלי הגדרות ובלי אינטרנט.
//   store-firebase.js — Firebase Realtime Database, בין טלפונים אמיתיים.
// בוחרים לפי firebase-config.js: אם יש שם הגדרות, משתמשים ב-Firebase.
//
// הממשק:
//   store.subscribe(cb)   cb(state | null) נקרא מיד ובכל שינוי. null = החדר לא קיים.
//   store.transact(fn)    fn(state | null) מחזיר מצב חדש, או null/undefined כדי לבטל.
//                         מחזיר Promise של { committed, state }.
//   store.serverNow()     שעה משותפת (ms), כדי שהטיימר יהיה זהה בכל הטלפונים.
//   store.onConnection(cb) cb(true | false) — האם יש חיבור.
//   store.close()

import { firebaseConfig } from "./firebase-config.js";

export const isOnline = Boolean(firebaseConfig);

// כשיש Firebase, מתחילים להוריד את ה-SDK שלו ברקע כבר כשהדף עולה (בלי לפתוח חיבור), כדי שיצירת משחק
// ברשת חלשה לא תחכה להורדה. כישלון כאן שקט: הפעולה הראשונה מול החדר תנסה שוב ותדווח על שגיאה.
if (firebaseConfig) {
  import("./store-firebase.js").then((m) => m.preload(firebaseConfig)).catch(() => {});
}

// offline: חדר מקומי בטלפון אחד, בלי שום פנייה לרשת, גם כש-Firebase מוגדר.
export async function openStore(code, { offline = false } = {}) {
  if (firebaseConfig && !offline) {
    const { open } = await import("./store-firebase.js");
    return open(code, firebaseConfig);
  }
  const { open } = await import("./store-local.js");
  return open(code);
}

// מוחק חדר מקומי שנגמר, כדי שמשחקי אופליין לא יצטברו באחסון של הדפדפן.
export async function forgetLocal(code) {
  const { forget } = await import("./store-local.js");
  forget(code);
}
