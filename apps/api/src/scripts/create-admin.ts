import { eq } from 'drizzle-orm';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { adminRoleAssignments, adminUsers } from '../db/schema.js';
import { hashPassword } from '../lib/crypto.js';

/**
 * Bootstraps the first platform owner. Reads the password from the
 * ADMIN_PASSWORD environment variable so it never appears in shell history.
 *
 *   ADMIN_PASSWORD='...' npm run admin:create -- owner@example.com "Owner Name"
 */
const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !name || !password || password.length < 12) {
  console.error('Usage: ADMIN_PASSWORD=<12+ chars> npm run admin:create -- <email> <name>');
  process.exit(1);
}
const { db, pool } = createDatabase(loadConfig().DATABASE_URL);
try {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(adminUsers).where(eq(adminUsers.email, email.toLowerCase()));
    const admin = existing ?? (await tx.insert(adminUsers).values({ email: email.toLowerCase(), name, passwordHash }).returning())[0]!;
    await tx.insert(adminRoleAssignments).values({ adminUserId: admin.id, role: 'platform_owner', storeId: null }).onConflictDoNothing();
    console.log(`Platform owner ready: ${admin.email}${existing ? ' (existing account, password unchanged)' : ''}`);
  });
} finally {
  await pool.end();
}
