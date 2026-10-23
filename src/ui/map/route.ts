/** Внешние ссылки OpenStreetMap для точки магазина. Координаты — десятичные градусы. */
export function routeUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

export function viewUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}
