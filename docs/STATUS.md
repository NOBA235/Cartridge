# Cartridge status

Last updated: 2026-11-16 (Phase 3).

## Phase checklist

- [x] Phase 0: Scaffold, guardrails, hybrid plumbing (one item open: a real cloud call, see below)
- [x] Phase 1: Source ingestion and quote verification
- [x] Phase 2: Cloud compiler and card viewer (one item open: a real compile, see below)
- [x] Phase 3: Ask engine, router, validators, offline queue (real device and real cloud not yet run)
- [ ] Phase 4: Exam Day (needs a real device)
- [ ] Phase 5: Versions and proposed rules
- [ ] Phase 6: Product polish and demo mode
- [ ] Phase 7: Hardening and submission readiness
- [ ] Phase 8 (optional, gated): Blueprint canvas

### Phase 0 acceptance

- [x] `npm test` passes (typecheck, unit tests, type tests)
- [x] `npm run dev` starts and serves `/` and `/dev`
- [ ] `/dev` works: **Prepare this device** (real Gemini Nano) and **Ask cloud** (real call). Code
      done; needs a click-through in Chrome. Asking the device moved to the Ask screen, because it
      needs the rules of a real cartridge.
- [ ] A real cloud call works with real Firebase config. `npm run smoke:cloud` history:
  - 2026-11-16, first run: "requires the Firebase AI API ('firebasevertexai.googleapis.com') to be enabled".
  - 2026-11-16, after the owner enabled AI Logic (Gemini Developer API): the API is now reached and
    answers `401 Firebase App Check token is invalid`. Expected, because the run used a throwaway
    unregistered token. Remaining step: register a debug token and put it in
    `VITE_APPCHECK_DEBUG_TOKEN` in `.env.local`.
- [x] No secrets committed (scanned for API keys, private keys and debug-token UUIDs)

### Phase 1 acceptance

- [x] At least 15 quote-verification cases pass: 29 in `src/cartridge/verifyQuote.test.ts`
      (hyphenation, ligatures, curly quotes, dashes, whitespace, case, accents, not-found, near misses)
- [x] PDF text extraction with pdf.js in a Web Worker, keeping page numbers (tested with real
      pdf.js in Node, and in headless Chrome 157 on the production build)
- [x] Pasted text and .txt/.md files
- [x] Warning for PDFs with almost no text
- [x] Chunker: headings or pages, at most 30,000 characters, one paragraph of overlap, page ranges
- [x] idb stores: sources, cartridges, versions, queue, telemetry; SHA-256 source hash
- Demo source: dropped by the owner (see Decisions). Any rulebook the user loads is the source.

### Phase 2 acceptance

- [ ] Making a cartridge from a real public document works. Code and the `npm run smoke:compile`
      command are ready; blocked on the App Check debug token (same as Phase 0).
- [x] Every kept rule's quote verifies by construction: quotes are checked before a rule is kept,
      and checked again at the end (compile throws rather than return an unverified rule).
- [x] Tests for dedupe and ID assignment (`reduce.test.ts`, 11 tests)
- [x] Compile logic tested with a fake cloud (`compile.test.ts`, 24 tests; fake lives in the test only)
- [x] Progress UI ('Reading section N of M', 'Verified X of Y quotes'), left-out rules with reasons
- [x] Card viewer: search, severity chips, quote highlighted in source context, JSON export/import

### Phase 3 acceptance

- [x] 20 scripted questions give the expected routes (`ask.test.ts`), using the test-only stand-in
      device (results labelled 'mock'; this checks routing and validation, not Gemini Nano)
- [x] Offline queue test (`offlineQueue.test.ts`, 8 tests)
- [x] Validator and calc tests (`ask.test.ts`, `calc.test.ts`)
- [ ] A question answered by real Gemini Nano on a real device (needs desktop Chrome with Gemini Nano)
- [ ] A real cloud answer (needs the App Check debug token, same as Phase 0)

## Versions in use

firebase 13.3.0, react 19.3.1, vite 8.3.8, typescript 6.0.3, tailwindcss 4.3.5, vitest 5.1.0,
zod 4.6.7, motion 14.14.0, idb 8.0.4, minisearch 7.2.0, pdfjs-dist 6.5.438.

