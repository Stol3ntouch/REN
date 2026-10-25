import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { notify } from '@/domain/admin/notifications';
import { consent } from '@/domain/customers/consent';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { requestsRepo, type RequestKind } from '@/server/db/repositories/requests';
import { reviewsRepo } from '@/server/db/repositories/reviews';
import { NotFoundError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { isSpamProtectionOn } from '@/domain/content/store-flags';
import { enforceRateLimitByIp } from '@/server/http/rate-limit';
import { callbackSchema, contactSchema, parseForm, questionSchema, repairSchema, reviewSchema } from './schemas';

/** Контекст отправки формы. ip — для лимита; owner — гость или вошедший покупатель (для согласия). */
export type SubmitCtx = { db?: Db; now?: number; ip: string; owner?: OwnerRef | null };
/** Ответ формы. Для пойманного honeypot — {id:null, number:null}: бот видит «успех», ничего не сохраняется. */
export type SubmitResult = { id: number | null; number: string | null };

const HOUR_SEC = 3600;
const LIMIT_FORM = 10;
const LIMIT_REVIEW = 3;
const NOT_STORED: SubmitResult = { id: null, number: null };

/** Honeypot и лимиты форм работают при включённом переключателе «Защита форм от спама» (настройки магазина). */
const isBot = (input: unknown, ctx: SubmitCtx): boolean => {
  if (!isSpamProtectionOn({ db: ctx.db })) return false;
  const v = (input as { website?: unknown } | null)?.website;
  return typeof v === 'string' && v.trim() !== '';
};
const ownerIds = (o?: OwnerRef | null) => ({ userId: o?.kind === 'user' ? o.userId : null, guestId: o?.kind === 'guest' ? o.guestId : null });

type RequestFields = {
  name: string;
  phone?: string | null;
  email?: string | null;
  preferredContact?: 'phone' | 'email' | 'messenger';
  equipmentType?: string;
  repairBrand?: string;
  repairModel?: string;
  message?: string;
  productId?: number;
};

const KIND_TITLES: Record<RequestKind, string> = { repair: 'Новая заявка на ремонт', callback: 'Заказ звонка', contact: 'Новое сообщение', question: 'Вопрос о товаре' };

/** Общий путь заявки: запись + согласие (одна транзакция), затем событие почты. */
function createRequest(kind: RequestKind, source: string, f: RequestFields, ctx: SubmitCtx, mail: { event: string; extra: Record<string, unknown> }): SubmitResult {
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  if (isSpamProtectionOn({ db, now })) enforceRateLimitByIp(`form:${source}`, ctx.ip, LIMIT_FORM, HOUR_SEC, { db, now });

  const owner = ownerIds(ctx.owner);
  const created = withTransaction(db, () => {
    const r = requestsRepo.insert(db, { kind, ...f, ...owner, now });
    const consentId = consent.record({ kind: 'privacy', source, ...owner, subject: r.number }, { db, now });
    requestsRepo.setConsent(db, r.id, consentId);
    requestsRepo.insertEvent(db, { requestId: r.id, at: now, kind: 'created', toStatus: 'new', actorType: 'customer' });
    return r;
  });

  // C09: уведомление сотрудникам (колокольчик админки); сбой уведомления не должен терять заявку
  try {
    notify(
      {
        type: 'request.created',
        title: `${KIND_TITLES[kind]} ${created.number}`,
        body: f.name,
        href: `${kind === 'repair' ? '/admin/repairs' : '/admin/inquiries'}/${created.id}`,
        entity: 'request',
        entityId: created.id,
        audience: kind === 'repair' ? 'permission:repair.write' : 'permission:inquiries.read',
      },
      { db, now },
    );
  } catch {
    /* уведомление вторично */
  }

  enqueueMail(
    mail.event,
    {
      number: created.number,
      name: f.name,
      phone: f.phone ?? undefined,
      customerEmail: f.email ?? undefined,
      to: f.email ?? undefined,
      adminPath: kind === 'repair' ? `/admin/repairs/${created.id}` : `/admin/inquiries/${created.id}`,
      ...mail.extra,
    },
    { db, now },
  );
  return { id: created.id, number: created.number };
}

export async function submitRepair(input: unknown, ctx: SubmitCtx): Promise<SubmitResult> {
  if (isBot(input, ctx)) return NOT_STORED;
  const v = parseForm(repairSchema, input);
  return createRequest(
    'repair',
    'repair',
    { name: v.name, phone: v.phone, email: v.email, preferredContact: v.preferredContact, equipmentType: v.equipmentType, repairBrand: v.brand, repairModel: v.model, message: v.description },
    ctx,
    { event: 'repair.created', extra: { equipmentType: v.equipmentType, preferredContact: v.preferredContact } },
  );
}

export async function submitCallback(input: unknown, ctx: SubmitCtx): Promise<SubmitResult> {
  if (isBot(input, ctx)) return NOT_STORED;
  const v = parseForm(callbackSchema, input);
  return createRequest('callback', 'callback', { name: v.name, phone: v.phone, preferredContact: 'phone' }, ctx, { event: 'callback.created', extra: {} });
}

export async function submitContact(input: unknown, ctx: SubmitCtx): Promise<SubmitResult> {
  if (isBot(input, ctx)) return NOT_STORED;
  const v = parseForm(contactSchema, input);
  return createRequest('contact', 'contact', { name: v.name, email: v.email, phone: v.phone ?? null, message: v.message }, ctx, { event: 'contact.created', extra: {} });
}

export async function submitQuestion(input: unknown, ctx: SubmitCtx): Promise<SubmitResult> {
  if (isBot(input, ctx)) return NOT_STORED;
  const v = parseForm(questionSchema, input);
  const db = ctx.db ?? getDb();
  const product = reviewsRepo.findProduct(db, v.productId);
  if (!product || !product.published) throw new NotFoundError('Товар не найден');
  return createRequest('question', 'question', { name: v.name, email: v.email, message: v.message, productId: product.id }, ctx, {
    event: 'question.created',
    extra: { productName: product.name, adminPath: '/admin/questions' },
  });
}

/** Отзыв: сохраняется как pending и виден публично только после модерации. */
export async function submitReview(input: unknown, ctx: SubmitCtx): Promise<SubmitResult> {
  if (isBot(input, ctx)) return NOT_STORED;
  const v = parseForm(reviewSchema, input);
  const db = ctx.db ?? getDb();
  const now = ctx.now ?? Date.now();
  const product = reviewsRepo.findProduct(db, v.productId);
  if (!product || !product.published) throw new NotFoundError('Товар не найден');
  if (isSpamProtectionOn({ db, now })) enforceRateLimitByIp('form:review', ctx.ip, LIMIT_REVIEW, HOUR_SEC, { db, now });

  const owner = ownerIds(ctx.owner);
  const id = withTransaction(db, () => {
    const reviewId = reviewsRepo.insert(db, { productId: product.id, rating: v.rating, authorName: v.authorName, body: v.body, ...owner, now });
    const consentId = consent.record({ kind: 'privacy', source: 'review', ...owner, subject: `review-${reviewId}` }, { db, now });
    reviewsRepo.setConsent(db, reviewId, consentId);
    return reviewId;
  });
  enqueueMail('review.created', { reviewId: id, productName: product.name, rating: v.rating }, { db, now });
  return { id, number: null };
}
