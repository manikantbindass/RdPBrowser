import 'package:flutter_test/flutter_test.dart';
import 'package:remoteshield_x/config.dart';
import 'package:remoteshield_x/providers/browser_provider.dart';
import 'package:remoteshield_x/services/control_plane.dart';

void main() {
  test('control plane requires an exact HTTPS origin outside local debug', () {
    expect(parseOrigin('https://control.example').host, 'control.example');
    expect(
      () => parseOrigin('http://10.0.2.2:3001', allowLocalHttp: false),
      throwsFormatException,
    );
    expect(
      parseOrigin('http://10.0.2.2:3001', allowLocalHttp: true).port,
      3001,
    );
    for (final value in [
      'https://user@host',
      'https://host/?key=x',
      'https://host/a',
    ]) {
      expect(() => parseOrigin(value), throwsFormatException);
    }
  });

  test('browser rejects unsafe addresses and saves sanitized history', () {
    for (final value in [
      'javascript:alert(1)',
      'intent://activity',
      'file:///tmp/x',
      'http://example.com',
      'https://user:password@example.com/',
      'https://example.com/a\nb',
      r'https://example.com\@elsewhere.test',
    ]) {
      expect(addressOrSearch(value, 'Google'), isNull, reason: value);
    }
    expect(
      addressOrSearch('two words', 'DuckDuckGo')?.queryParameters['q'],
      'two words',
    );
    expect(
      savedAddress(Uri.parse('https://host/a%2Fb?secret=123#fragment')),
      'https://host/a%2Fb',
    );
  });

  test('policy checks require exact ordered affirmative decisions', () {
    final value = <String, dynamic>{
      'access': {'allowed': true},
      'decisions': [
        {'url': 'https://example.test/', 'allowed': true},
        {'url': 'https://elsewhere.test/', 'allowed': true},
      ],
    };
    expect(
      permitsBatch(value, ['https://example.test/', 'https://elsewhere.test/']),
      isTrue,
    );
    expect(
      permitsBatch(value, ['https://elsewhere.test/', 'https://example.test/']),
      isFalse,
    );
    expect(permitsNavigation(value, 'https://example.test/'), isFalse);
    expect(permitsNavigation({}, 'https://example.test/'), isFalse);
  });
}
