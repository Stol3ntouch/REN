'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'tiles-error';

/** Столько неудачных плиток подряд (без единой загруженной) — и карта считается недоступной. */
const TILE_ERROR_LIMIT = 3;

/**
 * Интерактивная карта OpenStreetMap с меткой. Leaflet подгружается динамически и только когда блок
 * приближается к экрану (IntersectionObserver), поэтому не утяжеляет начальную загрузку страницы.
 */
export function ShopMapCanvas({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const load = async () => {
      setStatus('loading');
      try {
        const L = (await import('leaflet')).default;
        if (cancelled) return;
        const map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView([latitude, longitude], 16);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; участники <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        // Плитки не грузятся (сеть, блокировка): остаётся метка и подпись с адресом
        let tilesLoaded = false;
        let tileErrors = 0;
        tiles.on('tileload', () => {
          tilesLoaded = true;
          setStatus('ready');
        });
        tiles.on('tileerror', () => {
          tileErrors += 1;
          if (!tilesLoaded && tileErrors >= TILE_ERROR_LIMIT) setStatus('tiles-error');
        });
        const pin = L.divIcon({ className: 'shop-map__pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });
        L.marker([latitude, longitude], { icon: pin, title: label, alt: label }).addTo(map);
        cleanup = () => map.remove();
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      void load();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            void load();
          }
        },
        { rootMargin: '200px' },
      );
      io.observe(el);
      cleanup = () => io.disconnect();
    }
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [latitude, longitude, label]);

  return (
    <div className="shop-map__frame">
      <div ref={host} className="shop-map__canvas" role="region" aria-label="Карта: расположение магазина" />
      {status === 'loading' ? <p className="shop-map__status">Карта загружается…</p> : null}
      {status === 'error' || status === 'tiles-error' ? (
        <p className="shop-map__status" role="alert">
          Не удалось загрузить карту. Адрес: {label}. Воспользуйтесь ссылкой «Построить маршрут».
        </p>
      ) : null}
    </div>
  );
}
