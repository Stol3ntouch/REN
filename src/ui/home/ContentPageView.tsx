import type { PageRow } from '@/server/db/repositories/pages';
import './home.css';
import { RichText } from './RichText';

export const LEGAL_DRAFT_LABEL = 'ЧЕРНОВИК — проверить юристом';

/** Метка на правовых черновиках. Видима на странице; снимается админом в настройках страницы. */
export function LegalDraftBadge() {
  return (
    <p className="legal-draft" role="note">
      {LEGAL_DRAFT_LABEL}
    </p>
  );
}

/** Редактируемая страница: H1, метка-черновик (если включена), текст. Соответствие закону не заявляется. */
export function ContentPageView({ page }: { page: Pick<PageRow, 'title' | 'h1' | 'body' | 'legalDraft'> }) {
  return (
    <article className="content-page">
      <h1>{page.h1 || page.title}</h1>
      {page.legalDraft ? <LegalDraftBadge /> : null}
      <RichText text={page.body} />
    </article>
  );
}
