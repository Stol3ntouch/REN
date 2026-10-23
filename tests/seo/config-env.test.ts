import { describe, expect, it } from 'vitest';
import { isProductionEnv as paymentIsProduction } from '@/integrations/payment/select';
import { isProductionEnv, loadConfig } from '@/server/config';

const REQUIRED = { SITE_URL: 'https://shop.example.ru', SESSION_SECRET: 'x'.repeat(40) };

describe('production определяется по NODE_ENV или APP_ENV', () => {
  it('APP_ENV=production включает isProduction и Secure-cookie', () => {
    const c = loadConfig({ APP_ENV: 'production', NODE_ENV: 'development', ...REQUIRED });
    expect(c.isProduction).toBe(true);
    expect(c.cookieSecure).toBe(true);
  });

  it('без production оба признака выключены и не требуют секретов', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c.isProduction).toBe(false);
    expect(c.cookieSecure).toBe(false);
  });

  it('в production через APP_ENV без обязательных переменных конфигурация отвергается', () => {
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrow(/SITE_URL/);
  });

  it('совпадает с функцией платёжного модуля на всех сочетаниях', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      for (const APP_ENV of [undefined, 'staging', 'production']) {
        const env = { NODE_ENV, APP_ENV };
        expect(isProductionEnv(env)).toBe(paymentIsProduction(env));
      }
    }
  });
});
