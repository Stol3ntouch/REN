import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskEmail } from '../src/domain/admin/mask';
import { createStaff } from '../src/domain/admin/staff';
import { closeDb, getDb, type Db } from '../src/server/db/connection';
import { AppError } from '../src/server/http/errors';

export type AdminCreateIo = {
  argv: string[];
  env: Record<string, string | undefined>;
  /** Скрытый ввод пароля (без эха). null — ввод недоступен (не TTY). */
  promptPassword: (() => Promise<string>) | null;
  out: (line: string) => void;
  err: (line: string) => void;
  db?: Db;
  now?: number;
};

/** Логин в выводе маскируется: email — как везде, короткое имя — первая и последняя буквы. */
function maskLogin(login: string): string {
  if (login.includes('@')) return maskEmail(login);
  return login.length <= 2 ? '***' : `${login[0]}***${login.slice(-1)}`;
}

/**
 * Создаёт первого (или ещё одного) суперадминистратора. Использование:
 *   npm run admin:create -- admin@example.ru
 * Пароль: переменная ADMIN_PASSWORD или скрытый ввод. Пароль нигде не печатается и не логируется;
 * email в выводе замаскирован. Возвращает код выхода процесса.
 */
export async function runAdminCreate(io: AdminCreateIo): Promise<number> {
  const email = io.argv.find((a) => !a.startsWith('-'));
  if (!email) {
    io.err('Укажите логин или email администратора: npm run admin:create -- Adm   (или admin@example.ru)');
    return 1;
  }

  let password = io.env.ADMIN_PASSWORD;
  if (!password) {
    if (!io.promptPassword) {
      io.err('Пароль не задан: передайте переменную ADMIN_PASSWORD или запустите команду в интерактивном терминале.');
      return 1;
    }
    password = await io.promptPassword();
  }

  try {
    const { staffId } = await createStaff({ email, password, role: 'super_admin' }, { db: io.db, now: io.now, actor: { id: 'cli', type: 'system' } });
    io.out(`Суперадминистратор создан: ${maskLogin(email.trim().toLowerCase())} (id ${staffId}). Вход: /admin/login`);
    return 0;
  } catch (e) {
    io.err(e instanceof AppError ? `Не удалось создать администратора: ${e.message}` : 'Не удалось создать администратора: внутренняя ошибка.');
    return 1;
  }
}

/** Ввод пароля без эха в терминале. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          reject(new Error('Отменено'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const code = await runAdminCreate({
    argv: process.argv.slice(2),
    env: process.env,
    promptPassword: process.stdin.isTTY ? () => promptHidden('Пароль (ввод скрыт): ') : null,
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    db: getDb(),
  });
  closeDb();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Не удалось создать администратора: внутренняя ошибка.');
    process.exitCode = 1;
  });
}
