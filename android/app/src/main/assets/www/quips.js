// quips.js — בוחר עקיצה אקראית. את הטקסטים עצמם (STR.quips) עורכים ב-strings.js.

import { STR } from "./strings.js";

export const QUIPS = STR.quips;

// בוחר עקיצה אקראית בלי לחזור על הקודמת באותה קבוצה
const last = {};
export function quip(kind, rng = Math.random) {
  const list = QUIPS[kind] ?? [];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  let i;
  do {
    i = Math.floor(rng() * list.length);
  } while (i === last[kind]);
  last[kind] = i;
  return list[i];
}
