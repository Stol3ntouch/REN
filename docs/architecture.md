# Архитектура (кратко)

Модульный монолит: одно приложение Next.js (App Router, серверный рендер) + TypeScript strict + SQLite (`node:sqlite`, синхронный драйвер). Причины — `docs/adr/ADR-001-stack.md`. Правила проекта и подробные контракты модулей — `.autopilot/*/interfaces.md`.

## Модули

| Слой | Каталог | За что отвечает |
|---|---|---|
| Страницы и API | `src/app` | тонкие обработчики: разбор запроса, вызов домена, ответ. Публичное — `(shop)`, кабинет — `account`, админка — `admin/(panel)`, API — `api/*` |
| Домен | `src/domain/*` | `catalog` (поиск FTS5, фильтры, сортировка), `pricing` (чистые функции цен/промокодов), `ordering` (корзина, оформление, машина состояний заказа, идемпотентность), `customers` (регистрация, вход, избранное, сравнение, кабинет), `admin` (права, аудит, сотрудники), `content` (страницы, слайды, новости, настройки магазина), `requests` (заявки, вопросы, отзывы с модерацией), `analytics`, `seo` |
| Импорт | `src/importing/yml` | разбор YML → план (предпросмотр без записи) → применение, идемпотентно по `(источник, внешний id)` |
| Медиа | `src/media` | безопасное скачивание фото (allowlist, защита от SSRF), перекодирование в WebP и варианты размеров |
| Интеграции | `src/integrations/*` | порты `OneCPort`, `PaymentPort`, `DeliveryPort`, `MailPort` и их заглушки; выбор реализации по окружению; журнал запусков `integration_run` |
| Данные | `src/server/db` | подключение, миграции (`migrations/NNNN_*.sql`, только вперёд), репозитории — **единственное место с SQL** (исключение: чтение каталога и карточек в `src/domain/catalog/store.ts`, `src/domain/customers/cards.ts`) |
| HTTP-примитивы | `src/server/http` | проверка Origin, лимиты запросов, сессии/cookie, ошибки |
| Интерфейс | `src/ui` | компоненты и тема на CSS-переменных |
| Запуск | `src/instrumentation.ts`, `src/server/startup.ts` | при старте сервера подключает почтовую очередь и воркер, журнал платежей, источник популярности товаров, платёжный провайдер; при `next build` ничего не подключает |
| Пограничный слой | `src/proxy.ts` | редирект на HTTPS, CSP с nonce, HSTS, `X-Robots-Tag` |

Состояние, которое должны видеть разные бандлы Next.js (почтовая очередь, источник популярности, журнал платежей, платёжный стартер), хранится на `globalThis`.

## Потоки данных

```
Каталог:   YML-файл / data/onec-inbox ──parse──► plan (предпросмотр) ──apply──► products, categories, images ──► витрина (SSR)
Заказ:     корзина (гость: cookie rts_guest / вошедший: сессия) ──checkout.place (пересчёт на сервере, ключ идемпотентности)──► orders + order_items (снимок)
           ──orders.transition (единственная точка смены статуса) ──► order_events + audit_log ──► очередь писем email_outbox
Оплата:    place ──► PaymentPort.createPayment ──► (ТЕСТ-страница) ──► POST /api/payment/webhook (подпись) ──► transition 'paid' / 'payment_failed'
Заявки:    форма (honeypot, лимит, согласие) ──► requests / reviews (модерация) ──► письмо менеджеру
1С (заглушка): заказы ──► data/onec-outbox/*.json;  data/onec-inbox/{*.yml,statuses.json} ──► каталог / статусы;  каждый запуск ──► integration_run + audit
Почта:     enqueueMail(событие) ──► email_outbox ──► воркер раз в 30 с ──► SMTP (если настроен)
```

## Границы доверия

