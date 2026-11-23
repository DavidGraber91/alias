plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    // ה-namespace וה-applicationId חייבים להיות זהים לחבילה של MainActivity.kt.
    // לפני פרסום בגוגל פליי מחליפים ל-ID שלכם (למשל com.yourname.alias), ראו README-android.md.
    namespace = "com.dabid.alias"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dabid.alias"
        minSdk = 24
        targetSdk = 35
        versionCode = 1          // מעלים ב-1 בכל גרסה חדשה שמעלים לחנות
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // WebViewAssetLoader: מגיש את קבצי המשחק מתוך האפליקציה בכתובת https אמיתית (נדרש ל-ES modules ול-fetch)
    implementation("androidx.webkit:webkit:1.12.1")
}
