# אליאס לאנדרואיד

האפליקציה היא מעטפת קטנה (WebView) שמריצה **את אותו קוד של האתר**, על **אותו מסד Firebase**.
מי שמשחק באפליקציה ומי שמשחק באתר יכולים להיות באותו חדר.

```
alias/                          ← המאגר (אותו מאגר GitHub של האתר)
├── index.html, app.js, ...     ← האתר. המקור היחיד של קוד המשחק
├── strings.js                  ← כל הטקסטים של המשחק (מסכים, כפתורים, הודעות, עקיצות)
├── firebase-config.js          ← ⭐ כאן מדביקים את מפתח Firebase ואת קישור ה-Realtime Database
├── app-config.js               ← כתובת האתר לשיתוף (לא חובה)
└── android/                    ← פרויקט Android Studio (פותחים רק את התיקייה הזו)
    ├── sync-web.py             ← מעתיק את האתר לתוך האפליקציה
    └── app/src/main/
        ├── java/com/dabid/alias/   MainActivity.kt, NativeBridge.kt
        ├── res/values/strings.xml  ← טקסטים של מעטפת האנדרואיד (שם האפליקציה, "לחצו שוב ליציאה")
        └── assets/www/             ← העתק של האתר (נוצר ע"י sync-web.py)
```

## שלב 1: מפתח Firebase וקישור ה-Realtime Database (הדבר היחיד שחייבים למלא)

פותחים את **`firebase-config.js`** בשורש המאגר (לא את העותק שבתוך `android/`), ומחליפים כל `YOUR_...` בערך האמיתי:

```js
const config = {
  apiKey: "YOUR_API_KEY",                     // ← המפתח
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",   // ← הקישור ל-Realtime Database
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID",
};
```

