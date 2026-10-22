# Интерфейсы и правила проекта

## Правила проекта (для всех исполнителей и ревьюеров)

1. Код и идентификаторы — английские; интерфейс, тексты ошибок, письма — русские. Валюта RUB, деньги — целые копейки (`Money = number`, `*Kopecks` в именах полей БД: `price_kopecks`).
2. Серверу не доверяем: цены, остатки, суммы, права — только пересчёт на сервере. Каждая защищённая операция вызывает `requirePermission(session, 'perm')` **внутри** обработчика/server action.
3. Секреты — только `process.env`, читаются в `src/server/config.ts` (zod-схема, падает при старте в production при отсутствии обязательных). Значения не логируются и не попадают в ответы. `.env.example` — только имена.
4. SQL — только в `src/server/db/**` (репозитории). Параметризованные запросы. Миграции — `migrations/NNNN_name.sql`, только вперёд.
5. Внешние сервисы — только через порты `src/integrations/*` (интерфейс + заглушка). Заглушку не выдавать за production: `status()` возвращает `{ connected:false, mode:'stub' }`, и админка это показывает.
6. Заглушка вместо факта пользователя — видимая метка `[… — впиши]` (хелпер `placeholder('АДРЕС')`), никогда выдуманное значение. Нет выдуманных отзывов/рейтингов/остатков/тарифов.
7. Любая публичная форма: zod-валидация, honeypot-поле `website`, лимит по IP через `rateLimit(key, limit, windowSec)`, чекбокс согласия → запись `consent`.
8. Состояния UI: loading / empty / error / success у каждой загрузки данных и формы. Доступность: focus-visible, подписи, alt, `prefers-reduced-motion`.
9. Тесты: Vitest, временная БД на тест (`createTestDb()`), без сети. Новая логика — тест сначала. Не удалять и не ослаблять тесты. Команда проверки — `npm run check` (typecheck + lint + test).
10. Страницы кабинета/корзины/оформления/админки/поиска с параметрами — `noindex`.
11. Чужие ресурсы по id → 404 (не 403), чтобы не раскрывать существование.
12. Каждое изменение цены/статуса/роли/модерации/настройки/импорта → `audit.record({...})`.

## Раскладка

```
src/
  app/                    Next.js: (shop)/…, account/…, admin/…, api/…  — только тонкие обработчики
  server/
    config.ts             env (zod)
    db/                   connection.ts, migrate.ts, repositories/*.ts, testing.ts
    http/                 session cookies, csrf/origin check, rateLimit, errors
  domain/
    catalog/              search, filters, sorting, pagination, facets
    pricing/              resolvePrice, applyPromo
    ordering/             cart, checkout, order state machine, idempotency
    customers/            auth, password reset, favorites, compare, consent
    content/              pages, slides, news, promotions, services, settings, seo
    requests/             callback, repair, product question, contact, reviews
    admin/                rbac (permissions.ts), audit, staff
    analytics/            aggregates
  importing/yml/          parse, plan (preview), apply, report
  media/                  image intake, SSRF-safe fetch, resize
  integrations/
    onec/                 OneCPort + file stub
    payment/              PaymentPort + test provider + webhook verify
    delivery/             DeliveryPort + manual
    mail/                 MailPort + smtp + outbox
  ui/                     components, theme.css (CSS variables)
migrations/ scripts/ tests/ docs/ data/ (gitignored: sqlite, uploads, backups, outbox)
```

## Границы, решённые в спецификации

### `server/db` — владеет подключением, миграциями, репозиториями
Экспортирует: `getDb(): Db`; `runMigrations(db)`; репозитории с методами на доменных типах (`productsRepo.findBySlug`, `ordersRepo.insertWithItems(tx)`, …); `withTransaction(db, fn)`. Скрывает диалект SQL. Шов тестов: `createTestDb()` — in-memory SQLite с применёнными миграциями.