## Decisions

- **Owner decision, 2026-11-16: real product only, no mock or demo data.** This overrides parts of
  the brief:
  - The app always uses Gemini Nano through Firebase AI Logic. `VITE_MOCK_DEVICE` and
    `VITE_MOCK_ERROR_RATE` are gone. If Gemini Nano is unavailable the app says so, and the router
    escalates with `DEVICE_UNAVAILABLE` (cloud with a 'Cloud' badge, or the offline queue).
  - The mock device model and the invented sample rules moved to `src/testing/`, used only by
    automated tests (which cannot run Gemini Nano). ESLint fails if app code imports
    `src/testing` (checked by adding such an import). The production bundle contains neither.
  - The 'Mock device' route badge is removed.
  - No pre-loaded demo cartridge and no 'Try it now' button in Phase 6. Users load a rulebook
    and make the cartridge themselves. Consequence: a first-time user (or a judge) needs a
    network connection and some minutes for the cloud step and the Gemini Nano download before
    the Ask screen works. The brief's "demo can be completed without any manual setup" no longer
    applies as written.
  - Exam reports will always say `measuredOn: 'device'` in the app. The `'mock'` value remains in
    the data model only for test fixtures.
- **TypeScript 6.0, not 7.0.** typescript-eslint 8.72 supports TypeScript below 6.1 only.
- **shadcn/ui packages.** shadcn/ui components need `radix-ui`, `class-variance-authority`,
  `clsx` and `tailwind-merge`. Treated as part of shadcn/ui. `lucide-react` is not installed (no icons yet).
  Dev tooling added for ESLint and Prettier: `@eslint/js`, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `eslint-config-prettier`, `globals`. Tailwind's `@tailwindcss/vite`
  plugin, `@vitejs/plugin-react`, `@types/*`.
- **Cloud models** (in `src/config.ts`, checked on the Firebase Models page 2026-11-14):
  `gemini-3.8-flash` for compile, repair, exam and tutor; `gemini-3.5-flash-lite` for answers and the dev ping.
  Both are Stable with no shutdown date.
- **Gemini API provider: Gemini Developer API** (`GoogleAIBackend`), chosen by the owner in the
  console on 2026-11-16. No billing needed.
- **Cloud smoke test.** `npm run smoke:cloud` (`src/ai/cloud.smoke.ts`, Vitest `--mode smoke`) makes
  one real `DEV_PING` call through our `cloudJson` and Firebase AI Logic from Node, with App Check
  in debug mode. It is never part of `npm test`. It needs `VITE_APPCHECK_DEBUG_TOKEN` set to a
  registered token (Node has no IndexedDB to keep a generated one) and drops the SDK's console line
  that prints the token. It checks the cloud path only, not the browser UI.
- **App Check.** Dev builds always use the debug provider (`globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN`,
  which is `self` in browsers as in the docs, and also exists in Node).
  Production builds never do, and need `VITE_APPCHECK_SITE_KEY` (reCAPTCHA Enterprise).
  The debug token is read only inside an `import.meta.env.DEV` branch and env keys are listed one
  by one (never spread), so Vite cannot inline it into a production bundle. Verified: a production
  build with a canary token set contains no trace of it. In dev without a site key we pass a
  `CustomProvider` that always refuses: in debug mode the SDK exchanges the debug token and never
  asks the provider (checked in `@firebase/app-check` source).
- **On-device schema is plain JSON schema**, not `Schema.*().toJSON()`, because `toJSON` is internal
  to the SDK. The docs allow either form for `responseConstraint`.
- **Private/Public.** Runtime enforcement uses module-private WeakSets, so a hand-built object cast
  to `Public` is rejected. Only `declassify()` can produce `declassified:*` origins. Approvals are
  single-use and must match the value character for character. This guards against our own
  mistakes, not hostile code in the same page.
- **Router.** `USER_REQUESTED` escalations also respect 'Ask the cloud when needed'. The privacy
  text says questions go to the cloud only while that setting is on.
- **Egress log** is persisted in IndexedDB (telemetry store) since Phase 1 and survives reloads.
  Entries recorded before storage opens are renumbered after the stored ones. If IndexedDB fails,
  the log stays in memory and the panel says so. Failed cloud attempts still count their bytes.
