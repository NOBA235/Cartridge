# Cartridge status

Last updated: 2026-11-14 (Phase 0).

## Phase checklist

- [x] Phase 0: Scaffold, guardrails, hybrid plumbing (awaiting owner check of a real cloud call)
- [ ] Phase 1: Source ingestion and quote verification
- [ ] Phase 2: Cloud compiler and card viewer
- [ ] Phase 3: Ask engine, router, validators, offline queue
- [ ] Phase 4: Exam Day (needs a real device)
- [ ] Phase 5: Versions and proposed rules
- [ ] Phase 6: Product polish and demo mode
- [ ] Phase 7: Hardening and submission readiness
- [ ] Phase 8 (optional, gated): Blueprint canvas

### Phase 0 acceptance

- [x] `npm test` passes (typecheck, unit tests, type tests)
- [x] `npm run dev` starts and serves `/` and `/dev`
- [ ] `/dev` works with the mock (code done; needs a click-through in a browser)
- [ ] A real cloud call works with real Firebase config (needs the owner's `.env.local` and a registered debug token)
- [x] No secrets committed (scanned for API keys, private keys and debug-token UUIDs)

## Versions in use

firebase 13.3.0, react 19.3.1, vite 8.3.8, typescript 6.0.3, tailwindcss 4.3.5, vitest 5.1.0,
zod 4.6.7, motion 14.14.0, idb 8.0.4, minisearch 7.2.0, pdfjs-dist 6.5.438.

## Decisions

- **TypeScript 6.0, not 7.0.** typescript-eslint 8.72 supports TypeScript below 6.1 only.
- **shadcn/ui packages.** shadcn/ui components need `radix-ui`, `class-variance-authority`,
  `clsx` and `tailwind-merge`. Treated as part of shadcn/ui. `lucide-react` is not installed (no icons yet).
  Dev tooling added for ESLint and Prettier: `@eslint/js`, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `eslint-config-prettier`, `globals`. Tailwind's `@tailwindcss/vite`
  plugin, `@vitejs/plugin-react`, `@types/*`.
- **Cloud models** (in `src/config.ts`, checked on the Firebase Models page 2026-11-14):
  `gemini-3.8-flash` for compile, repair, exam and tutor; `gemini-3.5-flash-lite` for answers and the dev ping.
  Both are Stable with no shutdown date.
- **App Check.** Dev builds always use the debug provider (`self.FIREBASE_APPCHECK_DEBUG_TOKEN`).
  Production builds never do, and need `VITE_APPCHECK_SITE_KEY` (reCAPTCHA Enterprise).
  Added `VITE_APPCHECK_SITE_KEY` to `.env.example`. The debug token is read only inside an
  `import.meta.env.DEV` branch and env keys are listed one by one (never spread), so Vite cannot
  inline it into a production bundle. Verified: a production build with a canary token set
  contains no trace of it. In dev without a site key we pass a
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
- **Egress log** is in memory for Phase 0. Phase 1 persists it in IndexedDB (telemetry store).
  Failed cloud attempts still count their bytes, because the request may have left.
- **Routing** for the hidden `/dev` page is a pathname check, no router library. Firebase Hosting
  will need an SPA rewrite in Phase 7.

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

## Known risks

- `npm audit` reports 4 high-severity advisories in `@grpc/grpc-js`, pulled in by
  `@firebase/firestore` inside the `firebase` package. We do not import Firestore and grpc is
  Node-only, so it is not in the browser bundle. The suggested fix downgrades firebase to 9.x, which
  we will not do.
- npm skipped postinstall scripts for `@firebase/util` and `protobufjs` (npm's allowScripts policy).
  The app builds and tests pass without them.
- The main bundle is about 596 KB (188 KB gzip), mostly Firebase. Code-splitting is a Phase 6/7 task.
- Inter is listed first in the font stack but not bundled. Offline it falls back to the system font.
- The `chromeAdapter` check depends on an SDK internal. It fails closed, but a future SDK could
  make the device look unavailable until we update it.
- Not yet verified on a real device: download progress, `on_device` reporting, latency.

## Open questions for the owner

- Ask screen escalation (Phase 3): should 'Ask the cloud when needed' count as the user's standing
  approval for sending a question, or should each escalation show the preview dialog first?
