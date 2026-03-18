import React, { useState } from 'react';
import { db, storage } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Upload, CheckCircle2, AlertCircle, ImageIcon, LogIn, Sparkles, Trash2, RefreshCw } from 'lucide-react';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmt12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

const BLOCK_COLORS = ['#6366f1','#ec4899','#14b8a6','#f97316','#84cc16','#8b5cf6','#ef4444','#3b82f6','#a855f7','#06b6d4'];
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function ScheduleCalendar({ entries, onRemove }: {
  entries: ExtractedEntry[];
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return <p className="text-xs text-slate-600 italic">No classes found.</p>;

  const activeDays = [...new Set(entries.map(e => e.day))].sort((a, b) => a - b);

  const allMins = entries.flatMap(e => [toMin(e.startTime), toMin(e.endTime)]);
  const minTime = Math.floor(Math.min(...allMins) / 60) * 60;
  const maxTime = Math.ceil(Math.max(...allMins) / 60) * 60;
  const range = Math.max(maxTime - minTime, 120);
  const PX = 1.5;
  const totalH = range * PX;
  const startHour = minTime / 60;
  const endHour = maxTime / 60;
  const hourTicks = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  const colorMap: Record<string, string> = {};
  let ci = 0;
  entries.forEach(e => {
    const key = e.label || '__block__';
    if (!colorMap[key]) colorMap[key] = BLOCK_COLORS[ci++ % BLOCK_COLORS.length];
  });

  const fmtHour = (h: number) => h === 0 ? '12AM' : h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`;

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.015]">
      <div className="flex min-w-max p-2 gap-0">
        {/* Time axis */}
        <div className="relative w-10 shrink-0 mr-0.5" style={{ height: totalH, marginTop: 20 }}>
          {hourTicks.map(h => (
            <div key={h} className="absolute right-1" style={{ top: (h * 60 - minTime) * PX - 5 }}>
              <span className="text-[7px] text-slate-700 whitespace-nowrap tabular-nums">{fmtHour(h)}</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {activeDays.map(dayIdx => {
          const dayEntries = entries.filter(e => e.day === dayIdx);
          return (
            <div key={dayIdx} className="w-[112px] shrink-0">
              <div className="text-center h-5 flex items-center justify-center">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {DAY_SHORT[dayIdx]}
                </span>
              </div>
              <div className="relative border-l border-white/[0.06]" style={{ height: totalH }}>
                {hourTicks.map(h => (
                  <div key={h} className="absolute w-full border-t border-white/[0.04]" style={{ top: (h * 60 - minTime) * PX }} />
                ))}
                {dayEntries.map(e => {
                  const top = (toMin(e.startTime) - minTime) * PX;
                  const height = Math.max((toMin(e.endTime) - toMin(e.startTime)) * PX, 22);
                  const color = colorMap[e.label || '__block__'];
                  const timeRange = `${fmt12(e.startTime)} – ${fmt12(e.endTime)}`;
                  return (
                    <div
                      key={e.id}
                      className="absolute inset-x-0.5 rounded overflow-hidden px-1.5 py-1 group cursor-default"
                      style={{ top, height, backgroundColor: `${color}22`, borderLeft: `2px solid ${color}70` }}
                    >
                      {height >= 14 && (
                        <p className="text-[8px] font-bold leading-tight line-clamp-2 pr-3" style={{ color: `${color}cc` }}>
                          {e.label || 'Class'}
                        </p>
                      )}
                      {height >= 32 && (
                        <p className="text-[7px] tabular-nums mt-0.5" style={{ color: `${color}99` }}>{timeRange}</p>
                      )}
                      {height >= 14 && height < 32 && (
                        <p className="text-[6px] tabular-nums leading-tight" style={{ color: `${color}80` }}>{timeRange}</p>
                      )}
                      <button
                        onClick={() => onRemove(e.id)}
                        className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={8} className="text-slate-500 hover:text-rose-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('Anthropic API key not configured.');

      // Extract base64 data and media type from the data URL
      const match = imagePreview.match(/^data:(.+);base64,(.+)$/);
      if (!match) throw new Error('Invalid image format.');
      const rawType = match[1];
      const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!supportedTypes.includes(rawType)) {
        throw new Error(`Unsupported image format: ${rawType}. Please use JPG, PNG, or WebP.`);
      }
      const mediaType = rawType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      const base64Data = match[2];

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: 'You are a precise class schedule extractor. You read schedule grid images accurately, identify every colored class block per day column, and never add entries that are not visibly present in the image.',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: `Extract all class schedule entries from this image. For each colored class block, output one entry per day it appears on.

Day numbers: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
Times in 24-hour HH:MM format.

Return ONLY a raw JSON array, no markdown, no explanation:
[{"day":0,"startTime":"08:00","endTime":"08:50","label":"CS 101-01 Lecture"},{"day":3,"startTime":"08:00","endTime":"09:15","label":"BUSM 361-01 Lecture"}]`,
              },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(msg);
      }

      const data = await response.json();
      const text: string = data.content?.[0]?.text ?? '';

      // Strip markdown fences if model wraps anyway
      const clean = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
      const parsed: Array<{ day: number; startTime: string; endTime: string; label: string }> = JSON.parse(clean);

      setExtracted(parsed.map((e, i) => ({ ...e, id: `ai-${i}-${Date.now()}` })));
      setStep('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Schedule extraction failed:', msg);
      setExtractError(msg.startsWith('Unsupported') ? msg : `Could not read your schedule: ${msg}`);
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
                Take a photo or screenshot of your class schedule. The system will automatically extract your class times so the scheduler knows when you're unavailable.
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
                Process Schedule
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
              <p className="text-xs text-slate-500">The system is extracting your class times. This takes a few seconds.</p>
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
                  Review your extracted class times. Remove any incorrect entries, then confirm to save.
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
              <ScheduleCalendar
                entries={extracted}
                onRemove={id => setExtracted(prev => prev.filter(x => x.id !== id))}
              />
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
