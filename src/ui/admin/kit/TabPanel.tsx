import type { ReactNode } from 'react';

/** Область содержимого вкладки, связанная с активной ссылкой. */
export function TabPanel({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="ak-tabpanel" role="region" aria-labelledby={`tab-${active}`}>
      {children}
    </div>
  );
}
