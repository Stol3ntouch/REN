import Link from 'next/link';
import type { SlideView } from './HomeSlider';
import { HomeSlider } from './HomeSlider';
import { ArrowRightIcon, GearIcon, LeafIcon, ScissorsIcon, WrenchIcon } from './home-icons';

/** Заголовок делится по двоеточию: «РемТехСад — профессиональный подход…:» крупно, продолжение — слоганом. */
function splitTitle(title: string): [string, string | null] {
  const i = title.indexOf(':');
  if (i < 0) return [title, null];
  return [title.slice(0, i + 1), title.slice(i + 1).trim() || null];
}

/**
 * Герой на всю ширину. Есть слайды (≤3) — слайдер с ними, а заголовок страницы h1 остаётся для скринридеров;
 * нет — оформленный CSS-баннер: зелёный градиент и декоративные значки техники, без фотографий.
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
        <div className="home-hero__art" aria-hidden="true">
          <GearIcon className="home-hero__ic home-hero__ic--gear" size={160} />
          <WrenchIcon className="home-hero__ic home-hero__ic--wrench" size={120} />
          <LeafIcon className="home-hero__ic home-hero__ic--leaf" size={110} />
          <ScissorsIcon className="home-hero__ic home-hero__ic--scissors" size={90} />
        </div>
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
