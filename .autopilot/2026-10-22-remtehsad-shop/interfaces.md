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

### Построено T04 (витрина каталога) — R04 R04.1 R05 R05.1 R06 R06.1 R07 R07.1 R08 R08.1 R09 R10 R10.1 R10.2
- `searchProducts(q,{db?}) → {items,total,page,pageSize,hasMore}`; `CatalogQuery.filters` ключ = id характеристики (`attribute_definitions.id`) строкой; sort `name|popular|price_asc|price_desc|relevance`; `getFacets(categoryId, ctx?, {db?}) → Facet{id,name,values[{value,count}]}`; `getCategoryTree/getCategoryBySlug/getCategoryBreadcrumbs/getSiblingCategories`; `getProductBySlug(slug)` (только published) → `ProductPage`; `getRelatedProducts(id)` (<2 → [], максимум 8); `parseCatalogParams/buildCatalogQueryString` (URL: q, sort, page, min/max в рублях, stock=1, a<id>); `formatPrice`, `pluralize`.
- Маршруты: `/catalog`, `/catalog/[slug]`, `/product/[slug]`, `/search` (noindex); `GET /api/catalog/products?category=&q=&sort=&page=&min=&max=&stock=&a<id>=`; `GET /api/catalog/media/<путь в DATA_DIR/uploads>`.
- **Хуки**: `setPopularitySource((db)=>SQL 'SELECT product_id AS id, SUM(qty) AS units … GROUP BY …' | null)` — T05 подключает при старте (без него популярность = алфавит); `setDeliveryPaymentTextProvider(()=>string|null)` — T08 (пока метка-заглушка).
- `src/ui/catalog/add-to-cart.ts`: `addToCart(productId, qty=1)` → `POST /api/cart/items {productId,qty}`; после успеха событие `window 'rts:cart-changed'`; qty 1–20.
- Компоненты: `ProductCard({product,priority?})`, `PriceBlock({unitKopecks,originalKopecks?,size})`; **слоты T07**: `src/ui/catalog/slots.tsx` — `CardActionsSlot` (правый верх фото карточки) и `ProductActionsSlot` (рядом с «В корзину»), сейчас `null`.
- Отступление от правила 4: SQL чтения каталога лежит в `src/domain/catalog/store.ts` (внутри domain, не в server/db); сортировка по имени использует SQL-функцию `rts_fold`, регистрируемую на соединении. Внешние фото champion.ru выводятся `<img>` — T11 разрешает хост в CSP.

