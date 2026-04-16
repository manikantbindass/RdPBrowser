import 'package:flutter/material.dart';

class VpnGuardScreen extends StatefulWidget {
  final Future<bool> Function() onRetry;
  const VpnGuardScreen({super.key, required this.onRetry});

  @override
  State<VpnGuardScreen> createState() => _VpnGuardScreenState();
}

class _VpnGuardScreenState extends State<VpnGuardScreen> {
  bool _retrying = false;

  Future<void> _handleRetry() async {
    setState(() => _retrying = true);
    await widget.onRetry();
    if (mounted) setState(() => _retrying = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0D14),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('🔒', style: TextStyle(fontSize: 72)),
                const SizedBox(height: 24),
                const Text('Secure Tunnel Required',
                  style: TextStyle(color: Color(0xFFEF4444), fontSize: 22, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center),
                const SizedBox(height: 12),
                const Text(
                  'RemoteShield X requires an active WireGuard VPN connection to operate.',
                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444).withOpacity(0.06),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFEF4444).withOpacity(0.2)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text('To connect:', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      SizedBox(height: 12),
                      _Step(n: '1', text: 'Open the WireGuard app'),
                      _Step(n: '2', text: 'Activate the RemoteShield-X tunnel'),
                      _Step(n: '3', text: 'Wait for "Active" status'),
                      _Step(n: '4', text: 'Tap Retry below'),
                    ],
                  ),
                ),
                const SizedBox(height: 28),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton.icon(
                    onPressed: _retrying ? null : _handleRetry,
                    icon: _retrying
                      ? const SizedBox(width: 16, height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.refresh),
                    label: Text(_retrying ? 'Checking...' : 'Retry Connection',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF6366F1),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'All access is blocked without VPN.\nThis protects your organization\'s data.',
                  style: TextStyle(color: Color(0xFF475569), fontSize: 11),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  final String n, text;
  const _Step({required this.n, required this.text});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(children: [
      Container(width: 22, height: 22,
        decoration: BoxDecoration(color: const Color(0xFF6366F1).withOpacity(0.2),
          shape: BoxShape.circle),
        alignment: Alignment.center,
        child: Text(n, style: const TextStyle(color: Color(0xFF6366F1), fontSize: 11, fontWeight: FontWeight.bold))),
      const SizedBox(width: 10),
      Text(text, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
    ]),
  );
}
