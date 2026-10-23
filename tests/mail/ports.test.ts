import { describe, expect, it } from 'vitest';
import { createStubMailPort, mailSecrets, selectMailPort } from '@/integrations/mail/ports';
import { MailNotConfiguredError } from '@/integrations/mail/types';

describe('MailPort по настройкам', () => {
  it('без MAIL_HOST/MAIL_FROM — заглушка: connected=false, mode=stub, отправка отказывает без падения процесса', async () => {
    for (const cfg of [{}, { host: 'smtp.test' }, { from: 'shop@test.ru' }]) {
      const port = selectMailPort(cfg);
      expect(port.status()).toMatchObject({ connected: false, mode: 'stub' });
      expect(port.status().note).toContain('SMTP не настроен');
    }
    await expect(createStubMailPort().send({ to: ['a@b.ru'], subject: 's', text: 't' })).rejects.toBeInstanceOf(MailNotConfiguredError);
  });

  it('с host и from — SMTP; статус не содержит секретов', () => {
    const port = selectMailPort({ host: 'smtp.test', port: 465, user: 'robot', password: 'p4ssw0rd-secret', from: 'shop@test.ru' });
    expect(port.name).toBe('smtp');
    expect(port.status()).toMatchObject({ connected: true, mode: 'live' });
    expect(JSON.stringify(port.status())).not.toContain('p4ssw0rd-secret');
    expect(mailSecrets({ password: 'p4ssw0rd-secret', user: 'robot', host: 'smtp.test' })).toContain('p4ssw0rd-secret');
  });
});