- **Routing**: a tiny pathname router (`src/ui/router.ts`, no library) for `/`, `/load` and the
  hidden `/dev`. Firebase Hosting will need an SPA rewrite in Phase 7.
- **Quote normalisation** (`src/cartridge/normalize.ts`), applied to both sides: NFKC per grapheme
  cluster (so composed and decomposed accents match), join hyphen + line break between letters,
  drop soft hyphens and zero-width characters, lower case, expand æ/œ, unify quotes and dashes,
  collapse whitespace and drop it next to dashes ("a - b" = "a-b"). A match must start and end at
  word boundaries, so "5 litres" never verifies against "15 litres". One fallback: if the quote
  has a hyphenated word, both sides are compared again without hyphens between letters, for
  compounds the source split at a line end ("well-\nknown"). The result records which rule matched.
- **verifyQuote returns offsets into the original source text**, so the UI can highlight the
  passage as written, plus the page and the number of occurrences.
- **Source text and hash.** Line endings are unified to `\n` at ingest. PDF pages are joined with a
  blank line. `sourceHash` is SHA-256 of exactly the stored text that quotes are verified against.
  The source id is derived from the hash, so loading the same text twice keeps one copy.
- **Public by confirmation.** A loaded rulebook is saved only after the user names its licence and
  ticks "This is a public document, openly licensed or in the public domain. It is not my own
  private material." (`publicConfirmed`). Phase 2 must refuse to compile an unconfirmed source.
- **pdf.js legacy build.** The modern `pdf.worker.mjs` in 6.5.438 calls
  `Uint8Array.prototype.toHex()`, which Chrome has from version 140 (Baseline September 2025) and
  Node 24 lacks. We support Chrome 139, so we use `pdfjs-dist/legacy/build/*`, which polyfills it.
  pdf.js and its worker load on demand (separate chunks; the worker is 1.3 MB).
- **"In a Web Worker"**: parsing and text extraction run in pdf.js's own worker (seen as a
  `worker` target in headless Chrome). Our code only joins the text items per page.
- **PDF text assembly** (`src/cartridge/pdf/assemble.ts`): new line on `hasEOL` or a baseline
  move; blank line when the vertical gap is more than 1.6 line heights. Scanned warning when the
  average is under 50 visible characters per page, or half the pages have under 10.
- **Chunker**: markdown headings define sections when present, else PDF pages, else the whole
  text. Sections that fit are never split. Page markers `[p. N]` are counted in the 30,000 limit.
  Overlap is skipped if the previous paragraph is over a quarter of the limit.
  `stripPageMarkers()` exists for Phase 2, because a model may copy a marker into a quote.
- **File limit**: 50 MB per file (a guard against a frozen tab; Phase 7 revisits very large sources).
- **Making a cartridge (Phase 2)** (`src/cartridge/compile.ts`):
  - One COMPILE call per section, sequential (progress reads "Reading section N of M"; avoids
    rate limits). Each rule is checked with zod on its own, so one malformed rule never sinks a
    section. COMPILE timeout 300 s (RequestOptions.timeout), REPAIR_QUOTE 180 s.
  - **Beyond the brief, two code checks against invented numbers:** a rule is left out if a
    number in its instruction (`then`) does not appear in its section; a rule's calculation is
    removed (rule kept, note recorded) if its factor does not appear in the verified quote.
  - Quotes are cleaned before checking: `[p. N]` markers, wrapping quotation marks, edge ellipses
    and extra whitespace are removed. Quotes over 300 characters count as failed.
  - One repair round per section, only for rules whose quote failed, asking for an exact passage.
  - The page shown is the page where the quote was found (preferring the rule's own section when
    the passage occurs more than once), never the page the model claimed. For text and Markdown
    sources there are no pages.
  - Dedupe: same quote after normalisation, or title word similarity of at least 0.8 (Jaccard,
    small words ignored; `config.compile.titleSimilarity`). The first in source order is kept and
    takes the duplicate's keywords (up to 10).
  - Cap: 120 rules (`config.compile.maxRules`). Over the cap, critical rules are kept first, then
    major, then minor, each in source order; the rest are listed as left out.
  - IDs: R001, R002, ... in source order, widening to R0001 past 999.
  - If the very first section fails, compile stops instead of repeating a failing call for every
    section (most likely a setup problem such as App Check). Later failures are recorded and
    skipped. Going offline stops the run; nothing is saved.
  - The job runs outside the screen (`compileJob.ts`), so progress survives navigation. The
    finished cartridge is saved as version 1 (cartridges + versions stores) before 'done' shows.
