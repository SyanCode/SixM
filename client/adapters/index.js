import { MockAdapter } from './mock.js';
import { VictoryAdapter } from './victory.js';

export function createAdapter(name, options = {}) {
  switch (name) {
    case 'mock': return new MockAdapter();
    case 'victory': return new VictoryAdapter(options);
    default: throw new Error(`adaptateur inconnu: ${name} (mock | victory)`);
  }
}
