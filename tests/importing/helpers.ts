/** Сборка маленьких YML-файлов для тестов. */
export type TestOffer = {
  id: string;
  name?: string;
  model?: string;
  categoryId?: string;
  price?: string;
  url?: string;
  available?: string;
  description?: string;
  pictures?: string[];
  params?: [string, string][];
};

export function offerXml(o: TestOffer): string {
  const tag = (name: string, v: string | undefined) => (v === undefined ? '' : `<${name}>${v}</${name}>`);
  return `<offer id="${o.id}" available="${o.available ?? 'true'}">
${tag('name', 'name' in o ? o.name : `Товар ${o.id}`)}
${tag('model', 'model' in o ? o.model : `M-${o.id}`)}
${tag('categoryId', 'categoryId' in o ? o.categoryId : '10')}
${tag('price', 'price' in o ? o.price : '1000.00000000')}
${tag('url', 'url' in o ? o.url : `https://champion.ru/catalog/x/tovar-${o.id}/`)}
${o.description === undefined ? '' : `<item_description><![CDATA[${o.description}]]></item_description>`}
${(o.pictures ?? []).map((p) => `<picture>${p}</picture>`).join('\n')}
${(o.params ?? []).map(([n, v]) => `<param name="${n}">${v}</param>`).join('\n')}
</offer>`;
}

export function ymlXml(opts: { categories?: string[]; offers?: (TestOffer | string)[] } = {}): string {
  const cats = opts.categories ?? [`<category id="10">Генераторы</category>`, `<category id="11" parentId="10">Бензиновые генераторы</category>`];
  const offers = (opts.offers ?? []).map((o) => (typeof o === 'string' ? o : offerXml(o)));
  return `<?xml version="1.0" encoding="UTF-8"?><yml_catalog date="2026-10-19 17:47"><shop><name>t</name><categories>${cats.join('')}</categories><offers>${offers.join('')}</offers></shop></yml_catalog>`;
}
