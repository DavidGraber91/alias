#!/usr/bin/env python3
"""sync-web.py — מעתיק את קבצי המשחק (האתר) לתוך אפליקציית האנדרואיד.

האתר (בשורש המאגר) הוא המקור היחיד של קוד המשחק. האפליקציה רק אורזת אותו:
הקבצים נכנסים ל-android/app/src/main/assets/www ונטענים ב-WebView.

מריצים בכל פעם שמשנים משהו באתר (טקסטים ב-strings.js, מילים, עיצוב, firebase-config.js...), לפני בנייה מחדש:

    python sync-web.py          (ב-Windows אפשר גם:  py sync-web.py)

אין תלויות: ספריית הפייתון הרגילה בלבד.
"""
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent  # שורש המאגר: index.html, app.js, ...
OUT = HERE / "app" / "src" / "main" / "assets" / "www"

# רשימת היתרים: רק מה שהמשחק צריך בזמן ריצה. בלי בדיקות, README, SEO ודף הניהול.
INCLUDE = [
    "index.html",
    "style.css",
    "app.js",
    "app-config.js",
    "firebase-config.js",
    "strings.js",
    "quips.js",
    "game.js",
    "room.js",
    "store.js",
    "store-local.js",
    "store-firebase.js",
    "levels.json",
    "words.json",
    "manifest.webmanifest",
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
]


def main() -> int:
    missing = [name for name in INCLUDE if not (WEB / name).is_file()]
    if missing:
        print("חסרים קבצים בשורש האתר:", ", ".join(missing))
        print(f"חיפשתי ב: {WEB}")
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    total = 0
    for name in INCLUDE:
        shutil.copy2(WEB / name, OUT / name)
        total += (WEB / name).stat().st_size
    print(f"הועתקו {len(INCLUDE)} קבצים ({total / 1024:.0f}KB) אל {OUT}")

    config = (WEB / "firebase-config.js").read_text(encoding="utf-8")
    if "YOUR_" in config:
        print()
        print("שימו לב: firebase-config.js עדיין מכיל YOUR_... ולכן האפליקציה תעבוד רק במצב מקומי (טלפון אחד).")
        print("מלאו אותו (ראו README-android.md) והריצו שוב.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
