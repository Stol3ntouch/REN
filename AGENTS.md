<!-- autopilot:start -->
# РемТехСад

Интернет-магазин садовой техники и товаров для сада с заявками на ремонт; публичный сайт и закрытая админка, будущий обмен с 1С. Исходные требования — `1/` и `2/` (два пакета ТЗ).
Next.js 16 (App Router) + TypeScript strict + SQLite через `node:sqlite` (Node >= 24), npm. Язык интерфейса и текстов — русский, код — английский, деньги — целые копейки.
Архитектура и потоки данных: `docs/architecture.md`. Что осталось и о чём договорились: `.autopilot/PROGRESS.md`.

## Команды

| Что | Команда |
|-----|---------|
| установка | `npm install` |
| окружение | `cp .env.example .env` (заполнить; значения не коммитить) |
| миграции | `npm run db:migrate` |
| импорт каталога | `npm run import:yml -- <путь к yml>` (флаги `--preview`, `--images`); реальный файл: `.autopilot/2026-10-22-remtehsad-shop--wip/inputs/catalog.yml` |
| демо-данные | `npm run seed:demo` (dev-сид: `npm run db:seed`) |
| администратор | `ADMIN_PASSWORD=<пароль> npm run admin:create -- <логин или email>` |
| dev-сервер | `npm run dev` (порт 3000); другой порт: `npm run dev -- -p 4300` |
| проверка живости | `GET /api/health` |
| вся проверка | `npm run check` (typecheck + lint + vitest; 109 файлов / 1001 тест зелёные) |
| один тест | `npx vitest run tests/<путь>.test.ts` |
| сборка / прод | `npm run build`, `npm run start` |
| бэкап / восстановление | `npm run backup`, `npm run restore -- <файл>` |
| проверка живого сервера | `npm run e2e:live`, `npm run a11y:live` (бюджет JS) |

## Где что

- `src/app` — маршруты, только тонкие обработчики: `(shop)` (витрина, `account`, `cart`, `checkout`, `pay`), `admin/(panel)` (закрытая админка, сервисы в `_lib/*-ops.ts`), `api/*`.
- `src/domain/*` — домен (catalog, pricing, ordering, customers, admin, content, requests, analytics, seo); `src/domain/hooks.ts` — хуки входа.
- `src/server/db` — подключение, `migrations/NNNN_*.sql` (в корне, только вперёд), `repositories/*` — SQL; `src/server/http` — origin, лимиты, сессии; `src/server/config.ts` — env (zod).
- `src/integrations/*` — порты (`onec`, `payment`, `delivery`, `mail`) и заглушки, выбор — `src/integrations/index.ts`; запуск при старте — `src/instrumentation.ts` -> `src/server/startup.ts`.
- `src/importing/yml` и `src/media` — импорт YML и безопасная загрузка фото.
- `src/proxy.ts` + `src/domain/seo/headers.ts` — редирект HTTPS и CSP (единственное место списка внешних хостов).
- `tests/<область>/` (БД на тест: `createTestDb()` из `src/server/db/testing.ts`), `scripts/` (CLI), `data/` (gitignored: sqlite, uploads, backups, outbox).
- `docs/` — деплой, бэкап, 1С, безопасность, env; `docs/adr/` — почему так; `CONTEXT.md` — словарь.

## Подводные камни

