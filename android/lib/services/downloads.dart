import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';
import '../providers/browser_provider.dart';
import 'session.dart';

const _maxFileBytes = 128 * 1024 * 1024;
const _maxTextBytes = 5 * 1024 * 1024;
const _prefixBytes = 16;
bool _downloading = false;

enum DownloadFormat {
  text('txt'),
  pdf('pdf'),
  png('png'),
  jpeg('jpg'),
  gif('gif'),
  webp('webp'),
  mp4('mp4'),
  webm('webm'),
  mp3('mp3'),
  wav('wav');

  const DownloadFormat(this.extension);
  final String extension;

  int get limit => this == text ? _maxTextBytes : _maxFileBytes;

  static DownloadFormat? fromContentType(String? value) =>
      switch (value?.split(';').first.trim().toLowerCase()) {
        'text/plain' => text,
        'application/pdf' => pdf,
        'image/png' => png,
        'image/jpeg' => jpeg,
        'image/gif' => gif,
        'image/webp' => webp,
        'video/mp4' => mp4,
        'video/webm' => webm,
        'audio/mpeg' => mp3,
        'audio/wav' || 'audio/x-wav' => wav,
        _ => null,
      };

  bool matchesPrefix(List<int> bytes) {
    bool matches(List<int> expected, [int offset = 0]) {
      if (bytes.length < offset + expected.length) return false;
      for (var index = 0; index < expected.length; index++) {
        if (bytes[offset + index] != expected[index]) return false;
      }
      return true;
    }

    bool ascii(String value, [int offset = 0]) =>
        matches(value.codeUnits, offset);
    return switch (this) {
      text => true,
      pdf => ascii('%PDF-'),
      png => matches(const [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
      jpeg => matches(const [0xff, 0xd8, 0xff]),
      gif => ascii('GIF87a') || ascii('GIF89a'),
      webp => ascii('RIFF') && ascii('WEBP', 8),
      mp4 => ascii('ftyp', 4),
      webm => matches(const [0x1a, 0x45, 0xdf, 0xa3]),
      mp3 =>
        ascii('ID3') ||
            (bytes.length >= 2 &&
                bytes[0] == 0xff &&
                (bytes[1] & 0xe0) == 0xe0),
      wav => ascii('RIFF') && ascii('WAVE', 8),
    };
  }
}

class DownloadFailure implements Exception {
  const DownloadFailure(this.message);
  final String message;
}

// Callers publish the file only after the stream and final policy check succeed.
Future<void> writeDownload(
  File pending,
  http.StreamedResponse response,
  DownloadFormat format,
  bool Function() current,
) async {
  final expected = response.contentLength;
  if (expected != null && (expected <= 0 || expected > format.limit)) {
    throw const DownloadFailure(
      'The file is empty or exceeds the download limit.',
    );
  }
  final output = await pending.open(mode: FileMode.writeOnly);
  final prefix = <int>[];
  var total = 0;
  final elapsed = Stopwatch()..start();
  try {
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 15),
    )) {
      total += chunk.length;
      if (!current()) throw const DownloadFailure('Session changed.');
      if (total > format.limit) {
        throw const DownloadFailure('The file exceeds the download limit.');
      }
      if (elapsed.elapsed > const Duration(minutes: 5)) {
        throw const DownloadFailure('Download timed out.');
      }
      if (prefix.length < _prefixBytes) {
        prefix.addAll(chunk.take(_prefixBytes - prefix.length));
        if (prefix.length == _prefixBytes && !format.matchesPrefix(prefix)) {
          throw const DownloadFailure(
            'File content does not match its reported format.',
          );
        }
      }
      await output.writeFrom(chunk);
    }
    if (!current()) throw const DownloadFailure('Session changed.');
    if (total == 0 ||
        (expected != null && expected != total) ||
        !format.matchesPrefix(prefix)) {
      throw const DownloadFailure(
        'File is incomplete or does not match its reported format.',
      );
    }
    await output.flush();
  } finally {
    await output.close();
  }
  if (format == DownloadFormat.text) {
    final text = await pending.readAsString();
    if (text.contains(RegExp(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'))) {
      throw const DownloadFailure('Download is not UTF-8 plain text.');
    }
  }
}

Future<File> saveFileDownload(Session session, String value) async {
  final uri = validAddress(value.trim());
  final owner = session.owner;
  final epoch = session.browserEpoch;
  bool current() =>
      session.canBrowse &&
      session.owner == owner &&
      session.browserEpoch == epoch;
  if (uri == null ||
      owner == null ||
      !current() ||
      !await session.allow(uri.toString()) ||
      !current()) {
    throw const DownloadFailure('An authorized HTTPS download is required.');
  }
  if (_downloading) {
    throw const DownloadFailure('A download is already running.');
  }
  final client = http.Client();
  void onSessionChanged() {
    if (!current()) client.close();
  }

  session.addListener(onSessionChanged);
  _downloading = true;
  File? temporary;
  try {
    final request = http.Request('GET', uri)
      ..followRedirects = false
      ..headers['Accept-Encoding'] = 'identity';
    final response = await client
        .send(request)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw const DownloadFailure(
        'Open a direct HTTPS file link. Redirects and partial responses are not saved.',
      );
    }
    final format = DownloadFormat.fromContentType(
      response.headers['content-type'],
    );
    if (format == null) {
      throw const DownloadFailure(
        'This address did not return a supported image, PDF, media or text file.',
      );
    }
    final directory = await (await _downloadDirectory(
      owner,
    )).create(recursive: true);
    final name = 'remoteshield-${const Uuid().v4()}';
    temporary = await File(
      '${directory.path}/$name.part',
    ).create(exclusive: true);
    await writeDownload(temporary, response, format, current);
    if (!current() || !await session.allow(uri.toString()) || !current()) {
      throw const DownloadFailure('Session or download permission changed.');
    }
    final saved = await temporary.rename(
      '${directory.path}/$name.${format.extension}',
    );
    temporary = null;
    if (!current()) {
      await saved.delete();
      throw const DownloadFailure('Session changed.');
    }
    return saved;
  } finally {
    _downloading = false;
    session.removeListener(onSessionChanged);
    client.close();
    if (temporary != null) {
      try {
        await temporary.delete();
      } on FileSystemException {
        /* Never list unfinished files. */
      }
    }
  }
}

