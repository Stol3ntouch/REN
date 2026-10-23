import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accountGate } from '@/domain/customers/account';
import type { UserSession } from '@/domain/customers/session';

/** Первая строка каждой страницы кабинета: нет входа → редирект на /account/login с возвратом на эту страницу. */
export async function requireAccountPage(nextPath: string): Promise<UserSession> {
  const gate = accountGate(await cookies(), nextPath);
  if (!gate.ok) redirect(gate.redirectTo);
  return gate.session;
}
