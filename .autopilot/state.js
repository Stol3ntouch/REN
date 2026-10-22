window.STATE =
{
  "version": 2,
  "slug": "remtehsad-shop",
  "dir": "2026-10-22-remtehsad-shop--wip",
  "title": "Интернет-магазин РемТехСад",
  "mode": "full",
  "depth": "normal",
  "tier": "T3",
  "briefFile": "2026-10-22-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "C:/Users/OxO/Desktop/RemTexSad/skills-2.2.0/skills/autopilot",
  "baseCommit": "2ee729c",
  "startedAt": "2026-10-22T21:26:04+03:00",
  "updatedAt": "2026-10-22T22:14:09+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-10-22T21:26:04+03:00",
      "finishedAt": "2026-10-22T21:27:24+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-10-22T21:27:24+03:00",
      "finishedAt": "2026-10-22T21:27:55+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-10-22T21:27:55+03:00",
      "finishedAt": "2026-10-22T21:33:03+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-10-22T21:33:03+03:00",
      "finishedAt": "2026-10-22T21:36:52+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-10-22T21:36:52+03:00",
      "finishedAt": "2026-10-22T21:39:19+03:00"
    },
    {
      "id": "build",
      "status": "active",
      "startedAt": "2026-10-22T21:39:19+03:00"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 54,
    "done": 3,
    "inTicket": 51,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Каркас приложения",
      "requirements": [
        "R01i",
        "R02i",
        "R01",
        "R46",
        "R47",
        "R01.1",
        "R47.1"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "package.json",
        ".env.example",
        "README.md",
        "docs/adr/",
        "src/server/config.ts",
        "src/server/db/{connection,migrate,testing}.ts",
        "src/server/http/**",
        "src/ui/**",
        "src/app/layout.tsx",
        "src/app/api/health/**",
        "migrations/0001-0099",
        "scripts/migrate.ts",
        "tests/foundation/**"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-10-22T21:39:19+03:00",
      "finishedAt": "2026-10-22T21:56:36+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 56,
        "failed": 0
      },
      "commit": "df69d59"
    },
    {
      "id": "02",
      "title": "Каталог из YML: схема, импорт, изображения",
      "requirements": [
        "R39",
        "R39.1",
        "R39.2",
        "R40",
        "R45",
        "R36",
        "R38.1",
        "R04"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "src/importing/**",
        "src/media/**",
        "src/server/db/repositories/{categories,products,images,attributes,import-runs}.ts",
        "migrations/0100-0199",
        "scripts/import-yml.ts",
        "tests/importing/**",
        "tests/media/**",
        "tests/fixtures/**"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-10-22T21:54:02+03:00",
      "finishedAt": "2026-10-22T22:08:32+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 248,
        "failed": 0
      },
      "commit": "b05f3fb"
    },
    {
      "id": "03",
      "title": "Вход, роли, аудит, админ-оболочка",
      "requirements": [
        "R03",
        "R19",
        "R34",
        "R35",
        "R34.1",
        "R35.2"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "src/domain/customers/{auth,password,session,consent}*",
        "src/domain/admin/**",
        "src/server/db/repositories/{users,staff,sessions,audit,consents}.ts",
        "migrations/0200-0299",
        "src/app/(shop)/account/(auth)/**",
        "src/app/admin/layout.tsx",
        "src/app/admin/(auth)/**",
        "src/app/admin/(panel)/page.tsx",
        "src/ui/admin/**",
        "scripts/admin-create.ts",
        "tests/auth/**",
        "tests/rbac/**"
      ],
      "review": "да — вход, пароли, сессии",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-10-22T21:54:02+03:00",
      "finishedAt": "2026-10-22T22:09:40+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 243,
        "failed": 0
      },
      "commit": "c43094f"
    },
    {
      "id": "04",
      "title": "Витрина каталога: категории, поиск, фильтры, карточка",
      "requirements": [
        "R04",
        "R04.1",
        "R05",
        "R05.1",
        "R06",
        "R06.1",
        "R07",
        "R07.1",
        "R08",
        "R08.1",
        "R09",
        "R10",
        "R10.1",
        "R10.2"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 3,
      "zone": [
        "src/domain/catalog/**",
        "src/app/(shop)/catalog/**",
        "src/app/(shop)/product/**",
        "src/app/(shop)/search/**",
        "src/app/api/catalog/**",
        "src/ui/catalog/**",
        "migrations/0150-0159",
        "tests/catalog/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "in-progress",
      "startedAt": "2026-10-22T22:08:33+03:00",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "Корзина, оформление заказа, заказы, промокоды",
      "requirements": [
        "R13",
        "R13.1",
        "R13.2",
        "R14",
        "R14.1",
        "R14.2",
        "R15",
        "R16",
        "R16.1",
        "R16.2",
        "R17",
        "R17.1",
        "R20",
        "R31",
        "R31.1",
        "R37",
        "R52.2"
      ],
      "blockedBy": [
        "01",
        "02",
        "03"
      ],
      "wave": 3,
      "zone": [
        "src/domain/ordering/**",
        "src/domain/pricing/**",
        "src/server/db/repositories/{carts,orders,promos,methods}.ts",
        "migrations/0300-0349",
        "src/app/(shop)/{cart,checkout,order}/**",
        "src/app/api/cart/**",
        "src/app/admin/(panel)/{orders,promos}/**",
        "tests/ordering/**",
        "tests/pricing/**"
      ],
      "review": "да — деньги",
      "model": "сильная",
      "status": "in-progress",
      "startedAt": "2026-10-22T22:08:33+03:00",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "06",
      "title": "Оплата (тестовый провайдер) и доставка (ручная)",
      "requirements": [
        "R41",
        "R41.1",
        "R42",
        "R17",
        "R16.2"
      ],
      "blockedBy": [
        "05"
      ],
      "wave": 4,
      "zone": [
        "src/integrations/{payment,delivery}/**",
        "src/integrations/index.ts",
        "src/app/api/payment/**",
        "src/app/(shop)/pay/**",
        "src/server/db/repositories/{payments,webhook-events}.ts",
        "migrations/0350-0399",
        "src/domain/ordering/payment-flow.ts",
        "tests/payment/**",
        "tests/delivery/**"
      ],
      "review": "да — деньги",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "07",
      "title": "Личный кабинет, избранное, сравнение",
      "requirements": [
        "R18",
        "R20",
        "R21",
        "R21.1"
      ],
      "blockedBy": [
        "03",
        "04",
        "05"
      ],
      "wave": 4,
      "zone": [
        "src/domain/customers/{profile,addresses,favorites,compare}*",
        "src/server/db/repositories/{addresses,favorites,compare}.ts",
        "migrations/0400-0449",
        "src/app/(shop)/account/(area)/**",
        "src/app/(shop)/{favorites,compare}/**",
        "src/app/api/{favorites,compare}/**",
        "src/ui/{favorite,compare}/**",
        "ProductCard",
        "tests/account/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "08",
      "title": "Контент, главная, шапка и подвал, статические страницы",
      "requirements": [
        "R24",
        "R25",
        "R26",
        "R27",
        "R27.1",
        "R28",
        "R29",
        "R30",
        "R31",
        "R32",
        "R33",
        "R46",
        "R50",
        "R51",
        "R52",
        "R45"
      ],
      "blockedBy": [
        "03",
        "04",
        "05",
        "07"
      ],
      "wave": 5,
      "zone": [
        "src/domain/content/**",
        "src/server/db/repositories/{pages,slides,news,promotions,services,settings,company-reviews}.ts",
        "migrations/0500-0599",
        "src/app/(shop)/{page.tsx,pages,news,services,promotions,about,contacts,buyers}/**",
        "src/ui/layout/**",
        "src/ui/theme.css",
        "public/brand/**",
        "src/ui/home/**",
        "src/ui/map/**",
        "src/app/admin/(panel)/content/**",
        "tests/content/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "09",
      "title": "Заявки, отзывы, вопросы, почта",
      "requirements": [
        "R02",
        "R11",
        "R11.1",
        "R12",
        "R22",
        "R23",
        "R33",
        "R43",
        "R43.1",
        "R48"
      ],
      "blockedBy": [
        "03",
        "04",
        "07"
      ],
      "wave": 5,
      "zone": [
        "src/domain/requests/**",
        "src/integrations/mail/**",
        "src/server/db/repositories/{requests,reviews,questions,email-outbox}.ts",
        "migrations/0600-0699",
        "src/app/(shop)/{repair,callback,contact}/**",
        "src/app/api/forms/**",
        "src/ui/forms/**",
        "src/app/admin/(panel)/{requests,reviews,questions,mail}/**",
        "tests/requests/**",
        "tests/mail/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "10",
      "title": "Админка: импорт, каталог, 1С, аналитика, сотрудники, настройки",
      "requirements": [
        "R38",
        "R38.1",
        "R36",
        "R36.1",
        "R35",
        "R35.1",
        "R34",
        "R39",
        "R52",
        "R52.1",
        "R52.3",
        "R47"
      ],
      "blockedBy": [
        "02",
        "03",
        "05",
        "06"
      ],
      "wave": 5,
      "zone": [
        "src/integrations/onec/**",
        "src/domain/analytics/**",
        "src/server/db/repositories/{integration-runs,staff-admin,analytics}.ts",
        "migrations/0700-0799",
        "src/app/admin/(panel)/{import,catalog,warehouse,integrations,analytics,customers,staff,settings,audit}/**",
        "src/app/admin/(panel)/page.tsx",
        "tests/admin/**",
        "tests/onec/**",
        "tests/analytics/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "11",
      "title": "SEO и технические заголовки",
      "requirements": [
        "R44",
        "R44.1",
        "R49"
      ],
      "blockedBy": [
        "04",
        "08",
        "09"
      ],
      "wave": 6,
      "zone": [
        "src/app/sitemap.ts",
        "src/app/robots.ts",
        "src/middleware.ts",
        "src/domain/seo/**",
        "src/ui/seo/**",
        "next.config.*",
        "generateMetadata",
        "tests/seo/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "12",
      "title": "QA, резервные копии, документация, передача",
      "requirements": [
        "R01",
        "R01.1",
        "R02i",
        "R47",
        "R47.1",
        "R48",
        "R49",
        "A01",
        "R01i"
      ],
      "blockedBy": [
        "06",
        "08",
        "09",
        "10",
        "11"
      ],
      "wave": 7,
      "zone": [
        "README.md",
        "docs/**",
        "docs/adr/ADR-001",
        "scripts/{backup,restore,seed-demo}.ts",
        ".github/workflows/ci.yml",
        "tests/e2e/**",
        "tests/a11y/**",
        "tests/backup/**",
        ".env.example"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": {
    "passed": 243,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 14,
    "fixed": 10,
    "deferred": 4,
    "items": [
      "бренды/массовое редактирование — вне рамок: нет поля в YML",
      "сопоставление полей — вне рамок до CSV",
      "документы товара — нет в фиде",
      "выбор конфигурации 1С — решение владельца"
    ]
  },
  "concerns": [
    "src/server/http/rate-limit.ts:19 — очистка окон может сбросить длинное окно раньше срока",
    "src/server/http/rate-limit.ts:51 — при TRUST_PROXY=false все клиенты в одном бакете 'unknown'",
    "src/server/db/transaction.ts:9 — withTransaction не защищена от async-функции (откат потеряется)",
    "src/server/http/origin.ts:30 — ветка по SITE_URL не покрыта тестом",
    "tests/foundation — нет проверки 360 px/контраста; docs/local-setup.md ещё не создан (T12)",
    "src/server/http/rate-limit.ts:51 + src/domain/customers/auth-throttle.ts:20 — при TRUST_PROXY=false все клиенты в одном бакете: 5 неверных входов блокируют настоящего admin (безопасность, чинить в F1)",
    "src/domain/customers/auth.ts:113 — токен сброса пароля открыт в mail_stub_queue/email_outbox: T09 не должен показывать ссылку сброса в админке и должен очищать тело письма после отправки",
    "src/domain/customers/auth-throttle.ts:11 — проверка блокировки и запись неудачи не атомарны (параллельные попытки)",
    "src/app/admin/layout.tsx — защита только вызовом requireStaffPage на странице: нужен тест, перечисляющий admin/(panel)/**/page.tsx (T12/F1)",
    "src/domain/admin/mask.ts — audit не вычищает поля password/token/hash",
    "server actions (Origin, honeypot, редиректы) не покрыты тестами"
  ],
  "blind": null,
  "beats": [
    "2026-10-22T21:26:04+03:00",
    "2026-10-22T21:27:24+03:00",
    "2026-10-22T21:27:55+03:00",
    "2026-10-22T21:27:56+03:00",
    "2026-10-22T21:31:55+03:00",
    "2026-10-22T21:33:03+03:00",
    "2026-10-22T21:35:56+03:00",
    "2026-10-22T21:36:19+03:00",
    "2026-10-22T21:36:52+03:00",
    "2026-10-22T21:38:34+03:00",
    "2026-10-22T21:38:35+03:00",
    "2026-10-22T21:38:40+03:00",
    "2026-10-22T21:38:41+03:00",
    "2026-10-22T21:38:54+03:00",
    "2026-10-22T21:39:19+03:00",
    "2026-10-22T21:43:55+03:00",
    "2026-10-22T21:54:02+03:00",
    "2026-10-22T21:54:09+03:00",
    "2026-10-22T21:56:36+03:00",
    "2026-10-22T21:56:37+03:00",
    "2026-10-22T22:01:06+03:00",
    "2026-10-22T22:01:07+03:00",
    "2026-10-22T22:07:35+03:00",
    "2026-10-22T22:07:37+03:00",
    "2026-10-22T22:08:31+03:00",
    "2026-10-22T22:08:32+03:00",
    "2026-10-22T22:08:33+03:00",
    "2026-10-22T22:09:40+03:00",
    "2026-10-22T22:14:09+03:00"
  ],
  "rev": 34,
  "waiting": null,
  "waits": [
    {
      "kind": "briefing",
      "from": "2026-10-22T21:27:56+03:00",
      "to": "2026-10-22T21:31:55+03:00"
    }
  ],
  "log": [
    {
      "t": "2026-10-22T21:26:04+03:00",
      "k": "init"
    },
    {
      "t": "2026-10-22T21:27:24+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-10-22T21:27:55+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-10-22T21:27:56+03:00",
      "k": "ask",
      "kind": "briefing",
      "note": "четыре вопроса — стек, роли, каталог-данные, объём интеграций"
    },
    {
      "t": "2026-10-22T21:31:55+03:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-10-22T21:33:03+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 54,
      "total": 54
    },
    {
      "t": "2026-10-22T21:33:03+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-10-22T21:35:56+03:00",
      "k": "tier",
      "v": "T3"
    },
    {
      "t": "2026-10-22T21:36:19+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 14,
      "fixed": 10,
      "deferred": 4
    },
    {
      "t": "2026-10-22T21:36:52+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-10-22T21:38:34+03:00",
      "k": "tickets",
      "n": 12
    },
    {
      "t": "2026-10-22T21:38:35+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 1
    },
    {
      "t": "2026-10-22T21:38:40+03:00",
      "k": "tickets",
      "n": 12
    },
    {
      "t": "2026-10-22T21:38:41+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-22T21:39:19+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-10-22T21:39:19+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-22T21:54:02+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 56,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T21:54:02+03:00",
      "k": "ticket",
      "ids": [
        "02",
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-22T21:54:09+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "review"
    },
    {
      "t": "2026-10-22T21:56:36+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 56,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T21:56:37+03:00",
      "k": "add",
      "key": "concerns",
      "n": 5
    },
    {
      "t": "2026-10-22T22:01:06+03:00",
      "k": "tickets",
      "n": 12
    },
    {
      "t": "2026-10-22T22:01:07+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-22T22:07:35+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 243,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:07:37+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "review"
    },
    {
      "t": "2026-10-22T22:08:31+03:00",
      "k": "add",
      "key": "report",
      "n": 2
    },
    {
      "t": "2026-10-22T22:08:32+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 248,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:08:33+03:00",
      "k": "ticket",
      "ids": [
        "04",
        "05"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-22T22:09:40+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 243,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:09:40+03:00",
      "k": "add",
      "key": "concerns",
      "n": 6
    },
    {
      "t": "2026-10-22T22:14:09+03:00",
      "k": "tickets",
      "n": 12
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«адаптивный интернет-магазин товаров для сада, садовой техники, снегоуборочного инвентаря, запчастей и сопутствующих товаров»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«Дополнительно сайт принимает заявки на ремонт техники»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«Публичный сайт и отдельная закрытая админ-панель»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«Каталог: категории/подкатегории, карточки, параметры, поиск, сортировка и фильтры»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«Поиск по названию и артикулу»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«Сортировка по алфавиту, популярности и цене»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«20 товаров на страницу по умолчанию; кнопка «Показать ещё» загружает следующую страницу без дубликатов»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«Фильтры по доступным характеристикам товара; на мобильном — выдвижная панель»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«Сетка карточек товаров, хлебные крошки, число результатов и SEO-текст»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«Название, артикул, цена, доступность/остаток, галерея фотографий, описание, параметры, доставка/оплата, корзина, избранное, сравнение и сопутствующие товары»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«Отзывы проходят модерацию. Если опубликованных отзывов нет, не показывать фиктивный рейтинг»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«Вопрос о товаре сохраняется и передаётся менеджеру»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«Корзина и оформление заказа для гостей и зарегистрированных пользователей»",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«Серверная проверка цен, доступности, количества и итоговой суммы»",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "«Выбор только настроенных и действительно доступных способов доставки/оплаты»",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "«Понятные статусы: создан, ожидает оплаты, оплачен, ошибка/отмена и статусы доставки согласно интеграции»",
      "status": "in-ticket"
    },
    {
      "id": "R17",
      "text": "«Повторное нажатие/повторный webhook не должны создавать дубли заказов или платежей»",
      "status": "in-ticket"
    },
    {
      "id": "R18",
      "text": "«Личный кабинет: профиль, история покупок/заказов, избранное»",
      "status": "in-ticket"
    },
    {
      "id": "R19",
      "text": "«Регистрация, вход, восстановление доступа»",
      "status": "done"
    },
    {
      "id": "R20",
      "text": "«Запрещено показывать чужие заказы даже при подмене ID/URL»",
      "status": "in-ticket"
    },
    {
      "id": "R21",
      "text": "«Сравнение товаров»",
      "status": "in-ticket"
    },
    {
      "id": "R22",
      "text": "«Страницы услуг с формой заявки на ремонт; полноценный учёт ремонтной мастерской в MVP не входит»",
      "status": "in-ticket"
    },
    {
      "id": "R23",
      "text": "«Форма ремонта: имя/контакт, тип техники, описание неисправности и предпочтительный способ связи»",
      "status": "in-ticket"
    },
    {
      "id": "R24",
      "text": "«Главная: Верхний блок: адрес, телефон, кнопка «Заказать звонок», вход в личный кабинет, поиск»",
      "status": "in-ticket"
    },
    {
      "id": "R25",
      "text": "«Промослайдер до трёх изображений/предложений»",
      "status": "in-ticket"
    },
    {
      "id": "R26",
      "text": "«Популярные категории; новые, популярные или акционные товары»",
      "status": "in-ticket"
    },
    {
      "id": "R27",
      "text": "«Анонс компании, услуги, контакты и интерактивная карта с геометкой»",
      "status": "in-ticket"
    },
    {
      "id": "R28",
      "text": "«Подвал: копирайт, дубликат меню/контактов, социальные ссылки при наличии»",
      "status": "in-ticket"
    },
    {
      "id": "R29",
      "text": "«Доступ к корзине, избранному и сравнению на основных страницах»",
      "status": "in-ticket"
    },
    {
      "id": "R30",
      "text": "«Страницы: о компании, контакты, акции, список услуг и отдельная страница каждой услуги, доставка/оплата, гарантия/возврат, FAQ и юридические документы»",
      "status": "in-ticket"
    },
    {
      "id": "R31",
      "text": "«Акции — список и детальная страница акции» (карта сайта: промокод в корзине)",
      "status": "in-ticket"
    },
    {
      "id": "R32",
      "text": "«Новости» / «Отзывы» о компании (О компании)",
      "status": "in-ticket"
    },
    {
      "id": "R33",
      "text": "«Заказать звонок», «Форма обратной связи», «Адрес, телефон, часы работы, карта» (Контакты)",
      "status": "in-ticket"
    },
    {
      "id": "R34",
      "text": "«Минимум роли администратора и менеджера. Управление контентом, услугами, слайдами, заказами, обращениями, вопросами, отзывами, SEO-полями, сотрудниками и статусом интеграций»",
      "status": "in-ticket"
    },
    {
      "id": "R35",
      "text": "«Проверка прав выполняется на сервере для каждого действия. Критические изменения пишутся в audit log. Секреты не показываются после сохранения в открытом виде»",
      "status": "in-ticket"
    },
    {
      "id": "R36",
      "text": "«Каталог/цены/остатки редактируются с учётом выбранного источника истины»",
      "status": "in-ticket"
    },
    {
      "id": "R37",
      "text": "«Один склад на старте; розничная цена и возможная скидочная цена»",
      "status": "in-ticket"
    },
    {
      "id": "R38",
      "text": "«Планируется двусторонний обмен с будущей 1С, включая номенклатуру/остатки/цены и заказы с сайта»",
      "status": "in-ticket"
    },
    {
      "id": "R39",
      "text": "«Нужны загрузка каталога, предпросмотр и отчёт ошибок. Excel/CSV/XML могут быть вариантами после согласования формата»",
      "status": "in-ticket"
    },
    {
      "id": "R40",
      "text": "«Повтор импорта не создаёт дубликаты товаров/категорий»",
      "status": "done"
    },
    {
      "id": "R41",
      "text": "«Оплата: Провайдер не выбран. До получения документации — интерфейс адаптера и тестовый режим, не фиктивная production-оплата»",
      "status": "in-ticket"
    },
    {
      "id": "R42",
      "text": "«Доставка: Показывать только настроенные способы»",
      "status": "in-ticket"
    },
    {
      "id": "R43",
      "text": "«Уведомления о заказах, вопросах и заявках направлять менеджерам после предоставления адресов/SMTP/API»",
      "status": "in-ticket"
    },
    {
      "id": "R44",
      "text": "«Редактируемые title, description, H1, alt и slug; корректные canonical, sitemap.xml, robots.txt, HTTPS-редиректы; технические и личные страницы не индексировать»",
      "status": "in-ticket"
    },
    {
      "id": "R45",
      "text": "«Сжатие/изменение размеров загружаемых изображений и проверка типа/размера»",
      "status": "in-ticket"
    },
    {
      "id": "R46",
      "text": "«Фирменный стиль будет опираться на логотип, который заказчик предоставит отдельно» (до этого — нейтральная временная тема)",
      "status": "in-ticket"
    },
    {
      "id": "R47",
      "text": "«Обязательны адаптивность, клавиатурная навигация, видимый focus, контраст, подписи форм, alt изображений, loading/empty/error/success states и поддержка prefers-reduced-motion»",
      "status": "in-ticket"
    },
    {
      "id": "R48",
      "text": "«Никаких выдуманных отзывов/рейтингов»",
      "status": "in-ticket"
    },
    {
      "id": "R49",
      "text": "«Требуются SEO, сжатие изображений, SSL/HTTPS, sitemap, robots.txt, почтовые уведомления, инструкции запуска и развёртывания»",
      "status": "in-ticket"
    },
    {
      "id": "R50",
      "text": "«Мобильная навигация: нижняя панель: Главная / Каталог / Избранное / Корзина / Профиль»",
      "status": "in-ticket"
    },
    {
      "id": "R51",
      "text": "«Информационные разделы и услуги… Политику персональных данных и правовые тексты проверить специалистом»",
      "status": "in-ticket"
    },
    {
      "id": "R52",
      "text": "«Админка: Обзор, Каталог, Заказы, Склад/остатки, Цены и акции, Покупатели, Контент, Отзывы и вопросы, Заявки на ремонт, Импорт и интеграции, Аналитика, Пользователи/роли»",
      "status": "in-ticket"
    },
    {
      "id": "R01i",
      "text": "(подразумевается) стек не выбран — «Стек не утверждён», сравнить не более трёх вариантов",
      "status": "in-ticket"
    },
    {
      "id": "R02i",
      "text": "(подразумевается) «инструкции по Open Server/Windows» — локальный запуск на Windows",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-10-22T21:33:03+03:00",
      "open": 54,
      "total": 54
    },
    "G2": {
      "ok": true,
      "at": "2026-10-22T21:36:19+03:00",
      "found": 14,
      "fixed": 10,
      "deferred": 4
    },
    "G3": {
      "ok": true,
      "at": "2026-10-22T22:01:07+03:00",
      "problems": 0
    }
  },
  "result": null,
  "report": [
    "В выгрузке 4 товара без цены (id 217943, 217944, 217946, 217947) — не импортированы, нужна цена от владельца",
    "Фото скачиваются командой import:yml --images; по сети на реальном champion.ru не проверялось"
  ]
}
