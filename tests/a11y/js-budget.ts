/**
 * Бюджет JS публичных страниц (R47.1): сумма gzip-размера скриптов, подключённых в HTML страницы (без лениво подгружаемой карты).
 * Запуск: BASE_URL=http://localhost:4000 npm run a11y:live  (сервер — production-сборка, `next start`). Порог — 200 КБ gzip.
 */
import { gzipSync } from 'node:zlib';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const LIMIT = 200 * 1024;
const H = { 'x-forwarded-proto': 'https' };

async function main(): Promise<number> {
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`, { headers: H })).text();
  const firstPath = (re: RegExp) => [...sitemap.matchAll(re)][0]?.[1];
  const pages = ['/', '/catalog', firstPath(/<loc>[^<]*?(\/catalog\/[^<]+)<\/loc>/g), firstPath(/<loc>[^<]*?(\/product\/[^<]+)<\/loc>/g), '/cart', '/checkout', '/contacts', '/search?q=test'].filter(Boolean) as string[];
  let worst = 0;
  let failed = false;
  const cache = new Map<string, number>();
  for (const page of pages) {
    const html = await (await fetch(`${BASE}${page}`, { headers: H })).text();
    const srcs = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js[^"]*)"/g)].map((m) => (m[1] as string).replace(/&amp;/g, '&')))];
    const sizes: { src: string; gz: number }[] = [];
    for (const src of srcs) {
      if (!cache.has(src)) cache.set(src, gzipSync(Buffer.from(await (await fetch(new URL(src, BASE), { headers: H })).arrayBuffer())).length);
      sizes.push({ src, gz: cache.get(src) as number });
    }
    const total = sizes.reduce((a, s) => a + s.gz, 0);
    worst = Math.max(worst, total);
    const ok = total <= LIMIT;
    if (!ok) failed = true;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${page.slice(0, 50).padEnd(50)} ${(total / 1024).toFixed(1)} КБ gzip, скриптов: ${sizes.length}`);
    if (page === pages[0] || !ok) for (const s of sizes.sort((a, b) => b.gz - a.gz).slice(0, 4)) console.log(`       ${(s.gz / 1024).toFixed(1)} КБ  ${s.src.split('/').pop()}`);
  }
  console.log(`\nМаксимум: ${(worst / 1024).toFixed(1)} КБ gzip из ${LIMIT / 1024} КБ`);
  return failed ? 1 : 0;
}

main().then(
  (c) => {
    process.exitCode = c;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
