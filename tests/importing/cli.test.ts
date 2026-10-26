import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI npm run import:yml продолжает работать', () => {
  it('предпросмотр и применение файла; повтор не создаёт дублей', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rts-cli-'));
    const env = { ...process.env, DATABASE_PATH: join(dir, 'db.sqlite'), DATA_DIR: dir, NODE_ENV: 'test' as const };
    const run = (...args: string[]) => execFileSync(process.execPath, [join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), 'scripts/import-yml.ts', 'tests/fixtures/catalog-sample.yml', ...args], { env, encoding: 'utf8', timeout: 60_000 });
    expect(run('--preview')).toMatch(/Предпросмотр/);
    const first = run();
    expect(first).toMatch(/Применено/);
    expect(first).toMatch(/import_runs #\d+/);
    expect(run()).toMatch(/товары:\s+создано 0, изменено 0/);
  }, 90_000);
});