### Построено T05 (корзина, заказы, промокоды) — R13 R13.1 R13.2 R14 R14.1 R14.2 R15 R16 R16.1 R16.2 R17 R17.1 R20 R31 R31.1 R37 R52.2
- **pricing**: `resolvePrice({priceKopecks,discountPriceKopecks}) → {unit,original?}` (скидка при 0<discount<price); `applyPromo(PricedCart,Promo|null,Date) → {discount,error?}`; `PromoError = not_found|disabled|not_started|expired|limit_reached|min_subtotal`; `formatRub`, `parseRubles`.
- **cart** (`owner: OwnerRef`, opts `{db,now}`): `get, add({productId,qty}), setQty, remove, clear, merge(guestId|null,userId), applyPromo(code) → {cart,error?}, removePromo, acknowledgeChanges, changes` → `CartView{cartId,items[],count,subtotalKopecks,discountKopecks,totalKopecks,promo,promoError,notice?}`.
- **checkout**: `methods() → {delivery,payment}`; `validate(cartId,owner) → {ok:true,priced}|{ok:false,changes[]}`; `place({owner,cartId,contact{name,email,phone,address?,comment?},deliveryMethodId,paymentMethodId,idempotencyKey(16–128),consent:true}) → Order`; owner берётся только из cookies сервера; цены и суммы из входа игнорируются; `CheckoutChangesError` (409, `.changes`).
- **orders**: `transition(orderId,to,Actor,note?) → Order` — единственная точка смены статуса (Actor = staff{staffId,role} | system{reason} | customer); `refund`, `getForCustomer(номер|id,owner) → Order|null`, `getByGuestToken(номер,token)`, `getForStaff`, `listForOwner`, `events(id,{forCustomer})`, `assign`, `addNote`; **`reorder(номер,owner) → {cart,added,skipped[]}`** (для T07). Админ-операции: `orderOps/promoOps/parseOrderFilters` в `ordering/admin-ops.ts` (каждая сама вызывает `requirePermission`; возврат — право `settings.write`).
- **OrderStatus** (10): `new, awaiting_payment, paid, processing, shipped, ready_for_pickup, delivered, cancelled, payment_failed, refunded`. Переходы (`ordering/status.ts`): new→awaiting_payment|processing|cancelled; awaiting_payment→paid|payment_failed|cancelled; payment_failed→awaiting_payment|cancelled; paid→processing|refunded; processing→shipped|ready_for_pickup|cancelled|refunded; shipped→delivered|refunded; ready_for_pickup→delivered|cancelled|refunded; delivered→refunded; cancelled, refunded — конечные. `paid`/`payment_failed` ставит только system; `refunded` — admin или system и только при `is_paid`; оплаченный не отменяется. «Неотменённые» для аналитики = не в `NOT_COUNTED_STATUSES` (cancelled, refunded, payment_failed).
- **API**: `GET /api/cart`; `POST|PATCH|DELETE /api/cart/items {productId,qty}` (ответ — CartView); `POST|DELETE /api/cart/promo`. Ошибки 400/404/403(Origin)/429. Маршруты: `/cart`, `/checkout`, `/order/RTS-000123?t=…`, админ `/admin/orders`, `/admin/promos`.
- **Таблицы**: `delivery_methods, payment_methods(enabled,test_only), promos, carts, cart_items, orders (is_paid, idempotency_key UNIQUE), order_items (снимок: name, sku, unit_kopecks, qty, line_kopecks), order_events`. Репозитории (синхронные, db первым): `cartsRepo, ordersRepo, promosRepo, methodsRepo`. Журнал: `order_events`; аудит — entity `'order'`/`'promo'`.
- **Гостевая ссылка на заказ**: токен = HMAC-SHA256(SESSION_SECRET, "order-access:"+номер), в БД не хранится; смена SESSION_SECRET обнуляет старые ссылки.
- **Для T06**: `ordering/payment-flow.ts` — `setPaymentStarter(order → {redirectUrl}|null)` (вызывается после `place` для kind='online'), `setPaymentRefunder(order → void)`; webhook ставит `orders.transition(id,'paid'|'payment_failed',{type:'system',reason:'webhook:<eventId>'})`; повторный paid→paid бросает 409 — webhook проверяет статус и event id сам. Метод `online_test` (enabled=0, test_only=1) создаёт dev-сид `methodsRepo.insertOnlineTestIfMissing`; включение — `methodsRepo.setPaymentEnabled('online_test',true)`; в production не создаётся и не принимается.
- **Почта** (T09): `enqueueMail('order.created',{to,name,orderNumber,status,subtotalKopecks,discountKopecks,deliveryName,deliveryPending,deliveryKopecks,paymentName,totalKopecks,items[{name,sku,qty,unitKopecks,lineKopecks}],orderUrl})`; `enqueueMail('order.status_changed',{to,name,orderNumber,fromStatus,toStatus,statusLabel,orderUrl})`.
- Слияние гостевой корзины подключено через `src/domain/hooks.ts` (импортируется в `account/(auth)/actions.ts`); T07 дополняет `hooks.ts` слиянием избранного/сравнения. `setPopularitySource` из T04 подключается при старте (проверить в T12 на реальных заказах).

