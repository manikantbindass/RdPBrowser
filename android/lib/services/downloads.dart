import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';
import '../providers/browser_provider.dart';
import 'session.dart';

const maxDownloadBytes = 5 * 1024 * 1024;

Future<void> saveTextDownload(Session session, String value) async {
  final uri = validAddress(value.trim());
  if (uri == null || !await session.allow(uri.toString())) {
    throw const FormatException('An authorized HTTPS download is required.');
  }
  final epoch = session.browserEpoch;
  final client = http.Client();
  bool current() => session.canBrowse && session.browserEpoch == epoch;
  try {
    final request = http.Request('GET', uri)..followRedirects = false;
    final response = await client
        .send(request)
        .timeout(const Duration(seconds: 12));
    final mediaType = response.headers['content-type']?.split(';').first.trim();
    if (response.statusCode != 200 ||
        mediaType != 'text/plain' ||
        (response.contentLength ?? 0) > maxDownloadBytes) {
      throw const FormatException(
        'Only direct plain-text responses up to 5 MiB are accepted.',
      );
    }
    final bytes = await (() async {
      final bytes = <int>[];
      await for (final chunk in response.stream) {
        if (!current() || bytes.length + chunk.length > maxDownloadBytes) {
          throw const FormatException('Download limit or session changed.');
        }
        bytes.addAll(chunk);
      }
      return bytes;
    })().timeout(const Duration(seconds: 15));
    final text = utf8.decode(bytes);
    if (text.contains(RegExp(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')) ||
        !current() ||
        !await session.allow(uri.toString()) ||
        !current()) {
      throw const FormatException('Download content or session rejected.');
    }
    final directory = await (await _downloadDirectory(
      session,
    )).create(recursive: true);
    final file = File(
      '${directory.path}/remoteshield-${const Uuid().v4()}.txt',
    );
    if (!current()) throw const FormatException('Session changed.');
    await file.create(exclusive: true);
    try {
      await file.writeAsBytes(bytes, flush: true);
      if (!current()) throw const FormatException('Session changed.');
    } on Exception {
      await file.delete();
      rethrow;
    }
  } finally {
    client.close();
  }
}

Future<Directory> _downloadDirectory(Session session) async {
  final owner = session.owner;
  if (owner == null) throw const FormatException('Sign in first.');
  final root = await getApplicationSupportDirectory();
  final scope = base64Url.encode(
    utf8.encode('${controlPlaneUri('/').origin}/$owner'),
  );
  return Directory('${root.path}/downloads/$scope');
}

Future<List<File>> savedDownloads(Session session) async {
  final directory = await _downloadDirectory(session);
  if (!await directory.exists()) return [];
  final files = await directory
      .list(followLinks: false)
      .where(
        (entry) =>
            entry is File &&
            entry.uri.pathSegments.last.startsWith('remoteshield-') &&
            entry.path.endsWith('.txt'),
      )
      .cast<File>()
      .toList();
  return files.reversed.toList();
}
