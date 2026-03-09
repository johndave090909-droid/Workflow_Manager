import React, { useState, useEffect, useRef } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore – Vite ?url import for the local worker bundle
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { db, storage } from './firebase';
import {
  collection, getDocs, addDoc, deleteDoc, doc, orderBy, query, updateDoc, setDoc, getDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, ReferenceLine,
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
  location?: string;            // e.g. "Aloha", "Ohana", "Gateway"
  source: string;
  pdfUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
}

const LOCATIONS = ['Aloha', 'Ohana', 'Gateway'] as const;
type Location = typeof LOCATIONS[number];

const LOCATION_COLORS: Record<Location, { bg: string; text: string }> = {
  Aloha:   { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e' },
  Ohana:   { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  Gateway: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
};

function detectLocation(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const loc of LOCATIONS) {
    if (lower.includes(loc.toLowerCase())) return loc;
  }
  return undefined;
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
  overrideLocation?: string,
): Omit<Complaint, 'id'>[] {
  const fullText = pages.join('\n\n');
  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const complaints: Omit<Complaint, 'id'>[] = [];
  let currentDate: string | null = null;
  let buffer: string[] = [];

  const location = overrideLocation || (detectLocation(source) ?? detectLocation(pages.join(' ')));

  const flush = () => {
    if (!buffer.length) return;
    const rawText = buffer.join(' ').trim();
    if (rawText.length < 10) { buffer = []; return; }
    complaints.push({
      date: currentDate ? parseToISO(currentDate) : new Date().toISOString().slice(0, 10),
      description: rawText,
      rawText,
      ...(location ? { location } : {}),
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
        ...(location ? { location } : {}),
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

// ── Ratio chart helpers ────────────────────────────────────────────────────────

function buildRatioChartData(
  complaints: Complaint[],
  guestCounts: Record<string, { aloha?: number; ohana?: number; gateway?: number }>,
): Array<{ date: string; Aloha?: number; Ohana?: number; Gateway?: number }> {
  const dates = Object.keys(guestCounts).sort();
  return dates
    .map(date => {
      const gc = guestCounts[date];
      const entry: { date: string; Aloha?: number; Ohana?: number; Gateway?: number } = {
        date: (() => { try { const d = parseISO(date); return isValid(d) ? format(d, 'MMM d') : date; } catch { return date; } })(),
      };
      const pairs: [Location, 'aloha' | 'ohana' | 'gateway'][] = [
        ['Aloha', 'aloha'], ['Ohana', 'ohana'], ['Gateway', 'gateway'],
      ];
      for (const [loc, key] of pairs) {
        const guests = gc[key];
        if (guests != null && guests > 0) {
          const cnt = complaints.filter(c => c.date === date && c.location === loc).length;
          entry[loc] = parseFloat(((cnt / guests) * 100).toFixed(2));
        }
      }
      return entry;
    })
    .filter(d => d.Aloha != null || d.Ohana != null || d.Gateway != null);
}

function venueAverage(data: ReturnType<typeof buildRatioChartData>, loc: Location): number | null {
  // Only average days that actually had complaints (rate > 0), ignoring guest-count days with 0 complaints
  const vals = data.map(d => d[loc]).filter((v): v is number => v != null && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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

interface Props { currentUser: User; roleColor: string; isItAdmin?: boolean; canAnalyze?: boolean; }

export default function ComplaintsView({ currentUser, roleColor, isItAdmin = false, canAnalyze = false }: Props) {
  const [complaints,     setComplaints]     = useState<Complaint[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [uploading,      setUploading]      = useState(false);
  const [uploadError,    setUploadError]    = useState('');
  const [progress,       setProgress]       = useState('');
  const [search,         setSearch]         = useState('');
  const [selectedMonth,  setSelectedMonth]  = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dragOver,       setDragOver]       = useState(false);
  const [expandedId,     setExpandedId]     = useState<string | null>(null);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translatingAll, setTranslatingAll] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [mergeResult,    setMergeResult]    = useState<{ added: number; merged: number } | null>(null);
  // AI Insights
  const [aiQuery,        setAiQuery]        = useState('');
  const [aiResponse,     setAiResponse]     = useState('');
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState('');
  const [apiKey,         setApiKey]         = useState(() => localStorage.getItem('wf_openai_key') ?? '');
  const [showKeyInput,   setShowKeyInput]   = useState(false);
  const [savedAnalysis,  setSavedAnalysis]  = useState<{ response: string; question: string; analyzedAt: string; analyzedBy: string } | null>(null);
  const [guestCounts,    setGuestCounts]    = useState<Record<string, { aloha?: number; ohana?: number; gateway?: number }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadComplaints(); loadSavedAnalysis(); loadGuestCounts(); }, []);

  const loadSavedAnalysis = async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'complaints_analysis'));
      if (snap.exists()) setSavedAnalysis(snap.data() as any);
    } catch {}
  };

  const loadGuestCounts = async () => {
    try {
      const snap = await getDocs(collection(db, 'daily_guest_counts'));
      const map: Record<string, { aloha?: number; ohana?: number; gateway?: number }> = {};
      snap.docs.forEach(d => { map[d.id] = d.data() as any; });
      setGuestCounts(map);
    } catch {}
  };

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
      `Use bullet points where appropriate. Be specific and actionable.\n\n` +
      `IMPORTANT: For every issue or theme you identify, count how many complaints from the list relate to it and include the count in parentheses. ` +
      `Format like: "• Food temperature too cold (7 complaints)". ` +
      `Base the count strictly on the data provided — do not guess or estimate.`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 800,
          temperature: 0.3,
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
      const responseText = data?.choices?.[0]?.message?.content ?? 'No response.';
      setAiResponse(responseText);
      // Save to Firestore so all users can see it
      const record = { response: responseText, question, analyzedAt: new Date().toISOString(), analyzedBy: currentUser.name };
      await setDoc(doc(db, 'settings', 'complaints_analysis'), record);
      setSavedAnalysis(record);
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
      const parsed = parseComplaintsFromText(pages, file.name, pdfUrl, currentUser.id, currentUser.name, selectedLocation || undefined);

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
    c.source.toLowerCase().includes(search.toLowerCase()) ||
    (c.location ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const monthlyData    = groupByMonth(complaints);
  const totalThisMonth = complaints.filter(c => c.date.startsWith(selectedMonth)).length;
  const latestDate     = complaints[0]?.date;
  const untranslatedCount = complaints.filter(c => !c.translatedText && !looksEnglish(c.rawText)).length;
  const ratioData    = buildRatioChartData(complaints, guestCounts);
  const venueAvgs    = { Aloha: venueAverage(ratioData, 'Aloha'), Ohana: venueAverage(ratioData, 'Ohana'), Gateway: venueAverage(ratioData, 'Gateway') };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-6 max-w-[1600px] mx-auto">
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-start">

    {/* ── LEFT COLUMN ──────────────────────────────── */}
    <div className="flex flex-col gap-3 sm:gap-5 w-full lg:w-[420px] xl:w-[500px] shrink-0">

      {/* Title */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Guest Experience</h2>
          <p className="hidden sm:block text-sm text-slate-400">Upload a guest experience PDF to extract, analyse, and track all entries.</p>
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

      {/* Location picker + Upload zone — IT Admin only */}
      {isItAdmin && (
        <>
          {/* Location picker */}
          <div className="rounded-xl border border-white/8 px-3 sm:px-5 py-3 sm:py-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 sm:mb-3">Location <span className="font-normal normal-case tracking-normal text-slate-600">(where are these entries from?)</span></p>
            <div className="flex flex-wrap gap-2">
              {LOCATIONS.map(loc => {
                const col = LOCATION_COLORS[loc];
                const active = selectedLocation === loc;
                return (
                  <button key={loc} onClick={() => setSelectedLocation(active ? '' : loc)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{
                      background: active ? col.bg : 'rgba(255,255,255,0.05)',
                      color: active ? col.text : '#64748b',
                      border: `1px solid ${active ? col.text + '60' : 'rgba(255,255,255,0.08)'}`,
                      boxShadow: active ? `0 0 8px ${col.text}30` : 'none',
                    }}>
                    {loc}
                  </button>
                );
              })}
              <button onClick={() => setSelectedLocation('')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: !selectedLocation ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                  color: !selectedLocation ? '#e2e8f0' : '#475569',
                  border: `1px solid ${!selectedLocation ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                Auto-detect
              </button>
            </div>
            {selectedLocation && (
              <p className="text-[10px] text-slate-500 mt-2">
                All complaints from the uploaded PDF will be tagged as <span style={{ color: LOCATION_COLORS[selectedLocation as Location]?.text, fontWeight: 700 }}>{selectedLocation}</span>.
              </p>
            )}
            {!selectedLocation && (
              <p className="text-[10px] text-slate-600 mt-2">Location will be detected from the PDF filename or content.</p>
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
                <p className="text-xs sm:text-sm font-semibold text-white mb-0.5 sm:mb-1">Drop a guest experience PDF here</p>
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
        </>
      )}

      {/* Last Analysis — visible to all users */}
      {savedAnalysis && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="px-3 sm:px-6 py-2.5 sm:py-3 border-b border-white/8 flex items-center gap-2">
            <span className="text-[9px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest">Last Analysis</span>
            <span className="ml-auto text-[9px] sm:text-[10px] text-slate-500">
              By {savedAnalysis.analyzedBy} · {new Date(savedAnalysis.analyzedAt).toLocaleString()}
            </span>
            {canAnalyze && (
              <button onClick={async () => { await deleteDoc(doc(db, 'settings', 'complaints_analysis')); setSavedAnalysis(null); }}
                className="ml-2 text-[9px] sm:text-[10px] text-red-400 hover:text-red-300 transition-colors" title="Delete analysis">
                Delete
              </button>
            )}
          </div>
          {savedAnalysis.question && (
            <div className="px-3 sm:px-6 pt-3 text-[10px] sm:text-xs text-slate-500 italic">Q: {savedAnalysis.question}</div>
          )}
          <div className="px-3 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {savedAnalysis.response}
          </div>
        </div>
      )}

      {/* AI Insights — IT Admin & Director only */}
      {complaints.length > 0 && canAnalyze && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-white/8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-lg">🤖</span>
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-widest">AI Insights</h3>
              <span className="hidden sm:inline text-[10px] text-slate-600 normal-case tracking-normal font-normal">· powered by OpenAI</span>
            </div>
            <button onClick={() => setShowKeyInput(v => !v)}
              className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1">
              ⚙ {apiKey ? 'API Key ✓' : 'Set API Key'}
            </button>
          </div>
          {showKeyInput && (
            <div className="px-3 sm:px-6 py-3 border-b border-white/8 bg-white/[0.015] flex items-center gap-2 sm:gap-3">
              <input type="password" placeholder="sk-proj-..." value={apiKey}
                onChange={e => saveApiKey(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-xs sm:text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 font-mono"
                style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
              />
              <button onClick={() => setShowKeyInput(false)}
                className="text-xs font-bold px-3 py-2 rounded-xl transition-colors text-white shrink-0"
                style={{ backgroundColor: `${roleColor}33` }}>Save</button>
            </div>
          )}
          <div className="p-3 sm:p-6 space-y-3 sm:space-y-4">
            <div className="flex flex-wrap gap-2">
              {['What are the most recurring complaints?','What patterns do you see over time?','Give actionable suggestions to address these issues','Which period had the most complaints and why?'].map(chip => (
                <button key={chip} onClick={() => { setAiQuery(chip); callClaudeAPI(chip); }} disabled={aiLoading}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all disabled:opacity-50 hover:text-white"
                  style={{ borderColor: `${roleColor}40`, color: '#94a3b8', background: 'rgba(255,255,255,0.03)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${roleColor}18`; (e.currentTarget as HTMLElement).style.color = roleColor; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
                >{chip}</button>
              ))}
            </div>
            <div className="flex gap-3">
              <input type="text" placeholder="Ask anything about these complaints..." value={aiQuery}
                onChange={e => setAiQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
                disabled={aiLoading}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 disabled:opacity-60"
                style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
              />
              <button onClick={handleAiSubmit} disabled={aiLoading || !aiQuery.trim()}
                className="px-5 py-2.5 text-sm font-bold rounded-xl text-white transition-all disabled:opacity-50 shrink-0 flex items-center gap-2"
                style={{ backgroundColor: roleColor, boxShadow: `0 0 16px ${roleColor}44` }}>
                {aiLoading ? <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" /> Thinking...</> : 'Analyze →'}
              </button>
            </div>
            {aiError && <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{aiError}</div>}
            {aiResponse && (
              <div className="rounded-xl p-5 border text-sm text-slate-300 leading-relaxed whitespace-pre-wrap"
                style={{ background: `${roleColor}08`, borderColor: `${roleColor}25` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🤖</span>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: roleColor }}>GPT-4o Analysis</span>
                </div>
                {aiResponse}
              </div>
            )}
            {!apiKey && !aiResponse && !aiLoading && (
              <div className="text-center py-6 text-slate-600 text-sm italic">Set your OpenAI API key above to enable AI analysis.</div>
            )}
          </div>
        </div>
      )}

    </div>

    {/* ── RIGHT COLUMN — All Entries ───────────────── */}
    <div className="flex-1 min-w-0 w-full flex flex-col gap-3 sm:gap-5">

      {/* Stats */}
      {complaints.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:gap-4">

          {/* This Month — with month picker */}
          <div className="rounded-xl sm:rounded-2xl p-2.5 sm:p-5 border border-white/8" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="flex items-center justify-between gap-2 mb-1 sm:mb-2">
              <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">Complaints</p>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="text-[8px] sm:text-[10px] font-bold bg-transparent border border-white/10 rounded-lg px-1.5 py-0.5 text-slate-400 focus:outline-none focus:border-yellow-400/50 cursor-pointer"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <p className="font-bold text-xl sm:text-3xl" style={{ color: '#ffd700' }}>{totalThisMonth}</p>
          </div>

          {/* Most Recent */}
          <div className="rounded-xl sm:rounded-2xl p-2.5 sm:p-5 border border-white/8" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 sm:mb-2">Most Recent</p>
            <p className="font-bold text-sm sm:text-lg" style={{ color: '#ff4d4d' }}>{latestDate ? displayDate(latestDate) : '—'}</p>
          </div>

        </div>
      )}

      {/* Complaint-to-Guest Ratio Chart */}
      {ratioData.length > 0 && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          {/* Header */}
          <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-white/8">
            <h3 className="text-[9px] sm:text-sm font-bold text-slate-300 uppercase tracking-widest">Complaint-to-Guest Ratio</h3>
            <p className="text-[9px] sm:text-xs text-slate-600 mt-0.5">% of daily guests who submitted a complaint, by venue</p>
          </div>
          {/* KPI summary cards */}
          <div className="grid grid-cols-3 divide-x divide-white/8 border-b border-white/8">
            {LOCATIONS.map(loc => {
              const col = LOCATION_COLORS[loc];
              const avg = venueAvgs[loc];
              return (
                <div key={loc} className="p-3 sm:p-5 text-center">
                  <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest mb-1 sm:mb-2" style={{ color: col.text }}>{loc}</p>
                  {avg != null ? (
                    <>
                      <p className="text-lg sm:text-3xl font-bold tabular-nums" style={{ color: avg > 1 ? '#f87171' : '#6ee7b7' }}>{avg.toFixed(2)}%</p>
                      <p className="text-[8px] sm:text-[10px] text-slate-600 mt-0.5">avg complaint rate</p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-700 italic">—</p>
                  )}
                </div>
              );
            })}
          </div>
          {/* Line chart */}
          <div className="p-3 sm:p-6">
            <div className="h-[160px] sm:h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ratioData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} width={36} />
                  <Tooltip
                    contentStyle={{ background: '#1a1025', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '12px' }}
                    formatter={(value: any, name: string) => [`${value}%`, name]}
                  />
                  <ReferenceLine y={1} stroke="rgba(248,113,113,0.35)" strokeDasharray="4 4"
                    label={{ value: '1% alert', fill: '#f87171', fontSize: 9, position: 'insideTopRight' }} />
                  <Legend wrapperStyle={{ fontSize: '10px', color: '#64748b', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="Aloha"   stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }}   activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="Ohana"   stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa' }}   activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="Gateway" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }}   activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* List — 3-column layout */}
      {complaints.length > 0 && (
        <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          {/* Header */}
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
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.04]">
              {LOCATIONS.map(loc => {
                const col = LOCATION_COLORS[loc];
                const locComplaints = filtered.filter(c => c.location === loc);
                return (
                  <div key={loc} className="flex flex-col">
                    {/* Column header */}
                    <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 border-b border-white/[0.04]"
                      style={{ background: col.bg }}>
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: col.text }}>{loc}</span>
                      <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: `${col.text}25`, color: col.text }}>
                        {locComplaints.length}
                      </span>
                    </div>

                    {/* Complaints for this location */}
                    {locComplaints.length === 0 ? (
                      <p className="text-center py-10 text-slate-700 italic text-xs">No entries</p>
                    ) : (
                      <div className="divide-y divide-white/[0.03] overflow-y-auto" style={{ maxHeight: '520px' }}>
                        {locComplaints.map((c, i) => {
                          const isTranslating   = translatingIds.has(c.id);
                          const hasTranslation  = Boolean(c.translatedText);
                          const needsTranslation = !hasTranslation && !looksEnglish(c.rawText);
                          const displayText = hasTranslation ? c.translatedText! : c.description;

                          return (
                            <div key={c.id}>
                              <div
                                className="flex items-start gap-2 px-3 sm:px-4 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
                                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                              >
                                <span className="text-[9px] font-mono text-slate-700 pt-0.5 shrink-0 w-4 text-right">{i + 1}</span>

                                <div className="flex-1 min-w-0">
                                  {/* Date */}
                                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md shrink-0 mb-1 inline-block"
                                    style={{ background: `${roleColor}22`, color: roleColor }}>
                                    {displayDate(c.date)}
                                  </span>
                                  {/* Description */}
                                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-2 mt-0.5">{displayText}</p>
                                  {hasTranslation && c.detectedLang && (
                                    <span className="text-[9px] text-slate-600 mt-0.5 block">🌐 {c.detectedLang}</span>
                                  )}
                                  {/* Complaint-to-guest ratio */}
                                  {(() => {
                                    const gc = guestCounts[c.date];
                                    const locKey = c.location?.toLowerCase() as 'aloha' | 'ohana' | 'gateway' | undefined;
                                    if (!gc || !locKey || gc[locKey] == null) return null;
                                    const guests = gc[locKey]!;
                                    const dayCount = complaints.filter(x => x.date === c.date && x.location === c.location).length;
                                    const pct = ((dayCount / guests) * 100).toFixed(2);
                                    return (
                                      <span className="text-[9px] mt-1 block font-mono"
                                        style={{ color: parseFloat(pct) > 1 ? '#f87171' : '#6ee7b7' }}>
                                        {dayCount} / {guests} guests ({pct}%)
                                      </span>
                                    );
                                  })()}
                                </div>

                                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                  {needsTranslation && (
                                    <button
                                      onClick={() => translateOne(c)}
                                      disabled={isTranslating}
                                      className="px-1.5 py-0.5 text-[9px] font-bold rounded-md transition-all disabled:opacity-60"
                                      style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}
                                    >
                                      {isTranslating
                                        ? <span className="animate-spin inline-block w-2 h-2 border border-current border-t-transparent rounded-full" />
                                        : '🌐'
                                      }
                                    </button>
                                  )}
                                  <span className="text-slate-600 text-[10px]"
                                    style={{ transform: expandedId === c.id ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
                                </div>
                              </div>

                              {/* Expanded */}
                              {expandedId === c.id && (
                                <div className="px-3 sm:px-4 pb-4 pt-2 border-t border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>
                                  <div className="mb-2">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">Original</p>
                                    <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{c.rawText}</p>
                                  </div>

                                  {hasTranslation && (
                                    <div className="mb-2 p-2.5 rounded-xl border border-white/8" style={{ background: `${roleColor}08` }}>
                                      <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: roleColor }}>
                                        🌐 Translation {c.detectedLang ? `· ${c.detectedLang}` : ''}
                                      </p>
                                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{c.translatedText}</p>
                                    </div>
                                  )}

                                  {!hasTranslation && (
                                    <button
                                      onClick={() => translateOne(c)}
                                      disabled={isTranslating}
                                      className="mb-2 px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all disabled:opacity-60 flex items-center gap-1.5"
                                      style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}
                                    >
                                      {isTranslating
                                        ? <><span className="animate-spin inline-block w-2.5 h-2.5 border border-current border-t-transparent rounded-full" /> Translating...</>
                                        : '🌐 Translate to English'
                                      }
                                    </button>
                                  )}

                                  <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                                      <span>By <span className="text-slate-400">{c.uploadedByName}</span></span>
                                      <span>Source: <span className="text-slate-400">{c.source}</span></span>
                                      {c.pdfUrl && (
                                        <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer"
                                          className="text-slate-400 hover:text-white underline">PDF ↗</a>
                                      )}
                                    </div>
                                    {isItAdmin && (
                                      <button onClick={() => handleDelete(c.id)}
                                        className="text-[10px] text-red-500/60 hover:text-red-400 transition-colors font-bold">
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Unassigned (no location) */}
          {(() => {
            const unassigned = filtered.filter(c => !c.location || !LOCATIONS.includes(c.location as Location));
            if (!unassigned.length) return null;
            return (
              <div className="border-t border-white/[0.04]">
                <div className="px-3 sm:px-6 py-2 flex items-center gap-2"
                  style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Unassigned</span>
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 text-slate-500">
                    {unassigned.length}
                  </span>
                </div>
                <div className="divide-y divide-white/[0.03]">
                  {unassigned.map((c, i) => {
                    const isTranslating   = translatingIds.has(c.id);
                    const hasTranslation  = Boolean(c.translatedText);
                    const displayText = hasTranslation ? c.translatedText! : c.description;
                    return (
                      <div key={c.id}>
                        <div
                          className="flex items-start gap-2 sm:gap-4 px-3 sm:px-6 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        >
                          <span className="text-[10px] font-mono text-slate-600 pt-0.5 shrink-0 w-5 text-right">{i + 1}</span>
                          <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg shrink-0 mt-0.5"
                            style={{ background: `${roleColor}22`, color: roleColor }}>
                            {displayDate(c.date)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-2">{displayText}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                            {!hasTranslation && !looksEnglish(c.rawText) && (
                              <button onClick={() => translateOne(c)} disabled={isTranslating}
                                className="hidden sm:inline-flex px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all disabled:opacity-60"
                                style={{ backgroundColor: `${roleColor}20`, color: roleColor, border: `1px solid ${roleColor}40` }}>
                                {isTranslating ? '...' : '🌐 Translate'}
                              </button>
                            )}
                            <span className="text-slate-600 text-xs"
                              style={{ transform: expandedId === c.id ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
                          </div>
                        </div>
                        {expandedId === c.id && (
                          <div className="px-3 sm:px-6 pb-4 pt-2 border-t border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">Original</p>
                            <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap mb-3">{c.rawText}</p>
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                <span>By <span className="text-slate-400">{c.uploadedByName}</span></span>
                                <span>Source: <span className="text-slate-400">{c.source}</span></span>
                                {c.pdfUrl && <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white underline">View PDF ↗</a>}
                              </div>
                              {isItAdmin && <button onClick={() => handleDelete(c.id)} className="text-[11px] text-red-500/60 hover:text-red-400 transition-colors font-bold">Delete</button>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {!loading && complaints.length === 0 && !uploading && (
        <div className="text-center py-20 text-slate-600 italic text-sm">
          No complaints yet. Upload a PDF above to get started.
        </div>
      )}

    </div>
    </div>
    </div>
  );
}