### Построено T06 (оплата и доставка) — R41 R41.1 R42 R17 R16.2
- `PaymentPort {name; status(); createPayment({orderNumber,amountKopecks,returnUrl}) → {paymentId,redirectUrl}; verifyWebhook(rawBody,Headers) → WebhookEvent|null; refund(paymentId,amountKopecks,{idempotencyKey?})}`; `WebhookEvent {eventId,type:'payment.succeeded'|'payment.failed',paymentId,orderNumber,amountKopecks,currency:'RUB',createdAt}`. `DeliveryPort {status(); listMethods(); quote({subtotalKopecks}, address|null, {methodCode?}) → {priceKopecks:number|null, manual}}`; `createManualDelivery(getDb)`, `getDeliveryPort()`.
- `src/integrations/index.ts`: `getPaymentPort`, `getDeliveryPort`, **`integrationsStatus() → [{key:'payment'|'delivery',label,status:{connected:false,mode:'stub',note}}]`** (T10 добавляет onec и mail), `registerPaymentProvider()`.
- Webhook: `POST /api/payment/webhook`, заголовок `x-rts-signature: sha256=<hex HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, сырое тело)>`; ответы 200 (processed|ignored|alert|duplicate), 401 (подпись/форма/валюта не RUB), 400 (неизвестный платёж/заказ, сумма не совпала), 500. Страница `/pay/test/<tp_…>?t=<токен заказа>` — «ТЕСТОВАЯ ОПЛАТА»; в production 404. Пустой секрет в dev → случайный на процесс.
- Таблицы: `payments(order_id, provider, status pending|succeeded|failed|refund_pending|refunded|error, amount_kopecks, currency, external_id UNIQUE, …; один pending на заказ)`, `webhook_events(provider,event_id UNIQUE, outcome received|processed|ignored|alert|error, detail)`. Репозитории `paymentsRepo`, `webhookEventsRepo` (sync).
- **Для T10**: `paymentsRepo.listErrors(db)`, `webhookEventsRepo.listAttention(db)` (alert = «оплата получена по отменённому заказу — нужен возврат»); хук `setPaymentRunLogger(fn)` в `payment/service.ts` — T10 может писать из него в `integration_run`.
- Регистрация провайдера: `payment-flow.ts` лениво подгружает `payment/register.ts`; в production `online_test` выключается; при `PAYMENT_PROVIDER=test` вне production включается автоматически. В тестах `setPaymentAutoRegister(false)`.
- Решения: возврат атомарно резервирует платёж (succeeded→refund_pending), ключ `refund:<orderId>`, второй параллельный клик → 409; webhook paid по отменённому заказу — заказ не меняется, `outcome=alert`; итог 0 ₽ с online — платёж не создаётся, заказ проводится системой в `paid` (reason `zero_total`); `refunded` сотрудником только через `orders.refund`.

### Построено T07 (кабинет, избранное, сравнение) — R18 R20 R21 R21.1
- `favorites.{add,remove,toggle,list,cards,has,count,merge(guestId|null,userId)}(owner, productId, {db?,now?})`, `favoritesCount(owner|null)`, `MAX_FAVORITES=200`; `compare.{add,remove,list,count,merge,table}`, `compareCount(owner|null)`, `MAX_COMPARE=4` (5-й → `ConflictError` 409), `compare.table → {products, rows:{name,values,differs}[]}`; `profile.{get,update}`, `addresses.{list,add,remove}` (≤10, чужой → 404); `accountGate(cookies,next)`; `accountOrders.{list,get,reorder}(userId,…)`; `accountConsents.list(userId)`.
- Маршруты: `/account`, `/account/orders`, `/account/orders/[number]`, `/favorites`, `/compare[?diff=1]`. API: `GET|POST|DELETE /api/favorites`, `/api/compare` ({productId} → {on,ids,count[,max]}); **`GET /api/counters → {cart,favorites,compare}`** (для шапки T08; `?ids=1` добавляет `favoriteIds`, `compareIds`). События окна: `rts:favorites-changed`, `rts:compare-changed`, `rts:cart-changed`.
- БД: `user_profiles, user_addresses, favorites, compare_items (user_id XOR guest_id)`; репозитории `favoritesRepo`, `compareRepo`, `profilesRepo`+`addressesRepo` (в `addresses.ts`). Хуки входа: слияние избранного и сравнения — отдельные `registerOnLoginHook` в `domain/hooks.ts`. Кнопки — в слотах `src/ui/catalog/slots.tsx`.
- Отступление от правила 4: SQL карточек в `domain/customers/cards.ts`.

