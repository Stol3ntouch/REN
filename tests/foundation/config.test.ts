import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '@/server/config';

const SECRET = 'a'.repeat(40);

describe('loadConfig', () => {
  it('в разработке работает с пустым окружением и берёт значения по умолчанию', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c.isProduction).toBe(false);
    expect(c.databasePath).toBe('data/rts.sqlite');
    expect(c.imageHostAllowlist).toEqual(['champion.ru']);
    expect(c.siteUrl).toBeUndefined();
  });

  it('пустые строки из .env считает незаданными', () => {
    const c = loadConfig({ NODE_ENV: 'development', SITE_URL: '', MAIL_PORT: '', DATABASE_PATH: '' });
    expect(c.siteUrl).toBeUndefined();
    expect(c.mail.port).toBeUndefined();
    expect(c.databasePath).toBe('data/rts.sqlite');
  });

  it('в production без обязательных переменных бросает ConfigError с их именами', () => {
    try {
      loadConfig({ NODE_ENV: 'production' });
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain('SITE_URL');
      expect((e as Error).message).toContain('SESSION_SECRET');
    }
  });

  it('не выдаёт значение секрета в сообщении об ошибке', () => {
    const bad = 'коротко-секрет-12345';
    try {
      loadConfig({ NODE_ENV: 'production', SITE_URL: 'https://rts.example', SESSION_SECRET: bad });
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect((e as Error).message).toContain('SESSION_SECRET');
      expect((e as Error).message).not.toContain(bad);
    }
  });

  it('в production с полным набором возвращает защищённые настройки', () => {
    const c = loadConfig({ NODE_ENV: 'production', SITE_URL: 'https://rts.example/', SESSION_SECRET: SECRET });
    expect(c.isProduction).toBe(true);
    expect(c.siteUrl).toBe('https://rts.example');
    expect(c.sessionSecret).toBe(SECRET);
    expect(c.cookieSecure).toBe(true);
  });

  it('разбирает числа, списки и флаги; плохой формат — ConfigError с именем', () => {
    const c = loadConfig({
      NODE_ENV: 'development',
      MAIL_PORT: '587',
      IMAGE_HOST_ALLOWLIST: 'a.ru, b.ru ,',
      TRUST_PROXY: 'true',
    });
    expect(c.mail.port).toBe(587);
    expect(c.imageHostAllowlist).toEqual(['a.ru', 'b.ru']);
    expect(c.trustProxy).toBe(true);

    expect(() => loadConfig({ NODE_ENV: 'development', MAIL_PORT: 'abc' })).toThrow(/MAIL_PORT/);
    expect(() => loadConfig({ NODE_ENV: 'development', SITE_URL: 'не-адрес' })).toThrow(/SITE_URL/);
  });

  it('режимы интеграций по умолчанию — заглушки', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c.integrations).toMatchObject({ onecMode: 'stub', paymentMode: 'stub', deliveryMode: 'stub' });
  });
});
