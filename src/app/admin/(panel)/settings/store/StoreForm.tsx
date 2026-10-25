'use client';

import { useState } from 'react';
import { COUNTRIES, CURRENCIES, MAX_SOCIAL_LINKS, SOCIAL_TYPES, TIME_ZONES, type SocialEntry } from '@/domain/content/store-constants';
import type { StoreFlags } from '@/domain/content/store-flags';
import type { StoreSettingsView } from '@/domain/content/store-settings';
import { FileUploader, FormField, SelectField, TextAreaField, Toggle, UnsavedChangesGuard } from '@/ui/admin/kit';
import { saveStoreSettingsAction } from './actions';

const FLAG_ROWS: { key: keyof StoreFlags; label: string; hint: string }[] = [
  { key: 'storeEnabled', label: 'Включить магазин', hint: 'Выключен — витрина отвечает «Магазин временно закрыт» (503); админка и проверка живости работают' },
  { key: 'showPrices', label: 'Показывать цены', hint: 'Выключен — цены и «В корзину» скрыты, корзина и оформление заказа закрыты на сервере' },
  { key: 'registration', label: 'Разрешить регистрацию', hint: 'Выключен — регистрация отклоняется на сервере, форма скрыта' },
  { key: 'emailConfirm', label: 'Требовать подтверждение email', hint: 'Вход только после перехода по ссылке из письма. Нужна настроенная почта' },
  { key: 'maintenance', label: 'Режим технического обслуживания', hint: 'Посетители видят страницу работ (503), сотрудники с сессией — сайт с плашкой' },
  { key: 'spamProtection', label: 'Защита форм от спама', hint: 'Скрытое поле-ловушка и дополнительные лимиты. Обязательные меры (лимиты входа, проверка Origin) остаются всегда' },
];

export function StoreForm({ settings: s }: { settings: StoreSettingsView }) {
  const [socials, setSocials] = useState<SocialEntry[]>(s.socials);
  const disabled = s.readOnly;
  return (
    <form id="store-form" action={saveStoreSettingsAction} encType="multipart/form-data" className="ak-form-grid">
      <UnsavedChangesGuard formId="store-form" />
      <input type="hidden" name="version" value={s.version} />
      <fieldset disabled={disabled} className="ak-form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section className="ak-card" aria-labelledby="st-info">
          <h2 id="st-info">Информация о магазине</h2>
          <FormField name="storeName" label="Название магазина" required maxLength={120} defaultValue={s.storeName} />
          <FormField name="tagline" label="Слоган" maxLength={200} defaultValue={s.tagline} />
          <TextAreaField name="description" label="Описание магазина" rows={4} maxLength={1000} defaultValue={s.description} />
          <FileUploader
            name="logo"
            label="Логотип магазина"
            value={s.logoUrl}
            alt="Логотип"
            maxBytes={2 * 1024 * 1024}
            accept={['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']}
            hint="PNG, JPG, WebP или SVG до 2 МБ. Содержимое проверяется на сервере; SVG преобразуется в PNG"
          />
          <FileUploader
            name="favicon"
            label="Favicon"
            value={s.faviconUrl}
            alt="Favicon"
            maxBytes={512 * 1024}
            accept={['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml']}
            hint="PNG, ICO или SVG до 512 КБ"
          />
        </section>

        <section className="ak-card" aria-labelledby="st-contacts">
          <h2 id="st-contacts">Контактная информация</h2>
          <FormField name="phone" label="Телефон" maxLength={40} defaultValue={s.phone} />
          <FormField name="email" label="Email" type="email" maxLength={200} defaultValue={s.email} />
          <FormField name="address" label="Адрес" maxLength={300} defaultValue={s.address} />
          <FormField name="workSchedule" label="График работы" maxLength={200} defaultValue={s.workSchedule} hint="Хранится в настройках, но на сайте не выводится" />
        </section>

        <section className="ak-card" aria-labelledby="st-social">
          <h2 id="st-social">Социальные сети</h2>
          <p className="ak-field__hint">Ссылки http(s). В подвале сайта показываются только заполненные.</p>
          {socials.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <SelectField id={`social-type-${i}`} name="social_type" label="Тип" defaultValue={row.type} options={SOCIAL_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
              <FormField id={`social-url-${i}`} name="social_url" label="Ссылка" type="url" maxLength={300} defaultValue={row.url} placeholder="https://" />
              <button type="button" className="ak-btn ak-btn--outline" onClick={() => setSocials(socials.filter((_, j) => j !== i))} aria-label={`Удалить ссылку ${i + 1}`}>
                Удалить
              </button>
            </div>
          ))}
          {socials.length < MAX_SOCIAL_LINKS ? (
            <button type="button" className="ak-btn ak-btn--outline" onClick={() => setSocials([...socials, { type: 'telegram', url: '' }])}>
              Добавить соцсеть
            </button>
          ) : null}
        </section>

        <section className="ak-card" aria-labelledby="st-region">
          <h2 id="st-region">Регион и валюта</h2>
          <SelectField name="country" label="Страна" defaultValue={s.country} options={COUNTRIES} />
          <FormField name="region" label="Регион" maxLength={100} defaultValue={s.region} />
          <SelectField
            name="currency"
            label="Валюта"
            defaultValue={s.currency}
            options={Object.entries(CURRENCIES).map(([value, c]) => ({ value, label: c.label }))}
            hint="Деньги в системе хранятся в копейках; смена валюты меняет только символ при показе цен"
          />
          <SelectField name="timezone" label="Часовой пояс" defaultValue={s.timezone} options={TIME_ZONES} hint="Используется при показе дат на сайте и в админке" />
        </section>

        <section className="ak-card" aria-labelledby="st-flags">
          <h2 id="st-flags">Работа магазина</h2>
          {FLAG_ROWS.map((r) => (
            <div key={r.key}>
              <Toggle
                name={`flag_${r.key}`}
                checked={s.flags[r.key]}
                label={r.label}
                description={r.hint}
                disabled={disabled || (r.key === 'emailConfirm' && !s.mailConfigured && !s.flags.emailConfirm)}
              />
            </div>
          ))}
          {!s.mailConfigured ? <p className="ak-field__hint">Почта не настроена (MAIL_HOST, MAIL_FROM): подтверждение email включить нельзя.</p> : null}
          <TextAreaField name="maintenanceMessage" label="Сообщение для режима обслуживания" rows={3} maxLength={500} defaultValue={s.maintenanceMessage} hint="Показывается посетителям на странице «Технические работы»" />
        </section>
      </fieldset>
    </form>
  );
}
