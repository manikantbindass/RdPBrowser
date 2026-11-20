import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';
import 'control_plane.dart';
import 'vpn_service.dart';

class Session extends ChangeNotifier {
  Session(
    this.api,
    this.platform, {
    FlutterSecureStorage? storage,
    bool vpnRequired = requireVpn,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _vpnRequired = vpnRequired;

  final ControlPlane api;
  final PlatformSecurity platform;
  final FlutterSecureStorage _storage;
  final bool _vpnRequired;
  String? _access;
  String? _refresh;
  String? owner;
  Map? device;
  bool networkReady = false;
  bool authorized = false;
  bool ready = false;
  bool busy = false;
  bool foreground = true;
  String message = '';
  int browserEpoch = 0;
  Future<void>? _operation;
  Set<String> Function()? openAddresses;
  int _networkRevision = 0;
  bool _disposed = false;
  bool _signingOut = false;
  bool _storageBlocked = false;

  bool get signedIn => _access != null;
  bool get canBrowse =>
      !_signingOut && signedIn && authorized && networkReady && foreground;
  String get _originKey => 'session.v1.${controlPlaneUri('/').origin}';

  void _publish() {
    if (!_disposed) notifyListeners();
  }

  void _denyBrowser() {
    if (authorized) browserEpoch++;
    authorized = false;
  }

  void suspend() {
    foreground = false;
    _denyBrowser();
    _publish();
  }

  void resume() {
    foreground = true;
    unawaited(check());
  }

  Future<void> _serialize(Future<void> Function() action) async {
    final pending = _operation;
    if (pending != null) {
      await pending;
      return;
    }
    final task = Future<void>.microtask(action);
    _operation = task;
    try {
      await task;
    } finally {
      _operation = null;
      busy = false;
      ready = true;
      _publish();
    }
  }

  Future<bool> _checkNetwork() async {
    networkReady =
        !_vpnRequired ||
        await platform.vpnState() == VpnState.fullRouteCandidate;
    if (!networkReady) {
      _denyBrowser();
      message = 'Managed VPN unavailable. Check Android VPN settings.';
    }
    _publish();
    return networkReady;
  }

  Future<void> check({bool invalidate = false}) {
    if (invalidate) {
      _networkRevision++;
      networkReady = false;
      _denyBrowser();
      _publish();
    }
    final revision = _networkRevision;
    final pending = _operation;
    if (invalidate && pending != null) {
      return pending.whenComplete(() {
        if (revision == _networkRevision && foreground) return check();
      });
    }
    return _serialize(() async {
      try {
        if (_signingOut || !foreground || !await _checkNetwork()) return;
        if (_access == null) {
          if (_storageBlocked) return;
          final previous = await _storage.read(key: _originKey);
          if (previous == null) {
            message = '';
            return;
          }
          final value = jsonDecode(previous);
          if (value is! Map<String, dynamic> ||
              value['token'] is! String ||
              (value['token'] as String).isEmpty ||
              (value['token'] as String).length > 4096) {
            await _clear();
            throw const FormatException('Stored session is invalid.');
          }
          _refresh = value['token'] as String;
          await _rotate();
        }
        await _status();
      } on ApiFailure catch (error) {
        _denyBrowser();
        if (error.status == 401 || error.status == 403) await _clear();
        message = error.message;
      } on Exception {
        _denyBrowser();
        message = 'Session verification is unavailable. Retry when connected.';
      }
    });
  }

  Future<void> signIn(String username, String password, String organization) =>
      _serialize(() async {
        busy = true;
        _publish();
        try {
          if (!await _checkNetwork()) return;
          final data = await api.request(
            '/auth/login',
            body: {
              'username': username,
              'password': password,
              if (organization.isNotEmpty) 'organizationId': organization,
              'deviceOs': 'android',
            },
          );
          await platform.clearWebData();
          await _accept(data);
          await _status();
        } on ApiFailure catch (error) {
          message = error.message;
        } on Exception {
          _denyBrowser();
          message = 'Sign-in failed. Check the server and secure storage.';
        }
      });

  Future<void> _accept(Map<String, dynamic> value) async {
    final access = value['accessToken'];
    final refresh = value['refreshToken'];
    if (access is! String ||
        access.isEmpty ||
        access.length > 8192 ||
        refresh is! String ||
        refresh.isEmpty ||
        refresh.length > 4096) {
      throw const FormatException('Invalid credentials response.');
    }
    await _storage.write(
      key: _originKey,
      value: jsonEncode({'token': refresh}),
    );
    _storageBlocked = false;
    _refresh = refresh;
    _access = access;
  }

  Future<void> _rotate() async {
    final refresh = _refresh;
    if (refresh == null) throw const ApiFailure(401, 'Sign in again.');
    // Consume the stored value before sending it. A lost response must never
    // replay a possibly used refresh credential.
    await _storage.delete(key: _originKey);
    _access = null;
    _refresh = null;
    _denyBrowser();
    _publish();
    await _accept(
      await api.request('/auth/refresh', body: {'refreshToken': refresh}),
    );
  }

  Future<void> _status() async {
    final revision = _networkRevision;
    final urls = openAddresses?.call().toList() ?? <String>[];
    final body = urls.isEmpty ? null : <String, Object?>{'urls': urls};
    Map<String, dynamic> result;
    try {
      result = await request('/auth/status', body: body);
    } on ApiFailure catch (error) {
      if (error.status != 401) rethrow;
      await _rotate();
      result = await request('/auth/status', body: body);
    }
    final identity = result['user'];
    final access = result['access'];
    if (identity is! Map ||
        identity['id'] is! String ||
        identity['organizationId'] is! String ||
        access is! Map) {
      throw const FormatException('Invalid session status.');
    }
    owner = "${identity['organizationId']}.${identity['id']}";
    device = result['device'] is Map ? result['device'] as Map : null;
    if (!_signingOut &&
        access['allowed'] == true &&
        (urls.isEmpty || permitsBatch(result, urls)) &&
        revision == _networkRevision &&
        (!_vpnRequired || result['sourceGate'] == 'accepted') &&
        foreground &&
        await _checkNetwork() &&
        revision == _networkRevision &&
        foreground &&
        !_signingOut) {
      authorized = true;
      message = '';
    } else {
      _denyBrowser();
      message =
          'Browsing access is unavailable. Check VPN and device approval.';
    }
  }

  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, Object?>? body,
  }) {
    final token = _access;
    if (token == null || !networkReady || !foreground) {
      throw const ApiFailure(401, 'A connected session is required.');
    }
    return api.request(path, token: token, body: body);
  }

