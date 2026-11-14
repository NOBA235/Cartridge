/** Chooses the device model implementation from config (VITE_MOCK_DEVICE). */
import { config } from '@/config';
import type { DeviceModel } from './deviceModel';
import { FirebaseDeviceModel } from './firebaseDevice';
import { MockDeviceModel } from './mockDevice';

/** One device model per cartridge version: its response schema allows exactly these IDs plus NONE. */
export function createDeviceModel(ruleIds: readonly string[]): DeviceModel {
  return config.mockDevice
    ? new MockDeviceModel({ errorRate: config.mockErrorRate })
    : new FirebaseDeviceModel(ruleIds);
}
