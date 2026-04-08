import React, { useEffect, useState } from 'react';
import { ArrowLeft, Edit2, Check, X, MapPin, FileText } from 'lucide-react';
import { db } from '../firebase';
import {
  collection, onSnapshot, orderBy, query, doc, getDoc, updateDoc,
} from 'firebase/firestore';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts';
import { User } from '../types';

type Apprentice = {
  id: string;
  name: string;
  role?: string;
  location?: string;
  desc?: string;
  sortOrder: number;
  progress?: Record<string, number>;
};

const PROGRESS_CATEGORIES = [
  'RTI Hours',
  'OJT Hours',
  'OJT Days',
  'Competencies',
  'Journey Progress',
];

const COLOR = '#6366f1';
const GOLD = '#C9A84C';

// ── Apprentice card ────────────────────────────────────────────────────

interface ApprenticeCardProps {
  apprentice: Apprentice;
  canEdit: boolean;
}

function ApprenticeCard({ apprentice, canEdit }: ApprenticeCardProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: apprentice.name,
    role: apprentice.role ?? '',
    location: apprentice.location ?? '',
    desc: apprentice.desc ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Keep form in sync if parent data refreshes
  useEffect(() => {
    if (!editing) {
      setForm({
        name: apprentice.name,
        role: apprentice.role ?? '',
        location: apprentice.location ?? '',
        desc: apprentice.desc ?? '',
      });
    }
  }, [apprentice, editing]);

  const radarData = PROGRESS_CATEGORIES.map(cat => ({
    subject: cat,
    value: apprentice.progress?.[cat] ?? 0,
  }));
  const avg = Math.round(radarData.reduce((s, d) => s + d.value, 0) / radarData.length);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'ccbl_apprentices', apprentice.id), {
        name: form.name.trim(),
        role: form.role.trim() || null,
        location: form.location.trim() || null,
        desc: form.desc.trim() || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({
      name: apprentice.name,
      role: apprentice.role ?? '',
      location: apprentice.location ?? '',
      desc: apprentice.desc ?? '',
    });
    setEditing(false);
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 hover:border-indigo-500/30 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Name *"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              <input
                type="text"
                placeholder="Role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              <input
                type="text"
                placeholder="Country / Organization"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              <textarea
                placeholder="Short description"
                value={form.desc}
                onChange={e => setForm(f => ({ ...f, desc: e.target.value }))}
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors disabled:opacity-40"
                >
                  <Check size={12} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-all"
                >
                  <X size={12} /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-white font-semibold text-sm leading-snug">{apprentice.name}</p>
              {apprentice.role && (
                <p className="text-indigo-400 text-xs mt-0.5 font-medium">{apprentice.role}</p>
              )}
              {apprentice.location && (
                <p className="text-slate-500 text-[11px] mt-1 flex items-center gap-1">
                  <MapPin size={10} className="shrink-0" />
                  {apprentice.location}
                </p>
              )}
              {apprentice.desc && (
                <p className="text-slate-500 text-[11px] mt-1.5 flex items-start gap-1 leading-relaxed">
                  <FileText size={10} className="shrink-0 mt-0.5" />
                  {apprentice.desc}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <span className="text-indigo-400 font-bold text-xl">{avg}%</span>
            <p className="text-slate-600 text-[10px] uppercase tracking-wider">Overall</p>
          </div>
          {canEdit && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all border border-white/5 hover:border-indigo-500/30"
              title="Edit apprentice"
            >
              <Edit2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-700"
          style={{ width: `${avg}%` }}
        />
      </div>

      {/* Radar chart */}
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 9 }} />
            <Radar name={apprentice.name} dataKey="value" stroke={COLOR} fill={COLOR} fillOpacity={0.25} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-category bars */}
      <div className="flex flex-col gap-2">
        {radarData.map(d => (
          <div key={d.subject} className="flex items-center gap-2">
            <span className="text-slate-500 text-[10px] w-28 shrink-0 truncate">{d.subject}</span>
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${d.value}%`, backgroundColor: COLOR }} />
            </div>
            <span className="text-slate-400 text-[10px] w-6 text-right">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

interface ApprenticeProgramProps {
  onBackToHub: () => void;
  currentUser: User;
}

export default function ApprenticeProgram({ onBackToHub, currentUser }: ApprenticeProgramProps) {
  const [apprentices, setApprentices] = useState<Apprentice[]>([]);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_apprentices'), orderBy('sortOrder'));
    return onSnapshot(q, snap => {
      setApprentices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Apprentice)));
    });
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'ccbl_editor_access', currentUser.id)).then(snap => {
      setCanEdit(snap.exists());
    });
  }, [currentUser.id]);

  return (
    <div className="min-h-screen bg-[#0a0510] text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0510]/90 backdrop-blur-md border-b border-white/10 px-4 sm:px-8 h-16 flex items-center gap-4">
        <button onClick={onBackToHub} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-white leading-tight">Apprentice Program</h1>
          <p className="text-slate-500 text-xs">Progress tracking for CCBL apprentices</p>
        </div>
        {canEdit && (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
            Editor
          </span>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">

        {/* Summary bar */}
        {apprentices.length > 0 && (
          <div className="mb-8 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-5 flex flex-wrap gap-6">
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Apprentices</p>
              <p className="text-white text-2xl font-bold">{apprentices.length}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Avg. Overall Progress</p>
              <p className="text-indigo-400 text-2xl font-bold">
                {Math.round(
                  apprentices.reduce((sum, a) => {
                    const vals = PROGRESS_CATEGORIES.map(c => a.progress?.[c] ?? 0);
                    return sum + vals.reduce((s, v) => s + v, 0) / vals.length;
                  }, 0) / apprentices.length
                )}%
              </p>
            </div>
            {canEdit && (
              <div className="flex-1 flex items-center gap-2 text-indigo-400 text-xs font-semibold">
                <Edit2 size={13} />
                Click the edit icon on any card to update apprentice details.
              </div>
            )}
          </div>
        )}

        {apprentices.length === 0 ? (
          <div className="text-center py-24 text-slate-600 italic text-sm">
            No apprentices found. Add them in CCBL Apprentices first.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {apprentices.map(a => (
              <ApprenticeCard key={a.id} apprentice={a} canEdit={canEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
