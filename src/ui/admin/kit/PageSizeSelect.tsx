'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useId } from 'react';
import { PAGE_SIZES, nextSearchHref } from './url';

/** «Показывать: 20» — меняет pageSize в адресе и возвращает на первую страницу. */
export function PageSizeSelect({ pageSize, sizes = PAGE_SIZES }: { pageSize: number; sizes?: readonly number[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const id = useId();
  return (
    <div className="ak-pager__size">
      <label htmlFor={id}>Показывать:</label>
      <select id={id} value={pageSize} onChange={(e) => router.replace(nextSearchHref(pathname, window.location.search, 'pageSize', e.target.value), { scroll: false })}>
        {sizes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
