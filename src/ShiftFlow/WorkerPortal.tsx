import React, { useState } from 'react';
import { db, storage } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Upload, CheckCircle2, AlertCircle, ImageIcon, LogIn, Sparkles, Trash2, RefreshCw } from 'lucide-react';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function fmt12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

interface ExtractedEntry {
  id: string;
  day: number;
  startTime: string;
  endTime: string;
  label: string;
}

interface WorkerData {
  rowId: string;
  workerId: string;
  name: string;
}

const COLORS = [
  '#6366f1','#ec4899','#14b8a6','#f97316','#84cc16','#06b6d4','#10b981',
  '#f59e0b','#8b5cf6','#3b82f6','#ef4444','#a855f7',
];
function workerColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return COLORS[h % COLORS.length];
}

type Step = 'login' | 'upload' | 'processing' | 'preview' | 'saving' | 'saved';

export default function WorkerPortal() {
  const [step, setStep] = useState<Step>('login');
  const [idInput, setIdInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [worker, setWorker] = useState<WorkerData | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedEntry[]>([]);
  const [extractError, setExtractError] = useState('');
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

      setWorker({ rowId: match.id, workerId: trimmed, name: fullName });
      setStep('upload');
    } catch {
      setLoginError('Something went wrong. Please try again.');
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
    setExtracted([]);
    setExtractError('');
  }

  // ── Process with AI ────────────────────────────────────────────────────────
  async function processImage() {
    if (!imagePreview) return;
    setStep('processing');
    setExtractError('');
    try {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      if (!apiKey) throw new Error('OpenAI API key not configured.');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are a schedule grid reader. You read class schedule images column by column (one day at a time). You ONLY include a class on a day if you can see its colored block physically present in that day\'s column. You never guess, assume, or copy entries across days.',
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imagePreview } },
                {
                  type: 'text',
                  text: `Read this class schedule image column by column, left to right.

For each day column (Monday through Sunday), look at ONLY that column and list the colored class blocks visible in it — their course name, start time, and end time.

RULES:
- Only include a class on a day if its block is PHYSICALLY VISIBLE in that day's column.
- When in doubt about a day, leave it out — it is better to miss one than to add a wrong one.
- Same course on different days = separate entries.
- Times in 24-hour HH:MM format (e.g. 13:30).

Day numbers: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6

Return ONLY a raw JSON array, no markdown, no explanation:
[{"day":0,"startTime":"11:00","endTime":"11:50","label":"COMM 251-01 Lecture"},{"day":3,"startTime":"09:30","endTime":"10:45","label":"ECON 201-02 Lecture"}]`,
                },
              ],
            },
          ],
          max_tokens: 2000,
        }),
      });

      if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);

      const data = await response.json();
      const text: string = data.choices?.[0]?.message?.content ?? '';

      // Strip markdown fences if model wraps anyway
      const clean = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const parsed: Array<{ day: number; startTime: string; endTime: string; label: string }> = JSON.parse(clean);

      setExtracted(parsed.map((e, i) => ({ ...e, id: `ai-${i}-${Date.now()}` })));
      setStep('preview');
    } catch (err) {
      console.error(err);
      setExtractError('Could not read your schedule. Make sure the image is clear and try again.');
      setStep('upload');
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!worker || !imageFile) return;
    setStep('saving');
    setSaveError('');
    try {
      // Upload image to Storage
      const storageRef = ref(storage, `shiftflow-schedules/${worker.rowId}`);
      await uploadBytes(storageRef, imageFile);
      const imageUrl = await getDownloadURL(storageRef);

      // Convert extracted entries to Unavailability format
      const unavailability = extracted.map(e => ({
        id: e.id,
        date: '',
        dayOfWeek: e.day,
        startTime: e.startTime,
        endTime: e.endTime,
        label: e.label,
      }));

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
              scheduleImageUrl: imageUrl,
              needsReview: true,
            },
          },
        },
        { merge: true }
      );

      setStep('saved');
    } catch (err) {
      console.error(err);
      setSaveError('Failed to save. Please try again.');
      setStep('preview');
    }
  }

  // Group entries by day for display
  const byDay = DAY_NAMES.reduce<Record<number, ExtractedEntry[]>>((acc, _, i) => {
    acc[i] = extracted.filter(e => e.day === i);
    return acc;
  }, {});

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans flex flex-col items-center justify-center p-4">
      {/* Logo */}
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
                {loginLoading
                  ? <div className="w-4 h-4 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin" />
                  : <><LogIn size={16} /> Continue</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── STEP: Upload ── */}
      {step === 'upload' && worker && (
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

          {/* Upload card */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wide">Upload Class Schedule</h2>
              <p className="text-xs text-slate-500 mt-1">
                Take a photo or screenshot of your class schedule. Our AI will read it and automatically extract your class times so the scheduler knows when you're unavailable.
              </p>
            </div>

            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Schedule preview"
                  className="w-full max-h-80 object-contain rounded-xl border border-white/10 bg-white/[0.02]"
                />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setExtractError(''); }}
                  className="absolute top-2 right-2 p-1.5 bg-black/50 backdrop-blur rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/10 rounded-xl p-10 cursor-pointer hover:border-[#ff00ff]/30 hover:bg-[#ff00ff]/5 transition-all group">
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:border-[#ff00ff]/30 transition-all">
                  <ImageIcon size={24} className="text-slate-600 group-hover:text-[#ff00ff]/60 transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-400 group-hover:text-slate-300 font-medium transition-colors">Click to upload or drag image here</p>
                  <p className="text-[10px] text-slate-600 mt-1">PNG, JPG, HEIC up to 10 MB</p>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              </label>
            )}

            {!imagePreview && (
              <label className="flex items-center gap-2 w-fit px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 text-xs font-bold cursor-pointer transition-all">
                <Upload size={13} />
                Choose file
                <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              </label>
            )}

            {extractError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
                <p className="text-xs text-rose-300">{extractError}</p>
              </div>
            )}

            {imagePreview && (
              <button
                onClick={processImage}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] font-bold hover:bg-[#ff00ff]/30 transition-all"
              >
                <Sparkles size={16} />
                Process Schedule with AI
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP: Processing ── */}
      {step === 'processing' && (
        <div className="w-full max-w-sm text-center">
          <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-12 space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-[#ff00ff]/10 border border-[#ff00ff]/20 flex items-center justify-center mx-auto">
              <Sparkles size={28} className="text-[#ff00ff] animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white mb-2">Reading your schedule…</h2>
              <p className="text-xs text-slate-500">Our AI is extracting your class times. This takes a few seconds.</p>
            </div>
            <div className="flex justify-center gap-1.5">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#ff00ff]/50 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: Preview / Saving ── */}
      {(step === 'preview' || step === 'saving') && worker && (
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

          {/* Extracted schedule */}
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wide">Extracted Schedule</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review your extracted class times. These will be saved as your unavailability so shifts are only assigned when you're free.
                </p>
              </div>
              <button
                onClick={() => setStep('upload')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-xs font-bold transition-all shrink-0"
              >
                <RefreshCw size={11} /> Re-upload
              </button>
            </div>

            {extracted.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500">No classes were found in the image.</p>
                <button
                  onClick={() => setStep('upload')}
                  className="mt-3 text-xs text-[#ff00ff]/70 hover:text-[#ff00ff] underline underline-offset-2 transition-colors"
                >
                  Try a different image
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {DAY_NAMES.map((day, i) => {
                  const entries = byDay[i];
                  if (!entries.length) return null;
                  return (
                    <div key={i}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1.5">{day}</p>
                      <div className="space-y-1.5">
                        {entries.map(e => (
                          <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                            <div className="flex items-center gap-1.5 tabular-nums shrink-0">
                              <span className="text-sm font-bold text-white">{fmt12(e.startTime)}</span>
                              <span className="text-slate-600 text-xs">–</span>
                              <span className="text-sm font-bold text-white">{fmt12(e.endTime)}</span>
                            </div>
                            <span className="text-xs text-slate-400 truncate">{e.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-300">{saveError}</p>
            </div>
          )}

          {extracted.length > 0 && (
            <button
              onClick={handleSave}
              disabled={step === 'saving'}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] font-bold hover:bg-[#ff00ff]/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {step === 'saving'
                ? <><div className="w-4 h-4 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin" /> Saving…</>
                : <><CheckCircle2 size={16} /> Confirm & Save Schedule</>}
            </button>
          )}
        </div>
      )}

      {/* ── STEP: Saved ── */}
      {step === 'saved' && worker && (
        <div className="w-full max-w-sm text-center">
          <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-10">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <h2 className="text-xl font-black text-white mb-2">Schedule saved!</h2>
            <p className="text-sm text-slate-400 mb-6">
              Your class schedule has been extracted and saved. The shift scheduler will automatically respect your class times.
            </p>
            <button
              onClick={() => { setStep('upload'); setImageFile(null); setImagePreview(null); setExtracted([]); }}
              className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
            >
              Upload a new schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
