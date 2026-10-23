import { maskEmail, maskPhone } from '@/domain/admin/mask';
import { formatRub } from '@/domain/pricing/format';
import { getConfig } from '@/server/config';
import type { OutboxAudience } from '@/server/db/repositories/email-outbox';

/**
 * События почты и тексты писем (русские). Тело собирается ПРИ ОТПРАВКЕ из payload, в БД не хранится.
 * Письма менеджерам не содержат полных email и телефона клиента — только номер и ссылку в админку.
 *
 * События: order.created, order.status_changed, auth.password_reset, repair.created, callback.created,
 * contact.created, question.created, review.created, integration.failed.
 */
export type Payload = Record<string, unknown>;
export type PlannedMessage = { audience: OutboxAudience; to: string | null; subject: string };

const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const email = (v: unknown): string | null => {
  const t = s(v).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
};

function siteBase(): string {
  try {
    return getConfig().siteUrl ?? '';
  } catch {
    return '';
  }
}
const adminUrl = (path: string): string => `${siteBase()}${path}`;

const KNOWN = new Set([
  'order.created',
  'order.status_changed',
  'auth.password_reset',
  'repair.created',
  'callback.created',
  'contact.created',
  'question.created',
  'review.created',
  'integration.failed',
]);
export const isKnownMailEvent = (event: string): boolean => KNOWN.has(event);

/** Без этих полей письмо бессмысленно (пустая ссылка сброса, без номера заказа): такое не отправляем. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  'order.created': ['orderNumber'],
  'order.status_changed': ['orderNumber', 'toStatus'],
  'auth.password_reset': ['resetUrl'],
  'repair.created': ['number'],
  'callback.created': ['number'],
  'contact.created': ['number'],
  'question.created': ['number'],
  'review.created': ['reviewId'],
  'integration.failed': ['integration'],
};

/** Имена обязательных полей события, которых нет в payload (пусто/не задано). Пустой payload — все поля. */
export function missingPayloadFields(event: string, p: Payload): string[] {
  return (REQUIRED_FIELDS[event] ?? []).filter((k) => p[k] === undefined || p[k] === null || p[k] === '');
}

const REQUEST_TITLES: Record<string, string> = {
  'repair.created': 'Заявка на ремонт',
  'callback.created': 'Заказ звонка',
  'contact.created': 'Сообщение с сайта',
  'question.created': 'Вопрос о товаре',
};

function statusSubject(p: Payload): string {
  const num = s(p.orderNumber);
  if (p.toStatus === 'paid') return `Оплата заказа ${num} получена`;
  if (p.toStatus === 'payment_failed') return `Не удалось оплатить заказ ${num}`;
  return `Заказ ${num}: ${s(p.statusLabel) || s(p.toStatus)}`;
}

/** Кому и с какой темой уходит событие. Пустой список — событие неизвестно или адресатов нет. */
export function planMessages(event: string, p: Payload): PlannedMessage[] {
  switch (event) {
    case 'order.created': {
      const out: PlannedMessage[] = [{ audience: 'manager', to: null, subject: `Новый заказ ${s(p.orderNumber)}` }];
      const to = email(p.to);
      if (to) out.unshift({ audience: 'customer', to, subject: `Заказ ${s(p.orderNumber)} принят` });
      return out;
    }
    case 'order.status_changed': {
      const out: PlannedMessage[] = [];
      const to = email(p.to);
      if (to) out.push({ audience: 'customer', to, subject: statusSubject(p) });
      if (p.toStatus === 'paid' || p.toStatus === 'payment_failed') out.push({ audience: 'manager', to: null, subject: statusSubject(p) });
      return out;
    }
    case 'auth.password_reset': {
      const to = email(p.to);
      return to ? [{ audience: 'customer', to, subject: 'Сброс пароля на сайте «РемТехСад»' }] : [];
    }
    case 'repair.created':
    case 'callback.created':
    case 'contact.created':
    case 'question.created': {
      const title = REQUEST_TITLES[event]!;
      const out: PlannedMessage[] = [{ audience: 'manager', to: null, subject: `${title} ${s(p.number)}` }];
      const to = email(p.to);
      if (to) out.unshift({ audience: 'customer', to, subject: `Мы получили ваше обращение ${s(p.number)}` });
      return out;
    }
    case 'review.created':
      return [{ audience: 'manager', to: null, subject: `Новый отзыв на модерации (товар: ${s(p.productName) || '—'})` }];
    case 'integration.failed':
      return [{ audience: 'admin', to: null, subject: `Ошибка интеграции: ${s(p.integration) || 'без названия'}` }];
    default:
      return [];
  }
}

