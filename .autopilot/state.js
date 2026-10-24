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
  "updatedAt": "2026-10-24T22:42:06+03:00",
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
      "startedAt": "2026-10-24T22:05:44+03:00",
      "finishedAt": "2026-10-24T22:14:12+03:00"
    },
    {
      "id": "briefing",
      "status": "pending"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-10-24T22:14:12+03:00",
      "finishedAt": "2026-10-24T22:14:12+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-10-24T22:14:12+03:00",
      "finishedAt": "2026-10-24T22:14:12+03:00"
    },
    {
      "id": "build",
      "status": "active",
      "startedAt": "2026-10-24T22:14:12+03:00"
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
    "total": 111,
    "done": 66,
    "inTicket": 43,
    "inSpec": 0,
    "placeholder": 2,
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
      "status": "done",
      "startedAt": "2026-10-22T22:08:33+03:00",
      "finishedAt": "2026-10-22T22:32:09+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 469,
        "failed": 0
      },
      "commit": "1499569"
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
      "status": "done",
      "startedAt": "2026-10-22T22:08:33+03:00",
      "finishedAt": "2026-10-22T22:40:29+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 473,
        "failed": 0
      },
      "commit": "4cafc31"
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
      "status": "done",
      "startedAt": "2026-10-22T22:36:47+03:00",
      "finishedAt": "2026-10-23T09:50:51+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": [
        "production определён двумя способами; online-способ без провайдера не скрыт"
      ],
      "tests": {
        "passed": 538,
        "failed": 0
      },
      "commit": "2654b73"
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
      "status": "done",
      "startedAt": "2026-10-22T22:36:47+03:00",
      "finishedAt": "2026-10-23T09:47:59+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 535,
        "failed": 0
      },
      "commit": "23f1885"
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
      "status": "done",
      "startedAt": "2026-10-23T09:48:00+03:00",
      "finishedAt": "2026-10-23T10:09:16+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 705,
        "failed": 0
      },
      "commit": "56045c8"
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
      "status": "done",
      "startedAt": "2026-10-23T10:09:18+03:00",
      "finishedAt": "2026-10-23T10:29:34+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 759,
        "failed": 3
      },
      "commit": "40a5b3c"
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
      "status": "done",
      "startedAt": "2026-10-22T22:50:43+03:00",
      "finishedAt": "2026-10-23T10:06:24+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 705,
        "failed": 0
      },
      "commit": "6684a32"
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
      "status": "done",
      "startedAt": "2026-10-23T10:29:56+03:00",
      "finishedAt": "2026-10-23T10:41:05+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 812,
        "failed": 0
      },
      "commit": "3892e0a"
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
      "status": "done",
      "startedAt": "2026-10-23T10:41:07+03:00",
      "finishedAt": "2026-10-23T15:04:16+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 870,
        "failed": 0
      },
      "commit": "26e834b"
    },
    {
      "id": "C01",
      "title": "Каркас админки и kit-компоненты",
      "requirements": [
        "G13",
        "G14",
        "G15",
        "G53"
      ],
      "blockedBy": [],
      "wave": 13,
      "zone": [
        "src/ui/admin/**",
        "src/app/admin/layout.tsx",
        "src/app/admin/(panel)/_lib/ui.tsx",
        "src/app/admin/(panel)/loading.tsx",
        "src/app/admin/(panel)/error.tsx",
        "src/app/admin/(panel)/not-found.tsx",
        "public/brand/**",
        "tests/admin-kit/**"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "review",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-10-24T22:14:12+03:00",
      "finishedAt": "2026-10-24T22:42:05+03:00",
      "tests": {
        "passed": 1074,
        "failed": 0
      },
      "commit": "ffe869f"
    },
    {
      "id": "C02",
      "title": "RBAC в БД, пользователи и роли, журнал действий, уведомления (хранилище)",
      "requirements": [
        "G46",
        "G47"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 14,
      "zone": [
        "src/domain/admin/**",
        "src/server/db/repositories/{staff,roles,audit,sessions,notifications}.ts",
        "migrations/1100-1149",
        "src/app/admin/(panel)/{staff,roles,audit}/**",
        "src/app/admin/(auth)/**",
        "scripts/admin-create.ts",
        "tests/rbac/**",
        "tests/admin/{staff,roles,audit}*.test.ts*"
      ],
      "review": "да — права, пароли, сессии",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C03",
      "title": "Бренды, характеристики, фильтры каталога",
      "requirements": [
        "G25",
        "G26",
        "G27"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 14,
      "zone": [
        "src/domain/catalog/{brands,attributes,filters,facets}.ts",
        "src/server/db/repositories/{brands,attributes,filters,facets-config}.ts",
        "migrations/1150-1199",
        "src/app/admin/(panel)/catalog/{brands,attributes,filters}/**",
        "src/app/admin/(panel)/_lib/{brands,attributes,filters}-ops.ts",
        "src/ui/catalog/FiltersPanel.tsx",
        "src/ui/catalog/FilterDrawer.tsx",
        "src/importing/yml/apply.ts",
        "tests/catalog/**",
        "tests/admin/{brands,attributes,filters}*.test.ts*"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C04",
      "title": "Товар: модель данных, форма, CRUD, остатки",
      "requirements": [
        "G17",
        "G19"
      ],
      "blockedBy": [
        "01",
        "02",
        "03"
      ],
      "wave": 15,
      "zone": [
        "src/domain/catalog/{products-admin,stock}.ts",
        "src/server/db/repositories/{products-admin,product-categories,stock,product-media}.ts",
        "migrations/1200-1249",
        "src/app/admin/(panel)/catalog/products/**",
        "src/app/admin/(panel)/catalog/[id]/**",
        "src/app/admin/(panel)/_lib/{product,stock}-ops.ts",
        "src/domain/catalog/{store,product,search}.ts",
        "src/ui/catalog/{PriceBlock,ProductCard,ProductGallery}.tsx",
        "src/app/(shop)/product/**",
        "src/importing/yml/apply.ts",
        "tests/admin/product*.test.ts*",
        "tests/catalog/**"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C05",
      "title": "Таблица товаров: фильтры, массовые действия, дублирование, удаление, экспорт",
      "requirements": [
        "G18"
      ],
      "blockedBy": [
        "04"
      ],
      "wave": 16,
      "zone": [
        "src/app/admin/(panel)/catalog/page.tsx",
        "src/app/admin/(panel)/catalog/ProductTable.tsx",
        "src/app/admin/(panel)/catalog/products/list/**",
        "src/app/admin/api/products/**",
        "src/app/admin/(panel)/_lib/product-list-ops.ts",
        "src/server/db/repositories/{catalog-admin,products-admin}.ts",
        "src/domain/catalog/products-list.ts",
        "tests/admin/product-list*.test.ts*"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C06",
      "title": "Категории: дерево, глаз, карточка, вкладки",
      "requirements": [
        "G20",
        "G21",
        "G22",
        "G23",
        "G24"
      ],
      "blockedBy": [
        "03",
        "04",
        "05",
        "08"
      ],
      "wave": 17,
      "zone": [
        "src/app/admin/(panel)/catalog/categories/**",
        "src/app/admin/api/categories/**",
        "src/app/admin/(panel)/_lib/{category,category-tree}-ops.ts",
        "src/domain/catalog/{categories,category-rows,category-images}.ts",
        "src/server/db/repositories/{categories,category-links}.ts",
        "migrations/1250-1299",
        "src/ui/catalog/{CategoryTiles,CategorySeoText}.tsx",
        "src/app/(shop)/catalog/**",
        "src/domain/seo/**",
        "src/ui/layout/**",
        "src/domain/content/home.ts",
        "tests/admin/categor*.test.ts*",
        "tests/catalog/**"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C07",
      "title": "Единый модуль импорта и экспорта: CSV и YML",
      "requirements": [
        "G28"
      ],
      "blockedBy": [
        "04",
        "05"
      ],
      "wave": 17,
      "zone": [
        "src/importing/**",
        "src/app/admin/(panel)/import/**",
        "src/app/admin/api/import/**",
        "src/app/admin/(panel)/_lib/import-ops.ts",
        "src/server/db/repositories/{import-runs,import-mappings}.ts",
        "migrations/1300-1349",
        "scripts/import-yml.ts",
        "tests/importing/**",
        "tests/admin/import*.test.ts*",
        "tests/fixtures/**"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C08",
      "title": "Контент: страницы-CMS, баннеры, новости, акции и купоны, отзывы, услуги",
      "requirements": [
        "G32",
        "G33",
        "G34",
        "G35",
        "G36",
        "G37"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 14,
      "zone": [
        "src/domain/content/**",
        "src/domain/pricing/promo*.ts",
        "src/server/db/repositories/{pages,slides,banners,news,news-categories,promotions,promos,services,reviews,company-reviews}.ts",
        "migrations/1350-1399",
        "src/app/admin/(panel)/content/**",
        "src/app/admin/(panel)/{reviews,promos}/**",
        "src/app/admin/api/content/**",
        "src/ui/home/**",
        "src/ui/layout/**",
        "src/app/(shop)/{pages,news,promotions,services,about,buyers,privacy,page.tsx}/**",
        "tests/content/**",
        "tests/admin/content*.test.ts*"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C09",
      "title": "Продажи: заказы, клиенты, обращения, заявки на ремонт",
      "requirements": [
        "G29",
        "G30",
        "G31",
        "G38"
      ],
      "blockedBy": [
        "01",
        "02"
      ],
      "wave": 15,
      "zone": [
        "src/domain/ordering/**",
        "src/domain/customers/**",
        "src/domain/requests/**",
        "src/server/db/repositories/{orders,order-comments,customers-admin,customer-notes,requests,request-comments,repairs}.ts",
        "migrations/1400-1449",
        "src/app/admin/(panel)/{orders,customers,inquiries,repairs,requests,questions}/**",
        "src/app/admin/api/{orders,customers,inquiries,repairs}/**",
        "src/app/(shop)/order/**",
        "src/integrations/mail/templates.ts",
        "tests/ordering/**",
        "tests/requests/**",
        "tests/admin/{orders,customers,inquiries,repairs}*.test.ts*"
      ],
      "review": "да — заказы и деньги",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C10",
      "title": "Dashboard, статистика, глобальный поиск, центр уведомлений",
      "requirements": [
        "G16",
        "G48",
        "G51",
        "G52",
        "G14"
      ],
      "blockedBy": [
        "04",
        "09"
      ],
      "wave": 16,
      "zone": [
        "src/app/admin/(panel)/page.tsx",
        "src/app/admin/(panel)/{analytics,notifications}/**",
        "src/app/admin/api/{search,notifications,stats}/**",
        "src/domain/analytics/**",
        "src/domain/admin/{search,notifications-feed}.ts",
        "src/server/db/repositories/{analytics,search-admin}.ts",
        "migrations/1450-1499",
        "src/ui/admin/{kit/SearchBox,kit/NotificationBell,topbar-config}.tsx",
        "tests/analytics/**",
        "tests/admin/{dashboard,search,notifications}*.test.ts*"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C11",
      "title": "Настройки магазина, переключатели, SEO",
      "requirements": [
        "G39",
        "G45"
      ],
      "blockedBy": [
        "01",
        "02"
      ],
      "wave": 15,
      "zone": [
        "src/domain/content/{settings,shell,fields,seo-settings}.ts",
        "src/domain/seo/**",
        "src/server/db/repositories/{settings,seo-settings,media}.ts",
        "migrations/1500-1549",
        "src/app/admin/(panel)/settings/**",
        "src/app/admin/api/settings/**",
        "src/proxy.ts",
        "src/app/layout.tsx",
        "src/app/(shop)/layout.tsx",
        "src/ui/shell-context.ts",
        "src/ui/layout/**",
        "src/app/(shop)/{register,account}/**",
        "src/app/sitemap.ts",
        "src/app/robots.ts",
        "tests/content/**",
        "tests/seo/**",
        "tests/admin/settings*.test.ts*"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C12",
      "title": "Доставка и оплата, склады, налоги и цены, email-шаблоны, резервные копии, интеграции",
      "requirements": [
        "G40",
        "G41",
        "G42",
        "G43",
        "G44",
        "G49",
        "G50"
      ],
      "blockedBy": [
        "04",
        "09",
        "11"
      ],
      "wave": 16,
      "zone": [
        "src/domain/ordering/{delivery,payment-methods,pricing-rules}.ts",
        "src/domain/pricing/**",
        "src/domain/admin/{backup,integrations}.ts",
        "src/integrations/**",
        "src/server/db/repositories/{methods,warehouses,stock,taxes,email-templates,backups,integration-settings}.ts",
        "migrations/1550-1599",
        "src/app/admin/(panel)/settings/{shipping,payments,warehouses,taxes,email,backup}/**",
        "src/app/admin/(panel)/{warehouse,mail,integrations}/**",
        "src/app/admin/api/{backup,email,integrations}/**",
        "scripts/{backup,restore}.ts",
        "src/server/config.ts",
        "tests/ordering/**",
        "tests/pricing/**",
        "tests/mail/**",
        "tests/backup/**",
        "tests/admin/{shipping,payments,warehouses,taxes,email,backup,integrations}*.test.ts*"
      ],
      "review": "да — платёжные настройки и секреты",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "C13",
      "title": "Безопасность, адаптив, производительность, E2E, документы",
      "requirements": [
        "G12",
        "G54",
        "G55",
        "G56",
        "G57"
      ],
      "blockedBy": [
        "02",
        "03",
        "04",
        "05",
        "06",
        "07",
        "08",
        "09",
        "10",
        "11",
        "12"
      ],
      "wave": 18,
      "zone": [
        "tests/e2e/**",
        "tests/a11y/**",
        "tests/security/**",
        "docs/**",
        "README.md",
        ".autopilot/PROGRESS.md",
        "src/ui/admin/admin.css",
        "src/ui/admin/nav.ts",
        ".env.example",
        "package.json",
        "scripts/e2e-admin.ts"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "F1",
      "title": "Исправления по код-ревью ветки",
      "requirements": [
        "R17",
        "R19",
        "R31",
        "R31.1",
        "R35",
        "R35.2",
        "R34.1",
        "R41",
        "R43",
        "R39",
        "R04",
        "R10"
      ],
      "blockedBy": [],
      "wave": 8,
      "zone": [
        "src/server/http/**",
        "src/server/config.ts",
        "src/domain/customers/**",
        "src/domain/admin/**",
        "src/domain/ordering/**",
        "src/domain/catalog/**",
        "src/domain/requests/**",
        "src/integrations/payment/**",
        "src/integrations/mail/**",
        "src/server/db/repositories/{images,promos,email-outbox,orders,payments}.ts",
        "src/importing/**",
        "src/app/api/payment/**",
        "src/app/api/catalog/**",
        "src/app/(shop)/checkout/**",
        "src/app/(shop)/product/**",
        "src/app/(shop)/catalog/**",
        "migrations/0800-0849",
        "tests/**"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "startedAt": "2026-10-23T15:09:40+03:00",
      "finishedAt": "2026-10-23T15:28:54+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 921,
        "failed": 0
      },
      "commit": "80028f0"
    },
    {
      "id": "F2",
      "title": "Редактор SEO-полей и SEO-текста категорий в админке",
      "requirements": [
        "R09",
        "R44",
        "R34"
      ],
      "blockedBy": [],
      "wave": 9,
      "zone": [
        "src/app/admin/(panel)/catalog/**",
        "src/server/db/repositories/{categories,catalog-admin}.ts",
        "src/domain/catalog/categories.ts",
        "src/app/(shop)/catalog/[slug]/page.tsx",
        "src/ui/catalog/**",
        "src/ui/admin/nav.ts",
        "tests/admin/**",
        "tests/catalog/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-10-23T15:41:38+03:00",
      "finishedAt": "2026-10-23T15:45:34+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 932,
        "failed": 0
      },
      "commit": "d39d9eb"
    },
    {
      "id": "F3",
      "title": "Скрытие позиций товаров в админке",
      "requirements": [
        "G01"
      ],
      "blockedBy": [],
      "wave": 10,
      "zone": [
        "src/app/admin/(panel)/catalog/**",
        "src/domain/catalog/**",
        "src/domain/ordering/**",
        "src/domain/customers/{favorites,compare,cards}.ts",
        "src/domain/seo/**",
        "src/domain/content/home.ts",
        "src/server/db/repositories/{products,catalog-admin,carts,home-products}.ts",
        "src/importing/**",
        "src/app/(shop)/product/**",
        "migrations/0900-0949",
        "tests/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-10-23T15:59:27+03:00",
      "finishedAt": "2026-10-23T16:08:55+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 947,
        "failed": 0
      },
      "commit": "f7ba664"
    },
    {
      "id": "F4",
      "title": "Инструкция по запуску на OpenServer, Vercel и Supabase",
      "requirements": [
        "G02"
      ],
      "blockedBy": [],
      "wave": 10,
      "zone": [
        "docs/hosting.md",
        "README.md"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-10-23T15:59:27+03:00",
      "finishedAt": "2026-10-23T16:08:56+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 947,
        "failed": 0
      },
      "commit": "846d5ab"
    },
    {
      "id": "F5",
      "title": "Правки внешнего вида и контента по просьбе владельца",
      "requirements": [
        "G03",
        "G04",
        "G05",
        "G06",
        "G07",
        "G08",
        "G09"
      ],
      "blockedBy": [],
      "wave": 11,
      "zone": [
        "src/ui/home/**",
        "src/ui/layout/**",
        "src/ui/map/**",
        "src/ui/catalog/**",
        "src/ui/theme.css",
        "public/brand/**",
        "src/domain/content/**",
        "src/app/(shop)/{page.tsx,contacts,services,about}/**",
        "src/app/(shop)/catalog/**",
        "src/server/db/repositories/{settings,services,pages}.ts",
        "migrations/0950-0999",
        "tests/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-10-24T13:51:27+03:00",
      "finishedAt": "2026-10-24T14:10:10+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 966,
        "failed": 0
      },
      "commit": "b4f1cc9"
    },
    {
      "id": "F6",
      "title": "Скрытие категорий каталога и страниц сайта в админке",
      "requirements": [
        "G10",
        "G11"
      ],
      "blockedBy": [
        "05"
      ],
      "wave": 12,
      "zone": [
        "src/app/admin/(panel)/{catalog,content}/**",
        "src/domain/catalog/**",
        "src/domain/content/**",
        "src/domain/seo/**",
        "src/domain/customers/{cards,favorites}.ts",
        "src/server/db/repositories/{categories,products,pages,services,news,promotions,catalog-admin,home-products,carts}.ts",
        "src/importing/**",
        "src/ui/layout/**",
        "src/ui/catalog/**",
        "src/app/(shop)/{catalog,product,pages,about,buyers,news,promotions,services,privacy,contacts}/**",
        "migrations/1000-1049",
        "tests/**"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-10-24T14:10:11+03:00",
      "finishedAt": "2026-10-24T14:20:55+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 1001,
        "failed": 0
      },
      "commit": "d94def4"
    }
  ],
  "tests": {
    "passed": 1074,
    "failed": 0
  },
  "debt": {
    "placeholders": [
      "R10 — блок «доставка и оплата» на карточке: метка до настроек (T08)",
      "адрес, часы, координаты, реквизиты — метки в настройках магазина",
      "тексты: о компании, доставка и оплата, гарантия, FAQ, условия, политика данных, описания услуг — черновики-заглушки"
    ],
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
    "server actions (Origin, honeypot, редиректы) не покрыты тестами",
    "src/domain/catalog/store.ts — SQL вне server/db (правило 4)",
    "категория «Генераторы» — 33 фасета, длинная панель фильтров",
    "?page за последней страницей — клиентский redirect из-за loading.tsx",
    "T05: нет срока хранения гостевых корзин и отката использования промокода при отмене заказа",
    "orders.ts: cart.add гасит отметку «цена изменилась» (seen обновлять только через acknowledgeChanges)",
    "checkout: итог 0 ₽ при промокоде 100% — решение в T06",
    "T06: на странице заказа нет кнопки «оплатить снова» при ошибке провайдера; отклонённые webhook (400/401) не журналируются",
    "T07: кнопки избранного/сравнения узнают состояние после гидратации (aria-pressed=false до ответа); UI кабинета вручную в браузере не проверялся",
    "T06 service.ts:240 — сбой orders.transition(refunded) после успешного возврата оставляет платёж refunded/заказ paid; упавший процесс оставляет refund_pending",
    "T06 service.ts:198 — webhook: перевод заказа и платежа не в одной транзакции, гонка двух запросов с одним event id даёт ложный error/500",
    "T06 service.ts:103 — createPayment без ключа идемпотентности при 3 повторах",
    "T06 payments.redirect_url хранит токен доступа к заказу",
    "T06 нет тестов loadTestPayment (доступ) и webhook читает тело до проверки размера, без rate limit",
    "статус портов и ошибки оплаты нужно вывести в админке (T10)",
    "src/server/config.ts — isProduction/cookieSecure считаются только по NODE_ENV (при APP_ENV=production без NODE_ENV куки не Secure): привести к одной isProductionEnv (безопасность, F1)",
    "T10: connectPaymentRunLog() нужно вызвать при старте (instrumentation.ts — T12)",
    "T10: выручка только по is_paid — заказы с оплатой при получении попадут после отметки оплаты",
    "T10: product_seo не читается витриной (T11)",
    "T08: setPopularitySource не вызывается (T12 instrumentation.ts); favicon не подключён; осиротевшие файлы заменённых изображений; нет UI для products.featured; мобильная шапка скрывает счётчики",
    "T09: формы работают только с JS; реальная отправка SMTP не проверена; integration.failed никто не шлёт (вызвать из onec/service); без TRUST_PROXY общий лимит форм на весь сайт",
    ".env.example: строка ADMIN_PASSWORD=Admin содержит значение — оставить только имя переменной (F1)",
    "T11: SQL product_seo/sitemap в domain/seo/store.ts (правило 4); style-src 'unsafe-inline'; за прокси нужен X-Forwarded-Proto",
    "T12: не запускались CI, живой SMTP, реальные 1С/оплата/доставка, Playwright, нагрузка, скачивание фото с champion.ru; клавиатурный проход корзины/оформления и админки не делался; npm audit — 5 high в lint-цепочке"
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
    "2026-10-22T22:14:09+03:00",
    "2026-10-22T22:32:09+03:00",
    "2026-10-22T22:32:10+03:00",
    "2026-10-22T22:36:45+03:00",
    "2026-10-22T22:36:46+03:00",
    "2026-10-22T22:36:47+03:00",
    "2026-10-22T22:40:29+03:00",
    "2026-10-22T22:40:30+03:00",
    "2026-10-22T22:50:08+03:00",
    "2026-10-22T22:50:09+03:00",
    "2026-10-22T22:50:10+03:00",
    "2026-10-22T22:50:43+03:00",
    "2026-10-23T09:47:59+03:00",
    "2026-10-23T09:48:00+03:00",
    "2026-10-23T09:48:36+03:00",
    "2026-10-23T09:50:51+03:00",
    "2026-10-23T09:50:52+03:00",
    "2026-10-23T10:06:24+03:00",
    "2026-10-23T10:06:25+03:00",
    "2026-10-23T10:09:16+03:00",
    "2026-10-23T10:09:17+03:00",
    "2026-10-23T10:09:18+03:00",
    "2026-10-23T10:29:34+03:00",
    "2026-10-23T10:29:35+03:00",
    "2026-10-23T10:29:56+03:00",
    "2026-10-23T10:34:05+03:00",
    "2026-10-23T10:41:05+03:00",
    "2026-10-23T10:41:06+03:00",
    "2026-10-23T10:41:07+03:00",
    "2026-10-23T15:04:16+03:00",
    "2026-10-23T15:04:19+03:00",
    "2026-10-23T15:04:24+03:00",
    "2026-10-23T15:09:24+03:00",
    "2026-10-23T15:09:25+03:00",
    "2026-10-23T15:09:26+03:00",
    "2026-10-23T15:09:40+03:00",
    "2026-10-23T15:26:26+03:00",
    "2026-10-23T15:28:54+03:00",
    "2026-10-23T15:28:55+03:00",
    "2026-10-23T15:41:36+03:00",
    "2026-10-23T15:41:37+03:00",
    "2026-10-23T15:41:38+03:00",
    "2026-10-23T15:45:34+03:00",
    "2026-10-23T15:47:35+03:00",
    "2026-10-23T15:47:58+03:00",
    "2026-10-23T15:58:34+03:00",
    "2026-10-23T15:58:53+03:00",
    "2026-10-23T15:58:54+03:00",
    "2026-10-23T15:59:25+03:00",
    "2026-10-23T15:59:26+03:00",
    "2026-10-23T15:59:27+03:00",
    "2026-10-23T16:08:55+03:00",
    "2026-10-23T16:08:56+03:00",
    "2026-10-24T13:51:23+03:00",
    "2026-10-24T13:51:26+03:00",
    "2026-10-24T13:51:27+03:00",
    "2026-10-24T13:55:55+03:00",
    "2026-10-24T14:10:10+03:00",
    "2026-10-24T14:10:11+03:00",
    "2026-10-24T14:20:55+03:00",
    "2026-10-24T14:21:25+03:00",
    "2026-10-24T14:21:26+03:00",
    "2026-10-24T22:05:44+03:00",
    "2026-10-24T22:13:39+03:00",
    "2026-10-24T22:13:40+03:00",
    "2026-10-24T22:13:48+03:00",
    "2026-10-24T22:13:49+03:00",
    "2026-10-24T22:14:12+03:00",
    "2026-10-24T22:42:05+03:00",
    "2026-10-24T22:42:06+03:00"
  ],
  "rev": 113,
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
    },
    {
      "t": "2026-10-22T22:32:09+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "done",
      "tests": {
        "passed": 469,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:32:09+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-10-22T22:32:10+03:00",
      "k": "add",
      "key": "debt.placeholders",
      "n": 1
    },
    {
      "t": "2026-10-22T22:36:45+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "done",
      "tests": {
        "passed": 473,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:36:46+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "review"
    },
    {
      "t": "2026-10-22T22:36:47+03:00",
      "k": "ticket",
      "ids": [
        "06",
        "07"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-22T22:36:47+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-22T22:40:29+03:00",
      "k": "ticket",
      "ids": [
        "05"
      ],
      "act": "done",
      "tests": {
        "passed": 473,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:40:30+03:00",
      "k": "add",
      "key": "concerns",
      "n": 2
    },
    {
      "t": "2026-10-22T22:50:08+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "done",
      "tests": {
        "passed": 531,
        "failed": 0
      }
    },
    {
      "t": "2026-10-22T22:50:09+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "review"
    },
    {
      "t": "2026-10-22T22:50:10+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-22T22:50:43+03:00",
      "k": "ticket",
      "ids": [
        "10"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T09:47:59+03:00",
      "k": "ticket",
      "ids": [
        "07"
      ],
      "act": "done",
      "tests": {
        "passed": 535,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T09:48:00+03:00",
      "k": "ticket",
      "ids": [
        "08"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T09:48:00+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T09:48:36+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "repair",
      "note": "production определён двумя способами; online-способ без провайдера не скрыт"
    },
    {
      "t": "2026-10-23T09:48:36+03:00",
      "k": "add",
      "key": "concerns",
      "n": 6
    },
    {
      "t": "2026-10-23T09:50:51+03:00",
      "k": "ticket",
      "ids": [
        "06"
      ],
      "act": "done",
      "tests": {
        "passed": 538,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T09:50:52+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T10:06:24+03:00",
      "k": "ticket",
      "ids": [
        "10"
      ],
      "act": "done",
      "tests": {
        "passed": 705,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T10:06:25+03:00",
      "k": "add",
      "key": "concerns",
      "n": 3
    },
    {
      "t": "2026-10-23T10:09:16+03:00",
      "k": "ticket",
      "ids": [
        "08"
      ],
      "act": "done",
      "tests": {
        "passed": 705,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T10:09:17+03:00",
      "k": "add",
      "key": "debt.placeholders",
      "n": 2
    },
    {
      "t": "2026-10-23T10:09:17+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T10:09:18+03:00",
      "k": "ticket",
      "ids": [
        "09"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T10:29:34+03:00",
      "k": "ticket",
      "ids": [
        "09"
      ],
      "act": "done",
      "tests": {
        "passed": 759,
        "failed": 3
      }
    },
    {
      "t": "2026-10-23T10:29:35+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T10:29:56+03:00",
      "k": "ticket",
      "ids": [
        "11"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T10:34:05+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T10:41:05+03:00",
      "k": "ticket",
      "ids": [
        "11"
      ],
      "act": "done",
      "tests": {
        "passed": 812,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T10:41:06+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T10:41:07+03:00",
      "k": "ticket",
      "ids": [
        "12"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T15:04:16+03:00",
      "k": "ticket",
      "ids": [
        "12"
      ],
      "act": "done",
      "tests": {
        "passed": 870,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T15:04:19+03:00",
      "k": "add",
      "key": "concerns",
      "n": 1
    },
    {
      "t": "2026-10-23T15:04:24+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-10-23T15:09:24+03:00",
      "k": "tickets",
      "n": 13
    },
    {
      "t": "2026-10-23T15:09:25+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-23T15:09:26+03:00",
      "k": "add",
      "key": "report",
      "n": 12
    },
    {
      "t": "2026-10-23T15:09:40+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T15:26:26+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 921,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T15:28:54+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 921,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T15:28:55+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-10-23T15:41:36+03:00",
      "k": "gate",
      "g": "G4",
      "ok": false,
      "checked": 34,
      "matched": 31
    },
    {
      "t": "2026-10-23T15:41:36+03:00",
      "k": "tickets",
      "n": 14
    },
    {
      "t": "2026-10-23T15:41:37+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-23T15:41:38+03:00",
      "k": "ticket",
      "ids": [
        "F2"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T15:45:34+03:00",
      "k": "ticket",
      "ids": [
        "F2"
      ],
      "act": "done",
      "tests": {
        "passed": 932,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T15:47:35+03:00",
      "k": "tests",
      "passed": 932,
      "failed": 0
    },
    {
      "t": "2026-10-23T15:47:58+03:00",
      "k": "finish",
      "result": "Интернет-магазин РемТехСад: каталог 1214 товаров, корзина и заказы, кабинет, заявки, отзывы, админка, заглушки 1С/оплаты/доставки/почты, SEO; 932 теста зелёные"
    },
    {
      "t": "2026-10-23T15:58:34+03:00",
      "k": "reopen"
    },
    {
      "t": "2026-10-23T15:58:53+03:00",
      "k": "tickets",
      "n": 15
    },
    {
      "t": "2026-10-23T15:58:54+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 1
    },
    {
      "t": "2026-10-23T15:59:25+03:00",
      "k": "tickets",
      "n": 16
    },
    {
      "t": "2026-10-23T15:59:26+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-23T15:59:27+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-10-23T15:59:27+03:00",
      "k": "ticket",
      "ids": [
        "F3",
        "F4"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-23T16:08:55+03:00",
      "k": "ticket",
      "ids": [
        "F3"
      ],
      "act": "done",
      "tests": {
        "passed": 947,
        "failed": 0
      }
    },
    {
      "t": "2026-10-23T16:08:56+03:00",
      "k": "ticket",
      "ids": [
        "F4"
      ],
      "act": "done",
      "tests": {
        "passed": 947,
        "failed": 0
      }
    },
    {
      "t": "2026-10-24T13:51:23+03:00",
      "k": "tickets",
      "n": 17
    },
    {
      "t": "2026-10-24T13:51:26+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-24T13:51:27+03:00",
      "k": "ticket",
      "ids": [
        "F5"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-24T13:55:55+03:00",
      "k": "tickets",
      "n": 18
    },
    {
      "t": "2026-10-24T13:55:55+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-24T14:10:10+03:00",
      "k": "ticket",
      "ids": [
        "F5"
      ],
      "act": "done",
      "tests": {
        "passed": 966,
        "failed": 0
      }
    },
    {
      "t": "2026-10-24T14:10:11+03:00",
      "k": "ticket",
      "ids": [
        "F6"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-24T14:20:55+03:00",
      "k": "ticket",
      "ids": [
        "F6"
      ],
      "act": "done",
      "tests": {
        "passed": 1001,
        "failed": 0
      }
    },
    {
      "t": "2026-10-24T14:21:25+03:00",
      "k": "tests",
      "passed": 1001,
      "failed": 0
    },
    {
      "t": "2026-10-24T14:21:26+03:00",
      "k": "finish",
      "result": "Магазин РемТехСад: каталог 1214 товаров, заказы, кабинет, заявки, админка со скрытием товаров, категорий и страниц, карта и контент; 1001 тест зелёный"
    },
    {
      "t": "2026-10-24T22:05:44+03:00",
      "k": "reopen"
    },
    {
      "t": "2026-10-24T22:13:39+03:00",
      "k": "tickets",
      "n": 31
    },
    {
      "t": "2026-10-24T22:13:40+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 13
    },
    {
      "t": "2026-10-24T22:13:48+03:00",
      "k": "tickets",
      "n": 31
    },
    {
      "t": "2026-10-24T22:13:49+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-10-24T22:14:12+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-10-24T22:14:12+03:00",
      "k": "ticket",
      "ids": [
        "C01"
      ],
      "act": "start"
    },
    {
      "t": "2026-10-24T22:42:05+03:00",
      "k": "ticket",
      "ids": [
        "C01"
      ],
      "act": "done",
      "tests": {
        "passed": 1074,
        "failed": 0
      }
    },
    {
      "t": "2026-10-24T22:42:06+03:00",
      "k": "ticket",
      "ids": [
        "C01"
      ],
      "act": "review"
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«адаптивный интернет-магазин товаров для сада, садовой техники, снегоуборочного инвентаря, запчастей и сопутствующих товаров»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«Дополнительно сайт принимает заявки на ремонт техники»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«Публичный сайт и отдельная закрытая админ-панель»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«Каталог: категории/подкатегории, карточки, параметры, поиск, сортировка и фильтры»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«Поиск по названию и артикулу»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«Сортировка по алфавиту, популярности и цене»",
      "status": "done"
    },
    {
      "id": "R07",
      "text": "«20 товаров на страницу по умолчанию; кнопка «Показать ещё» загружает следующую страницу без дубликатов»",
      "status": "done"
    },
    {
      "id": "R08",
      "text": "«Фильтры по доступным характеристикам товара; на мобильном — выдвижная панель»",
      "status": "done"
    },
    {
      "id": "R09",
      "text": "«Сетка карточек товаров, хлебные крошки, число результатов и SEO-текст»",
      "status": "done"
    },
    {
      "id": "R10",
      "text": "«Название, артикул, цена, доступность/остаток, галерея фотографий, описание, параметры, доставка/оплата, корзина, избранное, сравнение и сопутствующие товары»",
      "status": "placeholder",
      "why": "брифинг 2026-10-22: ответы в «Дополнениях» брифа; ждёт спецификации"
    },
    {
      "id": "R11",
      "text": "«Отзывы проходят модерацию. Если опубликованных отзывов нет, не показывать фиктивный рейтинг»",
      "status": "done"
    },
    {
      "id": "R12",
      "text": "«Вопрос о товаре сохраняется и передаётся менеджеру»",
      "status": "done"
    },
    {
      "id": "R13",
      "text": "«Корзина и оформление заказа для гостей и зарегистрированных пользователей»",
      "status": "done"
    },
    {
      "id": "R14",
      "text": "«Серверная проверка цен, доступности, количества и итоговой суммы»",
      "status": "done"
    },
    {
      "id": "R15",
      "text": "«Выбор только настроенных и действительно доступных способов доставки/оплаты»",
      "status": "done"
    },
    {
      "id": "R16",
      "text": "«Понятные статусы: создан, ожидает оплаты, оплачен, ошибка/отмена и статусы доставки согласно интеграции»",
      "status": "done"
    },
    {
      "id": "R17",
      "text": "«Повторное нажатие/повторный webhook не должны создавать дубли заказов или платежей»",
      "status": "done"
    },
    {
      "id": "R18",
      "text": "«Личный кабинет: профиль, история покупок/заказов, избранное»",
      "status": "done"
    },
    {
      "id": "R19",
      "text": "«Регистрация, вход, восстановление доступа»",
      "status": "done"
    },
    {
      "id": "R20",
      "text": "«Запрещено показывать чужие заказы даже при подмене ID/URL»",
      "status": "done"
    },
    {
      "id": "R21",
      "text": "«Сравнение товаров»",
      "status": "done"
    },
    {
      "id": "R22",
      "text": "«Страницы услуг с формой заявки на ремонт; полноценный учёт ремонтной мастерской в MVP не входит»",
      "status": "done"
    },
    {
      "id": "R23",
      "text": "«Форма ремонта: имя/контакт, тип техники, описание неисправности и предпочтительный способ связи»",
      "status": "done"
    },
    {
      "id": "R24",
      "text": "«Главная: Верхний блок: адрес, телефон, кнопка «Заказать звонок», вход в личный кабинет, поиск»",
      "status": "done"
    },
    {
      "id": "R25",
      "text": "«Промослайдер до трёх изображений/предложений»",
      "status": "done"
    },
    {
      "id": "R26",
      "text": "«Популярные категории; новые, популярные или акционные товары»",
      "status": "done"
    },
    {
      "id": "R27",
      "text": "«Анонс компании, услуги, контакты и интерактивная карта с геометкой»",
      "status": "done"
    },
    {
      "id": "R28",
      "text": "«Подвал: копирайт, дубликат меню/контактов, социальные ссылки при наличии»",
      "status": "done"
    },
    {
      "id": "R29",
      "text": "«Доступ к корзине, избранному и сравнению на основных страницах»",
      "status": "done"
    },
    {
      "id": "R30",
      "text": "«Страницы: о компании, контакты, акции, список услуг и отдельная страница каждой услуги, доставка/оплата, гарантия/возврат, FAQ и юридические документы»",
      "status": "done"
    },
    {
      "id": "R31",
      "text": "«Акции — список и детальная страница акции» (карта сайта: промокод в корзине)",
      "status": "done"
    },
    {
      "id": "R32",
      "text": "«Новости» / «Отзывы» о компании (О компании)",
      "status": "done"
    },
    {
      "id": "R33",
      "text": "«Заказать звонок», «Форма обратной связи», «Адрес, телефон, часы работы, карта» (Контакты)",
      "status": "done"
    },
    {
      "id": "R34",
      "text": "«Минимум роли администратора и менеджера. Управление контентом, услугами, слайдами, заказами, обращениями, вопросами, отзывами, SEO-полями, сотрудниками и статусом интеграций»",
      "status": "done"
    },
    {
      "id": "R35",
      "text": "«Проверка прав выполняется на сервере для каждого действия. Критические изменения пишутся в audit log. Секреты не показываются после сохранения в открытом виде»",
      "status": "done"
    },
    {
      "id": "R36",
      "text": "«Каталог/цены/остатки редактируются с учётом выбранного источника истины»",
      "status": "done"
    },
    {
      "id": "R37",
      "text": "«Один склад на старте; розничная цена и возможная скидочная цена»",
      "status": "done"
    },
    {
      "id": "R38",
      "text": "«Планируется двусторонний обмен с будущей 1С, включая номенклатуру/остатки/цены и заказы с сайта»",
      "status": "done"
    },
    {
      "id": "R39",
      "text": "«Нужны загрузка каталога, предпросмотр и отчёт ошибок. Excel/CSV/XML могут быть вариантами после согласования формата»",
      "status": "done"
    },
    {
      "id": "R40",
      "text": "«Повтор импорта не создаёт дубликаты товаров/категорий»",
      "status": "done"
    },
    {
      "id": "R41",
      "text": "«Оплата: Провайдер не выбран. До получения документации — интерфейс адаптера и тестовый режим, не фиктивная production-оплата»",
      "status": "done"
    },
    {
      "id": "R42",
      "text": "«Доставка: Показывать только настроенные способы»",
      "status": "done"
    },
    {
      "id": "R43",
      "text": "«Уведомления о заказах, вопросах и заявках направлять менеджерам после предоставления адресов/SMTP/API»",
      "status": "done"
    },
    {
      "id": "R44",
      "text": "«Редактируемые title, description, H1, alt и slug; корректные canonical, sitemap.xml, robots.txt, HTTPS-редиректы; технические и личные страницы не индексировать»",
      "status": "done"
    },
    {
      "id": "R45",
      "text": "«Сжатие/изменение размеров загружаемых изображений и проверка типа/размера»",
      "status": "done"
    },
    {
      "id": "R46",
      "text": "«Фирменный стиль будет опираться на логотип, который заказчик предоставит отдельно» (до этого — нейтральная временная тема)",
      "status": "done"
    },
    {
      "id": "R47",
      "text": "«Обязательны адаптивность, клавиатурная навигация, видимый focus, контраст, подписи форм, alt изображений, loading/empty/error/success states и поддержка prefers-reduced-motion»",
      "status": "done"
    },
    {
      "id": "R48",
      "text": "«Никаких выдуманных отзывов/рейтингов»",
      "status": "done"
    },
    {
      "id": "R49",
      "text": "«Требуются SEO, сжатие изображений, SSL/HTTPS, sitemap, robots.txt, почтовые уведомления, инструкции запуска и развёртывания»",
      "status": "done"
    },
    {
      "id": "R50",
      "text": "«Мобильная навигация: нижняя панель: Главная / Каталог / Избранное / Корзина / Профиль»",
      "status": "done"
    },
    {
      "id": "R51",
      "text": "«Информационные разделы и услуги… Политику персональных данных и правовые тексты проверить специалистом»",
      "status": "placeholder",
      "why": "брифинг 2026-10-22: ответы в «Дополнениях» брифа; ждёт спецификации"
    },
    {
      "id": "R52",
      "text": "«Админка: Обзор, Каталог, Заказы, Склад/остатки, Цены и акции, Покупатели, Контент, Отзывы и вопросы, Заявки на ремонт, Импорт и интеграции, Аналитика, Пользователи/роли»",
      "status": "done"
    },
    {
      "id": "R01i",
      "text": "(подразумевается) стек не выбран — «Стек не утверждён», сравнить не более трёх вариантов",
      "status": "done"
    },
    {
      "id": "R02i",
      "text": "(подразумевается) «инструкции по Open Server/Windows» — локальный запуск на Windows",
      "status": "done"
    },
    {
      "id": "G01",
      "text": "«Добавь в админку функцию скрытия позиций товаров»",
      "status": "done"
    },
    {
      "id": "G02",
      "text": "«напиши инструкцию как запустить все на openserver или vercel или supabase»",
      "status": "done"
    },
    {
      "id": "G03",
      "text": "«Добавить изображение на фон со слоганом»",
      "status": "done"
    },
    {
      "id": "G04",
      "text": "«Убери часы работы»",
      "status": "done"
    },
    {
      "id": "G05",
      "text": "«Сделай карточки товаров одного размера»",
      "status": "done"
    },
    {
      "id": "G06",
      "text": "«Добавь услугу по ремонту техники»",
      "status": "done"
    },
    {
      "id": "G07",
      "text": "«Убери белый фон с логотипа»",
      "status": "done"
    },
    {
      "id": "G08",
      "text": "«Напиши текст о компании»",
      "status": "done"
    },
    {
      "id": "G09",
      "text": "«Сделай интерактивную карту с меткой по адресу - Талдом, Садовый Переулок 10»",
      "status": "done"
    },
    {
      "id": "G10",
      "text": "«Добавь в админку функции скрытия каталогов»",
      "status": "done"
    },
    {
      "id": "G11",
      "text": "«Добавь в админку функции скрытия … страниц на сайте»",
      "status": "done"
    },
    {
      "id": "G12",
      "text": "«Не ограничивайся созданием статических макетов. Нужен работающий продукт с реальными действиями, связью интерфейса с backend, сохранением данных в базе, проверкой прав доступа, обработкой ошибок и тестированием»",
      "status": "in-ticket"
    },
    {
      "id": "G13",
      "text": "«Все страницы должны образовывать единую систему дизайна»",
      "status": "done"
    },
    {
      "id": "G14",
      "text": "«Создай общую верхнюю панель, которая используется на всех вкладках» (название, подпись, глобальный поиск, «Перейти на сайт», центр уведомлений, индикатор, аватар, имя и роль, меню профиля)",
      "status": "in-ticket"
    },
    {
      "id": "G15",
      "text": "«Создай фиксированную или закрепляемую слева навигационную панель» (сворачивание, активный пункт, группы, подразделы, иконки, адаптив; структура Главная/Каталог/Продажи/Контент/Услуги/Настройки)",
      "status": "done"
    },
    {
      "id": "G16",
      "text": "«Создай рабочий Dashboard» (заказы, выручка, товары, нет в наличии, новые клиенты, обращения, заявки на ремонт, последние заказы и события, статистика продаж, популярные товары, заказы, требующие внимания; период и фильтры; реальные данные)",
      "status": "in-ticket"
    },
    {
      "id": "G17",
      "text": "«Реализуй полный CRUD для товаров» (название, slug, SKU, штрихкод, краткое и полное описание, цена, старая цена, закупочная с ограничением доступа, остаток, статус наличия, бренд, категории, характеристики, изображения, публикация, видимос…",
      "status": "in-ticket"
    },
    {
      "id": "G18",
      "text": "«Таблица товаров» (поиск, сортировка, пагинация, строки, фильтры по категории/бренду/наличию/публикации/цене, массовые действия, перемещение, дублирование, удаление с подтверждением, экспорт отфильтрованных; на уровне API и БД)",
      "status": "in-ticket"
    },
    {
      "id": "G19",
      "text": "«Остатки: Разделяй наличие товара и его публикацию… Изменения остатков должны записываться в историю операций»",
      "status": "in-ticket"
    },
    {
      "id": "G20",
      "text": "«Дерево категорий» (поиск, уровни, сворачивание, счётчик, активная, иконки, перетаскивание, создание дочерних, смена родителя, скрытие; без циклов)",
      "status": "in-ticket"
    },
    {
      "id": "G21",
      "text": "«Добавь справа от названия каждой категории кнопку с иконкой глаза» (открытый/перечёркнутый, сохранение на сервере, возврат при ошибке, родитель скрыт — дети недоступны, товары не удаляются)",
      "status": "in-ticket"
    },
    {
      "id": "G22",
      "text": "«Карточка выбранной категории» (изображение, название, slug/URL, ID, описание, статус, позиция в меню, родитель, загрузка изображения, редактирование; JPG/PNG/WebP с проверкой содержимого)",
      "status": "in-ticket"
    },
    {
      "id": "G23",
      "text": "«Вкладки категории: Товары, Подкатегории, SEO, Фильтры, Баннеры, Дополнительно» (в URL; SEO: title, description, slug, canonical, индексация, SEO-текст; Фильтры; Баннеры — выбор, порядок, статус, удаление связи)",
      "status": "in-ticket"
    },
    {
      "id": "G24",
      "text": "«Вкладка «Дополнительно»: настройки отображения (меню, главная, каталог), сортировка (позиция, приоритет), связанные категории (теги), код категории, внешний ID, комментарий; кнопки «Сохранить изменения» и «Отмена»»",
      "status": "in-ticket"
    },
    {
      "id": "G25",
      "text": "«Бренды» (название, slug, логотип, описание, сайт, публикация, сортировка, SEO, товары; CRUD, поиск, архив/удаление)",
      "status": "in-ticket"
    },
    {
      "id": "G26",
      "text": "«Характеристики товаров» (типы строка/число/логическое/список/дата, единица, код, допустимые значения, фильтр, сравнение, обязательность, порядок, ограничение на категорию; нормализованно)",
      "status": "in-ticket"
    },
    {
      "id": "G27",
      "text": "«Фильтры каталога» (цена, бренд, наличие, характеристики, категории; создание, тип, значения, порядок, включение; реально меняют выдачу на публичной стороне)",
      "status": "in-ticket"
    },
    {
      "id": "G28",
      "text": "«Импорт и экспорт» (CSV и YML, проверка структуры, предпросмотр, сопоставление колонок, обязательные поля, дубликаты, режимы добавления/обновления, отчёт по строкам, история, экспорт по фильтрам, атомарность, лимиты)",
      "status": "in-ticket"
    },
    {
      "id": "G29",
      "text": "«Заказы» (поля, статусы Новый/Подтверждён/Собирается/Передан в доставку/Выполнен/Отменён, возврат к предыдущему без потери истории, редактирование, комментарии, история, печать, экспорт, уведомления; оплата не имитируется)",
      "status": "in-ticket"
    },
    {
      "id": "G30",
      "text": "«Клиенты» (имя, телефон, email, дата регистрации, история заказов, сумма, количество, комментарий менеджера, статус клиента, согласия; поиск, фильтры, страница; ПДн по ролям)",
      "status": "in-ticket"
    },
    {
      "id": "G31",
      "text": "«Обращения» (тема, имя, контакты, текст, канал, статус новое/в работе/ожидает ответа/закрыто, ответственный, история, комментарии, фильтры, поиск, уведомления)",
      "status": "in-ticket"
    },
    {
      "id": "G32",
      "text": "«Страницы: CMS-редактор» (заголовок, slug, содержимое, изображения, публикация, дата публикации, SEO, превью, черновик, редактирование опубликованной; без XSS)",
      "status": "in-ticket"
    },
    {
      "id": "G33",
      "text": "«Баннеры» (название, изображение, мобильное, alt, заголовок, подзаголовок, кнопка, URL, даты, позиция, порядок, статус; тексты админа)",
      "status": "in-ticket"
    },
    {
      "id": "G34",
      "text": "«Новости» (заголовок, содержание, превью, изображение, дата публикации, автор, статус, категории новостей, SEO)",
      "status": "in-ticket"
    },
    {
      "id": "G35",
      "text": "«Акции» (условия, период, скидки, участвующие товары, ограничения, статус, приоритет; без несовместимых скидок) и «Маркетинг: купоны, скидки, правила акций»",
      "status": "in-ticket"
    },
    {
      "id": "G36",
      "text": "«Отзывы» (оценка, текст, автор, товар, модерация, публикация, ответ администратора, дата; без фиктивных)",
      "status": "in-ticket"
    },
    {
      "id": "G37",
      "text": "«Создай раздел «Услуги и ремонт»» (название, описание, изображение, цена/стоимость, категория услуги, статус, порядок, SEO)",
      "status": "in-ticket"
    },
    {
      "id": "G38",
      "text": "«Заявки на ремонт» (номер, клиент, телефон, email, тип техники, бренд, модель, неисправность, фото, дата, ответственный, статус из списка, комментарии, история; поиск, фильтры, назначение)",
      "status": "in-ticket"
    },
    {
      "id": "G39",
      "text": "«Основные настройки» и «Переключатели магазина» (название, слоган, описание, логотип, favicon, телефон, email, адрес, график работы, соцсети, страна, регион, валюта, часовой пояс; включить магазин, показывать цены, регистрация, подтвержден…",
      "status": "in-ticket"
    },
    {
      "id": "G40",
      "text": "«Доставка» (название способа, описание, стоимость, бесплатная доставка, география, сроки, минимальная сумма, активность)",
      "status": "in-ticket"
    },
    {
      "id": "G41",
      "text": "«Оплата» (название, описание, доступность, комиссия, ограничения, параметры интеграции, тестовый/рабочий режим; ключи безопасно; без фиктивных шлюзов)",
      "status": "in-ticket"
    },
    {
      "id": "G42",
      "text": "«Склады и остатки» (склады, расположение, остатки по складам, движение, резервы, история)",
      "status": "in-ticket"
    },
    {
      "id": "G43",
      "text": "«Налоги и цены» (валюта, округление, налоги, видимость цен; деньги без float)",
      "status": "in-ticket"
    },
    {
      "id": "G44",
      "text": "«Email и уведомления» (события, SMTP/почтовый сервис, шаблоны, тестовая отправка, журнал, ошибки без ложного успеха)",
      "status": "in-ticket"
    },
    {
      "id": "G45",
      "text": "«SEO и метаданные» (название сайта, description, Open Graph, canonical, robots, sitemap, правила индексации, шаблоны для товаров и категорий; влияют на публичные страницы)",
      "status": "in-ticket"
    },
    {
      "id": "G46",
      "text": "«Пользователи и роли» (RBAC; суперадминистратор, администратор, менеджер, контент-менеджер, сотрудник склада, специалист сервиса; свои роли; права на backend; создание, изменение, блокировка, смена и восстановление пароля, завершение сесси…",
      "status": "in-ticket"
    },
    {
      "id": "G47",
      "text": "«Журнал действий» (пользователь, действие, объект, id, время, результат, IP, безопасный контекст; фильтры по пользователю, периоду, типу, объекту; без секретов)",
      "status": "in-ticket"
    },
    {
      "id": "G48",
      "text": "«Статистика» (продажи, заказы, товары, остатки, клиенты)",
      "status": "in-ticket"
    },
    {
      "id": "G49",
      "text": "«Резервное копирование» (создание, статус, история, проверка, восстановление с подтверждением и правами; не называть экспорт товаров резервной копией)",
      "status": "in-ticket"
    },
    {
      "id": "G50",
      "text": "«Интеграции» (расширяемая архитектура, настройки, состояние соединения, безопасные ключи, не показывать «Подключено» без проверки)",
      "status": "in-ticket"
    },
    {
      "id": "G51",
      "text": "«Создай рабочий глобальный поиск» (товары, категории, заказы, клиенты, обращения; подсказки, типы, переход; права; ограничения)",
      "status": "in-ticket"
    },
    {
      "id": "G52",
      "text": "«Реализуй систему административных уведомлений» (заказы, обращения, заявки на ремонт, ошибки импорта и интеграций; дата, тип, прочтение, ссылка; без ложных)",
      "status": "in-ticket"
    },
    {
      "id": "G53",
      "text": "«Сделай переиспользуемые компоненты» (AdminLayout, Sidebar, Topbar, Breadcrumbs, PageHeader, DataTable, Pagination, SearchInput, FilterPanel, StatusBadge, Toggle, ConfirmDialog, FormField, SelectField, FileUploader, ImagePreview, Tabs, Emp…",
      "status": "done"
    },
    {
      "id": "G54",
      "text": "«Проведи базовую проверку безопасности всего административного интерфейса»",
      "status": "in-ticket"
    },
    {
      "id": "G55",
      "text": "«Адаптивность» (ноутбуки, планшеты, телефоны: выдвижное меню, формы в одну колонку, таблицы) и «Производительность» (пагинация, индексы, без N+1)",
      "status": "in-ticket"
    },
    {
      "id": "G56",
      "text": "«Тестирование» (unit, API, интеграционные, E2E ключевых сценариев в изолированном окружении; не утверждать непроведённое)",
      "status": "in-ticket"
    },
    {
      "id": "G57",
      "text": "«Сделай изменение в админке и обнови песочницу»",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G3": {
      "ok": true,
      "at": "2026-10-24T22:13:49+03:00",
      "problems": 0
    }
  },
  "result": null,
  "report": [
    "В выгрузке 4 товара без цены (id 217943, 217944, 217946, 217947) — не импортированы, нужна цена от владельца",
    "Фото скачиваются командой import:yml --images; по сети на реальном champion.ru не проверялось",
    "Вход без прокси: сам лимит попыток теперь не блокирует всех сразу, но за туннелем/прокси нужно задать TRUST_PROXY=true, иначе лимиты форм общие на весь сайт",
    "Публичный поиск и листинг каталога без лимита по IP — можно нагрузить частыми запросами",
    "У самой большой категории (Генераторы, 33 фильтра) страница строится заметно дольше остальных: считается ~66 запросов, время не замерено",
    "Формы заявок работают только с включённым JavaScript; подтверждения на введённый email уходят без проверки владельца (канал спама, лимит 10/час на IP)",
    "Старые файлы заменённых картинок контента не удаляются; гостевые корзины не имеют срока хранения",
    "Письма доставляются «хотя бы один раз» — при падении процесса возможен дубль; в таблице писем до отправки лежат ПДн и ссылка сброса пароля",
    "Отменённый заказ с ожидающим платежом: покупатель ещё может заплатить — деньги придут, оператор увидит предупреждение и вернёт вручную",
    "После ошибки оплаты нет кнопки «оплатить снова» — нужно оформить заказ заново",
    "createPayment повторяется без ключа идемпотентности — добавить до подключения настоящего провайдера",
    "Выручка в аналитике считается по отмеченной оплате: заказы с оплатой при получении попадут после ручной отметки",
    "Резервные копии содержат ПДн и хеши паролей — хранить в закрытом месте; права на файл не ограничиваются",
    "SQL чтения лежит вне слоя репозиториев в 8 местах (отступление от правила 4, запросы параметризованы)"
  ]
}
