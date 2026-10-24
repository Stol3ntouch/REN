'use client';

import { useState } from 'react';
import { PERMISSION_GROUPS } from '@/domain/admin/permission-catalog';
import './roles.css';

/**
 * Матрица разрешений: группы флажков. Отмеченные поля `permission` уходят в server action; сервер всё проверяет заново
 * (выдавать можно только то, что есть у самого правящего). `locked` — роль суперадминистратора: все права, менять нельзя.
 * Базовое право «свой профиль» есть у любой роли и в матрице не показывается как изменяемое.
 */
export function PermissionMatrix({ initial, locked, held }: { initial: readonly string[]; locked: boolean; held: readonly string[] }) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(initial));
  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const setGroup = (keys: readonly string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  return (
    <div className="rm-matrix">
      {PERMISSION_GROUPS.map((g) => {
        const keys = g.permissions.filter((p) => !('baseline' in p && p.baseline)).map((p) => p.key as string);
        const all = keys.every((k) => checked.has(k));
        return (
          <fieldset key={g.key} className="rm-group" disabled={locked}>
            <legend>
              {g.label}
              {locked ? null : (
                <button type="button" className="rm-group__toggle" onClick={() => setGroup(keys, !all)}>
                  {all ? 'Снять все' : 'Отметить все'}
                </button>
              )}
            </legend>
            <ul>
              {g.permissions
                .filter((p) => !('baseline' in p && p.baseline))
                .map((p) => {
                  const lacking = !locked && !held.includes(p.key) && !checked.has(p.key);
                  return (
                    <li key={p.key}>
                      <label>
                        <input type="checkbox" name="permission" value={p.key} checked={locked || checked.has(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                        <span>
                          {p.label}
                          {'legacy' in p && p.legacy ? <em className="rm-legacy"> (общее право)</em> : null}
                          {lacking ? <em className="rm-lack"> — нет у вас, выдать нельзя</em> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
