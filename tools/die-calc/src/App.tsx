/**
 * Standalone-обёртка. В ваш Next.js нужен только <DieCalc/> — см. README.md.
 */
import type { ReactNode } from 'react';
import { DieCalc } from './ui/DieCalc';

export function App(): ReactNode {
  return (
    <div style={{ maxWidth: 1560, margin: '0 auto', padding: '16px 16px 48px' }}>
      <DieCalc />
    </div>
  );
}

export default App;
