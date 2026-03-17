/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
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
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Staff, ShiftRequirement, Assignment, Semester, ShiftType, Department, Position } from './types';
import { generateSchedule, getSemesterDates } from './utils';

const SHIFT_COLORS: Record<ShiftType, string> = {
  Morning: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  Afternoon: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  Night: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
};

const SEMESTERS: Semester[] = ['Winter', 'Spring', 'Summer', 'Fall'];

export default function ShiftFlowApp() {
  const [semester, setSemester] = useState<Semester>('Spring');

  const [departments, setDepartments] = useState<Department[]>([
    {
      id: 'dept-1',
      name: 'Engineering',
      teamLeaderId: '1',
      positions: [
        { id: 'pos-1', name: 'Senior Developer' },
        { id: 'pos-2', name: 'QA Engineer' }
      ]
    },
    {
      id: 'dept-2',
      name: 'Design',
      teamLeaderId: '2',
      positions: [
        { id: 'pos-3', name: 'UI Designer' },
        { id: 'pos-4', name: 'UX Researcher' }
      ]
    }
  ]);

  const [staff, setStaff] = useState<Staff[]>([
    { id: '1', name: 'Alex Rivera', departmentId: 'dept-1', positionId: 'pos-1', color: '#10b981', unavailability: [] },
    { id: '2', name: 'Sarah Chen', departmentId: 'dept-2', positionId: 'pos-3', color: '#f59e0b', unavailability: [] },
    { id: '3', name: 'Jordan Smith', departmentId: 'dept-1', positionId: 'pos-1', color: '#6366f1', unavailability: [] },
    { id: '4', name: 'Taylor Wong', departmentId: 'dept-1', positionId: 'pos-2', color: '#ec4899', unavailability: [] },
  ]);

  const [requirements, setRequirements] = useState<ShiftRequirement[]>([
    { type: 'Morning', startTime: '08:00', endTime: '16:00', staffNeeded: 2 },
    { type: 'Afternoon', startTime: '16:00', endTime: '00:00', staffNeeded: 2 },
    { type: 'Night', startTime: '00:00', endTime: '08:00', staffNeeded: 1 },
  ]);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [activeTab, setActiveTab] = useState<'schedule' | 'staff' | 'settings'>('schedule');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [unavailabilityModal, setUnavailabilityModal] = useState<{
    staffId: string;
    date: string;
    isOpen: boolean;
    startTime: string;
    endTime: string;
  }>({ staffId: '', date: '', isOpen: false, startTime: '09:00', endTime: '17:00' });

  const semesterDates = useMemo(() => getSemesterDates(semester), [semester]);

  const handleAutoSchedule = () => {
    const newAssignments = generateSchedule(staff, requirements, semesterDates);
    setAssignments(newAssignments);
  };

  const handleAddStaff = () => {
    const newMember: Staff = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Staff Member',
      departmentId: departments[0]?.id || '',
      positionId: departments[0]?.positions[0]?.id || '',
      color: '#' + Math.floor(Math.random()*16777215).toString(16),
      unavailability: [],
    };
    setStaff([...staff, newMember]);
  };

  const openUnavailabilityModal = (staffId: string, date: string) => {
    setUnavailabilityModal({
      staffId,
      date,
      isOpen: true,
      startTime: '09:00',
      endTime: '17:00'
    });
  };

  const handleAddUnavailability = () => {
    const { staffId, date, startTime, endTime } = unavailabilityModal;
    setStaff(prev => prev.map(s => {
      if (s.id === staffId) {
        const newUn = {
          id: Math.random().toString(36).substr(2, 9),
          date,
          startTime,
          endTime
        };
        return { ...s, unavailability: [...s.unavailability, newUn] };
      }
      return s;
    }));
    setUnavailabilityModal(prev => ({ ...prev, isOpen: false }));
  };

  const removeUnavailability = (staffId: string, unId: string) => {
    setStaff(prev => prev.map(s => {
      if (s.id === staffId) {
        return { ...s, unavailability: s.unavailability.filter(un => un.id !== unId) };
      }
      return s;
    }));
  };

  const conflicts = useMemo(() => {
    const alerts: string[] = [];
    semesterDates.forEach(date => {
      requirements.forEach(req => {
        const count = assignments.filter(a => a.date === date && a.shiftType === req.type).length;
        if (count < req.staffNeeded) {
          alerts.push(`${date}: Understaffed for ${req.type} shift (${count}/${req.staffNeeded})`);
        }
      });
    });
    return alerts;
  }, [assignments, requirements, semesterDates]);

  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans">
      {/* Header */}
      <header className="bg-[#0a0510]/90 border-b border-white/10 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              <Share2 size={20} />
            </button>
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              <Download size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-white/10 border-2 border-white/10 overflow-hidden">
              <img src="https://picsum.photos/seed/admin/32/32" alt="Admin" referrerPolicy="no-referrer" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Semester Selection & Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => setAssignments([])}
              className="px-5 py-2.5 rounded-xl font-semibold text-slate-500 hover:bg-white/10 transition-all"
            >
              Clear
            </button>
            <button
              onClick={handleAutoSchedule}
              className="flex items-center gap-2 bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] px-5 py-2.5 rounded-xl font-semibold hover:bg-[#ff00ff]/30 transition-colors active:scale-95"
            >
              <Clock size={18} />
              Auto-Schedule
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 lg:grid-cols-4 gap-8"
            >
              {/* Calendar Sidebar */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-white">Calendar</h3>
                    <div className="flex gap-1">
                      <button className="p-1 hover:bg-white/10 rounded-lg text-slate-600"><ChevronLeft size={18}/></button>
                      <button className="p-1 hover:bg-white/10 rounded-lg text-slate-600"><ChevronRight size={18}/></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center mb-2">
                    {['S','M','T','W','T','F','S'].map(d => (
                      <span key={d} className="text-[10px] font-bold text-slate-400 uppercase">{d}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 31 }).map((_, i) => (
                      <button
                        key={i}
                        className={`aspect-square flex items-center justify-center text-sm rounded-lg transition-all ${
                          i + 1 === 15 ? 'bg-[#ff00ff] text-white font-bold' : 'hover:bg-white/10 text-slate-400'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conflict Alerts */}
                <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="text-amber-400" size={20} />
                    <h3 className="font-bold text-white">Alerts</h3>
                  </div>
                  <div className="space-y-3">
                    {conflicts.length > 0 ? (
                      conflicts.slice(0, 5).map((alert, i) => (
                        <div key={i} className="p-3 bg-amber-500/10 border border-amber-400/30 rounded-xl text-xs text-amber-300 font-medium">
                          {alert}
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-slate-600">
                        <CheckCircle2 size={32} className="mb-2 opacity-20" />
                        <p className="text-xs font-medium">No conflicts detected</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Main Schedule Grid */}
              <div className="lg:col-span-3">
                <div className="bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
                  <div className="p-6 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.03]">
                    <h2 className="font-bold text-lg text-white">Weekly Overview</h2>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-white/[0.03] px-3 py-1.5 rounded-lg border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" /> Morning
                      </span>
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-white/[0.03] px-3 py-1.5 rounded-lg border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-amber-400" /> Afternoon
                      </span>
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-white/[0.03] px-3 py-1.5 rounded-lg border border-white/10">
                        <div className="w-2 h-2 rounded-full bg-indigo-400" /> Night
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="p-4 text-left text-xs font-bold text-slate-400 uppercase border-b border-white/[0.06] bg-white/[0.03] w-48">Staff Member</th>
                          {semesterDates.slice(0, 7).map(date => (
                            <th key={date} className="p-4 text-center border-b border-white/[0.06] bg-white/[0.03] min-w-[120px]">
                              <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                                {new Date(date).toLocaleDateString('en-US', { weekday: 'short' })}
                              </div>
                              <div className="text-sm font-bold text-white">
                                {new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                              </div>
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
                                  <Building2 size={14} className="text-slate-400" />
                                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{dept.name} Department</span>
                                </div>
                              </td>
                            </tr>
                            {staff.filter(s => s.departmentId === dept.id).map(member => (
                              <tr key={member.id} className="group hover:bg-white/[0.03] transition-colors">
                                <td className="p-4 border-b border-white/[0.06]">
                                  <div className="flex items-center gap-3">
                                    <div
                                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs relative"
                                      style={{ backgroundColor: member.color }}
                                    >
                                      {member.name.charAt(0)}
                                      {dept.teamLeaderId === member.id && (
                                        <div className="absolute -top-1 -right-1 bg-amber-500/70 text-white rounded-full p-0.5 border border-white/10">
                                          <ShieldCheck size={8} />
                                        </div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-sm font-bold text-white flex items-center gap-1.5">
                                        {member.name}
                                        {dept.teamLeaderId === member.id && <span className="text-[8px] bg-amber-500/10 text-amber-300 px-1 rounded font-black uppercase">Lead</span>}
                                      </div>
                                      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">
                                        {dept.positions.find(p => p.id === member.positionId)?.name || 'Staff'}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                {semesterDates.slice(0, 7).map(date => {
                                  const assignment = assignments.find(a => a.date === date && a.staffId === member.id);
                                  const dayUnavailability = member.unavailability.filter(un => un.date === date);

                                  return (
                                    <td
                                      key={date}
                                      className={`p-2 border-b border-white/[0.06] border-r border-white/[0.04] last:border-r-0 h-24 transition-all ${
                                        dayUnavailability.length > 0 ? 'bg-white/[0.04]' : ''
                                      }`}
                                    >
                                      <div className="h-full w-full flex flex-col gap-1">
                                        {assignment ? (
                                          <motion.div
                                            initial={{ scale: 0.9, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className={`p-2 rounded-xl border text-[10px] font-bold flex flex-col justify-between h-full cursor-pointer transition-all ${SHIFT_COLORS[assignment.shiftType]}`}
                                          >
                                            <div className="flex items-center justify-between">
                                              <span>{assignment.shiftType}</span>
                                              <Clock size={10} />
                                            </div>
                                            <div className="mt-1 opacity-80">
                                              {requirements.find(r => r.type === assignment.shiftType)?.startTime} - {requirements.find(r => r.type === assignment.shiftType)?.endTime}
                                            </div>
                                          </motion.div>
                                        ) : (
                                          <div className="h-full w-full flex flex-col gap-1">
                                            {dayUnavailability.map(un => (
                                              <div
                                                key={un.id}
                                                className="bg-white/10 text-slate-400 text-[9px] font-bold p-1 rounded-lg flex items-center justify-between group/un"
                                              >
                                                <span>{un.startTime}-{un.endTime}</span>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeUnavailability(member.id, un.id);
                                                  }}
                                                  className="opacity-0 group-hover/un:opacity-100 text-slate-600 hover:text-rose-400"
                                                >
                                                  <Trash2 size={10} />
                                                </button>
                                              </div>
                                            ))}
                                            <button
                                              onClick={() => openUnavailabilityModal(member.id, date)}
                                              className="flex-1 w-full rounded-xl hover:bg-white/[0.04] flex items-center justify-center group/cell cursor-pointer border-2 border-white/10 border-dashed"
                                            >
                                              <Plus size={14} className="text-slate-600 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'staff' && (
            <motion.div
              key="staff"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">Team Roster</h2>
                  <p className="text-sm text-slate-500">Manage staff members and their assignments.</p>
                </div>
                <button
                  onClick={handleAddStaff}
                  className="flex items-center gap-2 bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] px-5 py-2.5 rounded-xl font-semibold hover:bg-[#ff00ff]/30 transition-colors active:scale-95"
                >
                  <UserPlus size={18} />
                  Add Staff Member
                </button>
              </div>

              {departments.map(dept => (
                <div key={dept.id} className="space-y-4">
                  <div className="flex items-center gap-3 px-2">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-slate-400">
                      <Building2 size={18} />
                    </div>
                    <h3 className="font-bold text-lg text-slate-300">{dept.name} Department</h3>
                    <div className="h-px flex-1 bg-white/[0.06]" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {staff.filter(s => s.departmentId === dept.id).map((member) => (
                      <div key={member.id} className="bg-white/[0.03] p-6 rounded-3xl border border-white/10 hover:border-white/15 transition-all group relative overflow-hidden">
                        {dept.teamLeaderId === member.id && (
                          <div className="absolute top-0 right-0 bg-amber-500/70 text-white px-3 py-1 rounded-bl-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                            <ShieldCheck size={10} /> Team Leader
                          </div>
                        )}

                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-4">
                            <div
                              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl"
                              style={{ backgroundColor: member.color }}
                            >
                              {member.name.charAt(0)}
                            </div>
                            <div>
                              <h3 className="font-bold text-lg text-white">{member.name}</h3>
                              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-bold uppercase tracking-wider">
                                <Briefcase size={12} className="text-slate-400" />
                                {dept.positions.find(p => p.id === member.positionId)?.name || 'Staff'}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => setStaff(staff.filter(s => s.id !== member.id))}
                            className="p-2 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>

                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Position</label>
                              <select
                                value={member.positionId}
                                onChange={(e) => {
                                  setStaff(staff.map(s => s.id === member.id ? { ...s, positionId: e.target.value } : s));
                                }}
                                className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-white/25"
                              >
                                {dept.positions.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Role</label>
                              <button
                                onClick={() => {
                                  setDepartments(departments.map(d => d.id === dept.id ? { ...d, teamLeaderId: d.teamLeaderId === member.id ? undefined : member.id } : d));
                                }}
                                className={`w-full border rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                                  dept.teamLeaderId === member.id
                                    ? 'bg-amber-500/10 border-amber-400/30 text-amber-300'
                                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-300'
                                }`}
                              >
                                {dept.teamLeaderId === member.id ? 'Leader' : 'Set Leader'}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unavailability</label>
                            <div className="flex flex-wrap gap-1">
                              {member.unavailability.length > 0 ? (
                                member.unavailability.slice(0, 3).map(un => (
                                  <span key={un.id} className="text-[9px] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded-md font-bold">
                                    {un.date.split('-').slice(1).join('/')} {un.startTime}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[9px] text-slate-400 italic">No restrictions</span>
                              )}
                              {member.unavailability.length > 3 && (
                                <span className="text-[9px] text-slate-400 font-bold">+{member.unavailability.length - 3} more</span>
                              )}
                            </div>
                          </div>

                          <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-[10px] font-bold text-slate-500 uppercase">Active this semester</span>
                            </div>
                            <button className="text-xs font-bold text-[#ff00ff] hover:underline">Edit Details</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              {/* Departments & Positions */}
              <div className="bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
                <div className="p-8 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Organization Structure</h2>
                    <p className="text-sm text-slate-500">Define departments and their specific roles.</p>
                  </div>
                  <button
                    onClick={() => {
                      const newDept: Department = {
                        id: 'dept-' + Math.random().toString(36).substr(2, 5),
                        name: 'New Department',
                        positions: [{ id: 'pos-' + Math.random().toString(36).substr(2, 5), name: 'New Position' }]
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
                    <div key={dept.id} className="space-y-6">
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
                              newDepts[deptIdx].name = e.target.value;
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

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-14">
                        {dept.positions.map((pos, posIdx) => (
                          <div key={pos.id} className="flex items-center gap-3 p-4 bg-white/[0.03] rounded-2xl border border-white/10 group">
                            <Briefcase size={16} className="text-slate-400" />
                            <input
                              type="text"
                              value={pos.name}
                              onChange={(e) => {
                                const newDepts = [...departments];
                                newDepts[deptIdx].positions[posIdx].name = e.target.value;
                                setDepartments(newDepts);
                              }}
                              className="flex-1 bg-transparent text-sm font-bold text-slate-300 focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                const newDepts = [...departments];
                                newDepts[deptIdx].positions = dept.positions.filter(p => p.id !== pos.id);
                                setDepartments(newDepts);
                              }}
                              className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newDepts = [...departments];
                            newDepts[deptIdx].positions.push({ id: 'pos-' + Math.random().toString(36).substr(2, 5), name: 'New Position' });
                            setDepartments(newDepts);
                          }}
                          className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-white/10 rounded-2xl text-slate-400 hover:text-slate-300 hover:bg-white/[0.04] transition-all text-sm font-bold"
                        >
                          <Plus size={16} /> Add Position
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shift Requirements */}
              <div className="bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
                <div className="p-8 border-b border-white/[0.06]">
                  <h2 className="text-2xl font-bold text-white mb-2">Shift Requirements</h2>
                  <p className="text-slate-500">Configure daily staffing needs and shift durations.</p>
                </div>

                <div className="p-8 space-y-8">
                  {requirements.map((req, idx) => (
                    <div key={req.type} className="flex flex-col md:flex-row md:items-center gap-6 p-6 bg-white/[0.03] rounded-2xl border border-white/10">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${SHIFT_COLORS[req.type]}`}>
                        <Clock size={24} />
                      </div>

                      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Shift Type</label>
                          <div className="font-bold text-white">{req.type}</div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Time</label>
                          <input
                            type="time"
                            value={req.startTime}
                            onChange={(e) => {
                              const newReqs = [...requirements];
                              newReqs[idx].startTime = e.target.value;
                              setRequirements(newReqs);
                            }}
                            className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:border-white/25"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Time</label>
                          <input
                            type="time"
                            value={req.endTime}
                            onChange={(e) => {
                              const newReqs = [...requirements];
                              newReqs[idx].endTime = e.target.value;
                              setRequirements(newReqs);
                            }}
                            className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:border-white/25"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Staff Needed</label>
                          <input
                            type="number"
                            min="1"
                            value={req.staffNeeded}
                            onChange={(e) => {
                              const newReqs = [...requirements];
                              newReqs[idx].staffNeeded = parseInt(e.target.value);
                              setRequirements(newReqs);
                            }}
                            className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:outline-none focus:border-white/25"
                          />
                        </div>
                        <div className="space-y-1.5 col-span-2 md:col-span-4">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Required Position (Optional)</label>
                          <select
                            value={req.positionId || ''}
                            onChange={(e) => {
                              const newReqs = [...requirements];
                              newReqs[idx].positionId = e.target.value || undefined;
                              setRequirements(newReqs);
                            }}
                            className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus:border-white/25"
                          >
                            <option value="">Any Position</option>
                            {departments.map(dept => (
                              <optgroup key={dept.id} label={dept.name}>
                                {dept.positions.map(pos => (
                                  <option key={pos.id} value={pos.id}>{pos.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-8 bg-white/[0.03] border-t border-white/10 flex justify-end gap-3">
                  <button className="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-white/10 transition-all">Reset Defaults</button>
                  <button className="px-6 py-2.5 rounded-xl font-bold bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/30 transition-colors active:scale-95">Save Changes</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Unavailability Modal */}
      <AnimatePresence>
        {unavailabilityModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#0d0816] rounded-3xl border border-white/10 w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.03]">
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Clock size={18} className="text-[#ff00ff]" />
                  Set Unavailability
                </h3>
                <button
                  onClick={() => setUnavailabilityModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-2 hover:bg-white/10 rounded-xl text-slate-400 transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="p-4 bg-[#ff00ff]/10 border border-[#ff00ff]/20 rounded-2xl">
                  <p className="text-xs font-bold text-[#ff00ff] uppercase tracking-wider mb-1">Date</p>
                  <p className="text-lg font-black text-[#ff00ff]">{new Date(unavailabilityModal.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Time</label>
                    <input
                      type="time"
                      value={unavailabilityModal.startTime}
                      onChange={(e) => setUnavailabilityModal(prev => ({ ...prev, startTime: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-white/25"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">End Time</label>
                    <input
                      type="time"
                      value={unavailabilityModal.endTime}
                      onChange={(e) => setUnavailabilityModal(prev => ({ ...prev, endTime: e.target.value }))}
                      className="w-full bg-white/5 border border-white/10 text-slate-300 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-white/25"
                    />
                  </div>
                </div>
              </div>
              <div className="p-6 bg-white/[0.03] border-t border-white/10 flex gap-3">
                <button
                  onClick={() => setUnavailabilityModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddUnavailability}
                  className="flex-1 py-3 rounded-xl font-bold bg-[#ff00ff]/20 border border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/30 transition-colors active:scale-95"
                >
                  Add Range
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-white/10 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <CalendarIcon size={18} />
            <span className="text-sm font-bold tracking-tight">ShiftFlow Scheduler</span>
          </div>
          <div className="flex gap-8">
            <a href="#" className="text-xs font-bold text-slate-600 hover:text-slate-400 uppercase tracking-widest">Documentation</a>
            <a href="#" className="text-xs font-bold text-slate-600 hover:text-slate-400 uppercase tracking-widest">Support</a>
            <a href="#" className="text-xs font-bold text-slate-600 hover:text-slate-400 uppercase tracking-widest">Privacy</a>
          </div>
          <p className="text-xs font-medium text-slate-600">© 2025 ShiftFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
