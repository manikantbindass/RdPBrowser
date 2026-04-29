import 'package:webview_flutter/webview_flutter.dart';

class BrowserTab {
  final String id;
  String url;
  String title;
  WebViewController controller;
  bool loading;
  bool blocked;
  String blockedMsg;
  double loadProgress;
  bool isIncognito;
  DateTime? createdAt;

  BrowserTab({
    required this.id,
    required this.url,
    this.title = 'New Tab',
    required this.controller,
    this.loading = false,
    this.blocked = false,
    this.blockedMsg = '',
    this.loadProgress = 0.0,
    this.isIncognito = false,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'id': id,
        'url': url,
        'title': title,
        'isIncognito': isIncognito,
        'createdAt': createdAt?.toIso8601String(),
      };

  factory BrowserTab.fromJson(Map<String, dynamic> json, WebViewController controller) {
    return BrowserTab(
      id: json['id'],
      url: json['url'],
      title: json['title'] ?? 'New Tab',
      controller: controller,
      isIncognito: json['isIncognito'] ?? false,
      createdAt: json['createdAt'] != null ? DateTime.parse(json['createdAt']) : null,
    );
  }
}
