import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, ExternalLink, Pencil, Trash2, X, Check, Link as LinkIcon, FileText, LogOut } from 'lucide-react';
import { User, AppView, RolePermissions } from './types';
import { db } from './firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy,
} from 'firebase/firestore';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MCItem {
  id: string;
  label: string;
  url?: string;
  type: 'link' | 'note';
  order: number;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface ManagementCouncilProps {
  currentUser: User;
  onBackToHub: () => void;
  onLogout: () => void;
  roleColor: string;
  permissions: RolePermissions;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ManagementCouncil({
  currentUser, onBackToHub, onLogout, roleColor, permissions,
}: ManagementCouncilProps) {
  const [users,   setUsers]   = useState<User[]>([]);
  const [items,   setItems]   = useState<Record<string, MCItem[]>>({});
  const [loading, setLoading] = useState(true);

  // Can the current user edit? Director or IT Admin only.
  const canEdit = permissions.access_it_admin || permissions.view_all_projects;

  // ── Add state ──────────────────────────────────────────────────────────────
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newLabel,  setNewLabel]  = useState('');
  const [newUrl,    setNewUrl]    = useState('');
  const [newType,   setNewType]   = useState<'link' | 'note'>('link');

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editingItem, setEditingItem] = useState<{ userId: string; item: MCItem } | null>(null);
  const [editLabel,   setEditLabel]   = useState('');
  const [editUrl,     setEditUrl]     = useState('');

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const snap  = await getDocs(collection(db, 'users'));
    const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as User))
                            .sort((a, b) => a.name.localeCompare(b.name));
    setUsers(loaded);

    const allItems: Record<string, MCItem[]> = {};
    await Promise.all(loaded.map(async (u) => {
      try {
        const q     = query(collection(db, 'management_council', u.id, 'items'), orderBy('order'));
        const iSnap = await getDocs(q);
        allItems[u.id] = iSnap.docs.map(d => ({ id: d.id, ...d.data() } as MCItem));
      } catch {
        allItems[u.id] = [];
      }
    }));
    setItems(allItems);
    setLoading(false);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  async function addItem(userId: string) {
    if (!newLabel.trim()) return;
    const existing = items[userId] || [];
    const payload  = {
      label: newLabel.trim(),
      url:   newType === 'link' ? newUrl.trim() : '',
      type:  newType,
      order: existing.length,
    };
    const ref = await addDoc(collection(db, 'management_council', userId, 'items'), payload);
    setItems(prev => ({ ...prev, [userId]: [...(prev[userId] || []), { id: ref.id, ...payload }] }));
    setNewLabel(''); setNewUrl(''); setNewType('link'); setAddingFor(null);
  }

  async function saveEdit(userId: string, itemId: string) {
    if (!editLabel.trim()) return;
    await updateDoc(doc(db, 'management_council', userId, 'items', itemId), {
      label: editLabel.trim(),
      url:   editUrl.trim(),
    });
    setItems(prev => ({
      ...prev,
      [userId]: (prev[userId] || []).map(i =>
        i.id === itemId ? { ...i, label: editLabel.trim(), url: editUrl.trim() } : i
      ),
    }));
    setEditingItem(null);
  }

  async function removeItem(userId: string, itemId: string) {
    await deleteDoc(doc(db, 'management_council', userId, 'items', itemId));
    setItems(prev => ({ ...prev, [userId]: (prev[userId] || []).filter(i => i.id !== itemId) }));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans">

      {/* Header */}
      <header className="h-16 border-b border-white/10 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHub}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all text-xs font-bold shrink-0"
          >
            <ArrowLeft size={14} /> Hub
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏛️</span>
            <h1 className="text-lg font-bold tracking-tight text-white">Management Council</h1>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-red-500/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 transition-all text-xs font-bold"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </header>

      {/* Body */}
      <div className="p-4 sm:p-8 overflow-x-auto pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No users found.</div>
        ) : (
          <div className="flex gap-4 min-w-max items-start">
            {users.map(user => (
              <UserPanel
                key={user.id}
                user={user}
                userItems={items[user.id] || []}
                canEdit={canEdit}
                // add
                addingFor={addingFor}
                setAddingFor={setAddingFor}
                newLabel={newLabel}
                setNewLabel={setNewLabel}
                newUrl={newUrl}
                setNewUrl={setNewUrl}
                newType={newType}
                setNewType={setNewType}
                onAdd={addItem}
                // edit
                editingItem={editingItem}
                setEditingItem={(v) => { setEditingItem(v); if (v) { setEditLabel(v.item.label); setEditUrl(v.item.url || ''); } }}
                editLabel={editLabel}
                setEditLabel={setEditLabel}
                editUrl={editUrl}
                setEditUrl={setEditUrl}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditingItem(null)}
                // delete
                onDelete={removeItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── User Panel ─────────────────────────────────────────────────────────────────

interface UserPanelProps {
  user: User;
  userItems: MCItem[];
  canEdit: boolean;
  addingFor: string | null;
  setAddingFor: (v: string | null) => void;
  newLabel: string; setNewLabel: (v: string) => void;
  newUrl: string;   setNewUrl:   (v: string) => void;
  newType: 'link' | 'note'; setNewType: (v: 'link' | 'note') => void;
  onAdd: (userId: string) => void;
  editingItem: { userId: string; item: MCItem } | null;
  setEditingItem: (v: { userId: string; item: MCItem } | null) => void;
  editLabel: string; setEditLabel: (v: string) => void;
  editUrl: string;   setEditUrl:   (v: string) => void;
  onSaveEdit: (userId: string, itemId: string) => void;
  onCancelEdit: () => void;
  onDelete: (userId: string, itemId: string) => void;
}

function UserPanel({
  user, userItems, canEdit,
  addingFor, setAddingFor, newLabel, setNewLabel, newUrl, setNewUrl, newType, setNewType, onAdd,
  editingItem, setEditingItem, editLabel, setEditLabel, editUrl, setEditUrl, onSaveEdit, onCancelEdit,
  onDelete,
}: UserPanelProps) {
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const isAddingHere = addingFor === user.id;

  // Subtle top border accent color based on role (reuse a palette)
  const accentColors: Record<string, string> = {
    Director: '#ff00ff', 'IT Admin': '#a855f7', Admin: '#00ffff',
  };
  const accent = accentColors[user.role] ?? '#ffd700';

  return (
    <div
      className="w-64 flex-shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] flex flex-col overflow-hidden"
      style={{ borderTop: `2px solid ${accent}` }}
    >
      {/* User header */}
      <div className="p-4 flex items-center gap-3 border-b border-white/10">
        {user.photo ? (
          <img src={user.photo} alt={user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: `${accent}22`, color: accent }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-bold text-white text-sm truncate">{user.name}</p>
          <p className="text-xs truncate" style={{ color: accent }}>{user.role}</p>
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 p-3 space-y-1.5">
        {userItems.length === 0 && !isAddingHere && (
          <p className="text-xs text-slate-600 italic text-center py-3">No items yet</p>
        )}

        {userItems.map(item => {
          const isEditing = editingItem?.item.id === item.id && editingItem.userId === user.id;

          if (isEditing) {
            return (
              <div key={item.id} className="rounded-xl border border-white/20 bg-white/5 p-2.5 space-y-2">
                <input
                  value={editLabel}
                  onChange={e => setEditLabel(e.target.value)}
                  className="w-full bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-white/30"
                  placeholder="Label"
                  autoFocus
                />
                {item.type === 'link' && (
                  <input
                    value={editUrl}
                    onChange={e => setEditUrl(e.target.value)}
                    className="w-full bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-white/30"
                    placeholder="https://…"
                  />
                )}
                <div className="flex gap-1">
                  <button
                    onClick={() => onSaveEdit(user.id, item.id)}
                    className="flex-1 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-1"
                  >
                    <Check size={10} /> Save
                  </button>
                  <button
                    onClick={onCancelEdit}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs hover:bg-white/10 transition-all"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/5 transition-all"
            >
              <span className="text-slate-500 shrink-0">
                {item.type === 'link' ? <LinkIcon size={11} /> : <FileText size={11} />}
              </span>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-xs text-[#00ffff] hover:underline truncate flex items-center gap-1 min-w-0"
                >
                  <span className="truncate">{item.label}</span>
                  <ExternalLink size={9} className="shrink-0 opacity-60" />
                </a>
              ) : (
                <span className="flex-1 text-xs text-slate-300 truncate">{item.label}</span>
              )}
              {canEdit && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button
                    onClick={() => setEditingItem({ userId: user.id, item })}
                    className="p-1 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all"
                    title="Edit"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    onClick={() => onDelete(user.id, item.id)}
                    className="p-1 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Add form */}
        {isAddingHere ? (
          <div className="rounded-xl border border-white/20 bg-white/5 p-3 space-y-2 mt-2">
            {/* Type selector */}
            <div className="flex gap-1">
              <button
                onClick={() => setNewType('link')}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all border ${
                  newType === 'link'
                    ? 'bg-[#00ffff]/15 text-[#00ffff] border-[#00ffff]/30'
                    : 'bg-white/5 text-slate-500 border-white/10 hover:border-white/20'
                }`}
              >
                🔗 Link
              </button>
              <button
                onClick={() => setNewType('note')}
                className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all border ${
                  newType === 'note'
                    ? 'bg-[#ffd700]/15 text-[#ffd700] border-[#ffd700]/30'
                    : 'bg-white/5 text-slate-500 border-white/10 hover:border-white/20'
                }`}
              >
                📝 Note
              </button>
            </div>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              className="w-full bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-white/30 placeholder:text-slate-600"
              placeholder="Label / Title"
              autoFocus
            />
            {newType === 'link' && (
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                className="w-full bg-white/10 rounded-lg px-2 py-1.5 text-xs text-white border border-white/10 focus:outline-none focus:border-white/30 placeholder:text-slate-600"
                placeholder="https://…"
                onKeyDown={e => e.key === 'Enter' && onAdd(user.id)}
              />
            )}
            <div className="flex gap-1">
              <button
                onClick={() => onAdd(user.id)}
                className="flex-1 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-1"
              >
                <Check size={10} /> Add
              </button>
              <button
                onClick={() => { setAddingFor(null); setNewLabel(''); setNewUrl(''); setNewType('link'); }}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-400 text-xs hover:bg-white/10 transition-all"
              >
                <X size={10} />
              </button>
            </div>
          </div>
        ) : canEdit ? (
          <button
            onClick={() => setAddingFor(user.id)}
            className="w-full mt-1 py-2 rounded-xl border border-dashed border-white/15 text-slate-600 hover:text-slate-400 hover:border-white/25 transition-all text-xs flex items-center justify-center gap-1.5"
          >
            <Plus size={11} /> Add item
          </button>
        ) : null}
      </div>
    </div>
  );
}
