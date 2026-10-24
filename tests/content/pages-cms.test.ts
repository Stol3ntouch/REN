import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { previewOps } from '@/domain/content/ops-pages';
import { contentStatus, getPageByKey, getPageBySlug, listPages } from '@/domain/content/queries';
import { listPublicUrls } from '@/domain/content/urls';
import { auditRepo } from '@/server/db/repositories/audit';
import { pagesRepo, pageVersionsRepo } from '@/server/db/repositories/pages';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ADMIN, MANAGER, T0 } from './helpers';

const DAY = 86_400_000;
const ctx = (db: ReturnType<typeof createTestDb>, now = T0) => ({ db, now });

describe('страницы-CMS: создание, статусы, расписание', () => {
  it('новая страница — черновик: на сайте её нет, в sitemap нет; опубликованная — есть по адресу /pages/<slug>', async () => {
    const db = createTestDb();
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'Как выбрать триммер', body: 'Текст' }, ctx(db));
    expect(pagesRepo.get(db, id)?.published).toBe(false);
    expect(getPageBySlug('kak-vybrat-trimmer', { db, now: T0 })).toBeNull();
    expect(listPublicUrls({ db, now: T0 }).map((u) => u.path)).not.toContain('/pages/kak-vybrat-trimmer');

    await contentOps.pages.save(ADMIN, id, { title: 'Как выбрать триммер', body: 'Текст', status: 'published' }, ctx(db));
    expect(getPageBySlug('kak-vybrat-trimmer', { db, now: T0 })?.title).toBe('Как выбрать триммер');
    expect(listPublicUrls({ db, now: T0 }).map((u) => u.path)).toContain('/pages/kak-vybrat-trimmer');
    expect(auditRepo.list(db, { entity: 'content_pages' }).map((a) => a.action)).toEqual(['content.pages.update', 'content.pages.create']);
  });

  it('запланированная страница появляется сама, когда наступает время; будущая дата обязательна', async () => {
    const db = createTestDb();
    await expect(contentOps.pages.save(ADMIN, null, { title: 'Скоро', status: 'scheduled' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(contentOps.pages.save(ADMIN, null, { title: 'Скоро', status: 'scheduled', publishedAt: T0 - DAY }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'Скоро', status: 'scheduled', publishedAt: T0 + DAY }, ctx(db));
    const row = pagesRepo.get(db, id)!;
    expect(contentStatus(row, T0)).toBe('scheduled');
    expect(getPageBySlug('skoro', { db, now: T0 })).toBeNull();
    expect(getPageBySlug('skoro', { db, now: T0 + DAY - 1 })).toBeNull();
    expect(getPageBySlug('skoro', { db, now: T0 + DAY })?.id).toBe(id);
    expect(contentStatus(row, T0 + DAY)).toBe('published');
  });

  it('адрес: уникален, не занимает системные маршруты сайта и не пустой', async () => {
    const db = createTestDb();
    await contentOps.pages.save(ADMIN, null, { title: 'Дубль', slug: 'moya', status: 'published' }, ctx(db));
    await expect(contentOps.pages.save(ADMIN, null, { title: 'Другая', slug: 'moya' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    for (const reserved of ['admin', 'api', 'catalog', 'news', 'cart', 'about', 'privacy', 'pages']) {
      await expect(contentOps.pages.save(ADMIN, null, { title: 'Системная', slug: reserved }, ctx(db)), reserved).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(contentOps.pages.save(ADMIN, null, { title: '!!!', slug: '!!!' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('SEO: canonical и noindex сохраняются; чужой протокол в canonical не принимается', async () => {
    const db = createTestDb();
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'SEO', canonical: 'https://remtehsad.example/pages/seo', noindex: true }, ctx(db));
    expect(pagesRepo.get(db, id)).toMatchObject({ canonical: 'https://remtehsad.example/pages/seo', noindex: true });
    await expect(contentOps.pages.save(ADMIN, id, { title: 'SEO', canonical: 'javascript:alert(1)' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('страницы-CMS: системные страницы и права', () => {
  it('системную страницу удалить нельзя (скрыть можно), свою — можно; политику ПДн нельзя снять с публикации', async () => {
    const db = createTestDb();
    const faq = getPageByKey('faq', { db })!;
    await expect(contentOps.pages.remove(ADMIN, faq.id, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    expect(pagesRepo.get(db, faq.id)).not.toBeNull();
    await expect(contentOps.pages.setHidden(ADMIN, faq.id, true, ctx(db))).resolves.toEqual({ changed: true });

    const privacy = getPageByKey('privacy', { db })!;
    await expect(contentOps.pages.save(ADMIN, privacy.id, { title: privacy.title, slug: privacy.slug, body: privacy.body, status: 'draft' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(contentOps.pages.setHidden(ADMIN, privacy.id, true, ctx(db))).rejects.toBeInstanceOf(ValidationError);

    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'Временная' }, ctx(db));
    await contentOps.pages.remove(ADMIN, id, ctx(db));
    expect(pagesRepo.get(db, id)).toBeNull();
    expect(auditRepo.list(db, { entity: 'content_pages' }).map((a) => a.action)).toContain('content.pages.delete');
  });

  it('метка «ЧЕРНОВИК — проверить юристом» и тексты системных страниц не теряются при сохранении без status', async () => {
    const db = createTestDb();
    const terms = getPageByKey('terms', { db })!;
    expect(terms.legalDraft).toBe(true);
    await contentOps.pages.save(ADMIN, terms.id, { title: terms.title, slug: terms.slug, body: 'Новые условия', legalDraft: true }, ctx(db));
    const after = getPageByKey('terms', { db, now: T0 })!;
    expect(after).toMatchObject({ legalDraft: true, body: 'Новые условия', published: true });
    expect(listPages({ db, now: T0 }).length).toBeGreaterThanOrEqual(6);
  });

  it('менеджер — 403, без сессии — 401 на всех операциях страниц', async () => {
    const db = createTestDb();
    const faq = getPageByKey('faq', { db })!;
    await expect(contentOps.pages.save(MANAGER, null, { title: 'x' }, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.pages.duplicate(MANAGER, faq.id, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.pages.remove(null, faq.id, ctx(db))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(contentOps.pages.rollback(MANAGER, faq.id, 1, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => previewOps.create(MANAGER, 'pages', faq.id, ctx(db))).toThrow(ForbiddenError);
  });

  it('дублирование: копия — несистемный черновик со своим адресом', async () => {
    const db = createTestDb();
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'Оригинал', slug: 'original', body: 'Текст', status: 'published' }, ctx(db));
    const copy = pagesRepo.get(db, (await contentOps.pages.duplicate(ADMIN, id, ctx(db))).id)!;
    expect(copy).toMatchObject({ key: null, published: false, body: 'Текст', title: 'Оригинал (копия)' });
    expect(copy.slug).not.toBe('original');
  });
});

describe('страницы-CMS: версии и откат', () => {
  it('правка сохраняет прежнюю версию; хранится не меньше 5 последних; откат возвращает текст и сам оставляет версию', async () => {
    const db = createTestDb();
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'История', body: 'v0', status: 'published' }, ctx(db, T0));
    for (let n = 1; n <= 7; n++) await contentOps.pages.save(ADMIN, id, { title: 'История', body: `v${n}`, status: 'published' }, ctx(db, T0 + n));
    const versions = pageVersionsRepo.list(db, id);
    expect(versions.length).toBeGreaterThanOrEqual(5);
    expect(versions.map((v) => v.body).slice(0, 3)).toEqual(['v6', 'v5', 'v4']);
    expect(pagesRepo.get(db, id)?.body).toBe('v7');

    const v5 = versions.find((v) => v.body === 'v5')!;
    await contentOps.pages.rollback(ADMIN, id, v5.id, ctx(db, T0 + 100));
    expect(pagesRepo.get(db, id)?.body).toBe('v5');
    expect(pageVersionsRepo.list(db, id)[0]?.body).toBe('v7'); // откат сохранил то, что было
    await expect(contentOps.pages.rollback(ADMIN, id, 999_999, ctx(db))).rejects.toBeInstanceOf(NotFoundError);
    expect(auditRepo.list(db, { entity: 'content_pages' }).map((a) => a.action)).toContain('content.pages.rollback');
  });

  it('сохранение без изменений версий не плодит; версии других страниц не откатываются', async () => {
    const db = createTestDb();
    const a = (await contentOps.pages.save(ADMIN, null, { title: 'A', body: 'x', status: 'published' }, ctx(db))).id;
    const b = (await contentOps.pages.save(ADMIN, null, { title: 'B', body: 'y', status: 'published' }, ctx(db))).id;
    await contentOps.pages.save(ADMIN, a, { title: 'A', body: 'x', status: 'published' }, ctx(db));
    expect(pageVersionsRepo.list(db, a)).toHaveLength(0);
    await contentOps.pages.save(ADMIN, a, { title: 'A', body: 'x2', status: 'published' }, ctx(db));
    const va = pageVersionsRepo.list(db, a)[0]!;
    await expect(contentOps.pages.rollback(ADMIN, b, va.id, ctx(db))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('страницы-CMS: предпросмотр по одноразовой ссылке', () => {
  it('ссылка работает один раз, живёт ограниченное время, токен в базе хранится хешем', async () => {
    const db = createTestDb();
    const { id } = await contentOps.pages.save(ADMIN, null, { title: 'Черновик', body: 'секрет' }, ctx(db));
    const { url, expiresAt } = previewOps.create(ADMIN, 'pages', id, ctx(db));
    expect(url).toMatch(/^\/admin\/preview\/[A-Za-z0-9_-]{16,}$/);
    expect(expiresAt).toBeGreaterThan(T0);
    const token = url.split('/').pop()!;
    const stored = db.prepare('SELECT token_hash FROM content_preview_tokens').all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).not.toContain(token);

    expect(previewOps.consume(ADMIN, token, ctx(db, T0 + 1000))).toEqual({ entity: 'pages', entityId: id });
    expect(previewOps.consume(ADMIN, token, ctx(db, T0 + 2000))).toBeNull(); // уже использована

    const second = previewOps.create(ADMIN, 'pages', id, ctx(db)).url.split('/').pop()!;
    expect(previewOps.consume(ADMIN, second, ctx(db, T0 + 31 * 60_000))).toBeNull(); // истекла
    expect(previewOps.consume(ADMIN, 'не-токен', ctx(db))).toBeNull();
    expect(() => previewOps.consume(null, token, ctx(db))).toThrow(UnauthorizedError);
    expect(() => previewOps.create(ADMIN, 'pages', 99_999, ctx(db))).toThrow(NotFoundError);
  });
});