### Построено T10 (админка: импорт, каталог, 1С, аналитика, сотрудники) — R38 R38.1 R36 R36.1 R35 R35.1 R34 R39 R52 R52.1 R52.3 R47
- **OneCPort** `{name; status(); pullCatalog() → {fileName,xml}|{null,null}; pushOrder(OrderExport) → {externalId,created,conflict?}; pullOrderStatuses(since) → {orderNumber,status,updatedAt}[]}`; `getOnecPort({dataDir?})` из `@/integrations`; файловая заглушка `data/onec-inbox` (*.yml, statuses.json) и `data/onec-outbox/<RTS-номер>.json` (повторный push = `created:false`, иной контент = `conflict`). `integrationsStatus()` теперь включает `onec`. Запуски: `runPushOrders/runPullCatalog/runPullStatuses(ctx,…)` из `@/integrations/onec/service` → `{runId,kind,status,counts,errors}`, пишут `integration_run` + audit. Из 1С допустимы статусы processing|shipped|ready_for_pickup|delivered|cancelled; paid/refunded не принимаются.
- `integration_run(id,kind,status running|ok|partial|error,started_at,finished_at,counts,errors,actor)`; `integrationRunsRepo.start/finish`; **`connectPaymentRunLog()` (`@/integrations/onec/payment-log`) нужно вызвать при старте приложения** (instrumentation.ts — делает T12), иначе журнал платежей не пишется.
- Аналитика `@/domain/analytics`: `parseRange, parseBucket, salesSummary, salesSeries, salesByCategory, salesByProduct, cancellations, overview, newRequests(db)` + **`setNewRequestsSource(fn)` для T09** (или таблицы `requests(kind,status)`/`reviews(status)`), `integrationAttention`, `toCsv/exportCsv` (разделитель `;`). Выручка = `is_paid=1` и статус вне NOT_COUNTED, сутки по Москве.
- **Настройки уведомлений для T09**: таблица `admin_flags(key,value,…)`; `adminFlagsRepo.getRecipients(db)` (`notifications.recipients`, JSON-массив email), `isManualEditEnabled(db)` (`catalog.manualEdit`) из `server/db/repositories/staff-admin.ts`. `product_seo(product_id,seo_title,seo_description)` — SEO товара (витрина T04 его пока не читает → T11).
- Маршруты админки: `/admin`, `/admin/import` (+upload/apply), `/admin/catalog`, `/admin/catalog/[id]`, `/admin/warehouse`, `/admin/integrations`, `/admin/analytics` (+`/export`), `/admin/customers[/id]`, `/admin/staff`, `/admin/settings`, `/admin/audit`. Сервисный слой с `requirePermission`: `src/app/admin/(panel)/_lib/*-ops.ts`.

