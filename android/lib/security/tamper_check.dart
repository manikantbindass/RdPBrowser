import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';

class TamperResult {
  final bool isCompromised;
  final String reason;
  const TamperResult({required this.isCompromised, required this.reason});
}

class TamperCheck {
  static const _channel = MethodChannel('com.remoteshieldx/security');

  /// Run all tamper detection checks sequentially.
  /// Returns on first detected compromise.
  static Future<TamperResult> runAllChecks() async {
    // 1. Root / Jailbreak detection (Natively handled via MethodChannel if present)
    try {
      final isJailbroken = await _channel.invokeMethod<bool>('isRooted') ?? false;
      if (isJailbroken) {
        await _reportIncident('root_detected');
        return const TamperResult(
          isCompromised: true,
          reason: 'Rooted device detected. RemoteShield X cannot run on rooted devices for security compliance.',
        );
      }
    } catch (_) {}

    // 2. Developer options / Debug mode detection
    try {
      final isDebug = await _channel.invokeMethod<bool>('isDeveloperMode') ?? false;
      if (isDebug) {
        await _reportIncident('developer_mode');
        return const TamperResult(
          isCompromised: true,
          reason: 'Developer mode is enabled. Please disable it to use RemoteShield X.',
        );
      }
    } catch (_) {}

    // 3. Debugger attached detection
    try {
      final debuggerAttached = await _channel.invokeMethod<bool>('isDebuggerAttached') ?? false;
      if (debuggerAttached) {
        await _reportIncident('debugger_attached');
        return const TamperResult(
          isCompromised: true,
          reason: 'Debugging attempt detected. This incident has been reported.',
        );
      }
    } catch (_) {}

    // 4. App signature verification (prevent APK modification)
    try {
      final signatureValid = await _channel.invokeMethod<bool>('verifySignature') ?? true;
      if (!signatureValid) {
        await _reportIncident('signature_mismatch');
        return const TamperResult(
          isCompromised: true,
          reason: 'App signature mismatch. This APK may have been tampered with.',
        );
      }
    } catch (_) {}

    // 5. Emulator detection (optional — disable in dev)
    try {
      final isEmulator = await _channel.invokeMethod<bool>('isEmulator') ?? false;
      const allowEmulator = bool.fromEnvironment('ALLOW_EMULATOR', defaultValue: false);
      if (isEmulator && !allowEmulator) {
        return const TamperResult(
          isCompromised: true,
          reason: 'Emulator environment detected. RemoteShield X requires a physical device.',
        );
      }
    } catch (_) {}

    return const TamperResult(isCompromised: false, reason: '');
  }

  /// Hash a file for integrity comparison
  static Future<String> hashFile(String path) async {
    final file = File(path);
    final bytes = await file.readAsBytes();
    return sha256.convert(bytes).toString();
  }

  static Future<void> _reportIncident(String type) async {
    try {
      await _channel.invokeMethod('reportSecurityIncident', {'type': type});
    } catch (_) {}
  }
}
