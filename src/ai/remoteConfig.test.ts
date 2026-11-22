import { describe, expect, it } from 'vitest';
import { DEFAULT_VALUES, parseRemoteOverrides, REMOTE_CONFIG_KEYS } from './remoteConfig';

describe('Remote Config parser', () => {
  it('returns local defaults with 0 overrides when empty', () => {
    expect(parseRemoteOverrides({})).toEqual({ values: DEFAULT_VALUES, overrideCount: 0 });
  });

  it('applies valid model names and numeric thresholds', () => {
    const res = parseRemoteOverrides({
      [REMOTE_CONFIG_KEYS.cloudModels.COMPILE]: 'gemini-3.8-flash',
      [REMOTE_CONFIG_KEYS.askMinScore]: '4.5',
      [REMOTE_CONFIG_KEYS.examReadyCriticalPassRate]: '0.95',
      [REMOTE_CONFIG_KEYS.edgeMinOverallAccuracy]: '0.8',
    });
    expect(res.overrideCount).toBe(4);
    expect(res.values.cloudModels.COMPILE).toBe('gemini-3.8-flash');
    expect(res.values.cloudModels.ANSWER).toBe(DEFAULT_VALUES.cloudModels.ANSWER);
    expect(res.values.askMinScore).toBe(4.5);
    expect(res.values.examReadyCriticalPassRate).toBe(0.95);
    expect(res.values.edgeMinOverallAccuracy).toBe(0.8);
  });

  it('ignores malformed model names and out-of-range numbers safely', () => {
    const res = parseRemoteOverrides({
      [REMOTE_CONFIG_KEYS.cloudModels.COMPILE]: 'bad model with spaces!!',
      [REMOTE_CONFIG_KEYS.askMinScore]: '-5',
      [REMOTE_CONFIG_KEYS.examReadyCriticalPassRate]: '1.5',
      [REMOTE_CONFIG_KEYS.examReadyOutOfScopeRate]: 'NaN',
      [REMOTE_CONFIG_KEYS.edgeMinCriticalRecall]: '2',
    });
    expect(res.overrideCount).toBe(0);
    expect(res.values).toEqual(DEFAULT_VALUES);
  });
});