- **Asking (Phase 3)** (`src/cartridge/ask.ts`):
  - **Every cloud question needs the user's approval of a preview** (DeclassifyDialog), also with
    'Ask the cloud when needed' on. Questions are `Private`, and the brief's rule is that
    `declassify` needs an explicit approval with a preview. The owner can relax this later.
  - Retrieval: MiniSearch per cartridge version over title, when, keywords, then; boost keywords x3,
    title x2; prefix for terms of 4+ characters, fuzzy 0.2 for 5+; question words dropped. Top 5.
    Threshold `config.ask.minScore = 2`, picked from the test rulebook (on-topic 19.6 to 258, one
    misspelled 3.2, off-topic 0). Must be tuned on a real cartridge.
  - Order: retrieval first (LOW_RETRIEVAL calls no model), then the device, then validators
    (rule must be a candidate; its quote must verify against the rulebook on this device; without
    the rulebook, VALIDATION_FAILED).
  - Answers are built from the rule; arithmetic in code (`computeCalc`, floating-point noise
    removed before rounding). **A quantity is used only if that number is written in the
    question**, whether it came from the device or the cloud; otherwise the answer asks for it.
  - **Cloud answer prompt: two added return fields**, `quote` (the exact sentence relied on) and
    `quantity`. Without `quote`, the brief's rule "verified only if it cites a quote that verifies"
    could not be checked. If the cloud cites a rule, the answer is written from that rule. If the
    cloud says not covered, its own text is not shown.
  - The cloud gets the 10 best-matching rules and 4 rulebook passages (paragraphs, at most 1,200
    characters each), all public. The preview is rendered by the same function as the prompt
    (`renderTemplate`), and the prompt is refused if it differs from what was approved.
  - Added answer status `unanswered` (brief lists verified, escalated, queued): used when nothing
    was sent because the cloud is off or the user kept the question on this device.
  - Proposed rules from the cloud are kept on the answer only if their quote verifies; reviewing
    them is Phase 5.
- **Offline queue** (`src/queue/offlineQueue.ts`): items persisted in IndexedDB. The approval
  lives in memory only, so after a reload an item shows "Approve again to send it": approvals are
  never re-created from storage. Draining runs when the connection comes back (browser 'online'
  event or the simulated switch going off) after a real probe; failed items stay with their error.
- **Signal probe:** one `HEAD https://www.gstatic.com/generate_204` (`no-cors`, `no-store`, no
  content), logged in the egress log as 'Signal check (no content)'. The Firebase AI Logic host
  answers 400 to a bare request, which Chrome logged as a console error, so we use Google's
  connectivity-check URL instead.
- **'Simulated no signal'** blocks every cloud call made through `cloudJson` (also making a
  cartridge) and the probe. It resets on reload.
- **Gemini Nano per cartridge version** (`src/ai/deviceSessions.ts`). 'Prepare this device' must be
  pressed the first time; after one success, later visits prepare automatically (no download is
  needed then, so no gesture is needed; if it fails, the button comes back).
- **Receipt counters** in localStorage: on this device, from the cloud, waited for signal,
  unanswered. Bytes for questions come from the egress log (ANSWER calls).
- **Data model addition:** `Cartridge.sourceName` and `Cartridge.sourceLicence` (optional), so the
  rulebook's licence travels with exported quotes. `CartridgeSchema` also rejects duplicate rule IDs.
- **Import** always gives the cartridge a new id (never overwrites one on this device) and adds a
  changelog line. It is linked to a saved rulebook by `sourceHash`. Without that rulebook, the card
  viewer says quotes are not checked and never shows 'Verified against the source'.
- **Card viewer** checks each quote on this device when a card is opened, and shows 'Verified
  against the source' only if that check passes; a failing quote is flagged "Do not rely on this
  rule".
