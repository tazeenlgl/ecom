/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX). Accepts common
 * input forms: "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 * Returns null for anything that is not a 10-digit mobile number starting 6-9.
 */
export function normalizeIndianMobile(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  if (!/^[\d\s\-+().]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** Indian PIN codes: six digits, first digit 1-9. */
export const isValidPincode = (pincode: string) => /^[1-9]\d{5}$/.test(pincode);

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
] as const;
