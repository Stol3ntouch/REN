import type { Metadata } from 'next';
import Link from 'next/link';
import { ENTITY_KEYS, ENTITY_LABELS } from '@/domain/content/fields';
import { requireStaffPage } from '@/ui/admin/guard';
import '@/ui/cart/admin-orders.css';
import './content-admin.css';

export const metadata: Metadata = { title: 'Контент и услуги' };

/** Раздел только для администратора (право content.write): менеджер уходит на обзор. */
export default async function ContentIndexPage() {
  await requireStaffPage('content.write');
  return (
    <>
      <h1>Контент и услуги</h1>
      <ul className="admin-cards">
        {ENTITY_KEYS.map((k) => (
          <li key={k} className="admin-card">
            <Link href={`/admin/content/${k}`}>{ENTITY_LABELS[k].title}</Link>
            <p className="adm-hint">{ENTITY_LABELS[k].hint}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
