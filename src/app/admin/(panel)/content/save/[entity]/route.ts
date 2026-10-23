import { createContentSaveHandler } from '@/domain/content/save-handler';

/**
 * POST /admin/content/save/<раздел> — сохранение и удаление записей «Контент и услуги» (multipart/form-data).
 * Только администратор (content.write): Origin → сессия (401) → право (403) проверяет обработчик, право проверяют и сами операции.
 */
export const dynamic = 'force-dynamic';
export const POST = createContentSaveHandler();
