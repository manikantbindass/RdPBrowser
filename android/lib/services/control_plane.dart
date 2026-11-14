import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';

class ApiFailure implements Exception {
  const ApiFailure(this.status, this.message);
  final int status;
  final String message;

  @override
  String toString() => message;
}

class ControlPlane {
  ControlPlane({http.Client? client, Uri? origin})
    : _client = client ?? http.Client(),
      _origin = origin;
  final http.Client _client;
  final Uri? _origin;
  static const timeout = Duration(seconds: 8);

  Future<Map<String, dynamic>> request(
    String path, {
    String? token,
    Map<String, Object?>? body,
  }) async {
    final request =
        http.Request(
            body == null ? 'GET' : 'POST',
            (_origin ?? controlPlaneUri('/')).resolve('/api/v1$path'),
          )
          ..followRedirects = false
          ..headers['Accept'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    return _send(request).timeout(timeout);
  }

  Future<Map<String, dynamic>> _send(http.Request request) async {
    final response = await _client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await response.stream.listen(null).cancel();
      throw ApiFailure(response.statusCode, switch (response.statusCode) {
        401 => 'Your credentials or session were rejected.',
        403 => 'Organization access policy denied this request.',
        429 => 'Too many requests. Wait and retry.',
        _ => 'The control plane is unavailable.',
      });
    }
    final bytes = <int>[];
    await for (final chunk in response.stream) {
      if (bytes.length + chunk.length > 128 * 1024) {
        throw const FormatException('Control-plane response is too large.');
      }
      bytes.addAll(chunk);
    }
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Invalid control-plane response.');
    }
    return decoded;
  }

  void close() => _client.close();
}

bool permitsNavigation(Map<String, dynamic> result, String address) =>
    permitsBatch(result, [address]);

bool permitsBatch(Map<String, dynamic> result, List<String> addresses) {
  final access = result['access'];
  final decisions = result['decisions'];
  if (access is! Map ||
      access['allowed'] != true ||
      decisions is! List ||
      decisions.length != addresses.length) {
    return false;
  }
  for (var index = 0; index < addresses.length; index++) {
    final decision = decisions[index];
    if (decision is! Map ||
        decision['allowed'] != true ||
        decision['url'] != addresses[index]) {
      return false;
    }
  }
  return true;
}
