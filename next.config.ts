import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import { staticSecurityHeaders } from './src/domain/seo/headers';
import { assertConfigAtStartup } from './src/server/config';

// CSP, HSTS и редирект на HTTPS — в src/proxy.ts (нужен nonce на запрос); здесь заголовки без состояния.
const securityHeaders = staticSecurityHeaders();

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR: отдельная папка сборки, чтобы проверка не затирала .next работающего dev-сервера.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
