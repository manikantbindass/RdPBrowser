class Bookmark {
  final String id;
  final String title;
  final String url;
  final String? favicon;
  final DateTime timestamp;
  final String? folder;

  const Bookmark({
    required this.id,
    required this.title,
    required this.url,
    this.favicon,
    required this.timestamp,
    this.folder,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'url': url,
        'favicon': favicon,
        'timestamp': timestamp.toIso8601String(),
        'folder': folder,
      };

  factory Bookmark.fromJson(Map<String, dynamic> json) {
    return Bookmark(
      id: json['id'],
      title: json['title'] ?? '',
      url: json['url'],
      favicon: json['favicon'],
      timestamp: DateTime.parse(json['timestamp']),
      folder: json['folder'],
    );
  }
}
