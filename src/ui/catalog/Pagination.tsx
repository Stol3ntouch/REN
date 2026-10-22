import Link from 'next/link';

function pageList(current: number, last: number): (number | '…')[] {
  const set = new Set([1, last, current - 1, current, current + 1].filter((n) => n >= 1 && n <= last));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Ссылки на страницы: работают без JS (?page=N). hrefFor(page) строит адрес с текущими фильтрами. */
export function Pagination({ current, total, pageSize, hrefFor }: { current: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <nav className="pagination" aria-label="Страницы каталога">
      <ul>
        {current > 1 ? (
          <li>
            <Link href={hrefFor(current - 1)} rel="prev">
              <span aria-hidden="true">←</span> Назад
            </Link>
          </li>
        ) : null}
        {pageList(current, last).map((p, i) =>
          p === '…' ? (
            <li key={`gap-${i}`} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p}>
              <Link href={hrefFor(p)} aria-current={p === current ? 'page' : undefined} aria-label={`Страница ${p}`} className={p === current ? 'is-current' : undefined}>
                {p}
              </Link>
            </li>
          ),
        )}
        {current < last ? (
          <li>
            <Link href={hrefFor(current + 1)} rel="next">
              Вперёд <span aria-hidden="true">→</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
