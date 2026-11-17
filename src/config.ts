/**
 * App configuration. Cloud model names live here and nowhere else.
 *
 * Model names checked against https://firebase.google.com/docs/ai-logic/models
 * on 2026-11-14. Both are listed as Stable with no shutdown date:
 * - gemini-3.8-flash: used for one-off, quality-sensitive work (compile, exam, tutor).
 * - gemini-3.5-flash-lite: the SDK's default cloud model; used for quick tasks.
 * Re-check that page before the submission.
 */
export type CloudTaskName = 'DEV_PING' | 'COMPILE' | 'REPAIR_QUOTE' | 'EXAM' | 'TUTOR' | 'ANSWER';

export const config = {
  cloudModels: {
    DEV_PING: 'gemini-3.5-flash-lite',
    COMPILE: 'gemini-3.8-flash',
    REPAIR_QUOTE: 'gemini-3.8-flash',
    EXAM: 'gemini-3.8-flash',
    TUTOR: 'gemini-3.8-flash',
    ANSWER: 'gemini-3.5-flash-lite',
  } satisfies Record<CloudTaskName, string>,
  /** Retries after the first attempt, so 3 attempts at most. */
  cloudMaxRetries: 2,
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
    maxChunkChars: 30_000,
    /** Title word similarity (0 to 1) at or above which two rules count as duplicates. */
    titleSimilarity: 0.8,
    maxQuoteChars: 300,
  },
} as const;
