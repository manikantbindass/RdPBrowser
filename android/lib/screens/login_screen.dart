import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

const _serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'https://YOUR_SERVER_STATIC_IP');

class LoginScreen extends StatefulWidget {
  final void Function(String token) onLogin;
  const LoginScreen({super.key, required this.onLogin});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _usernameCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _loading = false;
  String _error = '';
  bool _obscure = true;

  Future<void> _login() async {
    final username = _usernameCtrl.text.trim();
    final password = _passwordCtrl.text.trim();
    if (username.isEmpty || password.isEmpty) {
      setState(() => _error = 'Please enter username and password');
      return;
    }
    setState(() { _loading = true; _error = ''; });

    try {
      final res = await http.post(
        Uri.parse('$_serverUrl/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'username': username, 'password': password, 'deviceOs': 'android'}),
      ).timeout(const Duration(seconds: 10));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        widget.onLogin(data['accessToken']);
      } else {
        setState(() => _error = data['error'] ?? 'Login failed');
      }
    } catch (_) {
      setState(() => _error = 'Cannot reach server. Is VPN active?');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0D14),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              padding: const EdgeInsets.all(32),
              decoration: BoxDecoration(
                color: const Color(0xFF111827),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.08)),
                boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.5), blurRadius: 40)],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('🛡️', style: TextStyle(fontSize: 52)),
                  const SizedBox(height: 16),
                  const Text('RemoteShield X',
                    style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('Secure Remote Work Browser',
                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                  const SizedBox(height: 32),

                  _InputField(controller: _usernameCtrl, label: 'Username', hint: 'Enter username', icon: Icons.person),
                  const SizedBox(height: 16),
                  _InputField(
                    controller: _passwordCtrl, label: 'Password', hint: 'Enter password',
                    icon: Icons.lock, obscure: _obscure,
                    suffix: IconButton(
                      icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off,
                        color: const Color(0xFF94A3B8), size: 18),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),

                  if (_error.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEF4444).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFFEF4444).withOpacity(0.3)),
                      ),
                      child: Row(children: [
                        const Icon(Icons.warning_amber, color: Color(0xFFEF4444), size: 16),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_error,
                          style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13))),
                      ]),
                    ),
                  ],

                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: ElevatedButton.icon(
                      onPressed: _loading ? null : _login,
                      icon: _loading
                        ? const SizedBox(width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.lock, size: 18),
                      label: Text(_loading ? 'Authenticating...' : 'Sign In Securely',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF6366F1),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),

                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFF22C55E).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.circle, color: Color(0xFF22C55E), size: 8),
                      SizedBox(width: 6),
                      Text('VPN Connected', style: TextStyle(color: Color(0xFF22C55E), fontSize: 12, fontWeight: FontWeight.w600)),
                    ]),
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

class _InputField extends StatelessWidget {
  final TextEditingController controller;
  final String label, hint;
  final IconData icon;
  final bool obscure;
  final Widget? suffix;
  const _InputField({required this.controller, required this.label,
    required this.hint, required this.icon, this.obscure = false, this.suffix});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w500)),
      const SizedBox(height: 6),
      TextField(
        controller: controller,
        obscureText: obscure,
        style: const TextStyle(color: Colors.white, fontSize: 14),
        decoration: InputDecoration(
          hintText: hint, hintStyle: const TextStyle(color: Color(0xFF475569)),
          prefixIcon: Icon(icon, color: const Color(0xFF94A3B8), size: 18),
          suffixIcon: suffix,
          filled: true, fillColor: Colors.white.withOpacity(0.05),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: Colors.white.withOpacity(0.1))),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: Colors.white.withOpacity(0.08))),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFF6366F1), width: 1.5)),
        ),
      ),
    ],
  );
}
