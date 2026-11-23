# Synthetic Mail Cache Bridge dashboard fixture

Run from the Vault Control Center checkout with npm dependencies installed:

```sh
node tests/mail-cache-bridge-browser/build.mjs /tmp/vcc-mail-bridge-browser
node tests/mail-cache-bridge-browser/check.mjs /path/to/chromium-or-chrome-headless-shell /tmp/vcc-mail-bridge-browser
```

The fixture runs the real **Automations** route renderer with an in-memory status provider, a temporary browser profile and no network. The browser drives a trusted click, checks that a scripted click and repeat click do not dispatch, and distinguishes requested, acknowledged/syncing, completed and stale status. It verifies the display at desktop, 375px compact and 756px unfolded mobile widths. No real Obsidian vault, Mail messages, bridge data or profile is used.
