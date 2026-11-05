# Концептуальная модель данных

Окончательная схема зависит от выбранного стека. Предусмотреть сущности:
- `Product`, `Category`, `ProductImage`, `InventorySnapshot`, `Price`;
- `Customer`, `Order`, `OrderItem`, `PaymentAttempt`;
- `Review`, `ProductQuestion`, `RepairRequest`;
- `ContentPage`, `Promotion`, `ServicePage`, `Slide`;
- `AdminUser`, `Role`, `Permission`;
- `IntegrationRun`, `IntegrationError`, `AuditEvent`.

Требования: внешний ID для синхронизируемых сущностей; уникальные ограничения для предотвращения дублей; строка заказа содержит снимок названия и цены на момент покупки; статусы задаются перечислением/согласованной моделью; серверные ограничения целостности; минимизация персональных данных; миграции версионируются и тестируются.
