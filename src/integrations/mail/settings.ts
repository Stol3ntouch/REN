import { maskEmail, maskPhone } from '@/domain/admin/mask';
import { formatRub } from '@/domain/pricing/format';
import type { Db } from '@/server/db/connection';
import { emailTemplatesRepo } from '@/server/db/repositories/email-templates';
import type { OutboxAudience } from '@/server/db/repositories/email-outbox';
import { adminUrl, email, fmtDate, n, orderLines, s, type Payload } from './templates';

/**
 * События писем, получатели, переменные и шаблоны по умолчанию (C12).
 *
 * Свой шаблон хранится в email_templates; нет строки — письмо собирает код (templates.ts) ровно как раньше.
 * Шаблоны по умолчанию здесь записаны с {переменными} и проверены тестом: на тестовых данных они дают тот же текст,
 * что и код, — администратор получает рабочую отправную точку.
 *
 * Правила переменных:
 *  - строка шаблона с пустой «необязательной» переменной (optional) пропускается целиком — как условные строки в коде;
 *  - у менеджеров и администраторов нет переменных с полным email и телефоном клиента (только замаскированные), как и в прежних письмах;
 *  - переменные-ссылки с токеном (сброс пароля, подтверждение, ссылка на заказ) нельзя вставлять в тему письма.
 */

export type MailAudience = OutboxAudience;
export const AUDIENCE_LABELS: Record<MailAudience, string> = { customer: 'Клиент', manager: 'Менеджеры', admin: 'Администраторы' };

export type VarDef = {
  key: string;
  label: string;
  audiences: readonly MailAudience[];
  /** Значение из payload события. */
  get: (p: Payload, audience: MailAudience) => string;
  /** Пустое значение → строка с этой переменной не выводится. */
  optional?: boolean;
  /** Ссылка с токеном или внутренняя: в тему письма не вставляется. */
  link?: boolean;
};

export type EventDef = {
  event: string;
  label: string;
  description: string;
  audiences: readonly MailAudience[];
  /** Получателей, которым отключать письмо нельзя (без письма функция не работает). */
  locked?: readonly MailAudience[];
  /** По умолчанию отправка выключена (новое письмо, которого раньше не было). */
  defaultEnabled?: boolean;
  vars: readonly VarDef[];
  /** Тестовые данные для предпросмотра: вымышленные, в продакшн-данных не участвуют. */
  sample: Payload;
  /** Другие тестовые данные для отдельных получателей (менеджерам уходит только оплата заказа). */
  audienceSample?: Partial<Record<MailAudience, Payload>>;
  /** Переменные, без которых письмо бессмысленно (ссылка сброса пароля). */
  required?: readonly string[];
};

const ALL: readonly MailAudience[] = ['customer', 'manager', 'admin'];
const CM: readonly MailAudience[] = ['customer', 'manager'];

const greeting: VarDef = {
  key: 'greeting',
  label: 'Приветствие («Здравствуйте, Иван!»)',
  audiences: ALL,
  get: (p, a) => (a === 'customer' && s(p.name) ? `Здравствуйте, ${s(p.name)}!` : 'Здравствуйте!'),
};
const customerName: VarDef = { key: 'customer_name', label: 'Имя клиента', audiences: ALL, optional: true, get: (p) => s(p.name) };
const adminLink = (path: (p: Payload) => string): VarDef => ({ key: 'admin_url', label: 'Ссылка в админку', audiences: ['manager', 'admin'], link: true, get: (p) => adminUrl(path(p)) });

const orderVars: VarDef[] = [
  greeting,
  customerName,
  { key: 'order_number', label: 'Номер заказа', audiences: ALL, get: (p) => s(p.orderNumber) },
  { key: 'total', label: 'Итого', audiences: ALL, get: (p) => formatRub(n(p.totalKopecks)) },
  { key: 'delivery_name', label: 'Способ получения', audiences: ALL, get: (p) => s(p.deliveryName) },
  { key: 'delivery_note', label: 'Пометка «стоимость согласует менеджер»', audiences: ['customer'], get: (p) => (p.deliveryPending ? ' (стоимость согласует менеджер)' : '') },
  { key: 'payment_name', label: 'Способ оплаты', audiences: ALL, get: (p) => s(p.paymentName) },
  { key: 'items_list', label: 'Список товаров', audiences: ['customer'], get: (p) => orderLines(p).join('\n') },
  { key: 'items_count', label: 'Число позиций', audiences: ['manager', 'admin'], get: (p) => String(Array.isArray(p.items) ? p.items.length : 0) },
  { key: 'order_url', label: 'Ссылка на заказ', audiences: ['customer'], optional: true, link: true, get: (p) => s(p.orderUrl) },
  adminLink((p) => `/admin/orders/${s(p.orderNumber)}`),
];

