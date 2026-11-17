# Cartridge

Turns a long rulebook into a small, tested, offline-ready cartridge of numbered rules, answered by Gemini Nano on your own device.

**Public standards go to the cloud once. Your diagram never does.**

<!-- Demo GIF goes here (docs/demo.gif), recorded on a real device in Phase 7. -->

_Demo GIF: to be recorded on a real device in Phase 7._

Built for the #BuildHybridAI 2026 hackathon with Firebase AI Logic (cloud Gemini plus Gemini Nano in Chrome).

> Status: Phase 6 of 8 (product polish). See [docs/STATUS.md](docs/STATUS.md).
> Reference tool, not an official authority.

## Quick start

Requirements: Node 20.19+ (tested on Node 24), desktop Chrome 139+ for on-device inference.

```sh
npm install
cp .env.example .env.local   # fill in your Firebase web config (see Firebase setup below)
npm run dev                  # http://localhost:5180
```

Then, in the app: **Load a rulebook** (a public, openly licensed PDF, .txt or .md), **Make the
cartridge**, press **Prepare this device** in the header to download Gemini Nano once, run
**Exam Day**, and **Ask**. The **Report card** shows how the cartridge did and what left the device.

## What runs where

| Step                                      | Where                                           | What is sent                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Load a rulebook (PDF, text)               | This device                                     | Nothing                                                                                                                        |
| Make the cartridge                        | Cloud, when you press Make the cartridge        | The public rulebook text, section by section                                                                                   |
| Check every rule's quote                  | This device                                     | Nothing                                                                                                                        |
| Exam Day: write the test                  | Cloud                                           | The public rules (titles, conditions, instructions), no quotes                                                                 |
| Exam Day: answer the test                 | This device (Gemini Nano), never the cloud      | Nothing                                                                                                                        |
| Exam Day: tutor                           | Cloud                                           | The public rules involved and the practice questions they failed; never held-out                                               |
| Ask: answer from the cartridge            | This device (Gemini Nano)                       | Nothing                                                                                                                        |
| Ask: question the cartridge cannot answer | Cloud, only with 'Ask the cloud when needed' on | Your question, only after you approve the exact text, plus matching public rules and rulebook passages                         |
| Approve a suggested rule: check           | Cloud writes 3 questions, this device answers   | The new public rule (not sent if it uses words from your question that the rulebook lacks); your question stays on this device |
| Signal check before sending queued items  | Google connectivity URL                         | An empty `HEAD` request                                                                                                        |
| Developer page (`/dev`) test buttons      | Cloud                                           | A fixed test prompt                                                                                                            |

Every request that leaves the device is listed, with its exact content, in the **What left this
device** panel.

## Privacy

- Public standards and regulations (an openly licensed excerpt, for example from NIST or an OWASP project) go to the cloud once, to compile the cartridge.
- The user's own material is processed only by the on-device model: their architecture diagram, service names, notes and audit results. The Blueprint canvas makes no automatic cloud calls at all.
- Questions typed in the Ask screen go to the cloud only when the cartridge cannot answer and the user has left 'Ask the cloud when needed' switched on. Every such call shows in the 'What left this device' panel.

How the code enforces this: every cloud function accepts only `Public<T>` values (checked by the
compiler and again at run time). Anything the user types or draws is created as `Private<T>`.
`declassify()` in [src/privacy](src/privacy) is the only way across; it needs the user's approval of
the exact text and writes to the egress log.

## Development

```sh
npm run dev                  # http://localhost:5180, hidden dev page at /dev
npm test                     # typecheck + unit and type tests
npm run lint
npm run build && npm run preview   # production build on http://localhost:4180
npm run smoke:cloud          # one real cloud call (needs .env.local and a registered debug token)
```

A real end-to-end cartridge from a public document (PowerShell):

```powershell
$env:SMOKE_SOURCE = "C:\path\to\standard.pdf"   # or an https:// URL, .md or .txt
$env:SMOKE_LICENCE = "CC BY-SA 4.0"
$env:SMOKE_SECTIONS = "2"                       # or "all"
npm run smoke:compile
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
   restart Chrome, load a cartridge, and press **Prepare this device** in the header. If Gemini
   Nano is not available, the header shows **Cloud mode**: questions then need the cloud, after
   you approve each one.

## Where Firebase AI Logic is called

| What                                                             | File                                                                                 | Mode                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| App, App Check, `getAI(GoogleAIBackend)`                         | [src/ai/firebase.ts](src/ai/firebase.ts)                                             |                                        |
| Cloud tasks (`cloudJson`)                                        | [src/ai/cloud.ts](src/ai/cloud.ts)                                                   | `InferenceMode.ONLY_IN_CLOUD`          |
| Making a cartridge (per section, plus one repair call if needed) | [src/cartridge/compile.ts](src/cartridge/compile.ts)                                 | through `cloudJson`                    |
| Exam Day: writing the exam, and the tutor                        | [src/exam/generate.ts](src/exam/generate.ts), [src/exam/tutor.ts](src/exam/tutor.ts) | through `cloudJson`                    |
| Exam Day: answering the questions                                | [src/exam/run.ts](src/exam/run.ts)                                                   | Gemini Nano only, never the cloud      |
| After approving a suggested rule: test questions for it          | [src/exam/check.ts](src/exam/check.ts)                                               | through `cloudJson` (public rule text) |
| After approving a suggested rule: answering the check            | [src/exam/check.ts](src/exam/check.ts)                                               | Gemini Nano only, never the cloud      |
| Device rule selection (Gemini Nano)                              | [src/ai/firebaseDevice.ts](src/ai/firebaseDevice.ts)                                 | `InferenceMode.ONLY_ON_DEVICE`         |

The raw Chrome `LanguageModel` API is never called (ESLint blocks it).

## Licence

[Apache-2.0](LICENSE)
