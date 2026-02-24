import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut, Plus, Edit2, Trash2, Check, X } from 'lucide-react';
import { User, SystemCard, Role, RolePermissions } from './types';
import { db, auth, firebaseConfig } from './firebase';
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
  addDoc, query, orderBy,
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';

interface SystemAdminPanelProps {
  currentUser: User;
  onBackToHub: () => void;
  onCardsChanged: () => void;
  onUsersChanged: () => void;
  onRolesChanged: () => void;
  onLogout: () => void;
  permissions: RolePermissions;
  roleColor: string;
}

const DEFAULT_PERMISSIONS: RolePermissions = {
  access_tracker: false, access_it_admin: false, view_all_projects: false,
  create_projects: false, edit_projects: false, view_workload: false, is_assignable: false,
};

const PERMISSION_LABELS: { key: keyof RolePermissions; label: string; desc: string }[] = [
  { key: 'access_tracker',    label: 'Access Tracker',    desc: 'Can open the Project Tracker' },
  { key: 'access_it_admin',   label: 'IT Admin Panel',    desc: 'Can manage system settings, roles & users' },
  { key: 'view_all_projects', label: 'View All Projects', desc: 'Sees every project, not just their own' },
  { key: 'create_projects',   label: 'Create Projects',   desc: 'Can add new projects to the tracker' },
  { key: 'edit_projects',     label: 'Edit Projects',     desc: 'Can edit project dates via drag or form' },
  { key: 'view_workload',     label: 'View Workload',     desc: 'Sees the workload chart by assignee' },
  { key: 'is_assignable',     label: 'Assignable',        desc: 'Appears in assignment dropdown & workload chart' },
];

const EMPTY_CARD_FORM = {
  title: '', description: '', icon: '', color_accent: '#00ffff',
  link: '', link_type: 'external' as 'internal' | 'external', is_active: true, is_view_only: false, sort_order: 0,
};
const EMPTY_USER_FORM = {
  name: '', role: '' as string,
  email: '', password: '', newPassword: '', photo: '',
};