### `domain/catalog`
Владеет: правилами поиска, фильтров, сортировки, пагинации.
Экспортирует:
```ts
searchProducts(q: CatalogQuery): Promise<{ items: ProductCard[]; total: number; page: number; pageSize: number; hasMore: boolean }>
// CatalogQuery = { categorySlug?, text?, filters: Record<string,string[]>, priceMin?, priceMax?, inStockOnly?, sort: 'name'|'popular'|'price_asc'|'price_desc', page, pageSize=20 }
getFacets(categoryId): Promise<Facet[]>   // правило: ≥3 товара, ≤30 значений
getProductBySlug(slug): Promise<ProductPage|null>
getCategoryTree(): Promise<CategoryNode[]>
getRelatedProducts(productId): Promise<ProductCard[]>
```
Скрывает: FTS5, нормализацию артикула. Порядок всегда заканчивается `id` (стабильность).

### `domain/pricing`
```ts
resolvePrice(p: { priceKopecks:number; discountPriceKopecks?:number|null }): { unit:number; original?:number }
applyPromo(cart: PricedCart, promo: Promo|null, now: Date): { discount:number; error?: PromoError }
```
Чистые функции — шов юнит-тестов.

### `domain/ordering`
```ts
cart.get(ownerRef) / cart.add / cart.setQty / cart.remove / cart.merge(guestRef, userId) / cart.applyPromo(code)
checkout.validate(cartId): Promise<{ ok:true; priced:PricedCart } | { ok:false; changes: Change[] }>
checkout.place(input: { cartId; contact; deliveryMethodId; paymentMethodId; idempotencyKey; consent:true }): Promise<Order>
orders.transition(orderId, to: OrderStatus, actor: Actor, note?): Promise<Order>   // единственная точка смены статуса
orders.getForCustomer(orderNumber, ownerRef) // чужой → null
orders.getByGuestToken(number, token)
```
Статусы и допустимые переходы — в `ordering/status.ts` (таблица), `transition` отказывает на недопустимых. Владеет idempotency (уникальный индекс `idempotency_key`).

### `domain/customers`
`register`, `login`, `logout`, `requestPasswordReset`, `resetPassword`, `getSession(cookies)`, `favorites.toggle/list/merge`, `compare.add/remove/list/merge` (≤4), `consent.record`. Скрывает scrypt, хранение хеша токена сессии, rate-limit входа.

### `domain/admin`
`permissions.ts`: `type Permission = 'orders.read'|'orders.write'|'requests.write'|'reviews.moderate'|'customers.read'|'catalog.read'|'catalog.write'|'promos.write'|'content.write'|'integrations.read'|'integrations.run'|'staff.manage'|'settings.write'|'audit.read'|'analytics.read'`; `ROLE_PERMISSIONS = { admin: all, manager: [...] }` по матрице из `spec.md`. `requirePermission(session, perm)` бросает `ForbiddenError`. `audit.record({actorId, action, entity, entityId, before?, after?})`; `audit.list`.

### `domain/content` и `domain/requests`
Контент: `pages`, `slides(≤3)`, `news`, `promotions`, `services`, `settings(get/set)` с SEO-полями у каждого. Заявки: `submitRepair`, `submitCallback`, `submitQuestion`, `submitContact`, `submitReview`, `moderateReview`; после создания публикуют событие почты `mail.enqueue(event, payload)`.

### `importing/yml`
```ts
parseYml(xml: string): { categories: ParsedCategory[]; offers: ParsedOffer[]; errors: RowError[] }
planImport(parsed, db): Promise<ImportPlan>        // created/updated/skipped/errors, без записи
applyImport(plan, db, opts): Promise<ImportReport> // идемпотентно по (source='yml', externalId)
```
Потоковый или разумный по памяти разбор (файл 3 МБ сейчас, ≤20 МБ допустимо). Изображения ставятся в очередь `media.ingest(url)`.

### `media`
`safeFetchImage(url): Promise<{bytes, mime}>` — allowlist хостов (env `IMAGE_HOST_ALLOWLIST`, по умолчанию `champion.ru`), блок частных/loopback/link-local адресов после DNS-резолва, лимит 5 МБ, таймаут 10 с, без следования редиректам на другие хосты. `storeImage(bytes): Promise<{ path, variants[] }>` — проверка сигнатуры, случайное имя, размеры.

