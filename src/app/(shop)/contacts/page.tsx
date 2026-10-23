import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getShopInfo } from '@/domain/content/settings';
import { contentMetadata } from '@/domain/content/seo';
import { CallbackForm, ContactForm } from '@/ui/forms/forms';
import { ShopMap } from '@/ui/map/ShopMapBlock';
import { Placeholder } from '@/ui/placeholder';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Контакты', fallbackDescription: 'Адрес, телефон и часы работы магазина «РемТехСад».', path: '/contacts' });

export default async function ContactsPage() {
  await connection();
  const shop = getShopInfo();
  return (
    <>
      <h1>Контакты</h1>
      <div className="home-contacts">
        <dl className="home-contacts__list">
          <div>
            <dt>Телефон</dt>
            <dd>{shop.phone ? <a href={shop.phoneHref ?? undefined}>{shop.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}</dd>
          </div>
          <div>
            <dt>Часы работы</dt>
            <dd>{shop.hours ?? <Placeholder label="ЧАСЫ РАБОТЫ" />}</dd>
          </div>
          <div>
            <dt>Адрес</dt>
            <dd>{shop.address ?? <Placeholder label="АДРЕС" />}</dd>
          </div>
          {shop.email ? (
            <div>
              <dt>Электронная почта</dt>
              <dd>
                <a href={`mailto:${shop.email}`}>{shop.email}</a>
              </dd>
            </div>
          ) : null}
          {shop.socials.length > 0 ? (
            <div>
              <dt>Мы в соцсетях</dt>
              <dd>
                {shop.socials.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 ? ', ' : ''}
                    <a href={s.href} rel="noopener noreferrer" target="_blank">
                      {s.label}
                    </a>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {shop.requisites ? (
            <div>
              <dt>Реквизиты</dt>
              <dd>{shop.requisites}</dd>
            </div>
          ) : null}
        </dl>
        <ShopMap latitude={shop.latitude} longitude={shop.longitude} address={shop.address} />
      </div>

      <section id="callback" className="form-section" aria-labelledby="callback-title">
        <h2 id="callback-title">Заказать звонок</h2>
        <p>Оставьте имя и телефон — перезвоним в рабочее время.</p>
        <CallbackForm />
      </section>
      <section id="contact-form" className="form-section" aria-labelledby="contact-form-title">
        <h2 id="contact-form-title">Написать нам</h2>
        <ContactForm />
      </section>
    </>
  );
}
