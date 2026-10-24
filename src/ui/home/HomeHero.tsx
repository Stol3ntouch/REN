import Link from 'next/link';
import type { SlideView } from './HomeSlider';
import { HomeSlider } from './HomeSlider';
import { ArrowRightIcon } from './home-icons';

/** Заголовок делится по двоеточию: «РемТехСад — профессиональный подход…:» крупно, продолжение — слоганом. */
function splitTitle(title: string): [string, string | null] {
  const i = title.indexOf(':');
  if (i < 0) return [title, null];
  return [title.slice(0, i + 1), title.slice(i + 1).trim() || null];
}

/**
 * Герой на всю ширину. Есть слайды (≤3) — слайдер с ними, а заголовок страницы h1 остаётся для скринридеров;
 * нет — баннер с фоновой иллюстрацией сада (public/brand/hero-garden.svg, оригинальный рисунок, без фотографий)
 * и затемнением под текстом, чтобы слоган читался.
 */
export function HomeHero({ title, slides }: { title: string; slides: SlideView[] }) {
  if (slides.length > 0) {
    return (
      <div className="home-hero home-hero--slides">
        <h1 className="visually-hidden">{title}</h1>
        <HomeSlider slides={slides} />
      </div>
    );
  }
  const [head, tail] = splitTitle(title);
  return (
    <div className="home-hero">
      <section className="home-hero__banner" aria-label="О магазине">
        <div className="home-hero__text">
          <h1 className="home-hero__title">
            {head}
            {tail ? <span className="home-hero__slogan"> {tail}</span> : null}
          </h1>
          <Link className="button button--light home-hero__cta" href="/catalog">
            Перейти в каталог
            <ArrowRightIcon size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}
