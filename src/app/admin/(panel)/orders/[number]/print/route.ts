import { withStaffPermission } from '@/domain/admin/guard';
import { orderOps } from '@/domain/ordering/admin-ops';
import { STATUS_LABELS } from '@/domain/ordering/status';
import { formatRub } from '@/domain/pricing/format';
import { NotFoundError, toErrorResponse } from '@/server/http/errors';

export const dynamic = 'force-dynamic';

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fmt = (ms: number) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(ms));

/**
 * GET /admin/orders/<номер>/print — страница заказа для печати (или «Сохранить как PDF» в браузере): отдельный HTML-документ
 * без каркаса админки. Право orders.read (Origin, сессия — в обёртке). Реквизиты магазина — из настроек, иначе видимые метки.
 * Внутренние комментарии и история в документ не попадают.
 */
export function GET(req: Request, ctx: { params: Promise<{ number: string }> }): Promise<Response> {
  return withStaffPermission('orders.read', async (_req, session) => {
    try {
      const { number } = await ctx.params;
      const doc = orderOps.printData(session, decodeURIComponent(number));
      if (!doc) throw new NotFoundError('Заказ не найден');
      const { order: o, shop } = doc;
      const rows = o.items
        .map(
          (i) =>
            `<tr><td>${esc(i.name)}</td><td>${esc(i.sku ?? '—')}</td><td class="n">${esc(formatRub(i.unitKopecks))}</td><td class="n">${i.qty}</td><td class="n">${esc(formatRub(i.lineKopecks))}</td></tr>`,
        )
        .join('');
      const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Заказ ${esc(o.number)}</title>
<style>
body{font:14px/1.45 system-ui,Arial,sans-serif;color:#111;margin:24px auto;max-width:800px;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:6px 8px;text-align:left;vertical-align:top}
.n{text-align:right;white-space:nowrap}.muted{color:#444}.totals{margin-top:12px;text-align:right}
@media print{body{margin:0}}
</style></head><body>
<header><strong>${esc(shop.name)}</strong><div class="muted">${esc(shop.address)} · ${esc(shop.phone)}</div><div class="muted">${esc(shop.requisites)}</div></header>
<h1>Заказ ${esc(o.number)}</h1>
<p class="muted">от ${esc(fmt(o.createdAt))} · статус: ${esc(STATUS_LABELS[o.status])}${o.isPaid ? ' · оплачен' : ''}</p>
<h2>Покупатель</h2>
<p>${esc(o.contact.name)}<br>${esc(o.contact.phone)} · ${esc(o.contact.email)}</p>
<p>Получение: ${esc(o.delivery.name)}${o.contact.address ? ` — ${esc(o.contact.address)}` : ''}<br>Оплата: ${esc(o.payment.name)}</p>
${o.contact.comment ? `<p>Комментарий покупателя: ${esc(o.contact.comment)}</p>` : ''}
<h2>Состав</h2>
<table><thead><tr><th>Товар</th><th>Артикул</th><th class="n">Цена</th><th class="n">Кол-во</th><th class="n">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">Товары: ${esc(formatRub(o.subtotalKopecks))}<br>Скидка${o.promoCode ? ` (купон ${esc(o.promoCode)})` : ''}: ${o.discountKopecks > 0 ? `−${esc(formatRub(o.discountKopecks))}` : '0'}<br>Доставка: ${o.delivery.pending ? 'рассчитает менеджер' : esc(formatRub(o.deliveryKopecks))}<br><strong>Итого: ${esc(formatRub(o.totalKopecks))}</strong></div>
<p class="muted">Для печати нажмите Ctrl+P (или «Сохранить как PDF» в диалоге печати).</p>
</body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    } catch (e) {
      return toErrorResponse(e);
    }
  })(req);
}