const requestVars: VarDef[] = [
  greeting,
  { key: 'number', label: 'Номер обращения', audiences: ALL, get: (p) => s(p.number) },
  customerName,
  { key: 'phone_masked', label: 'Телефон (скрыт частично)', audiences: ['manager', 'admin'], optional: true, get: (p) => (s(p.phone) ? maskPhone(s(p.phone)) : '') },
  { key: 'email_masked', label: 'Email (скрыт частично)', audiences: ['manager', 'admin'], optional: true, get: (p) => (email(p.customerEmail) ? maskEmail(s(p.customerEmail)) : '') },
  { key: 'equipment', label: 'Техника', audiences: ['manager', 'admin'], optional: true, get: (p) => s(p.equipmentType) },
  { key: 'product_name', label: 'Товар', audiences: ['manager', 'admin'], optional: true, get: (p) => s(p.productName) },
  adminLink((p) => s(p.adminPath) || '/admin/requests'),
];

const requestSample: Payload = { to: 'ivan@example.test', name: 'Иван', number: 'REQ-000045', phone: '+7 900 123-45-67', customerEmail: 'ivan@example.test', equipmentType: 'Бензопила', productName: 'Бензопила (пример)', adminPath: '/admin/requests/45' };

export const MAIL_EVENTS: readonly EventDef[] = [
  {
    event: 'order.created',
    label: 'Новый заказ',
    description: 'После оформления заказа: клиенту — подтверждение, менеджерам — уведомление.',
    audiences: CM,
    vars: orderVars,
    sample: {
      to: 'ivan@example.test',
      name: 'Иван',
      orderNumber: 'RTS-000123',
      status: 'new',
      totalKopecks: 1_250_000,
      deliveryName: 'Самовывоз',
      deliveryPending: false,
      deliveryKopecks: 0,
      paymentName: 'Оплата при получении',
      items: [{ name: 'Бензопила (пример)', sku: 'EX-1', qty: 1, unitKopecks: 1_250_000, lineKopecks: 1_250_000 }],
      orderUrl: 'https://shop.example/order/RTS-000123',
    },
  },
  {
    event: 'order.status_changed',
    label: 'Смена статуса заказа',
    description: 'Клиенту — при каждой смене статуса; менеджерам — только при оплате и ошибке оплаты.',
    audiences: CM,
    vars: [
      greeting,
      customerName,
      { key: 'order_number', label: 'Номер заказа', audiences: ALL, get: (p) => s(p.orderNumber) },
      { key: 'status', label: 'Новый статус', audiences: ALL, get: (p) => s(p.statusLabel) || s(p.toStatus) },
      { key: 'payment_title', label: 'Заголовок об оплате', audiences: ['manager', 'admin'], get: (p) => (p.toStatus === 'paid' ? `Оплата заказа ${s(p.orderNumber)} получена` : `Не удалось оплатить заказ ${s(p.orderNumber)}`) },
      { key: 'payment_result', label: 'Результат оплаты', audiences: ['manager', 'admin'], get: (p) => (p.toStatus === 'paid' ? 'оплата получена' : 'оплата не прошла') },
      { key: 'order_url', label: 'Ссылка на заказ', audiences: ['customer'], optional: true, link: true, get: (p) => s(p.orderUrl) },
      adminLink((p) => `/admin/orders/${s(p.orderNumber)}`),
    ],
    sample: { to: 'ivan@example.test', name: 'Иван', orderNumber: 'RTS-000123', toStatus: 'confirmed', statusLabel: 'Подтверждён', orderUrl: 'https://shop.example/order/RTS-000123' },
    audienceSample: { manager: { orderNumber: 'RTS-000123', toStatus: 'paid', statusLabel: 'Оплачен' } },
  },
  { event: 'contact.created', label: 'Новое обращение (сообщение с сайта)', description: 'Форма обратной связи.', audiences: CM, vars: requestVars, sample: requestSample },
  { event: 'callback.created', label: 'Новый заказ звонка', description: 'Форма «Заказать звонок».', audiences: CM, vars: requestVars, sample: requestSample },
  { event: 'question.created', label: 'Новый вопрос о товаре', description: 'Вопрос на странице товара.', audiences: CM, vars: requestVars, sample: requestSample },
  { event: 'repair.created', label: 'Новая заявка на ремонт', description: 'Заявка на ремонт: клиенту — подтверждение, менеджерам — уведомление.', audiences: CM, vars: requestVars, sample: requestSample },
  {
    event: 'request.status_changed',
    label: 'Смена статуса обращения или заявки на ремонт',
    description: 'Клиенту — при смене статуса, если указан email.',
    audiences: ['customer'],
    vars: [
      greeting,
      customerName,
      { key: 'number', label: 'Номер обращения', audiences: ALL, get: (p) => s(p.number) },
      { key: 'status', label: 'Новый статус', audiences: ALL, get: (p) => s(p.statusLabel) },
      { key: 'title', label: 'Тема обращения', audiences: ALL, optional: true, get: (p) => s(p.title) },
    ],
    sample: { to: 'ivan@example.test', name: 'Иван', number: 'REQ-000045', statusLabel: 'Диагностика', title: 'Не заводится бензопила' },
  },
  {
    event: 'auth.password_reset',
    label: 'Восстановление пароля',
    description: 'Ссылка для сброса пароля. Отключить нельзя: без письма пароль не восстановить.',
    audiences: ['customer'],
    locked: ['customer'],
    required: ['reset_url'],
    vars: [
      greeting,
      { key: 'reset_url', label: 'Ссылка для сброса пароля', audiences: ['customer'], link: true, get: (p) => s(p.resetUrl) },
      { key: 'expires_at', label: 'Срок действия ссылки', audiences: ['customer'], optional: true, get: (p) => (n(p.expiresAt) > 0 ? fmtDate(n(p.expiresAt)) : '') },
    ],
    sample: { to: 'ivan@example.test', resetUrl: 'https://shop.example/account/reset/EXAMPLE', expiresAt: Date.UTC(2026, 9, 25, 12, 0) },
  },
  {
    event: 'auth.email_confirm',
    label: 'Подтверждение email',
    description: 'Ссылка подтверждения адреса при регистрации. Отключить нельзя: без неё вход закрыт.',
    audiences: ['customer'],
    locked: ['customer'],
    required: ['confirm_url'],
    vars: [
      greeting,
      { key: 'confirm_url', label: 'Ссылка подтверждения', audiences: ['customer'], link: true, get: (p) => s(p.confirmUrl) },
      { key: 'expires_at', label: 'Срок действия ссылки', audiences: ['customer'], optional: true, get: (p) => (n(p.expiresAt) > 0 ? fmtDate(n(p.expiresAt)) : '') },
    ],
    sample: { to: 'ivan@example.test', confirmUrl: 'https://shop.example/account/confirm/EXAMPLE', expiresAt: Date.UTC(2026, 9, 25, 12, 0) },
  },
  {
    event: 'auth.registered',
    label: 'Регистрация',
    description: 'Приветственное письмо после регистрации. По умолчанию выключено: раньше такого письма не было.',
    audiences: ['customer'],
    defaultEnabled: false,
    vars: [greeting],
    sample: { to: 'ivan@example.test' },
  },
  {
    event: 'review.created',
    label: 'Новый отзыв',
    description: 'Менеджерам — отзыв пришёл на модерацию.',
    audiences: ['manager'],
    vars: [
      greeting,
      { key: 'product_name', label: 'Товар', audiences: ALL, get: (p) => s(p.productName) },
      { key: 'rating', label: 'Оценка', audiences: ALL, get: (p) => String(n(p.rating)) },
      adminLink(() => '/admin/reviews'),
    ],
    sample: { reviewId: 7, productName: 'Бензопила (пример)', rating: 5 },
  },
  {
    event: 'integration.failed',
    label: 'Ошибка интеграции',
    description: 'Администраторам — обмен с внешней системой завершился ошибкой.',
    audiences: ['admin'],
    vars: [
      greeting,
      { key: 'integration', label: 'Интеграция', audiences: ALL, get: (p) => s(p.integration) },
      { key: 'message', label: 'Сообщение об ошибке', audiences: ALL, get: (p) => s(p.message) },
      adminLink(() => '/admin/integrations'),
    ],
    sample: { integration: '1С', message: 'Пример: не найден файл каталога' },
  },
];

