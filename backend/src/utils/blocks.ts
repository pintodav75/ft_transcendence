import { db } from '../db/index.js';
import { blocksTable } from '../db/schema.js';
import { eq, and, or } from 'drizzle-orm';

export async function isBlocked(userA: string, userB: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(blocksTable)
    .where(
      or(
        and(eq(blocksTable.blockerId, userA), eq(blocksTable.blockedId, userB)),
        and(eq(blocksTable.blockerId, userB), eq(blocksTable.blockedId, userA)),
      ),
    )
    .limit(1);
  return !!row;
}