איפה מוצאים את הערכים ב-[Firebase console](https://console.firebase.google.com):

| ערך | איפה |
|---|---|
| `apiKey`, `authDomain`, `projectId`, `appId` | ⚙ **Project settings ← General ← Your apps ← Web app ← SDK setup and configuration ← Config**. אפשר להדביק את כל האובייקט `firebaseConfig` משם במקום האובייקט שבקובץ. |
| `databaseURL` | **Build ← Realtime Database ← Data**, הכתובת שמעל הטבלה (מתחילה ב-`https://` ומסתיימת ב-`firebasedatabase.app` או ב-`firebaseio.com`). אם אין אותה ב-Config, מוסיפים אותה ידנית כמו בדוגמה. |

מה חשוב לדעת:

- **זה אותו מסד של האתר.** משתמשים בדיוק באותם ערכים של ה-Web app. **לא** צריך ליצור "Android app" ב-Firebase, ו**לא** צריך `google-services.json`.
- אם באתר שלכם `firebase-config.js` כבר מלא באמת, השאירו אותו כמו שהוא ואל תדרסו אותו בקובץ מהחבילה הזו (הפורמט תואם).
- ב-**Realtime Database ← Rules** חייבים להיות מפורסמים הכללים מ-`database.rules.json` (Publish). בלי זה תקבלו "Firebase חוסם את החדר".
- כל עוד נשאר `YOUR_...`, המשחק עובד במצב מקומי: טלפון אחד בלבד, בלי חדרים משותפים.

## שלב 2: להעתיק את האתר לאפליקציה

מהתיקייה `android/`:

```
python sync-web.py
```

(ב-Windows אפשר `py sync-web.py`.) צריך להריץ את זה **בכל פעם שמשנים משהו באתר**: טקסטים, מילים, עיצוב או `firebase-config.js`. הסקריפט מוחק ויוצר מחדש את `assets/www`.

## שלב 3: להריץ ב-Android Studio

1. **File ← Open** ובוחרים את התיקייה `android` (לא את המאגר כולו).
2. מחכים ל-Gradle Sync. בפעם הראשונה הוא מוריד תלויות, ו-Android Studio עשוי להציע לעדכן גרסאות (Update): אפשר לאשר.
3. מחברים טלפון עם **USB debugging** מופעל, או יוצרים אמולטור (**Device Manager**), ולוחצים על ▶ Run.
4. לבדיקה בין מכשירים: מקימים משחק בטלפון, ובמכשיר השני (או באתר, בדפדפן) מזינים את קוד 6 הספרות.

דרישות: אנדרואיד 7.0 ומעלה, ו-Android System WebView מעודכן (מתעדכן לבד דרך חנות Play; מומלץ גרסה 119 ומעלה).

## שלב 4: קובץ APK או פרסום

- **APK לשליחה לחברים:** **Build ← Build Bundle(s) / APK(s) ← Build APK(s)**. הקובץ ב-`app/build/outputs/apk/debug/`. מי שמתקין צריך לאשר "התקנה ממקורות לא ידועים".
- **גוגל פליי:** **Build ← Generate Signed App Bundle** ← AAB. יוצרים keystore ושומרים אותו ואת הסיסמה במקום בטוח: בלעדיו אי אפשר לעדכן את האפליקציה. לפני כן מחליפים את מזהה החבילה (ראו למטה).

## איפה משנים מה

| רוצים לשנות | עורכים | אחר כך |
|---|---|---|
| ניסוח של כל טקסט במשחק | `strings.js` בשורש | `sync-web.py` ובנייה מחדש |
| עקיצות | `STR.quips` בתוך `strings.js` | כנ"ל |
| מילים ורמות | `words.json`, `levels.json` | כנ"ל |
| שם האפליקציה מתחת לאייקון, הודעת היציאה | `android/app/src/main/res/values/strings.xml` | בנייה מחדש |
| קישור לשיתוף (כדי שמי שאין לו האפליקציה יצטרף מהדפדפן) | `WEB_URL` ב-`app-config.js` | `sync-web.py` |
| מספר גרסה | `versionCode`, `versionName` ב-`app/build.gradle.kts` | בנייה מחדש |

**מזהה החבילה:** כרגע `com.dabid.alias`. לפני פרסום מחליפים לשלכם (אי אפשר לשנות אחרי הפרסום). הדרך הקלה: ב-Android Studio, בחלון Project לוחצים ימני על החבילה `com.dabid.alias` ← **Refactor ← Rename**, ואחר כך מעדכנים את `namespace` ואת `applicationId` ב-`app/build.gradle.kts`.

## איך זה עובד (בקצרה)

- `MainActivity.kt` פותחת WebView וטוענת את `assets/www/index.html` דרך `WebViewAssetLoader`, בכתובת `https://appassets.androidplatform.net/assets/www/`. כך ה-ES modules וה-`fetch` עובדים כמו באתר.
- ספריית Firebase נטענת מ-`gstatic.com` כמו באתר, ולכן צריך אינטרנט כדי לשחק בחדר משותף.
- `NativeBridge.kt` מוסיף לדף את `window.AliasNative`: חלון שיתוף של אנדרואיד, העתקה ללוח, מסך דלוק בזמן תור. `app.js` משתמש בו רק אם הוא קיים, ולכן באתר שום דבר לא משתנה.
- כפתור "חזרה": סוגר חלון פתוח, חוזר למסך הבית, או שואל אם לעזוב חדר. במסך הבית צריך ללחוץ פעמיים כדי לצאת.
- באפליקציה מזהה השחקן והחדר האחרון נשמרים ב-`localStorage`, כך שסגירה ופתיחה של האפליקציה באמצע משחק מחזירה לאותו חדר.

## אם משהו לא עובד

| תסמין | סיבה ופתרון |
|---|---|
| מסך הבית מציג "מצב מקומי" | `firebase-config.js` עדיין עם `YOUR_...`, או ששכחתם להריץ `sync-web.py` אחרי המילוי. |
| "Firebase חוסם את החדר" | הכללים לא פורסמו (Rules ← Publish), או ש-`databaseURL` שגוי. |
| "לא הצלחנו להתחבר" | אין אינטרנט במכשיר, או `databaseURL` לא תואם לאזור של המסד. |
| מסך ריק | פותחים בכרום במחשב `chrome://inspect`, בוחרים את המכשיר ובודקים את ה-Console (WebView ניתן לבדיקה בגרסת debug). |
| שגיאת Gradle בסנכרון | שולחים לי את ההודעה המלאה. הפרויקט נכתב בלי אפשרות להריץ Android Studio בסביבה שבה הוכן, אז ייתכן שנדרש תיקון קטן בגרסאות. |
