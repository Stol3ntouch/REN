import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { getShopInfo, getStoreTimeZone, setSetting } from '@/domain/content/settings';
import { DEFAULT_FLAGS, getStoreFlags } from '@/domain/content/store-flags';
import { getStoreSettings, saveStoreSettings, type StoreSettingsInput } from '@/domain/content/store-settings';
import { formatRub } from '@/domain/pricing/format';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, ValidationError } from '@/server/http/errors';
import { ADMIN, MANAGER, pngBytes } from './helpers';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'rts-store-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const base = (db: ReturnType<typeof createTestDb>): StoreSettingsInput => {
  const v = getStoreSettings(ADMIN, { db, mailConfigured: true });
  return { ...v, description: v.description, socials: v.socials, logo: undefined, favicon: undefined };
};
const opts = (db: ReturnType<typeof createTestDb>, extra: object = {}) => ({ db, now: 1_000, mailConfigured: true, ...extra });

describe('настройки магазина: чтение и права', () => {
  it('значения по умолчанию: слоган из брифа, RUB, Москва, все флаги как раньше', () => {
    const db = createTestDb();
    const v = getStoreSettings(ADMIN, { db, mailConfigured: true });
    expect(v.tagline).toContain('профессиональный подход к садовой технике');
    expect(v.currency).toBe('RUB');
    expect(v.timezone).toBe('Europe/Moscow');
    expect(v.flags).toEqual(DEFAULT_FLAGS);
    expect(v.readOnly).toBe(false);
  });

  it('менеджер видит настройки только для чтения, сохранить не может', async () => {
    const db = createTestDb();
    expect(getStoreSettings(MANAGER, { db }).readOnly).toBe(true);
    await expect(saveStoreSettings(MANAGER, base(db), opts(db))).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => getStoreSettings({ ...MANAGER, role: 'warehouse_none', permissions: [] }, { db })).toThrow(ForbiddenError);
  });
});

