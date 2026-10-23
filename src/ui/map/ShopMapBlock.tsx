import { ShopMapCanvas } from './ShopMapCanvas';
import { routeUrl, viewUrl } from './route';

/**
 * Карта магазина. Рисуется только при заданных координатах (настройки latitude/longitude);
 * библиотека Leaflet подгружается лениво, когда блок попадает в окно просмотра. Всегда есть ссылка
 * «Построить маршрут» (OpenStreetMap). Без координат — «Адрес не указан» или, если адрес есть, пояснение.
 */
export function ShopMap({ latitude, longitude, address }: { latitude: number | null; longitude: number | null; address: string | null }) {
  if (latitude === null || longitude === null) {
    return (
      <div className="shop-map shop-map--empty" role="note">
        {address ? (
          <p>Координаты на карте не заданы. Адрес: {address}</p>
        ) : (
          <p>
            <strong>Адрес не указан</strong>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="shop-map">
      <ShopMapCanvas latitude={latitude} longitude={longitude} label={address ?? 'Магазин'} />
      <noscript>
        <a href={viewUrl(latitude, longitude)} rel="noopener noreferrer" target="_blank">
          Открыть карту
        </a>
      </noscript>
      <a className="button shop-map__route" href={routeUrl(latitude, longitude)} rel="noopener noreferrer" target="_blank">
        Построить маршрут
      </a>
    </div>
  );
}