export function sampleFor(def: EventDef, audience: MailAudience): Payload {
  return def.audienceSample?.[audience] ?? def.sample;
}

export function eventDef(event: string): EventDef | undefined {
  return MAIL_EVENTS.find((e) => e.event === event);
}

/** Тексты по умолчанию: как в templates.ts, но с {переменными}. */
export const DEFAULT_TEMPLATES: Readonly<Record<string, Partial<Record<MailAudience, { subject: string; body: string }>>>> = {
  'order.created': {
    customer: {
      subject: 'Заказ {order_number} принят',
      body: '{greeting}\nВаш заказ {order_number} принят.\n{items_list}\nДоставка: {delivery_name}{delivery_note}\nОплата: {payment_name}\nИтого: {total}\nСтатус заказа: {order_url}\n\n— РемТехСад',
    },
    manager: {
      subject: 'Новый заказ {order_number}',
      body: '{greeting}\nНовый заказ {order_number} на сумму {total}.\nПозиций: {items_count}.\nОплата: {payment_name}; доставка: {delivery_name}.\nОткрыть в админке: {admin_url}\n\n— РемТехСад',
    },
  },
  'order.status_changed': {
    customer: {
      subject: 'Заказ {order_number}: {status}',
      body: '{greeting}\nСтатус вашего заказа {order_number} изменился: {status}.\nПодробности: {order_url}\n\n— РемТехСад',
    },
    manager: {
      subject: '{payment_title}',
      body: '{greeting}\nЗаказ {order_number}: {payment_result}.\nОткрыть в админке: {admin_url}\n\n— РемТехСад',
    },
  },
  'contact.created': requestDefaults('Сообщение с сайта'),
  'callback.created': requestDefaults('Заказ звонка'),
  'question.created': requestDefaults('Вопрос о товаре'),
  'repair.created': requestDefaults('Заявка на ремонт'),
  'request.status_changed': {
    customer: {
      subject: 'Заявка {number}: {status}',
      body: '{greeting}\nСтатус вашей заявки {number} изменился: {status}.\nТема: {title}.\nЕсли есть вопросы — позвоните или ответьте на это письмо.\n\n— РемТехСад',
    },
  },
  'auth.password_reset': {
    customer: {
      subject: 'Сброс пароля на сайте «РемТехСад»',
      body: '{greeting}\nВы запросили сброс пароля. Перейдите по ссылке, чтобы задать новый пароль:\n{reset_url}\nСсылка действует до {expires_at} (МСК) и сработает один раз.\nЕсли вы не запрашивали сброс — просто проигнорируйте это письмо.\n\n— РемТехСад',
    },
  },
  'auth.email_confirm': {
    customer: {
      subject: 'Подтвердите email на сайте «РемТехСад»',
      body: '{greeting}\nВы зарегистрировались на сайте. Перейдите по ссылке, чтобы подтвердить адрес электронной почты:\n{confirm_url}\nСсылка действует до {expires_at} (МСК) и сработает один раз.\nЕсли вы не регистрировались — просто проигнорируйте это письмо.\n\n— РемТехСад',
    },
  },
  'auth.registered': {
    customer: { subject: 'Вы зарегистрировались на сайте «РемТехСад»', body: '{greeting}\nВы зарегистрировались на сайте «РемТехСад». Спасибо!\n\n— РемТехСад' },
  },
  'review.created': {
    manager: {
      subject: 'Новый отзыв на модерации (товар: {product_name})',
      body: '{greeting}\nНовый отзыв на модерации: товар «{product_name}», оценка {rating} из 5.\nМодерация: {admin_url}\n\n— РемТехСад',
    },
  },
  'integration.failed': {
    admin: {
      subject: 'Ошибка интеграции: {integration}',
      body: '{greeting}\nИнтеграция «{integration}» завершилась с ошибкой.\n{message}\nЖурнал: {admin_url}\n\n— РемТехСад',
    },
  },
};