- Драйвер БД синхронный (`node:sqlite`): репозитории возвращают значения, не Promise; `withTransaction` синхронна. SQL живёт в `src/server/db/repositories`, исключения: `src/domain/catalog/store.ts`, `src/domain/customers/cards.ts` и другие места вне репозиториев — перед правкой SQL ищи его `grep`-ом.
- Миграции нумеруются по диапазонам (0001, 0100–0199 каталог, 0200 вход, 0300 заказы/оплата, 0400 кабинет, 0500 контент, 0600 заявки/почта, 0700 админка, 0800+); контрольная сумма применённого файла сверяется — применённые не править.
- Windows не различает регистр имён файлов: не создавай пары вроде `placeholder.ts`/`Placeholder.tsx`.
- Состояние интеграций (почтовая очередь, источник популярности, журнал и стартер платежей) — на `globalThis`: модульные переменные не общие между бандлами Next.
- Статус заказа меняет только `orders.transition`; права проверяет `requirePermission` внутри каждого обработчика, не только в UI.
- За прокси в production нужны `TRUST_PROXY=true` и верный `X-Forwarded-Proto: https`; для туннеля без верного заголовка — `HTTPS_REDIRECT=off`, иначе цикл редиректов.
- Тестовая оплата: `PAYMENT_PROVIDER=test`, работает только вне production (в production страница `/pay/test/*` отдаёт 404).
- Фото товаров — внешние ссылки champion.ru (локальной копии нет без `--images`), хост разрешён в CSP; 4 товара без цены (id 217943, 217944, 217946, 217947) не импортируются — это ожидаемо.
- Next.js новой версии: перед кодом читай `node_modules/next/dist/docs/` (в Next 16 `proxy.ts` вместо middleware).
- Метки-заглушки `[… — впиши]` (`placeholder('АДРЕС')`) не заменяй выдуманными фактами — реальные данные даёт владелец.
- Не убивай процессы по всем `node.exe` (`taskkill /im node.exe`): на машине могут работать чужие dev-серверы (порты 3000, 3900).

## Окружение

Имена из `.env.example`, значения — только в локальном `.env`; полное описание — `docs/env.md`.

| Переменная | Для чего |
|------------|----------|
| `NODE_ENV`, `APP_ENV` | режим; production включает обязательные проверки |
| `SITE_URL`, `SESSION_SECRET` | обязательны в production: адрес сайта, секрет сессий и ссылок на заказ |
| `DATABASE_PATH`, `DATA_DIR` | файл SQLite и каталог данных (uploads, backups, outbox, inbox) |
| `TRUST_PROXY` | true — сайт за своим прокси, IP клиента из `X-Forwarded-For` |
| `HTTPS_REDIRECT` | `off` отключает редирект HTTP->HTTPS (только туннели) |
| `IMAGE_HOST_ALLOWLIST` | разрешённые хосты фото при скачивании |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `MAIL_TO` | SMTP и запасной адрес менеджеров; без них письма копятся в `email_outbox` |
| `ONEC_MODE`, `PAYMENT_MODE`, `DELIVERY_MODE` | `stub` (по умолчанию) или `live`; реализаций `live` пока нет |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | провайдер оплаты, его ключ, подпись webhook |
| `ADMIN_PASSWORD` | разовый пароль для `admin:create` |
| `NEXT_DIST_DIR` | отдельная папка сборки, чтобы не затирать `.next` работающего dev |

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».

### Правка без автопилота

Мелкий баг или доводка после сборки — обычная сессия, без прогона.

Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: почему сделано так — `docs/adr/`; что значат слова — `CONTEXT.md`;
   что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).

После правки:
- коммит — по правилам из «История git»;
- строка в «Правки без автопилота» в `PROGRESS.md`: дата — что — почему;
- починенный пункт из «Не доделано» или «Известные баги» — удали;
- договорились с пользователем о том, что следующая сборка не должна пересматривать, —
  строка в «Договорились», его словами.

### История git

Целиком не читай — бери срез под вопрос:

| Вопрос | Команда |
|--------|---------|
| что правили после последней сборки | `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'` |
| всё, что делали ради требования | `git log --oneline --grep="R02"` |
| история файла | `git log --oneline -10 -- <файл>` |
| когда появился или исчез код | `git log --oneline -S "<фрагмент>"` |
| почему строка такая | `git blame -L <с>,<по> <файл>`, затем `git show <sha>` |
| что внутри коммита | `git show --stat <sha>` |

Срез длиннее ~30 коммитов — отдай его субагенту и возьми выжимку в десять строк.

Коммит: заголовок — что (`fix: даты в одном формате`), тело — почему, трейлер
`--trailer "Requirements: R02"`, если правка касается требования из `manifest.md`.
Заголовок `Autopilot: сборка сдана` пишет только автопилот — по нему находят последнюю сборку.
<!-- autopilot:end -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
