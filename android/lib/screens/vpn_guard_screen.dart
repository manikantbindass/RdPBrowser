import 'package:flutter/material.dart';

import '../services/session.dart';

class VpnGuardScreen extends StatelessWidget {
  const VpnGuardScreen({super.key, required this.session});
  final Session session;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Managed VPN')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.vpn_lock_outlined, size: 48),
                  const SizedBox(height: 16),
                  Text(
                    'Connect your organization VPN',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Use the WireGuard profile supplied by your administrator. '
                    'In Android VPN settings, enable Always-on VPN and Block connections without VPN.',
                  ),
                  const SizedBox(height: 12),
                  Semantics(liveRegion: true, child: Text(session.message)),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      try {
                        await session.platform.openVpnSettings();
                      } on Exception {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Open VPN settings manually.'),
                            ),
                          );
                        }
                      }
                    },
                    child: const Text('Open Android VPN settings'),
                  ),
                  OutlinedButton(
                    onPressed: () => session.check(),
                    child: const Text('Check connection'),
                  ),
                  if (session.signedIn)
                    TextButton(
                      onPressed: session.signOut,
                      child: const Text('Sign out'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
