import { describe, expect, it } from 'vitest';
import { chooseAppCheckMode, readFirebaseOptions, type FirebaseEnv } from './firebase';

const full: FirebaseEnv = {
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_AUTH_DOMAIN: 'd',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_APP_ID: 'a',
  DEV: true,
};

describe('Firebase config', () => {
  it('reads a complete config', () => {
    const r = readFirebaseOptions(full);
    expect(r.ok && r.options.projectId).toBe('p');
  });

  it('names the missing keys', () => {
    const r = readFirebaseOptions({ ...full, VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_APP_ID: undefined });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID/);
  });
});

describe('App Check mode', () => {
  it('uses the debug provider in dev builds', () => {
    expect(chooseAppCheckMode({ ...full, DEV: true })).toEqual({ ok: true, mode: 'debug' });
  });

  it('never uses debug mode in production builds, even with a debug token set', () => {
    const r = chooseAppCheckMode({ ...full, DEV: false, VITE_APPCHECK_DEBUG_TOKEN: 'leaked', VITE_APPCHECK_SITE_KEY: 's' });
    expect(r).toEqual({ ok: true, mode: 'recaptcha-enterprise' });
  });

  it('refuses a production build without a site key', () => {
    expect(chooseAppCheckMode({ ...full, DEV: false }).ok).toBe(false);
  });
});
