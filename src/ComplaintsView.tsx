import React, { useState, useEffect, useRef } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore – Vite ?url import for the local worker bundle
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { db, storage } from './firebase';
import {
  collection, getDocs, addDoc, deleteDoc, doc, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { User } from './types';

// Use the locally bundled worker (avoids CDN version mismatch)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Complaint {
  id: string;
  date: string;
  description: string;
  rawText: string;
  translatedText?: string;      // persisted after first translation
  detectedLang?: string;        // e.g. "Filipino", "Spanish"
  source: string;
  pdfUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
}

// ── Translation (MyMemory – free, no key required) ─────────────────────────────

const TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const CHUNK_SIZE = 450; // MyMemory free-tier safe limit

async function translateChunk(text: string): Promise<{ translated: string; lang: string }> {
  const url = `${TRANSLATE_URL}?q=${encodeURIComponent(text)}&langpair=autodetect|en-US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Translation request failed');
  const data = await res.json();
  const translated: string = data?.responseData?.translatedText ?? text;
  // MyMemory returns detected source as "xx-YY" in responseDetails sometimes
  const langRaw: string = data?.responseData?.detectedLanguage ?? '';
  return { translated, lang: langRaw };
}

async function translateText(text: string): Promise<{ translated: string; lang: string }> {
  if (!text.trim()) return { translated: text, lang: '' };
  // Split into chunks to stay within API limits
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  const results = await Promise.all(chunks.map(translateChunk));
  return {
    translated: results.map(r => r.translated).join(' '),
    lang: results[0]?.lang ?? '',
  };
}

// Rough English detection: >80% ASCII printable chars → likely already English
function looksEnglish(text: string): boolean {
  if (!text) return true;
  const ascii = text.split('').filter(c => c.charCodeAt(0) < 128).length;
  return ascii / text.length > 0.85;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

const DATE_PATTERNS = [
  /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
];

function extractDate(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function parseToISO(raw: string): string {
  const d = new Date(raw);
  if (isValid(d) && d.getFullYear() > 2000) return d.toISOString().slice(0, 10);
  const mmddyyyy = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mmddyyyy) {
    const [, m, day, yr] = mmddyyyy;
    const year = yr.length === 2 ? `20${yr}` : yr;
    const d2 = new Date(`${year}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`);
    if (isValid(d2)) return d2.toISOString().slice(0, 10);
  }
  return raw;
}

function displayDate(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isValid(d)) return format(d, 'MMM d, yyyy');
  } catch {}
  return iso;
}

// ── PDF extraction ─────────────────────────────────────────────────────────────

async function extractTextFromPDF(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s{2,}/g, '\n')
      .trim();
    if (text) pages.push(text);
  }
  return pages;
}

// ── Complaint parser ───────────────────────────────────────────────────────────

function parseComplaintsFromText(
  pages: string[], source: string, pdfUrl: string,
  uploadedBy: string, uploadedByName: string,
): Omit<Complaint, 'id'>[] {
  const fullText = pages.join('\n\n');
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const complaints: Omit<Complaint, 'id'>[] = [];
  let currentDate: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const rawText = buffer.join(' ').trim();
    if (rawText.length < 10) { buffer = []; return; }
    complaints.push({
      date: currentDate ? parseToISO(currentDate) : new Date().toISOString().slice(0, 10),
      description: rawText,
      rawText,
      source, pdfUrl,
      uploadedAt: new Date().toISOString(),
      uploadedBy, uploadedByName,
    });
    buffer = [];
  };

  for (const line of lines) {
    const dateFound = extractDate(line);
    if (dateFound) {
      flush();
      currentDate = dateFound;
      const rest = line.replace(dateFound, '').trim();
      if (rest) buffer.push(rest);
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (complaints.length === 0) {
    fullText.split(/\n{2,}/).filter(p => p.trim().length > 20).forEach(para => {
      const dateFound = extractDate(para);
      complaints.push({
        date: dateFound ? parseToISO(dateFound) : new Date().toISOString().slice(0, 10),
        description: para.replace(dateFound ?? '', '').trim() || para.trim(),
        rawText: para.trim(),
        source, pdfUrl,
        uploadedAt: new Date().toISOString(),
        uploadedBy, uploadedByName,
      });
    });
  }

  return complaints;
}

// ── Duplicate detection ────────────────────────────────────────────────────────

// Jaccard similarity on meaningful words (length > 2)
function textSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? intersection / union : 0;
}

// Two complaints are duplicates if they share the same date AND >50% word overlap
function isDuplicate(existing: Complaint, candidate: Omit<Complaint, 'id'>): boolean {
  if (existing.date !== candidate.date) return false;
  return textSimilarity(existing.rawText, candidate.rawText) > 0.5;
}

// ── Monthly chart helper ───────────────────────────────────────────────────────

function groupByMonth(complaints: Complaint[]): { month: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const c of complaints) {
    try {
      const d = parseISO(c.date);
      if (!isValid(d)) continue;
      const key = format(d, 'MMM yyyy');
      map[key] = (map[key] ?? 0) + 1;
    } catch {}
  }
  return Object.entries(map)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props { currentUser: User; roleColor: string; }

export default function ComplaintsView({ currentUser, roleColor }: Props) {
  const [complaints,     setComplaints]     = useState<Complaint[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [uploading,      setUploading]      = useState(false);
  const [uploadError,    setUploadError]    = useState('');
  const [progress,       setProgress]       = useState('');
  const [search,         setSearch]         = useState('');
  const [dragOver,       setDragOver]       = useState(false);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translatingAll, setTranslatingAll] = useState(false);
  const [mergeResult,    setMergeResult]    = useState<{ added: number; merged: number } | null>(null);
  // AI Insights
  const [aiQuery,        setAiQuery]        = useState('');
  const [aiResponse,     setAiResponse]     = useState('');
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState('');
  const [apiKey,         setApiKey]         = useState(() => localStorage.getItem('wf_openai_key') ?? '');
  const [showKeyInput,   setShowKeyInput]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadComplaints(); }, []);

  const loadComplaints = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'complaints'), orderBy('date', 'desc')));
      setComplaints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Complaint)));
    } catch {}
    setLoading(false);
  };

  // ── Translation ────────────────────────────────────────────────────────────

  const translateOne = async (complaint: Complaint) => {
    if (translatingIds.has(complaint.id)) return;
    setTranslatingIds(prev => new Set(prev).add(complaint.id));
    try {
      const { translated, lang } = await translateText(complaint.rawText);
      // Persist to Firestore so it's remembered
      await updateDoc(doc(db, 'complaints', complaint.id), {
        translatedText: translated,
        detectedLang: lang,
      });
      setComplaints(prev => prev.map(c =>
        c.id === complaint.id ? { ...c, translatedText: translated, detectedLang: lang } : c
      ));
    } catch {}
    setTranslatingIds(prev => { const s = new Set(prev); s.delete(complaint.id); return s; });
  };

  const translateAll = async () => {
    const untranslated = complaints.filter(c => !c.translatedText && !looksEnglish(c.rawText));
    if (!untranslated.length) return;
    setTranslatingAll(true);
    for (const c of untranslated) {
      await translateOne(c);
      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 300));
    }
    setTranslatingAll(false);
  };

  // ── AI Insights ────────────────────────────────────────────────────────────

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('wf_openai_key', key);
  };

  const callClaudeAPI = async (question: string) => {
    if (!apiKey.trim()) { setShowKeyInput(true); return; }
    if (!complaints.length) { setAiError('No complaints loaded yet.'); return; }
    setAiLoading(true);
    setAiResponse('');
    setAiError('');

    // Build a compact context from the complaints (use translated text when available)
    const context = complaints.slice(0, 100).map((c, i) =>
      `${i + 1}. [${displayDate(c.date)}] ${(c.translatedText || c.description).slice(0, 300)}`
    ).join('\n');

    const systemPrompt =
      `You are a data analyst reviewing a list of ${complaints.length} customer/service complaints.\n\n` +
      `COMPLAINTS DATA:\n${context}\n\n` +
      `Analyse the data and respond clearly and concisely. ` +
      `Use bullet points where appropriate. Be specific and actionable.`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: question },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any)?.error?.message ?? `API error ${res.status}`);
      }

      const data = await res.json();
      setAiResponse(data?.choices?.[0]?.message?.content ?? 'No response.');
    } catch (err: any) {
      setAiError(err.message ?? 'Something went wrong.');
    }
    setAiLoading(false);
  };

  const handleAiSubmit = () => {
    const q = aiQuery.trim();
    if (!q) return;
    callClaudeAPI(q);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    if (!file || file.type !== 'application/pdf') { setUploadError('Please upload a PDF file.'); return; }
    setUploadError('');
    setMergeResult(null);
    setUploading(true);
    try {
      setProgress('Uploading PDF...');
      const storageRef = ref(storage, `complaints/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const pdfUrl = await getDownloadURL(storageRef);

      setProgress('Reading PDF...');
      const pages = await extractTextFromPDF(file);

      setProgress('Parsing complaints...');
      const parsed = parseComplaintsFromText(pages, file.name, pdfUrl, currentUser.id, currentUser.name);

      if (!parsed.length) {
        setUploadError('No complaint entries could be extracted. The PDF may be image-based or have an unrecognised format.');
        setUploading(false); setProgress(''); return;
      }

      // ── Merge / dedup ───────────────────────────────────────────────────────
      setProgress('Checking for duplicates...');
      const existingSnap = await getDocs(query(collection(db, 'complaints'), orderBy('date', 'desc')));
      const existing = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Complaint));

      let added = 0, merged = 0;
      setProgress(`Saving complaints...`);
      for (const candidate of parsed) {
        const dup = existing.find(e => isDuplicate(e, candidate));
        if (dup) {
          // Merge: append the new source name if it isn't already listed
          const sources = dup.source.split(', ');
          if (!sources.includes(candidate.source)) {
            await updateDoc(doc(db, 'complaints', dup.id), {
              source: [...sources, candidate.source].join(', '),
              // If existing has no translation but new parse has a richer description, keep best
              ...(candidate.description.length > dup.description.length
                ? { description: candidate.description }
                : {}),
            });
          }
          merged++;
        } else {
          await addDoc(collection(db, 'complaints'), candidate);
          added++;
        }
      }

      setMergeResult({ added, merged });
      setProgress(''); setUploading(false);
      await loadComplaints();
    } catch (err: any) {
      setUploadError(`Error: ${err.message ?? 'Something went wrong.'}`);
      setUploading(false); setProgress('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'complaints', id));
    setComplaints(prev => prev.filter(c => c.id !== id));
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = complaints.filter(c =>
    c.description.toLowerCase().includes(search.toLowerCase()) ||
    (c.translatedText ?? '').toLowerCase().includes(search.toLowerCase()) ||
    c.date.includes(search) ||
    c.source.toLowerCase().includes(search.toLowerCase())
  );

  const monthlyData  = groupByMonth(complaints);
  const totalThisYear = complaints.filter(c => c.date.startsWith(String(new Date().getFullYear()))).length;
  const latestDate    = complaints[0]?.date;
  const untranslatedCount = complaints.filter(c => !c.translatedText && !looksEnglish(c.rawText)).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-8 max-w-6xl mx-auto space-y-3 sm:space-y-8">

      {/* Title */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Complaints</h2>
          <p className="hidden sm:block text-sm text-slate-400">Upload a complaints PDF to extract, analyse, and track all entries.</p>
        </div>
        {untranslatedCount > 0 && (
          <button
            onClick={translateAll}
            disabled={translatingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-bold transition-all disabled:opacity-60"
            style={{ backgroundColor: `${roleColor}22`, color: roleColor, border: `1px solid ${roleColor}44` }}
          >
            {translatingAll
              ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" /> Translating...</>
              : <>🌐 Translate All ({untranslatedCount})</>
            }
          </button>
        )}
      </div>

      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className="rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center py-5 sm:py-10 px-4 sm:px-6 text-center"
        style={{
          borderColor: dragOver ? roleColor : 'rgba(255,255,255,0.12)',
          background:  dragOver ? `${roleColor}10` : 'rgba(255,255,255,0.02)',
        }}
      >
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {uploading ? (
          <>
            <div className="animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-b-2 mb-2 sm:mb-3" style={{ borderColor: roleColor }} />
            <p className="text-xs sm:text-sm font-semibold text-slate-300">{progress}</p>
          </>
        ) : (
          <>
            <span className="text-2xl sm:text-4xl mb-2 sm:mb-3">📄</span>
            <p className="text-xs sm:text-sm font-semibold text-white mb-0.5 sm:mb-1">Drop a complaints PDF here</p>
            <p className="text-[10px] sm:text-xs text-slate-500">or click to browse · PDF only</p>
          </>
        )}
      </div>

      {uploadError && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{uploadError}</div>
      )}

      {mergeResult && (
        <div className="px-4 py-3 rounded-xl border text-sm flex items-center justify-between"
          style={{ background: `${roleColor}10`, borderColor: `${roleColor}33`, color: roleColor }}>
          <span>
            ✓ <strong>{mergeResult.added}</strong> new complaint{mergeResult.added !== 1 ? 's' : ''} added
            {mergeResult.merged > 0 && <> · <strong>{mergeResult.merged}</strong> duplicate{mergeResult.merged !== 1 ? 's' : ''} merged</>}
          </span>
          <button onClick={() => setMergeResult(null)} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {/* Stats */}
      {complaints.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          {[
            { label: 'Total Complaints', value: complaints.length,                           color: roleColor },
            { label: 'This Year',        value: totalThisYear,                               color: '#00ffff' },
            { label: 'This Month',       value: monthlyData.at(-1)?.count ?? 0,              color: '#ffd700' },
            { label: 'Most Recent',      value: latestDate ? displayDate(latestDate) : '—',  color: '#ff4d4d', small: true },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl sm:rounded-2xl p-2.5 sm:p-5 border border-white/8" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 sm:mb-2">{stat.label}</p>
              <p className={`font-bold ${stat.small ? 'text-sm sm:text-lg' : 'text-xl sm:text-3xl'}`} style={{ color: stat.color }}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {monthlyData.length > 1 && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 p-3 sm:p-6" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <h3 className="text-[9px] sm:text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 sm:mb-6">Complaints by Month</h3>
          <div className="h-[140px] sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#1a1025', border: 'none', borderRadius: '10px', fontSize: '12px' }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {monthlyData.map((_, i) => (
                    <Cell key={i} fill={i === monthlyData.length - 1 ? roleColor : '#44318d'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* AI Insights */}
      {complaints.length > 0 && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>

          {/* Header */}
          <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-white/8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-lg">🤖</span>
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-widest">AI Insights</h3>
              <span className="hidden sm:inline text-[10px] text-slate-600 normal-case tracking-normal font-normal">· powered by OpenAI</span>
            </div>
            <button
              onClick={() => setShowKeyInput(v => !v)}
              className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
            >
              ⚙ {apiKey ? 'API Key ✓' : 'Set API Key'}
            </button>
          </div>

          {/* API Key input (collapsible) */}
          {showKeyInput && (
            <div className="px-3 sm:px-6 py-3 border-b border-white/8 bg-white/[0.015] flex items-center gap-2 sm:gap-3">
              <input
                type="password"
                placeholder="sk-proj-..."
                value={apiKey}
                onChange={e => saveApiKey(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs sm:text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 font-mono"
                style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
              />
              <button
                onClick={() => setShowKeyInput(false)}
                className="text-xs font-bold px-3 py-2 rounded-xl transition-colors text-white shrink-0"
                style={{ backgroundColor: `${roleColor}33` }}
              >
                Save
              </button>
            </div>
          )}

          <div className="p-3 sm:p-6 space-y-3 sm:space-y-4">
            {/* Quick prompt chips */}
            <div className="flex flex-wrap gap-2">
              {[
                'What are the most recurring complaints?',
                'What patterns do you see over time?',
                'Give actionable suggestions to address these issues',
                'Which period had the most complaints and why?',
              ].map(chip => (
                <button
                  key={chip}
                  onClick={() => { setAiQuery(chip); callClaudeAPI(chip); }}
                  disabled={aiLoading}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all disabled:opacity-50 hover:text-white"
                  style={{
                    borderColor: `${roleColor}40`,
                    color: '#94a3b8',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${roleColor}18`; (e.currentTarget as HTMLElement).style.color = roleColor; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Custom question input */}
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Ask anything about these complaints..."
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
                disabled={aiLoading}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 disabled:opacity-60"
                style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
              />
              <button
                onClick={handleAiSubmit}
                disabled={aiLoading || !aiQuery.trim()}
                className="px-5 py-2.5 text-sm font-bold rounded-xl text-white transition-all disabled:opacity-50 shrink-0 flex items-center gap-2"
                style={{ backgroundColor: roleColor, boxShadow: `0 0 16px ${roleColor}44` }}
              >
                {aiLoading
                  ? <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> Thinking...</>
                  : 'Analyze →'
                }
              </button>
            </div>

            {/* Error */}
            {aiError && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{aiError}</div>
            )}

            {/* Response */}
            {aiResponse && (
              <div
                className="rounded-xl p-5 border text-sm text-slate-300 leading-relaxed whitespace-pre-wrap"
                style={{ background: `${roleColor}08`, borderColor: `${roleColor}25` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🤖</span>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: roleColor }}>GPT-4o Analysis</span>
                </div>
                {aiResponse}
              </div>
            )}

            {/* Placeholder when no key and no response */}
            {!apiKey && !aiResponse && !aiLoading && (
              <div className="text-center py-6 text-slate-600 text-sm italic">
                Set your OpenAI API key above to enable AI analysis.
              </div>
            )}
          </div>
        </div>
      )}

      {/* List */}
      {complaints.length > 0 && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="px-3 sm:px-6 py-2.5 sm:py-4 border-b border-white/8 flex items-center justify-between gap-3">
            <h3 className="text-[9px] sm:text-sm font-bold text-slate-300 uppercase tracking-widest">
              All Entries <span className="text-slate-600 font-normal normal-case tracking-normal">({filtered.length})</span>
            </h3>
            <input
              type="text" placeholder="Search..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl py-1 sm:py-1.5 px-2.5 sm:px-3 text-xs sm:text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 w-32 sm:w-52"
              style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: roleColor }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-slate-600 italic text-sm">No results.</p>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {filtered.map((c, i) => {
                const isTranslating  = translatingIds.has(c.id);
                const hasTranslation = Boolean(c.translatedText);
                const needsTranslation = !hasTranslation && !looksEnglish(c.rawText);
                const displayText = hasTranslation ? c.translatedText! : c.description;

                return (
                  <div key={c.id} className="group">
                    <div
                      className="flex items-start gap-2 sm:gap-4 px-3 sm:px-6 py-2.5 sm:py-4 hover:bg-white/[0.03] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    >
                      <span className="text-[10px] font-mono text-slate-600 pt-0.5 shrink-0 w-5 text-right">{i + 1}</span>

                      {/* Date chip */}
                      <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg shrink-0 mt-0.5"
                        style={{ background: `${roleColor}22`, color: roleColor }}>
                        {displayDate(c.date)}
                      </span>

                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-2">{displayText}</p>
                        {hasTranslation && c.detectedLang && (
                          <span className="text-[9px] sm:text-[10px] text-slate-600 mt-0.5 block">
                            🌐 from <span className="text-slate-500">{c.detectedLang}</span>
                          </span>
                        )}
                      </div>

                      {/* Translate button + expand */}
                      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        {needsTranslation && (
                          <button
                            onClick={() => translateOne(c)}
                            disabled={isTranslating}
                            className="hidden sm:inline-flex px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all disabled:opacity-60"
                            style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}
                          >
                            {isTranslating
                              ? <span className="flex items-center gap-1"><span className="animate-spin inline-block w-2.5 h-2.5 border border-current border-t-transparent rounded-full" />...</span>
                              : '🌐 Translate'
                            }
                          </button>
                        )}
                        <span className="text-slate-600 text-xs" style={{ transform: expandedId === c.id ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
                      </div>
                    </div>

                    {/* Expanded */}
                    {expandedId === c.id && (
                      <div className="px-3 sm:px-6 pb-4 sm:pb-5 pt-2 border-t border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>

                        {/* Original text */}
                        <div className="mb-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">Original</p>
                          <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap">{c.rawText}</p>
                        </div>

                        {/* Translation */}
                        {hasTranslation && (
                          <div className="mb-3 p-3 rounded-xl border border-white/8" style={{ background: `${roleColor}08` }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: roleColor }}>
                              🌐 English Translation {c.detectedLang ? `· from ${c.detectedLang}` : ''}
                            </p>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{c.translatedText}</p>
                          </div>
                        )}

                        {/* Translate button (in expanded view too) */}
                        {!hasTranslation && (
                          <button
                            onClick={() => translateOne(c)}
                            disabled={isTranslating}
                            className="mb-3 px-3 py-1.5 text-xs font-bold rounded-lg transition-all disabled:opacity-60 flex items-center gap-1.5"
                            style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}
                          >
                            {isTranslating
                              ? <><span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" /> Translating...</>
                              : '🌐 Translate to English'
                            }
                          </button>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                            <span>By <span className="text-slate-400">{c.uploadedByName}</span></span>
                            <span>Source: <span className="text-slate-400">{c.source}</span></span>
                            {c.pdfUrl && (
                              <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer"
                                className="text-slate-400 hover:text-white underline">View PDF ↗</a>
                            )}
                          </div>
                          <button onClick={() => handleDelete(c.id)}
                            className="text-[11px] text-red-500/60 hover:text-red-400 transition-colors font-bold">
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && complaints.length === 0 && !uploading && (
        <div className="text-center py-20 text-slate-600 italic text-sm">
          No complaints yet. Upload a PDF above to get started.
        </div>
      )}
    </div>
  );
}
