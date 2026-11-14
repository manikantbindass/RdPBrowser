import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../config.dart';
import '../services/session.dart';

const searchEngines = {
  'Google': 'https://www.google.com/search',
  'DuckDuckGo': 'https://duckduckgo.com/',
  'Bing': 'https://www.bing.com/search',
};

Uri? validAddress(String value) {
  if (value.isEmpty ||
      value.length > 2048 ||
      value.contains(RegExp(r'[\x00-\x20\x7f\\]'))) {
    return null;
  }
  final uri = Uri.tryParse(value);
  if (uri == null ||
      !uri.isScheme('https') ||
      uri.host.isEmpty ||
      uri.authority.contains('@')) {
    return null;
  }
  return uri;
}

Uri? addressOrSearch(String raw, String searchEngine) {
  final value = raw.trim();
  if (value.isEmpty ||
      value.length > 2048 ||
      value.contains(RegExp(r'[\x00-\x1f\x7f]'))) {
    return null;
  }
  if (RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:').hasMatch(value)) {
    return validAddress(value);
  }
  if (!value.contains(' ') && value.contains('.')) {
    return validAddress('https://$value');
  }
  return Uri.parse(
    searchEngines[searchEngine] ?? searchEngines.values.first,
  ).replace(queryParameters: {'q': value});
}

String? savedAddress(Uri uri) {
  final address = validAddress(uri.toString());
  if (address == null) return null;
  return address.toString().split(RegExp(r'[?#]')).first;
}

class BrowserTab {
  BrowserTab();
  Uri? address;
  WebViewController? controller;
  double progress = 1;
  String? error;
  int generation = 0;
}

class BrowserProvider extends ChangeNotifier {
  BrowserProvider(this.session)
    : _storagePrefix =
          'browser.v1.${controlPlaneUri('/').origin}.${session.owner}';

  final Session session;
  final List<BrowserTab> tabs = [BrowserTab()];
  int selected = 0;
  List<String> history = [];
  List<String> bookmarks = [];
  String searchEngine = searchEngines.keys.first;
  bool _disposed = false;

  BrowserTab get current => tabs[selected];
  final String _storagePrefix;