export default function SystemAdminPanel({ currentUser, onBackToHub, onCardsChanged, onUsersChanged, onRolesChanged, onLogout, permissions, roleColor }: SystemAdminPanelProps) {
  // Guard
  if (!permissions.access_it_admin) { onBackToHub(); return null; }

  // ── System cards state ─────────────────────────────────────────
  const [cards,        setCards]        = useState<SystemCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [showCardForm, setShowCardForm] = useState(false);
  const [editingCard,  setEditingCard]  = useState<SystemCard | null>(null);
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [cardFormError,  setCardFormError]  = useState('');
  const [cardForm,     setCardForm]     = useState({ ...EMPTY_CARD_FORM });
  const [iconUploading,  setIconUploading]  = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  // ── User management state ──────────────────────────────────────
  const [users,        setUsers]        = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser,  setEditingUser]  = useState<User | null>(null);
  const [userSubmitting, setUserSubmitting] = useState(false);
  const [userFormError,  setUserFormError]  = useState('');
  const [userForm,     setUserForm]     = useState({ ...EMPTY_USER_FORM });

  // ── Roles state ────────────────────────────────────────────────
  const [roles,        setRoles]        = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole,  setEditingRole]  = useState<Role | null>(null);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleFormError,  setRoleFormError]  = useState('');
  const [roleForm, setRoleForm] = useState<{ name: string; color: string; permissions: RolePermissions }>({
    name: '', color: '#00ffff', permissions: { ...DEFAULT_PERMISSIONS },
  });

  // ── Helpers ────────────────────────────────────────────────────
  const isUrl = (s: string) => s.startsWith('http') || s.startsWith('data:');

  const compressToBase64 = (file: File, maxPx = 128): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = ev => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale  = Math.min(maxPx / img.width, maxPx / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png', 0.9));
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setCardFormError('Image must be under 2 MB.');
      e.target.value = '';
      return;
    }
    setIconUploading(true);
    setCardFormError('');
    try {
      const base64 = await compressToBase64(file);
      setCardForm(f => ({ ...f, icon: base64 }));
    } catch {
      setCardFormError('Failed to process image. Please try again.');
    } finally {
      setIconUploading(false);
      e.target.value = '';
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setUserFormError('Photo must be under 5 MB.');
      e.target.value = '';
      return;
    }
    setPhotoUploading(true);
    setUserFormError('');
    try {
      const base64 = await compressToBase64(file, 200);
      setUserForm(f => ({ ...f, photo: base64 }));
    } catch {
      setUserFormError('Failed to process photo. Please try again.');
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  // ── Fetch helpers ──────────────────────────────────────────────
  const fetchCards = async () => {
    const snap = await getDocs(query(collection(db, 'system_cards'), orderBy('sort_order')));
    setCards(snap.docs.map(d => ({ id: d.id, ...d.data() } as SystemCard)));
    setCardsLoading(false);
  };

  const fetchUsers = async () => {
    const snap = await getDocs(collection(db, 'users'));
    setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
    setUsersLoading(false);
  };

  const fetchRoles = async () => {
    const snap = await getDocs(collection(db, 'roles'));
    setRoles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Role)));
    setRolesLoading(false);
  };

  useEffect(() => { fetchCards(); fetchUsers(); fetchRoles(); }, []);

  // ── System card handlers ───────────────────────────────────────
  const openAddCard = () => { setEditingCard(null); setCardForm({ ...EMPTY_CARD_FORM }); setCardFormError(''); setShowCardForm(true); };
  const openEditCard = (card: SystemCard) => {
    setEditingCard(card);
    setCardForm({ title: card.title, description: card.description, icon: card.icon, color_accent: card.color_accent, link: card.link, link_type: card.link_type, is_active: card.is_active, is_view_only: card.is_view_only ?? false, sort_order: card.sort_order });
    setCardFormError(''); setShowCardForm(true);
  };

  const handleCardSubmit = async () => {
    if (!cardForm.title.trim() || !cardForm.description.trim() || !cardForm.icon.trim() || !cardForm.link.trim()) {
      setCardFormError('Title, description, icon, and link are required.'); return;
    }
    setCardSubmitting(true); setCardFormError('');
    try {
      if (editingCard) {
        await updateDoc(doc(db, 'system_cards', editingCard.id), cardForm);
      } else {
        await addDoc(collection(db, 'system_cards'), cardForm);
      }
      fetchCards(); onCardsChanged(); setShowCardForm(false);
    } catch { setCardFormError('Failed to save. Please try again.'); }
    finally { setCardSubmitting(false); }
  };

  const handleToggle = async (card: SystemCard) => {
    await updateDoc(doc(db, 'system_cards', card.id), { is_active: !card.is_active });
    fetchCards(); onCardsChanged();
  };

  const handleToggleViewOnly = async (card: SystemCard) => {
    await updateDoc(doc(db, 'system_cards', card.id), { is_view_only: !(card.is_view_only ?? false) });
    fetchCards(); onCardsChanged();
  };

  const handleDeleteCard = async (card: SystemCard) => {
    if (!window.confirm(`Delete "${card.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'system_cards', card.id));
    fetchCards(); onCardsChanged();
  };

  // ── User handlers ──────────────────────────────────────────────
  const openEditUser = (user: User) => {
    setEditingUser(user);
    setUserForm({ name: user.name, role: user.role as string, email: user.email || '', password: '', newPassword: '', photo: user.photo || '' });
    setUserFormError(''); setShowUserForm(true);
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ ...EMPTY_USER_FORM, role: roles[0]?.name ?? '' });
    setUserFormError(''); setShowUserForm(true);
  };

  const handleUserSubmit = async () => {
    if (!userForm.name.trim()) { setUserFormError('Name is required.'); return; }
    if (!editingUser && !userForm.email.trim()) { setUserFormError('Email is required for new users.'); return; }
    if (!editingUser && !userForm.password.trim()) { setUserFormError('Password is required for new users.'); return; }

    if (editingUser && userForm.newPassword && userForm.newPassword.length < 6) {
      setUserFormError('New password must be at least 6 characters.'); return;
    }

    setUserSubmitting(true); setUserFormError('');
    try {
      if (editingUser) {
        // Update Firestore profile
        await updateDoc(doc(db, 'users', editingUser.id), {
          name:  userForm.name.trim(),
          role:  userForm.role,
          email: userForm.email.trim(),
          photo: userForm.photo.trim() || null,
        });

        // Sync email and/or password to Firebase Auth via backend
        const emailChanged  = userForm.email.trim() !== (editingUser.email || '');
        const hasNewPassword = userForm.newPassword.trim().length > 0;
        if (emailChanged || hasNewPassword) {
          const payload: Record<string, string> = { uid: editingUser.id };
          if (emailChanged)   payload.email    = userForm.email.trim();
          if (hasNewPassword) payload.password = userForm.newPassword.trim();
          const resp = await fetch('/api/admin/update-user-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) {
            const data = await resp.json();
            setUserFormError(data.error ?? 'Failed to update login credentials.');
            setUserSubmitting(false); return;
          }
        }
      } else {
        // Create Firebase Auth account via a secondary app (no current session disruption)
        const secondaryApp  = initializeApp(firebaseConfig, `create-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, userForm.email.trim(), userForm.password);
          await setDoc(doc(db, 'users', cred.user.uid), {
            name:  userForm.name.trim(),
            role:  userForm.role,
            email: userForm.email.trim(),
            photo: userForm.photo.trim() || null,
          });
          await fbSignOut(secondaryAuth);
        } finally {
          await deleteApp(secondaryApp);
        }
      }
      fetchUsers(); onUsersChanged(); setShowUserForm(false);
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'auth/email-already-in-use') setUserFormError('That email is already registered.');
      else if (code === 'auth/weak-password')    setUserFormError('Password must be at least 6 characters.');
      else if (code === 'auth/invalid-email')    setUserFormError('Please enter a valid email address.');
      else setUserFormError('Failed to save. Please try again.');
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.id === currentUser.id) { alert("You can't delete your own account while logged in."); return; }
    if (!window.confirm(`Delete account "${user.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'users', user.id));
    // Note: Firebase Auth account remains; without a Firestore profile the user can't log in.
    fetchUsers(); onUsersChanged();
  };

  // ── Role handlers ──────────────────────────────────────────────
  const openAddRole = () => {
    setEditingRole(null);
    setRoleForm({ name: '', color: '#00ffff', permissions: { ...DEFAULT_PERMISSIONS } });
    setRoleFormError(''); setShowRoleForm(true);
  };

  const openEditRole = (role: Role) => {
    setEditingRole(role);
    setRoleForm({ name: role.name, color: role.color, permissions: { ...role.permissions } });
    setRoleFormError(''); setShowRoleForm(true);
  };

  const handleRoleSubmit = async () => {
    if (!roleForm.name.trim()) { setRoleFormError('Role name is required.'); return; }
    setRoleSubmitting(true); setRoleFormError('');
    try {
      if (editingRole) {
        await updateDoc(doc(db, 'roles', editingRole.id), { name: roleForm.name.trim(), color: roleForm.color, permissions: roleForm.permissions });
      } else {
        await addDoc(collection(db, 'roles'), { name: roleForm.name.trim(), color: roleForm.color, permissions: roleForm.permissions });
      }
      fetchRoles(); onRolesChanged(); setShowRoleForm(false);
    } catch { setRoleFormError('Failed to save. Please try again.'); }
    finally { setRoleSubmitting(false); }
  };

  const handleDeleteRole = async (role: Role) => {
    const usersWithRole = users.filter(u => u.role === role.name).length;
    if (usersWithRole > 0) {
      alert(`Cannot delete "${role.name}" — ${usersWithRole} user(s) still have this role. Reassign them first.`); return;
    }
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'roles', role.id));
    fetchRoles(); onRolesChanged();
  };

  // ── Shared styles ──────────────────────────────────────────────
  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all';
  const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5';
  const getRoleColor = (roleName: string) => roles.find(r => r.name === roleName)?.color
    ?? (roleName === 'Director' ? '#ff00ff' : roleName === 'IT Admin' ? '#a855f7' : '#00ffff');

  return (
    <div className="min-h-screen bg-[#0a0510] text-white">
      {/* Header */}
      <header className="h-16 border-b border-white/10 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-4">
          <button onClick={onBackToHub} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[#a855f7]/30 text-slate-400 hover:text-[#a855f7] transition-all text-xs font-bold">← Hub</button>
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#ff00ff] rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-pink-500/20">W</div>
          <h1 className="font-display text-base sm:text-xl font-bold tracking-tight" style={{ color: '#a855f7' }}>System Administration</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
            <Calendar size={16} className="text-[#00ffff]" />
            <span className="text-sm font-medium text-slate-300">{format(new Date(), 'EEEE, MMMM do yyyy')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full p-0.5" style={{ border: `2px solid ${roleColor}` }}>
              <img src={currentUser.photo || `https://picsum.photos/seed/${currentUser.id}/100/100`} className="w-full h-full rounded-full object-cover" alt="Profile" />
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-bold text-white leading-none">{currentUser.name}</p>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: roleColor }}>{currentUser.role}</p>
            </div>
            <button onClick={onLogout} title="Logout" className="ml-1 p-2 text-slate-500 hover:text-white transition-colors"><LogOut size={16} /></button>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-12 pb-nav md:pb-8">

        {/* ── System Cards ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>System Cards</h2>
              <p className="text-sm text-slate-400 mt-1">Manage the systems displayed on the hub for all users.</p>
            </div>
            <button onClick={openAddCard} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
              <Plus size={15} /> Add System
            </button>
          </div>
          <div className="glass-card rounded-[2rem] overflow-hidden border border-white/10">
            {cardsLoading ? (
              <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#a855f7]" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black border-b border-white/5">
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Order</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Icon</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Title</th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Description</th>
                      <th className="hidden md:table-cell px-3 sm:px-6 py-3 sm:py-4">Type</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Active</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">View Only</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {cards.map(card => (
                      <tr key={card.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4"><span className="text-xs font-mono text-slate-500">{card.sort_order}</span></td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center overflow-hidden" style={{ backgroundColor: card.color_accent + '25', border: `1px solid ${card.color_accent}40` }}>
                            {isUrl(card.icon)
                              ? <img src={card.icon} className="w-5 h-5 sm:w-6 sm:h-6 object-contain" alt={card.title} />
                              : <span className="text-base sm:text-lg">{card.icon}</span>
                            }
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4"><span className="text-sm font-bold text-white">{card.title}</span></td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4 max-w-[180px]"><span className="text-xs text-slate-400 truncate block">{card.description}</span></td>
                        <td className="hidden md:table-cell px-3 sm:px-6 py-3 sm:py-4">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${card.link_type === 'internal' ? 'text-[#00ffff] border-[#00ffff]/30 bg-[#00ffff]/10' : 'text-slate-400 border-slate-400/20 bg-slate-400/5'}`}>{card.link_type}</span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <button onClick={() => handleToggle(card)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${card.is_active ? 'bg-[#a855f7]' : 'bg-white/10'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${card.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <button onClick={() => handleToggleViewOnly(card)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${card.is_view_only ? 'bg-[#ffd700]' : 'bg-white/10'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${card.is_view_only ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditCard(card)} className="p-1.5 text-slate-500 hover:text-[#a855f7] transition-colors rounded-lg hover:bg-[#a855f7]/10"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteCard(card)} className="p-1.5 text-slate-500 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {cards.length === 0 && <tr><td colSpan={8} className="text-center py-16 text-slate-600 italic text-sm">No systems yet. Click "Add System" to create one.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Roles & Permissions ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>Roles &amp; Permissions</h2>
              <p className="text-sm text-slate-400 mt-1">Define roles and configure what each role can access.</p>
            </div>
            <button onClick={openAddRole} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
              <Plus size={15} /> Add Role
            </button>
          </div>
          <div className="glass-card rounded-[2rem] overflow-hidden border border-white/10">
            {rolesLoading ? (
              <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#a855f7]" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black border-b border-white/5">
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Role Name</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Color</th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Permissions</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {roles.map(role => (
                      <tr key={role.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <span className="text-sm font-bold" style={{ color: role.color }}>{role.name}</span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full border border-white/20 flex-shrink-0" style={{ backgroundColor: role.color }} />
                            <span className="hidden sm:inline text-xs font-mono text-slate-500">{role.color}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex flex-wrap gap-1">
                            {PERMISSION_LABELS.filter(p => role.permissions[p.key]).map(p => (
                              <span key={p.key} className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-400">
                                {p.label}
                              </span>
                            ))}
                            {PERMISSION_LABELS.filter(p => role.permissions[p.key]).length === 0 && (
                              <span className="text-[10px] text-slate-600 italic">No permissions</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditRole(role)} className="p-1.5 text-slate-500 hover:text-[#a855f7] transition-colors rounded-lg hover:bg-[#a855f7]/10"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteRole(role)} className="p-1.5 text-slate-500 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {roles.length === 0 && <tr><td colSpan={4} className="text-center py-16 text-slate-600 italic text-sm">No roles yet. Click "Add Role" to create one.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── User Accounts ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>User Accounts</h2>
              <p className="text-sm text-slate-400 mt-1">Create, rename, and manage all user accounts.</p>
            </div>
            <button onClick={openAddUser} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
              <Plus size={15} /> Add User
            </button>
          </div>
          <div className="glass-card rounded-[2rem] overflow-hidden border border-white/10">
            {usersLoading ? (
              <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#a855f7]" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black border-b border-white/5">
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Photo</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Name</th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Email</th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Role</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden" style={{ border: `2px solid ${getRoleColor(user.role)}40` }}>
                            <img src={user.photo || `https://picsum.photos/seed/${user.id}/100/100`} className="w-full h-full object-cover" alt={user.name} />
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">{user.name}</span>
                              {user.id === currentUser.id && <span className="text-[9px] font-black uppercase tracking-widest text-[#a855f7] bg-[#a855f7]/10 border border-[#a855f7]/30 px-1.5 py-0.5 rounded-full">You</span>}
                            </div>
                            {/* Show role inline on mobile since role column is hidden */}
                            <span className="sm:hidden text-[9px] font-black uppercase tracking-widest" style={{ color: getRoleColor(user.role) }}>{user.role}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4"><span className="text-xs text-slate-400">{user.email}</span></td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">
                          <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border"
                            style={{ color: getRoleColor(user.role), borderColor: getRoleColor(user.role) + '40', backgroundColor: getRoleColor(user.role) + '12' }}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditUser(user)} className="p-1.5 text-slate-500 hover:text-[#a855f7] transition-colors rounded-lg hover:bg-[#a855f7]/10"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteUser(user)} disabled={user.id === currentUser.id}
                              className="p-1.5 text-slate-500 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && <tr><td colSpan={5} className="text-center py-16 text-slate-600 italic text-sm">No users found.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── System Card Modal ── */}
      {showCardForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowCardForm(false)}>
          <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl" style={{ boxShadow: '0 0 60px rgba(168,85,247,0.15)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-white/5">
              <h3 className="text-lg font-bold text-white">{editingCard ? 'Edit System' : 'Add New System'}</h3>
              <button onClick={() => setShowCardForm(false)} className="p-1.5 text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5 max-h-[70vh] overflow-y-auto">
              <div><label className={labelCls}>Title</label><input type="text" className={inputCls} placeholder="e.g. Project Tracker" value={cardForm.title} onChange={e => setCardForm(f => ({ ...f, title: e.target.value }))} /></div>
              <div><label className={labelCls}>Description</label><textarea rows={3} className={inputCls + ' resize-none'} placeholder="Brief description…" value={cardForm.description} onChange={e => setCardForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Icon field — emoji or uploaded image */}
                <div>
                  <label className={labelCls}>Icon</label>
                  {/* Live preview */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
                      style={{ backgroundColor: cardForm.color_accent + '20', border: `1px solid ${cardForm.color_accent}40` }}>
                      {cardForm.icon
                        ? isUrl(cardForm.icon)
                          ? <img src={cardForm.icon} className="w-8 h-8 object-contain" alt="icon preview" />
                          : <span className="text-2xl">{cardForm.icon}</span>
                        : <span className="text-slate-600 text-xs">none</span>
                      }
                    </div>
                    {isUrl(cardForm.icon) && (
                      <button type="button" onClick={() => setCardForm(f => ({ ...f, icon: '' }))}
                        className="text-xs text-slate-500 hover:text-[#ff4d4d] transition-colors font-semibold">
                        × Clear
                      </button>
                    )}
                  </div>
                  {/* Emoji text input */}
                  <input type="text" className={inputCls} placeholder="📋 type an emoji"
                    value={isUrl(cardForm.icon) ? '' : cardForm.icon}
                    onChange={e => setCardForm(f => ({ ...f, icon: e.target.value }))}
                    disabled={isUrl(cardForm.icon)}
                  />
                  {/* Upload button */}
                  <label className={`mt-2 flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed cursor-pointer transition-all text-xs font-semibold
                    ${iconUploading ? 'opacity-50 cursor-wait border-white/10 text-slate-600' : 'border-white/20 hover:border-[#a855f7]/50 text-slate-500 hover:text-[#a855f7]'}`}>
                    {iconUploading
                      ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin block" /> Processing…</>
                      : <>↑ Upload image</>
                    }
                    <input type="file" accept="image/*" className="hidden" disabled={iconUploading} onChange={handleIconUpload} />
                  </label>
                </div>
                <div>
                  <label className={labelCls}>Color Accent</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={cardForm.color_accent} onChange={e => setCardForm(f => ({ ...f, color_accent: e.target.value }))} className="w-10 h-10 rounded-xl border border-white/10 cursor-pointer bg-transparent p-0.5 flex-shrink-0" />
                    <input type="text" className={inputCls} value={cardForm.color_accent} onChange={e => setCardForm(f => ({ ...f, color_accent: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div><label className={labelCls}>Link</label><input type="text" className={inputCls} placeholder="URL or internal key (e.g. tracker)" value={cardForm.link} onChange={e => setCardForm(f => ({ ...f, link: e.target.value }))} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Link Type</label>
                  <select className={inputCls} value={cardForm.link_type} onChange={e => setCardForm(f => ({ ...f, link_type: e.target.value as 'internal' | 'external' }))}>
                    <option value="external">External (new tab)</option><option value="internal">Internal (in app)</option>
                  </select>
                </div>
                <div><label className={labelCls}>Sort Order</label><input type="number" className={inputCls} min={0} value={cardForm.sort_order} onChange={e => setCardForm(f => ({ ...f, sort_order: Number(e.target.value) }))} /></div>
              </div>
              <div>
                <label className={labelCls}>Visibility</label>
                <button type="button" onClick={() => setCardForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${cardForm.is_active ? 'border-[#a855f7]/40 bg-[#a855f7]/10' : 'border-white/10 bg-white/5'}`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${cardForm.is_active ? 'bg-[#a855f7] border-[#a855f7]' : 'border-white/20'}`}>
                    {cardForm.is_active && <Check size={11} className="text-white" />}
                  </div>
                  <span className="text-sm text-slate-300 font-medium">Active — visible on the hub</span>
                </button>
              </div>
              <div>
                <label className={labelCls}>Access Mode</label>
                <button type="button" onClick={() => setCardForm(f => ({ ...f, is_view_only: !f.is_view_only }))}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${cardForm.is_view_only ? 'border-[#ffd700]/40 bg-[#ffd700]/10' : 'border-white/10 bg-white/5'}`}>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${cardForm.is_view_only ? 'bg-[#ffd700] border-[#ffd700]' : 'border-white/20'}`}>
                    {cardForm.is_view_only && <Check size={11} className="text-[#0a0510]" />}
                  </div>
                  <div>
                    <span className="text-sm text-slate-300 font-medium">View Only — others can open but not edit</span>
                    <p className="text-[10px] text-slate-500 leading-tight">IT Admins are always exempt from this restriction.</p>
                  </div>
                </button>
              </div>
              {cardFormError && <p className="text-[11px] text-[#ff4d4d] font-semibold">{cardFormError}</p>}
            </div>
            <div className="flex gap-3 px-4 sm:px-8 py-4 sm:py-5 border-t border-white/5">
              <button onClick={() => setShowCardForm(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
              <button onClick={handleCardSubmit} disabled={cardSubmitting} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
                {cardSubmitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : editingCard ? 'Save Changes' : 'Create System'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Role Modal ── */}
      {showRoleForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowRoleForm(false)}>
          <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl" style={{ boxShadow: '0 0 60px rgba(168,85,247,0.15)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-white/5">
              <h3 className="text-lg font-bold text-white">{editingRole ? 'Edit Role' : 'Add New Role'}</h3>
              <button onClick={() => setShowRoleForm(false)} className="p-1.5 text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className={labelCls}>Role Name</label>
                <input type="text" className={inputCls} placeholder="e.g. Manager" value={roleForm.name} onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              {/* Color */}
              <div>
                <label className={labelCls}>Color Accent</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={roleForm.color} onChange={e => setRoleForm(f => ({ ...f, color: e.target.value }))} className="w-10 h-10 rounded-xl border border-white/10 cursor-pointer bg-transparent p-0.5 flex-shrink-0" />
                  <input type="text" className={inputCls} value={roleForm.color} onChange={e => setRoleForm(f => ({ ...f, color: e.target.value }))} placeholder="#00ffff" />
                </div>
              </div>
              {/* Permissions */}
              <div>
                <label className={labelCls}>Permissions</label>
                <div className="space-y-2">
                  {PERMISSION_LABELS.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setRoleForm(f => ({ ...f, permissions: { ...f.permissions, [p.key]: !f.permissions[p.key] } }))}
                      className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl border transition-all text-left ${roleForm.permissions[p.key] ? 'border-[#a855f7]/40 bg-[#a855f7]/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${roleForm.permissions[p.key] ? 'bg-[#a855f7] border-[#a855f7]' : 'border-white/20'}`}>
                        {roleForm.permissions[p.key] && <Check size={11} className="text-white" />}
                      </div>
                      <div>
                        <div className="text-sm text-white font-semibold leading-tight">{p.label}</div>
                        <div className="text-[10px] text-slate-500 leading-tight">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {roleFormError && <p className="text-[11px] text-[#ff4d4d] font-semibold">{roleFormError}</p>}
            </div>
            <div className="flex gap-3 px-4 sm:px-8 py-4 sm:py-5 border-t border-white/5">
              <button onClick={() => setShowRoleForm(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
              <button onClick={handleRoleSubmit} disabled={roleSubmitting} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
                {roleSubmitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : editingRole ? 'Save Changes' : 'Create Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── User Modal ── */}
      {showUserForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowUserForm(false)}>
          <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-md shadow-2xl" style={{ boxShadow: '0 0 60px rgba(168,85,247,0.15)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-white/5">
              <h3 className="text-lg font-bold text-white">{editingUser ? 'Edit User' : 'Add New User'}</h3>
              <button onClick={() => setShowUserForm(false)} className="p-1.5 text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Photo upload */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full overflow-hidden" style={{ border: `2px solid ${getRoleColor(userForm.role)}` }}>
                    <img
                      src={userForm.photo || `https://picsum.photos/seed/${editingUser?.id ?? 'new'}/100/100`}
                      className="w-full h-full object-cover"
                      alt="Preview"
                      onError={e => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${editingUser?.id ?? 'new'}/100/100`; }}
                    />
                  </div>
                  {/* Camera overlay button */}
                  <label className={`absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-colors text-white text-xs
                    ${photoUploading ? 'opacity-50 cursor-wait bg-slate-600' : 'bg-[#a855f7] hover:bg-[#9333ea]'}`}
                    title="Upload photo">
                    {photoUploading
                      ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin block" />
                      : '📷'
                    }
                    <input type="file" accept="image/*" className="hidden" disabled={photoUploading} onChange={handlePhotoUpload} />
                  </label>
                </div>
                {userForm.photo && (
                  <button type="button" onClick={() => setUserForm(f => ({ ...f, photo: '' }))}
                    className="text-[10px] text-slate-600 hover:text-[#ff4d4d] transition-colors">
                    × Clear photo
                  </button>
                )}
              </div>

              <div>
                <label className={labelCls}>Full Name</label>
                <input type="text" className={inputCls} placeholder="e.g. Jane Smith" value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              <div>
                <label className={labelCls}>Role</label>
                <select className={inputCls} value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="" disabled>Select a role…</option>
                  {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>

              <div>
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} placeholder="user@company.com" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} />
                {editingUser && (
                  <p className="text-[10px] text-slate-500 mt-1">This email is used as the login credential.</p>
                )}
              </div>

              {/* Password: required for new users, optional (change) for existing */}
              {!editingUser ? (
                <div>
                  <label className={labelCls}>Password</label>
                  <input type="password" className={inputCls} placeholder="Min. 6 characters" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} />
                </div>
              ) : (
                <div>
                  <label className={labelCls}>New Password</label>
                  <input type="password" className={inputCls} placeholder="Leave blank to keep current" value={userForm.newPassword} onChange={e => setUserForm(f => ({ ...f, newPassword: e.target.value }))} />
                  <p className="text-[10px] text-slate-600 mt-1">Only fill this in if you want to change the password.</p>
                </div>
              )}

              {userFormError && <p className="text-[11px] text-[#ff4d4d] font-semibold">{userFormError}</p>}
            </div>
            <div className="flex gap-3 px-4 sm:px-8 py-4 sm:py-5 border-t border-white/5">
              <button onClick={() => setShowUserForm(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
              <button onClick={handleUserSubmit} disabled={userSubmitting} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
                {userSubmitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : editingUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
