import 'package:flutter/material.dart';

import '../services/session.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session});
  final Session session;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _organization = TextEditingController();
  bool _obscure = true;

  Future<void> _signIn() async {
    if (widget.session.busy || !_form.currentState!.validate()) return;
    final password = _password.text;
    _password.clear();
    await widget.session.signIn(
      _username.text.trim(),
      password,
      _organization.text.trim(),
    );
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _organization.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Form(
                    key: _form,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          size: 42,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'RemoteShield X',
                          style: theme.textTheme.headlineSmall,
                        ),
                        const Text('Sign in to your organization browser.'),
                        const SizedBox(height: 24),
                        TextFormField(
                          controller: _username,
                          decoration: const InputDecoration(
                            labelText: 'Username',
                          ),
                          autocorrect: false,
                          enableSuggestions: false,
                          textInputAction: TextInputAction.next,
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Enter your username.'
                              : null,
                        ),
                        TextFormField(
                          controller: _password,
                          decoration: InputDecoration(
                            labelText: 'Password',
                            suffixIcon: IconButton(
                              tooltip: _obscure
                                  ? 'Show password'
                                  : 'Hide password',
                              onPressed: () =>
                                  setState(() => _obscure = !_obscure),
                              icon: Icon(
                                _obscure
                                    ? Icons.visibility
                                    : Icons.visibility_off,
                              ),
                            ),
                          ),
                          autocorrect: false,
                          enableSuggestions: false,
                          obscureText: _obscure,
                          validator: (value) => value == null || value.isEmpty
                              ? 'Enter your password.'
                              : null,
                          onFieldSubmitted: (_) => _signIn(),
                        ),
                        TextFormField(
                          controller: _organization,
                          decoration: const InputDecoration(
                            labelText: 'Organization ID (optional)',
                          ),
                          autocorrect: false,
                          enableSuggestions: false,
                          validator: (value) =>
                              value != null &&
                                  value.trim().isNotEmpty &&
                                  !RegExp(
                                    r'^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$',
                                  ).hasMatch(value.trim())
                              ? 'Enter a valid organization ID.'
                              : null,
                        ),
                        const SizedBox(height: 16),
                        if (widget.session.message.isNotEmpty)
                          Semantics(
                            liveRegion: true,
                            child: Text(widget.session.message),
                          ),
                        FilledButton(
                          onPressed: widget.session.busy ? null : _signIn,
                          child: Text(
                            widget.session.busy ? 'Signing in…' : 'Sign in',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