### `integrations/*` (порты)
```ts
interface OneCPort { status(): PortStatus; pullCatalog(): Promise<CatalogBatch>; pushOrder(o: OrderExport): Promise<{ externalId:string }>; pullOrderStatuses(since:Date): Promise<StatusUpdate[]> }
interface PaymentPort { status(): PortStatus; createPayment(o:{orderNumber,amountKopecks,returnUrl}): Promise<{ paymentId:string; redirectUrl:string }>; verifyWebhook(rawBody:string, headers:Headers): WebhookEvent|null; refund(paymentId, amountKopecks): Promise<void> }
interface DeliveryPort { status(): PortStatus; listMethods(): Promise<DeliveryMethod[]>; quote(cart, address): Promise<{ priceKopecks:number|null; manual:boolean }> }
interface MailPort { status(): PortStatus; send(m: Mail): Promise<void> }
type PortStatus = { connected:boolean; mode:'stub'|'live'; note?:string }
```
Выбор реализации — по env в `integrations/index.ts`. Все внешние вызовы с таймаутом и ≤3 повторами; результат пишется в `integration_run`.

## Швы тестов (шт. немного)
`createTestDb()` · чистые функции pricing · `orders.transition` · `checkout.place` (идемпотентность, пересчёт) · `parseYml/planImport/applyImport` на `inputs/catalog.yml` · `verifyWebhook` + обработчик · `requirePermission` на всех защищённых обработчиках · `safeFetchImage` с поддельным DNS-резолвером.

## Что построено завершёнными тасками
(заполняется по ходу)

## Стек, команды, диапазоны (добавлено на этапе плана)

- Node.js 26 (установлен), npm 12. Next.js (App Router, актуальная стабильная на момент T01 — версию фиксирует T01 в `package.json` и в ADR-001), TypeScript strict, Vitest, zod, ESLint. Менеджер пакетов — **только npm** (lock-файл `package-lock.json`, не удалять).
- Команды (T01 создаёт, остальные не переименовывают): `npm install` · `npm run dev` (порт 3000) · `npm run build` · `npm run check` (typecheck + lint + vitest run; **единая проверка**) · один файл: `npx vitest run tests/<путь>.test.ts` · `npm run db:migrate` · `npm run db:seed` (dev-данные, не секреты) · `npm run import:yml -- <путь к yml>` (T02) · `npm run admin:create` (T03) · `npm run backup` / `npm run restore -- <файл>` (T12).
- Данные локально: `data/` (gitignored): `rts.sqlite`, `uploads/`, `backups/`, `onec-outbox/`.
- Миграции — номера по диапазонам, чтобы параллельные таски не столкнулись: T01 `0001–0099`, T02 `0100–0199`, T03 `0200–0299`, T05/T06 `0300–0399`, T07 `0400–0499`, T08 `0500–0599`, T09 `0600–0699`, T10 `0700–0799`, T11/T12 `0800+`.
- Что не трогать: `skills-2.2.0/`, `1/`, `2/` (исходные ТЗ), `.autopilot/` (кроме чтения `inputs/catalog.yml`). Реальный каталог для тестов и seed — копия `.autopilot/2026-10-22-remtehsad-shop--wip/inputs/catalog.yml`; T02 кладёт нужный фрагмент в `tests/fixtures/` (≈30 товаров, но не весь 3 МБ) и умеет читать полный файл по пути.
- Владелец заказа (`OwnerRef`): `{ kind:'user', userId } | { kind:'guest', guestId }`; гость — httpOnly cookie `rts_guest` (T01 создаёт `getOwnerRef(cookies)` и генерацию guestId; T03 подставляет `user`, если есть сессия).
- Сессии: покупатель — cookie `rts_session`, сотрудник — `rts_admin_session` (разные таблицы и cookie).

