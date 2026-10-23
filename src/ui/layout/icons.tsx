import type { ReactNode } from 'react';

/** Простые контурные иконки шапки и нижней панели; декоративные (подпись — текстом рядом). */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const HeartIcon = () => (
  <Icon>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Icon>
);
export const CompareIcon = () => (
  <Icon>
    <path d="M6 20V10M12 20V4M18 20v-7" />
  </Icon>
);
export const CartIcon = () => (
  <Icon>
    <path d="M3 4h2.5l2 11h10l2-8H7" />
    <circle cx="9" cy="19" r="1.3" />
    <circle cx="16" cy="19" r="1.3" />
  </Icon>
);
export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1-4 4-5.5 8-5.5s7 1.5 8 5.5" />
  </Icon>
);
export const HomeIcon = () => (
  <Icon>
    <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
  </Icon>
);
export const GridIcon = () => (
  <Icon>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
  </Icon>
);
export const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);
