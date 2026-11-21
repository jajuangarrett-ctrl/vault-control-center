# Synthetic HTML catalog integration fixture

Run from the Vault Control Center checkout (with npm dependencies installed), with a local HTML Viewer 0.2.3+ source checkout:

```sh
node tests/html-catalog-browser/build.mjs /path/to/html-viewer /tmp/vcc-catalog-browser
python3 -m http.server 8771 --bind 127.0.0.1 --directory /tmp/vcc-catalog-browser
```

Open the loopback page. It bundles the **real** HTML Viewer catalog service, VCC catalog feed and VCC card renderer against an in-memory Obsidian API fixture, with restrictive no-network CSP. No real vault, device or website is used.

1. Fold to one compact column; the first card displays a local test PNG, the second shows a placeholder. Unfold to wider multi-column cards with no duplicate scan.
2. Find the second page via Next or type `checklist` into Search catalog. Tapping its .htm card passes its exact path to the fixture opener.
3. Exclude the first page in Viewer and confirm its card and image disappear. Disable Viewer and confirm no fallback cards. Re-enable and confirm the exclusion remains. The VCC scan counter should stay zero.
4. The disguised text document, .txt document and pre-excluded page do not appear. No embedded HTML frames or remote image are created.
