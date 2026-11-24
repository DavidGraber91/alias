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

// מתחיל לטעון את Firebase ברקע (נקרא בפתיחת האפליקציה), כדי שיצירת חדר והצטרפות יהיו מהירות
export function preload() {
  if (!firebaseConfig) return;
  import("./store-firebase.js").then((m) => m.preload(firebaseConfig)).catch(() => {});
}

export async function openStore(code) {
  if (firebaseConfig) {
    const { open } = await import("./store-firebase.js");
    return open(code, firebaseConfig);
  }
  const { open } = await import("./store-local.js");
  return open(code);
}
