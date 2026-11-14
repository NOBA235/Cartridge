/**
 * Firebase initialisation: app, App Check, and Firebase AI Logic.
 *
 * Follows:
 * - https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference
 * - https://firebase.google.com/docs/app-check/web/debug-provider
 * - https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
 *
 * App Check must be initialised before getAI() so AI Logic requests carry a token.
 * In dev builds the debug provider is enabled by setting
 * self.FIREBASE_APPCHECK_DEBUG_TOKEN before initializeAppCheck(). Production
 * builds never enable debug mode and need VITE_APPCHECK_SITE_KEY.
 */
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

export type AppCheckMode = 'debug' | 'recaptcha-enterprise';

export type FirebaseState =
  | { ok: true; app: FirebaseApp; ai: AI; appCheck: AppCheck; appCheckMode: AppCheckMode }
  | { ok: false; reason: string };

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export interface FirebaseEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_APPCHECK_SITE_KEY?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly DEV: boolean;
}

/** Pure: reads the config, or explains what is missing. Exported for tests. */
export function readFirebaseOptions(
  env: FirebaseEnv,
): { ok: true; options: FirebaseOptions } | { ok: false; reason: string } {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Firebase is not configured. Missing in .env.local: ${missing.join(', ')}`,
    };
  }
  return {
    ok: true,
    options: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
      appId: env.VITE_FIREBASE_APP_ID,
    },
  };
}

/** Pure: decides the App Check mode. Exported for tests. */
export function chooseAppCheckMode(
  env: FirebaseEnv,
): { ok: true; mode: AppCheckMode } | { ok: false; reason: string } {
  if (env.DEV) return { ok: true, mode: 'debug' };
  if (env.VITE_APPCHECK_SITE_KEY) return { ok: true, mode: 'recaptcha-enterprise' };
  return {
    ok: false,
    reason: 'App Check is not configured. Set VITE_APPCHECK_SITE_KEY for production builds.',
  };
}

let state: FirebaseState | undefined;

export function getFirebase(): FirebaseState {
  if (state) return state;
  // List keys explicitly: spreading import.meta.env would inline every VITE_ value
  // into the bundle. The debug token is read only inside an import.meta.env.DEV
  // branch, so production builds drop it entirely.
  const env: FirebaseEnv = {
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_APPCHECK_SITE_KEY: import.meta.env.VITE_APPCHECK_SITE_KEY,
    DEV: import.meta.env.DEV,
  };
  const opts = readFirebaseOptions(env);
  if (!opts.ok) return (state = opts);
  const mode = chooseAppCheckMode(env);
  if (!mode.ok) return (state = mode);

  try {
    const app = initializeApp(opts.options);

    if (import.meta.env.DEV && mode.mode === 'debug') {
      // A registered token from .env.local, or `true` so the SDK prints a new one
      // to the console for registering in Firebase console > App Check.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }

    // In debug mode the SDK exchanges the debug token and never asks the provider
    // for a token (checked in @firebase/app-check source). Without a site key we
    // pass a provider that refuses, so a missing debug setup fails loudly.
    const provider = env.VITE_APPCHECK_SITE_KEY
      ? new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY)
      : new CustomProvider({
          getToken: () =>
            Promise.reject(
              new Error('No App Check site key. Only the debug provider is available.'),
            ),
        });

    const appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    return (state = { ok: true, app, ai, appCheck, appCheckMode: mode.mode });
  } catch (e) {
    return (state = { ok: false, reason: `Firebase failed to start: ${(e as Error).message}` });
  }
}
