import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { withTransaction } from '@/server/db/connection';
import { pagesRepo, pageVersionsRepo, previewTokensRepo, type PageRow, type PageVersionRow, type PageWrite } from '@/server/db/repositories/pages';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { authorize, auditView, copySlug, nul, opt, parse, required, resolve, resolveSlug, flag, stamp, type Ctx, type Session } from './ops-core';
import { canonicalSchema, resolvePublication, statusSchema } from './publication';
import { isPageHideLocked } from './queries';

/**
 * Страницы-CMS. Системные страницы (key задан: О компании, доставка, гарантия, FAQ, условия, политика ПДн) создать и
 * удалить нельзя — только править и скрыть (политику ПДн скрыть нельзя, на неё ссылаются формы). Свои страницы
 * живут по адресу /pages/<slug>. Каждая правка содержимого сохраняет снимок прежней версии (хранится 20 последних).
 */

/** Адреса, которые страница занять не может: маршруты сайта и системные имена. */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  'admin', 'api', 'account', 'cart', 'checkout', 'order', 'pay', 'catalog', 'product', 'search', 'favorites', 'compare',
  'news', 'promotions', 'services', 'contacts', 'buyers', 'about', 'privacy', 'pages', 'sitemap', 'sitemap.xml', 'robots.txt', 'preview', 'login', '_next',
];

const PREVIEW_TTL_MS = 30 * 60_000;

const pageSchema = z.object({
  title: required(200, 'Укажите название'),
  slug: opt(100),
  h1: opt(200),
  seoTitle: opt(200),
  seoDescription: opt(400),
  canonical: canonicalSchema,
  noindex: flag,
  body: opt(50000),
  legalDraft: flag,
  status: statusSchema,
  publishedAt: stamp,
});
export type PageInput = z.input<typeof pageSchema>;

const CONTENT_KEYS = ['title', 'h1', 'body', 'seoTitle', 'seoDescription', 'canonical', 'noindex'] as const;

function contentChanged(a: PageRow, w: PageWrite): boolean {
  return CONTENT_KEYS.some((k) => k in w && (a[k] ?? null) !== (w[k] ?? null));
}

function assertPublishable(page: Pick<PageRow, 'key'> | null, published: boolean): void {
  if (page && isPageHideLocked(page) && !published) {
    throw new ValidationError('Эту страницу нельзя снять с публикации: на неё ссылаются формы сайта (согласие на обработку персональных данных).', { status: ['Недоступно для этой страницы'] });
  }
}