  Future<void> initialize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      List<String> load(String suffix) =>
          (prefs.getStringList('$_storagePrefix.$suffix') ?? [])
              .map(validAddress)
              .whereType<Uri>()
              .map(savedAddress)
              .whereType<String>()
              .take(100)
              .toList();
      if (_disposed) return;
      bookmarks = load('bookmarks');
      history = load('history');
      if (tabs.length == 1 &&
          current.address == null &&
          current.generation == 0) {
        final restored = load('tabs').take(10).toList();
        if (restored.isNotEmpty) {
          tabs
            ..clear()
            ..addAll(
              restored.map((value) => BrowserTab()..address = Uri.parse(value)),
            );
        }
      }
      final engine = prefs.getString('$_storagePrefix.searchEngine');
      if (searchEngines.containsKey(engine)) searchEngine = engine!;
      notifyListeners();
    } on Exception {
      // Unavailable preferences leave an empty browser.
    }
  }

  void _publish() {
    if (!_disposed) notifyListeners();
  }

  void addTab() {
    if (tabs.length >= 10) return;
    tabs.add(BrowserTab());
    selected = tabs.length - 1;
    _publish();
  }

  void select(int index) {
    selected = index;
    _publish();
  }

  void closeTab(int index) {
    _close(tabs.removeAt(index));
    _saveTabs();
    if (tabs.isEmpty) tabs.add(BrowserTab());
    if (index < selected) selected--;
    if (selected >= tabs.length) selected = tabs.length - 1;
    _publish();
  }

  void _close(BrowserTab tab) {
    tab.generation++;
    final controller = tab.controller;
    tab.controller = null;
    if (controller != null) {
      unawaited(
        controller
            .loadRequest(Uri.parse('about:blank'))
            .catchError((Object _) {}),
      );
    }
  }

  Future<void> open(String raw) async {
    final tab = current;
    final uri = addressOrSearch(raw, searchEngine);
    if (uri == null) {
      tab.error = 'Enter an HTTPS address or search terms.';
      _publish();
      return;
    }
    final generation = ++tab.generation;
    tab.error = null;
    tab.progress = 0;
    _publish();
    bool active() =>
        !_disposed && tabs.contains(tab) && tab.generation == generation;
    if (!await session.allow(uri.toString()) || !active()) {
      if (active()) {
        tab.error = 'Navigation denied or unavailable.';
        tab.progress = 1;
        _publish();
      }
      return;
    }
    try {
      final controller = tab.controller ?? await _controller(tab);
      if (!active() || !session.canBrowse) return;
      tab.controller = controller;
      tab.address = uri;
      await controller.loadRequest(uri);
      if (active()) _publish();
    } on Exception {
      if (active()) {
        tab.error = 'Could not open this page.';
        tab.progress = 1;
        _publish();
      }
    }
  }

  Future<WebViewController> _controller(BrowserTab tab) async {
    final controller = WebViewController();
    bool live() =>
        !_disposed && tab.controller == controller && session.canBrowse;
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) async {
          if (!request.isMainFrame) return NavigationDecision.prevent;
          final uri = validAddress(request.url);
          final epoch = tab.generation;
          if (live() &&
              uri != null &&
              await session.allow(uri.toString()) &&
              live() &&
              epoch == tab.generation) {
            return NavigationDecision.navigate;
          }
          if (live() && epoch == tab.generation) {
            tab.error = 'The destination was blocked by browser policy.';
            tab.progress = 1;
            _publish();
          }
          return NavigationDecision.prevent;
        },
        onPageStarted: (value) {
          if (!live()) return;
          final uri = validAddress(value);
          if (uri == null) return;
          final generation = tab.generation;
          tab.progress = 0;
          _publish();
          // Android's navigation callback can omit form POSTs. Audit starts as
          // defense in depth and destroy denied views, even if loading began.
          unawaited(() async {
            if (!await session.allow(uri.toString()) &&
                live() &&
                tab.generation == generation) {
              _close(tab);
              tab.error = 'The destination was blocked by browser policy.';
              tab.progress = 1;
              _publish();
            }
          }());
        },
        onProgress: (value) {
          if (!live()) return;
          tab.progress = value / 100;
          _publish();
        },
        onPageFinished: (value) {
          if (!live()) return;
          final uri = validAddress(value);
          if (uri == null) return;
          tab.address = uri;
          tab.progress = 1;
          final address = savedAddress(uri);
          if (address != null && history.firstOrNull != address) {
            history = [
              address,
              ...history.where((item) => item != address),
            ].take(100).toList();
            unawaited(_saveList('history', history));
          }
          _saveTabs();
          _publish();
        },
        onWebResourceError: (error) {
          if (!live() || error.isForMainFrame != true) return;
          tab.error = 'This page could not load.';
          tab.progress = 1;
          _publish();
        },
      ),
    );
    if (controller.platform case final AndroidWebViewController android) {
      await android.setAllowFileAccess(false);
      await android.setAllowContentAccess(false);
      await android.setGeolocationEnabled(false);
      await android.setOnShowFileSelector((_) async => []);
      await android.setMixedContentMode(MixedContentMode.neverAllow);
      await android.setOnPlatformPermissionRequest((request) => request.deny());
      await AndroidWebViewController.enableDebugging(false);
    }
    return controller;
  }

  Future<void> toggleBookmark() async {
    final uri = current.address;
    final address = uri == null ? null : savedAddress(uri);
    if (address == null) return;
    if (bookmarks.contains(address)) {
      bookmarks = bookmarks.where((item) => item != address).toList();
    } else {
      bookmarks = [address, ...bookmarks].take(100).toList();
    }
    _publish();
    await _saveList('bookmarks', bookmarks);
  }

  Future<void> removeBookmark(String address) async {
    bookmarks = bookmarks.where((item) => item != address).toList();
    _publish();
    await _saveList('bookmarks', bookmarks);
  }

  Future<void> clearHistory() async {
    history = [];
    _publish();
    await _saveList('history', history);
  }

  Future<void> setSearchEngine(String value) async {
    if (!searchEngines.containsKey(value)) return;
    searchEngine = value;
    _publish();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('$_storagePrefix.searchEngine', value);
    } on Exception {
      // Keep this choice for the current workspace.
    }
  }

  void _saveTabs() {
    unawaited(
      _saveList(
        'tabs',
        tabs
            .map((tab) => tab.address)
            .whereType<Uri>()
            .map(savedAddress)
            .whereType<String>()
            .toList(),
      ),
    );
  }

  Future<void> _saveList(String suffix, List<String> values) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList('$_storagePrefix.$suffix', values);
    } on Exception {
      // Browsing remains available with in-memory preferences.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    for (final tab in tabs) {
      _close(tab);
    }
    super.dispose();
  }
}
