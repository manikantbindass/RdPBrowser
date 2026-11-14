package com.remoteshieldx.browser

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class MainActivity : FlutterActivity() {
    private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var events: EventChannel.EventSink? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        WebView.setWebContentsDebuggingEnabled(false)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, "com.remoteshieldx/security").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "vpnState" -> result.success(vpnState())
                    "openVpnSettings" -> {
                        startActivity(Intent(Settings.ACTION_VPN_SETTINGS))
                        result.success(null)
                    }
                    "protectScreen" -> {
                        val flag = WindowManager.LayoutParams.FLAG_SECURE
                        if (call.arguments == true) window.addFlags(flag) else window.clearFlags(flag)
                        result.success(null)
                    }
                    "clearWebData" -> {
                        WebStorage.getInstance().deleteAllData()
                        WebView(this).apply {
                            clearCache(true)
                            clearFormData()
                            destroy()
                        }
                        val cookies = CookieManager.getInstance()
                        cookies.removeAllCookies {
                            cookies.flush()
                            result.success(null)
                        }
                    }
                    "risks" -> result.success(risks())
                    "deviceKey" -> result.success(deviceKey(checkedAlias(call.arguments as? String)))
                    "sign" -> {
                        val alias = checkedAlias(call.argument<String>("alias"))
                        val message = call.argument<String>("message") ?: error("Missing challenge")
                        require(message.length <= 512 && message.startsWith("RemoteShieldX.device.v1:"))
                        val signature = Signature.getInstance("SHA256withECDSA")
                        val key = keyStore().getKey(alias, null) as? java.security.PrivateKey
                            ?: error("Key unavailable")
                        signature.initSign(key)
                        signature.update(message.toByteArray(Charsets.UTF_8))
                        result.success(encode(signature.sign()))
                    }
                    else -> result.notImplemented()
                }
            } catch (_: Exception) {
                result.error("NATIVE_UNAVAILABLE", "Android operation unavailable", null)
            }
        }
        EventChannel(messenger, "com.remoteshieldx/network").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
                stopObservation()
                events = sink
                val observer = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) = publish()
                    override fun onLost(network: Network) = publish()
                    override fun onLinkPropertiesChanged(network: Network, properties: android.net.LinkProperties) = publish()
                    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = publish()
                    private fun publish() = runOnUiThread { events?.success(null) }
                }
                try {
                    connectivity.registerDefaultNetworkCallback(observer)
                    callback = observer
                } catch (_: RuntimeException) {
                    sink.error("NETWORK_UNAVAILABLE", "Android network observation unavailable", null)
                }
            }

            override fun onCancel(arguments: Any?) = stopObservation()
        })
    }

    private fun stopObservation() {
        callback?.let { connectivity.unregisterNetworkCallback(it) }
        callback = null
        events = null
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        stopObservation()
        super.cleanUpFlutterEngine(flutterEngine)
    }

    private fun vpnState(): String {
        val network = connectivity.activeNetwork ?: return "disconnected"
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return "unavailable"
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "disconnected"
        val link = connectivity.getLinkProperties(network) ?: return "unavailable"
        val hasIpv4 = link.routes.any { it.isDefaultRoute && it.destination.address is java.net.Inet4Address }
        val hasIpv6 = link.routes.any { it.isDefaultRoute && it.destination.address is java.net.Inet6Address }
        return if (hasIpv4 && hasIpv6 && link.dnsServers.isNotEmpty()) "fullRouteCandidate" else "incomplete"
    }

    private fun risks(): List<String> = buildList {
        if (Build.TAGS?.contains("test-keys") == true ||
            listOf("/system/bin/su", "/system/xbin/su", "/sbin/su").any { File(it).exists() }) {
            add("Possible root or test build")
        }
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) add("Debugger present")
        if (Settings.Global.getInt(contentResolver, Settings.Global.ADB_ENABLED, 0) == 1) add("ADB enabled")
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) add("Debug build")
    }

    private fun checkedAlias(value: String?): String {
        require(value != null && value.matches(Regex("""rsx\.[a-fA-F0-9-]{36}\.[a-fA-F0-9-]{36}""")))
        return value
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun deviceKey(alias: String): Map<String, String> {
        val store = keyStore()
        if (!store.containsAlias(alias)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build())
                generateKeyPair()
            }
        }
        val key = store.getCertificate(alias).publicKey as ECPublicKey
        fun coordinate(bytes: ByteArray): String {
            val unsigned = if (bytes.size == 33 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, 33) else bytes
            require(unsigned.size <= 32)
            val fixed = ByteArray(32)
            unsigned.copyInto(fixed, 32 - unsigned.size)
            return encode(fixed)
        }
        return mapOf("kty" to "EC", "crv" to "P-256",
            "x" to coordinate(key.w.affineX.toByteArray()), "y" to coordinate(key.w.affineY.toByteArray()))
    }

    private fun encode(bytes: ByteArray) =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