### Построено T08 (контент, главная, шапка и подвал) — R24 R25 R26 R27 R27.1 R28 R29 R30 R31 R32 R33(страницы) R46 R50 R51 R52 R45
- Настройки: `getSetting(key,{db?}) → string|null`, `getSettings()`, `setSetting(key,value,{db?,now?})` ('' удаляет), `getShopInfo()`, `telHref`; таблица `shop_settings(key,value,updated_at)`; ключи: `phone` (сид +7 916-655-06-06), `address, work_hours, email, latitude, longitude, social_vk/telegram/whatsapp/youtube, requisites, delivery_payment_text, home_h1/home_title/home_description, logo_path`. Другие таски могут добавлять свои ключи (`/^[a-z][a-z0-9_.]{0,63}$/`).
- Таблицы: `pages(key,slug,legal_draft…)`, `slides` (триггер ≤3), `news`, `promotions`, `services`, `company_reviews`; репозитории (sync): `settingsRepo, pagesRepo, slidesRepo, newsRepo, promotionsRepo, servicesRepo, companyReviewsRepo, homeProductsRepo`.
- Операции админа: `contentOps.{settings.save(session,values,ctx), pages.save, slides|news|services|promotions|reviews.save(session,id|null,input,ctx) / .remove}` (право `content.write` — только admin; аудит `content.<entity>.create|update|delete`). Чтение: `listActiveSlides, getPageByKey/getPageBySlug/listPages/pagePath, listPublishedNews/getPublishedNews, listActivePromotions/getPublishedPromotion, listPublishedServices/getPublishedService, listPublishedReviews, getHomeData, loadShellContext`; `getShellContext()` читает настройки и регистрирует `setDeliveryPaymentTextProvider`.
- Маршруты публичные: `/`, `/about`, `/about/reviews`, `/privacy`, `/pages/[slug]` (delivery-payment, warranty-returns, faq, terms), `/buyers`, `/news[/slug]`, `/promotions[/slug]`, `/services[/slug]`, `/contacts`. Админ (только admin): `/admin/content`, `/admin/content/{settings,pages,slides,news,services,promotions,reviews}`; запись — POST multipart `/admin/content/save/<section>`.
- **Якоря для T09**: `/contacts` — `id="callback"` и `id="contact-form"`; страница услуги и список `/services` — `id="repair-form"` (сейчас видимая заглушка с телефоном — заменить телом формы). Шапка «Заказать звонок» → `/contacts#callback`.
- **Для T11**: `listPublicUrls({db?}) → {path,lastModified?}[]` из `@/domain/content/urls` (опубликованные страницы контента; каталог не включён); `contentMetadata({...})` даёт title/description/canonical/OG; SEO-поля у pages/news/services/promotions: title, h1, seoTitle, seoDescription, slug (+imageAlt); главная — `home_*`. Карте нужен CSP `img-src tile.openstreetmap.org`; фавикон `public/brand/favicon-32.png` не подключён в root layout (T11/T12).
- Не подключено: `setPopularitySource` из T04 нигде не вызывается → «Популярные» = избранные админом, пока T12 не добавит `instrumentation.ts` (там же `connectPaymentRunLog`).

### Построено T09 (заявки, отзывы, вопросы, почта) — R02 R11 R11.1 R12 R22 R23 R33 R43 R43.1 R48
- Формы: `submitRepair|Callback|Contact|Question|Review(input, ctx{db?,now?,ip,owner?}) → {id,number|null}` (honeypot `website` → ничего не пишет); лимит по IP: отзыв 3/ч, остальные 10/ч (`form:<вид>:<ip>`). API `POST /api/forms/{repair|callback|contact|question|review}` (JSON: 201 `{ok,number}`; 400 fields; 403 Origin; 404; 413; 429). Формы работают только с JS (fetch). Номера: `REM-/ZV-/MSG-/VOP-######`.
- Админ: `requestsAdmin.list/update(session,id,{status?,note?})` (право `requests.write`; статусы `new|in_work|done|cancelled`), `reviewsAdmin.list/moderate(session,id,'published'|'rejected')` (`reviews.moderate`), `mailAdmin.overview/retry` (только admin). `getProductRating(id) → {average|null,count}`, `listPublishedReviews(id)`.
- Таблицы: `requests(kind,status,number,note,consent_id)`, `reviews(status pending|published|rejected)`, `email_outbox(audience customer|manager|admin, dedupe_key UNIQUE, status pending|sending|sent|failed, attempts, payload очищается после отправки)`. Аналитика T10 читает именно эти таблицы.
- Почта: `MailPort{name,status(),send({to[],subject,text})}`; SMTP при `MAIL_HOST`+`MAIL_FROM`, иначе заглушка (`connected:false`); `enqueueMailEvent(db,event,payload)`, `processOutbox({db,port,now?}) → {sent,failed,retried,deferred}`; `MAX_ATTEMPTS=3` (паузы 1 и 5 мин). **Воркер**: T12 в `instrumentation.ts` (runtime nodejs) вызывает `connectMail()` из `@/integrations/mail` (подключает `setMailEnqueue` → `email_outbox`, цикл раз в 30 с; повтор безопасен), `stopMailWorker()`, `runMailWorkerOnce()`.
- События: `order.created`, `order.status_changed` (paid/payment_failed — ещё и менеджерам), `auth.password_reset`, `repair.created|callback.created|contact.created|question.created {number,name,phone?,customerEmail?,to?,equipmentType?,productName?,adminPath}`, `review.created {reviewId,productName,rating}`, `integration.failed {integration,message}` (только admin; **никто пока не шлёт — вызвать enqueueMail из `integrations/onec/service`**). Письмо менеджеру содержит номер и ссылку в админку, телефон/email маскированы; ссылка сброса пароля не показывается в админке.
- Маршруты админки: `/admin/requests`, `/admin/questions`, `/admin/reviews`, `/admin/mail`. Формы: `#callback` и `#contact-form` на `/contacts`, `#repair-form` на `/services[/slug]`; на товаре `#feedback` (вкладки «Отзывы»/«Вопрос»; рейтинг виден только при опубликованных отзывах). `MAIL_TO` — запасной адрес менеджеров, если получатели в настройках пусты.
- Исправлено попутно: страница товара падала на реальной БД из-за передачи всего `product` в клиентский слот (теперь `{id,name}`).

