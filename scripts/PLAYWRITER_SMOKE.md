# Playwriter smoke test

Prerequisites: serve `web/` at the target URL and connect Playwriter to a browser tab. The script creates and retains its own page in `state.page`; it never closes the page, context, or browser.

```sh
SESSION=$(bunx playwriter@latest session new | sed -n 's/^Session \([0-9][0-9]*\) created.*/\1/p')

# From the repository root (default mock URL)
bunx playwriter@latest -s "$SESSION" --timeout 90000 \
  -f "$(pwd)/scripts/playwriter-smoke.mjs"

# Optional two-machine scenario for chooser coverage
bunx playwriter@latest -s "$SESSION" -e \
  'state.baseUrl = "http://127.0.0.1:8123/?mock&machines=2"'
bunx playwriter@latest -s "$SESSION" --timeout 90000 \
  -f "$(pwd)/scripts/playwriter-smoke.mjs"
```

The URL defaults to `http://127.0.0.1:8123/?mock`; set `state.baseUrl` in the same Playwriter session to override it. Output is one structured JSON result containing checks, observations, captured browser errors, timestamps, and failure details. Context and desktop tab checks are reported as skipped when the viewport does not expose those controls.
