import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:remoteshield_x/services/downloads.dart';

void main() {
  late Directory folder;
  late File pending;

  setUp(() async {
    folder = await Directory.systemTemp.createTemp('rsx-download-test-');
    pending = File('${folder.path}/file.part');
  });
  tearDown(() => folder.delete(recursive: true));

  http.StreamedResponse response(List<List<int>> chunks, {int? length}) =>
      http.StreamedResponse(
        Stream.fromIterable(chunks),
        200,
        contentLength: length,
      );

  test('writes direct binary files with a split format header', () async {
    final data = '%PDF-1.7\nfixture'.codeUnits;
    await writeDownload(
      pending,
      response([
        data.take(3).toList(),
        data.skip(3).toList(),
      ], length: data.length),
      DownloadFormat.pdf,
      () => true,
    );
    expect(await pending.readAsBytes(), data);
  });

  test('rejects unsupported and mislabeled responses', () async {
    for (final mime in [
      'text/html',
      'image/svg+xml',
      'application/octet-stream',
      'application/vnd.apple.mpegurl',
    ]) {
      expect(DownloadFormat.fromContentType(mime), isNull);
    }
    expect(
      DownloadFormat.fromContentType('IMAGE/PNG; x=y'),
      DownloadFormat.png,
    );
    await expectLater(
      writeDownload(
        pending,
        response(['<html>sign in</html>'.codeUnits]),
        DownloadFormat.pdf,
        () => true,
      ),
      throwsA(isA<DownloadFailure>()),
    );
  });

  test('rejects oversized, truncated, and revoked downloads', () async {
    final data = '%PDF-1.7'.codeUnits;
    for (final length in [DownloadFormat.pdf.limit + 1, data.length + 1]) {
      await expectLater(
        writeDownload(
          pending,
          response([data], length: length),
          DownloadFormat.pdf,
          () => true,
        ),
        throwsA(isA<DownloadFailure>()),
      );
    }
    await expectLater(
      writeDownload(pending, response([data]), DownloadFormat.pdf, () => false),
      throwsA(isA<DownloadFailure>()),
    );
  });
}