### Построено T01 (каркас) — коммит см. git log, Requirements: R01i R02i R01 R46 R47 R01.1 R47.1
- Стек зафиксирован в `docs/adr/ADR-001-stack.md` (TypeScript закреплён на 6.0.3 — typescript-eslint не работает с 7.x; `node:sqlite` как драйвер).
- `server/db/connection`: `type Db = DatabaseSync`; `openDatabase(path)`; `getDb()` (синглтон, сам применяет миграции); `closeDb()`; `withTransaction(db, fn)` — **синхронная**, BEGIN IMMEDIATE, вложенность через SAVEPOINT. Драйвер синхронный: репозитории возвращают значения, не Promise (там, где в интерфейсах выше написано Promise, допустимо и синхронное — вызывающие используют `await`/прямое значение единообразно в своём слое).
- `server/db/migrate`: `runMigrations(db,{dir?})`, `getMigrationVersion(db)`; файлы `migrations/NNNN_name.sql`, контрольная сумма сверяется, пропущенные меньшие номера применяются. `server/db/testing`: `createTestDb()` (in-memory с миграциями).
- `server/http/owner`: `OwnerRef`; `GUEST_COOKIE='rts_guest'`; `createGuestId()`; `getOwnerRef(cookies)`; `getOrCreateOwnerRef(cookies)`.
- `server/http/rate-limit`: `rateLimit(key,limit,windowSec,{db?,now?}) → {allowed,remaining,retryAfterSec}` (таблица `rate_limit`); `enforceRateLimit(...)` бросает `RateLimitError`; `clientIp(headers,trustProxy?)`.
- `server/http/origin`: `checkOrigin(req,{allowedOrigins?})`, `assertOrigin`. `server/http/errors`: `AppError, ValidationError(msg, fields), UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, RateLimitError`, `toErrorResponse(err)`. `server/http/health`: `createHealthHandler`.
- `server/config`: `loadConfig/getConfig/assertConfigAtStartup`; поля `isProduction, siteUrl, sessionSecret, cookieSecure, databasePath, dataDir, trustProxy, imageHostAllowlist, mail{…}, integrations{onecMode,paymentMode,deliveryMode,paymentWebhookSecret}`.
- `ui`: `placeholder(label, verb)` и `<Placeholder/>`; `SiteShell/SiteHeader/SiteNav/SiteFooter/SkipLink`; `LoadingState/EmptyState/ErrorState/SuccessState`; `getShellContext()` (T08 подменяет на чтение настроек); `ui/nav.ts` (MAIN_NAV, CALLBACK_HREF, LOGIN_HREF, CART_HREF, SEARCH_ACTION).
- Подключение страниц: файл в `src/app/(shop)/**` автоматически получает шапку/подвал/skip-link/`<main id="main">`; страницы вне группы (account, admin) оборачиваются в `<SiteShell shell={await getShellContext()}>` или имеют свой layout. Новые сиды — `scripts/seed/*.ts` с `default (db)=>void`. Новые env — строкой в `.env.example`.
- Windows не различает регистр имён файлов: не создавать пары вроде `placeholder.ts`/`Placeholder.tsx`.

### Построено T03 (вход, роли, аудит, админ-оболочка) — R03 R19 R34 R35 R34.1 R35.2
- **customers**: `register(input{email,password,consent:true}, ctx{cookies,ip,db?,now?})`, `login({email,password}, ctx) → {userId}`, `logout(cookies)`, `requestPasswordReset({email},{ip,siteUrl?}) → {ok:true}`, `resetPassword({token,password})`, `getSession(cookies) → {userId,email}|null`, **`resolveOwner(cookies) → OwnerRef|null`** (сессия → user, иначе гость), `resolveOrCreateOwner(cookies)`, `consent.record({kind,source,userId?,guestId?,subject?,textVersion?})`, `safeRedirectPath(next,fallback)`, **`registerOnLoginHook((guestId|null,userId)=>void|Promise)`** — вызывается при входе и регистрации (сбой хука вход не ломает); T05/T07 регистрируют слияние корзины/избранного из модуля, гарантированно загружаемого до login/register (напр. импорт в `src/domain/customers/auth` через общий `src/domain/hooks.ts` — T05 создаёт, T07 дополняет).
- **admin**: `type Permission` (15 прав), `ROLE_PERMISSIONS`, `hasPermission(role,perm)`, `requirePermission(session,perm)` (нет сессии → 401, нет права → ForbiddenError 403), `requireStaff(cookies) → StaffSession{staffId,email,name,role}`, `getStaffSession`, `createStaff`, `loginStaff/logoutStaff`, `audit.record({actorId,actorType:'staff'|'user'|'system',action,entity,entityId?,before?,after?},{db?,now?}) → id`, `audit.list({entity?,entityId?,actorId?,action?,limit?,offset?})` (вызывающий проверяет `audit.read`), `maskPii/maskEmail/maskPhone` (для логов — обязанность вызывающих), `type MailEnqueue`, `enqueueMail(event,payload)`, `setMailEnqueue(impl|null)` (T09 подключает реальную очередь; пока `mail_stub_queue`); событие `'auth.password_reset' {to,resetUrl,expiresAt}`.
- Cookies: `rts_session` (HttpOnly, Lax, Secure в prod, 30 дн.), `rts_admin_session` (HttpOnly, Strict, 12 ч).
- Таблицы: `users, user_sessions, password_resets, staff, staff_sessions, login_failures, consents, audit_log` (триггеры запрещают UPDATE/DELETE), `mail_stub_queue`. Репозитории (db первым аргументом): `usersRepo, staffRepo, sessionsRepo, auditRepo` (insert/list), `consentsRepo`.
- **Защитить админ-обработчик**: `export const POST = withStaffPermission('catalog.write', async (req, session) => {...})` из `@/domain/admin/guard` (Origin, 401, 403 внутри); server action: `const s = requireStaff(await cookies()); requirePermission(s,'perm');` затем `audit.record`.
- **Защитить админ-страницу**: первой строкой `const session = await requireStaffPage('orders.read')` из `@/ui/admin/guard` (нет сессии → `/admin/login`; нет права → `/admin?forbidden=1`); страницы — в `src/app/admin/(panel)/…`. `/admin/layout` сам не редиректит — защита обязательна на каждой странице.
- **Пункт навигации**: объект `{key,label,href,permission}` в `ADMIN_NAV` (`src/ui/admin/nav.ts`), виден только при наличии права.

