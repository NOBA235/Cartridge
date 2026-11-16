import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAskSession } from '@/cartridge/askSession';
import { telemetryStore } from '@/cartridge/store';
import { egressLog } from '@/telemetry/egress';
import { App } from './App';
import './index.css';

// Keep 'What left this device' across reloads. If IndexedDB is unavailable the
// log stays in memory and the panel says so.
void egressLog.attachPersistence({ load: telemetryStore.all, save: telemetryStore.put });
// Load questions waiting for signal, and send them when signal comes back.
startAskSession();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
