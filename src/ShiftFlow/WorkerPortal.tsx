import React, { useState } from 'react';
import { db, storage } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Plus, Trash2, Upload, CheckCircle2, AlertCircle, ImageIcon, LogIn } from 'lucide-react';

interface Unavailability {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  label?: string;
}

interface WorkerData {
  rowId: string;
  workerId: string;
  name: string;
  unavailability: Unavailability[];
  scheduleImageUrl?: string;
  departmentId?: string;
  positionId?: string;
}

type Step = 'login' | 'portal' | 'saved';

const COLORS = [
  '#6366f1','#ec4899','#14b8a6','#f97316','#84cc16','#06b6d4','#10b981',
  '#f59e0b','#8b5cf6','#3b82f6','#ef4444','#a855f7',
];
function workerColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return COLORS[h % COLORS.length];
}

export default function WorkerPortal() {
  const [step, setStep] = useState<Step>('login');
  const [idInput, setIdInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [worker, setWorker] = useState<WorkerData | null>(null);
  const [unavailability, setUnavailability] = useState<Unavailability[]>([]);
  const [scheduleImageUrl, setScheduleImageUrl] = useState<string | undefined>();

  const [addForm, setAddForm] = useState({ startTime: '08:00', endTime: '10:00', label: '' });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Login ──────────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = idInput.trim();
    if (!trimmed) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const rosterSnap = await getDoc(doc(db, 'worker_roster', 'main'));
      const rows: Array<{ id: string; workerId?: string; idNumber?: string; firstName?: string; lastName?: string; name?: string }> =
        Array.isArray(rosterSnap.data()?.rows) ? rosterSnap.data()!.rows : [];

      const match = rows.find(r =>
        (r.workerId && r.workerId.trim() === trimmed) ||
        (r.idNumber && r.idNumber.trim() === trimmed)
      );

      if (!match) {
        setLoginError('No record found for that Worker ID. Please check with your manager.');
        setLoginLoading(false);
        return;
      }

      const fullName = match.name ||
        `${match.firstName ?? ''} ${match.lastName ?? ''}`.trim() || 'Worker';

      // Load existing shiftflow assignments for this worker
      const configSnap = await getDoc(doc(db, 'shiftflow', 'config'));
      const saved = configSnap.data()?.assignments?.[match.id] ?? {};

      setWorker({
        rowId: match.id,
        workerId: trimmed,
        name: fullName,
        unavailability: saved.unavailability ?? [],
        scheduleImageUrl: saved.scheduleImageUrl,
        departmentId: saved.departmentId,
        positionId: saved.positionId,
      });
      setUnavailability(saved.unavailability ?? []);
      setScheduleImageUrl(saved.scheduleImageUrl);
      setStep('portal');
    } catch (err) {
      setLoginError('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setLoginLoading(false);
    }
  }

  // ── Image pick ─────────────────────────────────────────────────────────────
  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  // ── Remove unavailability ──────────────────────────────────────────────────
  function removeUn(id: string) {
    setUnavailability(prev => prev.filter(u => u.id !== id));
  }

  // ── Add unavailability ─────────────────────────────────────────────────────
  function addUn() {
    if (!addForm.startTime || !addForm.endTime) return;
    const trimmedLabel = addForm.label.trim();
    setUnavailability(prev => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        date: '',
        startTime: addForm.startTime,
        endTime: addForm.endTime,
        ...(trimmedLabel ? { label: trimmedLabel } : {}),
      },
    ]);
    setAddForm({ startTime: '08:00', endTime: '10:00', label: '' });
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!worker) return;
    setSaving(true);
    setSaveError('');
    try {
      let finalImageUrl = scheduleImageUrl;

      if (imageFile) {
        setUploading(true);
        const storageRef = ref(storage, `shiftflow-schedules/${worker.rowId}`);
        await uploadBytes(storageRef, imageFile);
        finalImageUrl = await getDownloadURL(storageRef);
        setUploading(false);
      }

      const configSnap = await getDoc(doc(db, 'shiftflow', 'config'));
      const existing = configSnap.data()?.assignments ?? {};

      await setDoc(
        doc(db, 'shiftflow', 'config'),
        {
          assignments: {
            ...existing,
            [worker.rowId]: {
              ...(existing[worker.rowId] ?? {}),
              unavailability,
              scheduleImageUrl: finalImageUrl ?? null,
              needsReview: true,
            },
          },
        },
        { merge: true }
      );

      setScheduleImageUrl(finalImageUrl);
      setImageFile(null);
      setImagePreview(null);
      setStep('saved');
    } catch (err) {
      setSaveError('Failed to save. Please try again.');
      setUploading(false);
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans flex flex-col items-center justify-center p-4">
      {/* Logo / brand */}
      <div className="mb-8 text-center">
        <div className="w-14 h-14 bg-gradient-to-br from-[#ff00ff]/50 to-violet-600/50 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl font-black text-white">SF</span>
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">ShiftFlow · Worker Portal</p>
      </div>

      {/* ── STEP: Login ── */}
      {step === 'login' && (
        <div className="w-full max-w-sm">
          <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-8">
            <h1 className="text-2xl font-black text-white mb-1">Enter your Worker ID</h1>
            <p className="text-sm text-slate-500 mb-6">Your ID is the number assigned to you in the system.</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1.5">Worker ID</label>
                <input
                  type="text"
                  value={idInput}
                  onChange={e => { setIdInput(e.target.value); setLoginError(''); }}
                  placeholder="e.g. 2081500"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-[#ff00ff]/40 text-base font-mono"
                  autoFocus
                />
              </div>

              {loginError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <AlertCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-rose-300">{loginError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || !idInput.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] font-bold hover:bg-[#ff00ff]/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loginLoading ? (
                  <div className="w-4 h-4 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn size={16} />
                    Continue
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── STEP: Portal ── */}
      {step === 'portal' && worker && (
        <div className="w-full max-w-lg space-y-5">
          {/* Worker header */}
          <div className="flex items-center gap-4 bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-lg shrink-0"
              style={{ backgroundColor: workerColor(worker.rowId) }}
            >
              {worker.name.charAt(0)}
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-tight">{worker.name}</p>
              <p className="text-[10px] text-slate-500 font-mono">ID {worker.workerId}</p>
            </div>
          </div>

          {/* Unavailability section */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wide">My Unavailability</h2>
              <p className="text-xs text-slate-500 mt-0.5">Time blocks when you cannot work — applies for the whole semester.</p>
            </div>

            {/* Existing entries */}
            {unavailability.length > 0 ? (
              <div className="space-y-2">
                {unavailability.map(un => (
                  <div key={un.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white tabular-nums">{un.startTime}</span>
                        <span className="text-slate-600 text-xs">–</span>
                        <span className="text-sm font-bold text-white tabular-nums">{un.endTime}</span>
                      </div>
                      {un.label && (
                        <span className="text-[10px] text-slate-400 truncate">{un.label}</span>
                      )}
                    </div>
                    <button onClick={() => removeUn(un.id)} className="p-1 text-slate-600 hover:text-rose-400 transition-colors shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No unavailability added yet.</p>
            )}

            {/* Add form */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Add time block</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Start</label>
                  <input
                    type="time"
                    value={addForm.startTime}
                    onChange={e => setAddForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#ff00ff]/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">End</label>
                  <input
                    type="time"
                    value={addForm.endTime}
                    onChange={e => setAddForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#ff00ff]/40"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Label (optional)</label>
                <input
                  type="text"
                  value={addForm.label}
                  onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Chemistry class, Doctor's appointment"
                  className="w-full bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#ff00ff]/40 placeholder-slate-700"
                />
              </div>
              <button
                onClick={addUn}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff00ff]/15 border border-[#ff00ff]/30 text-[#ff00ff] text-xs font-bold hover:bg-[#ff00ff]/25 transition-colors"
              >
                <Plus size={12} /> Add Block
              </button>
            </div>
          </div>

          {/* Schedule image section */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wide">Class Schedule Photo</h2>
              <p className="text-xs text-slate-500 mt-0.5">Upload a photo of your class schedule for reference.</p>
            </div>

            {/* Existing or new image preview */}
            {(imagePreview || scheduleImageUrl) ? (
              <div className="relative">
                <img
                  src={imagePreview ?? scheduleImageUrl}
                  alt="Schedule"
                  className="w-full max-h-72 object-contain rounded-xl border border-white/10 bg-white/[0.02]"
                />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setScheduleImageUrl(undefined); }}
                  className="absolute top-2 right-2 p-1.5 bg-black/50 backdrop-blur rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-white/10 rounded-xl p-8 cursor-pointer hover:border-[#ff00ff]/30 hover:bg-[#ff00ff]/5 transition-all group">
                <ImageIcon size={28} className="text-slate-700 group-hover:text-[#ff00ff]/50 transition-colors" />
                <span className="text-xs text-slate-600 group-hover:text-slate-400 transition-colors">Click to upload or drag image here</span>
                <span className="text-[10px] text-slate-700">PNG, JPG, HEIC up to 10 MB</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              </label>
            )}

            {!imagePreview && !scheduleImageUrl && (
              <label className="flex items-center gap-2 w-fit px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 text-xs font-bold cursor-pointer transition-all">
                <Upload size={13} />
                Choose file
                <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              </label>
            )}
          </div>

          {/* Save */}
          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-300">{saveError}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 rounded-2xl bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] font-bold text-sm hover:bg-[#ff00ff]/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin" />
                {uploading ? 'Uploading image…' : 'Saving…'}
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                Save & Submit
              </>
            )}
          </button>
        </div>
      )}

      {/* ── STEP: Saved ── */}
      {step === 'saved' && worker && (
        <div className="w-full max-w-sm text-center">
          <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-10">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-black text-white mb-2">All saved!</h2>
            <p className="text-sm text-slate-400 mb-6">
              Your unavailability and schedule have been saved to your record.
              Your manager can now see your availability when building the shift schedule.
            </p>
            <button
              onClick={() => {
                setStep('portal');
                setSaveError('');
              }}
              className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
            >
              Make another change
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
