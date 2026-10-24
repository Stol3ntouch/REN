import Link from 'next/link';
import type { BannerView } from '@/domain/content/queries';
import './home.css';

/** Адрес из админки: относительный путь — внутренняя ссылка, http(s) — внешняя. Прочее (проверено при сохранении) не выводится. */
function BannerLink({ url, className, children, label }: { url: string; className?: string; children: React.ReactNode; label?: string }) {
  if (url.startsWith('/') && !url.startsWith('//')) {
    return (
      <Link className={className} href={url} aria-label={label}>
        {children}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(url)) {
    return (
      <a className={className} href={url} rel="noopener noreferrer" aria-label={label}>
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

/**
 * Баннеры позиции (главная — средняя полоса, страница категории — C06). Тексты и alt — ровно те, что ввёл администратор:
 * выводятся как обычный текст (React экранирует), рекламных утверждений от себя блок не добавляет.
 * Нет баннеров — ничего не рисуется.
 */
export function BannerBlock({ banners, label = 'Предложения' }: { banners: BannerView[]; label?: string }) {
  if (banners.length === 0) return null;
  return (
    <section className="banner-block" aria-label={label}>
      <ul className="banner-block__list">
        {banners.map((b) => {
          const heading = b.heading || b.title;
          const body = (
            <>
              {b.image ? (
                <picture>
                  {b.mobileImage ? <source media="(max-width: 640px)" srcSet={b.mobileImage.src} /> : null}
                  <img className="banner-block__image" src={b.image.src} alt={b.image.alt} width={b.image.width ?? 1200} height={b.image.height ?? 400} loading="lazy" decoding="async" />
                </picture>
              ) : null}
              <span className="banner-block__text">
                <span className="banner-block__heading">{heading}</span>
                {b.subheading ? <span className="banner-block__sub">{b.subheading}</span> : null}
                {b.buttonText ? <span className="button">{b.buttonText}</span> : null}
              </span>
            </>
          );
          return (
            <li key={b.id} className="banner-block__item">
              {b.url ? (
                <BannerLink url={b.url} className="banner-block__link">
                  {body}
                </BannerLink>
              ) : (
                <div className="banner-block__link">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
