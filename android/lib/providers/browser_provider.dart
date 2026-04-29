import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../models/browser_tab.dart';
import '../models/bookmark.dart';
import '../models/history_entry.dart';

const _serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'https://YOUR_SERVER_STATIC_IP');

class BrowserProvider extends ChangeNotifier {
  final String authToken;
  List<BrowserTab> _tabs = [];
  List<Bookmark> _bookmarks = [];
  List<HistoryEntry> _history = [];
  int _currentTabIndex = 0;
  String _searchEngine = 'https://www.google.com/search?q=';
  String _searchEngineName = 'Google';

  BrowserProvider(this.authToken) {
    _init();
  }

  // Getters
  List<BrowserTab> get tabs => _tabs;
  List<Bookmark> get bookmarks => _bookmarks;
  List<HistoryEntry> get history => _history;
  int get currentTabIndex => _currentTabIndex;
  BrowserTab? get currentTab => _tabs.isNotEmpty ? _tabs[_currentTabIndex] : null;
  String get searchEngine => _searchEngine;
  String get searchEngineName => _searchEngineName;

  Future<void> _init() async {
    await _loadSettings();
    await _loadBookmarks();
    await _loadHistory();
    if (_tabs.isEmpty) {
      addTab();
    }
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    _searchEngine = prefs.getString('search_engine') ?? 'https://www.google.com/search?q=';
    _searchEngineName = prefs.getString('search_engine_name') ?? 'Google';
  }

  Future<void> _loadBookmarks() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString('bookmarks');
    if (data != null) {
      final list = jsonDecode(data) as List;
      _bookmarks = list.map((e) => Bookmark.fromJson(e)).toList();
    }
  }

  Future<void> _loadHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString('history');
    if (data != null) {
      final list = jsonDecode(data) as List;
      _history = list.map((e) => HistoryEntry.fromJson(e)).toList();
    }
  }

  // ---- TAB MANAGEMENT ----

  void addTab({String url = 'https://www.google.com'}) {
    final controller = _createController(url);
    final tab = BrowserTab(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      url: url,
      controller: controller,
    );
    _tabs.add(tab);
    _currentTabIndex = _tabs.length - 1;
    controller.loadRequest(Uri.parse(url));
    notifyListeners();
  }

  void removeTab(int index) {
    if (_tabs.length > 1) {
      _tabs.removeAt(index);
      if (_currentTabIndex >= _tabs.length) {
        _currentTabIndex = _tabs.length - 1;
      }
      notifyListeners();
    }
  }

  void setCurrentTabIndex(int index) {
    _currentTabIndex = index;
    notifyListeners();
  }

  Future<void> navigateToUrl(String url) async {
    final tab = currentTab;
    if (tab == null) return;

    final allowed = await _checkUrl(url);
    if (allowed) {
      tab.url = url;
      tab.blocked = false;
      tab.blockedMsg = '';
      await tab.controller.loadRequest(Uri.parse(url));
    } else {
      tab.blocked = true;
      tab.blockedMsg = 'URL blocked by RemoteShield policy';
    }
    notifyListeners();
  }

  String buildSearchUrl(String query) {
    if (query.startsWith('http://') || query.startsWith('https://')) {
      return query;
    }
    if (query.contains('.') && !query.contains(' ')) {
      return 'https://$query';
    }
    return '$_searchEngine${Uri.encodeComponent(query)}';
  }

  WebViewController _createController(String initialUrl) {
    return WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0D14))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) {
            currentTab?.loading = true;
            currentTab?.url = url;
            notifyListeners();
          },
          onPageFinished: (url) {
            currentTab?.loading = false;
            currentTab?.url = url;
            currentTab?.controller.getTitle().then((t) {
              currentTab?.title = t ?? 'New Tab';
              _addToHistory(url, t ?? 'Untitled');
              notifyListeners();
            });
          },
          onProgress: (p) {
            currentTab?.loadProgress = p / 100;
            notifyListeners();
          },
          onNavigationRequest: (req) async {
            final allowed = await _checkUrl(req.url);
            if (!allowed) {
              currentTab?.blocked = true;
              currentTab?.blockedMsg = 'URL blocked by RemoteShield policy';
              notifyListeners();
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onWebResourceError: (err) {
            currentTab?.loading = false;
            notifyListeners();
          },
        ),
      )
      ..addJavaScriptChannel(
        'RemoteShieldChannel',
        onMessageReceived: (msg) => debugPrint('JS: ${msg.message}'),
      );
  }

  // ---- BOOKMARKS ----

  Future<void> addBookmark(Bookmark bookmark) async {
    _bookmarks.add(bookmark);
    await _saveBookmarks();
    notifyListeners();
  }

  Future<void> removeBookmark(String id) async {
    _bookmarks.removeWhere((b) => b.id == id);
    await _saveBookmarks();
    notifyListeners();
  }

  bool isBookmarked(String url) => _bookmarks.any((b) => b.url == url);

  Future<void> _saveBookmarks() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('bookmarks', jsonEncode(_bookmarks.map((b) => b.toJson()).toList()));
  }

  // ---- HISTORY ----

  Future<void> _addToHistory(String url, String title) async {
    final existing = _history.indexWhere((h) => h.url == url);
    if (existing != -1) {
      _history[existing].visitCount++;
    } else {
      _history.insert(
        0,
        HistoryEntry(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          url: url,
          title: title,
          visitedAt: DateTime.now(),
        ),
      );
      if (_history.length > 500) _history.removeLast();
    }
    await _saveHistory();
  }

  Future<void> clearHistory() async {
    _history.clear();
    await _saveHistory();
    notifyListeners();
  }

  Future<void> removeHistoryEntry(String id) async {
    _history.removeWhere((h) => h.id == id);
    await _saveHistory();
    notifyListeners();
  }

  Future<void> _saveHistory() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('history', jsonEncode(_history.map((h) => h.toJson()).toList()));
  }

  // ---- SEARCH ENGINE ----

  Future<void> setSearchEngine(String url, String name) async {
    _searchEngine = url;
    _searchEngineName = name;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('search_engine', url);
    await prefs.setString('search_engine_name', name);
    notifyListeners();
  }

  // ---- URL VALIDATION (keep existing RemoteShield security) ----

  Future<bool> _checkUrl(String url) async {
    try {
      final res = await http.post(
        Uri.parse('$_serverUrl/api/proxy/navigate'),
        headers: {
          'Authorization': 'Bearer $authToken',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'url': url}),
      ).timeout(const Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return true; // Allow if server is unreachable (offline mode)
    }
  }
}
