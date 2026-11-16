# Cartridge

Turns a long rulebook into a small, tested, offline-ready cartridge of numbered rules.
Built for the #BuildHybridAI 2026 hackathon with Firebase AI Logic (cloud Gemini plus Gemini Nano in Chrome).

**Public standards go to the cloud once. Your diagram never does.**

> Status: Phase 1 of 8 (loading a rulebook and checking quotes against it). See [docs/STATUS.md](docs/STATUS.md).
> Reference tool, not an official authority.

## Privacy

- Public standards and regulations (an openly licensed excerpt, for example from NIST or an OWASP project) go to the cloud once, to compile the cartridge.
- The user's own material is processed only by the on-device model: their architecture diagram, service names, notes and audit results. The Blueprint canvas makes no automatic cloud calls at all.
- Questions typed in the Ask screen go to the cloud only when the cartridge cannot answer and the user has left 'Ask the cloud when needed' switched on. Every such call shows in the 'What left this device' panel.

How the code enforces this: every cloud function accepts only `Public<T>` values (checked by the
compiler and again at run time). Anything the user types or draws is created as `Private<T>`.
`declassify()` in [src/privacy](src/privacy) is the only way across; it needs the user's approval of
the exact text and writes to the egress log.

## Quick start

Requirements: Node 20.19+ (tested on Node 24), desktop Chrome 139+ for on-device inference.

```sh
npm install
cp .env.example .env.local   # fill in your Firebase web config
npm run dev                  # http://localhost:5173, hidden dev page at /dev
npm test                     # typecheck + unit and type tests
npm run smoke:cloud          # one real cloud call (needs .env.local and a registered debug token)
```

The app always uses the real models: Gemini Nano on this device and Gemini in the cloud, both
through Firebase AI Logic. There is no mock mode and no sample data. If Gemini Nano is not
available, the app says so. Automated tests use a stand-in from `src/testing`, which ESLint keeps
out of app code.

### Firebase setup

1. Create a Firebase project, add a Web app, and copy its config into `.env.local`.
2. In the console, open **AI Services > AI Logic**, click **Get started** and choose the
   **Gemini Developer API**. This enforces App Check for AI Logic.
3. Run `npm run dev`, open the app, and copy the `Firebase App Check debug token` printed in the
   browser console. Register it under **Security > App Check > Apps > Manage debug tokens**.
   Optionally paste it into `VITE_APPCHECK_DEBUG_TOKEN` in `.env.local`. Never commit it.
4. For on-device inference in Chrome, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
   restart Chrome, and press **Prepare this device** on `/dev`.

## Where Firebase AI Logic is called

| What                                     | File                                                 | Mode                           |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| App, App Check, `getAI(GoogleAIBackend)` | [src/ai/firebase.ts](src/ai/firebase.ts)             |                                |
| Cloud tasks (`cloudJson`)                | [src/ai/cloud.ts](src/ai/cloud.ts)                   | `InferenceMode.ONLY_IN_CLOUD`  |
| Device rule selection (Gemini Nano)      | [src/ai/firebaseDevice.ts](src/ai/firebaseDevice.ts) | `InferenceMode.ONLY_ON_DEVICE` |

The raw Chrome `LanguageModel` API is never called (ESLint blocks it).

## Licence

[Apache-2.0](LICENSE)
