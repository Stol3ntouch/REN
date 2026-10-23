import Link from 'next/link';
import { MAIN_NAV } from '../nav';
import { Placeholder } from '../placeholder';
import { DEFAULT_SHELL, type ShellContext, type ShellLink } from '../shell-context';

const DEFAULT_BUYER_LINKS: ShellLink[] = [
  { href: '/buyers', label: 'Покупателям' },
  { href: '/privacy', label: 'Политика обработки персональных данных' },
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

/** Подвал: копирайт, меню, контакты, соцссылки (только заданные), реквизиты. */
export function SiteFooter({ shell = DEFAULT_SHELL }: { shell?: ShellContext }) {
  const year = new Date().getFullYear();
  const nav = shell.nav ?? MAIN_NAV;
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <p className="site-footer__name">{shell.siteName}</p>
          <p className="site-footer__copy">© {year} {shell.siteName}</p>
          <p>{shell.requisites ?? <Placeholder label="РЕКВИЗИТЫ" />}</p>
        </div>
        <LinkList title="Разделы сайта" links={nav} />
        <LinkList title="Покупателям" links={shell.buyerLinks && shell.buyerLinks.length > 0 ? shell.buyerLinks : DEFAULT_BUYER_LINKS} />
        <LinkList title="О компании" links={shell.companyLinks ?? []} />
        <div>
          <p className="site-footer__title">Контакты</p>
          <p>{shell.phone ? <a href={shell.phoneHref ?? `tel:${shell.phone.replace(/[^\d+]/g, '')}`}>{shell.phone}</a> : <Placeholder label="ТЕЛЕФОН" />}</p>
          <p>{shell.hours ?? <Placeholder label="ЧАСЫ РАБОТЫ" />}</p>
          <p>{shell.address ?? <Placeholder label="АДРЕС" />}</p>
          {shell.email ? (
            <p>
              <a href={`mailto:${shell.email}`}>{shell.email}</a>
            </p>
          ) : null}
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
    </footer>
  );
}
