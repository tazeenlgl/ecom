import { describe, expect, it } from 'vitest';
import { checkNewPassword, isOtpCode } from '../lib/password';

describe('checkNewPassword', () => {
  it('accepts 8 to 200 characters that match their confirmation', () => {
    expect(checkNewPassword('12345678', '12345678')).toBeNull();
    expect(checkNewPassword('a'.repeat(200), 'a'.repeat(200))).toBeNull();
  });
  it('rejects a short password before comparing the confirmation', () => {
    expect(checkNewPassword('1234567', 'different')).toMatchObject({ field: 'password' });
    expect(checkNewPassword('', '')).toMatchObject({ field: 'password' });
  });
  it('rejects a password over 200 characters', () => {
    expect(checkNewPassword('a'.repeat(201), 'a'.repeat(201))).toMatchObject({ field: 'password' });
  });
  it('rejects a mismatched confirmation, including a different case', () => {
    expect(checkNewPassword('password1', 'password2')).toMatchObject({ field: 'confirm' });
    expect(checkNewPassword('Password1', 'password1')).toMatchObject({ field: 'confirm' });
  });
});

describe('isOtpCode', () => {
  it('requires exactly six digits', () => {
    expect(isOtpCode('123456')).toBe(true);
    for (const bad of ['', '12345', '1234567', '12345a', ' 12345', '१२३४५६']) expect(isOtpCode(bad)).toBe(false);
  });
});
