# Предварительная модель данных

## Основные сущности
- `Product`: внутренний ID, внешний ID/UUID источника, SKU/артикул, название, описание, статус публикации, бренд, категория, timestamps.
- `Category`: ID, внешний ID, parent ID, slug, имя, SEO-поля.
- `ProductAttributeDefinition` и `ProductAttributeValue`: типизированные характеристики и значения.
- `ProductImage` / `ProductDocument`: ссылка/путь, порядок, alt, тип и источник.
- `Price`: тип розничной цены, сумма, валюта, источник, время обновления.
- `DiscountPrice`: цена/правило, период действия, источник и приоритет.
- `StockSnapshot`: склад, количество, резерв, время синхронизации.
- `Customer`, `Address`, `Consent`.
- `Cart`, `CartItem`.
- `Order`, `OrderItem`, `OrderEvent`, `PaymentAttempt`, `Shipment`.
- `Review`, `ProductQuestion`, `ServiceRequest`, `CallbackRequest`, `ContactMessage`.
- `ContentPage`, `NewsItem`, `Promotion`, `Banner`.
- `ImportJob`, `ImportRowError`, `IntegrationRun`, `WebhookEvent`, `AuditLog`, `AdminUser`, `Role`, `Permission`.

## Идентификация и целостность
- Для синхронизируемых сущностей хранить внешний ID и источник.
- Уникальные ограничения по `(source, external_id)` там, где это применимо.
- SKU не использовать как единственный технический ключ, если он может меняться или повторяться.
- Для заказов — уникальный внешний ID сайта при передаче в 1С.
- Цены/количество пересчитывать на сервере; данные браузера не считать доверенными.
- Конкретную схему уточнить после выбора стека и анализа примеров выгрузки 1С.
