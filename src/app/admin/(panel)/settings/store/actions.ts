'use server';

import type { StoreFlags } from '@/domain/content/store-flags';
import { saveStoreSettings, type MediaChange } from '@/domain/content/store-settings';
import { ValidationError } from '@/server/http/errors';
import { field, runAction } from '../../_lib/run-action';

const BACK = '/admin/settings/store';

async function mediaOf(form: FormData, name: string): Promise<MediaChange> {
  const file = form.get(name);
  if (file instanceof File && file.size > 0) return { bytes: new Uint8Array(await file.arrayBuffer()) };
  return form.get(`${name}_clear`) === '1' ? { remove: true } : undefined;
}

const flag = (form: FormData, name: string): boolean => field(form, name) === '1';

export async function saveStoreSettingsAction(form: FormData): Promise<never> {
  return runAction(BACK, async (session) => {
    const types = form.getAll('social_type').map((v) => (typeof v === 'string' ? v : ''));
    const urls = form.getAll('social_url').map((v) => (typeof v === 'string' ? v.trim() : ''));
    // Строка без ссылки — не заполнена, пропускаем.
    const socials = types.flatMap((type, i) => ((urls[i] ?? '') === '' ? [] : [{ type, url: urls[i] as string }]));
    const version = Number(field(form, 'version'));
    if (!Number.isInteger(version) || version < 0) throw new ValidationError('Форма устарела. Обновите страницу');
    const flags: StoreFlags = {
      storeEnabled: flag(form, 'flag_storeEnabled'),
      maintenance: flag(form, 'flag_maintenance'),
      showPrices: flag(form, 'flag_showPrices'),
      registration: flag(form, 'flag_registration'),
      emailConfirm: flag(form, 'flag_emailConfirm'),
      spamProtection: flag(form, 'flag_spamProtection'),
    };
    await saveStoreSettings(session, {
      version,
      storeName: field(form, 'storeName'),
      tagline: field(form, 'tagline'),
      description: field(form, 'description'),
      phone: field(form, 'phone'),
      email: field(form, 'email'),
      address: field(form, 'address'),
      workSchedule: field(form, 'workSchedule'),
      socials,
      country: field(form, 'country'),
      region: field(form, 'region'),
      currency: field(form, 'currency'),
      timezone: field(form, 'timezone'),
      flags,
      maintenanceMessage: field(form, 'maintenanceMessage'),
      logo: await mediaOf(form, 'logo'),
      favicon: await mediaOf(form, 'favicon'),
    });
  });
}