- **Smoke tests** have their own tsconfig (`tsconfig.smoke.json`, adds Node types).
  `npm run smoke:compile` makes a real cartridge from `SMOKE_SOURCE` (path or https URL) with
  licence `SMOKE_LICENCE`, reading `SMOKE_SECTIONS` sections (default 2, or `all`), and writes the
  JSON to the OS temp folder.

## Docs vs brief differences

- **On-device fallback finding (privacy-relevant).** In `@firebase/ai` 13.3.0, when the browser has
  no Prompt API, `getGenerativeModel()` builds no on-device adapter, `initializeDeviceModel()`
  returns without error, and `generateContent()` in `ONLY_ON_DEVICE` mode sends the request **to
  the cloud** (see `callCloudOrDevice` in the SDK source). So "detect availability by trying
  initializeDeviceModel inside try/catch" is not enough on its own. `FirebaseDeviceModel` adds:
  1. a check that the SDK built an on-device adapter (reads the SDK's private `chromeAdapter`
     field; if it is renamed, the check fails closed and reports the device as unavailable);
  2. a cloud `baseUrl` of `https://on-device-only.invalid` on the device model, so any accidental
     cloud fallback cannot reach a server;
  3. rejection, and an `unexpected-cloud` egress entry, if a response's `inferenceSource` is not
     `on_device`.
     The raw `LanguageModel` API is still never touched.
- `inferenceSource` values are `'on_device'` and `'in_cloud'` (the `InferenceSource.ON_DEVICE` /
  `IN_CLOUD` constants). The brief writes them in upper case.
- Default cloud model in SDK 13.x is `gemini-3.5-flash-lite`. We never rely on the default.
- `initializeDeviceModel()` throws only in `ONLY_ON_DEVICE` mode when Chrome reports the model
  `unavailable`. It downloads in the background when `downloadable`.
- pdf.js 6.5: `PDFDocumentProxy` has no `destroy()`; the loading task owns it. `isEvalSupported`
  no longer exists as an option.
- **Flagship source licence.** The brief names a humanitarian standards handbook as the flagship
  cartridge. The Sphere Handbook's terms (spherestandards.org/intellectual-property, checked
  2026-11-16) say it is copyrighted and may be reproduced without fee for educational purposes with
  acknowledgement, not for resale. That is not an open licence, so it does not meet the brief's
  "openly licensed or public domain" rule as written. Owner decision pending.

## Known risks

- **No offline app shell yet.** There is no service worker, so a reload with the network blocked
  fails. Loading a rulebook works offline only once the page and the pdf.js chunks are loaded.
  "Works with the network blocked" needs a service worker; not in the dependency list.
- `npm audit` reports 4 high-severity advisories in `@grpc/grpc-js`, pulled in by
  `@firebase/firestore` inside the `firebase` package. We do not import Firestore and grpc is
  Node-only, so it is not in the browser bundle. The suggested fix downgrades firebase to 9.x, which
  we will not do.
- npm skipped postinstall scripts for `@firebase/util` and `protobufjs` (npm's allowScripts policy).
  The app builds and tests pass without them.
- The main bundle is about 619 KB (195 KB gzip), mostly Firebase. Code-splitting is a Phase 6/7 task.
- Inter is listed first in the font stack but not bundled. Offline it falls back to the system font.
- The `chromeAdapter` check depends on an SDK internal. It fails closed, but a future SDK could
  make the device look unavailable until we update it.
- Not yet verified on a real device: download progress, `on_device` reporting, latency.
- PDF extraction is tested on generated PDFs only. Real PDFs with two columns, tables, CID fonts
  (no cMaps bundled) or headers and footers on every page may extract in an odd order; quotes from
  such passages may fail to verify and be dropped in Phase 2.
- The IndexedDB stores have no unit tests (Node has no IndexedDB and `fake-indexeddb` is not in the
  dependency list). Save, list and reload were exercised in headless Chrome; delete was not.

## Open questions for the owner

- Phase 2 needs one real public document to run the cloud compiler end to end. The owner picks it
  then; it is not committed to the repo.
- Ask screen escalation (Phase 3): should 'Ask the cloud when needed' count as the user's standing
  approval for sending a question, or should each escalation show the preview dialog first?
