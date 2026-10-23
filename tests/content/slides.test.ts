import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { listActiveSlides } from '@/domain/content/queries';
import { slidesRepo } from '@/server/db/repositories/slides';
import { createTestDb } from '@/server/db/testing';
import { ValidationError } from '@/server/http/errors';
import { ADMIN, T0, pngBytes, withUploadsDir } from './helpers';

const uploads = withUploadsDir();

describe('слайдер: не больше трёх слайдов', () => {
  it('четвёртый слайд сервер не принимает, три — принимает', async () => {
    const db = createTestDb();
    const ctx = () => ({ db, now: T0, uploadsDir: uploads.dir() });
    for (let i = 1; i <= 3; i++) await contentOps.slides.save(ADMIN, null, { title: `Слайд ${i}`, active: true }, ctx());
    await expect(contentOps.slides.save(ADMIN, null, { title: 'Слайд 4', active: true }, ctx())).rejects.toBeInstanceOf(ValidationError);
    expect(slidesRepo.count(db)).toBe(3);
    // существующий слайд править можно
    const first = slidesRepo.list(db)[0]!;
    await contentOps.slides.save(ADMIN, first.id, { title: 'Новое название', active: true }, ctx());
    expect(slidesRepo.get(db, first.id)?.title).toBe('Новое название');
  });

  it('на уровне БД четвёртая вставка тоже падает (страховка от обхода кода)', () => {
    const db = createTestDb();
    const ins = () => db.prepare("INSERT INTO slides (title, updated_at) VALUES ('s', 0)").run();
    ins();
    ins();
    ins();
    expect(ins).toThrow();
  });

  it('публике отдаются только включённые слайды; нет слайдов — пустой список', async () => {
    const db = createTestDb();
    expect(listActiveSlides({ db })).toEqual([]);
    await contentOps.slides.save(ADMIN, null, { title: 'Скрытый', active: false }, { db, now: T0 });
    await contentOps.slides.save(ADMIN, null, { title: 'Виден', active: true }, { db, now: T0 });
    expect(listActiveSlides({ db }).map((s) => s.title)).toEqual(['Виден']);
  });

  it('картинка слайда проходит проверку типа: не изображение отклоняется, PNG сохраняется с alt', async () => {
    const db = createTestDb();
    const ctx = { db, now: T0, uploadsDir: uploads.dir() };
    await expect(
      contentOps.slides.save(ADMIN, null, { title: 'x', active: true, image: { bytes: new TextEncoder().encode('<?php evil ?>') } }, ctx),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(slidesRepo.count(db)).toBe(0);
    const { id } = await contentOps.slides.save(
      ADMIN,
      null,
      { title: 'Фото', imageAlt: 'Газонокосилка', active: true, image: { bytes: await pngBytes(1600, 600) } },
      ctx,
    );
    const view = listActiveSlides({ db }).find((s) => s.id === id)!;
    expect(view.image?.alt).toBe('Газонокосилка');
    expect(view.image?.src).toMatch(/^\/api\/catalog\/media\/[a-f0-9]{32}-\d+\.webp$/);
  });
});
