import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Статическая проверка по файловой системе: ни одна страница, обработчик или server action админки
 * не появляется без защиты. Защита страницы — requireStaffPage в самом файле; защита route.ts/actions.ts —
 * requirePermission / withStaffPermission / requireStaff либо в файле, либо в общем модуле `_lib/*`, который файл
 * импортирует общую оболочку (runAction / фабрику create…Handler), где вызов есть.
 */
const SRC = resolve(__dirname, '../../src');
const ADMIN = join(SRC, 'app/admin');
const PAGE_GUARD = /\brequireStaffPage\s*\(/;
const ACTION_GUARD = /\b(requirePermission|withStaffPermission|requireStaff)\s*\(/;
/** Явные исключения: вход сотрудника и всё в группе (auth) — там сессии ещё нет. */
const EXCLUDED = (rel: string) => rel.split(/[\\/]/).includes('(auth)');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Файл защищён, если сам содержит вызов защиты или импортирует относительный модуль, где он есть. */
function hasGuard(file: string, source: string, guard: RegExp, allowViaImport: boolean): boolean {
  if (guard.test(source)) return true;
  if (!allowViaImport) return false;
  // Идём только в общие оболочки: runAction и фабрики create…Handler (импорт относительный или через '@/').
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .filter((m) => /\b(runAction|create\w*Handlers?)\b/.test(m[1] ?? ''))
    .map((m) => m[2]!);
  for (const spec of imports) {
    const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(file), spec);
    const target = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((c) => existsSync(c));
    if (target && guard.test(readFileSync(target, 'utf8'))) return true;
  }
  return false;
}

export function findUnguarded(files: { file: string; source: string }[]): string[] {
  const bad: string[] = [];
  for (const { file, source } of files) {
    const rel = relative(ADMIN, file).replace(/\\/g, '/');
    if (EXCLUDED(rel)) continue;
    const name = rel.split('/').pop()!;
    if (name === 'page.tsx' && !hasGuard(file, source, PAGE_GUARD, false)) bad.push(rel);
    if ((name === 'route.ts' || name === 'actions.ts') && !hasGuard(file, source, ACTION_GUARD, true)) bad.push(rel);
  }
  return bad;
}

const files = walk(ADMIN)
  .filter((f) => /[\\/](page\.tsx|route\.ts|actions\.ts)$/.test(f))
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }));

describe('защита страниц и обработчиков админки (по файловой системе)', () => {
  it('нашлись страницы, обработчики и действия (проверка не пустая)', () => {
    const rels = files.map((f) => relative(ADMIN, f.file).replace(/\\/g, '/'));
    expect(rels.filter((r) => r.endsWith('page.tsx')).length).toBeGreaterThan(15);
    expect(rels.filter((r) => r.endsWith('route.ts')).length).toBeGreaterThanOrEqual(3);
    expect(rels.filter((r) => r.endsWith('actions.ts')).length).toBeGreaterThanOrEqual(8);
  });

  it('каждый page.tsx в (panel) вызывает requireStaffPage, каждый route.ts и actions.ts — защиту', () => {
    expect(findUnguarded(files)).toEqual([]);
  });

  it('вход (auth) — единственное исключение', () => {
    const excluded = files.map((f) => relative(ADMIN, f.file).replace(/\\/g, '/')).filter(EXCLUDED);
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.every((r) => r.startsWith('(auth)/'))).toBe(true);
  });

  it('проверка ловит незащищённые файлы', () => {
    const fake = (rel: string, source: string) => ({ file: join(ADMIN, rel), source });
    expect(findUnguarded([fake('(panel)/x/page.tsx', 'export default function P() { return null; }')])).toEqual(['(panel)/x/page.tsx']);
    expect(findUnguarded([fake('(panel)/x/route.ts', 'export const POST = () => new Response("ok");')])).toEqual(['(panel)/x/route.ts']);
    expect(findUnguarded([fake('(panel)/x/actions.ts', "'use server'; export async function a() {}")])).toEqual(['(panel)/x/actions.ts']);
    expect(findUnguarded([fake('(panel)/x/page.tsx', 'await requireStaffPage("orders.read");')])).toEqual([]);
    expect(findUnguarded([fake('(auth)/login/page.tsx', 'export default function L() { return null; }')])).toEqual([]);
  });
});
