import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  console.log('Fetching all direct conversations…');
  const snap = await db.collection('conversations').where('type', '==', 'direct').get();
  console.log(`Found ${snap.docs.length} direct conversation(s).`);

  // Group by sorted member pair
  const groups = {};
  for (const d of snap.docs) {
    const members = (d.data().members ?? []).slice().sort();
    const key = members.join('|');
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }

  for (const [key, docs] of Object.entries(groups)) {
    if (docs.length < 2) continue;
    console.log(`\nDuplicate pair [${key}]: ${docs.length} conversations`);

    // Keep the oldest (first created); merge all others into it
    docs.sort((a, b) => {
      const aAt = a.data().createdAt?.toMillis?.() ?? 0;
      const bAt = b.data().createdAt?.toMillis?.() ?? 0;
      return aAt - bAt;
    });

    const keeper = docs[0];
    const duplicates = docs.slice(1);
    console.log(`  Keeping: ${keeper.id}`);

    for (const dup of duplicates) {
      console.log(`  Merging & deleting: ${dup.id}`);

      // Copy messages from duplicate into keeper
      const msgSnap = await db.collection('conversations').doc(dup.id).collection('messages').get();
      console.log(`    Moving ${msgSnap.docs.length} message(s)…`);

      const batch = db.batch();
      for (const msg of msgSnap.docs) {
        const ref = db.collection('conversations').doc(keeper.id).collection('messages').doc();
        batch.set(ref, msg.data());
        batch.delete(msg.ref);
      }
      // Merge unread counts (take max per user)
      const keeperData = keeper.data();
      const dupData    = dup.data();
      const mergedUnread = { ...(keeperData.unreadCounts ?? {}) };
      for (const [userId, count] of Object.entries(dupData.unreadCounts ?? {})) {
        mergedUnread[userId] = Math.max(mergedUnread[userId] ?? 0, count);
      }
      batch.update(keeper.ref, { unreadCounts: mergedUnread });
      batch.delete(dup.ref);
      await batch.commit();
      console.log(`    Done.`);
    }
  }

  console.log('\nAll duplicates merged.');
}

main().catch(console.error);