const MSK = 'Europe/Moscow';
const fmtDate = (ms: number): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MSK }).format(new Date(ms));

function orderLines(p: Payload): string[] {
  const items = Array.isArray(p.items) ? (p.items as Payload[]) : [];
  return items.map((i) => `— ${s(i.name)} × ${n(i.qty)} = ${formatRub(n(i.lineKopecks))}`);
}

/** Тело письма. Не логируется и не хранится. */
export function renderBody(event: string, audience: OutboxAudience, p: Payload): string {
  const lines: string[] = [];
  const greet = audience === 'customer' ? `Здравствуйте${s(p.name) ? `, ${s(p.name)}` : ''}!` : 'Здравствуйте!';
  switch (event) {
    case 'order.created':
      if (audience === 'customer') {
        lines.push(greet, `Ваш заказ ${s(p.orderNumber)} принят.`, ...orderLines(p));
        lines.push(`Доставка: ${s(p.deliveryName)}${p.deliveryPending ? ' (стоимость согласует менеджер)' : ''}`);
        lines.push(`Оплата: ${s(p.paymentName)}`, `Итого: ${formatRub(n(p.totalKopecks))}`);
        if (s(p.orderUrl)) lines.push(`Статус заказа: ${s(p.orderUrl)}`);
      } else {
        lines.push(greet, `Новый заказ ${s(p.orderNumber)} на сумму ${formatRub(n(p.totalKopecks))}.`, `Позиций: ${Array.isArray(p.items) ? p.items.length : 0}.`);
        lines.push(`Оплата: ${s(p.paymentName)}; доставка: ${s(p.deliveryName)}.`, `Открыть в админке: ${adminUrl(`/admin/orders/${s(p.orderNumber)}`)}`);
      }
      break;
    case 'order.status_changed':
      if (audience === 'customer') {
        lines.push(greet, `Статус вашего заказа ${s(p.orderNumber)} изменился: ${s(p.statusLabel) || s(p.toStatus)}.`);
        if (s(p.orderUrl)) lines.push(`Подробности: ${s(p.orderUrl)}`);
      } else {
        lines.push(greet, `Заказ ${s(p.orderNumber)}: ${p.toStatus === 'paid' ? 'оплата получена' : 'оплата не прошла'}.`, `Открыть в админке: ${adminUrl(`/admin/orders/${s(p.orderNumber)}`)}`);
      }
      break;
    case 'auth.password_reset':
      lines.push(greet, 'Вы запросили сброс пароля. Перейдите по ссылке, чтобы задать новый пароль:', s(p.resetUrl));
      if (n(p.expiresAt) > 0) lines.push(`Ссылка действует до ${fmtDate(n(p.expiresAt))} (МСК) и сработает один раз.`);
      lines.push('Если вы не запрашивали сброс — просто проигнорируйте это письмо.');
      break;
    case 'repair.created':
    case 'callback.created':
    case 'contact.created':
    case 'question.created': {
      if (audience === 'customer') {
        lines.push(greet, `Мы получили ваше обращение ${s(p.number)} и свяжемся с вами.`);
        break;
      }
      lines.push(greet, `${REQUEST_TITLES[event]} ${s(p.number)}.`, `Клиент: ${s(p.name)}.`);
      if (s(p.phone)) lines.push(`Телефон: ${maskPhone(s(p.phone))} (полный — в админке).`);
      if (email(p.customerEmail)) lines.push(`Email: ${maskEmail(s(p.customerEmail))} (полный — в админке).`);
      if (s(p.equipmentType)) lines.push(`Техника: ${s(p.equipmentType)}.`);
      if (s(p.productName)) lines.push(`Товар: ${s(p.productName)}.`);
      lines.push(`Открыть в админке: ${adminUrl(s(p.adminPath) || '/admin/requests')}`);
      break;
    }
    case 'review.created':
      lines.push(greet, `Новый отзыв на модерации: товар «${s(p.productName)}», оценка ${n(p.rating)} из 5.`, `Модерация: ${adminUrl('/admin/reviews')}`);
      break;
    case 'integration.failed':
      lines.push(greet, `Интеграция «${s(p.integration)}» завершилась с ошибкой.`, s(p.message), `Журнал: ${adminUrl('/admin/integrations')}`);
      break;
    default:
      break;
  }
  lines.push('', '— РемТехСад');
  return lines.join('\n');
}
