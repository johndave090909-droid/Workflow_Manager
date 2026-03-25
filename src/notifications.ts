import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

export type NotificationType =
  | 'project_assigned'
  | 'completion_pending'
  | 'completion_approved'
  | 'completion_rejected'
  | 'labor_report'
  | 'project_chat';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  createdAt: string; // ISO string (converted from Timestamp)
  projectId?: string;
}

/** Write a single notification to a user's subcollection. */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  type: NotificationType,
  extra?: { projectId?: string },
) {
  await addDoc(collection(db, 'users', userId, 'notifications'), {
    title,
    body,
    type,
    read: false,
    createdAt: serverTimestamp(),
    ...(extra ?? {}),
  });
}

/** Write the same notification to multiple users. */
export async function notifyUsers(
  userIds: string[],
  title: string,
  body: string,
  type: NotificationType,
  extra?: { projectId?: string },
) {
  await Promise.all(userIds.map(id => notifyUser(id, title, body, type, extra)));
}

/** Query all Director users and notify them. */
export async function notifyDirectors(
  title: string,
  body: string,
  type: NotificationType,
  extra?: { projectId?: string },
) {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'Director')));
  const ids = snap.docs.map(d => d.id);
  if (ids.length) await notifyUsers(ids, title, body, type, extra);
}
