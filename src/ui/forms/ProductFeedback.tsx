import { pluralize } from '@/domain/catalog/format';
import { getProductRating, listPublishedReviews } from '@/domain/requests/public';
import { EmptyState } from '@/ui/states';
import { FeedbackTabs } from './FeedbackTabs';
import { QuestionForm, ReviewForm } from './forms';
import './forms.css';

const DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' });
const REVIEW_FORMS = ['отзыв', 'отзыва', 'отзывов'] as const;
const avgText = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Краткий рейтинг рядом с названием: выводится только при наличии опубликованных отзывов. */
export function RatingBadge({ productId }: { productId: number }) {
  const { average, count } = getProductRating(productId);
  if (average === null || count === 0) return null;
  return (
    <p className="rating-summary">
      <a href="#feedback">
        Рейтинг {avgText(average)} из 5 · {count} {pluralize(count, REVIEW_FORMS)}
      </a>
    </p>
  );
}

/** Секция с вкладками «Отзывы» (только опубликованные + форма) и «Вопрос» (форма менеджеру). */
export function ProductFeedback({ productId }: { productId: number }) {
  const { average, count } = getProductRating(productId);
  const reviews = listPublishedReviews(productId);
  return (
    <section className="product-section" id="feedback" aria-labelledby="feedback-title">
      <h2 id="feedback-title">Отзывы и вопросы</h2>
      <FeedbackTabs
        reviewsLabel={count > 0 ? `Отзывы (${count})` : 'Отзывы'}
        questionLabel="Вопрос"
        reviews={
          <>
            {average !== null ? (
              <p className="rating-summary">
                Средняя оценка: {avgText(average)} из 5 ({count} {pluralize(count, REVIEW_FORMS)})
              </p>
            ) : null}
            {reviews.length === 0 ? (
              <EmptyState title="Отзывов пока нет">
                <p>Станьте первым — отзыв появится после проверки модератором.</p>
              </EmptyState>
            ) : (
              <ul className="review-list">
                {reviews.map((r) => (
                  <li key={r.id} className="review-list__item">
                    <div className="review-list__head">
                      <span>{r.authorName}</span>
                      <span>Оценка: {r.rating} из 5</span>
                      <time dateTime={new Date(r.createdAt).toISOString()}>{DATE.format(new Date(r.createdAt))}</time>
                    </div>
                    <p>{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <h3>Оставить отзыв</h3>
            <ReviewForm productId={productId} />
          </>
        }
        question={
          <>
            <p>Не нашли ответ в описании? Задайте вопрос — мы передадим его менеджеру.</p>
            <QuestionForm productId={productId} />
          </>
        }
      />
    </section>
  );
}
