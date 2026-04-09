# Doc Analyzer — inference-relay Reference Example

A complete working app demonstrating all three integration levels of `inference-relay` with real API calls, real documents, and side-by-side cost comparison.

## What This Demonstrates

Each integration level runs through a different server-side route, so you can switch between them and see the exact code path that powers your call:

| Level | Route | Pattern | Comparison Mode |
|-------|-------|---------|-----------------|
| **L1 Auto-Patch** | `/api/analyze-autopatch/route.ts` | `import 'inference-relay/auto'` then `new Anthropic()` | No (global SDK patch) |
| **L2 Explicit** | `/api/analyze/route.ts` | `new InferenceRelay()` + plain `new Anthropic()` | **Yes** (two clients coexist) |
| **L3 Env Var** | `/api/analyze-envvar/route.ts` | `if (process.env.INFERENCE_RELAY_ENABLED) { relay } else { sdk }` | No (process-global) |

## Setup

```bash
cp .env.local.example .env.local
# Fill in IR_LICENSE_KEY and ANTHROPIC_API_KEY
pnpm install
pnpm dev
```

Open http://localhost:3100

## Test Protocol

### Test 1 — L2 Explicit (default)
1. Click **LOAD SAMPLE**
2. Click **ANALYZE**
3. Verify: Phase 1 triage (Haiku) and Phase 2 extraction (Sonnet) both complete via the relay
4. Cost: $0.00 for both phases (routed to user subscription)
5. Provider: NATIVE_GW

### Test 2 — L1 Auto-Patch ("The Invisible Hand")
1. Click **L1 AUTO-PATCH** button
2. Mode toggle locks to RELAY ONLY (comparison disabled)
3. Click **RESET**, **LOAD SAMPLE**, **ANALYZE**
4. Verify: Gateway Log shows `inference-relay auto-patch active — routing through user subscription.`
5. **Inspect the source**: Open `src/app/api/analyze-autopatch/route.ts`. Notice it has only `import 'inference-relay/auto'` and `new Anthropic()` — there is NO `InferenceRelay` instance anywhere. The one import line activates the Native Gateway.
6. After running this test, an orange warning banner appears at the top.

### Test 3 — Manual Server Restart (required after L1)
Auto-patch is process-global. Once L1 has been loaded in the dev server, even L2's "direct" client is routed through the Native Gateway. To test L2 comparison mode with a clean process:

1. Stop the dev server: **Ctrl+C** in the terminal
2. Restart: `pnpm dev`
3. Refresh http://localhost:3100
4. The warning banner is gone — process is fresh

### Test 4 — L2 Comparison Mode
1. Select **L2 EXPLICIT** (default)
2. Toggle to **COMPARISON**
3. Click **LOAD SAMPLE**, **ANALYZE**
4. Accept the cost warning (~$0.02 for sample doc)
5. Verify: Side-by-side panels stream simultaneously
   - LEFT (DIRECT API): real cost via plain Anthropic SDK
   - RIGHT (WITH RELAY): $0.00 via NATIVE_GW
6. Cost Comparison table appears at the bottom with savings %

### Test 5 — L3 Env Var
1. Select **L3 ENV VAR**
2. Verify: `INFERENCE_RELAY_ENABLED=true` shown
3. Click **RESET**, **LOAD SAMPLE**, **ANALYZE**
4. Verify: Works via relay (env var triggers explicit relay path in the route)
5. **Inspect the source**: Open `src/app/api/analyze-envvar/route.ts`. Notice the conditional `if (process.env.INFERENCE_RELAY_ENABLED === 'true')` — application-level feature flagging.

### Test 6 — Direct Only Mode
1. Select **L2 EXPLICIT**, toggle to **DIRECT ONLY**
2. Click **RESET**, **LOAD SAMPLE**, **ANALYZE**
3. Verify: Real API cost (~$0.02 for sample), provider = API_PROVIDER
4. This proves the comparison is honest — when the relay is bypassed, you actually pay.

### Test 7 — File Upload (.txt, .md, .pdf)
1. Click **RESET**
2. **UPLOAD FILE** or drag-and-drop a `.txt`, `.md`, or `.pdf` file onto the textarea
3. For PDFs, you'll briefly see "EXTRACTING PDF..." while text is extracted in-browser
4. **ANALYZE** to process

PDF parsing runs entirely client-side via `pdfjs-dist` — the PDF binary never leaves your browser before extraction. Only the extracted text is sent to the API.

### Test 8 — Model Selector
1. Change P1 MODEL and P2 MODEL via dropdowns
2. Run analysis
3. Verify: Selected models appear in the Gateway Log phase entries

### Test 9 — Dashboard Integration
1. After running an analysis, open https://inference-relay.com/dashboard/usage
2. Verify: New events appear with correct provider, cost, latency
3. Verify: Usage gauge updates

### Test 10 — Black Box Verification
1. Open Chrome DevTools → Network tab
2. Run an analysis, click `/api/analyze` request
3. Verify: SSE stream shows normalized events (`stream_init`, `text`, `stream_end`, `metadata`) — NOT raw Anthropic protocol names

## Architecture

```
src/
├── app/
│   ├── page.tsx                      # Main UI (level picker, mode toggle, results)
│   └── api/
│       ├── analyze/route.ts          # L2 — Explicit (supports comparison)
│       ├── analyze-autopatch/route.ts # L1 — Auto-patch
│       ├── analyze-envvar/route.ts   # L3 — Env var
│       └── status/route.ts           # Auto-patch state check
└── lib/
    ├── analyze.ts                    # Model pricing, helpers
    ├── clients.ts                    # L2 dual-client (direct + relay)
    ├── shared-handler.ts             # DRY streaming/SSE logic
    └── patch-state.ts                # Tracks if auto-patch was loaded
```

## Troubleshooting

**`inference-relay: license key missing — set IR_LICENSE_KEY`**
Your `IR_LICENSE_KEY` is not set in `.env.local`. Copy `.env.local.example` to `.env.local` and fill in your key from https://inference-relay.com/pricing.

**`inference-relay: license key invalid`**
Your license key is invalid or has been revoked. Get a fresh key from your dashboard.

**`inference-relay: gateway not available`**
The Claude CLI is not installed or not authenticated on this machine. Install Claude Code, run `claude` once to sign in, then re-run.

**`inference-relay: network error reaching the protocol authority`**
inference-relay can't reach its server. Check your internet connection and any corporate proxy.

**Auto-patch banner won't go away after restart**
The state is stored in `localStorage`. Open DevTools → Application → Local Storage → `http://localhost:3100` → delete the `autopatchLoaded` key, then reload.

**PDF extraction fails**
Verify the PDF worker files exist in `public/`: `pdf.min.mjs` and `pdf.worker.min.mjs`. They are auto-copied on `pnpm install` via the postinstall script. If missing, run `pnpm install` again.

**Port 3100 already in use**
Another process is bound to 3100. Either kill it (`lsof -ti:3100 | xargs kill`) or change the port in `package.json` scripts.

## Requirements

- Node.js 18+
- pnpm 9+
- An `IR_LICENSE_KEY` from https://inference-relay.com/pricing
- An `ANTHROPIC_API_KEY` from https://console.anthropic.com

## Privacy

Document content is processed entirely server-side and never persists. The relay uses a Dumb Pipe architecture — content does not transit any management plane.
