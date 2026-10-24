import { z } from 'zod';
import { ValidationError } from '@/server/http/errors';

/**
 * Публикация страниц и новостей: статус draft | published | scheduled.
 * В базе два поля: published (0/1) и published_at (unix-мс). Запланированная запись «появляется сама»: на сайте
 * её видно, когда published_at наступило (проверка при чтении, фоновых задач нет).
 */
export const PUBLICATION_STATUSES = ['draft', 'published', 'scheduled'] as const;
export const statusSchema = z.enum(PUBLICATION_STATUSES, { error: 'Неизвестный статус' }).optional();

export type PublicationState = { published: boolean; publishedAt: number | null };
export type PublicationInput = { status?: (typeof PUBLICATION_STATUSES)[number]; published?: boolean; publishedAt?: number | null };

/**
 * Итоговое состояние публикации.
 *  - Есть status: draft — снять с публикации (дата сохраняется); published — опубликовать сейчас или с прошлой даты
 *    (будущая дата не принимается как «опубликована»); scheduled — нужна будущая дата.
 *  - Нет status (прежние вызовы): published/publishedAt как раньше; опубликованной без даты ставится текущее время.
 */
export function resolvePublication(input: PublicationInput, existing: PublicationState | null, now: number): PublicationState {
  const kept = existing?.publishedAt ?? null;
  if (input.status === undefined) {
    const published = input.published ?? existing?.published ?? false;
    const publishedAt = input.publishedAt ?? kept ?? (published ? now : null);
    return { published, publishedAt };
  }
  if (input.status === 'draft') return { published: false, publishedAt: input.publishedAt ?? kept };
  if (input.status === 'scheduled') {
    if (input.publishedAt == null || input.publishedAt <= now) {
      throw new ValidationError('Для отложенной публикации укажите дату и время в будущем', { publishedAt: ['Укажите дату в будущем'] });
    }
    return { published: true, publishedAt: input.publishedAt };
  }
  const given = input.publishedAt != null && input.publishedAt <= now ? input.publishedAt : null;
  const previous = kept !== null && kept <= now ? kept : null;
  return { published: true, publishedAt: given ?? previous ?? now };
}

/** Канонический адрес: путь на сайте или http(s)-адрес. */
export const canonicalSchema = z
  .string()
  .trim()
  .max(300, 'Не длиннее 300 символов')
  .refine((v) => v === '' || (v.startsWith('/') && !v.startsWith('//') && !/\s/.test(v)) || /^https?:\/\/\S+$/i.test(v), 'Канонический адрес — путь на сайте (/pages/…) или https://…')
  .optional();
