/** Same limits the API enforces on a new password (8 to 200 characters); these only give earlier feedback. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** What is wrong with a new password and its confirmation, or null when both are acceptable. */
export function checkNewPassword(password: string, confirm: string): { field: 'password' | 'confirm'; message: string } | null {
  if (password.length < PASSWORD_MIN) return { field: 'password', message: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > PASSWORD_MAX) return { field: 'password', message: `Use at most ${PASSWORD_MAX} characters.` };
  if (password !== confirm) return { field: 'confirm', message: 'The two passwords do not match.' };
  return null;
}

/** The API's one-time codes are six digits. */
export const isOtpCode = (code: string): boolean => /^\d{6}$/.test(code);
