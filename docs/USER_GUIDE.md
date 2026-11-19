# User guide

Your administrator provides the approved application, server origin, organization ID, account details and WireGuard enrollment. Before signing in, connect through the managed VPN profile and confirm the destination hostname and certificate. The preview builds use a reserved test origin and an Android verification key.

## Desktop

1. Sign in with the assigned account. Provide the organization UUID when requested.
2. Open Devices to register your desktop session if policy requires it. Request administrator approval when the application displays that state.
3. Enter an HTTP(S) address in the main address bar. Tabs, bookmarks and recent history belong to the application profile and signed-in user. Reopening a saved URL requires fresh authorization.
4. Use Ctrl or Command with L for the address bar, T for a new tab and W to close a tab. The shell offers light, dark and reduced-motion settings.
5. The explicit Downloads panel can save approved direct HTTPS plain-text responses up to 5 MiB. Treat saved files as untrusted. Automatic WebView downloads, authenticated file transfer and executable downloads are outside this supported path.

The desktop runs the organization's native WebView rules. A network error can close managed tabs until the configured route and session checks pass again. [Desktop build and test scope](TESTING.md)

## Android

1. Use the organization's WireGuard profile and approved Android Always-on VPN and lockdown policy. The browser opens Android VPN settings when network checks fail.
2. Sign in, enroll the device and wait for administrator approval where required. The app can prove it holds the enrolled Keystore key.
3. Open approved pages in the managed browser. Backgrounding or a network change can invalidate the active view. Resume with the VPN connected and wait for refreshed checks.
4. Use the app's diagnostics when sign-in, policy or network access fails. A failed single-use refresh can require a fresh sign-in.

Secure-window restrictions can affect screenshots and sharing. Android work-profile policy applies within its managed scope. The project has verified Android 16/API 36 in an emulator, with physical profile and VPN acceptance still pending. [Android build and test scope](TESTING.md)

## Sign out or report a problem

Use Sign out before handing a device or workstation to someone else. If a device is lost, report the organization, device label, approximate time and affected session to the administrator. Include the request ID if available. Keep passwords, codes, keys and browsing data private. [Troubleshooting](TROUBLESHOOTING.md)
