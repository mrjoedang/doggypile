# Playwriter smoke test

Prerequisites: serve `web/` at the target URL and connect Playwriter to a browser tab. The script creates and retains its own page in `state.page`; it never closes the page, context, or browser.

```sh
# From the repository root (default mock URL)
bunx playwriter@latest -s SESSION -f "$(pwd)/scripts/playwriter-smoke.mjs"

# Optional URL/viewport scenario; two machines gives the chooser more coverage
BASE_URL='http://127.0.0.1:8123/?mock&machines=2' \
  bunx playwriter@latest -s SESSION -f "$(pwd)/scripts/playwriter-smoke.mjs"
```

`BASE_URL` defaults to `http://127.0.0.1:8123/?mock`. Output is one structured JSON result containing checks, observations, captured browser errors, timestamps, and failure details. Context and desktop tab checks are reported as skipped when the current viewport does not expose those controls.
