class HistoryEntry {
  final String id;
  final String url;
  final String title;
  final DateTime visitedAt;
  int visitCount;

  HistoryEntry({
    required this.id,
    required this.url,
    required this.title,
    required this.visitedAt,
    this.visitCount = 1,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'url': url,
        'title': title,
        'visitedAt': visitedAt.toIso8601String(),
        'visitCount': visitCount,
      };

  factory HistoryEntry.fromJson(Map<String, dynamic> json) {
    return HistoryEntry(
      id: json['id'],
      url: json['url'],
      title: json['title'] ?? '',
      visitedAt: DateTime.parse(json['visitedAt']),
      visitCount: json['visitCount'] ?? 1,
    );
  }
}
