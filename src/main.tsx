import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { runtimeConfig } from '@/ai/remoteConfig';
import { startAskSession } from '@/cartridge/askSession';
import { telemetryStore } from '@/cartridge/store';
import { libraryAuth } from '@/library/firestoreLibrary';
import { registerOfflineShell } from '@/offline/register';
import { egressLog } from '@/telemetry/egress';
import { App } from './App';
import './index.css';

// Keep 'What left this device' across reloads. If IndexedDB is unavailable the
// log stays in memory and the panel says so.
void egressLog.attachPersistence({ load: telemetryStore.all, save: telemetryStore.put });
// Fetch Firebase Remote Config overrides in the background (falls back to local defaults offline).
runtimeConfig.init();
// Observe Firebase Auth state for the optional Firestore Public Cartridge Library.
libraryAuth.init();
// Load questions waiting for signal, and send them when signal comes back.
startAskSession();
// Save the app's own files on this device, so it opens without a signal.
registerOfflineShell();
// The Blueprint canvas loads its fonts from this app (/fonts/), never from a CDN.
(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
