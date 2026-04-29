import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:provider/provider.dart';
import '../models/browser_tab.dart';
import '../models/bookmark.dart';
import '../models/history_entry.dart';
import '../providers/browser_provider.dart';
import 'bookmarks_screen.dart';
import 'history_screen.dart';
import 'downloads_screen.dart';
import 'settings_screen.dart';
import 'search_engine_screen.dart';

const _serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'https://YOUR_SERVER_STATIC_IP');

class BrowserScreen extends StatefulWidget {
  final String authToken;
  const BrowserScreen({super.key, required this.authToken});

  @override
  State<BrowserScreen> createState() => _BrowserScreenState();
}

class _BrowserScreenState extends State<BrowserScreen> with SingleTickerProviderStateMixin {
  late BrowserProvider _browserProvider;
  final TextEditingController _urlCtrl = TextEditingController();
  final TextEditingController _searchCtrl = TextEditingController();
  bool _showFindInPage = false;
  String _findQuery = '';
  bool _darkMode = false;
  bool _readerMode = false;
  bool _incognitoMode = false;
  TabController? _tabController;

  @override
  void initState() {
    super.initState();
    _browserProvider = BrowserProvider(widget.authToken);
    _tabController = TabController(length: 1, vsync: this);
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _darkMode = prefs.getBool('dark_mode') ?? false;
      _incognitoMode = prefs.getBool('incognito_mode') ?? false;
    });
  }

  void _navigate(String raw) async {
    String url = raw.trim();
    if (!url.startsWith('http')) url = 'https://$url';
    await _browserProvider.navigateToUrl(url);
    setState(() {});
  }

  void _addNewTab({String? url}) {
    _browserProvider.addTab(url: url ?? 'https://www.google.com');
    setState(() {
      _tabController = TabController(
        length: _browserProvider.tabs.length,
        vsync: this,
        initialIndex: _browserProvider.tabs.length - 1,
      );
    });
  }

  void _closeTab(int index) {
    if (_browserProvider.tabs.length > 1) {
      _browserProvider.removeTab(index);
      setState(() {
        _tabController = TabController(
          length: _browserProvider.tabs.length,
          vsync: this,
        );
      });
    }
  }

  void _addBookmark() async {
    final currentTab = _browserProvider.currentTab;
    if (currentTab != null) {
      await _browserProvider.addBookmark(
        Bookmark(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          title: currentTab.title,
          url: currentTab.url,
          timestamp: DateTime.now(),
        ),
      );
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bookmark added')),
      );
    }
  }

  void _showMoreMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF111827),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.bookmark_add, color: Color(0xFF6366F1)),
            title: const Text('Add Bookmark', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              _addBookmark();
            },
          ),
          ListTile(
            leading: const Icon(Icons.bookmarks, color: Color(0xFF6366F1)),
            title: const Text('Bookmarks', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => BookmarksScreen(provider: _browserProvider)));
            },
          ),
          ListTile(
            leading: const Icon(Icons.history, color: Color(0xFF6366F1)),
            title: const Text('History', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => HistoryScreen(provider: _browserProvider)));
            },
          ),
          ListTile(
            leading: const Icon(Icons.download, color: Color(0xFF6366F1)),
            title: const Text('Downloads', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => const DownloadsScreen()));
            },
          ),
          ListTile(
            leading: Icon(_incognitoMode ? Icons.visibility : Icons.visibility_off, color: const Color(0xFF6366F1)),
            title: Text(_incognitoMode ? 'Exit Incognito' : 'New Incognito Tab', style: const TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              setState(() {
                _incognitoMode = !_incognitoMode;
                if (_incognitoMode) _addNewTab();
              });
            },
          ),
          ListTile(
            leading: Icon(_darkMode ? Icons.light_mode : Icons.dark_mode, color: const Color(0xFF6366F1)),
            title: Text(_darkMode ? 'Light Mode' : 'Dark Mode', style: const TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              setState(() {
                _darkMode = !_darkMode;
              });
            },
          ),
          ListTile(
            leading: const Icon(Icons.search, color: Color(0xFF6366F1)),
            title: const Text('Search Engine Settings', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => const SearchEngineScreen()));
            },
          ),
          ListTile(
            leading: const Icon(Icons.settings, color: Color(0xFF6366F1)),
            title: const Text('Settings', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _browserProvider,
      child: Consumer<BrowserProvider>(builder: (context, provider, _) {
        final currentTab = provider.currentTab;
        if (currentTab != null && _urlCtrl.text != currentTab.url) {
          _urlCtrl.text = currentTab.url;
        }

        return Scaffold(
          backgroundColor: _darkMode ? const Color(0xFF0A0D14) : Colors.white,
          appBar: AppBar(
            backgroundColor: _incognitoMode ? const Color(0xFF1F2937) : const Color(0xFF111827),
            elevation: 0,
            leading: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back, size: 20),
                  onPressed: () async {
                    if (currentTab != null) {
                      await currentTab.controller.canGoBack().then((canGoBack) {
                        if (canGoBack) currentTab.controller.goBack();
                      });
                    }
                  },
                ),
              ],
            ),
            leadingWidth: 50,
            title: TextField(
              controller: _urlCtrl,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Enter URL or search...',
                hintStyle: const TextStyle(color: Colors.white38),
                filled: true,
                fillColor: Colors.white.withOpacity(0.06),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                prefixIcon: _incognitoMode
                    ? const Icon(Icons.visibility_off, size: 16, color: Colors.white54)
                    : const Icon(Icons.lock, size: 16, color: Colors.green),
                suffixIcon: currentTab?.loading ?? false
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Color(0xFF6366F1),
                          ),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.refresh, size: 18),
                        onPressed: () => currentTab?.controller.reload(),
                      ),
              ),
              onSubmitted: _navigate,
              textInputAction: TextInputAction.go,
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.arrow_forward, size: 20),
                onPressed: () async {
                  if (currentTab != null) {
                    await currentTab.controller.canGoForward().then((canGoForward) {
                      if (canGoForward) currentTab.controller.goForward();
                    });
                  }
                },
              ),
              IconButton(
                icon: const Icon(Icons.tab, size: 20),
                onPressed: () => _addNewTab(),
              ),
              IconButton(
                icon: const Icon(Icons.more_vert),
                onPressed: _showMoreMenu,
              ),
            ],
            bottom: currentTab != null && currentTab.loading
                ? PreferredSize(
                    preferredSize: const Size.fromHeight(3),
                    child: LinearProgressIndicator(
                      value: currentTab.loadProgress,
                      backgroundColor: Colors.transparent,
                      color: const Color(0xFF6366F1),
                    ),
                  )
                : null,
          ),
          body: currentTab != null && !currentTab.blocked
              ? Column(
                  children: [
                    if (provider.tabs.length > 1)
                      Container(
                        height: 40,
                        color: const Color(0xFF1F2937),
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          itemCount: provider.tabs.length,
                          itemBuilder: (ctx, i) => GestureDetector(
                            onTap: () {
                              setState(() {
                                provider.setCurrentTabIndex(i);
                              });
                            },
                            child: Container(
                              margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                              decoration: BoxDecoration(
                                color: provider.currentTabIndex == i
                                    ? const Color(0xFF6366F1)
                                    : const Color(0xFF374151),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                children: [
                                  Text(
                                    provider.tabs[i].title.length > 15
                                        ? '${provider.tabs[i].title.substring(0, 15)}...'
                                        : provider.tabs[i].title,
                                    style: const TextStyle(color: Colors.white, fontSize: 12),
                                  ),
                                  const SizedBox(width: 8),
                                  GestureDetector(
                                    onTap: () => _closeTab(i),
                                    child: const Icon(Icons.close, size: 16, color: Colors.white),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    Expanded(child: WebViewWidget(controller: currentTab.controller)),
                    if (_showFindInPage)
                      Container(
                        color: const Color(0xFF1F2937),
                        padding: const EdgeInsets.all(8),
                        child: Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _searchCtrl,
                                style: const TextStyle(color: Colors.white),
                                decoration: const InputDecoration(
                                  hintText: 'Find in page...',
                                  hintStyle: TextStyle(color: Colors.white54),
                                  border: OutlineInputBorder(),
                                ),
                                onChanged: (val) {
                                  setState(() {
                                    _findQuery = val;
                                  });
                                },
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.arrow_upward, color: Colors.white),
                              onPressed: () {},
                            ),
                            IconButton(
                              icon: const Icon(Icons.arrow_downward, color: Colors.white),
                              onPressed: () {},
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, color: Colors.white),
                              onPressed: () {
                                setState(() {
                                  _showFindInPage = false;
                                });
                              },
                            ),
                          ],
                        ),
                      ),
                  ],
                )
              : Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('🚫', style: TextStyle(fontSize: 64)),
                      const SizedBox(height: 20),
                      const Text('Access Blocked',
                          style: TextStyle(color: Color(0xFFEF4444), fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),
                      Text(currentTab?.blockedMsg ?? 'URL blocked',
                          style: const TextStyle(color: Color(0xFF94A3B8))),
                      const SizedBox(height: 24),
                      ElevatedButton.icon(
                        onPressed: () {
                          provider.currentTab?.blocked = false;
                          setState(() {});
                        },
                        icon: const Icon(Icons.arrow_back),
                        label: const Text('Go Back'),
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1)),
                      ),
                    ],
                  ),
                ),
        );
      }),
    );
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _searchCtrl.dispose();
    _tabController?.dispose();
    super.dispose();
  }
}
