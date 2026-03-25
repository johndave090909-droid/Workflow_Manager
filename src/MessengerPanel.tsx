import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, ArrowLeft, Plus, Users, Send, Search, X, Check } from 'lucide-react';
import {
  collection, query, where, limit,
  onSnapshot, addDoc, updateDoc, doc, getDocs,
  serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from './firebase';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AppUser {
  id: string;
  name: string;
  photo?: string;
  role?: string;
}

interface Conversation {
  id: string;
  type: 'direct' | 'group';
  members: string[];
  memberNames: Record<string, string>;
  memberPhotos: Record<string, string>;
  groupName?: string;
  lastMessage: string;
  lastMessageAt: string | null;
  lastMessageSenderId: string;
  unreadCounts: Record<string, number>;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  content: string;
  timestamp: string | null;
}

type View = 'list' | 'chat' | 'new-dm' | 'new-group';

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'now';
  if (mins  < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days  < 7)  return `${days}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function convName(conv: Conversation, myId: string): string {
  if (conv.type === 'group') return conv.groupName || 'Group Chat';
  const otherId = conv.members.find(m => m !== myId);
  return otherId ? (conv.memberNames[otherId] || 'Unknown') : 'Unknown';
}

function convPhoto(conv: Conversation, myId: string): string | undefined {
  if (conv.type === 'group') return undefined;
  const otherId = conv.members.find(m => m !== myId);
  return otherId ? conv.memberPhotos[otherId] : undefined;
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ photo, name, size = 36 }: { photo?: string; name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-black text-white bg-[#ff00ff]/30 border border-[#ff00ff]/40"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
    >
      {initials}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props { currentUser: AppUser; }

export default function MessengerPanel({ currentUser }: Props) {
  const [open,          setOpen]          = useState(false);
  const [view,          setView]          = useState<View>('list');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv,    setActiveConv]    = useState<Conversation | null>(null);
  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [newMsg,        setNewMsg]        = useState('');
  const [sending,       setSending]       = useState(false);
  const [allUsers,      setAllUsers]      = useState<AppUser[]>([]);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [selectedUsers, setSelectedUsers] = useState<AppUser[]>([]);
  const [groupName,     setGroupName]     = useState('');

  const panelRef      = useRef<HTMLDivElement>(null);
  const messagesEnd   = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);

  // ── Conversations listener ────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'conversations'),
      where('members', 'array-contains', currentUser.id),
    );
    return onSnapshot(q, snap => {
      const convs = snap.docs.map(d => {
        const data = d.data();
        return {
          id:                  d.id,
          type:                data.type,
          members:             data.members             ?? [],
          memberNames:         data.memberNames         ?? {},
          memberPhotos:        data.memberPhotos        ?? {},
          groupName:           data.groupName,
          lastMessage:         data.lastMessage         ?? '',
          lastMessageAt:       data.lastMessageAt?.toDate?.()?.toISOString() ?? null,
          lastMessageSenderId: data.lastMessageSenderId ?? '',
          unreadCounts:        data.unreadCounts        ?? {},
        } as Conversation;
      });
      // Sort client-side — avoids needing a composite Firestore index
      convs.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });
      setConversations(convs);
    });
  }, [currentUser.id]);

  // ── Keep activeConv in sync with live list ────────────────────────────────
  useEffect(() => {
    if (!activeConv) return;
    const updated = conversations.find(c => c.id === activeConv.id);
    if (updated) setActiveConv(updated);
  }, [conversations]);

  // ── Messages listener ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeConv) return;
    const q = query(
      collection(db, 'conversations', activeConv.id, 'messages'),
      limit(100),
    );
    return onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => {
        const data = d.data();
        return {
          id:          d.id,
          senderId:    data.senderId,
          senderName:  data.senderName,
          senderPhoto: data.senderPhoto ?? '',
          content:     data.content,
          timestamp:   data.timestamp?.toDate?.()?.toISOString() ?? null,
        };
      });
      msgs.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return -1;
        if (!b.timestamp) return 1;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
      setMessages(msgs);
    });
  }, [activeConv?.id]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Reset unread when conversation is open ────────────────────────────────
  useEffect(() => {
    if (!activeConv || !open) return;
    if ((activeConv.unreadCounts?.[currentUser.id] ?? 0) > 0) {
      updateDoc(doc(db, 'conversations', activeConv.id), {
        [`unreadCounts.${currentUser.id}`]: 0,
      });
    }
  }, [activeConv?.id, open]);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Load all users for new DM / group ─────────────────────────────────────
  useEffect(() => {
    if (view !== 'new-dm' && view !== 'new-group') return;
    getDocs(collection(db, 'users')).then(snap => {
      setAllUsers(
        snap.docs
          .map(d => ({ id: d.id, name: d.data().name ?? '', photo: d.data().photo, role: d.data().role }))
          .filter(u => u.id !== currentUser.id),
      );
    });
  }, [view]);

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCounts?.[currentUser.id] ?? 0), 0);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const content = newMsg.trim();
    if (!content || sending || !activeConv) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), {
        senderId:    currentUser.id,
        senderName:  currentUser.name,
        senderPhoto: currentUser.photo ?? '',
        content,
        timestamp:   serverTimestamp(),
      });
      const unreadUpdate: Record<string, ReturnType<typeof increment>> = {};
      activeConv.members.forEach(id => {
        if (id !== currentUser.id) unreadUpdate[`unreadCounts.${id}`] = increment(1);
      });
      await updateDoc(doc(db, 'conversations', activeConv.id), {
        lastMessage:         content,
        lastMessageAt:       serverTimestamp(),
        lastMessageSenderId: currentUser.id,
        ...unreadUpdate,
      });
      setNewMsg('');
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  // ── Open or create DM ─────────────────────────────────────────────────────
  const openDM = async (target: AppUser) => {
    // Check local state first (fast path)
    const localExisting = conversations.find(c =>
      c.type === 'direct' && c.members.length === 2 && c.members.includes(target.id),
    );
    if (localExisting) { setActiveConv(localExisting); setView('chat'); return; }

    // Double-check Firestore in case local state isn't fully loaded yet
    const snap = await getDocs(query(
      collection(db, 'conversations'),
      where('members', 'array-contains', currentUser.id),
    ));
    const firestoreExisting = snap.docs.find(d => {
      const data = d.data();
      return data.type === 'direct' && data.members?.length === 2 && data.members?.includes(target.id);
    });
    if (firestoreExisting) {
      const data = firestoreExisting.data();
      const conv: Conversation = {
        id: firestoreExisting.id, type: 'direct',
        members: data.members, memberNames: data.memberNames ?? {}, memberPhotos: data.memberPhotos ?? {},
        lastMessage: data.lastMessage ?? '', lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() ?? null,
        lastMessageSenderId: data.lastMessageSenderId ?? '', unreadCounts: data.unreadCounts ?? {},
      };
      setActiveConv(conv); setView('chat'); return;
    }

    const ref = await addDoc(collection(db, 'conversations'), {
      type:                'direct',
      members:             [currentUser.id, target.id],
      memberNames:         { [currentUser.id]: currentUser.name,    [target.id]: target.name },
      memberPhotos:        { [currentUser.id]: currentUser.photo ?? '', [target.id]: target.photo ?? '' },
      lastMessage:         '',
      lastMessageAt:       serverTimestamp(),
      lastMessageSenderId: '',
      unreadCounts:        { [currentUser.id]: 0, [target.id]: 0 },
      createdAt:           serverTimestamp(),
      createdBy:           currentUser.id,
    });
    setActiveConv({
      id: ref.id, type: 'direct',
      members: [currentUser.id, target.id],
      memberNames:  { [currentUser.id]: currentUser.name,    [target.id]: target.name },
      memberPhotos: { [currentUser.id]: currentUser.photo ?? '', [target.id]: target.photo ?? '' },
      lastMessage: '', lastMessageAt: null, lastMessageSenderId: '', unreadCounts: {},
    });
    setView('chat');
  };

  // ── Create group ──────────────────────────────────────────────────────────
  const createGroup = async () => {
    if (selectedUsers.length < 1) return;
    const autoName = selectedUsers.map(u => u.name.split(' ')[0]).join(', ');
    const finalGroupName = groupName.trim() || autoName;
    const members = [currentUser.id, ...selectedUsers.map(u => u.id)];
    const memberNames:  Record<string, string> = { [currentUser.id]: currentUser.name };
    const memberPhotos: Record<string, string> = { [currentUser.id]: currentUser.photo ?? '' };
    const unreadCounts: Record<string, number> = { [currentUser.id]: 0 };
    selectedUsers.forEach(u => {
      memberNames[u.id]  = u.name;
      memberPhotos[u.id] = u.photo ?? '';
      unreadCounts[u.id] = 0;
    });
    const ref = await addDoc(collection(db, 'conversations'), {
      type: 'group', members, memberNames, memberPhotos,
      groupName: finalGroupName,
      lastMessage: '', lastMessageAt: serverTimestamp(), lastMessageSenderId: '',
      unreadCounts, createdAt: serverTimestamp(), createdBy: currentUser.id,
    });
    setActiveConv({
      id: ref.id, type: 'group', members, memberNames, memberPhotos,
      groupName: finalGroupName,
      lastMessage: '', lastMessageAt: null, lastMessageSenderId: '', unreadCounts,
    });
    setGroupName(''); setSelectedUsers([]);
    setView('chat');
  };

  const goBack = () => {
    setView('list'); setActiveConv(null); setMessages([]);
    setSearchQuery(''); setSelectedUsers([]); setGroupName('');
  };

  const filteredUsers = allUsers.filter(u =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={panelRef}>

      {/* Trigger button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) setView('list'); }}
        className={`relative p-2 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl ${
          open ? 'bg-[#38bdf8]/15 text-[#38bdf8]' : 'text-slate-400 hover:text-white hover:bg-white/5'
        }`}
        title="Messages"
      >
        <MessageCircle size={18} />
        {totalUnread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#38bdf8] text-white text-[9px] font-black flex items-center justify-center shadow-lg shadow-[#38bdf8]/50 animate-pulse">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-3 bg-[#12091e] border border-white/10 rounded-2xl shadow-2xl shadow-black/80 z-[60] overflow-hidden flex flex-col"
          style={{ width: 'min(380px, calc(100vw - 24px))', height: 'min(520px, calc(100vh - 80px))' }}
        >

          {/* ── LIST ────────────────────────────────────────────────── */}
          {view === 'list' && (
            <>
              <div className="px-5 pt-5 pb-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-black text-white tracking-tight">Messages</h2>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setView('new-group'); setSearchQuery(''); setSelectedUsers([]); }}
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                      title="New group chat"
                    >
                      <Users size={16} />
                    </button>
                    <button
                      onClick={() => { setView('new-dm'); setSearchQuery(''); }}
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                      title="New message"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto flex-1">
                {conversations.length === 0 && (
                  <div className="py-14 text-center">
                    <p className="text-4xl mb-3">💬</p>
                    <p className="text-sm font-semibold text-slate-500">No messages yet</p>
                    <p className="text-xs text-slate-600 mt-1">Start a conversation with the + button</p>
                  </div>
                )}
                {conversations.map(conv => {
                  const name   = convName(conv, currentUser.id);
                  const photo  = convPhoto(conv, currentUser.id);
                  const unread = conv.unreadCounts?.[currentUser.id] ?? 0;
                  const isMe   = conv.lastMessageSenderId === currentUser.id;
                  return (
                    <div
                      key={conv.id}
                      onClick={() => { setActiveConv(conv); setView('chat'); }}
                      className={`flex items-center gap-3 px-4 py-3 sm:py-2 cursor-pointer hover:bg-white/[0.04] mx-1 rounded-xl mb-0.5 transition-all ${unread > 0 ? 'bg-white/[0.03]' : ''}`}
                    >
                      {conv.type === 'group' ? (
                        <div className="w-10 h-10 rounded-full bg-[#38bdf8]/20 border border-[#38bdf8]/30 flex items-center justify-center shrink-0">
                          <Users size={16} className="text-[#38bdf8]" />
                        </div>
                      ) : (
                        <Avatar photo={photo} name={name} size={40} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm truncate ${unread > 0 ? 'text-white font-bold' : 'text-slate-300 font-semibold'}`}>
                            {name}
                          </p>
                          <p className="text-[10px] text-slate-600 shrink-0">{timeAgo(conv.lastMessageAt)}</p>
                        </div>
                        <p className={`text-xs truncate mt-0.5 ${unread > 0 ? 'text-slate-300 font-semibold' : 'text-slate-500'}`}>
                          {conv.lastMessage
                            ? `${isMe ? 'You: ' : ''}${conv.lastMessage}`
                            : 'No messages yet'}
                        </p>
                      </div>
                      {unread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#38bdf8] text-white text-[9px] font-black flex items-center justify-center shrink-0">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="h-2" />
              </div>
            </>
          )}

          {/* ── CHAT ────────────────────────────────────────────────── */}
          {view === 'chat' && activeConv && (
            <>
              {/* Header */}
              <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-white/[0.06] flex items-center gap-3">
                <button onClick={goBack} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors shrink-0">
                  <ArrowLeft size={16} />
                </button>
                {activeConv.type === 'group' ? (
                  <div className="w-8 h-8 rounded-full bg-[#38bdf8]/20 border border-[#38bdf8]/30 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-[#38bdf8]" />
                  </div>
                ) : (
                  <Avatar photo={convPhoto(activeConv, currentUser.id)} name={convName(activeConv, currentUser.id)} size={32} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{convName(activeConv, currentUser.id)}</p>
                  {activeConv.type === 'group' && (
                    <p className="text-[10px] text-slate-500">{activeConv.members.length} members</p>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
                {messages.length === 0 && (
                  <div className="flex-1 flex items-center justify-center py-10">
                    <p className="text-sm text-slate-600">No messages yet. Say hi! 👋</p>
                  </div>
                )}
                {messages.map((msg, i) => {
                  const isMe     = msg.senderId === currentUser.id;
                  const prev     = messages[i - 1];
                  const showName = !isMe && activeConv.type === 'group' && (!prev || prev.senderId !== msg.senderId);
                  const showAvatar = !isMe && (!messages[i + 1] || messages[i + 1].senderId !== msg.senderId);
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-1.5`}>
                      {!isMe && (
                        <div className="shrink-0 w-6" style={{ visibility: showAvatar ? 'visible' : 'hidden' }}>
                          <Avatar photo={msg.senderPhoto} name={msg.senderName} size={24} />
                        </div>
                      )}
                      <div className={`max-w-[85%] sm:max-w-[72%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        {showName && (
                          <p className="text-[10px] text-slate-500 mb-0.5 px-1">{msg.senderName}</p>
                        )}
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                          isMe
                            ? 'bg-[#38bdf8] text-white rounded-br-sm'
                            : 'bg-white/[0.09] text-slate-200 rounded-bl-sm'
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEnd} />
              </div>

              {/* Input */}
              <div className="px-3 pb-3 flex-shrink-0">
                <div className="flex items-center gap-2 bg-white/[0.06] rounded-2xl px-3 py-2 border border-white/[0.08] focus-within:border-[#38bdf8]/30 transition-colors">
                  <input
                    ref={inputRef}
                    value={newMsg}
                    onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type a message…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!newMsg.trim() || sending}
                    className="p-2 min-h-[44px] min-w-[44px] rounded-xl bg-[#38bdf8] text-white disabled:opacity-30 transition-all hover:bg-[#0ea5e9] shrink-0 flex items-center justify-center"
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── NEW DM ──────────────────────────────────────────────── */}
          {view === 'new-dm' && (
            <>
              <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-white/[0.06] flex items-center gap-3">
                <button onClick={goBack} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
                  <ArrowLeft size={16} />
                </button>
                <h3 className="text-base font-bold text-white">New Message</h3>
              </div>
              <div className="px-3 pt-3 pb-2 flex-shrink-0">
                <div className="flex items-center gap-2 bg-white/[0.06] rounded-xl px-3 py-2 border border-white/[0.08]">
                  <Search size={13} className="text-slate-500 shrink-0" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search people…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-1">
                {filteredUsers.map(user => (
                  <div
                    key={user.id}
                    onClick={() => openDM(user)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/[0.05] mx-1 mb-0.5 transition-all"
                  >
                    <Avatar photo={user.photo} name={user.name} size={36} />
                    <div>
                      <p className="text-sm font-semibold text-white">{user.name}</p>
                      {user.role && <p className="text-[11px] text-slate-500">{user.role}</p>}
                    </div>
                  </div>
                ))}
                <div className="h-2" />
              </div>
            </>
          )}

          {/* ── NEW GROUP ───────────────────────────────────────────── */}
          {view === 'new-group' && (
            <>
              <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-white/[0.06] flex items-center gap-3">
                <button onClick={goBack} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
                  <ArrowLeft size={16} />
                </button>
                <h3 className="text-base font-bold text-white">New Group Chat</h3>
              </div>

              <div className="px-3 pt-3 pb-2 flex-shrink-0 space-y-2">
                <input
                  autoFocus
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="Group name…"
                  className="w-full bg-white/[0.06] rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none border border-white/[0.08] focus:border-[#38bdf8]/40 transition-colors"
                />
                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUsers.map(u => (
                      <span
                        key={u.id}
                        className="flex items-center gap-1 bg-[#38bdf8]/15 border border-[#38bdf8]/30 text-[#38bdf8] text-xs font-semibold px-2 py-1 rounded-full"
                      >
                        {u.name}
                        <button
                          onClick={() => setSelectedUsers(s => s.filter(x => x.id !== u.id))}
                          className="hover:text-white transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 bg-white/[0.06] rounded-xl px-3 py-2 border border-white/[0.08]">
                  <Search size={13} className="text-slate-500 shrink-0" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Add people…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
                  />
                </div>
              </div>

              <div className="overflow-y-auto flex-1 px-1">
                {filteredUsers
                  .filter(u => !selectedUsers.find(s => s.id === u.id))
                  .map(user => (
                    <div
                      key={user.id}
                      onClick={() => setSelectedUsers(s => [...s, user])}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-white/[0.05] mx-1 mb-0.5 transition-all"
                    >
                      <Avatar photo={user.photo} name={user.name} size={32} />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">{user.name}</p>
                        {user.role && <p className="text-[11px] text-slate-500">{user.role}</p>}
                      </div>
                      <Check size={14} className="text-transparent" />
                    </div>
                  ))}
                <div className="h-2" />
              </div>

              <div className="px-3 pb-3 flex-shrink-0">
                <button
                  onClick={createGroup}
                  disabled={selectedUsers.length < 1}
                  className="w-full py-2.5 rounded-xl bg-[#38bdf8] text-white font-bold text-sm disabled:opacity-30 transition-all hover:bg-[#0ea5e9]"
                >
                  Create Group ({selectedUsers.length} {selectedUsers.length === 1 ? 'person' : 'people'})
                </button>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
