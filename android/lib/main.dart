import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'security/tamper_check.dart';
import 'services/vpn_service.dart';
import 'screens/browser_screen.dart';
import 'screens/login_screen.dart';
import 'screens/vpn_guard_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ─── Prevent screenshots and screen recording ──────────────────────────────
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  // FLAG_SECURE — prevents screenshots and screen recording on Android
  await const MethodChannel('com.remoteshieldx/security').invokeMethod('setFlagSecure');

  // ─── Force portrait mode ───────────────────────────────────────────────────
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // ─── Tamper / Root Detection ───────────────────────────────────────────────
  final tamperResult = await TamperCheck.runAllChecks();
  if (tamperResult.isCompromised) {
    runApp(TamperDetectedApp(reason: tamperResult.reason));
    return;
  }

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => VpnService()),
      ],
      child: const RemoteShieldApp(),
    ),
  );
}

class RemoteShieldApp extends StatelessWidget {
  const RemoteShieldApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RemoteShield X',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: const ColorScheme.dark(
          primary:   Color(0xFF6366F1),
          secondary: Color(0xFF818CF8),
          surface:   Color(0xFF111827),
          error:     Color(0xFFEF4444),
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0A0D14),
        fontFamily: 'Inter',
      ),
      home: const AppRouter(),
    );
  }
}

class AppRouter extends StatefulWidget {
  const AppRouter({super.key});
  @override
  State<AppRouter> createState() => _AppRouterState();
}

class _AppRouterState extends State<AppRouter> {
  bool _authenticated = false;
  String? _authToken;

  @override
  Widget build(BuildContext context) {
    final vpn = context.watch<VpnService>();

    // VPN must be connected before anything else
    if (!vpn.isConnected) {
      return VpnGuardScreen(onRetry: () => vpn.connect());
    }

    // Authentication gate
    if (!_authenticated || _authToken == null) {
      return LoginScreen(
        onLogin: (token) => setState(() {
          _authenticated = true;
          _authToken = token;
        }),
      );
    }

    return BrowserScreen(authToken: _authToken!);
  }
}

// ─── Tamper Detected Fallback ──────────────────────────────────────────────────
class TamperDetectedApp extends StatelessWidget {
  final String reason;
  const TamperDetectedApp({super.key, required this.reason});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: const Color(0xFF0A0D14),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('🚨', style: TextStyle(fontSize: 72)),
                const SizedBox(height: 24),
                const Text(
                  'Security Violation Detected',
                  style: TextStyle(color: Color(0xFFEF4444), fontSize: 22, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  reason,
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                const Text(
                  'This incident has been logged and reported.\nContact your administrator.',
                  style: TextStyle(color: Color(0xFF64748B), fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
