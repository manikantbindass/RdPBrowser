import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

const _serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'https://YOUR_SERVER_STATIC_IP');

class BrowserScreen extends StatefulWidget {
  final String authToken;
  const BrowserScreen({super.key, required this.authToken});

  @override
  State<BrowserScreen> createState() => _BrowserScreenState();
}

class _BrowserScreenState extends State<BrowserScreen> {
  late final WebViewController _controller;
  String _currentUrl = '';
  String _pageTitle = 'RemoteShield X Browser';
  bool _loading = false;
  bool _blocked = false;
  String _blockedMsg = '';
  double _loadProgress = 0;
  final TextEditingController _urlCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0D14))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (url) => setState(() { _loading = true; _currentUrl = url; }),
          onPageFinished: (url) {
            setState(() { _loading = false; _currentUrl = url; _urlCtrl.text = url; });
            _controller.getTitle().then((t) => setState(() => _pageTitle = t ?? ''));
          },
          onProgress: (p) => setState(() => _loadProgress = p / 100),
          onNavigationRequest: (req) async {
            // Every navigation must be validated by backend
            final allowed = await _checkUrl(req.url);
            if (!allowed) {
              setState(() { _blocked = true; _blockedMsg = 'URL blocked by RemoteShield policy'; });
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onWebResourceError: (err) => setState(() => _loading = false),
        ),
      )
      // Disable long-press (prevents text selection / copy)
      ..addJavaScriptChannel(
        'RemoteShieldChannel',
        onMessageReceived: (msg) => debugPrint('JS: ${msg.message}'),
      );
  }

  Future<bool> _checkUrl(String url) async {
    try {
      final res = await http.post(
        Uri.parse('$_serverUrl/api/proxy/navigate'),
        headers: {
          'Authorization': 'Bearer ${widget.authToken}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'url': url}),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  void _navigate(String raw) async {
    String url = raw.trim();
    if (!url.startsWith('http')) url = 'https://$url';

    setState(() { _blocked = false; _blockedMsg = ''; });
    final allowed = await _checkUrl(url);
    if (allowed) {
      _controller.loadRequest(Uri.parse(url));
    } else {
      setState(() { _blocked = true; _blockedMsg = 'URL blocked by RemoteShield policy'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0D14),
      appBar: AppBar(
        backgroundColor: const Color(0xFF111827),
        elevation: 0,
        leading: Row(children: [
          IconButton(icon: const Icon(Icons.arrow_back), onPressed: () async {
            if (await _controller.canGoBack()) _controller.goBack();
          }),
        ]),
        title: TextField(
          controller: _urlCtrl,
          style: const TextStyle(color: Colors.white, fontSize: 13, fontFamily: 'monospace'),
          decoration: InputDecoration(
            hintText: 'Enter URL...',
            hintStyle: TextStyle(color: Colors.white38),
            filled: true,
            fillColor: Colors.white.withOpacity(0.06),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(20),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(10),
                    child: SizedBox(width: 16, height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF6366F1))),
                  )
                : IconButton(icon: const Icon(Icons.refresh, size: 18), onPressed: _controller.reload),
          ),
          onSubmitted: _navigate,
          textInputAction: TextInputAction.go,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.arrow_forward),
            onPressed: () async {
              if (await _controller.canGoForward()) _controller.goForward();
            },
          ),
        ],
        bottom: _loading
          ? PreferredSize(
              preferredSize: const Size.fromHeight(3),
              child: LinearProgressIndicator(value: _loadProgress,
                backgroundColor: Colors.transparent, color: const Color(0xFF6366F1)),
            )
          : null,
      ),
      body: _blocked
          ? _BlockedScreen(message: _blockedMsg, onBack: () => setState(() { _blocked = false; }))
          : WebViewWidget(controller: _controller),
    );
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    super.dispose();
  }
}

class _BlockedScreen extends StatelessWidget {
  final String message;
  final VoidCallback onBack;
  const _BlockedScreen({required this.message, required this.onBack});

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('🚫', style: TextStyle(fontSize: 64)),
          const SizedBox(height: 20),
          const Text('Access Blocked', style: TextStyle(color: Color(0xFFEF4444), fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          Text(message, style: const TextStyle(color: Color(0xFF94A3B8)), textAlign: TextAlign.center),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: onBack,
            icon: const Icon(Icons.arrow_back),
            label: const Text('Go Back'),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF6366F1)),
          ),
        ],
      ),
    ),
  );
}
