import React, { useState, useEffect, useRef } from 'react';
import { X, Edit2, Save, Plus, Trash2, Check, Send, MessageSquare, Upload, Paperclip } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { User, Project, Task, Message, Deliverable, ProjectStatus, ProjectPriority, Department } from './types';
import { db, storage } from './firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

// ── File-type helpers ──────────────────────────────────────────────────────────

type FileViewType = 'image' | 'video' | 'pdf' | 'office' | 'other';

function getFileViewType(contentType: string, name: string): FileViewType {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'pdf';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'csv'].includes(ext)) return 'office';
  return 'other';
}

function getFileIcon(type: FileViewType, name: string): string {
  if (type === 'image')  return '🖼️';
  if (type === 'video')  return '🎬';
  if (type === 'pdf')    return '📄';
  if (type === 'office') {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📊';
    if (['ppt', 'pptx', 'odp'].includes(ext))        return '📊';
    return '📝';
  }
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPT_COLORS: Record<Department, string> = {
  Personal: '#ff00ff', Business: '#00ffff', Finance: '#ffd700', Health: '#ff4d4d',
};

const STATUS_STYLES: Record<ProjectStatus, string> = {
  'Not Started': 'text-slate-400 border-slate-400/30 bg-slate-400/10',
  'In Progress': 'text-[#ffd700] border-[#ffd700]/30 bg-[#ffd700]/10',
  'On Hold':     'text-[#ff00ff] border-[#ff00ff]/30 bg-[#ff00ff]/10',
  'Done':        'text-[#00ffff] border-[#00ffff]/30 bg-[#00ffff]/10',
};

const PRIORITY_COLOR: Record<ProjectPriority, string> = {
  High: 'text-rose-400', Medium: 'text-amber-400', Low: 'text-emerald-400',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  project: Project;
  users: User[];
  assignableUsers?: User[];
  currentUser: User;
  onClose: () => void;
  onUpdated: () => void;
  onMarkRead: () => void;
  onDelete?: () => void;
  viewOnly?: boolean;
}

export default function ProjectDetailModal({ project, users, assignableUsers, currentUser, onClose, onUpdated, onMarkRead, onDelete, viewOnly = false }: Props) {
  // viewOnly overrides edit access even for Directors
  const isDirector = currentUser.role === 'Director' && !viewOnly;

  const [isEditing,      setIsEditing]      = useState(false);
  const [tasks,          setTasks]          = useState<Task[]>([]);
  const [newTaskTitle,   setNewTaskTitle]   = useState('');
  const [addingTask,     setAddingTask]     = useState(false);
  const [taskError,      setTaskError]      = useState('');
  const [saving,         setSaving]         = useState(false);
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [newMessage,     setNewMessage]     = useState('');
  const [sending,        setSending]        = useState(false);
  const [chatError,      setChatError]      = useState('');
  const [dragging,       setDragging]       = useState(false);

  // Deliverables state
  const [deliverables,   setDeliverables]   = useState<Deliverable[]>([]);
  const [uploading,      setUploading]      = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError,    setUploadError]    = useState('');
  const [viewerFile,     setViewerFile]     = useState<Deliverable | null>(null);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef  = useRef<HTMLInputElement>(null);
  const taskInputRef  = useRef<HTMLInputElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name:              project.name,
    assignee_ids:      project.assignee_ids ?? [project.account_lead_id],
    status:            project.status,
    priority:          project.priority,
    department:        project.department,
    start_date:        project.start_date || '',
    end_date:          project.end_date   || '',
    directors_note:    project.directors_note || '',
    is_priority_focus: Boolean(project.is_priority_focus),
    is_time_critical:  Boolean(project.is_time_critical),
  });

  // ── Load tasks ─────────────────────────────────────────────────
  useEffect(() => {
    getDocs(collection(db, 'projects', project.id, 'tasks'))
      .then(snap => setTasks(snap.docs.map(d => ({ id: d.id, project_id: project.id, ...d.data() } as Task))))
      .catch(() => {});
  }, [project.id]);

  // ── Load deliverables ──────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'projects', project.id, 'deliverables'), orderBy('uploadedAt', 'desc')))
      .then(snap => setDeliverables(snap.docs.map(d => ({ id: d.id, ...d.data() } as Deliverable))))
      .catch(() => {});
  }, [project.id]);

  // ── Real-time messages via onSnapshot ──────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'projects', project.id, 'messages'), orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, snap => {
      const msgs: Message[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id:           d.id,
          project_id:   project.id,
          sender_id:    data.sender_id,
          sender_name:  data.sender_name,
          sender_photo: data.sender_photo || '',
          sender_role:  data.sender_role,
          content:      data.content,
          timestamp:    data.timestamp?.toDate()?.toISOString() ?? new Date().toISOString(),
        };
      });
      setMessages(msgs);
    });
    markRead();
    return () => unsubscribe();
  }, [project.id]);

  // ── Auto-scroll chat ───────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const markRead = () => {
    setDoc(
      doc(db, 'users', currentUser.id, 'reads', project.id),
      { last_read_at: serverTimestamp() },
      { merge: true }
    ).then(() => onMarkRead()).catch(() => {});
  };

  // ── Save project edits ─────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const selectedUsers = adminUsers.filter(u => form.assignee_ids.includes(u.id));
      const primaryLead   = selectedUsers[0];
      await updateDoc(doc(db, 'projects', project.id), {
        name:               form.name,
        status:             form.status,
        priority:           form.priority,
        department:         form.department,
        start_date:         form.start_date,
        end_date:           form.end_date,
        directors_note:     form.directors_note,
        is_priority_focus:  form.is_priority_focus,
        is_time_critical:   form.is_time_critical,
        assignee_ids:       form.assignee_ids,
        assignee_names:     selectedUsers.map(u => u.name),
        account_lead_id:    primaryLead?.id   ?? project.account_lead_id,
        account_lead_name:  primaryLead?.name ?? project.account_lead_name,
      });
      onUpdated();
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({
      name:              project.name,
      assignee_ids:      project.assignee_ids ?? [project.account_lead_id],
      status:            project.status,
      priority:          project.priority,
      department:        project.department,
      start_date:        project.start_date || '',
      end_date:          project.end_date   || '',
      directors_note:    project.directors_note || '',
      is_priority_focus: Boolean(project.is_priority_focus),
      is_time_critical:  Boolean(project.is_time_critical),
    });
    setIsEditing(false);
  };

  const handleDeleteProject = async () => {
    if (!window.confirm(`Delete "${project.name}"?\n\nThis will permanently remove the project, all tasks, messages, and uploaded files. This cannot be undone.`)) return;
    try {
      // Delete deliverable Storage files + Firestore docs
      const delivSnap = await getDocs(collection(db, 'projects', project.id, 'deliverables'));
      await Promise.all(delivSnap.docs.map(async d => {
        const data = d.data();
        if (data.storagePath) { try { await deleteObject(ref(storage, data.storagePath)); } catch {} }
        await deleteDoc(doc(db, 'projects', project.id, 'deliverables', d.id));
      }));
      // Delete tasks
      const taskSnap = await getDocs(collection(db, 'projects', project.id, 'tasks'));
      await Promise.all(taskSnap.docs.map(d => deleteDoc(doc(db, 'projects', project.id, 'tasks', d.id))));
      // Delete messages
      const msgSnap = await getDocs(collection(db, 'projects', project.id, 'messages'));
      await Promise.all(msgSnap.docs.map(d => deleteDoc(doc(db, 'projects', project.id, 'messages', d.id))));
      // Delete project document
      await deleteDoc(doc(db, 'projects', project.id));
      onDelete?.();
    } catch {}
  };

  // ── Tasks ──────────────────────────────────────────────────────
  const toggleTask = async (task: Task) => {
    await updateDoc(doc(db, 'projects', project.id, 'tasks', task.id), { completed: !task.completed });
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t));
  };

  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    setTaskError('');
    try {
      const ref = await addDoc(collection(db, 'projects', project.id, 'tasks'), { title, completed: false });
      setTasks(prev => [...prev, { id: ref.id, project_id: project.id, title, completed: false }]);
      setNewTaskTitle('');
      taskInputRef.current?.focus();
    } catch {
      setTaskError('Failed to add task. Please try again.');
    } finally {
      setAddingTask(false);
    }
  };

  const deleteTask = async (taskId: string) => {
    await deleteDoc(doc(db, 'projects', project.id, 'tasks', taskId));
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // ── Messages ───────────────────────────────────────────────────
  const sendMessage = async () => {
    const content = newMessage.trim();
    if (!content || sending) return;
    setSending(true);
    setChatError('');
    try {
      await addDoc(collection(db, 'projects', project.id, 'messages'), {
        sender_id:    currentUser.id,
        sender_name:  currentUser.name,
        sender_photo: currentUser.photo || '',
        sender_role:  currentUser.role,
        content,
        timestamp:    serverTimestamp(),
      });
      setNewMessage('');
      markRead();
      chatInputRef.current?.focus();
    } catch {
      setChatError('Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── Deliverables ───────────────────────────────────────────────
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    const file = files[0];
    const MAX_MB = 100;
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadError(`File must be under ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadError('');
    try {
      const safeName    = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const storagePath = `deliverables/${project.id}/${safeName}`;
      const storageRef  = ref(storage, storagePath);
      const uploadTask  = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          snap => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          reject,
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const data: Omit<Deliverable, 'id'> = {
                name:           file.name,
                url,
                contentType:    file.type || 'application/octet-stream',
                size:           file.size,
                uploadedBy:     currentUser.id,
                uploadedByName: currentUser.name,
                uploadedAt:     new Date().toISOString(),
                storagePath,
              };
              const docRef = await addDoc(collection(db, 'projects', project.id, 'deliverables'), data);
              setDeliverables(prev => [{ id: docRef.id, ...data }, ...prev]);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });
    } catch (err: any) {
      const msg = err?.code === 'storage/unauthorized'
        ? 'Storage not enabled. See setup instructions.'
        : err?.message ?? 'Upload failed. Please try again.';
      setUploadError(msg);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDeliverable = async (deliv: Deliverable) => {
    if (!window.confirm(`Delete "${deliv.name}"? This cannot be undone.`)) return;
    try { await deleteObject(ref(storage, deliv.storagePath)); } catch {}
    await deleteDoc(doc(db, 'projects', project.id, 'deliverables', deliv.id));
    setDeliverables(prev => prev.filter(d => d.id !== deliv.id));
  };

  const handleToggleShared = async (deliv: Deliverable) => {
    const newVal = !(deliv.sharedWithAll ?? false);
    await updateDoc(doc(db, 'projects', project.id, 'deliverables', deliv.id), { sharedWithAll: newVal });
    setDeliverables(prev => prev.map(d => d.id === deliv.id ? { ...d, sharedWithAll: newVal } : d));
  };

  const handleView = (deliv: Deliverable) => {
    const type = getFileViewType(deliv.contentType, deliv.name);
    if (type === 'image' || type === 'video') {
      setViewerFile(deliv);
    } else if (type === 'pdf') {
      window.open(deliv.url, '_blank', 'noopener,noreferrer');
    } else if (type === 'office') {
      window.open(`https://docs.google.com/viewer?url=${encodeURIComponent(deliv.url)}`, '_blank', 'noopener,noreferrer');
    } else {
      const a = document.createElement('a');
      a.href = deliv.url; a.download = deliv.name; a.click();
    }
  };

  // ── Derived ────────────────────────────────────────────────────
  const adminUsers      = assignableUsers ?? users;
  const currentLead     = users.find(u => u.id === project.account_lead_id);
  const completedCount  = tasks.filter(t => t.completed).length;
  const totalTasks      = tasks.length;
  const taskProgress    = totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0;

  const displayDept          = isEditing ? form.department        : project.department;
  const displayPriorityFocus = isEditing ? form.is_priority_focus : Boolean(project.is_priority_focus);
  const displayTimeCritical  = isEditing ? form.is_time_critical  : Boolean(project.is_time_critical);

  const inputCls  = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all';
  const selectCls = 'w-full bg-[#1e1130] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all';
  const labelCls  = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5';

  return (
    <>
      {/* ── Viewer overlay (images & videos) ── */}
      {viewerFile && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/92 backdrop-blur-sm p-4"
          onClick={() => setViewerFile(null)}
        >
          <div className="relative max-w-4xl w-full flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-white text-sm font-bold truncate flex-1 mr-4">{viewerFile.name}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={viewerFile.url}
                  download={viewerFile.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-white/10 hover:bg-white/20 border border-white/10 transition-all"
                  onClick={e => e.stopPropagation()}
                >
                  ↓ Download
                </a>
                <button
                  onClick={() => setViewerFile(null)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            {/* Content */}
            {getFileViewType(viewerFile.contentType, viewerFile.name) === 'image' ? (
              <img
                src={viewerFile.url}
                alt={viewerFile.name}
                className="max-w-full max-h-[80vh] object-contain rounded-2xl mx-auto"
              />
            ) : (
              <video
                controls
                autoPlay
                className="max-w-full max-h-[80vh] rounded-2xl mx-auto"
                src={viewerFile.url}
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>
        </div>
      )}

      {/* ── Main modal ── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-3xl shadow-2xl shadow-[#ff00ff]/10 flex flex-col overflow-hidden"
          style={{ maxHeight: '90vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-8 py-6 border-b border-white/5 flex-shrink-0">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-3 h-3 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: DEPT_COLORS[displayDept] }} />
              {isEditing ? (
                <input
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-[#ff00ff]"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              ) : (
                <h2 className="text-xl font-bold text-white truncate">{project.name}</h2>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              {isDirector && !isEditing && (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-300 hover:text-[#ff00ff] hover:border-[#ff00ff]/30 transition-all"
                  >
                    <Edit2 size={12} /> Edit
                  </button>
                  <button
                    onClick={handleDeleteProject}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-slate-500 hover:text-[#ff4d4d] hover:border-[#ff4d4d]/30 hover:bg-[#ff4d4d]/5 transition-all"
                    title="Delete project"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">

              {/* Left: Details */}
              <div className="p-8 space-y-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-2">Project Details</p>

                <div>
                  <label className={labelCls}>Status</label>
                  {isEditing ? (
                    <select className={selectCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ProjectStatus }))}>
                      {(['Not Started', 'In Progress', 'On Hold', 'Done'] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span className={`inline-block text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${STATUS_STYLES[project.status]}`}>{project.status}</span>
                  )}
                </div>

                <div>
                  <label className={labelCls}>
                    Assignees
                    {isEditing && form.assignee_ids.length > 0 && (
                      <span className="ml-2 normal-case font-bold text-[#ff00ff]">{form.assignee_ids.length} selected</span>
                    )}
                  </label>
                  {isEditing ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {adminUsers.map(u => {
                          const selected  = form.assignee_ids.includes(u.id);
                          const isPrimary = form.assignee_ids[0] === u.id;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                assignee_ids: selected
                                  ? f.assignee_ids.filter(x => x !== u.id)
                                  : [...f.assignee_ids, u.id],
                              }))}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all"
                              style={
                                selected
                                  ? { background: 'rgba(255,0,255,0.15)', borderColor: 'rgba(255,0,255,0.5)', color: '#ff00ff' }
                                  : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: '#94a3b8' }
                              }
                            >
                              {selected && <span className="text-[10px]">✓</span>}
                              {u.name}
                              {isPrimary && selected && (
                                <span className="text-[9px] font-black uppercase tracking-wider opacity-60">primary</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {form.assignee_ids.length > 1 && (
                        <p className="text-[10px] text-slate-500 mt-1.5">First selected is the primary account lead.</p>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(project.assignee_ids ?? [project.account_lead_id]).map((id, i) => {
                        const u    = users.find(x => x.id === id);
                        const name = project.assignee_names?.[i] ?? u?.name ?? id;
                        const isPrimary = i === 0;
                        return (
                          <div key={id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium bg-white/5 border border-white/10 text-slate-300">
                            <img src={u?.photo || `https://picsum.photos/seed/${id}/100/100`} className="w-5 h-5 rounded-full object-cover" alt="" />
                            {name}
                            {isPrimary && <span className="text-[9px] text-slate-500 font-bold uppercase">lead</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Department</label>
                    {isEditing ? (
                      <select className={selectCls} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value as Department }))}>
                        {(['Business', 'Finance', 'Personal', 'Health'] as Department[]).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    ) : (
                      <span className="text-sm text-white font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: DEPT_COLORS[project.department] }} />
                        {project.department}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Priority</label>
                    {isEditing ? (
                      <select className={selectCls} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                        {(['High', 'Medium', 'Low'] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : (
                      <span className={`text-sm font-bold ${PRIORITY_COLOR[project.priority]}`}>{project.priority}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Start Date</label>
                    {isEditing ? (
                      <input type="date" className={inputCls} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                    ) : (
                      <span className="text-sm text-white font-mono">{project.start_date ? format(parseISO(project.start_date), 'MMM dd, yyyy') : '---'}</span>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Due Date</label>
                    {isEditing ? (
                      <input type="date" className={inputCls} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                    ) : (
                      <span className="text-sm text-white font-mono">{project.end_date ? format(parseISO(project.end_date), 'MMM dd, yyyy') : '---'}</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button type="button" disabled={!isEditing}
                    onClick={() => isEditing && setForm(f => ({ ...f, is_priority_focus: !f.is_priority_focus }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${isEditing ? 'cursor-pointer' : 'cursor-default'} ${displayPriorityFocus ? 'border-[#ff00ff]/40 bg-[#ff00ff]/10' : 'border-white/10 bg-white/5'}`}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${displayPriorityFocus ? 'bg-[#ff00ff]' : 'border border-white/20'}`}>
                      {displayPriorityFocus && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Priority Focus</span>
                  </button>
                  <button type="button" disabled={!isEditing}
                    onClick={() => isEditing && setForm(f => ({ ...f, is_time_critical: !f.is_time_critical }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${isEditing ? 'cursor-pointer' : 'cursor-default'} ${displayTimeCritical ? 'border-[#ff4d4d]/40 bg-[#ff4d4d]/10' : 'border-white/10 bg-white/5'}`}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${displayTimeCritical ? 'bg-[#ff4d4d]' : 'border border-white/20'}`}>
                      {displayTimeCritical && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Time Critical</span>
                  </button>
                </div>

                {!isDirector && <p className="text-[10px] text-slate-600 italic mt-2">View only — contact your Director to make changes.</p>}
              </div>

              {/* Right: Note + Tasks */}
              <div className="p-8 space-y-6">
                <div>
                  <label className={labelCls}>Director's Note</label>
                  {isEditing ? (
                    <textarea className={inputCls + ' resize-none h-28'} value={form.directors_note}
                      onChange={e => setForm(f => ({ ...f, directors_note: e.target.value }))} placeholder="Add a note..." />
                  ) : (
                    <p className="text-sm text-slate-300 leading-relaxed min-h-[3rem]">
                      {project.directors_note ? project.directors_note : <span className="text-slate-600 italic">No note added.</span>}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className={labelCls}>Tasks{totalTasks > 0 ? ` (${completedCount}/${totalTasks})` : ''}</label>
                    {totalTasks > 0 && <span className="text-[10px] font-bold text-slate-500">{Math.round(taskProgress)}%</span>}
                  </div>
                  {totalTasks > 0 && (
                    <div className="h-1.5 bg-white/10 rounded-full mb-4 overflow-hidden">
                      <div className="h-full bg-[#00ffff] rounded-full transition-all duration-500" style={{ width: `${taskProgress}%` }} />
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {tasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 group p-2 rounded-xl hover:bg-white/5 transition-all">
                        <button onClick={() => toggleTask(task)}
                          className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${task.completed ? 'bg-[#00ffff] border-[#00ffff]' : 'border-white/20 hover:border-[#00ffff]/50'}`}
                        >
                          {task.completed && <Check size={10} className="text-[#0a0510]" />}
                        </button>
                        <span className={`flex-1 text-sm transition-all ${task.completed ? 'line-through text-slate-600' : 'text-slate-300'}`}>{task.title}</span>
                        {isDirector && (
                          <button onClick={() => deleteTask(task.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-[#ff4d4d] transition-all">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {tasks.length === 0 && <p className="text-[11px] text-slate-600 italic text-center py-6">No tasks yet.</p>}
                  </div>
                  {isDirector && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input ref={taskInputRef} type="text" className={inputCls + ' flex-1'} placeholder="Add a task…"
                          value={newTaskTitle}
                          onChange={e => { setNewTaskTitle(e.target.value); setTaskError(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
                          disabled={addingTask}
                        />
                        <button type="button" onClick={addTask} disabled={!newTaskTitle.trim() || addingTask}
                          className="p-2.5 rounded-xl bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/30 transition-all flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {addingTask ? <span className="w-3.5 h-3.5 border-2 border-[#ff00ff]/40 border-t-[#ff00ff] rounded-full animate-spin block" /> : <Plus size={14} />}
                        </button>
                      </div>
                      {taskError && <p className="text-[10px] text-[#ff4d4d] font-semibold">{taskError}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Deliverables ── */}
            <div className="border-t border-white/5 p-8">
              {/* Section header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Paperclip size={14} className="text-[#ff00ff]" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Deliverables</h3>
                  {deliverables.length > 0 && (
                    <span className="text-[9px] text-slate-600 ml-1">{deliverables.length} file{deliverables.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer transition-all text-xs font-bold select-none
                  ${uploading
                    ? 'opacity-60 cursor-wait border-white/10 text-slate-500'
                    : 'border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/10 hover:border-[#ff00ff]/50'
                  }`}>
                  {uploading ? (
                    <>
                      <span className="w-3 h-3 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin block" />
                      {uploadProgress}%
                    </>
                  ) : (
                    <><Upload size={12} /> Upload File</>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.csv,.txt"
                    onChange={e => handleFileUpload(e.target.files)}
                  />
                </label>
              </div>

              {/* Upload progress bar */}
              {uploading && (
                <div className="h-1.5 bg-white/10 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-[#ff00ff] rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}

              {/* Empty drop zone */}
              {deliverables.length === 0 && !uploading && (
                <div
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer
                    ${dragging ? 'border-[#ff00ff]/50 bg-[#ff00ff]/5' : 'border-white/10 hover:border-white/20'}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); handleFileUpload(e.dataTransfer.files); }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <p className="text-slate-500 text-sm font-medium">Drop files here or click to upload</p>
                  <p className="text-slate-700 text-[10px] mt-1">PDF · Excel · Word · PowerPoint · Images · Videos · Max 100 MB</p>
                </div>
              )}

              {/* File list */}
              {deliverables.length > 0 && (
                <div
                  className={`space-y-2 rounded-2xl transition-all ${dragging ? 'outline-dashed outline-2 outline-[#ff00ff]/30 outline-offset-4' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); handleFileUpload(e.dataTransfer.files); }}
                >
                  {deliverables.map(deliv => {
                    const type      = getFileViewType(deliv.contentType, deliv.name);
                    const icon      = getFileIcon(type, deliv.name);
                    const canDelete = isDirector || deliv.uploadedBy === currentUser.id;
                    const shared    = deliv.sharedWithAll ?? false;
                    return (
                      <div
                        key={deliv.id}
                        className="rounded-2xl border group transition-all"
                        style={{
                          background:   shared ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.03)',
                          borderColor:  shared ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.05)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = shared ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = shared ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.05)')}
                      >
                        {/* Main row */}
                        <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                          <span className="text-xl flex-shrink-0 leading-none">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-white truncate">{deliv.name}</p>
                              {shared && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                                  🌐 Shared with all
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-600 mt-0.5">
                              {formatBytes(deliv.size)} · {deliv.uploadedByName} · {format(parseISO(deliv.uploadedAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Director: share/unshare toggle */}
                            {isDirector && (
                              <button
                                onClick={() => handleToggleShared(deliv)}
                                title={shared ? 'Remove from all accounts' : 'Share with all accounts'}
                                className={`px-2 py-1.5 rounded-lg text-[9px] font-bold transition-all ${
                                  shared
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30'
                                    : 'bg-white/5 text-slate-500 border border-white/10 hover:bg-white/10 hover:text-slate-300'
                                }`}
                              >
                                {shared ? '🌐 Shared' : '🔒 Private'}
                              </button>
                            )}
                            {/* View / Open */}
                            <button
                              onClick={() => handleView(deliv)}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-[#00ffff] bg-[#00ffff]/10 border border-[#00ffff]/20 hover:bg-[#00ffff]/20 transition-all"
                            >
                              {type === 'image' || type === 'video' ? 'View' : 'Open'}
                            </button>
                            {/* Download */}
                            <a
                              href={deliv.url}
                              download={deliv.name}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 bg-white/5 border border-white/10 hover:text-white hover:border-white/20 transition-all"
                              title="Download"
                            >
                              ↓
                            </a>
                            {/* Delete */}
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteDeliverable(deliv)}
                                className="p-1.5 text-slate-600 hover:text-[#ff4d4d] transition-colors rounded-lg hover:bg-[#ff4d4d]/10 opacity-0 group-hover:opacity-100"
                                title="Delete"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {uploadError && (
                <p className="text-[10px] text-[#ff4d4d] font-semibold mt-3">{uploadError}</p>
              )}
            </div>

            {/* Chat */}
            <div className="border-t border-white/5 p-8">
              <div className="flex items-center gap-2 mb-5">
                <MessageSquare size={14} className="text-[#ff00ff]" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Project Chat</h3>
                {messages.length > 0 && <span className="text-[9px] text-slate-600 ml-1">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>}
              </div>
              <div className="space-y-4 max-h-60 overflow-y-auto pr-1 mb-4">
                {messages.length === 0 && <p className="text-[11px] text-slate-600 italic text-center py-6">No messages yet. Start the conversation.</p>}
                {messages.map((msg, i) => {
                  const isMe = msg.sender_id === currentUser.id;
                  const prevMsg = messages[i - 1];
                  const showHeader = !prevMsg || prevMsg.sender_id !== msg.sender_id;
                  const time = format(parseISO(msg.timestamp), 'MMM d, h:mm a');
                  return (
                    <div key={msg.id} className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className="flex-shrink-0 w-7">
                        {showHeader && (
                          <img src={msg.sender_photo || `https://picsum.photos/seed/${msg.sender_id}/100/100`}
                            className={`w-7 h-7 rounded-full object-cover border-2 ${msg.sender_role === 'Director' ? 'border-[#ff00ff]/40' : 'border-[#00ffff]/40'}`} alt="" />
                        )}
                      </div>
                      <div className={`flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                        {showHeader && (
                          <div className={`flex items-center gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}>
                            <span className="text-[10px] font-bold text-slate-400">{msg.sender_name}</span>
                            <span className="text-[9px] text-slate-600">{time}</span>
                          </div>
                        )}
                        <div className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${isMe ? 'bg-[#ff00ff]/20 text-white rounded-tr-sm border border-[#ff00ff]/20' : 'bg-white/5 text-slate-200 rounded-tl-sm border border-white/5'}`}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input ref={chatInputRef} type="text"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all"
                    placeholder="Type a message…"
                    value={newMessage}
                    onChange={e => { setNewMessage(e.target.value); setChatError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    disabled={sending}
                  />
                  <button type="button" onClick={sendMessage} disabled={!newMessage.trim() || sending}
                    className="px-4 py-2.5 rounded-xl bg-[#ff00ff] text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0 shadow-lg shadow-[#ff00ff]/20"
                  >
                    {sending ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : <><Send size={14} />Send</>}
                  </button>
                </div>
                {chatError && <p className="text-[10px] text-[#ff4d4d] font-semibold">{chatError}</p>}
              </div>
            </div>
          </div>

          {/* Footer (edit mode) */}
          {isDirector && isEditing && (
            <div className="flex gap-3 px-8 py-5 border-t border-white/5 flex-shrink-0">
              <button onClick={handleCancel} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[#ff00ff] text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-[#ff00ff]/20 flex items-center justify-center gap-2"
              >
                <Save size={14} />{saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
