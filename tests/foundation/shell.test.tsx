import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SiteShell } from '@/ui/layout/SiteShell';
import { placeholder } from '@/ui/placeholder';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '@/ui/states';

describe('placeholder()', () => {
  it('собирает видимую метку-заглушку', () => {
    expect(placeholder('АДРЕС')).toBe('[АДРЕС — впиши]');
    expect(placeholder('ЛОГОТИП', 'загрузи')).toBe('[ЛОГОТИП — загрузи]');
  });
});

describe('каркас страницы', () => {
  const html = renderToStaticMarkup(
    <SiteShell>
      <p>Содержимое страницы</p>
    </SiteShell>,
  );

  it('без данных магазина показывает метки вместо выдуманных фактов', () => {
    expect(html).toContain('[АДРЕС — впиши]');
    expect(html).toContain('[ТЕЛЕФОН — впиши]');
    expect(html).toContain('[ЛОГОТИП — загрузи]');
  });

  it('с данными магазина показывает их, а не метки', () => {
    const filled = renderToStaticMarkup(
      <SiteShell shell={{ siteName: 'Магазин', address: 'ул. Тестовая, 1', phone: '+7 000 000-00-00' }}>
        <p>x</p>
      </SiteShell>,
    );
    expect(filled).toContain('ул. Тестовая, 1');
    expect(filled).toContain('+7 000 000-00-00');
    expect(filled).not.toContain('[АДРЕС — впиши]');
    expect(filled).not.toContain('[ТЕЛЕФОН — впиши]');
  });

  it('в шапке есть звонок, вход и поиск; подпись у поля поиска', () => {
    expect(html).toContain('Заказать звонок');
    expect(html).toContain('Вход');
    expect(html).toMatch(/<form[^>]*role="search"/);
    expect(html).toMatch(/<label[^>]*for="site-search"/);
    expect(html).toContain('id="site-search"');
  });

  it('есть skip-link на основное содержимое и сама цель', () => {
    expect(html).toMatch(/<a[^>]*href="#main"[^>]*>Перейти к содержимому<\/a>/);
    expect(html).toMatch(/<main[^>]*id="main"/);
    expect(html).toContain('Содержимое страницы');
  });

  it('есть меню и подвал с названием магазина', () => {
    expect(html).toMatch(/<nav[^>]*aria-label="Основное меню"/);
    expect(html).toContain('<footer');
    expect(html).toContain('РемТехСад');
  });

  it('«Главная» — первая ссылка и в мобильном, и в десктопном меню; aria-current на /', () => {
    const nav = html.match(/<nav[^>]*aria-label="Основное меню"[\s\S]*?<\/nav>/)![0];
    const mobile = nav.match(/<details[^>]*site-nav__mobile[\s\S]*?<\/details>/)![0];
    const desktop = nav.match(/<ul[^>]*site-nav__desktop[\s\S]*?<\/ul>/)![0];
    for (const part of [mobile, desktop]) {
      const first = part.match(/<a [^>]*>[^<]*<\/a>/)![0];
      expect(first).toContain('href="/"');
      expect(first).toContain('aria-current="page"');
      expect(first).toContain('Главная');
      expect(part.match(/aria-current="page"/g)).toHaveLength(1);
    }
    expect(mobile.slice(0, mobile.indexOf('>'))).not.toContain('open');
  });
});

describe('состояния интерфейса', () => {
  it('loading/empty/error/success имеют подходящие роли и текст', () => {
    expect(renderToStaticMarkup(<LoadingState />)).toMatch(/role="status"[^>]*>.*Загрузка/s);
    expect(renderToStaticMarkup(<EmptyState title="Ничего не найдено" />)).toContain('Ничего не найдено');
    expect(renderToStaticMarkup(<ErrorState>Попробуйте позже</ErrorState>)).toMatch(/role="alert"/);
    expect(renderToStaticMarkup(<SuccessState title="Готово" />)).toMatch(/role="status"[^>]*>.*Готово/s);
  });
});