### Построено T02 (каталог из YML) — R39 R39.1 R39.2 R40 R45 R36(частично) R38.1 R04
- Импорт реального файла: 185 категорий, **1214 товаров** (4 offer без цены — id 217943, 217944, 217946, 217947 — в отчёте ошибок, не созданы), повтор — 0 создано / 0 изменено.
- `parseYml(xml) → {categories, offers, errors}` (бросает `ImportFileError`); `planImport(parsed, db, {fileName?, now?}) → ImportPlan` (синхронно, без записи); `applyImport(plan, db, {now?, actorId?, images?}) → Promise<ImportReport>`; `recordPreview(plan, db, {actorId?})`; `readImportFile(path)`; `sanitizeDescription`, `slugify`; barrel `src/importing/yml/index.ts`. `LOCKABLE_FIELDS = name, sku, description, category, price, in_stock, attributes, images`. CLI: `npm run import:yml -- <file> [--preview] [--images]`. **T10 обязан вызывать `audit.record` вокруг applyImport** (в T02 журнал — `import_runs`).
- Описание товара — санитизированный HTML (белый список тегов без атрибутов), безопасно выводить как HTML.
- media: `safeFetchImage(url,{resolver?,fetch?,allowlist?,maxBytes?,timeoutMs?,maxRedirects?}) → {bytes,mime}` (бросает `ImageFetchError(code)`); `storeImage(bytes,{dir?}) → {path, variants:{key,width,height,path}[], width, height}` (WebP, EXIF удалён, случайное имя, варианты thumb 160 / card 480 / large 960 / full ≤1600, в `DATA_DIR/uploads`, пути относительно него); `isBlockedAddress`, `sniffImageMime`.
- Таблицы: `categories, products, product_images, attribute_definitions, product_attributes, import_runs`. Репозитории (db первым аргументом, **синхронные**): `categoriesRepo{findByExternalId, findBySlug, listAll, allSlugs, count, insert, update}`, `productsRepo{findByExternalId, findBySlug, allSlugs, count, insert, update, touch, setLockedFields}`, `imagesRepo{listByProduct, replaceForProduct, setStored, listPending, count}`, `attributesRepo{listByProduct, replaceForProduct, countDefinitions}`, `importRunsRepo{insert, get, list}`.
- Скачивание фото по сети на реальном хосте не проверялось (тесты на подменах); без `--images` хранится только `url_source` — витрина (T04) должна уметь показывать фото по внешнему URL, пока локальной копии нет (`product_images.path` пуст), и разрешить этот хост в CSP (T11).
