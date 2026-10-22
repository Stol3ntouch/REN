/**
 * Текст блока «Доставка и оплата» на карточке товара. Настройки магазина появятся с контентом (T08):
 * он вызывает setDeliveryPaymentTextProvider(() => settings.get('delivery_payment_text')).
 * Пока провайдера нет — null, и страница показывает метку-заглушку, а не выдуманные условия.
 */
type Provider = () => string | null | undefined;

let provider: Provider | null = null;

export function setDeliveryPaymentTextProvider(p: Provider | null): void {
  provider = p;
}

export function getDeliveryPaymentText(): string | null {
  const t = provider?.();
  return t && t.trim() !== '' ? t : null;
}
