// Public control-plane configuration. Flutter remains independent of npm/Rust.
const serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'http://127.0.0.1:3001');
Uri controlPlaneUri(String path) {
  final base = Uri.parse(serverUrl);
  if (!['http', 'https'].contains(base.scheme) || base.host.isEmpty || base.userInfo.isNotEmpty || (base.path.isNotEmpty && base.path != '/') || base.hasQuery || base.hasFragment) {
    throw const FormatException('SERVER_URL must be an HTTP(S) origin without credentials or a path');
  }
  return base.resolve(path);
}
