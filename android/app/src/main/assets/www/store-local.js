// store-local.js — חדר ששמור ב-localStorage ומסתנכרן בין לשוניות באותו דפדפן דרך אירוע storage.
// משמש כשאין Firebase, ובבדיקות עם שני "טלפונים" בשתי לשוניות.

const keyOf = (code) => `alias.room.${code}.v1`;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function forget(code) {
  try {
    localStorage.removeItem(keyOf(code));
  } catch {
    /* אחסון חסום */
  }
}

export function open(code) {
  const key = keyOf(code);
  const listeners = new Set();
  let last = read(key);

  const parse = (raw) => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const emit = () => {
    const state = parse(last);
    for (const cb of listeners) cb(state);
  };

  const onStorage = (e) => {
    if (e.key !== key) return;
    last = e.newValue;
    emit();
  };
  window.addEventListener("storage", onStorage);

  return {
    code,
    subscribe(cb) {
      listeners.add(cb);
      queueMicrotask(() => listeners.has(cb) && cb(parse(last)));
      return () => listeners.delete(cb);
    },
    async transact(fn) {
      const current = parse(read(key));
      const next = fn(current);
      if (next === undefined || next === null) return { committed: false, state: current };
      const raw = JSON.stringify(next);
      try {
        localStorage.setItem(key, raw);
      } catch {
        return { committed: false, state: current };
      }
      last = raw;
      emit(); // אירוע storage לא נורה בלשונית שכתבה, ולכן מעדכנים ידנית
      return { committed: true, state: next };
    },
    serverNow: () => Date.now(),
    onConnection(cb) {
      cb(true);
      return () => {};
    },
    close() {
      window.removeEventListener("storage", onStorage);
      listeners.clear();
    },

    countCreated() {
      try {
        const n = Number(localStorage.getItem("alias.stats.created")) || 0;
        localStorage.setItem("alias.stats.created", String(n + 1));
      } catch {
        /* אחסון חסום */
      }
    },
  };
}
