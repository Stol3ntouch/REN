'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './forms.css';

type Props = { reviewsLabel: string; questionLabel: string; reviews: ReactNode; question: ReactNode };

/** Вкладки «Отзывы» и «Вопрос»: роли tablist/tab/tabpanel, стрелки, Home/End. Обе панели есть в HTML (работает и до гидратации). */
export function FeedbackTabs({ reviewsLabel, questionLabel, reviews, question }: Props) {
  const uid = useId();
  const [active, setActive] = useState<'reviews' | 'question'>('reviews');
  const refs = { reviews: useRef<HTMLButtonElement>(null), question: useRef<HTMLButtonElement>(null) };
  const tabs = [
    { key: 'reviews' as const, label: reviewsLabel, panel: reviews },
    { key: 'question' as const, label: questionLabel, panel: question },
  ];

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const order = ['reviews', 'question'] as const;
    const i = order.indexOf(active);
    let next: (typeof order)[number] | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(i + 1) % order.length]!;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(i + order.length - 1) % order.length]!;
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1]!;
    if (next) {
      e.preventDefault();
      setActive(next);
      refs[next].current?.focus();
    }
  }

  return (
    <div className="feedback-tabs">
      <div role="tablist" aria-label="Отзывы и вопросы о товаре">
        {tabs.map((t) => (
          <button
            key={t.key}
            ref={refs[t.key]}
            id={`${uid}-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            aria-controls={`${uid}-panel-${t.key}`}
            tabIndex={active === t.key ? 0 : -1}
            onClick={() => setActive(t.key)}
            onKeyDown={onKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} id={`${uid}-panel-${t.key}`} role="tabpanel" aria-labelledby={`${uid}-tab-${t.key}`} hidden={active !== t.key} tabIndex={0}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
