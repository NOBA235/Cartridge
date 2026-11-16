/**
 * The app's device model is always Gemini Nano through Firebase AI Logic.
 * There is no stand-in in the app. If Gemini Nano is not available, the
 * device reports 'unavailable' and the router escalates with DEVICE_UNAVAILABLE.
 * (Automated tests use src/testing/mockDevice.ts; ESLint keeps it out of app code.)
 */
import type { DeviceModel } from './deviceModel';
import { FirebaseDeviceModel } from './firebaseDevice';

export { prepareThisDevice } from './firebaseDevice';

/** One device model per cartridge version: its response schema allows exactly these IDs plus NONE. */
export function createDeviceModel(ruleIds: readonly string[]): DeviceModel {
  return new FirebaseDeviceModel(ruleIds);
}
