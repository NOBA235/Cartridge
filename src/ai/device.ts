/**
 * The app's device model is always Gemini Nano through Firebase AI Logic.
 * There is no stand-in in the app. If Gemini Nano is not available, the
 * device reports 'unavailable' and the router escalates with DEVICE_UNAVAILABLE.
 * (Automated tests use src/testing/mockDevice.ts; ESLint keeps it out of app code.)
 */
import type { DeviceModel, EdgeDeviceModel } from './deviceModel';
import { FirebaseDeviceModel, FirebaseEdgeModel } from './firebaseDevice';

export { prepareThisDevice } from './firebaseDevice';

/** One shared device model: its response schema is fixed at 5 candidate slots (C1..C5) plus NONE. */
export function createDeviceModel(): DeviceModel {
  return new FirebaseDeviceModel();
}

/** One shared connection model for the Blueprint canvas and its connection test. */
export function createEdgeModel(): EdgeDeviceModel {
  return new FirebaseEdgeModel();
}