1. **Браузер и интернет — не доверенные.** Всё из запроса (цены, суммы, id владельца, статусы, роли) проверяется или пересчитывается на сервере. Владелец корзины/заказа определяется только по cookie на сервере.
2. **Сотрудники** доверенные в пределах роли: права проверяет `requirePermission` внутри каждого обработчика; интерфейс лишь скрывает лишнее.
3. **Внешние сервисы (платёжная система, 1С, SMTP, источник фото)** — недоверенные входы: webhook проверяется подписью, файлы 1С — схемой, фото — allowlist хостов и проверкой содержимого, ответы — таймаутами.
4. **Администратор сервера** доверенный: консольные скрипты (`import:yml`, `admin:create`, `backup`, `restore`) выполняются от его имени; секреты — только в окружении.
5. **Данные в БД** считаются ненадёжными для вывода: описание товара санитизируется, остальной текст экранируется React.

## Соглашения

1. Код и идентификаторы — английские; интерфейс, ошибки, письма — русские. Деньги — целые копейки (`price_kopecks`, `*Kopecks`), валюта RUB.
2. Секреты только из `process.env` через `src/server/config.ts` (zod; в production падает при отсутствии обязательных). В логах и ответах значений нет; `.env.example` — только имена.
3. Репозитории синхронные (db первым аргументом), транзакции — `withTransaction` (BEGIN IMMEDIATE, вложенность через SAVEPOINT). Причины — `docs/adr/ADR-003-sync-repositories-and-transactions.md`.
4. Миграции: `migrations/NNNN_name.sql`, только вперёд, контрольная сумма сверяется. Диапазоны имён по областям: 0001 база, 01xx каталог, 02xx вход, 03xx заказы и оплата, 04xx кабинет, 05xx контент, 06xx заявки и почта, 07xx админка, 08xx+ релиз.
5. Заглушка вместо факта владельца — видимая метка `[… — впиши]` (`placeholder()` в `src/ui/placeholder.tsx`), выдуманных значений нет (`ADR-011`). Заглушка интеграции честно отвечает `status() = { connected:false, mode:'stub' }`, админка это показывает.
6. Публичная форма: zod, honeypot `website`, лимит по IP `rateLimit(key, limit, windowSec)`, чекбокс согласия -> запись `consents`.
7. Чужой ресурс по id -> 404, не 403. Страницы кабинета, корзины, оформления, админки и поиска — `noindex`.
8. Любое изменение цены, статуса, роли, модерации, настройки, импорта -> `audit.record(...)`. Таблица `audit_log` неизменяема (триггеры запрещают UPDATE/DELETE).
9. Состояния UI: loading / empty / error / success (`src/ui/states.tsx`); доступность — focus-visible, подписи, alt, `prefers-reduced-motion`.
10. Новый тест — своя БД `createTestDb()` (in-memory с миграциями), без сети. Не ослаблять существующие.

## Права и сессии

- Покупатель — cookie `rts_session` (HttpOnly, Lax, 30 дн.), сотрудник — `rts_admin_session` (HttpOnly, Strict, 12 ч); таблицы разные (`ADR-007`). Гость — cookie `rts_guest`; владелец корзины/заказа — `OwnerRef` (`user` | `guest`), `resolveOwner(cookies)` в `src/domain/customers`.
- Роли `admin` и `manager`; 15 прав в `src/domain/admin/permissions.ts` (`ADR-006`). Админ-обработчик: `withStaffPermission('perm', handler)` из `src/domain/admin/guard`; админ-страница: первой строкой `requireStaffPage('perm')` из `src/ui/admin/guard` (layout сам не редиректит); пункт меню — `ADMIN_NAV` в `src/ui/admin/nav.ts`.
- Гостевая ссылка на заказ: токен = HMAC(SESSION_SECRET, "order-access:"+номер), в БД не хранится; смена `SESSION_SECRET` обнуляет старые ссылки.
- Слияние корзины, избранного и сравнения при входе — `registerOnLoginHook` в `src/domain/hooks.ts`.

## Заказ и оплата

