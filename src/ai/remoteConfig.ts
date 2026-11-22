/**
 * Firebase Remote Config wrapper for cloud model names and tunable hybrid
 * routing / exam / connection-test thresholds.
 *
 * Always starts immediately with the local defaults from src/config.ts so
 * offline boots and tests never block. When online in a supported browser,
 * initRemoteConfig() fetches and activates validated overrides from Firebase
 * Remote Config without requiring a redeploy.
 */
import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  isSupported,
  type RemoteConfig,
} from 'firebase/remote-config';
import { config, type CloudTaskName } from '@/config';
import { createStore } from '@/lib/store';
import { getFirebase } from './firebase';

export type ConfigSource = 'defaults' | 'remote' | 'cached';

export interface RuntimeConfigValues {
  readonly cloudModels: Readonly<Record<CloudTaskName, string>>;
  readonly askMinScore: number;
  readonly examReadyCriticalPassRate: number;
  readonly examReadyOutOfScopeRate: number;
  readonly edgeMinCriticalRecall: number;
  readonly edgeMinOverallAccuracy: number;
}

export interface RuntimeConfigState {
  readonly values: RuntimeConfigValues;
  readonly source: ConfigSource;
  readonly overrideCount: number;
  readonly lastFetchedAt?: string;
  readonly error?: string;
}

export const REMOTE_CONFIG_KEYS = {
  cloudModels: {
    DEV_PING: 'cloud_model_dev_ping',
    COMPILE: 'cloud_model_compile',
    REPAIR_QUOTE: 'cloud_model_repair_quote',
    EXAM: 'cloud_model_exam',
    TUTOR: 'cloud_model_tutor',
    ANSWER: 'cloud_model_answer',
    EDGE_BENCH: 'cloud_model_edge_bench',
  } satisfies Record<CloudTaskName, string>,
  askMinScore: 'ask_min_score',
  examReadyCriticalPassRate: 'exam_ready_critical_pass_rate',
  examReadyOutOfScopeRate: 'exam_ready_out_of_scope_rate',
  edgeMinCriticalRecall: 'edge_min_critical_recall',
  edgeMinOverallAccuracy: 'edge_min_overall_accuracy',
} as const;

export const DEFAULT_VALUES: RuntimeConfigValues = {
  cloudModels: { ...config.cloudModels },
  askMinScore: config.ask.minScore,
  examReadyCriticalPassRate: config.exam.readyCriticalPassRate,
  examReadyOutOfScopeRate: config.exam.readyOutOfScopeRate,
  edgeMinCriticalRecall: config.edgeBench.minCriticalRecall,
  edgeMinOverallAccuracy: config.edgeBench.minOverallAccuracy,
};

/** Safe model ID format: letters, digits, dots, underscores, hyphens (e.g. gemini-3.5-flash-lite). */
const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/i;

function validModel(
  raw: string | undefined,
  fallback: string,
): { value: string; changed: boolean } {
  const s = raw?.trim() ?? '';
  if (MODEL_NAME_RE.test(s) && s !== fallback) return { value: s, changed: true };
  return { value: fallback, changed: false };
}

function validNumber(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): { value: number; changed: boolean } {
  if (raw === undefined || raw.trim() === '') return { value: fallback, changed: false };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return { value: fallback, changed: false };
  return { value: n, changed: n !== fallback };
}

/** Pure parser for Remote Config string values; invalid or out-of-range overrides fall back safely. */
export function parseRemoteOverrides(
  raw: Readonly<Record<string, string | undefined>>,
  base: RuntimeConfigValues = DEFAULT_VALUES,
): { values: RuntimeConfigValues; overrideCount: number } {
  let overrideCount = 0;
  const models = { ...base.cloudModels } as Record<CloudTaskName, string>;
  for (const [task, key] of Object.entries(REMOTE_CONFIG_KEYS.cloudModels) as Array<
    [CloudTaskName, string]
  >) {
    const r = validModel(raw[key], base.cloudModels[task]);
    models[task] = r.value;
    if (r.changed) overrideCount++;
  }
  const askMinScore = validNumber(raw[REMOTE_CONFIG_KEYS.askMinScore], 0, 100, base.askMinScore);
  const examCrit = validNumber(
    raw[REMOTE_CONFIG_KEYS.examReadyCriticalPassRate],
    0,
    1,
    base.examReadyCriticalPassRate,
  );
  const examOut = validNumber(
    raw[REMOTE_CONFIG_KEYS.examReadyOutOfScopeRate],
    0,
    1,
    base.examReadyOutOfScopeRate,
  );
  const edgeRecall = validNumber(
    raw[REMOTE_CONFIG_KEYS.edgeMinCriticalRecall],
    0,
    1,
    base.edgeMinCriticalRecall,
  );
  const edgeAcc = validNumber(
    raw[REMOTE_CONFIG_KEYS.edgeMinOverallAccuracy],
    0,
    1,
    base.edgeMinOverallAccuracy,
  );
  for (const r of [askMinScore, examCrit, examOut, edgeRecall, edgeAcc]) {
    if (r.changed) overrideCount++;
  }
  return {
    overrideCount,
    values: {
      cloudModels: models,
      askMinScore: askMinScore.value,
      examReadyCriticalPassRate: examCrit.value,
      examReadyOutOfScopeRate: examOut.value,
      edgeMinCriticalRecall: edgeRecall.value,
      edgeMinOverallAccuracy: edgeAcc.value,
    },
  };
}