function requestDefaults(title: string): Partial<Record<MailAudience, { subject: string; body: string }>> {
  return {
    customer: {
      subject: 'Мы получили ваше обращение {number}',
      body: '{greeting}\nМы получили ваше обращение {number} и свяжемся с вами.\n\n— РемТехСад',
    },
    manager: {
      subject: `${title} {number}`,
      body: `{greeting}\n${title} {number}.\nКлиент: {customer_name}.\nТелефон: {phone_masked} (полный — в админке).\nEmail: {email_masked} (полный — в админке).\nТехника: {equipment}.\nТовар: {product_name}.\nОткрыть в админке: {admin_url}\n\n— РемТехСад`,
    },
  };
}

// ---------------------------------------------------------------- рендеринг

const PLACEHOLDER = /\{([^{}]*)\}/g;

function varsFor(def: EventDef, audience: MailAudience): VarDef[] {
  return def.vars.filter((v) => v.audiences.includes(audience));
}

/** Подставляет переменные. Строка с пустой необязательной переменной пропускается целиком. */
export function renderTemplateText(text: string, def: EventDef, audience: MailAudience, payload: Payload): string {
  const vars = new Map(varsFor(def, audience).map((v) => [v.key, v]));
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let drop = false;
    const rendered = line.replace(PLACEHOLDER, (_m, key: string) => {
      const v = vars.get(key);
      if (!v) return '';
      const value = v.get(payload, audience);
      if (v.optional && value === '') drop = true;
      return value;
    });
    if (!drop) out.push(rendered);
  }
  return out.join('\n');
}