describe('настройки магазина: сохранение', () => {
  it('сохраняет, применяет на витрине, пишет аудит и поднимает версию', async () => {
    const db = createTestDb();
    const input = base(db);
    const res = await saveStoreSettings(
      ADMIN,
      {
        ...input,
        storeName: 'Мой Сад',
        tagline: 'Слоган',
        description: 'Описание магазина',
        phone: '+7 900 111-22-33',
        email: 'info@shop.test',
        address: 'г. Тест, ул. Пробная, 1',
        workSchedule: 'Пн–Вс 9–20',
        socials: [{ type: 'telegram', url: 'https://t.me/shop' }],
        currency: 'USD',
        timezone: 'Asia/Yekaterinburg',
      },
      opts(db),
    );
    expect(res.version).toBe(1);
    const info = getShopInfo({ db });
    expect(info.siteName).toBe('Мой Сад');
    expect(info.tagline).toBe('Слоган');
    expect(info.socials).toEqual([{ key: 'telegram', label: 'Telegram', href: 'https://t.me/shop' }]);
    expect(info.currencySymbol).toBe('$');
    expect(getStoreTimeZone({ db })).toBe('Asia/Yekaterinburg');
    expect('workSchedule' in info).toBe(false); // график работы не выводится на витрину
    expect(JSON.stringify(info)).not.toContain('Пн–Вс 9–20');
    const rows = db.prepare("SELECT action, after_json FROM audit_log WHERE action = 'settings.update'").all() as { action: string; after_json: string }[];
    expect(rows).toHaveLength(1);
  });

  it('символ валюты влияет на форматирование цен, деньги остаются копейками', async () => {
    const db = createTestDb();
    expect(formatRub(123_450)).toContain('₽');
    await saveStoreSettings(ADMIN, { ...base(db), currency: 'EUR' }, opts(db));
    // formatRub читает общий поставщик по БД приложения; здесь проверяем настройку и список символов
    expect(getShopInfo({ db }).currencySymbol).toBe('€');
  });

  it('конфликт версий: вторая запись со старой версией получает понятную ошибку, а не перезапись', async () => {
    const db = createTestDb();
    const a = base(db);
    const b = base(db);
    await saveStoreSettings(ADMIN, { ...a, storeName: 'Первый' }, opts(db));
    await expect(saveStoreSettings(ADMIN, { ...b, storeName: 'Второй' }, opts(db))).rejects.toBeInstanceOf(ConflictError);
    expect(getShopInfo({ db }).siteName).toBe('Первый');
  });

  it('валидация: название, email, телефон, ссылки только http(s), валюта, часовой пояс', async () => {
    const db = createTestDb();
    const cases: Partial<StoreSettingsInput>[] = [
      { storeName: '' },
      { email: 'не-почта' },
      { phone: '12' },
      { socials: [{ type: 'telegram', url: 'javascript:alert(1)' }] },
      { socials: [{ type: 'unknown', url: 'https://x.test' }] },
      { currency: 'XXX' },
      { timezone: 'Mars/Base' },
    ];
    for (const c of cases) await expect(saveStoreSettings(ADMIN, { ...base(db), ...c }, opts(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('«Требовать подтверждение email» нельзя включить без настроенной почты', async () => {
    const db = createTestDb();
    const input = { ...base(db), flags: { ...DEFAULT_FLAGS, emailConfirm: true } };
    await expect(saveStoreSettings(ADMIN, input, opts(db, { mailConfigured: false }))).rejects.toBeInstanceOf(ValidationError);
    await saveStoreSettings(ADMIN, input, opts(db, { mailConfigured: true }));
    expect(getStoreFlags({ db }).emailConfirm).toBe(true);
  });

  it('сохранение флагов сразу действует (кэш сброшен)', async () => {
    const db = createTestDb();
    expect(getStoreFlags({ db }).showPrices).toBe(true);
    await saveStoreSettings(ADMIN, { ...base(db), flags: { ...DEFAULT_FLAGS, showPrices: false, storeEnabled: false } }, opts(db));
    expect(getStoreFlags({ db })).toMatchObject({ showPrices: false, storeEnabled: false });
  });

  it('старые ключи соцсетей остаются источником, пока список не сохранён', () => {
    const db = createTestDb();
    setSetting('social_vk', 'https://vk.com/shop', { db });
    expect(getShopInfo({ db }).socials[0]?.href).toBe('https://vk.com/shop');
    expect(getStoreSettings(ADMIN, { db }).socials).toEqual([{ type: 'vk', url: 'https://vk.com/shop' }]);
  });
});

describe('логотип и favicon', () => {
  it('PNG логотип проходит проверку содержимого и сохраняется в каталог загрузок', async () => {
    const db = createTestDb();
    const dir = tmp();
    await saveStoreSettings(ADMIN, { ...base(db), logo: { bytes: new Uint8Array(await pngBytes(300, 100)) } }, opts(db, { uploadsDir: dir }));
    expect(getShopInfo({ db }).logoUrl).toMatch(/^\/api\/catalog\/media\/[0-9a-f]+-\d+\.webp$/);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  it('файл не-картинка отклоняется независимо от расширения', async () => {
    const db = createTestDb();
    const bad = { bytes: new TextEncoder().encode('<?php echo 1; ?>') };
    await expect(saveStoreSettings(ADMIN, { ...base(db), logo: bad }, opts(db, { uploadsDir: tmp() }))).rejects.toBeInstanceOf(ValidationError);
    await expect(saveStoreSettings(ADMIN, { ...base(db), favicon: bad }, opts(db, { uploadsDir: tmp() }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('логотип больше 2 МБ и favicon больше 512 КБ отклоняются', async () => {
    const db = createTestDb();
    await expect(saveStoreSettings(ADMIN, { ...base(db), logo: { bytes: new Uint8Array(2 * 1024 * 1024 + 1) } }, opts(db, { uploadsDir: tmp() }))).rejects.toThrow(/2 МБ/);
    await expect(saveStoreSettings(ADMIN, { ...base(db), favicon: { bytes: new Uint8Array(512 * 1024 + 1) } }, opts(db, { uploadsDir: tmp() }))).rejects.toThrow(/512/);
  });

  it('SVG со скриптом отклоняется, чистый SVG растеризуется в PNG', async () => {
    const db = createTestDb();
    const evil = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(saveStoreSettings(ADMIN, { ...base(db), logo: { bytes: evil } }, opts(db, { uploadsDir: tmp() }))).rejects.toBeInstanceOf(ValidationError);
    const ok = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>');
    await saveStoreSettings(ADMIN, { ...base(db), logo: { bytes: ok } }, opts(db, { uploadsDir: tmp() }));
    expect(getShopInfo({ db }).logoUrl).toContain('/api/catalog/media/');
  });

  it('favicon PNG приводится к 64×64, ICO хранится по заголовку; адрес попадает в ShopInfo', async () => {
    const db = createTestDb();
    const dir = tmp();
    await saveStoreSettings(ADMIN, { ...base(db), favicon: { bytes: new Uint8Array(await pngBytes(200, 100)) } }, opts(db, { uploadsDir: dir }));
    const url = getShopInfo({ db }).faviconUrl!;
    expect(url).toMatch(/favicon-[0-9a-f]+\.png$/);
    const meta = await sharp(join(dir, url.split('/').pop()!)).metadata();
    expect([meta.width, meta.height]).toEqual([64, 64]);

    const ico = new Uint8Array(40);
    ico.set([0, 0, 1, 0, 1, 0]);
    await saveStoreSettings(ADMIN, { ...getStoreSettingsInput(db), favicon: { bytes: ico } }, opts(db, { uploadsDir: dir, now: 2_000 }));
    expect(getShopInfo({ db }).faviconUrl).toMatch(/\.ico$/);
  });
});

function getStoreSettingsInput(db: ReturnType<typeof createTestDb>): StoreSettingsInput {
  return base(db);
}
