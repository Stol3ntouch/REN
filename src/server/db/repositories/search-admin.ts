import type { Db } from '../connection';
import { ensureFold, foldText, likeContains } from '../fold';

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_PER_TYPE = 5;

export type ProductHit = { id: number; name: string; sku: string | null; barcode: string | null; published: boolean };
export type CategoryHit = { id: number; name: string };
export type OrderHit = { number: string; contactName: string; status: string; totalKopecks: number };
export type CustomerHit = { id: number; email: string; name: string | null };
export type InquiryHit = { id: number; number: string | null; kind: string; name: string; status: string };

/**
 * Безопасный запрос FTS5: из текста берутся только слова (буквы и цифры), каждое в кавычках с префиксом.
 * Операторы AND/OR/NOT, скобки, двоеточия, звёздочки и кавычки пользователя не доходят до MATCH.
 */
export function ftsQuery(q: string): string | null {
  const tokens = foldText(q).match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return null;
  return tokens.slice(0, 6).map((t) => `"${t}"*`).join(' ');
}

export const searchAdminRepo = {
  products(db: Db, q: string, limit: number): ProductHit[] {
    const fts = ftsQuery(q);
    const code = q.trim();
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.barcode, p.published FROM products p
          WHERE p.id IN (${fts ? 'SELECT rowid FROM product_search WHERE product_search MATCH ?1 UNION ' : ''}SELECT id FROM products WHERE barcode = ?2)
          ORDER BY p.published DESC, p.name LIMIT ?3`,
      )
      .all(...(fts ? [fts] : ['']), code, limit) as { id: number; name: string; sku: string | null; barcode: string | null; published: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, barcode: r.barcode, published: r.published === 1 }));
  },

  categories(db: Db, q: string, limit: number): CategoryHit[] {
    ensureFold(db);
    return db.prepare("SELECT id, name FROM categories WHERE rts_fold(name) LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?").all(likeContains(q.trim()), limit) as CategoryHit[];
  },

  /** Заказы: номер, email — по вхождению; телефон — по цифрам (от 4 цифр). */
  orders(db: Db, q: string, limit: number): OrderHit[] {
    ensureFold(db);
    const text = q.trim();
    const digits = text.replace(/\D/g, '');
    const parts = ["UPPER(number) LIKE ? ESCAPE '\\'", "rts_fold(contact_email) LIKE ? ESCAPE '\\'"];
    const args: (string | number)[] = [likeContains(text).toUpperCase(), likeContains(text)];
    if (digits.length >= 4) {
      parts.push('phone_digits LIKE ?');
      args.push(`%${digits}%`);
    }
    const rows = db
      .prepare(`SELECT number, contact_name, status, total_kopecks FROM orders WHERE ${parts.join(' OR ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...args, limit) as { number: string; contact_name: string; status: string; total_kopecks: number }[];
    return rows.map((r) => ({ number: r.number, contactName: r.contact_name, status: r.status, totalKopecks: Number(r.total_kopecks) }));
  },

  customers(db: Db, q: string, limit: number): CustomerHit[] {
    ensureFold(db);
    const text = q.trim();
    const digits = text.replace(/\D/g, '');
    const like = likeContains(text);
    const parts = ["rts_fold(u.email) LIKE ? ESCAPE '\\'", "rts_fold(COALESCE(p.name, '')) LIKE ? ESCAPE '\\'"];
    const args: (string | number)[] = [like, like];
    if (digits.length >= 4) {
      parts.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ?");
      args.push(`%${digits}%`);
    }
    return db
      .prepare(`SELECT u.id, u.email, p.name FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE ${parts.join(' OR ')} ORDER BY u.created_at DESC LIMIT ?`)
      .all(...args, limit) as CustomerHit[];
  },

  /** Обращения: всё, кроме ремонта (его ищут по праву repair.write отдельно). */
  inquiries(db: Db, q: string, limit: number): InquiryHit[] {
    ensureFold(db);
    const text = q.trim();
    const digits = text.replace(/\D/g, '');
    const like = likeContains(text);
    const parts = ["rts_fold(COALESCE(number, '')) LIKE ? ESCAPE '\\'", "rts_fold(name) LIKE ? ESCAPE '\\'", "rts_fold(COALESCE(email, '')) LIKE ? ESCAPE '\\'"];
    const args: (string | number)[] = [like, like, like];
    if (digits.length >= 4) {
      parts.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE ?");
      args.push(`%${digits}%`);
    }
    return db
      .prepare(`SELECT id, number, kind, name, status FROM requests WHERE kind <> 'repair' AND (${parts.join(' OR ')}) ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...args, limit) as InquiryHit[];
  },
};
