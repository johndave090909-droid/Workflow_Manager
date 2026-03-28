import { useEffect } from 'react';
import { getToken } from 'firebase/messaging';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, messagingPromise } from './firebase';

/**
 * Requests notification permission once per login, obtains an FCM token,
 * and saves it to Firestore at users/{userId}/fcmTokens/{token}.
 * Cloud Functions read these tokens to send push notifications on new messages.
 *
 * Also clears the app icon badge and resets the unread counter whenever the
 * app is opened or brought back into focus.
 *
 * Requires VITE_FIREBASE_VAPID_KEY in .env
 * (generate at Firebase Console → Project Settings → Cloud Messaging → Web Push certificates)
 */
export function usePushNotifications(userId: string | null) {
  // ── Register device token ──────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    async function register() {
      try {
        const messaging = await messagingPromise;
        if (!messaging) return;

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
        if (!vapidKey) {
          console.warn('[FCM] VITE_FIREBASE_VAPID_KEY is not set. Push notifications are disabled.');
          return;
        }

        const token = await getToken(messaging, { vapidKey });
        if (!token) return;

        await setDoc(
          doc(db, 'users', userId, 'fcmTokens', token),
          { createdAt: serverTimestamp(), userAgent: navigator.userAgent },
          { merge: true },
        );
      } catch (err) {
        console.warn('[FCM] registration failed:', err);
      }
    }

    register();
  }, [userId]);

  // ── Clear badge when app is opened / focused ───────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const clearBadge = () => {
      // Clear the app icon badge number
      if ('clearAppBadge' in navigator) {
        (navigator as any).clearAppBadge().catch(() => {});
      }
      // Reset the Firestore unread counter so the next push shows the correct number
      updateDoc(doc(db, 'users', userId), { unreadMessages: 0 }).catch(() => {});
    };

    // Clear immediately on login / page load
    clearBadge();

    const onVisibility = () => { if (!document.hidden) clearBadge(); };
    window.addEventListener('focus', clearBadge);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', clearBadge);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);
}