Future<Directory> _downloadDirectory(String owner) async {
  final root = await getApplicationSupportDirectory();
  final scope = base64Url.encode(
    utf8.encode('${controlPlaneUri('/').origin}/$owner'),
  );
  return Directory('${root.path}/downloads/$scope');
}

final _finishedName = RegExp(
  r'^remoteshield-[a-f0-9-]{36}\.(txt|pdf|png|jpg|gif|webp|mp4|webm|mp3|wav)$',
);

Future<List<File>> savedDownloads(Session session) async {
  final owner = session.owner;
  if (owner == null || !session.canBrowse) return [];
  final directory = await _downloadDirectory(owner);
  if (!await directory.exists()) return [];
  final files = await directory
      .list(followLinks: false)
      .where(
        (entry) =>
            entry is File &&
            _finishedName.hasMatch(entry.uri.pathSegments.last),
      )
      .cast<File>()
      .toList();
  return session.canBrowse && session.owner == owner
      ? files.reversed.toList()
      : [];
}

Future<void> shareSavedDownload(Session session, File file) async {
  final owner = session.owner;
  final epoch = session.browserEpoch;
  final name = file.uri.pathSegments.last;
  if (owner == null || !session.canBrowse || !_finishedName.hasMatch(name)) {
    throw const DownloadFailure(
      'This file is not available in the current session.',
    );
  }
  final directory = await _downloadDirectory(owner);
  if (file.parent.path != directory.path) {
    throw const DownloadFailure('This file belongs to a different account.');
  }
  await session.check();
  if (!session.canBrowse ||
      session.owner != owner ||
      session.browserEpoch != epoch) {
    throw const DownloadFailure('Session changed.');
  }
  await session.platform.shareDownload(
    directory.uri.pathSegments.where((part) => part.isNotEmpty).last,
    name,
  );
}
