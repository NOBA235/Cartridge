import { beforeEach, describe, expect, it } from 'vitest';
import { settings } from './settings';

beforeEach(() => settings._reset());

describe("'Ask the cloud when needed'", () => {
  it('is on by default for the Ask screen', () => {
    expect(settings.get().cloudWhenNeeded.ask).toBe(true);
  });

  it('can be switched off for the Ask screen', () => {
    settings.setAskCloudWhenNeeded(false);
    expect(settings.get().cloudWhenNeeded.ask).toBe(false);
  });

  it('is off and locked for the Blueprint canvas', () => {
    settings.setAskCloudWhenNeeded(true);
    expect(settings.get().cloudWhenNeeded.canvas).toBe(false);
    expect(settings.canvasCloudWhenNeeded()).toBe(false);
    expect('setCanvasCloudWhenNeeded' in settings).toBe(false);
  });
});
