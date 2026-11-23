package com.dabid.alias

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.view.WindowManager
import android.webkit.JavascriptInterface

/**
 * הגשר בין המשחק (JavaScript) לאנדרואיד. מוצג לדף בשם `window.AliasNative`.
 * הקוד של המשחק (app.js) בודק אם הוא קיים: באתר הוא לא, ולכן שם נשארת ההתנהגות הרגילה של הדפדפן.
 *
 * שיטות עם @JavascriptInterface רצות על thread של הגשר, לא של ה-UI, ולכן כל נגיעה במסך עוברת דרך runOnUiThread.
 */
class NativeBridge(private val activity: Activity) {

    /** חלון השיתוף של אנדרואיד. url יכול להיות ריק. */
    @JavascriptInterface
    fun share(text: String?, url: String?) {
        val body = listOfNotNull(text, url)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")
        if (body.isEmpty()) return
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, body)
        }
        activity.runOnUiThread {
            activity.startActivity(Intent.createChooser(send, activity.getString(R.string.share_chooser_title)))
        }
    }

    /** מעתיק ללוח של המערכת. מחזיר true אם הצליח. */
    @JavascriptInterface
    fun copy(text: String?): Boolean {
        return try {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("alias", text ?: ""))
            true
        } catch (e: Exception) {
            false
        }
    }

    /** משאיר את המסך דלוק בזמן תור (במקום navigator.wakeLock, שאינו אמין ב-WebView). */
    @JavascriptInterface
    fun keepScreenOn(on: Boolean) {
        activity.runOnUiThread {
            if (on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }
}
