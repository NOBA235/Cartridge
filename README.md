# Cartridge

Turns a long rulebook into a small, tested, offline-ready cartridge of numbered rules, answered by Gemini Nano on your own device.

**Public standards go to the cloud once. Your diagram never does.**

<!-- Demo GIF: docs/demo.gif -->

Built for the #BuildHybridAI 2026 hackathon with Firebase AI Logic (cloud Gemini plus Gemini Nano in Chrome).

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
| Connection test: draft the connections    | Cloud, when you press Draft                     | The public rules (titles, conditions, exceptions, severity), no quotes                                                         |
| Connection test: run it                   | This device (Gemini Nano), never the cloud      | Nothing                                                                                                                        |
| Developer page (`/dev`) test buttons      | Cloud                                           | A fixed test prompt                                                                                                            |
| Opening the app                           | The app's own host, then this device            | Requests for the app's own files; after the first visit they are saved on the device                                           |

Every request that leaves the device is listed, with its exact content, in the **What left this
device** panel.

## How it works

1. **Load a rulebook.** pdf.js extracts the text in a Web Worker, keeping page numbers. The text
   and its SHA-256 hash are stored in IndexedDB. You confirm the document is public and name its
   licence before it can be sent anywhere.
2. **Make the cartridge.** Each section goes to cloud Gemini once, which returns rules as JSON
   (checked with zod). Every rule must quote the rulebook, and code checks each quote against the
   stored text after normalising hyphenation, ligatures, quotes, dashes and whitespace. A rule
   whose quote cannot be found, or whose numbers do not appear in its section, is left out with
   the reason shown. Duplicates are merged and rules are numbered R001, R002, ...
3. **Exam Day.** The cloud writes about 40 questions, including some the rules do not answer.
   They are split 70/30 into practice and held-out. Gemini Nano answers on the device; a cloud
   tutor may reword the titles, conditions and keywords of rules that failed in practice (never
   the instruction, the quote or the severity), and a round that lowers the score is undone. The
   held-out set is asked once at the end, so the test pass rate on the report card is measured on
   questions the tutor never saw.
4. **Ask.** Search (MiniSearch) picks the 5 closest rules. Gemini Nano chooses one of them, or
   none. The answer is built from the rule itself, its quote is checked again, and any
   calculation is done in code, using only numbers written in your question. If the cartridge
   cannot answer, the question goes to the cloud only with your approval of the exact text, or
   waits for signal.
5. **Versions.** When the cloud answers a question the cartridge missed, it may suggest a rule.
   The suggestion is kept only if its quote is in the rulebook. You review the change, approve it
   as a new version (nothing is ever overwritten), and the device re-runs the affected questions.

## Connection test (before the Blueprint canvas)

The Blueprint canvas will check each connection in a diagram against the rules, on the device.
It may mark connections red or green only after Gemini Nano passes a test on that device;
otherwise it only advises (amber, never green). The **Connection test** screen
(`/connections`, linked from the Report card) runs that test:

1. The cloud drafts 30 connections from the public rules: 10 violations of critical rules, 10
   compliant, 5 allowed by a stated exception, 5 no rule covers. A person reviews every one by
   hand and corrects the expected result where needed; the set can be exported as `edges.json`
   and imported again.
2. Gemini Nano judges each connection three times; the lowest run counts. For each connection
   it sees only that connection and up to 5 candidate rules found by search, and reports facts
   (which rule, whether its situation is met, whether a listed exception applies). Code decides
   the result from those facts ([src/canvas/edges.ts](src/canvas/edges.ts)); the chosen rule must
   be one of the candidates and its quote must verify, or the result is "uncertain".
3. The bar: at least 9 of 10 violations caught and at least 23 of 30 right. Missed violations
   are listed on their own. The result is saved on the cartridge version that was tested, and a
   new version of the rules needs the test again.

## Without a signal

After one visit with a signal, the production build works with the network off:

- A service worker ([src/offline/serviceWorker.ts](src/offline/serviceWorker.ts)), generated at
  build time with the exact list of built files, saves the app on the device. The footer says
  **Saved on this device** when that is done. It never touches requests to other origins, so
  every call to Firebase goes to the network and shows in the egress log as before.
- Rulebooks, cartridges, versions, exams and the egress log are in IndexedDB. The app asks the
  browser to keep them when it clears space (the browser decides).
- Without a signal you can open every screen, read the cards with their quotes checked against
  the rulebook, load a new rulebook (PDF reading runs on the device), and ask questions that
  Gemini Nano answers. A question the cartridge cannot answer waits in **Waiting for signal**
  after you approve it, and is sent when the signal returns.
- Making a cartridge and writing a new exam need the cloud, so those buttons are off without a
  signal. A saved exam can run again on the device; the tutor, which is in the cloud, is skipped.

When something goes wrong, the app says what happened and keeps your work:

