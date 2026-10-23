import { z } from 'zod';

/** Ошибка конфигурации. В сообщении только имена переменных, никогда их значения. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

/**
 * Production: NODE_ENV=production или APP_ENV=production. Та же логика, что в integrations/payment/select.ts
 * (дубль намеренный: next.config.ts читает этот файл без алиаса `@/`; совпадение проверяет tests/seo/config-env.test.ts).
 */
export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || env.APP_ENV === 'production';
}

// Пустая строка из .env.example/.env считается «не задано».
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const mode = (values: [string, ...string[]]) => z.preprocess(blankToUndefined, z.enum(values).default(values[0]));

const SCHEMA = z.object({
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  SITE_URL: optional(z.url()),
  SESSION_SECRET: optional(z.string().min(32)),
  DATABASE_PATH: z.preprocess(blankToUndefined, z.string().default('data/rts.sqlite')),
  DATA_DIR: z.preprocess(blankToUndefined, z.string().default('data')),
  TRUST_PROXY: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('false')),
  IMAGE_HOST_ALLOWLIST: z.preprocess(blankToUndefined, z.string().default('champion.ru')),
  MAIL_HOST: optional(z.string()),
  MAIL_PORT: optional(z.coerce.number().int().min(1).max(65535)),
  MAIL_USER: optional(z.string()),
  MAIL_PASSWORD: optional(z.string()),
  MAIL_FROM: optional(z.string()),
  MAIL_TO: optional(z.string()),
  ONEC_MODE: mode(['stub', 'live']),
  PAYMENT_MODE: mode(['stub', 'live']),
  PAYMENT_WEBHOOK_SECRET: optional(z.string()),
  DELIVERY_MODE: mode(['stub', 'live']),
});

/** Обязательные в production и подсказка, что с ними не так (без значений). */
const REQUIRED_IN_PRODUCTION: Record<string, string> = {
  SITE_URL: 'публичный адрес сайта, например https://example.ru',
  SESSION_SECRET: 'случайная строка не короче 32 символов',
};

export type Config = {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  /** Публичный адрес без завершающего «/». */
  siteUrl: string | undefined;
  sessionSecret: string | undefined;
  /** Secure-флаг cookie: включён в production. */
  cookieSecure: boolean;
  databasePath: string;
  dataDir: string;
  /** Доверять X-Forwarded-For (только за своим обратным прокси). */
  trustProxy: boolean;
  imageHostAllowlist: string[];
  mail: { host?: string; port?: number; user?: string; password?: string; from?: string; to?: string };
  integrations: {
    onecMode: string;
    paymentMode: string;
    deliveryMode: string;
    paymentWebhookSecret?: string;
  };
};

/** Разбирает и проверяет окружение. В production без обязательных переменных бросает ConfigError. */
export function loadConfig(env: Env = process.env): Config {
  const parsed = SCHEMA.safeParse(env);
  const problems: string[] = [];

  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')));
    for (const name of names) {
      const hint = REQUIRED_IN_PRODUCTION[name];
      problems.push(hint ? `${name} (${hint})` : `${name} (неверный формат)`);
    }
  }

  const isProduction = isProductionEnv(env);
  if (parsed.success && isProduction) {
    for (const [name, hint] of Object.entries(REQUIRED_IN_PRODUCTION)) {
      if (!parsed.data[name as keyof typeof parsed.data]) problems.push(`${name} (обязательна в production: ${hint})`);
    }
  }

  if (problems.length > 0 || !parsed.success) {
    throw new ConfigError(
      `Некорректная конфигурация окружения. Проверьте переменные: ${problems.join('; ')}. Значения не выводятся; образец — .env.example.`,
    );
  }

  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    siteUrl: e.SITE_URL ? e.SITE_URL.replace(/\/+$/, '') : undefined,
    sessionSecret: e.SESSION_SECRET,
    cookieSecure: isProduction,
    databasePath: e.DATABASE_PATH,
    dataDir: e.DATA_DIR,
    trustProxy: e.TRUST_PROXY === 'true',
    imageHostAllowlist: e.IMAGE_HOST_ALLOWLIST.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    mail: {
      host: e.MAIL_HOST,
      port: e.MAIL_PORT,
      user: e.MAIL_USER,
      password: e.MAIL_PASSWORD,
      from: e.MAIL_FROM,
      to: e.MAIL_TO,
    },
    integrations: {
      onecMode: e.ONEC_MODE,
      paymentMode: e.PAYMENT_MODE,
      deliveryMode: e.DELIVERY_MODE,
      paymentWebhookSecret: e.PAYMENT_WEBHOOK_SECRET,
    },
  };
}

const globalRef = globalThis as unknown as { __rtsConfig?: Config };

/** Конфигурация процесса (читается один раз). */
export function getConfig(): Config {
  if (!globalRef.__rtsConfig) globalRef.__rtsConfig = loadConfig();
  return globalRef.__rtsConfig;
}

/**
 * Для запуска сервера: проверить окружение сразу и остановиться с понятным сообщением,
 * а не упасть на первом запросе. Вызывается из next.config.ts на старте `next start`.
 */
export function assertConfigAtStartup(env: Env = process.env): void {
  loadConfig(env);
}
