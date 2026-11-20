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
  const DownloadsPanel({super.key, required this.session});
  final Session session;

  @override
  State<DownloadsPanel> createState() => _DownloadsPanelState();
}

class _DownloadsPanelState extends State<DownloadsPanel> {
  final _address = TextEditingController();
  late Future<List<File>> _files = savedDownloads(widget.session);
  String _status = '';
  bool _busy = false;

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _status = '';
    });
    var saved = false;
    try {
      await saveTextDownload(widget.session, _address.text);
      saved = true;
    } on Exception {
      // The destination and any transport errors can contain private data.
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = saved
          ? 'Saved in app storage.'
          : 'Download denied or unavailable.';
      if (saved) _files = savedDownloads(widget.session);
    });
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
          const Text('Save a direct HTTPS plain-text response up to 5 MiB.'),
          TextField(
            controller: _address,
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
                    trailing: IconButton(
                      tooltip: 'Delete download',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () async {
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
        child: Text(_busy ? 'Savingâ€¦' : 'Save text'),
      ),
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    ],
  );
}
