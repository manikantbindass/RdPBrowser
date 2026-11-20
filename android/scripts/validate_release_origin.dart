void main(List<String> arguments) {
  final uri = arguments.length == 1 ? Uri.tryParse(arguments.single) : null;
  if (uri == null ||
      !uri.isScheme('https') ||
      uri.host.isEmpty ||
      uri.authority.contains('@') ||
      (uri.path.isNotEmpty && uri.path != '/') ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const FormatException('Set ANDROID_SERVER_URL to an HTTPS origin.');
  }
}
