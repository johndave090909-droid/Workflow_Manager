import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: "AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg",
  authDomain: "systems-hub.firebaseapp.com",
  projectId: "systems-hub",
  storageBucket: "systems-hub.firebasestorage.app",
  messagingSenderId: "513999161843",
  appId: "1:513999161843:web:5a17f15e77771c341e2a86"
};

export const app     = initializeApp(firebaseConfig);
export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);

// Resolves to a Messaging instance when supported (not available in all browsers/environments)
export const messagingPromise = isSupported().then(yes => yes ? getMessaging(app) : null);

// ── GuardianCheck (progress-log-e3900) ────────────────────────────────────────
const guardianApp = initializeApp({
  apiKey: import.meta.env.VITE_GUARDIAN_API_KEY,
  authDomain: "progress-log-e3900.firebaseapp.com",
  projectId: "progress-log-e3900",
  storageBucket: "progress-log-e3900.firebasestorage.app",
  messagingSenderId: "987216725662",
  appId: "1:987216725662:web:90f5193156f36e0a725d8f",
}, 'guardian');

export const guardianDb = getFirestore(guardianApp);
