import Link from 'next/link';
import { ArrowUpIcon, MailIcon, PhoneIcon, PinIcon } from '../home/home-icons';
import { Placeholder } from '../placeholder';
import { DEFAULT_SHELL, type ShellContext, type ShellLink } from '../shell-context';

const DEFAULT_BUYER_LINKS: ShellLink[] = [
  { href: '/buyers', label: 'Покупателям' },
  { href: '/contacts', label: 'Контакты' },
];

function LinkList({ title, links }: { title: string; links: readonly ShellLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={title}>
      <p className="site-footer__title">{title}</p>
      <ul className="site-footer__list">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href}>{l.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Тёмный подвал в четыре колонки: Каталог, Покупателям, О компании, Контакты (соцсети — только заданные) + реквизиты. */
export function SiteFooter({ shell = DEFAULT_SHELL }: { shell?: ShellContext }) {
  const year = new Date().getFullYear();
  const catalog: ShellLink[] = shell.catalogLinks && shell.catalogLinks.length > 0 ? shell.catalogLinks : [{ href: '/catalog', label: 'Каталог товаров' }];
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          {shell.logoUrl ? (
            <Link className="site-footer__logo" href="/" aria-label={`${shell.siteName} — на главную`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- логотип загружается в админке */}
              <img src={shell.logoDarkUrl ?? shell.logoUrl} alt={shell.siteName} height={40} loading="lazy" />
            </Link>
          ) : (
            <p className="site-footer__name">{shell.siteName}</p>
          )}
          <p className="site-footer__copy">
            © {year} {shell.siteName}. Все права защищены.
          </p>
          <p className="site-footer__requisites">{shell.requisites ?? <Placeholder label="РЕКВИЗИТЫ" />}</p>
        </div>
        <LinkList title="Каталог" links={catalog} />
        <LinkList title="Покупателям" links={shell.buyerLinks && shell.buyerLinks.length > 0 ? shell.buyerLinks : DEFAULT_BUYER_LINKS} />
        <LinkList title="О компании" links={shell.companyLinks ?? []} />
        <div>
          <p className="site-footer__title">Контакты</p>
          <ul className="site-footer__contacts">
            <li>
              <PhoneIcon size={18} />
              {shell.phone ? <a href={shell.phoneHref ?? `tel:${shell.phone.replace(/[^\d+]/g, '')}`}>{shell.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}
            </li>
            <li>
              <PinIcon size={18} />
              {shell.address ?? <Placeholder label="АДРЕС" />}
            </li>
            {shell.email ? (
              <li>
                <MailIcon size={18} />
                <a href={`mailto:${shell.email}`}>{shell.email}</a>
              </li>
            ) : null}
          </ul>
          {shell.socials && shell.socials.length > 0 ? (
            <ul className="site-footer__socials" aria-label="Мы в соцсетях">
              {shell.socials.map((s) => (
                <li key={s.href}>
                  <a href={s.href} rel="noopener noreferrer" target="_blank">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <a className="to-top" href="#top" aria-label="Наверх">
        <ArrowUpIcon size={22} />
      </a>
    </footer>
  );
}