  Future<bool> allow(String address) async {
    if (!canBrowse || !await _checkNetwork()) return false;
    final token = _access;
    final epoch = browserEpoch;
    try {
      final result = await request(
        '/auth/status',
        body: {
          'urls': [address],
        },
      );
      return canBrowse &&
          epoch == browserEpoch &&
          _access == token &&
          (!_vpnRequired || result['sourceGate'] == 'accepted') &&
          permitsNavigation(result, address) &&
          await _checkNetwork() &&
          canBrowse &&
          epoch == browserEpoch &&
          _access == token;
    } on Exception {
      _denyBrowser();
      message = 'URL policy verification failed. Browsing is paused.';
      _publish();
      return false;
    }
  }

  Future<void> enroll() => _serialize(() async {
    busy = true;
    _publish();
    try {
      final currentOwner = owner;
      if (currentOwner == null || !await _checkNetwork()) return;
      final localKey = 'device.v1.${controlPlaneUri('/').origin}.$currentOwner';
      final alias = 'rsx.$currentOwner';
      final publicKey = await platform.deviceKey(alias);
      var id = await _storage.read(key: localKey);
      if (id == null) {
        final response = await request(
          '/devices',
          body: {
            'externalId': const Uuid().v4(),
            'name': 'RemoteShield Android',
            'platform': 'android',
          },
        );
        id = (response['device'] as Map)['id'] as String;
        await request('/devices/$id/key', body: {'publicKey': publicKey});
        await _storage.write(key: localKey, value: id);
      }
      final challenge = await request('/devices/$id/challenge', body: {});
      final signature = await platform.sign(
        alias,
        challenge['message'] as String,
      );
      await request(
        '/devices/$id/proof',
        body: {
          'challengeId': challenge['challengeId'],
          'nonce': challenge['nonce'],
          'signature': signature,
        },
      );
      await _status();
    } on ApiFailure catch (error) {
      message = error.message;
    } on Exception {
      message = 'Device enrollment or key proof failed.';
    }
  });

  Future<void> _clear() async {
    _denyBrowser();
    _access = null;
    _refresh = null;
    owner = null;
    device = null;
    _storageBlocked = true;
    _publish();
    try {
      await _storage.delete(key: _originKey);
      _storageBlocked = false;
    } on Exception {
      message =
          'Could not clear secure storage. Clear app data before sharing this device.';
    }
    try {
      await platform.clearWebData();
    } on Exception {
      // The next sign-in also requires a successful cleanup.
    }
  }

  Future<void> signOut() async {
    if (_signingOut) return;
    _signingOut = true;
    _denyBrowser();
    _publish();
    await _operation;
    await _serialize(() async {
      final token = _access;
      final connected = networkReady && foreground;
      await _clear();
      _publish();
      if (token != null && connected) {
        try {
          await api.request('/auth/logout', token: token, body: {});
        } on Exception {
          if (!_storageBlocked) {
            message =
                'Signed out locally. Server revocation could not be confirmed.';
          }
        }
      }
    });
    _signingOut = false;
  }

  @override
  void dispose() {
    _disposed = true;
    api.close();
    super.dispose();
  }
}
