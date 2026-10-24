import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { findPromotionConflict } from '@/domain/pricing/promotion-rules';
import { withTransaction } from '@/server/db/connection';
import { bannersRepo, MAX_HERO_BANNERS } from '@/server/db/repositories/banners';
import { newsRepo } from '@/server/db/repositories/news';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { servicesRepo } from '@/server/db/repositories/services';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { authorize, parse, resolve, type Ctx, type Session } from './ops-core';

/**
 * Быстрое «показать / скрыть» записи из списка, не трогая остальные поля.
 * Баннер: active / inactive (на главной не больше трёх активных). Новость, услуга, акция: опубликована / нет
 * (акция со скидкой проверяется на совместимость, как при сохранении). Страницы скрываются отдельно (pages.setHidden).
 */
const entitySchema = z.enum(['banners', 'news', 'services', 'promotions'], { error: 'Это действие недоступно' });

export const visibilityOps = {
  async set(session: Session, entityRaw: unknown, id: number, show: boolean, ctx: Ctx = {}): Promise<{ changed: boolean }> {
    authorize(session);
    const entity = parse(entitySchema, entityRaw);
    const { db, now } = resolve(ctx);
    return withTransaction(db, () => {
      let before: boolean;
      switch (entity) {
        case 'banners': {
          const row = bannersRepo.get(db, id);
          if (!row) throw new NotFoundError('Запись не найдена');
          before = row.status === 'active';
          if (before === show) return { changed: false };
          if (show && row.position === 'home_hero' && bannersRepo.countActive(db, 'home_hero', id) >= MAX_HERO_BANNERS) {
            throw new ValidationError(`На главной не больше ${MAX_HERO_BANNERS} активных баннеров. Отключите один из существующих.`);
          }
          bannersRepo.update(db, id, { status: show ? 'active' : 'inactive' }, now);
          break;
        }
        case 'news': {
          const row = newsRepo.get(db, id);
          if (!row) throw new NotFoundError('Запись не найдена');
          before = row.published;
          if (before === show) return { changed: false };
          newsRepo.update(db, id, { published: show, publishedAt: show ? (row.publishedAt ?? now) : row.publishedAt }, now);
          break;
        }
        case 'services': {
          const row = servicesRepo.get(db, id);
          if (!row) throw new NotFoundError('Запись не найдена');
          before = row.published;
          if (before === show) return { changed: false };
          servicesRepo.update(db, id, { published: show }, now);
          break;
        }
        case 'promotions': {
          const row = promotionsRepo.get(db, id);
          if (!row) throw new NotFoundError('Запись не найдена');
          before = row.published;
          if (before === show) return { changed: false };
          if (show) {
            const conflict = findPromotionConflict(db, { id, discountType: row.discountType, priority: row.priority, startsAt: row.startsAt, endsAt: row.endsAt, targets: promotionsRepo.targets(db, id) });
            if (conflict) {
              throw new ValidationError(`На товар «${conflict.productName}» в те же даты уже действует акция «${conflict.promotionTitle}» с таким же приоритетом. Задайте разный приоритет.`);
            }
          }
          promotionsRepo.update(db, id, { published: show }, now);
          break;
        }
      }
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: `content.${entity}.visibility`, entity: `content_${entity}`, entityId: id, before: { visible: before }, after: { visible: show } },
        { db, now },
      );
      return { changed: true };
    });
  },
};
