import { MAIN_NAV } from '../nav';
import { Placeholder } from '../placeholder';
import { DEFAULT_SHELL, type ShellContext } from '../shell-context';

export function SiteFooter({ shell = DEFAULT_SHELL }: { shell?: ShellContext }) {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <p className="site-footer__name">{shell.siteName}</p>
          <p>{shell.address ?? <Placeholder label="АДРЕС" />}</p>
          <p>{shell.phone ?? <Placeholder label="ТЕЛЕФОН" />}</p>
          <p>
            <Placeholder label="ЧАСЫ РАБОТЫ" />
          </p>
        </div>
        <nav aria-label="Разделы сайта">
          <ul className="site-footer__list">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p>
            <a href="/privacy">Политика обработки персональных данных</a>
          </p>
          <p>
            <Placeholder label="РЕКВИЗИТЫ" />
          </p>
        </div>
      </div>
    </footer>
  );
}
