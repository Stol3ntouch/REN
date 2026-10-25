# Запуск РемТехСад на сервере с ISPmanager

Сайт — приложение Node.js (Next.js 16 + SQLite). Нужен сервер с правами root или SSH (VPS/выделенный). На обычном «виртуальном хостинге» без SSH и без Node.js 24 сайт не запустится.

**Требования:** Node.js **24 или новее** (используется встроенный `node:sqlite`), npm, 1 ГБ ОЗУ для сборки, домен с A-записью на IP сервера.

Названия пунктов меню ISPmanager могут немного отличаться в зависимости от версии (здесь — ISPmanager 6).

## 1. Домен и SSL

1. «Домены» → «WWW-домены» → «Создать». Укажите домен, владельца (пользователя), включите «Let's Encrypt» (SSL).
2. Запомните каталог сайта: обычно `/var/www/<пользователь>/data/www/<домен>/`.
3. В настройках домена обработчик оставьте «Статика/nginx» — на Node приложение мы будем проксировать (шаг 6).

## 2. Node.js 24

Через SSH под root:

```bash
node -v
```

Если версия ниже 24 — установите (вариант с nvm под пользователем сайта):

```bash
su - <пользователь>
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
nvm alias default 24
node -v
```

(В ISPmanager 6 в «Настройки веб-сервера → Node.js» можно поставить версию из панели, но 24 там есть не всегда — тогда используйте nvm.)

## 3. Загрузка файлов

1. «Менеджер файлов» → каталог сайта. Удалите стандартные файлы (`index.html` и т. п.).
2. Загрузите архив `remtehsad.tar.gz` и распакуйте («Извлечь»), либо по SSH:

```bash
cd /var/www/<пользователь>/data/www/<домен>
tar -xzf remtehsad.tar.gz
```

В архиве нет базы данных, `.env` и `node_modules` — они создаются на следующих шагах.

## 4. Настройка окружения

```bash
cd /var/www/<пользователь>/data/www/<домен>
cp .env.example .env
nano .env
```

Минимум для боевого режима:

| Переменная | Значение |
|------------|----------|
| `NODE_ENV` | `production` |
| `SITE_URL` | `https://ваш-домен.ru` (без слэша в конце) |
| `SESSION_SECRET` | случайная строка: `openssl rand -hex 32` |
| `TRUST_PROXY` | `true` (сайт стоит за nginx) |
| `DATABASE_PATH` | `./data/rts.sqlite` |
| `DATA_DIR` | `./data` |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `MAIL_TO` | SMTP для писем (без них письма копятся в очереди `email_outbox`) |

Не публикуйте `.env`, не отправляйте его в чат и репозиторий. Тестовая оплата в `production` отключена (`PAYMENT_PROVIDER=test` не работает) — это нормально.

## 5. Установка, сборка, база, администратор

```bash
npm ci
npm run build
npm run db:migrate
npm run import:yml -- ./catalog.yml          # каталог: 1214 товаров, 185 категорий
ADMIN_PASSWORD='ВашСложныйПароль' npm run admin:create -- admin
```

- `catalog.yml` лежит в корне архива. Фото товаров — внешние ссылки champion.ru (локальной копии нет).
- Роли создаются при первом запуске автоматически; пользователь `admin` получает роль администратора.
- Пароль задайте свой, длинный; после входа его можно сменить в «Профиль».

Проверка вручную: `PORT=3000 npm run start` → в другом окне `curl -i http://127.0.0.1:3000/api/health` (ожидается 200). Остановите `Ctrl+C`.

## 6. Постоянный запуск (pm2)

```bash
npm install -g pm2          # под root; либо под пользователем: npm install -g pm2
cd /var/www/<пользователь>/data/www/<домен>
pm2 start npm --name remtehsad -- run start -- -p 3000
pm2 save
pm2 startup                  # выполните команду, которую он выведет
```

Переменные берутся из `.env`. Логи: `pm2 logs remtehsad`. Перезапуск: `pm2 restart remtehsad`.

## 7. Прокси nginx в ISPmanager

«Домены» → «WWW-домены» → ваш домен → «Конфигурация» (или «Дополнительные директивы nginx»). Добавьте:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 20m;
}
```

Если в панели уже есть собственный `location /` — замените его этим (иначе будет конфликт). Сохраните — nginx перезагрузится. Откройте `https://ваш-домен.ru` и `https://ваш-домен.ru/admin/login`.

**Важно:** заголовок `X-Forwarded-Proto` обязателен, иначе сайт уйдёт в бесконечный редирект HTTP→HTTPS. Если всё равно цикл — временно добавьте в `.env` `HTTPS_REDIRECT=off` и перезапустите (`pm2 restart remtehsad`), затем исправьте прокси.

## 8. Резервные копии

База и загрузки лежат в `data/`.

```bash
npm run backup                      # копия в data/backups
npm run restore -- <файл копии>     # восстановление
```

Настройте в ISPmanager «Планировщик (cron)» запуск `npm run backup` раз в сутки и копируйте `data/backups` за пределы сервера.

## 9. Обновление сайта

1. Сделайте `npm run backup`.
2. Распакуйте новый архив поверх (каталог `data/` и файл `.env` в архиве отсутствуют — они не затрутся).
3. `npm ci && npm run build && npm run db:migrate && pm2 restart remtehsad`

Миграции только вперёд; применённые файлы не менять.

## 10. Частые проблемы

| Симптом | Причина и решение |
|---------|-------------------|
| `node:sqlite` не найден / ошибка при старте | Node ниже 24: `node -v`, поставьте 24 (шаг 2) и перезапустите pm2 под этим пользователем |
| 502 Bad Gateway | приложение не запущено: `pm2 status`, `pm2 logs remtehsad`; порт в nginx и в `pm2` должен совпадать (3000) |
| Бесконечный редирект | нет `X-Forwarded-Proto` в прокси (шаг 7) или `TRUST_PROXY` не `true` |
| `SESSION_SECRET`/`SITE_URL` ошибка при старте | в production оба обязательны (шаг 4) |
| Не входит в админку | пересоздайте пароль: `ADMIN_PASSWORD='...' npm run admin:create -- admin` |
| Сборка падает по памяти | добавьте swap или соберите на другом компьютере и перенесите `.next` |
| Нет писем | не заданы `MAIL_*`; письма лежат в очереди, их видно в админке («Почта») |

## 11. Что ещё нужно от владельца

Реквизиты и юридические тексты, контактная почта и соцсети, цены 4 товаров без цены (id 217943, 217944, 217946, 217947), права на фото champion.ru, настройка платёжного провайдера и службы доставки (по умолчанию — заглушки). Смените все пароли, которые передавались в чате.
