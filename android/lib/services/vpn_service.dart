import 'package:flutter/services.dart';

enum VpnState { unavailable, disconnected, incomplete, fullRouteCandidate }

class PlatformSecurity {
  static const _channel = MethodChannel('com.remoteshieldx/security');
  static const _events = EventChannel('com.remoteshieldx/network');

  Stream<void> get networkChanges =>
      _events.receiveBroadcastStream().map((_) {});

  Future<VpnState> vpnState() async {
    try {
      final result = await _channel.invokeMethod<String>('vpnState');
      return VpnState.values.byName(result ?? 'unavailable');
    } on Exception {
      return VpnState.unavailable;
    }
  }

  Future<void> openVpnSettings() =>
      _channel.invokeMethod<void>('openVpnSettings');

  Future<List<String>> risks() async {
    try {
      return await _channel.invokeListMethod<String>('risks') ??
          const ['Local signals unavailable'];
    } on Exception {
      return const ['Local signals unavailable'];
    }
  }

  Future<void> clearWebData() => _channel.invokeMethod<void>('clearWebData');

  Future<void> protectScreen(bool enabled) =>
      _channel.invokeMethod<void>('protectScreen', enabled);

  Future<Map<String, String>> deviceKey(String alias) async {
    final key = await _channel.invokeMapMethod<String, String>(
      'deviceKey',
      alias,
    );
    if (key == null) throw const FormatException('Device key unavailable.');
    return key;
  }

  Future<String> sign(String alias, String message) async {
    final signature = await _channel.invokeMethod<String>('sign', {
      'alias': alias,
      'message': message,
    });
    if (signature == null) {
      throw const FormatException('Signature unavailable.');
    }
    return signature;
  }
}
