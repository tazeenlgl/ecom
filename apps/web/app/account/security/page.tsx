import { getCustomer } from '@/lib/server-api';
import { PasswordForm } from './password-form';

export const metadata = { title: 'Security' };

export default async function SecurityPage() {
  const customer = await getCustomer();
  return (
    <section>
      <h2 className="mb-2 font-display text-2xl">{customer?.hasPassword ? 'Change password' : 'Set a password'}</h2>
      <p className="mb-6 max-w-xl text-sm text-muted">
        {customer?.hasPassword
          ? 'Changing your password signs you out on your other devices.'
          : 'A password is optional. You can always sign in with a one-time code sent to your mobile number.'}
      </p>
      <PasswordForm hasPassword={Boolean(customer?.hasPassword)} />
    </section>
  );
}
