import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { previewOps } from '@/domain/content/ops-pages';
import { imageView } from '@/domain/content/images';
import { getDb } from '@/server/db/connection';
import { newsRepo } from '@/server/db/repositories/news';
import { pagesRepo } from '@/server/db/repositories/pages';
import { requireStaffPage } from '@/ui/admin/guard';
import { ContentPageView } from '@/ui/home/ContentPageView';
import { RichText } from '@/ui/home/RichText';
import { SiteShell } from '@/ui/layout/SiteShell';
import { getShellContext } from '@/ui/shell-context';
import '@/ui/home/home.css';

export const metadata: Metadata = { title: 'Предпросмотр', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Предпросмотр черновика по одноразовой ссылке. Видит только вошедший сотрудник с правом content.write
 * (requireStaffPage); ссылка гасится при первом открытии, живёт 30 минут. Для всех остальных — 404.
 */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const session = await requireStaffPage('content.write');
  const { token } = await params;
  const target = previewOps.consume(session, token);
  if (!target) notFound();
  const db = getDb();
  const shell = await getShellContext();
  const banner = (
    <p className="legal-draft" role="note">
      ПРЕДПРОСМОТР — страница видна только вам
    </p>
  );
  if (target.entity === 'pages') {
    const page = pagesRepo.get(db, target.entityId);
    if (!page) notFound();
    return (
      <SiteShell shell={shell}>
        {banner}
        <ContentPageView page={page} />
      </SiteShell>
    );
  }
  const item = newsRepo.get(db, target.entityId);
  if (!item) notFound();
  const image = imageView(item, 'large', item.title);
  return (
    <SiteShell shell={shell}>
      {banner}
      <article className="content-article">
        <h1>{item.h1 || item.title}</h1>
        {image ? (
          <figure className="content-figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- предпросмотр загруженного файла */}
            <img src={image.src} alt={image.alt} width={image.width} height={image.height} />
          </figure>
        ) : null}
        <RichText text={item.body} />
      </article>
    </SiteShell>
  );
}

