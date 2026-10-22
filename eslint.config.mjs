import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'skills-2.2.0/**', '1/**', '2/**', '.autopilot/**', 'data/**', 'coverage/**', 'out/**', 'next-env.d.ts'],
  },
];

export default config;