- Статусы (10) и допустимые переходы — таблица в `src/domain/ordering/status.ts`; смена только через `orders.transition` (`ADR-005`). `paid` и `payment_failed` ставит только система (webhook); `refunded` — через `orders.refund`, только при `is_paid`; оплаченный заказ не отменяется.
- Оформление идемпотентно по ключу (`orders.idempotency_key` UNIQUE, `ADR-004`); цены и суммы из запроса игнорируются, при расхождении — 409 со списком изменений.
- Оплата: `PaymentPort` (`createPayment`, `verifyWebhook`, `refund`); webhook `POST /api/payment/webhook` с подписью `x-rts-signature: sha256=<HMAC>`; дубли гасит `webhook_events(event_id UNIQUE)`; платёж по отменённому заказу заказ не меняет, а даёт запись `alert` для ручного возврата. Тестовый провайдер — только вне production (`ADR-010`).
- Выручка в аналитике — `is_paid=1` и статус вне `cancelled, refunded, payment_failed`; сутки по Москве.

## Интеграции и фоновые задачи

- Порты в `src/integrations/types.ts`, выбор реализации по env в `src/integrations/index.ts` (`integrationsStatus()` отдаёт статусы в админку). Внешние вызовы — с таймаутом и не более 3 повторов; запуск 1С пишется в `integration_run` и аудит (`docs/1c.md`).
- 1С-заглушка: `DATA_DIR/onec-outbox/<RTS-номер>.json` (повторный push -> `created:false`, иной контент -> `conflict`); из `onec-inbox` принимаются статусы processing, shipped, ready_for_pickup, delivered, cancelled (paid и refunded — нет).
- Почта: `enqueueMail(event, payload)` -> `email_outbox` (`dedupe_key` UNIQUE) -> воркер раз в 30 с, до 3 попыток (паузы 1 и 5 мин); SMTP при `MAIL_HOST` + `MAIL_FROM`, иначе письма копятся. Письмо менеджеру содержит номер и ссылку в админку, телефон и email маскированы.
- При старте (`src/instrumentation.ts` -> `src/server/startup.ts`, `connectApp`) подключаются почта, журнал платежей, источник популярности товаров; без этого «Популярные» = избранные админом.

## Каталог и импорт

- Источник истины каталога — YML/1С, не ручной ввод (`ADR-013`); импорт идемпотентен по `(source, external_id)`, поля можно блокировать от перезаписи (`LOCKABLE_FIELDS`). Описание товара хранится санитизированным HTML (белый список тегов) и выводится как HTML.
- Фото: `safeFetchImage` (allowlist хостов `IMAGE_HOST_ALLOWLIST`, запрет частных адресов после DNS, 5 МБ, 10 с) и `storeImage` (WebP, EXIF удалён, варианты 160/480/960/1600). Без `--images` хранится только внешний URL, хост разрешён в CSP (`ADR-008`, `ADR-009`).
- Поиск — FTS5; порядок выдачи всегда заканчивается `id`; сортировка по имени использует SQL-функцию `rts_fold`, регистрируемую на соединении. Фасеты: от 3 товаров, до 30 значений.

## SEO и заголовки

- CSP, HSTS и `X-Robots-Tag` ставит `src/proxy.ts` (в Next 16 proxy вместо middleware); список источников — только `src/domain/seo/headers.ts`, новый внешний хост добавляется там и в тесте (`ADR-012`).
- Редирект HTTP->HTTPS по `x-forwarded-proto` (хост из `SITE_URL`, `/api/health` исключён); за прокси в production обязателен верный заголовок.
- `sitemap.xml`, `robots.txt`, JSON-LD (рейтинг только при опубликованных отзывах), `metadataBase` — `src/domain/seo/*`, `src/app/layout.tsx`.

## Тесты

Vitest, каждый тест — своя БД в памяти (`createTestDb()`), без сети. Сквозные проверки живого сервера — `npm run e2e:live`; отчёт о выполненных проверках — `docs/qa-report.md`.
