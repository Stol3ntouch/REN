import { createHash } from 'node:crypto';
import { isProductionEnv as isProd } from './payment/select';
import { getPaymentPort } from './payment/select';
import { selectMailPort } from './mail/ports';
import type { MailPort } from './mail/types';

/**
 * Реестр внешних сервисов для страницы «Интеграции» (C12, ADR-016).
 *
 * Статус считается честно:
 *   не настроено → настроено, не проверено → подключено (только после успешной проверки порта) | ошибка.
 * «Подключено» нельзя получить настройкой: только результатом probe(). Реальных проверок в этой сборке умеет только почта (SMTP verify);
 * платёж, доставка, 1С — заглушки, их probe всегда отвечает «не подключено» с причиной. CRM и аналитика — заготовки портов.
 */

type Env = Record<string, string | undefined>;

export type IntegrationKey = 'payment' | 'delivery' | 'mail' | 'onec' | 'crm' | 'analytics';

export type ProbeResult = { ok: boolean; message: string };
export type ProbeDeps = { env?: Env; mailPort?: MailPort; timeoutMs?: number };

export type IntegrationDef = {
  key: IntegrationKey;
  label: string;
  description: string;
  /** Переменные окружения; secret — значение никогда не читается для показа, только «задан». */
  env: readonly { name: string; purpose: string; secret: boolean }[];
  /** Есть ли в сборке реализация, способная проверить соединение. */
  implemented: boolean;
  configured(env: Env): boolean;
  probe(deps: ProbeDeps): Promise<ProbeResult>;
};

const has = (env: Env, name: string): boolean => (env[name] ?? '').trim() !== '';

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const INTEGRATIONS: readonly IntegrationDef[] = [
  {
    key: 'payment',
    label: 'Онлайн-оплата',
    description: 'Платёжный провайдер. Настоящих провайдеров в сборке пока нет: тестовый режим деньги не списывает и «подключённым» не считается.',
    env: [
      { name: 'PAYMENT_PROVIDER', purpose: 'Выбранный провайдер', secret: false },
      { name: 'PAYMENT_MODE', purpose: 'Режим (stub / live)', secret: false },
      { name: 'PAYMENT_API_KEY', purpose: 'Ключ API провайдера', secret: true },
      { name: 'PAYMENT_WEBHOOK_SECRET', purpose: 'Секрет подписи уведомлений', secret: true },
    ],
    implemented: false,
    configured: (env) => has(env, 'PAYMENT_PROVIDER') && env.PAYMENT_PROVIDER!.trim().toLowerCase() !== 'test' && has(env, 'PAYMENT_API_KEY'),
    async probe({ env = process.env }) {
      const port = getPaymentPort({ env, production: isProd(env) });
      if (port.name === 'none') return { ok: false, message: 'Провайдер не выбран или не поддерживается этой сборкой: онлайн-оплата недоступна' };
      return { ok: false, message: 'Тестовый провайдер: деньги не списываются, боевое соединение не проверяется' };
    },
  },
  {
    key: 'delivery',
    label: 'Служба доставки',
    description: 'Расчёт доставки через внешнюю службу. Пока доставка ручная: стоимость задаёт администратор или рассчитывает менеджер.',
    env: [{ name: 'DELIVERY_MODE', purpose: 'Режим (stub / live)', secret: false }],
    implemented: false,
    configured: (env) => (env.DELIVERY_MODE ?? '').trim() === 'live',
    async probe() {
      return { ok: false, message: 'Реализации внешней службы доставки в сборке нет: используется ручная доставка' };
    },
  },
  {
    key: 'mail',
    label: 'Почта (SMTP)',
    description: 'Отправка писем клиентам и сотрудникам. Без SMTP письма копятся в очереди.',
    env: [
      { name: 'MAIL_HOST', purpose: 'SMTP-сервер', secret: false },
      { name: 'MAIL_PORT', purpose: 'Порт SMTP', secret: false },
      { name: 'MAIL_USER', purpose: 'Пользователь SMTP', secret: true },
      { name: 'MAIL_PASSWORD', purpose: 'Пароль SMTP', secret: true },
      { name: 'MAIL_FROM', purpose: 'Адрес отправителя', secret: false },
      { name: 'MAIL_TO', purpose: 'Запасной адрес менеджеров', secret: false },
    ],
    implemented: true,
    configured: (env) => has(env, 'MAIL_HOST') && has(env, 'MAIL_FROM'),
    async probe({ mailPort, timeoutMs = 15_000 }) {
      const port = mailPort ?? selectMailPort();
      if (!port.status().connected) return { ok: false, message: 'SMTP не настроен' };
      if (!port.verify) return { ok: false, message: 'Этот почтовый порт не умеет проверять соединение' };
      try {
        await withTimeout(port.verify(), timeoutMs, 'SMTP-сервер не ответил вовремя');
        return { ok: true, message: 'SMTP-сервер принял соединение и авторизацию' };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : 'Проверка не удалась' };
      }
    },
  },
  {
    key: 'onec',
    label: '1С / учётная система',
    description: 'Обмен заказами и каталогом. Сейчас работает файловая заглушка (папки data/onec-*), настоящей 1С нет.',
    env: [{ name: 'ONEC_MODE', purpose: 'Режим (stub / live)', secret: false }],
    implemented: false,
    configured: (env) => (env.ONEC_MODE ?? '').trim() === 'live',
    async probe() {
      return { ok: false, message: 'Файловая заглушка: связи с настоящей 1С нет' };
    },
  },
  {
    key: 'crm',
    label: 'CRM',
    description: 'Заготовка порта: интеграция не реализована.',
    env: [],
    implemented: false,
    configured: () => false,
    async probe() {
      return { ok: false, message: 'Порт CRM не реализован' };
    },
  },
  {
    key: 'analytics',
    label: 'Системы аналитики',
    description: 'Заготовка порта: интеграция не реализована.',
    env: [],
    implemented: false,
    configured: () => false,
    async probe() {
      return { ok: false, message: 'Порт аналитики не реализован' };
    },
  },
];

export function integrationDef(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

/**
 * Отпечаток настроек: несекретные значения как есть, у секретов — только «задан» и длина. Смена настроек даёт другой отпечаток,
 * и прежний результат проверки перестаёт считаться. Сами секреты в отпечаток не входят.
 */
export function fingerprintOf(key: IntegrationKey, env: Env = process.env): string {
  const def = integrationDef(key);
  const parts = (def?.env ?? []).map((v) => (v.secret ? `${v.name}=${has(env, v.name) ? `set:${(env[v.name] ?? '').length}` : 'unset'}` : `${v.name}=${(env[v.name] ?? '').trim()}`));
  return createHash('sha256').update(`${key}|${parts.join('|')}`).digest('hex');
}
