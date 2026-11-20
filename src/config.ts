/**
 * App configuration. Cloud model names live here and nowhere else.
 *
 * Model names checked against https://firebase.google.com/docs/ai-logic/models
 * and verified live via `npm run smoke:cloud` on 2026-11-20:
 * - gemini-3.5-flash-lite: Stable SDK default with generous Free Tier quota and
 *   low latency for structured JSON tasks (compile, exam, tutor, answer, bench).
 *   (gemini-3.8-flash has a 20 req/day Free Tier cap on Spark projects and hit
 *   429 RESOURCE_EXHAUSTED during multi-section compilation; override via
 *   Remote Config when higher quota is provisioned.)
 */
export type CloudTaskName =
  'DEV_PING' | 'COMPILE' | 'REPAIR_QUOTE' | 'EXAM' | 'TUTOR' | 'ANSWER' | 'EDGE_BENCH';

export const config = {
  cloudModels: {
    DEV_PING: 'gemini-3.5-flash-lite',
    COMPILE: 'gemini-3.5-flash-lite',
    REPAIR_QUOTE: 'gemini-3.5-flash-lite',
    EXAM: 'gemini-3.5-flash-lite',
    TUTOR: 'gemini-3.5-flash-lite',
    ANSWER: 'gemini-3.5-flash-lite',
    EDGE_BENCH: 'gemini-3.5-flash-lite',
  } satisfies Record<CloudTaskName, string>,
  /** Retries after the first attempt, so 3 attempts at most. */
  cloudMaxRetries: 2,
  /**
   * Wait before retry N (1-based) after a usage-limit (429) or server (5xx)
   * error. A server that asks for a longer wait than cloudMaxWaitMs is not retried.
   */
  cloudBackoffMs: [2_000, 8_000],
  cloudMaxWaitMs: 30_000,
  /** 'Prepare this device' gives up waiting when the download reports no progress for this long. */
  deviceStallMs: 120_000,
  /**
   * On-device requests are limited to about 9,216 tokens. We cap the prompt
   * well below that (roughly 4 characters per token) so a cartridge can never
   * be pasted in whole.
   */
  deviceMaxPromptChars: 16_000,
  /** Shown in the UI and used by the device model's createOptions. */
  deviceLanguages: ['en'],
  /** Asking a question. */
  ask: {
    /** Rules the device model may choose from. */
    topK: 5,
    /**
     * Best search score below which no model is asked (LOW_RETRIEVAL). On the
     * test rulebook, on-topic questions scored 19.6 to 258, a misspelled one 3.2,
     * and off-topic ones 0. Tune on a real cartridge.
     */
    minScore: 2,
    /** Rules sent with a cloud question (best search matches). */
    cloudRules: 10,
    /** Rulebook passages sent with a cloud question, and their maximum length. */
    cloudPassages: 4,
    passageMaxChars: 1200,
  },
  /** Exam Day. Thresholds to be tuned on real-device runs. */
  exam: {
    questionCount: 40,
    outOfScopeShare: 0.2,
    heldOutShare: 0.3,
    /** Fewer usable questions than this and the exam is not run. */
    minQuestions: 10,
    tutorRounds: 2,
    readyCriticalPassRate: 0.9,
    readyOutOfScopeRate: 0.8,
    /** Stop the run after this many device errors in a row. */
    maxConsecutiveDeviceErrors: 5,
  },
  /** Checking an approved rule. */
  versions: {
    /** Questions the cloud writes for each new rule. */
    questionsPerNewRule: 3,
    /** Other saved exam questions answered again, to catch side effects. */
    regressionQuestions: 8,
  },
  /** Making a cartridge. */
  compile: {
    maxRules: 120,
    /** Smaller sections keep structured JSON output fast and avoid output-token truncation on dense standards. */
    maxChunkChars: 12_000,
    /** Title word similarity (0 to 1) at or above which two rules count as duplicates. */
    titleSimilarity: 0.8,
    /** Real standards (e.g. OWASP ASVS, NIST) regularly have 310–480 char verbatim requirements. */
    maxQuoteChars: 500,
    /** Above this many sections, the user confirms the number of cloud requests first. */
    confirmAboveSections: 20,
  },
  /** The connection test that gates the Blueprint canvas's verdict mode. */
  edgeBench: {
    /** Candidate rules the device sees for one connection. */
    topK: 5,
    runs: 3,
    minCriticalRecall: 0.9,
    minOverallAccuracy: 0.75,
  },
  /** Largest cartridge JSON file accepted for import. */
  maxImportBytes: 20 * 1024 * 1024,
} as const;
