import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import { assertConfigAtStartup } from './src/server/config';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

const withStartupChecks = (phase: string): NextConfig => {
  // `next start` в production: без обязательных переменных окружения сервер не стартует
  // и пишет понятное сообщение (только имена переменных, без значений).
  if (phase === PHASE_PRODUCTION_SERVER) {
    try {
      assertConfigAtStartup();
    } catch (e) {
      console.error(e instanceof Error ? e.message : 'Некорректная конфигурация окружения');
      process.exit(1);
    }
  }
  return nextConfig;
};

export default withStartupChecks;
