/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Calendar as CalendarIcon,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  AlertCircle,
  Download,
  Share2,
  CheckCircle2,
  Clock,
  UserPlus,
  Briefcase,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Staff, Semester, ShiftType, Department, Position } from './types';
import { getSemesterDates } from './utils';

const SHIFT_COLORS: Record<ShiftType, string> = {
  Morning: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  Afternoon: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  Night: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
};

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SEMESTERS: Semester[] = ['Winter', 'Spring', 'Summer', 'Fall'];

function fmt12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const start1 = toMin(s1);
  const end1 = toMin(e1) === 0 ? 1440 : toMin(e1);
  const start2 = toMin(s2);
  const end2 = toMin(e2) === 0 ? 1440 : toMin(e2);
  return start1 < end2 && start2 < end1;
}

function PortalLinkButton() {
  const [copied, setCopied] = useState(false);
  const portalUrl = `${window.location.origin}/worker-portal`;
  function copy() {
    navigator.clipboard?.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      title={portalUrl}
      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 hover:text-[#ff00ff] hover:border-[#ff00ff]/30 hover:bg-[#ff00ff]/5 transition-all text-xs font-semibold"
    >
      <Share2 size={14} />
      {copied ? 'Copied!' : 'Portal Link'}
    </button>
  );
}

export default function ShiftFlowApp({ onBackToHub }: { onBackToHub?: () => void }) {
  const [semester, setSemester] = useState<Semester>('Spring');

  const [departments, setDepartments] = useState<Department[]>([
    {
      id: 'dept-1',
      name: 'Kitchen',
      teamLeaderId: '9',
      positions: [
        { id: 'pos-1', name: 'Early Morning',    shiftType: 'Morning',   days: [0,1,2,3,4,5],   startTime: '05:00', endTime: '09:00' },
        { id: 'pos-2', name: 'Morning Lead',     shiftType: 'Morning',   days: [0,1,2,3,4,5],   startTime: '08:00', endTime: '16:00' },
        { id: 'pos-3', name: 'Pantry Lead',      shiftType: 'Morning',   days: [0,1,2,3,4,5],   startTime: '08:00', endTime: '16:00' },
        { id: 'pos-4', name: 'Pantry Prep',      shiftType: 'Morning',   days: [0,1,2,3,4],     startTime: '08:00', endTime: '16:00' },
        { id: 'pos-5', name: 'Morning Student',  shiftType: 'Morning',   days: [0,1,2,3,4],     startTime: '09:00', endTime: '17:00' },
        { id: 'pos-6', name: 'Student Afternoon',shiftType: 'Afternoon', days: [0,1,2,3,4],     startTime: '14:00', endTime: '22:00' },
        { id: 'pos-7', name: 'Night Lead',       shiftType: 'Night',     days: [0,1,2,3,4,5,6], startTime: '21:00', endTime: '05:00' },
        { id: 'pos-8', name: 'Night Student',    shiftType: 'Night',     days: [4,5,6],         startTime: '21:00', endTime: '05:00' },
      ]
    },
    {
      id: 'dept-2',
      name: 'Bakery',
      teamLeaderId: '11',
      positions: [
        { id: 'pos-9',  name: 'Bakery Morning',       shiftType: 'Morning',   days: [0,1,2,3,4],   startTime: '07:00', endTime: '15:00' },
        { id: 'pos-10', name: 'Culinary Intern',       shiftType: 'Morning',   days: [0,1,2,3,4],   startTime: '08:00', endTime: '16:00' },
        { id: 'pos-11', name: 'Afternoon Bakery Lead', shiftType: 'Afternoon', days: [1,2,3,4,5],   startTime: '14:00', endTime: '22:00' },
      ]
    },
    {
      id: 'dept-3',
      name: 'Management',
      teamLeaderId: '4',
      positions: [
        { id: 'pos-12', name: 'Apprenticeship', shiftType: 'Afternoon', days: [0,1,2,3,4], startTime: '13:00', endTime: '21:00' },
        { id: 'pos-13', name: 'Supply Chain',   shiftType: 'Afternoon', days: [0,1,2,3,4], startTime: '13:00', endTime: '21:00' },
        { id: 'pos-14', name: 'Accountant',     shiftType: 'Afternoon', days: [0,1,2,3,4], startTime: '13:00', endTime: '21:00' },
        { id: 'pos-15', name: 'Trainer',        shiftType: 'Afternoon', days: [0,1,2,3,4], startTime: '13:00', endTime: '21:00' },
      ]
    },
  ]);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  const STAFF_COLORS = [
    '#6366f1','#ec4899','#14b8a6','#f97316','#84cc16','#06b6d4','#10b981',
    '#f59e0b','#8b5cf6','#3b82f6','#ef4444','#a855f7','#0ea5e9','#64748b',
    '#d97706','#e11d48','#059669','#7c3aed','#0284c7','#dc2626','#2563eb',
    '#9333ea','#16a34a','#ca8a04','#0891b2','#db2777','#0d9488','#b45309',
  ];

  // Rows ref so the config listener can always see the latest roster rows
  const rowsRef = React.useRef<Array<{ id: string; firstName?: string; lastName?: string; name?: string }>>([]);

  useEffect(() => {
    let active = true;

    // 1. Load roster once (rows don't change often)
    getDoc(doc(db, 'worker_roster', 'main')).then(rosterSnap => {
      if (!active) return;
      rowsRef.current = Array.isArray(rosterSnap.data()?.rows) ? rosterSnap.data()!.rows : [];
    }).catch(e => console.error('ShiftFlow: failed to load roster', e));

    // 2. Live-listen to shiftflow/config so worker portal changes appear instantly
    const unsub = onSnapshot(doc(db, 'shiftflow', 'config'), configSnap => {
      if (!active) return;
      const savedConfig = configSnap.data() ?? {};
      const savedAssignments: Record<string, { departmentId: string; positionId: string; unavailability?: Staff['unavailability']; needsReview?: boolean; scheduleImageUrl?: string }> =
        savedConfig.assignments ?? {};

      if (savedConfig.departments) {
        setDepartments(savedConfig.departments);
      }

      const rows = rowsRef.current;
      if (rows.length === 0) {
        // Roster not loaded yet — retry after a short delay
        setTimeout(() => {
          if (!active) return;
          const latestRows = rowsRef.current;
          setStaff(latestRows.map((row, idx) => {
            const fullName = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || (row as { name?: string }).name || 'Unknown';
            const saved = savedAssignments[row.id] ?? { departmentId: '', positionId: '', unavailability: [] };
            return { id: row.id, name: fullName, departmentId: saved.departmentId ?? '', positionId: saved.positionId ?? '', color: STAFF_COLORS[idx % STAFF_COLORS.length], unavailability: saved.unavailability ?? [], needsReview: saved.needsReview ?? false, scheduleImageUrl: saved.scheduleImageUrl };
          }));
          setRosterLoaded(true);
        }, 1000);
        return;
      }

      setStaff(rows.map((row, idx) => {
        const fullName = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || (row as { name?: string }).name || 'Unknown';
        const saved = savedAssignments[row.id] ?? { departmentId: '', positionId: '', unavailability: [] };
        return { id: row.id, name: fullName, departmentId: saved.departmentId ?? '', positionId: saved.positionId ?? '', color: STAFF_COLORS[idx % STAFF_COLORS.length], unavailability: saved.unavailability ?? [], needsReview: saved.needsReview ?? false, scheduleImageUrl: saved.scheduleImageUrl };
      }));
      setRosterLoaded(true);
    }, e => { console.error('ShiftFlow: config listener error', e); setRosterLoaded(true); });

    return () => { active = false; unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist assignments + departments to Firestore whenever they change (after initial load)
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rosterLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const assignments: Record<string, { departmentId: string; positionId: string; unavailability: Staff['unavailability']; needsReview?: boolean; scheduleImageUrl?: string }> = {};
      staff.forEach(s => {
        assignments[s.id] = { departmentId: s.departmentId, positionId: s.positionId, unavailability: s.unavailability, needsReview: s.needsReview ?? false, scheduleImageUrl: s.scheduleImageUrl };
      });
      setDoc(doc(db, 'shiftflow', 'config'), { departments, assignments }, { merge: true }).catch(console.error);
    }, 1500);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [staff, departments, rosterLoaded]);

  const [activeTab, setActiveTab] = useState<'schedule' | 'staff' | 'settings'>('schedule');
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [expandedStaffId, setExpandedStaffId] = useState<string | null>(null);
  const [addUnForm, setAddUnForm] = useState<{ startTime: string; endTime: string }>({
    startTime: '09:00',
    endTime: '17:00',
  });

  const semesterDates = useMemo(() => getSemesterDates(semester), [semester]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Check if a member is unavailable for a position (semester-wide blocks only)
  const isStaffUnavailable = (member: Staff, pos: Position): boolean =>
    member.unavailability.some(un =>
      (!un.date || un.date === '') && timesOverlap(un.startTime, un.endTime, pos.startTime, pos.endTime)
    );

  // Auto-schedule state: positionId → staffId override (null = use static assignments)
  const [weekSchedule, setWeekSchedule] = useState<Record<string, string> | null>(null);

  const runAutoSchedule = useCallback(() => {
    const map: Record<string, string> = {};
    for (const dept of departments) {
      const deptStaff = staff.filter(s => s.departmentId === dept.id);
      const usedIds = new Set<string>();
      for (const pos of dept.positions) {
        // Try the normally-assigned person first
        const primary = deptStaff.find(s => s.positionId === pos.id);
        if (primary && !isStaffUnavailable(primary, pos)) {
          map[pos.id] = primary.id;
          usedIds.add(primary.id);
          continue;
        }
        // Find a sub: any dept member not yet used and available
        const sub = deptStaff.find(s => !usedIds.has(s.id) && !isStaffUnavailable(s, pos));
        if (sub) {
          map[pos.id] = sub.id;
          usedIds.add(sub.id);
        }
      }
    }
    setWeekSchedule(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments, staff]);

  const getAssignedStaff = (posId: string): Staff | undefined => {
    if (weekSchedule) return staff.find(s => s.id === weekSchedule[posId]);
    return staff.find(s => s.positionId === posId);
  };

  const conflicts = useMemo(() => {
    const alerts: string[] = [];
    departments.forEach(dept => {
      dept.positions.forEach(pos => {
        const assigned = getAssignedStaff(pos.id);
        if (!assigned) {
          alerts.push(`${dept.name} – ${pos.name}: No staff assigned`);
        } else if (isStaffUnavailable(assigned, pos)) {
          alerts.push(`${dept.name} – ${pos.name}: ${assigned.name} is unavailable`);
        }
      });
    });
    return alerts;
  }, [departments, staff]);

  const removeUnavailability = (staffId: string, unId: string) => {
    setStaff(prev => prev.map(s =>
      s.id === staffId ? { ...s, unavailability: s.unavailability.filter(un => un.id !== unId) } : s
    ));
  };

  const handleAddStaff = () => {
    const firstDept = departments[0];
    const firstPos = firstDept?.positions[0];
    setStaff([...staff, {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Staff Member',
      departmentId: firstDept?.id || '',
      positionId: firstPos?.id || '',
      color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
      unavailability: [],
    }]);
  };

  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans">
      {/* Header */}
      <header className="bg-[#0a0510]/90 border-b border-white/10 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBackToHub && (
              <button onClick={onBackToHub}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-[#ff00ff] transition-all text-xs font-bold shrink-0">
                ← Hub
              </button>
            )}
            <div className="w-10 h-10 bg-gradient-to-br from-[#ff00ff]/60 to-violet-600/60 rounded-xl flex items-center justify-center text-white">
              <CalendarIcon size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-white">ShiftFlow</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Scheduler Pro</p>
            </div>
          </div>

          <nav className="flex items-center bg-white/[0.04] p-1 rounded-xl border border-white/10">
            {(['schedule', 'staff', 'settings'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-white/10 text-white border border-white/15'
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button className="p-2 text-slate-400 hover:text-white transition-colors"><Share2 size={20} /></button>
            <button className="p-2 text-slate-400 hover:text-white transition-colors"><Download size={20} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Semester selector */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2 bg-white/[0.04] p-1 rounded-2xl border border-white/10 w-fit">
            {SEMESTERS.map((s) => (
              <button
                key={s}
                onClick={() => setSemester(s)}
                className={`px-6 py-2 rounded-xl text-sm font-semibold transition-all ${
                  semester === s
                    ? 'bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff]'
                    : 'text-slate-500 hover:bg-white/10'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600">{semesterDates.length} days this semester</p>
        </div>

        <AnimatePresence mode="wait">
          {/* ── SCHEDULE TAB ── */}
          {activeTab === 'schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-4 gap-8"
            >
              {/* Sidebar */}
              <div className="lg:col-span-1 space-y-6">
                {/* Week nav */}
                <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white">Week</h3>
                    <div className="flex gap-1">
                      <button onClick={() => setWeekStart(d => addDays(d, -7))} className="p-1 hover:bg-white/10 rounded-lg text-slate-600"><ChevronLeft size={18}/></button>
                      <button onClick={() => setWeekStart(d => addDays(d, 7))} className="p-1 hover:bg-white/10 rounded-lg text-slate-600"><ChevronRight size={18}/></button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {weekDates.map((date, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-0.5">
                        <span className="text-slate-500 font-bold uppercase w-8">{WEEK_DAYS[i]}</span>
                        <span className="text-slate-400">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Alerts */}
                <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="text-amber-400" size={20} />
                    <h3 className="font-bold text-white">Alerts</h3>
                    {conflicts.length > 0 && (
                      <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-300">{conflicts.length}</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {conflicts.length > 0 ? (
                      conflicts.slice(0, 5).map((alert, i) => (
                        <div key={i} className="p-3 bg-amber-500/10 border border-amber-400/30 rounded-xl text-xs text-amber-300 font-medium">
                          {alert}
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-slate-600">
                        <CheckCircle2 size={32} className="mb-2 opacity-20" />
                        <p className="text-xs font-medium">All shifts covered</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Legend */}
                <div className="bg-white/[0.03] p-4 rounded-2xl border border-white/10 space-y-2">
                  {(['Morning', 'Afternoon', 'Night'] as ShiftType[]).map(t => (
                    <div key={t} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold ${SHIFT_COLORS[t]}`}>
                      <div className={`w-2 h-2 rounded-full ${t === 'Morning' ? 'bg-emerald-400' : t === 'Afternoon' ? 'bg-amber-400' : 'bg-violet-400'}`} />
                      {t}
                    </div>
                  ))}
                </div>
              </div>

              {/* Schedule Grid — rows = shift slots, cols = Mon–Sun */}
              <div className="lg:col-span-3">
                <div className="bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
                  <div className="p-5 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.03]">
                    <h2 className="font-bold text-lg text-white">
                      {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' – '}
                      {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </h2>
                    <div className="flex items-center gap-2">
                      {weekSchedule && (
                        <button
                          onClick={() => setWeekSchedule(null)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-all"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={runAutoSchedule}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-[#ff00ff]/30 bg-[#ff00ff]/10 text-[#ff00ff] hover:bg-[#ff00ff]/20 transition-all"
                      >
                        <CheckCircle2 size={13} />
                        Auto Schedule
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="p-3 text-left text-xs font-bold text-slate-400 uppercase border-b border-white/[0.06] bg-white/[0.03] w-40">Shift</th>
                          {weekDates.map((date, i) => (
                            <th key={i} className="p-3 text-center border-b border-white/[0.06] bg-white/[0.03] min-w-[90px]">
                              <div className="text-[10px] font-bold text-slate-400 uppercase">{WEEK_DAYS[i]}</div>
                              <div className="text-sm font-bold text-white">{date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {departments.map(dept => (
                          <React.Fragment key={dept.id}>
                            <tr className="bg-white/[0.04]">
                              <td colSpan={8} className="p-3 border-b border-white/10">
                                <div className="flex items-center gap-2">
                                  <Building2 size={13} className="text-slate-400" />
                                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{dept.name}</span>
                                </div>
                              </td>
                            </tr>
                            {dept.positions.map(pos => {
                              const assigned = getAssignedStaff(pos.id);
                              const unavail = assigned ? isStaffUnavailable(assigned, pos) : false;
                              return (
                                <tr key={pos.id} className="group hover:bg-white/[0.02] transition-colors">
                                  <td className="p-3 border-b border-white/[0.06]">
                                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${SHIFT_COLORS[pos.shiftType]}`}>
                                      {pos.name}
                                    </div>
                                    <div className="text-[10px] text-slate-600 mt-1 ml-1">{pos.startTime}–{pos.endTime}</div>
                                  </td>
                                  {weekDates.map((_, dayIdx) => {
                                    const runs = pos.days.includes(dayIdx);
                                    return (
                                      <td key={dayIdx} className={`p-2 border-b border-white/[0.06] border-r border-white/[0.03] last:border-r-0 h-[72px] ${!runs ? 'bg-white/[0.01]' : ''}`}>
                                        {runs ? (
                                          assigned ? (
                                            <motion.div
                                              initial={{ scale: 0.9, opacity: 0 }}
                                              animate={{ scale: 1, opacity: 1 }}
                                              className={`h-full p-2 rounded-xl border text-[10px] font-bold flex flex-col justify-between ${
                                                unavail
                                                  ? 'bg-rose-500/10 border-rose-400/30 text-rose-300'
                                                  : SHIFT_COLORS[pos.shiftType]
                                              }`}
                                            >
                                              <div className="flex items-center gap-1.5">
                                                <div className="w-5 h-5 rounded-md flex items-center justify-center text-white font-bold text-[9px] shrink-0"
                                                  style={{ backgroundColor: assigned.color }}>
                                                  {assigned.name.charAt(0)}
                                                </div>
                                                <span className="truncate">{assigned.name.split(' ')[0]}</span>
                                              </div>
                                              <div className="text-[9px] opacity-60 mt-1 truncate">{fmt12(pos.startTime)}–{fmt12(pos.endTime)}</div>
                                              {unavail && <div className="text-[9px] opacity-70 mt-0.5 text-rose-300">Unavailable</div>}
                                            </motion.div>
                                          ) : (
                                            <div className="h-full flex items-center justify-center">
                                              <span className="text-[10px] text-slate-700 font-bold border border-dashed border-white/10 rounded-lg px-2 py-1">Open</span>
                                            </div>
                                          )
                                        ) : (
                                          <div className="h-full flex items-center justify-center">
                                            <div className="w-1 h-1 rounded-full bg-white/5" />
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── STAFF TAB ── */}
          {activeTab === 'staff' && (
            <motion.div
              key="staff"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-white">Team Roster</h2>
                  <p className="text-sm text-slate-500">Manage staff members and their shift assignments.</p>
                </div>
                <div className="flex items-center gap-2">
                  <PortalLinkButton />
                  <button
                    onClick={handleAddStaff}
                    className="flex items-center gap-2 bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] px-5 py-2.5 rounded-xl font-semibold hover:bg-[#ff00ff]/30 transition-colors active:scale-95"
                  >
                    <UserPlus size={18} />
                    Add Staff Member
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 overflow-hidden">
                {departments.map((dept, deptIdx) => {
                  const deptMembers = staff.filter(s => s.departmentId === dept.id);
                  if (deptMembers.length === 0) return null;
                  return (
                  <div key={dept.id}>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.04] border-b border-white/[0.06]">
                      <Building2 size={13} className="text-slate-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{dept.name}</span>
                      <span className="text-[10px] text-slate-600 ml-1">· {deptMembers.length} members</span>
                    </div>

                    {staff.filter(s => s.departmentId === dept.id).map((member, memberIdx, arr) => {
                      const isExpanded = expandedStaffId === member.id;
                      const isLast = memberIdx === arr.length - 1 && deptIdx === departments.length - 1;
                      const memberPos = departments.flatMap(d => d.positions).find(p => p.id === member.positionId);
                      return (
                        <div key={member.id} className={!isLast ? 'border-b border-white/[0.06]' : ''}>
                          <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                            {/* Avatar */}
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 relative"
                              style={{ backgroundColor: member.color }}>
                              {member.name.charAt(0)}
                              {dept.teamLeaderId === member.id && (
                                <div className="absolute -top-1 -right-1 bg-amber-500/70 rounded-full p-0.5 border border-[#0a0510]">
                                  <ShieldCheck size={8} className="text-white" />
                                </div>
                              )}
                            </div>

                            {/* Name + shift */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-white truncate">{member.name}</span>
                                {dept.teamLeaderId === member.id && (
                                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-300">Lead</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <Briefcase size={10} className="text-slate-600" />
                                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                  {memberPos ? `${memberPos.name} · ${memberPos.startTime}–${memberPos.endTime}` : 'Unassigned'}
                                </span>
                              </div>
                            </div>

                            {/* Needs Review badge */}
                            {member.needsReview && (
                              <span className="text-[10px] font-black uppercase tracking-wide px-2 py-1 rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-300 shrink-0 animate-pulse">
                                Needs Review
                              </span>
                            )}

                            {/* Availability badge */}
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 ${
                              member.unavailability.length > 0
                                ? 'bg-rose-500/10 border-rose-400/30 text-rose-300'
                                : 'bg-white/[0.03] border-white/10 text-slate-600'
                            }`}>
                              {member.unavailability.length > 0 ? `${member.unavailability.length} blocked` : 'Available'}
                            </span>

                            {/* Department select */}
                            <select
                              value={member.departmentId}
                              onChange={e => {
                                const newDeptId = e.target.value;
                                const firstPos = departments.find(d => d.id === newDeptId)?.positions[0];
                                setStaff(staff.map(s => s.id === member.id ? { ...s, departmentId: newDeptId, positionId: firstPos?.id || '' } : s));
                              }}
                              className="hidden sm:block bg-white/5 border border-white/10 text-slate-400 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25 shrink-0"
                            >
                              {departments.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>

                            {/* Shift select */}
                            <select
                              value={member.positionId}
                              onChange={e => {
                                setStaff(staff.map(s => s.id === member.id ? { ...s, positionId: e.target.value } : s));
                              }}
                              className="hidden sm:block bg-white/5 border border-white/10 text-slate-400 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-white/25 shrink-0"
                            >
                              {departments.find(d => d.id === member.departmentId)?.positions.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.startTime}–{p.endTime})</option>
                              ))}
                            </select>

                            {/* Set leader */}
                            <button
                              onClick={() => setDepartments(departments.map(d =>
                                d.id === dept.id ? { ...d, teamLeaderId: d.teamLeaderId === member.id ? undefined : member.id } : d
                              ))}
                              className={`hidden sm:block px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border transition-all shrink-0 ${
                                dept.teamLeaderId === member.id
                                  ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
                                  : 'border-white/10 text-slate-600 hover:text-slate-300 hover:bg-white/10'
                              }`}
                            >
                              {dept.teamLeaderId === member.id ? 'Leader' : 'Set Leader'}
                            </button>

                            {/* Edit details */}
                            <button
                              onClick={() => { setExpandedStaffId(isExpanded ? null : member.id); setAddUnForm({ startTime: '09:00', endTime: '17:00' }); }}
                              className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all shrink-0 ${
                                isExpanded
                                  ? 'bg-[#ff00ff]/20 border-[#ff00ff]/30 text-[#ff00ff]'
                                  : 'border-white/10 text-slate-500 hover:text-[#ff00ff] hover:border-[#ff00ff]/30 hover:bg-[#ff00ff]/10'
                              }`}
                            >
                              {isExpanded ? 'Close' : 'Edit Details'}
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => { setStaff(staff.filter(s => s.id !== member.id)); if (isExpanded) setExpandedStaffId(null); }}
                              className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {/* Expanded panel */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 bg-white/[0.02] border-t border-white/[0.06] space-y-4">

                              {/* Needs Review header + dismiss */}
                              {member.needsReview && (
                                <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-400/30">
                                  <div className="flex items-center gap-2">
                                    <AlertCircle size={13} className="text-amber-400 shrink-0" />
                                    <span className="text-xs font-bold text-amber-300">Worker submitted new information via the portal</span>
                                  </div>
                                  <button
                                    onClick={() => setStaff(prev => prev.map(s => s.id === member.id ? { ...s, needsReview: false } : s))}
                                    className="text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/30 text-amber-300 hover:bg-amber-500/30 transition-colors shrink-0"
                                  >
                                    Mark Reviewed
                                  </button>
                                </div>
                              )}

                              {/* Schedule image */}
                              {member.scheduleImageUrl && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Uploaded Schedule</p>
                                  <a href={member.scheduleImageUrl} target="_blank" rel="noopener noreferrer">
                                    <img
                                      src={member.scheduleImageUrl}
                                      alt={`${member.name}'s schedule`}
                                      className="w-full max-h-64 object-contain rounded-xl border border-white/10 bg-white/[0.02] hover:border-white/20 transition-colors cursor-zoom-in"
                                    />
                                  </a>
                                </div>
                              )}

                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Unavailability for {member.name}</p>

                              {member.unavailability.length > 0 ? (
                                <div className="space-y-1.5">
                                  {member.unavailability.map(un => (
                                    <div key={un.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10">
                                      <div className="flex items-center gap-3 text-xs">
                                        <span className="text-slate-300 font-semibold">{un.startTime} – {un.endTime}</span>
                                        {(un as { label?: string }).label && (
                                          <span className="text-slate-500">{(un as { label?: string }).label}</span>
                                        )}
                                        <span className="text-slate-600 text-[10px]">all semester</span>
                                      </div>
                                      <button onClick={() => removeUnavailability(member.id, un.id)}
                                        className="text-slate-600 hover:text-rose-400 transition-colors">
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-600 italic">No unavailability set.</p>
                              )}

                              <div className="flex flex-wrap items-end gap-2 pt-1">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Start</label>
                                  <input type="time" value={addUnForm.startTime}
                                    onChange={e => setAddUnForm(f => ({ ...f, startTime: e.target.value }))}
                                    className="bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-white/25" />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">End</label>
                                  <input type="time" value={addUnForm.endTime}
                                    onChange={e => setAddUnForm(f => ({ ...f, endTime: e.target.value }))}
                                    className="bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-white/25" />
                                </div>
                                <button
                                  onClick={() => {
                                    setStaff(prev => prev.map(s => s.id === member.id
                                      ? { ...s, unavailability: [...s.unavailability, { id: Math.random().toString(36).substr(2, 9), date: '', ...addUnForm }] }
                                      : s));
                                    setAddUnForm({ startTime: '09:00', endTime: '17:00' });
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] text-xs font-bold hover:bg-[#ff00ff]/30 transition-colors"
                                >
                                  <Plus size={12} /> Add
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  );
                })}

                {/* Unassigned section */}
                {(() => {
                  const unassigned = staff.filter(s => !s.departmentId);
                  if (unassigned.length === 0) return null;
                  return (
                    <div>
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.02] border-b border-white/[0.06] border-t border-t-white/[0.06]">
                        <Users size={13} className="text-slate-600" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Unassigned</span>
                        <span className="text-[10px] text-slate-700 ml-1">· {unassigned.length} members</span>
                      </div>
                      {unassigned.map((member, memberIdx) => {
                        const isLast = memberIdx === unassigned.length - 1;
                        const isExpanded = expandedStaffId === member.id;
                        return (
                          <div key={member.id} className={!isLast ? 'border-b border-white/[0.06]' : ''}>
                            <div className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                              {/* Avatar */}
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                                style={{ backgroundColor: member.color }}>
                                {member.name.charAt(0)}
                              </div>

                              {/* Name */}
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-semibold text-white truncate block">{member.name}</span>
                                <span className="text-[10px] text-slate-600 uppercase tracking-wide">Not assigned</span>
                              </div>

                              {/* Availability badge */}
                              <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 ${
                                member.unavailability.length > 0
                                  ? 'bg-rose-500/10 border-rose-400/30 text-rose-300'
                                  : 'bg-white/[0.03] border-white/10 text-slate-600'
                              }`}>
                                {member.unavailability.length > 0 ? `${member.unavailability.length} blocked` : 'Available'}
                              </span>

                              {/* Department picker */}
                              <select
                                value=""
                                onChange={e => {
                                  const newDeptId = e.target.value;
                                  const firstPos = departments.find(d => d.id === newDeptId)?.positions[0];
                                  setStaff(staff.map(s => s.id === member.id
                                    ? { ...s, departmentId: newDeptId, positionId: firstPos?.id || '' }
                                    : s));
                                }}
                                className="bg-white/5 border border-white/10 text-slate-500 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#ff00ff]/40 shrink-0 cursor-pointer"
                              >
                                <option value="" disabled>Assign to dept…</option>
                                {departments.map(d => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>

                              {/* Edit Details */}
                              <button
                                onClick={() => { setExpandedStaffId(isExpanded ? null : member.id); setAddUnForm({ startTime: '09:00', endTime: '17:00' }); }}
                                className={`text-xs font-bold px-3 py-1 rounded-lg border transition-all shrink-0 ${
                                  isExpanded
                                    ? 'bg-[#ff00ff]/20 border-[#ff00ff]/30 text-[#ff00ff]'
                                    : 'border-white/10 text-slate-500 hover:text-[#ff00ff] hover:border-[#ff00ff]/30 hover:bg-[#ff00ff]/10'
                                }`}
                              >
                                {isExpanded ? 'Close' : 'Edit Details'}
                              </button>

                              {/* Delete */}
                              <button
                                onClick={() => { setStaff(staff.filter(s => s.id !== member.id)); if (isExpanded) setExpandedStaffId(null); }}
                                className="p-1.5 text-slate-700 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 shrink-0"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            {/* Expanded unavailability panel */}
                            {isExpanded && (
                              <div className="px-4 pb-4 pt-2 bg-white/[0.02] border-t border-white/[0.06] space-y-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Unavailability for {member.name}</p>
                                {member.unavailability.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {member.unavailability.map(un => (
                                      <div key={un.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10">
                                        <div className="flex items-center gap-3 text-xs">
                                          <span className="text-slate-300 font-semibold">{un.startTime} – {un.endTime}</span>
                                          <span className="text-slate-600 text-[10px]">all semester</span>
                                        </div>
                                        <button onClick={() => removeUnavailability(member.id, un.id)}
                                          className="text-slate-600 hover:text-rose-400 transition-colors">
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-600 italic">No unavailability set.</p>
                                )}
                                <div className="flex flex-wrap items-end gap-2 pt-1">
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Start</label>
                                    <input type="time" value={addUnForm.startTime}
                                      onChange={e => setAddUnForm(f => ({ ...f, startTime: e.target.value }))}
                                      className="bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-white/25" />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">End</label>
                                    <input type="time" value={addUnForm.endTime}
                                      onChange={e => setAddUnForm(f => ({ ...f, endTime: e.target.value }))}
                                      className="bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-white/25" />
                                  </div>
                                  <button
                                    onClick={() => {
                                      setStaff(prev => prev.map(s => s.id === member.id
                                        ? { ...s, unavailability: [...s.unavailability, { id: Math.random().toString(36).substr(2, 9), date: '', ...addUnForm }] }
                                        : s));
                                      setAddUnForm({ startTime: '09:00', endTime: '17:00' });
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] text-xs font-bold hover:bg-[#ff00ff]/30 transition-colors"
                                  >
                                    <Plus size={12} /> Add
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          )}

          {/* ── SETTINGS TAB ── */}
          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              {/* Departments & Shifts */}
              <div className="bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
                <div className="p-8 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Organization Structure</h2>
                    <p className="text-sm text-slate-500">Define departments and their shifts.</p>
                  </div>
                  <button
                    onClick={() => {
                      const newDept: Department = {
                        id: 'dept-' + Math.random().toString(36).substr(2, 5),
                        name: 'New Department',
                        positions: [{
                          id: 'pos-' + Math.random().toString(36).substr(2, 5),
                          name: 'Morning 1',
                          shiftType: 'Morning',
                          days: [0,1,2,3,4],
                          startTime: '08:00',
                          endTime: '16:00',
                        }]
                      };
                      setDepartments([...departments, newDept]);
                    }}
                    className="flex items-center gap-2 bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] px-4 py-2 rounded-xl text-sm font-bold hover:bg-[#ff00ff]/30 transition-colors"
                  >
                    <Plus size={16} /> Add Department
                  </button>
                </div>

                <div className="p-8 space-y-10">
                  {departments.map((dept, deptIdx) => (
                    <div key={dept.id} className="space-y-4">
                      {/* Department name row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center text-slate-400">
                            <Building2 size={20} />
                          </div>
                          <input
                            type="text"
                            value={dept.name}
                            onChange={(e) => {
                              const newDepts = [...departments];
                              newDepts[deptIdx] = { ...newDepts[deptIdx], name: e.target.value };
                              setDepartments(newDepts);
                            }}
                            className="text-xl font-bold text-white bg-transparent border-b border-white/10 hover:border-white/20 focus:border-[#ff00ff]/50 focus:outline-none px-1"
                          />
                        </div>
                        <button
                          onClick={() => setDepartments(departments.filter(d => d.id !== dept.id))}
                          className="text-slate-600 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {/* Shift slots */}
                      <div className="pl-14 space-y-2">
                        {dept.positions.map((pos, posIdx) => (
                          <div key={pos.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 group hover:border-white/15 transition-colors">
                            {/* Row 1: number, name, type, delete */}
                            <div className="flex items-center gap-3 mb-3">
                              <span className="text-[10px] font-black text-slate-600 w-5 text-right shrink-0">{posIdx + 1}.</span>
                              <input
                                type="text"
                                value={pos.name}
                                onChange={(e) => {
                                  const newDepts = [...departments];
                                  newDepts[deptIdx].positions[posIdx] = { ...pos, name: e.target.value };
                                  setDepartments(newDepts);
                                }}
                                className="flex-1 bg-transparent text-sm font-bold text-slate-200 focus:outline-none border-b border-transparent focus:border-white/20"
                                placeholder="Shift name"
                              />
                              <select
                                value={pos.shiftType}
                                onChange={(e) => {
                                  const newDepts = [...departments];
                                  newDepts[deptIdx].positions[posIdx] = { ...pos, shiftType: e.target.value as ShiftType };
                                  setDepartments(newDepts);
                                }}
                                className={`text-[10px] font-black px-2 py-1 rounded-lg border bg-transparent focus:outline-none cursor-pointer ${SHIFT_COLORS[pos.shiftType]}`}
                              >
                                <option value="Morning">Morning</option>
                                <option value="Afternoon">Afternoon</option>
                                <option value="Night">Night</option>
                              </select>
                              <button
                                onClick={() => {
                                  const newDepts = [...departments];
                                  newDepts[deptIdx].positions = dept.positions.filter(p => p.id !== pos.id);
                                  setDepartments(newDepts);
                                }}
                                className="text-slate-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            {/* Row 2: times + days-of-week toggles */}
                            <div className="flex flex-wrap items-center gap-3 pl-8">
                              <div className="flex items-center gap-1.5">
                                <label className="text-[9px] font-black uppercase text-slate-600">Start</label>
                                <input type="time" value={pos.startTime}
                                  onChange={e => {
                                    const newDepts = [...departments];
                                    newDepts[deptIdx].positions[posIdx] = { ...pos, startTime: e.target.value };
                                    setDepartments(newDepts);
                                  }}
                                  className="bg-white/5 border border-white/10 text-slate-400 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-white/25" />
                              </div>
                              <span className="text-slate-600 text-xs">–</span>
                              <div className="flex items-center gap-1.5">
                                <label className="text-[9px] font-black uppercase text-slate-600">End</label>
                                <input type="time" value={pos.endTime}
                                  onChange={e => {
                                    const newDepts = [...departments];
                                    newDepts[deptIdx].positions[posIdx] = { ...pos, endTime: e.target.value };
                                    setDepartments(newDepts);
                                  }}
                                  className="bg-white/5 border border-white/10 text-slate-400 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-white/25" />
                              </div>
                              <div className="flex items-center gap-1 ml-auto">
                                {WEEK_DAYS.map((day, dayIdx) => (
                                  <button
                                    key={dayIdx}
                                    onClick={() => {
                                      const newDepts = [...departments];
                                      const cur = pos.days;
                                      const newDays = cur.includes(dayIdx)
                                        ? cur.filter(d => d !== dayIdx)
                                        : [...cur, dayIdx].sort((a, b) => a - b);
                                      newDepts[deptIdx].positions[posIdx] = { ...pos, days: newDays };
                                      setDepartments(newDepts);
                                    }}
                                    className={`w-7 h-7 rounded-full text-[9px] font-black transition-all ${
                                      pos.days.includes(dayIdx)
                                        ? `${SHIFT_COLORS[pos.shiftType]} border`
                                        : 'bg-white/[0.03] text-slate-600 border border-white/[0.06] hover:bg-white/10'
                                    }`}
                                  >
                                    {day[0]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}

                        <button
                          onClick={() => {
                            const newDepts = [...departments];
                            const count = dept.positions.length + 1;
                            newDepts[deptIdx].positions.push({
                              id: 'pos-' + Math.random().toString(36).substr(2, 5),
                              name: `Morning ${count}`,
                              shiftType: 'Morning',
                              days: [0,1,2,3,4],
                              startTime: '08:00',
                              endTime: '16:00',
                            });
                            setDepartments(newDepts);
                          }}
                          className="flex items-center gap-1.5 mt-1 pl-8 text-xs text-slate-600 hover:text-[#ff00ff] transition-colors"
                        >
                          <Plus size={12} /> Add Shift
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