| Situation                               | What happens                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Gemini Nano unavailable on this device  | The header shows **Cloud mode**; questions need the cloud, after you approve each one           |
| Gemini Nano download stops              | After 2 minutes without progress it shows as stopped, with **Try again**; a late finish counts  |
| Signal lost while making a cartridge    | Stops with "No signal"; nothing half-made is saved                                              |
| Cloud usage limit (429) or server error | Retried after 2 s and 8 s (or the wait the server asks for, up to 30 s), then explained         |
| App Check or permission refused         | Not retried; the message says what to set up                                                    |
| Malformed reply from a model            | Cloud replies are retried; a device reply is rejected and the question escalates                |
| Storage full or blocked                 | A plain message; a cartridge that was made but not saved can be saved again or exported as JSON |
| Very long rulebook                      | Over 20 sections, you confirm the number of cloud requests first                                |

## Privacy

- Public standards and regulations (an openly licensed excerpt, for example from NIST or an OWASP project) go to the cloud once, to compile the cartridge.
- The user's own material is processed only by the on-device model: their architecture diagram, service names, notes and audit results. The Blueprint canvas makes no automatic cloud calls at all.
- Questions typed in the Ask screen go to the cloud only when the cartridge cannot answer and the user has left 'Ask the cloud when needed' switched on. Every such call shows in the 'What left this device' panel.

How the code enforces this: every cloud function accepts only `Public<T>` values (checked by the
compiler and again at run time). Anything the user types or draws is created as `Private<T>`.
`declassify()` in [src/privacy](src/privacy) is the only way across; it needs the user's approval of
the exact text and writes to the egress log. These checks guard against mistakes in our own code;
they cannot stop other code running in the same page.

### On-device fallback guard

In `@firebase/ai` 13.3.0, when the browser has no Prompt API, a model created with
`InferenceMode.ONLY_ON_DEVICE` sends `generateContent()` to the cloud instead of failing. So
[src/ai/firebaseDevice.ts](src/ai/firebaseDevice.ts) adds three guards:

1. The device is marked ready only if the SDK built its on-device adapter. This reads an SDK
   internal field; if a future SDK renames it, the check fails closed and the device shows as
   unavailable.
2. The device model's cloud base URL is `https://on-device-only.invalid`, so an accidental cloud
   fallback cannot reach a server.
3. A response whose `inferenceSource` is not `on_device` is rejected and logged as unexpected.

## Firebase setup

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

## Development

```sh
npm run dev                  # http://localhost:5180, developer page at /dev
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
out of app code; results from it are labelled 'mock' and never shown as measured on a device.

## Deploy to Firebase Hosting

Production builds use reCAPTCHA Enterprise for App Check (never the debug provider).

1. In the Google Cloud console, open **Security > reCAPTCHA** for the same project and create a
   **Web** key (score-based, no checkbox challenge) for your Hosting domains, for example
   `<project-id>.web.app` and `<project-id>.firebaseapp.com`. Do not add `localhost`.
2. In the Firebase console, **Security > App Check > Apps**: register the web app with the
   **reCAPTCHA Enterprise** provider and that key.
3. Put the key in `VITE_APPCHECK_SITE_KEY` in `.env.local` (it is a public key that ships in the
   page), then build and deploy:

   ```sh
   npm run build
   npx firebase-tools login
   npx firebase-tools deploy --only hosting --project <project-id>
   ```

4. Once App Check metrics show your app's requests as verified, enforce App Check for Firebase AI
   Logic in the console.

[firebase.json](firebase.json) serves every app path from `index.html`, never caches the page or
the service worker, and caches the content-named files in `/assets` for a year.

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
| Connection test: drafting the connections                        | [src/canvas/bench.ts](src/canvas/bench.ts)                                           | through `cloudJson` (public rule text) |
| Connection facts (Gemini Nano, `FirebaseEdgeModel`)              | [src/ai/firebaseDevice.ts](src/ai/firebaseDevice.ts)                                 | `InferenceMode.ONLY_ON_DEVICE`         |

The raw Chrome `LanguageModel` API is never called (ESLint blocks it).

## Limitations

- Gemini Nano needs desktop Chrome 139+ on supported hardware, and the first download is several
  GB. Without it, questions need the cloud.
- PDF extraction is tested on generated PDFs. Two-column layouts, tables and scanned pages may
  extract out of order or not at all; quotes from such passages fail the check and those rules
  are left out.
- The search threshold and the Exam Day thresholds were set on a small test rulebook.
- Held-out sets are small (12 questions for a 40-question exam), so the test pass rate moves in
  large steps.
- Everything is stored per browser profile. Clearing site data removes rulebooks, cartridges and
  the egress log.
- The first visit needs a signal, and the app works offline only in production builds (the
  development server does not register the service worker).
- A new version of the app is used once every tab of the old one has been closed.

## Licence

[Apache-2.0](LICENSE)
