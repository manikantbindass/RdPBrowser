import 'dart:async';

import 'package:flutter/material.dart';

import 'screens/browser_screen.dart';
import 'screens/login_screen.dart';
import 'screens/vpn_guard_screen.dart';
import 'services/control_plane.dart';
import 'services/session.dart';
import 'services/vpn_service.dart';

void main() => runApp(const RemoteShieldApp());

class RemoteShieldApp extends StatefulWidget {
  const RemoteShieldApp({super.key, this.session});
  final Session? session;

  @override
  State<RemoteShieldApp> createState() => _RemoteShieldAppState();
}

class _RemoteShieldAppState extends State<RemoteShieldApp>
    with WidgetsBindingObserver {
  late final Session _session =
      widget.session ?? Session(ControlPlane(), PlatformSecurity());
  Timer? _poll;
  StreamSubscription<void>? _network;
  final _navigator = GlobalKey<NavigatorState>();
  bool? _secure;
  int? _browserEpoch;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _session.addListener(_changed);
    _changed();
    _network = _session.platform.networkChanges.listen(
      (_) {
        if (_session.foreground) unawaited(_session.check(invalidate: true));
      },
      onError: (Object _) {
        if (_session.foreground) unawaited(_session.check(invalidate: true));
      },
    );
    _poll = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_session.foreground) unawaited(_session.check());
    });
    unawaited(_session.check());
  }

  void _changed() {
    if (_browserEpoch != _session.browserEpoch || !_session.foreground) {
      _browserEpoch = _session.browserEpoch;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _navigator.currentState?.popUntil((route) => route.isFirst);
        }
      });
    }
    final secure =
        !_session.ready ||
        !_session.foreground ||
        !_session.networkReady ||
        !_session.signedIn ||
        _session.authorized;
    if (_secure == secure) return;
    _secure = secure;
    unawaited(
      _session.platform.protectScreen(secure).catchError((Object _) {}),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _session.resume();
    } else {
      _session.suspend();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    unawaited(_network?.cancel());
    _session.removeListener(_changed);
    if (widget.session == null) _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigator,
      title: 'RemoteShield X',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00687B),
          brightness: Brightness.light,
        ),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF64DCF1),
          brightness: Brightness.dark,
        ),
      ),
      home: ListenableBuilder(
        listenable: _session,
        builder: (context, _) {
          if (!_session.ready || !_session.foreground) {
            return const Scaffold(
              body: Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Checking session',
                ),
              ),
            );
          }
          if (!_session.networkReady) return VpnGuardScreen(session: _session);
          if (!_session.signedIn) return LoginScreen(session: _session);
          return BrowserScreen(
            key: ValueKey('${_session.owner}.${_session.browserEpoch}'),
            session: _session,
          );
        },
      ),
    );
  }
}
