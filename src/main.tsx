import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { telemetryStore } from '@/cartridge/store';
import { egressLog } from '@/telemetry/egress';
import { App } from './App';
import './index.css';

// Keep 'What left this device' across reloads. If IndexedDB is unavailable the
// log stays in memory and the panel says so.
void egressLog.attachPersistence({ load: telemetryStore.all, save: telemetryStore.put });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
