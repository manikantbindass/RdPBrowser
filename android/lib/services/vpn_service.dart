import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum VpnState { disconnected, connecting, connected, error }

class VpnService extends ChangeNotifier {
  static const _channel = MethodChannel('com.remoteshieldx/vpn');
  static const _eventChannel = EventChannel('com.remoteshieldx/vpn_events');

  VpnState _state = VpnState.disconnected;
  String _serverIp = '';
  int _bytesIn = 0;
  int _bytesOut = 0;
  StreamSubscription? _eventSub;

  VpnState get state => _state;
  bool get isConnected => _state == VpnState.connected;
  String get serverIp => _serverIp;
  int get bytesIn => _bytesIn;
  int get bytesOut => _bytesOut;

  VpnService() {
    _listenToVpnEvents();
    _checkInitialState();
  }

  Future<void> _checkInitialState() async {
    try {
      final connected = await _channel.invokeMethod<bool>('isVpnConnected') ?? false;
      _state = connected ? VpnState.connected : VpnState.disconnected;
      notifyListeners();
    } catch (_) {}
  }

  void _listenToVpnEvents() {
    _eventSub = _eventChannel.receiveBroadcastStream().listen(
      (event) {
        if (event is Map) {
          final status = event['status'] as String? ?? '';
          _serverIp = event['serverIp'] as String? ?? '';
          _bytesIn = event['bytesIn'] as int? ?? 0;
          _bytesOut = event['bytesOut'] as int? ?? 0;

          switch (status) {
            case 'CONNECTED':
              _state = VpnState.connected;
            case 'DISCONNECTED':
              _state = VpnState.disconnected;
            case 'CONNECTING':
              _state = VpnState.connecting;
            default:
              _state = VpnState.error;
          }
          notifyListeners();
        }
      },
      onError: (_) {
        _state = VpnState.error;
        notifyListeners();
      },
    );
  }

  Future<bool> connect() async {
    try {
      _state = VpnState.connecting;
      notifyListeners();
      final result = await _channel.invokeMethod<bool>('startVpn') ?? false;
      if (!result) {
        _state = VpnState.error;
        notifyListeners();
      }
      return result;
    } on PlatformException catch (_) {
      _state = VpnState.error;
      notifyListeners();
      return false;
    }
  }

  Future<void> disconnect() async {
    try {
      await _channel.invokeMethod('stopVpn');
      _state = VpnState.disconnected;
      notifyListeners();
    } catch (_) {}
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    super.dispose();
  }
}
