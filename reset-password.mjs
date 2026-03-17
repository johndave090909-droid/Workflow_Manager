/**
 * One-time script to reset a Firebase Auth user's password.
 * Usage: node reset-password.mjs
 *
 * Requirements:
 *   - Set GOOGLE_APPLICATION_CREDENTIALS env var to your service account JSON path, OR
 *   - Run inside Firebase Functions emulator (auto-credentialed), OR
 *   - Run with: GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccount.json node reset-password.mjs
 */

import 'dotenv/config';
import admin from 'firebase-admin';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (sa && !admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
}

const TARGET_EMAIL = 'RobinetT@polynesia.com';
const NEW_PASSWORD = 'Aloha123';

// initialized above

const FIRESTORE_UID = 'kdzu97sYn3ds51g0GIXIPH7PGai1';

async function resetPassword() {
  try {
    let user;
    try {
      user = await admin.auth().getUserByEmail(TARGET_EMAIL);
      console.log(`Found existing auth user: ${user.uid}`);
      await admin.auth().updateUser(user.uid, { password: NEW_PASSWORD });
      console.log(`Password updated successfully.`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Create the auth account with the same UID as Firestore doc
        console.log(`No auth account found — creating one with UID: ${FIRESTORE_UID}`);
        user = await admin.auth().createUser({
          uid: FIRESTORE_UID,
          email: TARGET_EMAIL,
          password: NEW_PASSWORD,
        });
        console.log(`Auth account created and password set to "${NEW_PASSWORD}".`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

resetPassword();
