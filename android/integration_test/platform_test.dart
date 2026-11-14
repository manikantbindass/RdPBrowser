import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:remoteshield_x/main.dart';
import 'package:remoteshield_x/services/vpn_service.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Android native channels and managed VPN guard', (tester) async {
    final platform = PlatformSecurity();
    await platform.protectScreen(true);
    final signals = await platform.risks();
    expect(signals, isA<List<String>>());
    expect(await platform.vpnState(), isNot(VpnState.unavailable));
    const alias =
        'rsx.00000000-0000-4000-8000-000000000001.00000000-0000-4000-8000-000000000002';
    final key = await platform.deviceKey(alias);
    expect(key['kty'], 'EC');
    expect(key['crv'], 'P-256');
    expect(base64Url.decode(base64Url.normalize(key['x']!)).length, 32);
    final signature = await platform.sign(
      alias,
      'RemoteShieldX.device.v1:00000000-0000-4000-8000-000000000001:fixture:session',
    );
    expect(base64Url.decode(base64Url.normalize(signature)).first, 0x30);
    await platform.clearWebData();
    await tester.pumpWidget(const RemoteShieldApp());
    await tester.pumpAndSettle();
    expect(find.text('Open Android VPN settings'), findsOneWidget);
  });
}
