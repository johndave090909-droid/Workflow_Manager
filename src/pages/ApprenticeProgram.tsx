import React, { useEffect, useState } from 'react';
import { ArrowLeft, Upload } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';

type Apprentice = {
  id: string;
  name: string;
  role?: string;
  sortOrder: number;
  progress?: Record<string, number>; // category -> 0-100
};

const PROGRESS_CATEGORIES = [
  'RTI Hours',
  'OJT Hours',
  'OJT Days',
  'Competencies',
  'Journey Progress',
];

const COLOR = '#6366f1';

function RadarCard({ apprentice }: { apprentice: Apprentice }) {
  const data = PROGRESS_CATEGORIES.map(cat => ({
    subject: cat,
    value: apprentice.progress?.[cat] ?? 0,
  }));

  const avg = Math.round(data.reduce((s, d) => s + d.value, 0) / data.length);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 hover:border-indigo-500/40 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">{apprentice.name}</p>
          {apprentice.role && <p className="text-slate-500 text-xs mt-0.5">{apprentice.role}</p>}
        </div>
        <div className="text-right">
          <span className="text-indigo-400 font-bold text-xl">{avg}%</span>
          <p className="text-slate-600 text-[10px] uppercase tracking-wider">Overall</p>
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
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: '#94a3b8', fontSize: 9 }}
            />
            <Radar
              name={apprentice.name}
              dataKey="value"
              stroke={COLOR}
              fill={COLOR}
              fillOpacity={0.25}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-category bars */}
      <div className="flex flex-col gap-2">
        {data.map(d => (
          <div key={d.subject} className="flex items-center gap-2">
            <span className="text-slate-500 text-[10px] w-28 shrink-0 truncate">{d.subject}</span>
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${d.value}%`, backgroundColor: COLOR }}
              />
            </div>
            <span className="text-slate-400 text-[10px] w-6 text-right">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ApprenticeProgram({ onBackToHub }: { onBackToHub: () => void }) {
  const [apprentices, setApprentices] = useState<Apprentice[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'ccbl_apprentices'), orderBy('sortOrder'));
    const unsub = onSnapshot(q, snap => {
      setApprentices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Apprentice)));
    });
    return unsub;
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0510] text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0510]/90 backdrop-blur-md border-b border-white/10 px-4 sm:px-8 h-16 flex items-center gap-4">
        <button onClick={onBackToHub} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-base font-bold text-white leading-tight">Apprentice Program</h1>
          <p className="text-slate-500 text-xs">Progress tracking for CCBL apprentices</p>
        </div>
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
            <div className="flex-1 flex items-center gap-2 text-slate-500 text-xs">
              <Upload size={14} className="text-indigo-400" />
              Progress data can be uploaded per apprentice — coming soon.
            </div>
          </div>
        )}

        {apprentices.length === 0 ? (
          <div className="text-center py-24 text-slate-600 italic text-sm">
            No apprentices found. Add them in CCBL Apprentices first.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {apprentices.map(a => (
              <RadarCard key={a.id} apprentice={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
