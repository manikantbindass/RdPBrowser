import 'dart:io';

import 'package:flutter/material.dart';

import '../providers/browser_provider.dart';
import '../services/downloads.dart';
import '../services/session.dart';

class SavedAddresses extends StatelessWidget {
  const SavedAddresses({
    super.key,
    required this.browser,
    required this.bookmarks,
  });
  final BrowserProvider browser;
  final bool bookmarks;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: browser,
    builder: (context, _) {
      final values = bookmarks ? browser.bookmarks : browser.history;
      return AlertDialog(
        title: Text(bookmarks ? 'Bookmarks' : 'History'),
        content: SizedBox(
          width: 420,
          height: values.isEmpty
              ? null
              : MediaQuery.sizeOf(context).height * 0.4,
          child: values.isEmpty
              ? const Text('No saved addresses.')
              : ListView.builder(
                  itemCount: values.length,
                  itemBuilder: (context, index) {
                    final address = values[index];
                    return ListTile(
                      title: Text(address),
                      onTap: () => Navigator.pop(context, address),
                      trailing: bookmarks
                          ? IconButton(
                              tooltip: 'Remove bookmark',
                              icon: const Icon(Icons.delete_outline),
                              onPressed: () => browser.removeBookmark(address),
                            )
                          : null,
                    );
                  },
                ),
        ),
        actions: [
          if (!bookmarks && values.isNotEmpty)
            TextButton(
              onPressed: browser.clearHistory,
              child: const Text('Clear history'),
            ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      );
    },
  );
}

class BrowserSettings extends StatefulWidget {
  const BrowserSettings({
    super.key,
    required this.browser,
    required this.session,
  });
  final BrowserProvider browser;
  final Session session;

  @override
  State<BrowserSettings> createState() => _BrowserSettingsState();
}

class _BrowserSettingsState extends State<BrowserSettings> {
  late final _risks = widget.session.platform.risks();

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.session,
    builder: (context, _) {
      final session = widget.session;
      return AlertDialog(
        title: const Text('Device and settings'),
        scrollable: true,
        content: SizedBox(
          width: 420,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                initialValue: widget.browser.searchEngine,
                decoration: const InputDecoration(labelText: 'Search engine'),
                items: searchEngines.keys
                    .map(
                      (name) =>
                          DropdownMenuItem(value: name, child: Text(name)),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) widget.browser.setSearchEngine(value);
                },
              ),
              const SizedBox(height: 16),
              Text(
                'Device trust: ${session.device?['trustState'] ?? 'Unenrolled'}',
              ),
              Text('Device ID: ${session.device?['id'] ?? 'Unavailable'}'),
              FutureBuilder<List<String>>(
                future: _risks,
                builder: (context, snapshot) {
                  final risks = snapshot.data;
                  return Text(
                    risks == null
                        ? 'Checking local risk signalsâ€¦'
                        : risks.isEmpty
                        ? 'No local indicators detected.'
                        : risks.join('\n'),
                  );
                },
              ),
              const SizedBox(height: 8),
              const Text(
                'Local signals do not establish device trust. Your administrator approves posture separately.',
              ),
              if (session.message.isNotEmpty)
                Semantics(liveRegion: true, child: Text(session.message)),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: session.busy ? null : session.enroll,
            child: const Text('Enroll or renew proof'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      );
    },
  );
}

class DownloadsPanel extends StatefulWidget {
  const DownloadsPanel({
    super.key,
    required this.session,
    this.initialAddress = '',
  });
  final Session session;
  final String initialAddress;

  @override
  State<DownloadsPanel> createState() => _DownloadsPanelState();
}

class _DownloadsPanelState extends State<DownloadsPanel> {
  late final _address = TextEditingController(text: widget.initialAddress);
  late Future<List<File>> _files = savedDownloads(widget.session);
  String _status = '';
  bool _busy = false;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _status = 'Checking URL policy and saving the file…';
    });
    File? saved;
    String? failure;
    try {
      saved = await saveFileDownload(widget.session, _address.text);
    } on DownloadFailure catch (error) {
      failure = error.message;
    } on Exception {
      // The destination and any transport errors can contain private data.
      failure = 'Download unavailable.';
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = failure ?? 'Saved ${saved!.uri.pathSegments.last}.';
      if (saved != null) _files = savedDownloads(widget.session);
    });
  }

  Future<void> _share(File file) async {
    setState(() => _busy = true);
    try {
      await shareSavedDownload(widget.session, file);
    } on Exception {
      if (mounted) setState(() => _status = 'Could not share this file.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Downloads'),
    scrollable: true,
    content: SizedBox(
      width: 420,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Save a direct HTTPS image, PDF, video, audio file, or text file. Share a saved copy using the Android chooser.',
          ),
          TextField(
            controller: _address,
            enabled: !_busy,
            decoration: const InputDecoration(
              labelText: 'HTTPS download address',
            ),
            keyboardType: TextInputType.url,
            autocorrect: false,
            enableSuggestions: false,
          ),
          if (_status.isNotEmpty)
            Semantics(liveRegion: true, child: Text(_status)),
          FutureBuilder<List<File>>(
            future: _files,
            builder: (context, snapshot) => Column(
              children: [
                if (snapshot.hasError) const Text('Saved files unavailable.'),
                for (final file in (snapshot.data ?? <File>[]).take(50))
                  ListTile(
                    title: Text(file.uri.pathSegments.last),
                    trailing: PopupMenuButton<String>(
                      tooltip: 'Saved file actions',
                      enabled: !_busy,
                      itemBuilder: (_) => const [
                        PopupMenuItem(
                          value: 'share',
                          child: Text('Share copy…'),
                        ),
                        PopupMenuItem(
                          value: 'delete',
                          child: Text('Delete copy'),
                        ),
                      ],
                      onSelected: (action) async {
                        if (action == 'share') {
                          await _share(file);
                          return;
                        }
                        try {
                          await file.delete();
                          if (mounted) {
                            setState(() {
                              _files = savedDownloads(widget.session);
                            });
                          }
                        } on Exception {
                          if (mounted) {
                            setState(() {
                              _status = 'Could not delete the file.';
                            });
                          }
                        }
                      },
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : _save,
        child: Text(_busy ? 'Working…' : 'Save file'),
      ),
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    ],
  );
}
