export const DEFAULT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export type UploadResult = { ok: true; url: string; path?: string } | { ok: false; error: string };
export type UploadAction = (form: FormData) => Promise<UploadResult>;

const TYPE_NAMES: Record<string, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'image/x-icon': 'ICO', 'image/gif': 'GIF' };

export const typeNames = (types: readonly string[]): string => types.map((t) => TYPE_NAMES[t] ?? t).join(', ');

export const formatBytes = (n: number): string => (n >= 1024 * 1024 ? `${Math.round((n / (1024 * 1024)) * 10) / 10} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

/**
 * Клиентская проверка файла до отправки: тип из разрешённых, не пустой, не больше лимита.
 * Это только удобство: содержимое файла по-настоящему проверяет сервер (src/media), клиентской проверке не доверяют.
 */
export function validateFile(file: { name: string; size: number; type: string }, opts: { accept?: readonly string[]; maxBytes?: number } = {}): string | null {
  const accept = opts.accept ?? DEFAULT_IMAGE_TYPES;
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (file.size <= 0) return 'Файл пустой';
  if (!accept.includes(file.type)) return `Допустимые форматы: ${typeNames(accept)}`;
  if (file.size > max) return `Файл больше ${formatBytes(max)}`;
  return null;
}
