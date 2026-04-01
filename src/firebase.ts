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

// ── Progression Tracking (progression-tracking) ────────────────────────────────
const progressionApp = initializeApp({
  apiKey: import.meta.env.VITE_PROGRESSION_API_KEY,
  authDomain: "progression-tracking.firebaseapp.com",
  projectId: "progression-tracking",
  storageBucket: "progression-tracking.firebasestorage.app",
  messagingSenderId: "619162418208",
  appId: "1:619162418208:web:36816de59df185a62c1045",
}, 'progression');

export const progressionDb = getFirestore(progressionApp);

// ── PCC KDS (pcc-kds-5bee6) ───────────────────────────────────────────────────
const kdsApp = initializeApp({
  apiKey: "AIzaSyCkDeNR98GOSi3D0Co5kGcrdruGaBw31vc",
  authDomain: "pcc-kds-5bee6.firebaseapp.com",
  projectId: "pcc-kds-5bee6",
  storageBucket: "pcc-kds-5bee6.firebasestorage.app",
  messagingSenderId: "672801653224",
  appId: "1:672801653224:web:08b0536720e188298d645d",
}, 'kds');

export const kdsDb = getFirestore(kdsApp);
