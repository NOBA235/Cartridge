/** Whether the 'What left this device' panel is open. Any screen may open it. */
import { createStore } from '@/lib/store';

const store = createStore(false);

export const egressPanel = {
  subscribe: store.subscribe,
  get: store.get,
  open: () => store.set(true),
  close: () => store.set(false),
};
