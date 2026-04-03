import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut, Plus, Edit2, Trash2, Check, X, Upload, Image, Film } from 'lucide-react';
import { User, SystemCard, Role, RolePermissions } from './types';
import { db, auth, storage, firebaseConfig } from './firebase';
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc,
  addDoc, query, orderBy, onSnapshot, serverTimestamp, where,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
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
  manage_policies: false, edit_directory: false, edit_org_chart: false,
};

const PERMISSION_LABELS: { key: keyof RolePermissions; label: string; desc: string }[] = [
  { key: 'access_tracker',    label: 'Access Tracker',    desc: 'Can open the Project Tracker' },
  { key: 'access_it_admin',   label: 'IT Admin Panel',    desc: 'Can manage system settings, roles & users' },
  { key: 'view_all_projects', label: 'View All Projects', desc: 'Sees every project, not just their own' },
  { key: 'create_projects',   label: 'Create Projects',   desc: 'Can add new projects to the tracker' },
  { key: 'edit_projects',     label: 'Edit Projects',     desc: 'Can edit project dates via drag or form' },
  { key: 'view_workload',     label: 'View Workload',     desc: 'Sees the workload chart by assignee' },
  { key: 'is_assignable',     label: 'Assignable',        desc: 'Appears in assignment dropdown & workload chart' },
  { key: 'manage_policies',   label: 'Manage Policies',   desc: 'Can create, edit, and delete policy documents' },
  { key: 'edit_directory',    label: 'Edit Directory',    desc: 'Can edit staff entries in the Directory' },
  { key: 'edit_org_chart',    label: 'Edit Org Chart',    desc: 'Can edit and rearrange the Organizational Chart' },
];

const EMPTY_CARD_FORM = {
  title: '', description: '', icon: '', color_accent: '#00ffff',
  link: '', link_type: 'external' as 'internal' | 'external', is_active: true, is_view_only: false, sort_order: 0,
};
const EMPTY_USER_FORM = {
  name: '', role: '' as string,
  email: '', password: '', newPassword: '', photo: '',
};

interface WorkerRecord { id: string; workerId: string; name: string; role: string; email?: string; phone?: string; notes?: string; }
const EMPTY_WORKER_FORM = { workerId: '', name: '', role: '', email: '' };

const TONE_CATEGORY: Record<string, string> = {
  blue: 'Leadership', red: 'Kitchen', green: 'Pantry', purple: 'Student',
};
const TONE_ORDER = ['blue', 'red', 'green', 'purple'];

