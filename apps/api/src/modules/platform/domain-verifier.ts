import { resolveTxt } from 'node:dns/promises';

/** Reads DNS TXT records for domain-ownership checks. Injected so tests never touch DNS. */
export interface DomainVerifier {
  txtRecords(name: string): Promise<string[]>;
}

export class DnsDomainVerifier implements DomainVerifier {
  async txtRecords(name: string): Promise<string[]> {
    try {
      const records = await resolveTxt(name);
      return records.map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }
}

/** The TXT record name an owner must create to verify `hostname`. */
export const verificationRecordName = (hostname: string) => `_ecom-verify.${hostname}`;
