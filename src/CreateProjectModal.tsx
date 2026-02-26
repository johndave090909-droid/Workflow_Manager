import React, { useState } from 'react';
import { X } from 'lucide-react';
import { User, ProjectStatus, ProjectPriority, Department } from './types';
import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface CreateProjectModalProps {
  adminUsers: User[];
  currentUser: User;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateProjectModal({ adminUsers, currentUser, onClose, onCreated }: CreateProjectModalProps) {
  const [form, setForm] = useState({
    name:               '',
    assignee_ids:       adminUsers[0] ? [adminUsers[0].id] : [] as string[],
    status:             'Not Started' as ProjectStatus,
    priority:           'Medium'      as ProjectPriority,
    department:         'Business'    as Department,
    start_date:         '',
    end_date:           '',
    directors_note:     '',
    is_priority_focus:  false,
    is_time_critical:   false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const toggleAssignee = (id: string) => {
    setForm(f => ({
      ...f,
      assignee_ids: f.assignee_ids.includes(id)
        ? f.assignee_ids.filter(x => x !== id)
        : [...f.assignee_ids, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim())              { setError('Project name is required.'); return; }
    if (form.assignee_ids.length === 0) { setError('Please assign this project to at least one person.'); return; }

    setSubmitting(true);
    setError('');
    try {
      const selectedUsers  = adminUsers.filter(u => form.assignee_ids.includes(u.id));
      const primaryLead    = selectedUsers[0];
      await addDoc(collection(db, 'projects'), {
        name:               form.name.trim(),
        account_lead_id:    primaryLead?.id   ?? '',
        account_lead_name:  primaryLead?.name ?? '',
        assignee_ids:       form.assignee_ids,
        assignee_names:     selectedUsers.map(u => u.name),
        status:             form.status,
        priority:           form.priority,
        department:         form.department,
        start_date:         form.start_date  || null,
        end_date:           form.end_date    || null,
        directors_note:     form.directors_note || null,
        is_priority_focus:  form.is_priority_focus,
        is_time_critical:   form.is_time_critical,
        created_at:         serverTimestamp(),
      });
      await addDoc(collection(db, 'audit_trail'), {
        user_id:    currentUser.id,
        user_name:  currentUser.name,
        action:     'CREATE_PROJECT',
        details:    `Created project: ${form.name.trim()}`,
        timestamp:  serverTimestamp(),
      });
      onCreated();
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls  = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all';
  const selectCls = 'w-full bg-[#1e1130] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ff00ff] transition-all';
  const labelCls  = 'block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl shadow-[#ff00ff]/10 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/5">
          <h2 className="text-xl font-bold text-[#ff00ff] drop-shadow-[0_0_8px_rgba(255,0,255,0.5)]">New Project</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1"><X size={20} /></button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5 max-h-[75vh] overflow-y-auto">
          <div>
            <label className={labelCls}>Project Name *</label>
            <input type="text" className={inputCls} placeholder="Enter project name..."
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* ── Multi-user assignee selector ── */}
          <div>
            <label className={labelCls}>
              Assign To *
              {form.assignee_ids.length > 0 && (
                <span className="ml-2 normal-case font-bold text-[#ff00ff]">
                  {form.assignee_ids.length} selected
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              {adminUsers.map(u => {
                const selected = form.assignee_ids.includes(u.id);
                const isPrimary = form.assignee_ids[0] === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleAssignee(u.id)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all"
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Department</label>
              <select className={selectCls} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value as Department }))}>
                {(['Business', 'Finance', 'Personal', 'Health'] as Department[]).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select className={selectCls} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                {(['High', 'Medium', 'Low'] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Status</label>
            <select className={selectCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ProjectStatus }))}>
              {(['Not Started', 'In Progress', 'On Hold', 'Done'] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" className={inputCls} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" className={inputCls} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Director's Note</label>
            <textarea className={inputCls + ' resize-none h-20'} placeholder="Optional note..."
              value={form.directors_note} onChange={e => setForm(f => ({ ...f, directors_note: e.target.value }))} />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${form.is_priority_focus ? 'bg-[#ff00ff] border-[#ff00ff]' : 'border-white/20 group-hover:border-[#ff00ff]/50'}`}
                onClick={() => setForm(f => ({ ...f, is_priority_focus: !f.is_priority_focus }))}>
                {form.is_priority_focus && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <span className="text-xs font-semibold text-slate-300">Priority Focus</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${form.is_time_critical ? 'bg-[#ff4d4d] border-[#ff4d4d]' : 'border-white/20 group-hover:border-[#ff4d4d]/50'}`}
                onClick={() => setForm(f => ({ ...f, is_time_critical: !f.is_time_critical }))}>
                {form.is_time_critical && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <span className="text-xs font-semibold text-slate-300">Time Critical</span>
            </label>
          </div>

          {error && <p className="text-[#ff4d4d] text-xs font-semibold">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all text-sm font-bold">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-xl bg-[#ff00ff] text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-[#ff00ff]/20">
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
