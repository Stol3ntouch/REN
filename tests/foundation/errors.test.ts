import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, RateLimitError, ValidationError, toErrorResponse } from '@/server/http/errors';

describe('toErrorResponse', () => {
  it('переводит типизированные ошибки в статус и JSON с кодом', async () => {
    const forbidden = toErrorResponse(new ForbiddenError());
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('forbidden');

    expect(toErrorResponse(new NotFoundError()).status).toBe(404);
    expect(toErrorResponse(new ValidationError('Проверьте поля', { phone: ['Укажите телефон'] })).status).toBe(400);
  });

  it('для 429 ставит Retry-After', () => {
    const res = toErrorResponse(new RateLimitError(42));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  it('передаёт ошибки полей валидации', async () => {
    const res = toErrorResponse(new ValidationError('Проверьте поля', { phone: ['Укажите телефон'] }));
    expect((await res.json()).error.fields).toEqual({ phone: ['Укажите телефон'] });
  });

  it('неизвестную ошибку скрывает: 500 без текста и стека', async () => {
    const res = toErrorResponse(new Error('connect ECONNREFUSED /secret/path'));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('/secret/path');
  });
});
