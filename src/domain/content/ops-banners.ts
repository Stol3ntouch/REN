import { z } from 'zod';
import { bannersRepo, BANNER_POSITIONS, MAX_HERO_BANNERS, type BannerRow, type BannerWrite } from '@/server/db/repositories/banners';
import { ValidationError } from '@/server/http/errors';
import { image, int, link, makeOps, nul, opt, required, stamp, type Ctx, type Session } from './ops-core';

/**
 * Баннеры. Позиции: home_hero (слайдер главной, активных не больше трёх), category (страница категории; привязка к
 * категориям — banner_categories), top_strip (полоса над шапкой), home_middle. Тексты — ровно те, что ввёл администратор.
 * Ссылка — путь на сайте или http(s). Показ по датам starts_at/ends_at и статусу.
 */
const categoryLink = z.object({
  categoryId: z.number().int().min(1),
  sort: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

const bannerSchema = z
  .object({
    title: required(120, 'Укажите название баннера'),
    heading: opt(200),
    subheading: opt(300),
    buttonText: opt(60),
    url: link,
    alt: opt(200),
    position: z.enum(BANNER_POSITIONS, { error: 'Неизвестная позиция баннера' }).optional(),
    startsAt: stamp,
    endsAt: stamp,
    sort: int,
    status: z.enum(['active', 'inactive'], { error: 'Неизвестный статус' }).optional(),
    image,
    mobileImage: image,
    categoryIds: z.array(z.number().int().min(1)).max(300).optional(),
    categoryLinks: z.array(categoryLink).max(300).optional(),
  })
  .refine((v) => v.startsAt == null || v.endsAt == null || v.endsAt >= v.startsAt, { message: 'Дата окончания раньше даты начала', path: ['endsAt'] });

type BannerInput = z.infer<typeof bannerSchema>;

function linksOf(input: BannerInput): { categoryId: number; sort: number; enabled: boolean }[] | undefined {
  if (input.categoryLinks) return input.categoryLinks.map((l, i) => ({ categoryId: l.categoryId, sort: l.sort ?? i, enabled: l.enabled ?? true }));
  if (input.categoryIds) return [...new Set(input.categoryIds)].map((categoryId, i) => ({ categoryId, sort: i, enabled: true }));
  return undefined;
}

export const bannerOps = makeOps<BannerRow, BannerWrite, BannerInput>({
  entity: 'banners',
  repo: { ...bannersRepo, slugTaken: () => false },
  schema: bannerSchema,
  hasImage: true,
  imageSlots: [
    { field: 'image', pathKey: 'imagePath', variantsKey: 'imageVariants' },
    { field: 'mobileImage', pathKey: 'mobileImagePath', variantsKey: 'mobileImageVariants' },
  ],
  validate: (i, existing, { db }) => {
    const position = i.position ?? existing?.position ?? 'home_hero';
    const status = i.status ?? existing?.status ?? 'active';
    if (position === 'home_hero' && status === 'active' && bannersRepo.countActive(db, 'home_hero', existing?.id) >= MAX_HERO_BANNERS) {
      throw new ValidationError(`На главной не больше ${MAX_HERO_BANNERS} активных баннеров. Отключите или удалите один из существующих.`, { status: ['Достигнут предел баннеров главной'] });
    }
    if (position === 'top_strip' && !nul(i.heading)) {
      throw new ValidationError('Для полосы над шапкой нужен заголовок: это её текст', { heading: ['Укажите текст полосы'] });
    }
    const links = linksOf(i);
    if (links) {
      const known = bannersRepo.existingCategoryIds(db, links.map((l) => l.categoryId));
      const missing = links.find((l) => !known.has(l.categoryId));
      if (missing) throw new ValidationError('Одной из выбранных категорий не существует', { categoryIds: ['Категория не найдена'] });
    }
  },
  build: (i, existing) => ({
    title: i.title,
    heading: nul(i.heading),
    subheading: nul(i.subheading),
    buttonText: nul(i.buttonText),
    url: nul(i.url),
    alt: nul(i.alt),
    position: i.position ?? existing?.position ?? 'home_hero',
    startsAt: i.startsAt ?? null,
    endsAt: i.endsAt ?? null,
    sort: i.sort ?? existing?.sort ?? 0,
    status: i.status ?? existing?.status ?? 'active',
    ...(existing ? {} : { createdAt: Date.now() }),
  }),
  afterSave: (id, i, _existing, { db }) => {
    const links = linksOf(i);
    if (links) bannersRepo.replaceCategories(db, id, links);
  },
  afterDuplicate: (newId, sourceId, { db }) =>
    bannersRepo.replaceCategories(
      db,
      newId,
      bannersRepo.listCategories(db, sourceId).map((l) => ({ categoryId: l.categoryId, sort: l.sort, enabled: l.enabled })),
    ),
  duplicate: (row) => ({
    title: `${row.title} (копия)`.slice(0, 120),
    imagePath: row.imagePath,
    imageVariants: row.imageVariants,
    mobileImagePath: row.mobileImagePath,
    mobileImageVariants: row.mobileImageVariants,
    alt: row.alt,
    heading: row.heading,
    subheading: row.subheading,
    buttonText: row.buttonText,
    url: row.url,
    position: row.position,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    sort: row.sort + 1,
    status: 'inactive',
    createdAt: Date.now(),
  }),
});

export type { Ctx, Session };
