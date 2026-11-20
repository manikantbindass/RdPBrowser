import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:remoteshield_x/providers/browser_provider.dart';
import 'package:remoteshield_x/config.dart';
import 'package:remoteshield_x/main.dart';
import 'package:remoteshield_x/screens/browser_tools.dart';
import 'package:remoteshield_x/services/control_plane.dart';
import 'package:remoteshield_x/services/session.dart';
import 'package:remoteshield_x/services/vpn_service.dart';

class TestPlatform extends PlatformSecurity {
  VpnState state = VpnState.fullRouteCandidate;
  @override
  Future<VpnState> vpnState() async => state;

  @override
  Future<void> clearWebData() async {}

  @override
  Future<void> protectScreen(bool enabled) async {}

  @override
  Stream<void> get networkChanges => const Stream.empty();
}

http.Response response(Object value, [int code = 200]) =>
    http.Response(jsonEncode(value), code);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const tokens = {'accessToken': 'access', 'refreshToken': 'refresh'};
  const user = {'id': 'user', 'organizationId': 'org'};
  final origin = Uri.parse('https://control.example');

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test(
    'session gates browsing on local VPN, server policy, and foreground',
    () async {
      var calls = 0;
      final platform = TestPlatform();
      final session = Session(
        ControlPlane(
          origin: origin,
          client: MockClient((request) async {
            calls++;
            expect(request.followRedirects, isFalse);
            if (request.url.path.endsWith('/login')) return response(tokens);
            return response({
              'user': user,
              'access': {'allowed': true},
              'sourceGate': 'accepted',
            });
          }),
        ),
        platform,
        vpnRequired: true,
      );
      addTearDown(session.dispose);
      await session.signIn('user', ' password ', '');
      expect(session.canBrowse, isTrue);
      session.suspend();
      expect(session.canBrowse, isFalse);
      session.foreground = true;
      platform.state = VpnState.disconnected;
      await session.check(invalidate: true);
      expect(session.canBrowse, isFalse);
      expect(calls, 2);
    },
  );

  test(
    'policy refresh closes browsing when an open address is denied',
    () async {
      final session = Session(
        ControlPlane(
          origin: origin,
          client: MockClient((request) async {
            if (request.url.path.endsWith('/login')) return response(tokens);
            return response({
              'user': user,
              'access': {'allowed': true},
              'sourceGate': 'accepted',
              'decisions': request.method == 'POST'
                  ? [
                      {'url': 'https://allowed.example/', 'allowed': false},
                    ]
                  : [],
            });
          }),
        ),
        TestPlatform(),
        vpnRequired: true,
      );
      addTearDown(session.dispose);
      await session.signIn('user', 'pass', '');
      expect(session.canBrowse, isTrue);
      session.openAddresses = () => {'https://allowed.example/'};
      await session.check();
      expect(session.canBrowse, isFalse);
      expect(session.browserEpoch, 1);
    },
  );

  test(
    'a stored refresh rotates once and a revoked session stays closed',
    () async {
      var refreshes = 0;
      var revoked = false;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/login')) return response(tokens);
        if (request.url.path.endsWith('/refresh')) {
          refreshes++;
          if (revoked) return response({}, 401);
          return response({
            'accessToken': 'rotated',
            'refreshToken': 'rotated-refresh',
          });
        }
        return revoked
            ? response({}, 401)
            : response({
                'user': user,
                'access': {'allowed': true},
                'sourceGate': 'accepted',
              });
      });
      final original = Session(
        ControlPlane(origin: origin, client: client),
        TestPlatform(),
        vpnRequired: true,
      );
      await original.signIn('user', 'pass', '');
      original.dispose();
      final restored = Session(
        ControlPlane(origin: origin, client: client),
        TestPlatform(),
        vpnRequired: true,
      );
      addTearDown(restored.dispose);
      await Future.wait([restored.check(), restored.check()]);
      expect(restored.canBrowse, isTrue);
      expect(refreshes, 1);
      revoked = true;
      await restored.check();
      expect(restored.signedIn, isFalse);
      expect(restored.canBrowse, isFalse);
      expect(refreshes, 2);
      await restored.check();
      expect(refreshes, 2);
    },
  );

  test('preference writes retain their original account scope', () async {
    SharedPreferences.setMockInitialValues({});
    final session = Session(ControlPlane(origin: origin), TestPlatform());
    addTearDown(session.dispose);
    session.owner = 'org.userA';
    final browser = BrowserProvider(session);
    addTearDown(browser.dispose);
    final saved = browser.setSearchEngine('Bing');
    session.owner = 'org.userB';
    await saved;
    final preferences = await SharedPreferences.getInstance();
    final prefix = 'browser.v1.${controlPlaneUri('/').origin}';
    expect(preferences.getString('$prefix.org.userA.searchEngine'), 'Bing');
    expect(preferences.getString('$prefix.org.userB.searchEngine'), isNull);
  });

  testWidgets('a missing VPN shows Android settings and no bypass', (
    tester,
  ) async {
    final platform = TestPlatform()..state = VpnState.disconnected;
    final session = Session(
      ControlPlane(
        origin: origin,
        client: MockClient((_) async {
          fail('The VPN guard must not contact the API');
        }),
      ),
      platform,
      vpnRequired: true,
    );
    addTearDown(session.dispose);
    await tester.pumpWidget(RemoteShieldApp(session: session));
    await tester.pumpAndSettle();
    expect(find.text('Open Android VPN settings'), findsOneWidget);
    expect(find.text('Sign in'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('a populated bookmarks dialog scrolls on a small screen', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 420));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final session = Session(ControlPlane(origin: origin), TestPlatform());
    addTearDown(session.dispose);
    final browser = BrowserProvider(session)
      ..bookmarks = List.generate(20, (i) => 'https://example.test/$i');
    addTearDown(browser.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<String>(
                context: context,
                builder: (_) =>
                    SavedAddresses(browser: browser, bookmarks: true),
              ),
              child: const Text('Open bookmarks'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open bookmarks'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('https://example.test/19'), 120);
    expect(find.text('https://example.test/19'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
