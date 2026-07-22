# Vendored third-party runtime libraries

These files are **self-hosted on purpose**. The app's HTML entry points
(`index.html`, `draft-warroom.html`, `free-agency.html`, `trade-calculator.html`)
load React and ReactDOM from here via same-origin `<script src="vendor/…">` tags
instead of a public CDN.

## Why

React/ReactDOM were previously loaded from `unpkg.com` with no fallback. When
unpkg had a transient hiccup, React never defined, every component threw
"React is not defined", and the app rendered a blank screen. Serving these
same-origin removes that single point of failure: if the page itself loads,
React loads with it.

## Files

| File | Package | Version |
|------|---------|---------|
| `react.production.min.js`     | `react`     | 18.3.1 |
| `react-dom.production.min.js` | `react-dom` | 18.3.1 |

These are the official UMD production builds (unmodified).

## How to update

Re-download the UMD builds for the new version and replace the files in place
(keep the same filenames — the deploy build cache-busts them automatically via a
content-hash `?v=` query, so no manual version bump in the HTML is needed):

```sh
curl -sS -o vendor/react.production.min.js \
  https://unpkg.com/react@<version>/umd/react.production.min.js
curl -sS -o vendor/react-dom.production.min.js \
  https://unpkg.com/react-dom@<version>/umd/react-dom.production.min.js
```

Then run `npm test` (the regression suite builds the production preview and
boots it headless) before deploying.
