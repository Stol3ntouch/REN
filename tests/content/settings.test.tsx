import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getSetting, getSettings, setSetting } from '@/domain/content/settings';
import { loadShellContext } from '@/domain/content/shell';
import { SiteHeader } from '@/ui/layout/SiteHeader';
import { SiteFooter } from '@/ui/layout/SiteFooter';
import { createTestDb } from '@/server/db/testing';

describe('настройки магазина (shop_settings)', () => {
  it('телефон из брифа лежит в начальных настройках, остальные факты пусты', () => {
    const db = createTestDb();
    expect(getSetting('phone', { db })).toBe('+7 916-655-06-06');
    expect(getSetting('address', { db })).toBeNull();
    expect(getSetting('work_hours', { db })).toBeNull();
    expect(getSettings({ db }).phone).toBe('+7 916-655-06-06');
  });

  it('setSetting сохраняет значение; пустая строка стирает ключ; неверный ключ отклоняется', () => {
    const db = createTestDb();
    setSetting('address', 'г. Тест, ул. Садовая, 1', { db });
    expect(getSetting('address', { db })).toBe('г. Тест, ул. Садовая, 1');
    setSetting('address', '   ', { db });
    expect(getSetting('address', { db })).toBeNull();
    expect(() => setSetting('Bad Key!', 'x', { db })).toThrow();
  });
});

describe('шапка и подвал берут данные из настроек', () => {
  it('телефон и логотип выводятся вместо меток, адрес пока — метка', () => {
    const db = createTestDb();
    const shell = loadShellContext({ db });
    const header = renderToStaticMarkup(<SiteHeader shell={shell} />);
    expect(shell.phone).toBe('+7 916-655-06-06');
    expect(header).toContain('href="tel:+79166550606"');
    expect(header).toContain('+7 916-655-06-06');
    expect(header).not.toContain('[ТЕЛЕФОН — впиши]');
    expect(header).not.toContain('[ЛОГОТИП — загрузи]');
    expect(header).toMatch(/<img[^>]*src="\/brand\/logo\.jpg"/);
    expect(header).toMatch(/<img[^>]*alt="РемТехСад"/);
    expect(header).toContain('[АДРЕС — впиши]');
    const footer = renderToStaticMarkup(<SiteFooter shell={shell} />);
    expect(footer).toContain('+7 916-655-06-06');
    expect(footer).toContain('[ЧАСЫ РАБОТЫ — впиши]');
  });

  it('смена телефона и адреса в настройках меняет шапку; соцсети — только заданные', () => {
    const db = createTestDb();
    setSetting('phone', '+7 900 000-00-01', { db });
    setSetting('address', 'ул. Садовая, 5', { db });
    setSetting('social_vk', 'https://vk.com/remtehsad', { db });
    const shell = loadShellContext({ db });
    const header = renderToStaticMarkup(<SiteHeader shell={shell} />);
    expect(header).toContain('tel:+79000000001');
    expect(header).toContain('ул. Садовая, 5');
    expect(header).not.toContain('[АДРЕС — впиши]');
    const footer = renderToStaticMarkup(<SiteFooter shell={shell} />);
    expect(footer).toContain('https://vk.com/remtehsad');
    expect(footer).not.toContain('Telegram');
  });

  it('загруженный логотип заменяет файл по умолчанию без правки кода', () => {
    const db = createTestDb();
    setSetting('logo_path', 'abc123-480.webp', { db });
    expect(loadShellContext({ db }).logoUrl).toBe('/api/catalog/media/abc123-480.webp');
  });

  it('пустые разделы скрыты из меню: новости и акции появляются только с опубликованным содержимым', () => {
    const db = createTestDb();
    const hrefs = (s = loadShellContext({ db })) => (s.nav ?? []).map((i) => i.href);
    expect(hrefs()).not.toContain('/news');
    expect(hrefs()).not.toContain('/promotions');
    expect(hrefs()).toContain('/catalog');
    expect(hrefs()).toContain('/contacts');
  });
});