### Построено T11 (SEO и защитные заголовки) — R44 R44.1 R49
- **CSP — одно место**: `src/domain/seo/headers.ts` (`buildCsp({nonce,development,upgradeInsecure?})`, `staticSecurityHeaders()`, `HSTS_VALUE`, `IMAGE_SOURCES`; список разрешённых источников в комментарии файла). img-src: self data: blob: champion.ru *.champion.ru tile.openstreetmap.org *.tile.openstreetmap.org; script-src 'self' nonce 'strict-dynamic'; style-src 'self' 'unsafe-inline'; frame-ancestors/object-src 'none'. Новый внешний хост — в headers.ts + тест.
- `src/proxy.ts` (Next 16: proxy вместо middleware): HTTP→HTTPS 301 по `x-forwarded-proto` (хост из SITE_URL, `/api/health` исключён), HSTS и CSP с nonce, `X-Robots-Tag: noindex` для /admin /account /cart /checkout /order /pay /search /favorites /compare /api. **За реверс-прокси в production обязателен `X-Forwarded-Proto: https`, иначе цикл редиректов — внести в docs (T12).**
- `listSitemapEntries({db?,siteUrl})`, `splitSitemap`, `SITEMAP_LIMIT=50000` (сейчас один `/sitemap.xml`, 1386 URL), `buildRobots(siteUrl)`, `categoryMetadata/productMetadata/isFilteredCatalog/NOINDEX`, `productJsonLd/organizationJsonLd/breadcrumbJsonLd` (aggregateRating только при опубликованных отзывах), `getProductSeo(id)` (product_seo), `resolveSiteUrl()`, `<JsonLd/>`; `isProductionEnv(env?)` теперь и в `src/server/config.ts` (дубль `payment/select.ts`, тест сверяет оба). Фавикон и `metadataBase` в `src/app/layout.tsx`.

### Построено T12 (QA, бэкап, документация, запуск) — R01 R01.1 R02i R47 R47.1 R48 R49 A01 R01i
- `src/instrumentation.ts` → `src/server/startup.ts`: `connectApp({startMailWorker?})` (почта, журнал платежей, источник популярности `popularitySql()`); состояние интеграций — на `globalThis` (модульные переменные не разделяются между бандлами Next).
- `npm run backup` / `npm run restore -- <файл>` (`createBackup`, `restoreBackup`; архив `rts-backup-YYYYMMDD-HHMMSS.tar.gz`: `rts.sqlite` через VACUUM INTO, `uploads/`, `onec-outbox/`, `manifest.json` с sha256, без `.env`; restore сохраняет прежнее в `data/pre-restore-*`); `npm run seed:demo`; `npm run e2e:live`, `npm run a11y:live` (проверка живого сервера).
- Документация: README.md, docs/{local-setup,deployment,backup-restore,1c,security,env,architecture,handoff,qa-report}.md; `.github/workflows/ci.yml` (не запускался).
- Замер: максимум JS публичной страницы 182.4 КБ gzip из 200 (главная 181.1).
