import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

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
