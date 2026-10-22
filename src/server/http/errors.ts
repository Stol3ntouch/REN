/**
 * Типизированные ошибки HTTP-слоя. Тексты — для пользователя, на русском;
 * стек и внутренние детали наружу не выходят (см. toErrorResponse).
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export type FieldErrors = Record<string, string[]>;

/** 400: данные не прошли проверку; fields — ошибки по полям формы. */
export class ValidationError extends AppError {
  constructor(
    message = 'Проверьте введённые данные',
    readonly fields: FieldErrors = {},
  ) {
    super(message, 400, 'validation');
  }
}

/** 401: нужен вход. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Требуется вход') {
    super(message, 401, 'unauthorized');
  }
}

/** 403: действие запрещено (нет права, чужой Origin). */
export class ForbiddenError extends AppError {
  constructor(message = 'Недостаточно прав') {
    super(message, 403, 'forbidden');
  }
}

/** 404: не найдено; также для чужих ресурсов, чтобы не раскрывать существование. */
export class NotFoundError extends AppError {
  constructor(message = 'Не найдено') {
    super(message, 404, 'not_found');
  }
}

/** 409: конфликт состояния (дубль, устаревшие данные). */
export class ConflictError extends AppError {
  constructor(message = 'Конфликт данных') {
    super(message, 409, 'conflict');
  }
}

/** 429: слишком много запросов. */
export class RateLimitError extends AppError {
  constructor(
    readonly retryAfterSec: number,
    message = 'Слишком много запросов. Попробуйте позже',
  ) {
    super(message, 429, 'rate_limited');
  }
}

/** Превращает любую ошибку в JSON-ответ. Неизвестные ошибки → 500 без деталей. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    const body: { error: { code: string; message: string; fields?: FieldErrors } } = {
      error: { code: err.code, message: err.message },
    };
    if (err instanceof ValidationError && Object.keys(err.fields).length > 0) body.error.fields = err.fields;
    const headers = new Headers({ 'cache-control': 'no-store' });
    if (err instanceof RateLimitError) headers.set('retry-after', String(err.retryAfterSec));
    return Response.json(body, { status: err.status, headers });
  }
  return Response.json(
    { error: { code: 'internal', message: 'Внутренняя ошибка. Попробуйте позже' } },
    { status: 500, headers: { 'cache-control': 'no-store' } },
  );
}