export default function SystemAdminPanel({ currentUser, onBackToHub, onCardsChanged, onUsersChanged, onRolesChanged, onLogout, permissions, roleColor }: SystemAdminPanelProps) {
  // Guard
  if (!permissions.access_it_admin) { onBackToHub(); return null; }

  // ── CCBL Media state ───────────────────────────────────────────
  type StorageFile = { storagePath: string; name: string; url: string; type: 'photo' | 'video' };
  type CcblPublished = { id: string; storagePath: string; url: string; type: 'photo' | 'video'; name: string };
  const [storageFiles,   setStorageFiles]   = useState<StorageFile[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [published,      setPublished]      = useState<CcblPublished[]>([]);
  const [toggling,       setToggling]       = useState<string | null>(null);
  const [ccblUploading,  setCcblUploading]  = useState(false);
  const [ccblUploadPct,  setCcblUploadPct]  = useState(0);
  const [ccblOpen,       setCcblOpen]       = useState(false);
  const ccblInputRef = useRef<HTMLInputElement>(null);

  // ── CCBL Apprentices state ─────────────────────────────────────
  type CcblApprentice = { id: string; name: string; role?: string; sortOrder: number };
  type CcblApprenticMedia = { id: string; apprenticeId: string; url: string; storagePath?: string; type: 'photo' | 'video'; name: string };
  const [apprentices, setApprentices] = useState<CcblApprentice[]>([]);
  const [apprenticesOpen, setApprenticesOpen] = useState(false);
  const [selectedApprentice, setSelectedApprentice] = useState<CcblApprentice | null>(null);
  const [apprenticeMedia, setApprenticeMedia] = useState<CcblApprenticMedia[]>([]);
  const [apprenticeForm, setApprenticeForm] = useState({ name: '', role: '' });
  const [apprenticeUploading, setApprenticeUploading] = useState(false);
  const apprenticeInputRef = useRef<HTMLInputElement>(null);

  // ── Page visibility state ─────────────────────────────────────
  const [pageVisibility, setPageVisibility] = useState<Record<string, boolean>>({});
  const [pageVisTogglingKey, setPageVisTogglingKey] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'pageVisibility')).then(snap => {
      if (snap.exists()) setPageVisibility(snap.data() as Record<string, boolean>);
    });
  }, []);

  const togglePageVisibility = async (key: string, current: boolean) => {
    setPageVisTogglingKey(key);
    const next = !current;
    await setDoc(doc(db, 'settings', 'pageVisibility'), { [key]: next }, { merge: true });
    setPageVisibility(prev => ({ ...prev, [key]: next }));
    setPageVisTogglingKey(null);
  };

  // ── Directory Gallery state ────────────────────────────────────
  type DirGalleryItem = { id: string; storagePath: string; url: string; type: 'photo' | 'video'; name: string; row: 1 | 2 };
  const [dirGallery,    setDirGallery]    = useState<DirGalleryItem[]>([]);
  const [dirGalleryOpen, setDirGalleryOpen] = useState(false);
  const [dirUploading,  setDirUploading]  = useState(false);
  const [dirUploadPct,  setDirUploadPct]  = useState(0);
  const [dirUploadRow,  setDirUploadRow]  = useState<1 | 2>(1);
  const dirInputRef = useRef<HTMLInputElement>(null);

  // Listen to published items
  useEffect(() => {
    const q = query(collection(db, 'ccbl_media'), orderBy('uploadedAt', 'desc'));
    return onSnapshot(q, snap => setPublished(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblPublished))));
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_apprentices'), orderBy('sortOrder'));
    return onSnapshot(q, snap => setApprentices(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprentice))));
  }, []);

  useEffect(() => {
    if (!selectedApprentice) { setApprenticeMedia([]); return; }
    const q = query(collection(db, 'ccbl_apprentice_media'), where('apprenticeId', '==', selectedApprentice.id));
    return onSnapshot(q, snap => setApprenticeMedia(snap.docs.map(d => ({ id: d.id, ...d.data() } as CcblApprenticMedia))));
  }, [selectedApprentice]);

  // List all files in storage ccbl/ folder
  const loadStorageFiles = async () => {
    setStorageLoading(true);
    try {
      const { listAll } = await import('firebase/storage');
      const listRef = ref(storage, 'CCBL');
      const res = await listAll(listRef);
      const files = await Promise.all(res.items.map(async item => {
        const url = await getDownloadURL(item);
        const name = item.name;
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        const type: 'photo' | 'video' = ['mp4', 'mov', 'webm', 'avi', 'm4v'].includes(ext) ? 'video' : 'photo';
        return { storagePath: item.fullPath, name, url, type };
      }));
      setStorageFiles(files);
    } catch { alert('Could not load Storage files. Make sure the CCBL/ folder exists.'); }
    setStorageLoading(false);
  };

  useEffect(() => { if (ccblOpen && storageFiles.length === 0) loadStorageFiles(); }, [ccblOpen]);

  useEffect(() => {
    const q = query(collection(db, 'directory_gallery'), orderBy('uploadedAt', 'asc'));
    return onSnapshot(q, snap => setDirGallery(snap.docs.map(d => ({ id: d.id, ...d.data() } as DirGalleryItem))));
  }, []);

  const isPublished = (storagePath: string) => published.some(p => p.storagePath === storagePath);

  const togglePublish = async (file: StorageFile) => {
    setToggling(file.storagePath);
    try {
      const existing = published.find(p => p.storagePath === file.storagePath);
      if (existing) {
        await deleteDoc(doc(db, 'ccbl_media', existing.id));
      } else {
        await addDoc(collection(db, 'ccbl_media'), {
          storagePath: file.storagePath, url: file.url,
          name: file.name, type: file.type,
          uploadedAt: serverTimestamp(),
        });
      }
    } finally {
      setToggling(null);
    }
  };

  const compressImage = (file: File, maxPx: number, quality: number): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        const ratio = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('img failed to load')); };
      img.src = blobUrl;
    });

  const handleDirUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('image/')
    );
    if (!files.length) return;
    setDirUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isPhoto = file.type.startsWith('image/');
        const baseName = file.name.replace(/\.[^.]+$/, '');
        let blob: Blob = file;
        let ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        if (isPhoto) {
          try { blob = await compressImage(file, 1200, 0.85); ext = 'jpg'; } catch {}
        }
        const storagePath = `DirectoryGallery/${Date.now()}_${baseName}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef, blob, { contentType: isPhoto ? 'image/jpeg' : file.type });
          task.on('state_changed',
            snap => setDirUploadPct(Math.round(((i + snap.bytesTransferred / snap.totalBytes) / files.length) * 100)),
            reject, resolve,
          );
        });
        const url = await getDownloadURL(storageRef);
        await addDoc(collection(db, 'directory_gallery'), {
          storagePath, url,
          type: isPhoto ? 'photo' : 'video',
          name: file.name,
          row: dirUploadRow,
          uploadedAt: serverTimestamp(),
        });
      }
    } catch (err: any) {
      alert(`Upload failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setDirUploading(false);
      setDirUploadPct(0);
      if (dirInputRef.current) dirInputRef.current.value = '';
    }
  };

  const handleDirDelete = async (item: DirGalleryItem) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try { await deleteObject(ref(storage, item.storagePath)); } catch {}
    await deleteDoc(doc(db, 'directory_gallery', item.id));
  };

  const handleCcblUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('image/')
    );
    if (!files.length) return;

    // Reject duplicates: compare base name (strip timestamp prefix) against existing files
    const existingBaseNames = new Set(
      storageFiles.map(f => f.name.replace(/^\d+_/, '').replace(/\.[^.]+$/, '').toLowerCase())
    );
    const duplicates = files.filter(f => existingBaseNames.has(f.name.replace(/\.[^.]+$/, '').toLowerCase()));
    if (duplicates.length) {
      alert(`Already exists — skipping:\n${duplicates.map(f => f.name).join('\n')}`);
      const unique = files.filter(f => !existingBaseNames.has(f.name.replace(/\.[^.]+$/, '').toLowerCase()));
      if (!unique.length) { if (ccblInputRef.current) ccblInputRef.current.value = ''; return; }
    }
    const toUpload = files.filter(f => !existingBaseNames.has(f.name.replace(/\.[^.]+$/, '').toLowerCase()));

    setCcblUploading(true);
    try {
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const prefix = `${Date.now()}_${baseName}`;

        if (file.type.startsWith('image/')) {
          // Compress to max 1200px — fall back to original if format unsupported (e.g. HEIC)
          let blob: Blob = file;
          let ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
          try {
            blob = await compressImage(file, 1200, 0.85);
            ext = 'jpg';
          } catch { /* unsupported format — upload original as-is */ }
          const storagePath = `CCBL/${prefix}.${ext}`;
          await new Promise<void>((resolve, reject) => {
            const task = uploadBytesResumable(ref(storage, storagePath), blob, { contentType: blob.type || file.type });
            task.on('state_changed',
              snap => setCcblUploadPct(Math.round(((i + snap.bytesTransferred / snap.totalBytes) / toUpload.length) * 100)),
              reject, resolve,
            );
          });
        } else {
          // Videos: upload as-is
          const storagePath = `CCBL/${prefix}_${file.name}`;
          await new Promise<void>((resolve, reject) => {
            const task = uploadBytesResumable(ref(storage, storagePath), file);
            task.on('state_changed',
              snap => setCcblUploadPct(Math.round(((i + snap.bytesTransferred / snap.totalBytes) / toUpload.length) * 100)),
              reject, resolve,
            );
          });
        }
      }
    } catch (err: any) {
      alert(`Upload failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setCcblUploading(false);
      setCcblUploadPct(0);
      if (ccblInputRef.current) ccblInputRef.current.value = '';
      await loadStorageFiles();
    }
  };

  // ── CCBL Apprentice handlers ───────────────────────────────────
  const addApprentice = async () => {
    if (!apprenticeForm.name.trim()) return;
    await addDoc(collection(db, 'ccbl_apprentices'), {
      name: apprenticeForm.name.trim(),
      role: apprenticeForm.role.trim() || null,
      sortOrder: apprentices.length,
    });
    setApprenticeForm({ name: '', role: '' });
  };

  const deleteApprentice = async (a: CcblApprentice) => {
    if (!window.confirm(`Delete "${a.name}" and all their media?`)) return;
    const snap = await getDocs(query(collection(db, 'ccbl_apprentice_media'), where('apprenticeId', '==', a.id)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'ccbl_apprentices', a.id));
    if (selectedApprentice?.id === a.id) setSelectedApprentice(null);
  };

  const handleApprenticeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[apprenticeUpload] files:', e.target.files?.length, 'selectedApprentice:', selectedApprentice?.id);
    const files = Array.from(e.target.files ?? []).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('image/')
    );
    console.log('[apprenticeUpload] filtered files:', files.map(f => f.name + ' (' + f.type + ')'));
    if (!files.length || !selectedApprentice) {
      console.warn('[apprenticeUpload] early return — files:', files.length, 'selectedApprentice:', selectedApprentice?.id);
      return;
    }
    setApprenticeUploading(true);
    try {
      const { uploadBytes } = await import('firebase/storage');
      for (const file of files) {
        console.log('[apprenticeUpload] uploading:', file.name);
        const isPhoto = file.type.startsWith('image/');
        const baseName = file.name.replace(/\.[^.]+$/, '');
        let blob: Blob = file;
        let ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        if (isPhoto) {
          try { blob = await compressImage(file, 1200, 0.85); ext = 'jpg'; console.log('[apprenticeUpload] compressed ok'); }
          catch (ce) { console.warn('[apprenticeUpload] compress failed, using original:', ce); }
        }
        const storagePath = `CCBL/apprentices/${selectedApprentice.id}/${Date.now()}_${baseName}.${ext}`;
        console.log('[apprenticeUpload] storagePath:', storagePath);
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, blob, { contentType: isPhoto ? 'image/jpeg' : file.type });
        console.log('[apprenticeUpload] upload done, getting URL');
        const url = await getDownloadURL(storageRef);
        console.log('[apprenticeUpload] got URL, saving to Firestore');
        await addDoc(collection(db, 'ccbl_apprentice_media'), {
          apprenticeId: selectedApprentice.id,
          storagePath,
          url, type: isPhoto ? 'photo' : 'video',
          name: file.name,
          uploadedAt: serverTimestamp(),
        });
        console.log('[apprenticeUpload] done:', file.name);
      }
    } catch (err: any) {
      console.error('[apprenticeUpload] ERROR:', err);
      alert(`Upload failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setApprenticeUploading(false);
      if (apprenticeInputRef.current) apprenticeInputRef.current.value = '';
    }
  };

  const deleteApprenticeMedia = async (m: CcblApprenticMedia) => {
    await deleteDoc(doc(db, 'ccbl_apprentice_media', m.id));
    if (m.storagePath) {
      try { await deleteObject(ref(storage, m.storagePath)); } catch {}
    }
  };

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

  // ── Workers state ──────────────────────────────────────────────
  const [workerRecords,    setWorkerRecords]    = useState<WorkerRecord[]>([]);
  const [workersLoading,   setWorkersLoading]   = useState(true);
  const [showWorkerForm,   setShowWorkerForm]   = useState(false);
  const [editingWorker,    setEditingWorker]    = useState<WorkerRecord | null>(null);
  const [workerSubmitting, setWorkerSubmitting] = useState(false);
  const [workerFormError,  setWorkerFormError]  = useState('');
  const [workerForm,       setWorkerForm]       = useState({ ...EMPTY_WORKER_FORM });
  const [roleSearch,       setRoleSearch]       = useState('');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [orgPositions,     setOrgPositions]     = useState<{ category: string; positions: string[] }[]>([]);

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
        const img = new window.Image();
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

  const fetchWorkers = async () => {
    const snap = await getDocs(collection(db, 'workers'));
    setWorkerRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkerRecord)));
    setWorkersLoading(false);
  };

  useEffect(() => {
    fetchCards(); fetchUsers(); fetchRoles(); fetchWorkers();
    // Load org chart positions from Firestore so the role picker always reflects the current chart
    getDoc(doc(db, 'org_chart', 'layout')).then(snap => {
      if (!snap.exists()) return;
      const cards = (snap.data().cards ?? []) as { name: string; tone: string }[];
      const grouped: Record<string, string[]> = {};
      cards.forEach(c => {
        const cat = TONE_CATEGORY[c.tone] ?? c.tone;
        if (!grouped[cat]) grouped[cat] = [];
        if (!grouped[cat].includes(c.name)) grouped[cat].push(c.name);
      });
      setOrgPositions(
        TONE_ORDER
          .filter(t => grouped[TONE_CATEGORY[t]])
          .map(t => ({ category: TONE_CATEGORY[t], positions: grouped[TONE_CATEGORY[t]] }))
      );
    }).catch(() => {});
  }, []);

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

  // ── Worker handlers ────────────────────────────────────────────
  const openAddWorker = () => {
    setEditingWorker(null);
    setWorkerForm({ ...EMPTY_WORKER_FORM });
    setWorkerFormError(''); setRoleSearch(''); setShowRoleDropdown(false); setShowWorkerForm(true);
  };
  const openEditWorker = (w: WorkerRecord) => {
    setEditingWorker(w);
    setWorkerForm({ workerId: w.workerId || '', name: w.name, role: w.role, email: w.email || '' });
    setWorkerFormError(''); setRoleSearch(''); setShowRoleDropdown(false); setShowWorkerForm(true);
  };
  const handleWorkerSubmit = async () => {
    if (!workerForm.workerId.trim()) { setWorkerFormError('Worker ID is required.'); return; }
    if (!workerForm.name.trim()) { setWorkerFormError('Name is required.'); return; }
    if (!workerForm.role.trim()) { setWorkerFormError('Role is required.'); return; }
    setWorkerSubmitting(true); setWorkerFormError('');
    try {
      const data = { workerId: workerForm.workerId.trim(), name: workerForm.name.trim(), role: workerForm.role.trim(), email: workerForm.email.trim() || null };
      if (editingWorker) {
        await updateDoc(doc(db, 'workers', editingWorker.id), data);
      } else {
        await addDoc(collection(db, 'workers'), { ...data, createdAt: new Date().toISOString() });
      }
      fetchWorkers(); setShowWorkerForm(false);
    } catch { setWorkerFormError('Failed to save. Please try again.'); }
    finally { setWorkerSubmitting(false); }
  };
  const handleDeleteWorker = async (w: WorkerRecord) => {
    if (!window.confirm(`Remove "${w.name}" from the directory? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'workers', w.id));
    fetchWorkers();
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

        {/* ── Important Links ── */}
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>Important Links</h2>
            <p className="text-sm text-slate-400 mt-1">Quick access to standalone tools and public pages.</p>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden border border-white/10 divide-y divide-white/5">
            {[
              { label: 'Live Guest Count', desc: 'Real-time dining hall guest counter', url: `${window.location.origin}/guest-count`, emoji: '👥' },
              { label: 'PCC Chat', desc: 'Standalone messaging app for mobile & web', url: `${window.location.origin}/chat`, emoji: '💬' },
            ].map(link => (
              <div key={link.url} className="flex items-center justify-between px-5 py-4 gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{link.emoji}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{link.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{link.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { navigator.clipboard.writeText(link.url); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all"
                    title="Copy link"
                  >
                    Copy
                  </button>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:opacity-80"
                    style={{ backgroundColor: '#a855f7' }}
                  >
                    Open ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Public Pages ── */}
        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#34d399' }}>Public Pages</h2>
            <p className="text-sm text-slate-400 mt-1">Toggle each page between public (no login needed) and private (login required). Changes take effect immediately.</p>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden border border-white/10 divide-y divide-white/5">
            {([
              { key: 'directory',           emoji: '🌺', label: 'Taste Polynesia',          desc: 'Scroll-driven directory page — public marketing site',                       url: `${window.location.origin}/directory`,              defaultPublic: true  },
              { key: 'ccbl',                emoji: '🏅', label: 'CCBL Certificate',          desc: 'Credential landing page for QR code scans',                                 url: `${window.location.origin}/ccbl`,                   defaultPublic: true  },
              { key: 'animations-sample-01',emoji: '✨', label: 'Sample 01 — Frame Scroll',  desc: 'Animation sample (frame-scroll technique)',                                  url: `${window.location.origin}/animations/samples/01/index.html`, defaultPublic: false },
              { key: 'animations-sample-02',emoji: '🐟', label: 'Sample 02 — 3D Model',      desc: 'Interactive 3D model (GLB viewer with orbit controls)',                     url: `${window.location.origin}/animations/samples/02/index.html`, defaultPublic: false },
              { key: 'animations-reference',emoji: '📖', label: 'Animation Reference',       desc: 'All 10 animation techniques with parameters',                               url: `${window.location.origin}/animations/reference/`,  defaultPublic: false },
            ] as { key: string; emoji: string; label: string; desc: string; url: string; defaultPublic: boolean }[]).map(page => {
              const isPublic = pageVisibility[page.key] ?? page.defaultPublic;
              const isToggling = pageVisTogglingKey === page.key;
              return (
                <div key={page.key} className="flex items-center justify-between px-5 py-4 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0">{page.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-white">{page.label}</p>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-all ${
                          isPublic
                            ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-red-400/30 bg-red-500/10 text-red-400'
                        }`}>
                          {isPublic ? '🌐 Public' : '🔒 Private'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{page.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => navigator.clipboard.writeText(page.url)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all"
                    >
                      Copy
                    </button>
                    <a href={page.url} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all">
                      Open ↗
                    </a>
                    {/* Toggle */}
                    <button
                      onClick={() => togglePageVisibility(page.key, isPublic)}
                      disabled={isToggling}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                        isPublic ? 'bg-emerald-500' : 'bg-white/10'
                      }`}
                      title={isPublic ? 'Set to Private' : 'Set to Public'}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        isPublic ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Directory Gallery ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#f59e0b' }}>Directory Gallery</h2>
              <p className="text-sm text-slate-400 mt-1">Upload photos and videos for the Taste Polynesia directory page slider. Assign each file to Row 1 (slides right) or Row 2 (slides left).</p>
            </div>
            <button
              onClick={() => setDirGalleryOpen(o => !o)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all"
            >
              {dirGalleryOpen ? '▲ Hide' : '▼ Show'}
            </button>
          </div>

          {dirGalleryOpen && (<>
            {/* Upload controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-white/10">
                <button
                  onClick={() => setDirUploadRow(1)}
                  className={`px-4 py-2 text-sm font-bold transition-all ${dirUploadRow === 1 ? 'text-white' : 'text-slate-400 hover:text-white'}`}
                  style={dirUploadRow === 1 ? { backgroundColor: '#f59e0b' } : {}}
                >Row 1 →</button>
                <button
                  onClick={() => setDirUploadRow(2)}
                  className={`px-4 py-2 text-sm font-bold transition-all ${dirUploadRow === 2 ? 'text-white' : 'text-slate-400 hover:text-white'}`}
                  style={dirUploadRow === 2 ? { backgroundColor: '#f59e0b' } : {}}
                >← Row 2</button>
              </div>
              <input ref={dirInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleDirUpload} />
              <button
                onClick={() => dirInputRef.current?.click()}
                disabled={dirUploading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#f59e0b', boxShadow: '0 0 20px rgba(245,158,11,0.3)' }}
              >
                <Upload size={15} />
                {dirUploading ? `Uploading ${dirUploadPct}%…` : `Upload to Row ${dirUploadRow}`}
              </button>
            </div>

            {/* Grid of items by row */}
            {([1, 2] as const).map(rowNum => {
              const rowItems = dirGallery.filter(i => i.row === rowNum);
              return (
                <div key={rowNum}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                    Row {rowNum} — {rowNum === 1 ? 'slides right →' : '← slides left'} ({rowItems.length} item{rowItems.length !== 1 ? 's' : ''})
                  </p>
                  {rowItems.length === 0 ? (
                    <div className="rounded-xl border border-white/5 py-6 text-center text-slate-600 text-xs">
                      No items in Row {rowNum} yet
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {rowItems.map(item => (
                        <div key={item.id} className="relative rounded-xl overflow-hidden aspect-video border border-white/10 group">
                          {item.type === 'video' ? (
                            <video src={item.url} className="w-full h-full object-cover" muted playsInline />
                          ) : (
                            <img src={item.url} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                          )}
                          <div className="absolute inset-0 bg-black/30 flex items-end p-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white uppercase tracking-wider">
                              {item.type === 'video' ? 'VID' : 'IMG'}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDirDelete(item)}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={11} color="white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>)}
        </div>

        {/* ── CCBL Gallery ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>CCBL Gallery</h2>
              <p className="text-sm text-slate-400 mt-1">Browse your Firebase Storage files and toggle which appear on the CCBL page.</p>
            </div>
            <button
              onClick={() => setCcblOpen(o => !o)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all"
            >
              {ccblOpen ? '▲ Hide' : '▼ Show'}
            </button>
          </div>

          {ccblOpen && (<>
            <div className="flex items-center gap-2 justify-end">
              <input ref={ccblInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleCcblUpload} />
              <button
                onClick={() => ccblInputRef.current?.click()}
                disabled={ccblUploading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}
              >
                <Upload size={15} />
                {ccblUploading ? `Uploading ${ccblUploadPct}%…` : 'Upload'}
              </button>
              <button
                onClick={loadStorageFiles}
                disabled={storageLoading}
                className="px-3 py-2.5 rounded-xl text-sm font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
              >
                {storageLoading ? '…' : '↻ Refresh'}
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Toggle items on/off — only <span className="text-[#a855f7] font-semibold">highlighted</span> ones show on the CCBL page. You can also upload files directly to the <code className="bg-white/5 px-1 rounded">CCBL/</code> folder in Firebase Console.
            </p>

          {storageLoading ? (
            <div className="glass-card rounded-2xl border border-white/10 py-12 text-center text-slate-500 text-sm">Loading Storage files…</div>
          ) : storageFiles.length === 0 ? (
            <div className="glass-card rounded-2xl border border-white/10 py-12 text-center text-slate-500 text-sm">
              No files found in <code className="bg-white/5 px-1 rounded">CCBL/</code> — upload files here or via Firebase Console.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {storageFiles.map(file => {
                const on = isPublished(file.storagePath);
                return (
                  <button
                    key={file.storagePath}
                    onClick={() => togglePublish(file)}
                    disabled={toggling === file.storagePath}
                    className="relative rounded-xl overflow-hidden aspect-square transition-all disabled:opacity-60"
                    style={{
                      border: on ? '2px solid #a855f7' : '2px solid rgba(255,255,255,0.1)',
                      boxShadow: on ? '0 0 16px rgba(168,85,247,0.4)' : 'none',
                    }}
                  >
                    {file.type === 'video' ? (
                      <video src={file.url} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <img
                        src={file.url}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={e => {
                          const img = e.currentTarget;
                          img.style.display = 'none';
                          const fb = img.nextElementSibling as HTMLElement | null;
                          if (fb) fb.style.display = 'flex';
                        }}
                      />
                    )}
                    {file.type !== 'video' && (
                      <div className="w-full h-full items-center justify-center bg-white/5 text-slate-500 text-[10px] text-center px-2 hidden">
                        {file.name}
                      </div>
                    )}
                    {/* Overlay */}
                    <div className={`absolute inset-0 flex items-end justify-between p-1.5 transition-colors ${on ? 'bg-[#a855f7]/20' : 'bg-black/20'}`}>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white uppercase tracking-wider">
                        {file.type === 'video' ? 'VID' : 'IMG'}
                      </span>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center ${on ? 'bg-[#a855f7]' : 'bg-black/50 border border-white/30'}`}>
                        {on && <Check size={11} color="white" strokeWidth={3} />}
                      </span>
                    </div>
                    {toggling === file.storagePath && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          </>)}
        </div>

        {/* ── CCBL Apprentices ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>CCBL Apprentices</h2>
              <p className="text-sm text-slate-400 mt-1">Manage apprentice profiles and their portfolio media.</p>
            </div>
            <button
              onClick={() => setApprenticesOpen(o => !o)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all"
            >
              {apprenticesOpen ? '▲ Hide' : '▼ Show'}
            </button>
          </div>

          {apprenticesOpen && (
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Left panel — apprentice list */}
              <div className="flex-1 glass-card rounded-2xl border border-white/10 p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Apprentices</p>

                {/* Add form */}
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Name *"
                    value={apprenticeForm.name}
                    onChange={e => setApprenticeForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all"
                  />
                  <input
                    type="text"
                    placeholder="Role (optional)"
                    value={apprenticeForm.role}
                    onChange={e => setApprenticeForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all"
                  />
                  <button
                    onClick={addApprentice}
                    disabled={!apprenticeForm.name.trim()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                    style={{ backgroundColor: '#a855f7', boxShadow: '0 0 16px rgba(168,85,247,0.25)' }}
                  >
                    <Plus size={14} /> Add Apprentice
                  </button>
                </div>

                {/* Apprentice list */}
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {apprentices.length === 0 && (
                    <p className="text-xs text-slate-600 italic text-center py-4">No apprentices yet.</p>
                  )}
                  {apprentices.map(a => (
                    <div
                      key={a.id}
                      onClick={() => setSelectedApprentice(prev => prev?.id === a.id ? null : a)}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                      style={{
                        border: selectedApprentice?.id === a.id ? '1.5px solid #a855f7' : '1px solid rgba(255,255,255,0.08)',
                        background: selectedApprentice?.id === a.id ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.03)',
                        boxShadow: selectedApprentice?.id === a.id ? '0 0 12px rgba(168,85,247,0.2)' : 'none',
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold text-white leading-none">{a.name}</p>
                        {a.role && <p className="text-[10px] text-slate-500 mt-0.5">{a.role}</p>}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); deleteApprentice(a); }}
                        className="p-1.5 text-slate-600 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10 flex-shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right panel — media for selected apprentice */}
              <div className="flex-1 glass-card rounded-2xl border border-white/10 p-4 space-y-3">
                {!selectedApprentice ? (
                  <div className="flex items-center justify-center h-full min-h-[200px]">
                    <p className="text-sm text-slate-600 italic text-center">Select an apprentice to manage their media</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Portfolio</p>
                        <p className="text-sm font-bold text-white mt-0.5">{selectedApprentice.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={apprenticeInputRef}
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          className="hidden"
                          onChange={handleApprenticeUpload}
                        />
                        <button
                          onClick={() => apprenticeInputRef.current?.click()}
                          disabled={apprenticeUploading}
                          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                          style={{ backgroundColor: '#a855f7', boxShadow: '0 0 14px rgba(168,85,247,0.25)' }}
                        >
                          <Upload size={13} />
                          {apprenticeUploading ? 'Uploading…' : 'Upload'}
                        </button>
                      </div>
                    </div>

                    {apprenticeMedia.length === 0 ? (
                      <p className="text-xs text-slate-600 italic text-center py-6">No media uploaded yet.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                        {apprenticeMedia.map(m => (
                          <div key={m.id} className="relative rounded-xl overflow-hidden aspect-square group" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                            {m.type === 'video' ? (
                              <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                            ) : (
                              <img src={m.url} alt={m.name} className="w-full h-full object-cover" loading="lazy" />
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => deleteApprenticeMedia(m)}
                                className="p-1.5 rounded-full bg-[#ff4d4d]/80 text-white hover:bg-[#ff4d4d] transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <div className="absolute bottom-1 left-1">
                              <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-black/60 text-white uppercase">
                                {m.type === 'video' ? 'VID' : 'IMG'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

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
                            <span
                              className="text-[9px] font-mono text-slate-600 hover:text-slate-400 cursor-pointer transition-colors select-all"
                              title={`UID: ${user.id}`}
                              onClick={() => navigator.clipboard?.writeText(user.id)}
                            >
                              {user.id.length > 20 ? user.id.slice(0, 20) + '…' : user.id}
                            </span>
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

        {/* ── Workers (Directory Records) ── */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#a855f7' }}>Workers</h2>
              <p className="text-sm text-slate-400 mt-1">Non-account staff records visible in the Directory tab.</p>
            </div>
            <button onClick={openAddWorker} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
              <Plus size={15} /> Add Worker
            </button>
          </div>
          {(() => {
            const dupeIds   = new Set(workerRecords.map(w => w.workerId).filter((v, i, a) => v && a.indexOf(v) !== i));
            const dupeNames = new Set(workerRecords.map(w => w.name.trim().toLowerCase()).filter((v, i, a) => a.indexOf(v) !== i));
            const dupeRoles = new Set(workerRecords.map(w => w.role.trim().toLowerCase()).filter((v, i, a) => a.indexOf(v) !== i));
            if (!dupeIds.size && !dupeNames.size && !dupeRoles.size) return null;
            const parts = [
              dupeIds.size   && `${dupeIds.size} duplicate Worker ID${dupeIds.size > 1 ? 's' : ''}`,
              dupeNames.size && `${dupeNames.size} duplicate name${dupeNames.size > 1 ? 's' : ''}`,
              dupeRoles.size && `${dupeRoles.size} duplicate role${dupeRoles.size > 1 ? 's' : ''}`,
            ].filter(Boolean);
            return (
              <div className="flex items-start gap-3 px-4 py-3 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 mb-2">
                <span className="text-yellow-400 text-base mt-0.5">⚠</span>
                <div>
                  <p className="text-yellow-300 text-xs font-bold">Duplicate records detected</p>
                  <p className="text-yellow-400/80 text-[11px] mt-0.5">{parts.join(' · ')} — review the highlighted rows below.</p>
                </div>
              </div>
            );
          })()}
          <div className="glass-card rounded-[2rem] overflow-hidden border border-white/10">
            {workersLoading ? (
              <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#a855f7]" /></div>
            ) : (
              <div className="overflow-x-auto">
                {(() => {
                  const dupeIds   = new Set(workerRecords.map(w => w.workerId).filter((v, i, a) => v && a.indexOf(v) !== i));
                  const dupeNames = new Set(workerRecords.map(w => w.name.trim().toLowerCase()).filter((v, i, a) => a.indexOf(v) !== i));
                  const dupeRoles = new Set(workerRecords.map(w => w.role.trim().toLowerCase()).filter((v, i, a) => a.indexOf(v) !== i));
                  return (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-[0.15em] font-black border-b border-white/5">
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Name</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Role</th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4">Email</th>
                      <th className="px-3 sm:px-6 py-3 sm:py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {workerRecords.map(w => {
                      const hasDupeId   = !!(w.workerId && dupeIds.has(w.workerId));
                      const hasDupeName = dupeNames.has(w.name.trim().toLowerCase());
                      const hasDupeRole = dupeRoles.has(w.role.trim().toLowerCase());
                      const isDupe = hasDupeId || hasDupeName || hasDupeRole;
                      const dupeLabels = [hasDupeId && 'ID', hasDupeName && 'Name', hasDupeRole && 'Role'].filter(Boolean).join(', ');
                      return (
                      <tr key={w.id} className={`transition-colors ${isDupe ? 'bg-yellow-500/5 hover:bg-yellow-500/10' : 'hover:bg-white/[0.02]'}`}>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-bold ${hasDupeName ? 'text-yellow-300' : 'text-white'}`}>{w.name}</span>
                              {hasDupeName && <span title="Duplicate name" className="text-yellow-400 text-xs">⚠</span>}
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-full">No account</span>
                              {isDupe && <span className="text-[9px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">Dupe {dupeLabels}</span>}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {w.workerId && (
                                <span
                                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border cursor-pointer select-all transition-colors ${hasDupeId ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30 hover:text-yellow-200' : 'text-slate-500 bg-white/5 border-white/10 hover:text-slate-300'}`}
                                  title={`Worker ID: ${w.workerId}`}
                                  onClick={() => navigator.clipboard?.writeText(w.workerId)}
                                >
                                  ID {w.workerId}
                                </span>
                              )}
                              <span
                                className="text-[9px] font-mono text-slate-700 hover:text-slate-500 cursor-pointer transition-colors select-all"
                                title={`Doc ID: ${w.id}`}
                                onClick={() => navigator.clipboard?.writeText(w.id)}
                              >
                                {w.id.length > 16 ? w.id.slice(0, 16) + '…' : w.id}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${hasDupeRole ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>{w.role}</span>
                        </td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-3 sm:py-4"><span className="text-xs text-slate-500">{w.email || '—'}</span></td>
                        <td className="px-3 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEditWorker(w)} className="p-1.5 text-slate-500 hover:text-[#a855f7] transition-colors rounded-lg hover:bg-[#a855f7]/10"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteWorker(w)} className="p-1.5 text-slate-500 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                    {workerRecords.length === 0 && <tr><td colSpan={4} className="text-center py-16 text-slate-600 italic text-sm">No worker records yet. Click "Add Worker" to create one.</td></tr>}
                  </tbody>
                </table>
                  );
                })()}
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

      {/* ── Worker Modal ── */}
      {showWorkerForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowWorkerForm(false)}>
          <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-md shadow-2xl" style={{ boxShadow: '0 0 60px rgba(168,85,247,0.15)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-white/5">
              <h3 className="text-lg font-bold text-white">{editingWorker ? 'Edit Worker' : 'Add Worker'}</h3>
              <button onClick={() => setShowWorkerForm(false)} className="p-1.5 text-slate-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-5">
              <div>
                <label className={labelCls}>Worker ID <span className="text-[#ff4d4d]">*</span></label>
                <input type="text" className={inputCls} placeholder="e.g. W-001" value={workerForm.workerId} onChange={e => setWorkerForm(f => ({ ...f, workerId: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Full Name <span className="text-[#ff4d4d]">*</span></label>
                <input type="text" className={inputCls} placeholder="e.g. Jane Smith" value={workerForm.name} onChange={e => setWorkerForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="relative">
                <label className={labelCls}>Role / Position <span className="text-[#ff4d4d]">*</span></label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Search position..."
                  value={roleSearch || workerForm.role}
                  onFocus={() => { setRoleSearch(workerForm.role); setShowRoleDropdown(true); }}
                  onChange={e => { setRoleSearch(e.target.value); setWorkerForm(f => ({ ...f, role: e.target.value })); setShowRoleDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowRoleDropdown(false), 150)}
                  autoComplete="off"
                />
                {showRoleDropdown && (() => {
                  const q = (roleSearch || workerForm.role).toLowerCase();
                  const filtered = orgPositions.map(g => ({
                    category: g.category,
                    positions: g.positions.filter(p => p.toLowerCase().includes(q)),
                  })).filter(g => g.positions.length > 0);
                  return filtered.length > 0 ? (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-[#1a0f2e] border border-white/10 rounded-xl shadow-2xl max-h-56 overflow-y-auto">
                      {filtered.map(g => (
                        <div key={g.category}>
                          <p className="px-3 pt-2 pb-0.5 text-[9px] font-black uppercase tracking-widest text-purple-400">{g.category}</p>
                          {g.positions.map(p => (
                            <button
                              key={p}
                              type="button"
                              className="w-full text-left px-4 py-1.5 text-sm text-slate-200 hover:bg-white/10 transition-colors"
                              onMouseDown={() => { setWorkerForm(f => ({ ...f, role: p })); setRoleSearch(''); setShowRoleDropdown(false); }}
                            >{p}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              <div>
                <label className={labelCls}>Email (optional)</label>
                <input type="email" className={inputCls} placeholder="email@company.com" value={workerForm.email} onChange={e => setWorkerForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              {workerFormError && <p className="text-[11px] text-[#ff4d4d] font-semibold">{workerFormError}</p>}
            </div>
            <div className="flex gap-3 px-4 sm:px-8 py-4 sm:py-5 border-t border-white/5">
              <button onClick={() => setShowWorkerForm(false)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
              <button onClick={handleWorkerSubmit} disabled={workerSubmitting} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
                {workerSubmitting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : editingWorker ? 'Save Changes' : 'Add Worker'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
