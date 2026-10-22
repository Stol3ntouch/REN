import { registerOnLoginHook } from '@/domain/customers/auth';
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
}
