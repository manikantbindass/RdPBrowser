# ─── Flutter ─────────────────────────────────────────────────
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**

# ─── WebView ─────────────────────────────────────────────────
-keep class android.webkit.** { *; }
-keep class io.flutter.plugins.webviewflutter.** { *; }