export const pageOps = {
  /**
   * Создание (id = null) и правка. Создание — черновик, пока не указан status. Правка существующей без status
   * сохраняет её нынешний статус и дату публикации.
   */
  async save(session: Session, id: number | null, raw: PageInput, ctx: Ctx = {}): Promise<{ id: number }> {
    authorize(session);
    const { db, now } = resolve(ctx);
    const input = parse(pageSchema, raw);
    const existing = id === null ? null : pagesRepo.get(db, id);
    if (id !== null && !existing) throw new NotFoundError('Страница не найдена');

    const slug = resolveSlug(
      pagesRepo,
      db,
      input.slug,
      input.title,
      existing,
      // системные имена занять нельзя; уже занятый своей страницей адрес не мешает ей же
      RESERVED_PAGE_SLUGS.filter((s) => s !== existing?.slug),
    );
    const publication = resolvePublication(
      { status: input.status ?? (existing ? undefined : 'draft'), publishedAt: input.publishedAt },
      existing ? { published: existing.published, publishedAt: existing.publishedAt } : null,
      now,
    );
    assertPublishable(existing, publication.published);

    const write: PageWrite = {
      slug,
      title: input.title,
      h1: nul(input.h1),
      seoTitle: nul(input.seoTitle),
      seoDescription: nul(input.seoDescription),
      canonical: nul(input.canonical),
      noindex: input.noindex ?? existing?.noindex ?? false,
      body: input.body ?? '',
      legalDraft: input.legalDraft ?? existing?.legalDraft ?? false,
      published: publication.published,
      publishedAt: publication.publishedAt,
    };

    const savedId = withTransaction(db, () => {
      if (existing) {
        if (contentChanged(existing, write)) pageVersionsRepo.snapshot(db, existing, session.staffId, now);
        pagesRepo.update(db, existing.id, write, now);
        return existing.id;
      }
      return pagesRepo.insert(db, { ...write, sort: 100, createdAt: now }, now);
    });
    audit.record(
      {
        actorId: session.staffId,
        actorType: 'staff',
        action: `content.pages.${existing ? 'update' : 'create'}`,
        entity: 'content_pages',
        entityId: savedId,
        before: existing ? auditView(existing) : undefined,
        after: auditView(pagesRepo.get(db, savedId)),
      },
      { db, now },
    );
    return { id: savedId };
  },

  /** Копия страницы: свой адрес, «(копия)» в названии, черновик, не системная. */
  async duplicate(session: Session, id: number, ctx: Ctx = {}): Promise<{ id: number }> {
    authorize(session);
    const { db, now } = resolve(ctx);
    const page = pagesRepo.get(db, id);
    if (!page) throw new NotFoundError('Страница не найдена');
    const newId = pagesRepo.insert(
      db,
      {
        slug: copySlug(pagesRepo, db, page.slug, RESERVED_PAGE_SLUGS),
        title: `${page.title} (копия)`.slice(0, 200),
        h1: page.h1,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        canonical: null,
        noindex: page.noindex,
        body: page.body,
        legalDraft: page.legalDraft,
        published: false,
        publishedAt: null,
        sort: 100,
        createdAt: now,
      },
      now,
    );
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'content.pages.duplicate', entity: 'content_pages', entityId: newId, before: { sourceId: id }, after: auditView(pagesRepo.get(db, newId)) }, { db, now });
    return { id: newId };
  },

  /** Удаление своей страницы. Системные удалить нельзя (скрыть можно). */
  async remove(session: Session, id: number, ctx: Ctx = {}): Promise<void> {
    authorize(session);
    const { db, now } = resolve(ctx);
    const page = pagesRepo.get(db, id);
    if (!page) throw new NotFoundError('Страница не найдена');
    if (page.key !== null) throw new ValidationError('Системную страницу удалить нельзя. Её можно скрыть на сайте.');
    pagesRepo.remove(db, id);
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'content.pages.delete', entity: 'content_pages', entityId: id, before: auditView(page) }, { db, now });
  },

  /** История версий: новые сверху. */
  versions(session: Session, id: number, ctx: Ctx = {}): PageVersionRow[] {
    authorize(session);
    const { db } = resolve(ctx);
    if (!pagesRepo.get(db, id)) throw new NotFoundError('Страница не найдена');
    return pageVersionsRepo.list(db, id);
  },

  /** Откат к версии: текущее состояние сохраняется как новая версия, поля версии возвращаются на страницу. */
  async rollback(session: Session, id: number, versionId: number, ctx: Ctx = {}): Promise<{ id: number }> {
    authorize(session);
    const { db, now } = resolve(ctx);
    const page = pagesRepo.get(db, id);
    if (!page) throw new NotFoundError('Страница не найдена');
    const version = pageVersionsRepo.get(db, id, versionId);
    if (!version) throw new NotFoundError('Версия не найдена');
    withTransaction(db, () => {
      pageVersionsRepo.snapshot(db, page, session.staffId, now);
      pagesRepo.update(
        db,
        id,
        { title: version.title, h1: version.h1, body: version.body, seoTitle: version.seoTitle, seoDescription: version.seoDescription, canonical: version.canonical, noindex: version.noindex },
        now,
      );
    });
    audit.record(
      { actorId: session.staffId, actorType: 'staff', action: 'content.pages.rollback', entity: 'content_pages', entityId: id, before: { title: page.title }, after: { versionId, title: version.title } },
      { db, now },
    );
    return { id };
  },

  /** Скрыть (hidden=true) или вернуть страницу на сайт; политику ПДн скрыть нельзя. Повтор — { changed:false } без аудита. */
  async setHidden(session: Session, id: unknown, hidden: unknown, ctx: Ctx = {}): Promise<{ changed: boolean }> {
    authorize(session);
    const pageIdValue = parse(z.number({ error: 'Страница не найдена' }).int('Страница не найдена').min(1, 'Страница не найдена'), id);
    const flagValue = parse(z.boolean({ error: 'Неверное действие' }), hidden);
    const { db, now } = resolve(ctx);
    return withTransaction(db, () => {
      const page = pagesRepo.get(db, pageIdValue);
      if (!page) throw new NotFoundError('Страница не найдена');
      if (flagValue && isPageHideLocked(page)) {
        throw new ValidationError('Эту страницу скрыть нельзя: на неё ссылаются формы сайта (согласие на обработку персональных данных).');
      }
      if (page.hiddenByAdmin === flagValue) return { changed: false };
      pagesRepo.setHidden(db, page.id, flagValue);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'page.visibility', entity: 'content_pages', entityId: page.id, before: { hidden: !flagValue }, after: { hidden: flagValue } },
        { db, now },
      );
      return { changed: true };
    });
  },
};

// ---------- предпросмотр черновика по одноразовой ссылке ----------

export const previewOps = {
  /** Одноразовая ссылка на предпросмотр страницы или новости (30 минут). Токен в базе хранится только хешем. */
  create(session: Session, entity: 'pages' | 'news', id: number, ctx: Ctx = {}): { url: string; expiresAt: number } {
    authorize(session);
    const { db, now } = resolve(ctx);
    const exists = db.prepare(`SELECT 1 AS ok FROM ${entity} WHERE id = ?`).get(id);
    if (!exists) throw new NotFoundError('Запись не найдена');
    const token = randomBytes(24).toString('base64url');
    previewTokensRepo.purge(db, now);
    previewTokensRepo.insert(db, { token, entity, entityId: id, createdBy: session.staffId, expiresAt: now + PREVIEW_TTL_MS });
    audit.record({ actorId: session.staffId, actorType: 'staff', action: `content.${entity}.preview_link`, entity: `content_${entity}`, entityId: id }, { db, now });
    return { url: `/admin/preview/${token}`, expiresAt: now + PREVIEW_TTL_MS };
  },

  /** Погашает ссылку (один раз). Вызывать только для вошедшего сотрудника; null — ссылка недействительна или уже использована. */
  consume(session: Session, token: string, ctx: Ctx = {}): { entity: 'pages' | 'news'; entityId: number } | null {
    authorize(session);
    const { db, now } = resolve(ctx);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) return null;
    return previewTokensRepo.consume(db, token, now);
  },
};
