import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  collection, query, orderBy, limit,
  onSnapshot, updateDoc, doc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { AppNotification, NotificationType } from './notifications';

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<NotificationType, { icon: string; color: string; bg: string }> = {
  project_assigned:    { icon: '📋', color: '#00ffff', bg: 'rgba(0,255,255,0.15)'   },
  completion_pending:  { icon: '⏳', color: '#ffd700', bg: 'rgba(255,215,0,0.15)'   },
  completion_approved: { icon: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.15)'   },
  completion_rejected: { icon: '❌', color: '#ff4d4d', bg: 'rgba(255,77,77,0.15)'   },
  labor_report:        { icon: '📊', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
  project_chat:        { icon: '💬', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)'  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'Just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { userId: string; }

type Tab = 'all' | 'unread';

export default function NotificationBell({ userId }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen]   = useState(false);
  const [tab,  setTab]    = useState<Tab>('all');
  const panelRef          = useRef<HTMLDivElement>(null);

  // ── Real-time listener ──────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'users', userId, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(40),
    );
    return onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => {
        const data = d.data();
        return {
          id:        d.id,
          title:     data.title    ?? '',
          body:      data.body     ?? '',
          type:      data.type     as NotificationType,
          read:      data.read     ?? false,
          createdAt: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
          projectId: data.projectId,
        } as AppNotification;
      }));
    });
  }, [userId]);

  // ── Close on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayed   = tab === 'unread' ? notifications.filter(n => !n.read) : notifications;

  const markRead = (id: string) =>
    updateDoc(doc(db, 'users', userId, 'notifications', id), { read: true });

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'users', userId, 'notifications', n.id), { read: true }));
    await batch.commit();
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="relative" ref={panelRef}>

      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`relative p-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl ${open ? 'bg-[#ff00ff]/15 text-[#ff00ff]' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff00ff] text-white text-[9px] font-black flex items-center justify-center shadow-lg shadow-[#ff00ff]/50 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed inset-0 bg-[#12091e] border border-white/10 rounded-none shadow-2xl shadow-black/80 z-[60] overflow-hidden flex flex-col w-screen h-[100dvh] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-3 sm:rounded-2xl sm:w-[min(400px,calc(100vw-24px))] sm:h-auto"
        >
          {/* ── Header ── */}
          <div className="px-5 pt-5 pb-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setOpen(false)}
                className="sm:hidden mr-2 -ml-1 px-2 py-1 text-sm font-bold text-slate-300 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                aria-label="Close notifications"
              >
                Back
              </button>
              <h2 className="text-xl font-black text-white tracking-tight">Notifications</h2>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] font-bold text-[#00ffff] hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1">
              {(['all', 'unread'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 min-h-[36px] rounded-full text-xs font-bold transition-all capitalize ${
                    tab === t
                      ? 'bg-[#ff00ff]/20 text-[#ff00ff] border border-[#ff00ff]/30'
                      : 'text-slate-500 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t}
                  {t === 'unread' && unreadCount > 0 && (
                    <span className="ml-1.5 text-[9px] font-black bg-[#ff00ff] text-white px-1.5 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── List ── */}
          <div className="overflow-y-auto flex-1 max-h-[calc(100dvh-140px)] sm:max-h-[min(480px,calc(100vh-80px))]">
            {displayed.length === 0 && (
              <div className="py-14 text-center">
                <p className="text-4xl mb-3">🔔</p>
                <p className="text-sm font-semibold text-slate-500">
                  {tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
              </div>
            )}

            {/* Section label */}
            {displayed.length > 0 && (
              <p className="px-5 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600">
                {tab === 'unread' ? `${unreadCount} unread` : 'Recent'}
              </p>
            )}

            {displayed.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? { icon: '🔔', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' };
              return (
                <div
                  key={n.id}
                  onClick={() => !n.read && markRead(n.id)}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-all hover:bg-white/[0.04] mx-1 rounded-xl mb-0.5 ${!n.read ? 'bg-white/[0.03]' : ''}`}
                >
                  {/* Icon bubble */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 mt-0.5"
                    style={{ background: cfg.bg, boxShadow: `0 0 12px ${cfg.color}30` }}
                  >
                    {cfg.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${n.read ? 'text-slate-400 font-medium' : 'text-white font-bold'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                    )}
                    <p
                      className="text-[11px] font-bold mt-1"
                      style={{ color: n.read ? '#475569' : cfg.color }}
                    >
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-2" style={{ backgroundColor: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }} />
                  )}
                </div>
              );
            })}

            {displayed.length > 0 && <div className="h-2" />}
          </div>
        </div>
      )}
    </div>
  );
}
