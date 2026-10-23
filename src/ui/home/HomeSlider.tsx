'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { CatalogImage } from '@/domain/catalog/types';

export type SlideView = {
  id: number;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  image: CatalogImage | null;
};

/**
 * Слайдер главной (до трёх слайдов). Прокрутка с привязкой (scroll-snap): работает без JS, листается
 * пальцем, стрелками клавиатуры (список фокусируем) и кнопками. Автопрокрутки нет — это безопаснее
 * для доступности и prefers-reduced-motion. С одним слайдом кнопок нет.
 */
export function HomeSlider({ slides }: { slides: SlideView[] }) {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = (i + slides.length) % slides.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setIndex(next);
  };
  const onScroll = () => {
    const el = track.current;
    if (el && el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <section className="home-slider" aria-roledescription="карусель" aria-label="Главные предложения">
      <ul className="home-slider__track" ref={track} onScroll={onScroll} tabIndex={0}>
        {slides.map((s, i) => (
          <li key={s.id} className="home-slider__slide" aria-roledescription="слайд" aria-label={`${i + 1} из ${slides.length}`}>
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- локальный WebP из каталога загрузок
              <img className="home-slider__image" src={s.image.src} alt={s.image.alt} width={s.image.width ?? 960} height={s.image.height ?? 400} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
            ) : null}
            <div className="home-slider__text">
              <p className="home-slider__title">{s.title}</p>
              {s.subtitle ? <p className="home-slider__subtitle">{s.subtitle}</p> : null}
              {s.linkUrl ? (
                s.linkUrl.startsWith('/') ? (
                  <Link className="button" href={s.linkUrl}>
                    {s.linkLabel || 'Подробнее'}
                  </Link>
                ) : (
                  <a className="button" href={s.linkUrl} rel="noopener noreferrer">
                    {s.linkLabel || 'Подробнее'}
                  </a>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {slides.length > 1 ? (
        <>
          <button type="button" className="home-slider__arrow home-slider__arrow--prev" onClick={() => go(index - 1)} aria-label="Предыдущий слайд">
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="home-slider__arrow home-slider__arrow--next" onClick={() => go(index + 1)} aria-label="Следующий слайд">
            <span aria-hidden="true">›</span>
          </button>
          <div className="home-slider__dots">
            {slides.map((s, i) => (
              <button key={s.id} type="button" onClick={() => go(i)} aria-label={`Слайд ${i + 1}`} aria-current={i === index ? 'true' : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
