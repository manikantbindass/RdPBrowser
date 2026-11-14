import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../providers/browser_provider.dart';
import '../services/session.dart';
import 'browser_tools.dart';

enum _Tool { tabs, bookmarks, history, downloads, settings, signOut }

class BrowserScreen extends StatefulWidget {
  const BrowserScreen({super.key, required this.session});
  final Session session;

  @override
  State<BrowserScreen> createState() => _BrowserScreenState();
}

class _BrowserScreenState extends State<BrowserScreen> {
  late final BrowserProvider _browser = BrowserProvider(widget.session);
  final _address = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.session.openAddresses = () => _browser.tabs
        .where((tab) => tab.controller != null)
        .map((tab) => tab.address?.toString())
        .whereType<String>()
        .toSet();
    _browser.addListener(_updateAddress);
    unawaited(_browser.initialize());
  }

  void _updateAddress() {
    if (!_focus.hasFocus) {
      _address.text = _browser.current.address?.toString() ?? '';
    }
  }

  @override
  void dispose() {
    widget.session.openAddresses = null;
    _browser.dispose();
    _address.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _open(String value) {
    _focus.unfocus();
    unawaited(_browser.open(value));
  }

  Future<void> _tool(_Tool tool) async {
    switch (tool) {
      case _Tool.signOut:
        await widget.session.signOut();
      case _Tool.tabs:
        await showModalBottomSheet<void>(
          context: context,
          useSafeArea: true,
          builder: (context) => ListenableBuilder(
            listenable: _browser,
            builder: (context, _) => Column(
              children: [
                ListTile(
                  title: const Text('Tabs'),
                  trailing: IconButton(
                    tooltip: 'New tab',
                    icon: const Icon(Icons.add),
                    onPressed: _browser.tabs.length >= 10
                        ? null
                        : () {
                            _browser.addTab();
                            Navigator.pop(context);
                          },
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: _browser.tabs.length,
                    itemBuilder: (context, index) => ListTile(
                      selected: _browser.selected == index,
                      title: Text(
                        _browser.tabs[index].address?.host ?? 'New tab',
                      ),
                      onTap: () {
                        _browser.select(index);
                        Navigator.pop(context);
                      },
                      trailing: IconButton(
                        tooltip: 'Close tab ${index + 1}',
                        onPressed: () => _browser.closeTab(index),
                        icon: const Icon(Icons.close),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      case _Tool.settings:
        await showDialog<void>(
          context: context,
          builder: (context) =>
              BrowserSettings(browser: _browser, session: widget.session),
        );
      case _Tool.bookmarks:
      case _Tool.history:
        final value = await showDialog<String>(
          context: context,
          builder: (context) => SavedAddresses(
            browser: _browser,
            bookmarks: tool == _Tool.bookmarks,
          ),
        );
        if (mounted && value != null) _open(value);
      case _Tool.downloads:
        await showDialog<void>(
          context: context,
          builder: (context) => DownloadsPanel(session: widget.session),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return ListenableBuilder(
      listenable: _browser,
      builder: (context, _) {
        final tab = _browser.current;
        final controller = tab.controller;
        final currentAddress = tab.address;
        final saved = currentAddress == null
            ? null
            : savedAddress(currentAddress);
        return Scaffold(
          appBar: AppBar(
            title: const Text('RemoteShield X'),
            actions: [
              IconButton(
                icon: const Icon(Icons.tab_outlined),
                tooltip: 'Tabs (${_browser.tabs.length})',
                onPressed: session.canBrowse ? () => _tool(_Tool.tabs) : null,
              ),
              PopupMenuButton<_Tool>(
                tooltip: 'Browser options',
                onSelected: _tool,
                itemBuilder: (context) => [
                  if (session.canBrowse) ...const [
                    PopupMenuItem(
                      value: _Tool.bookmarks,
                      child: Text('Bookmarks'),
                    ),
                    PopupMenuItem(value: _Tool.history, child: Text('History')),
                    PopupMenuItem(
                      value: _Tool.downloads,
                      child: Text('Downloads'),
                    ),
                  ],
                  const PopupMenuItem(
                    value: _Tool.settings,
                    child: Text('Device and settings'),
                  ),
                  const PopupMenuItem(
                    value: _Tool.signOut,
                    child: Text('Sign out'),
                  ),
                ],
              ),
            ],
          ),
          body: SafeArea(
            top: false,
            child: Column(
              children: [
                if (session.canBrowse) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                    child: TextField(
                      controller: _address,
                      focusNode: _focus,
                      autocorrect: false,
                      enableSuggestions: false,
                      maxLines: 1,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      onSubmitted: _open,
                      decoration: InputDecoration(
                        border: const OutlineInputBorder(),
                        labelText: 'HTTPS address or search',
                        suffixIcon: IconButton(
                          tooltip: 'Open address',
                          icon: const Icon(Icons.arrow_forward),
                          onPressed: () => _open(_address.text),
                        ),
                      ),
                    ),
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      IconButton(
                        tooltip: 'Back',
                        icon: const Icon(Icons.chevron_left),
                        onPressed: controller?.goBack,
                      ),
                      IconButton(
                        tooltip: 'Forward',
                        icon: const Icon(Icons.chevron_right),
                        onPressed: controller?.goForward,
                      ),
                      IconButton(
                        tooltip: 'Reload',
                        icon: const Icon(Icons.refresh),
                        onPressed: currentAddress == null
                            ? null
                            : () => _open(currentAddress.toString()),
                      ),
                      IconButton(
                        tooltip: 'Bookmark',
                        isSelected: _browser.bookmarks.contains(saved),
                        icon: const Icon(Icons.star_outline),
                        selectedIcon: const Icon(Icons.star),
                        onPressed: saved == null
                            ? null
                            : _browser.toggleBookmark,
                      ),
                    ],
                  ),
                  if (tab.progress < 1)
                    LinearProgressIndicator(
                      value: tab.progress,
                      semanticsLabel: 'Loading website',
                    ),
                ],
                if (session.message.isNotEmpty || tab.error != null)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Semantics(
                      liveRegion: true,
                      child: Text(tab.error ?? session.message),
                    ),
                  ),
                Expanded(
                  child: session.canBrowse && controller != null
                      ? WebViewWidget(
                          key: ObjectKey(controller),
                          controller: controller,
                        )
                      : Center(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.shield_outlined, size: 48),
                                const SizedBox(height: 16),
                                Text(
                                  session.canBrowse
                                      ? (currentAddress == null
                                            ? 'Enter an address to begin.'
                                            : 'Open this saved tab when ready.')
                                      : 'Browsing is paused.',
                                ),
                                if (session.canBrowse && currentAddress != null)
                                  FilledButton(
                                    onPressed: () =>
                                        _open(currentAddress.toString()),
                                    child: const Text('Open saved tab'),
                                  ),
                                if (!session.canBrowse) ...[
                                  FilledButton(
                                    onPressed: session.busy
                                        ? null
                                        : session.enroll,
                                    child: const Text(
                                      'Enroll device or renew proof',
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: () => session.check(),
                                    child: const Text('Check access'),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
