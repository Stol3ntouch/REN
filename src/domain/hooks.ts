import { registerOnLoginHook } from '@/domain/customers/auth';
import { compare } from '@/domain/customers/compare';
import { favorites } from '@/domain/customers/favorites';
import { mergeGuestCartOnLogin } from '@/domain/ordering/merge-hook';

/**
 * Общий модуль регистрации хуков входа/регистрации. Его импортирует action входа
 * (src/app/(shop)/account/(auth)/actions.ts), поэтому хуки зарегистрированы до login/register.
 * T05: слияние корзины. T07 дополняет: избранное и сравнение (registerOnLoginHook(...)).
 * Повторный импорт модуля (HMR) не удваивает хук — защита флагом на globalThis.
 */
const flag = globalThis as unknown as { __rtsHooksRegistered?: boolean };
if (!flag.__rtsHooksRegistered) {
  flag.__rtsHooksRegistered = true;
  registerOnLoginHook((guestId, userId) => mergeGuestCartOnLogin(guestId, userId));
  // T07: избранное и сравнение гостя — отдельными хуками, чтобы сбой одного не мешал остальным
  registerOnLoginHook((guestId, userId) => favorites.merge(guestId, userId));
  registerOnLoginHook((guestId, userId) => compare.merge(guestId, userId));
}