/** Письмо включено для события и получателя: свои настройки, иначе значение по умолчанию (включено). */
export function isMailEnabled(db: Db, event: string, audience: MailAudience): boolean {
  const def = eventDef(event);
  if (def?.locked?.includes(audience)) return true;
  const stored = emailTemplatesRepo.findEnabled(db, event, audience);
  if (stored !== null) return stored;
  return def?.defaultEnabled !== false;
}

/** Тема письма: свой шаблон, иначе тема из кода. */
export function effectiveSubject(db: Db, event: string, audience: MailAudience, payload: Payload, fallback: string): string {
  const def = eventDef(event);
  const t = def ? emailTemplatesRepo.findTemplate(db, event, audience) : null;
  if (!def || !t) return fallback;
  const text = renderTemplateText(t.subject, def, audience, payload).replace(/\s+/g, ' ').trim();
  return text === '' ? fallback : text.slice(0, 200);
}

/** Тело письма по своему шаблону; null — шаблона нет, письмо собирает код. */
export function customBody(db: Db, event: string, audience: MailAudience, payload: Payload): string | null {
  const def = eventDef(event);
  const t = def ? emailTemplatesRepo.findTemplate(db, event, audience) : null;
  if (!def || !t) return null;
  return renderTemplateText(t.body, def, audience, payload);
}

// ---------------------------------------------------------------- проверка шаблона

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;

/** Список ошибок шаблона (пусто — шаблон допустим). */
export function templateProblems(event: string, audience: MailAudience, subject: string, body: string): string[] {
  const def = eventDef(event);
  if (!def) return ['Неизвестное событие'];
  if (!def.audiences.includes(audience)) return ['Для этого события такого получателя нет'];
  const problems: string[] = [];
  const vars = new Map(varsFor(def, audience).map((v) => [v.key, v]));
  const available = [...vars.keys()].map((k) => `{${k}}`).join(', ');
  if (subject.trim() === '') problems.push('Укажите тему письма');
  if (subject.length > MAX_SUBJECT) problems.push(`Тема не длиннее ${MAX_SUBJECT} знаков`);
  if (/[\r\n]/.test(subject)) problems.push('Тема должна быть в одну строку');
  if (body.trim() === '') problems.push('Укажите текст письма');
  if (body.length > MAX_BODY) problems.push(`Текст не длиннее ${MAX_BODY} знаков`);
  for (const [field, text] of [['теме', subject], ['тексте', body]] as const) {
    const names = new Set<string>();
    for (const m of text.matchAll(PLACEHOLDER)) {
      const key = m[1] ?? '';
      const v = vars.get(key);
      if (!v) names.add(`{${key}}`);
      else if (field === 'теме' && v.link) problems.push(`Переменную {${key}} нельзя вставлять в тему`);
    }
    if (names.size > 0) problems.push(`Неизвестные переменные в ${field}: ${[...names].join(', ')}. Доступны: ${available}`);
    if (text.replace(PLACEHOLDER, '').match(/[{}]/)) problems.push(`Лишняя фигурная скобка в ${field}: переменные пишутся как {имя}`);
  }
  for (const req of def.required ?? []) {
    if (!body.includes(`{${req}}`)) problems.push(`В тексте должна быть переменная {${req}}: без неё письмо бесполезно`);
  }
  return [...new Set(problems)];
}
