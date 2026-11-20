import 'package:flutter/foundation.dart';

const serverUrl = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: kDebugMode ? 'http://10.0.2.2:3001' : '',
);
const requireVpn =
    !kDebugMode || bool.fromEnvironment('REQUIRE_VPN', defaultValue: true);

Uri controlPlaneUri(String path) => parseOrigin(serverUrl).resolve(path);

Uri parseOrigin(String raw, {bool allowLocalHttp = kDebugMode}) {
  final uri = Uri.tryParse(raw);
  final local =
      uri != null &&
      const {'10.0.2.2', '127.0.0.1', 'localhost', '::1'}.contains(uri.host);
  if (uri == null ||
      (uri.scheme != 'https' &&
          !(allowLocalHttp && local && uri.scheme == 'http')) ||
      uri.host.isEmpty ||
      uri.authority.contains('@') ||
      (uri.path.isNotEmpty && uri.path != '/') ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const FormatException('Configure SERVER_URL as an HTTPS origin.');
  }
  return uri;
}