function defaultConfigMap(): Record<string, string | number> {
  return {
    ...Object.fromEntries(
      (Object.entries(REMOTE_CONFIG_KEYS.cloudModels) as Array<[CloudTaskName, string]>).map(
        ([task, key]) => [key, DEFAULT_VALUES.cloudModels[task]],
      ),
    ),
    [REMOTE_CONFIG_KEYS.askMinScore]: DEFAULT_VALUES.askMinScore,
    [REMOTE_CONFIG_KEYS.examReadyCriticalPassRate]: DEFAULT_VALUES.examReadyCriticalPassRate,
    [REMOTE_CONFIG_KEYS.examReadyOutOfScopeRate]: DEFAULT_VALUES.examReadyOutOfScopeRate,
    [REMOTE_CONFIG_KEYS.edgeMinCriticalRecall]: DEFAULT_VALUES.edgeMinCriticalRecall,
    [REMOTE_CONFIG_KEYS.edgeMinOverallAccuracy]: DEFAULT_VALUES.edgeMinOverallAccuracy,
  };
}

const ALL_KEYS: readonly string[] = [
  ...Object.values(REMOTE_CONFIG_KEYS.cloudModels),
  REMOTE_CONFIG_KEYS.askMinScore,
  REMOTE_CONFIG_KEYS.examReadyCriticalPassRate,
  REMOTE_CONFIG_KEYS.examReadyOutOfScopeRate,
  REMOTE_CONFIG_KEYS.edgeMinCriticalRecall,
  REMOTE_CONFIG_KEYS.edgeMinOverallAccuracy,
];

function readFromRc(rc: RemoteConfig): {
  raw: Record<string, string>;
  hasRemote: boolean;
} {
  const raw: Record<string, string> = {};
  let hasRemote = false;
  for (const key of ALL_KEYS) {
    const v = getValue(rc, key);
    raw[key] = v.asString();
    if (v.getSource() === 'remote') hasRemote = true;
  }
  return { raw, hasRemote };
}

const INITIAL: RuntimeConfigState = {
  values: DEFAULT_VALUES,
  source: 'defaults',
  overrideCount: 0,
};

const store = createStore<RuntimeConfigState>(INITIAL);
let rcInstance: RemoteConfig | undefined;
let started = false;

async function sync(force: boolean): Promise<RuntimeConfigState> {
  const fb = getFirebase();
  if (!fb.ok) return store.get();
  if (!(await isSupported().catch(() => false))) return store.get();
  try {
    if (!rcInstance) {
      rcInstance = getRemoteConfig(fb.app);
      rcInstance.defaultConfig = defaultConfigMap();
    }
    rcInstance.settings.minimumFetchIntervalMillis = force
      ? 0
      : import.meta.env.DEV
        ? 60_000
        : 3_600_000;
    rcInstance.settings.fetchTimeoutMillis = 10_000;
    const activated = await fetchAndActivate(rcInstance);
    const { raw, hasRemote } = readFromRc(rcInstance);
    const { values, overrideCount } = parseRemoteOverrides(raw);
    const source: ConfigSource = hasRemote ? (activated ? 'remote' : 'cached') : 'defaults';
    const next: RuntimeConfigState = {
      values,
      source,
      overrideCount,
      lastFetchedAt: new Date().toISOString(),
    };
    store.set(next);
    return next;
  } catch (e) {
    // Offline or Remote Config not enabled in console yet: keep defaults/cached values quietly.
    const cur = store.get();
    const next: RuntimeConfigState = {
      ...cur,
      error: e instanceof Error ? e.message : String(e),
    };
    store.set(next);
    return next;
  }
}

export const runtimeConfig = {
  subscribe: store.subscribe,
  get: store.get,
  values: (): RuntimeConfigValues => store.get().values,
  cloudModel: (task: CloudTaskName): string => store.get().values.cloudModels[task],
  /** Starts one background fetch on browser startup. Safe offline and in Node. */
  init(): void {
    if (started || typeof window === 'undefined') return;
    started = true;
    void sync(false);
  },
  /** Forces an immediate Remote Config fetch (used by /dev and Report card). */
  refresh(): Promise<RuntimeConfigState> {
    return sync(true);
  },
  /** Test helper. */
  _reset(): void {
    started = false;
    rcInstance = undefined;
    store.set(INITIAL);
  },
};
