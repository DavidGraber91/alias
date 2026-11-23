package com.dabid.alias

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader

/**
 * מסך אחד: WebView שמריץ את אותו משחק שרץ באתר (הקבצים נמצאים ב-assets/www).
 * המסד המשותף הוא Firebase Realtime Database, שמוגדר ב-firebase-config.js (לא כאן).
 */
class MainActivity : AppCompatActivity() {

    private var webView: WebView? = null
    private var lastBackPress = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val view: WebView? = try {
            WebView(this)
        } catch (e: Exception) {
            null
        }
        if (view == null) {
            Toast.makeText(this, R.string.webview_unavailable, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        webView = view

        // מסך מלא מאחורי שורת המצב; ה-padding למטה מרחיק את התוכן מהסרגלים ומהמקלדת
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val background = ContextCompat.getColor(this, R.color.alias_background)
        val root = FrameLayout(this)
        root.setBackgroundColor(background)
        view.setBackgroundColor(background)
        root.addView(
            view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val controller = WindowCompat.getInsetsController(window, root)
        controller.isAppearanceLightStatusBars = false // אייקונים בהירים על רקע כהה
        controller.isAppearanceLightNavigationBars = false

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect, רק בגרסת debug
        }

        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true // localStorage / sessionStorage
        view.settings.mediaPlaybackRequiresUserGesture = false // צפצופי הטיימר
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false

        // מגיש את assets/ בכתובת https://appassets.androidplatform.net/assets/...
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }

            // קישור שיוצא מהמשחק נפתח בדפדפן, לא בתוך האפליקציה
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (e: Exception) {
                    // אין אפליקציה שיודעת לפתוח את הקישור: מתעלמים
                }
                return true
            }
        }

        // חייב להיות לפני loadUrl, כדי ש-window.AliasNative יהיה קיים כש-app.js רץ
        view.addJavascriptInterface(NativeBridge(this), "AliasNative")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleBack()
            }
        })

        view.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/www/index.html")
    }

    /** קודם לדף (חלון פתוח, חזרה למסך הבית, יציאה מחדר). אם הדף לא טיפל, צריך ללחוץ פעמיים כדי לצאת. */
    private fun handleBack() {
        val view = webView
        if (view == null) {
            finish()
            return
        }
        view.evaluateJavascript(
            "(function(){return typeof window.aliasOnBack==='function'?window.aliasOnBack():false;})()"
        ) { result ->
            if (result == "true") return@evaluateJavascript
            val now = SystemClock.elapsedRealtime()
            if (now - lastBackPress < 2000) {
                finish()
            } else {
                lastBackPress = now
                Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        webView = null
        super.onDestroy()
    }
}
