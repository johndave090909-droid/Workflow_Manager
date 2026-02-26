import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ClipboardList, AlertCircle, CheckCircle2, Clock, Calendar,
  ArrowUpRight, Target, Zap, Search, Plus, LogOut, GripVertical, X, EyeOff,
  Home, Settings2 as SettingsIcon, Menu
} from 'lucide-react';
import { Draggable } from '@fullcalendar/interaction';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { format, isBefore, parseISO, differenceInDays } from 'date-fns';
import { User, Project, ProjectStatus, Department, AppView, SystemCard, Role, RolePermissions } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import LoginScreen from './LoginScreen';
import CreateProjectModal from './CreateProjectModal';
import ProjectDetailModal from './ProjectDetailModal';
import CalendarView from './CalendarView';
import SystemHub from './SystemHub';
import SystemAdminPanel from './SystemAdminPanel';
import WorkflowAutomation from './WorkflowAutomation';
import WorkerRoster from './WorkerRoster';

import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, getDocs, doc, getDoc, updateDoc,
  query, orderBy, where, Timestamp, addDoc, serverTimestamp,
} from 'firebase/firestore';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const DEFAULT_PERMISSIONS: RolePermissions = {
  access_tracker: false, access_it_admin: false, view_all_projects: false,
  create_projects: false, edit_projects: false, view_workload: false, is_assignable: false,
};

// Fallback when /roles collection is empty (backwards compat with seeded data)
const LEGACY_PERMS: Record<string, Partial<RolePermissions>> = {
  'Director': { access_tracker: true, view_all_projects: true, create_projects: true, edit_projects: true, view_workload: true },
  'Admin':    { access_tracker: true, is_assignable: true },
  'IT Admin': { access_it_admin: true },
};

const STATUS_COLORS: Record<ProjectStatus, string> = {
  'Not Started': 'text-slate-400 border-slate-400/30 bg-slate-400/10',
  'In Progress': 'text-[#ffd700] border-[#ffd700]/30 bg-[#ffd700]/10',
  'On Hold':     'text-[#ff00ff] border-[#ff00ff]/30 bg-[#ff00ff]/10',
  'Done':        'text-[#00ffff] border-[#00ffff]/30 bg-[#00ffff]/10',
};

const DEPT_COLORS: Record<Department, string> = {
  Personal: '#ff00ff',
  Business: '#00ffff',
  Finance:  '#ffd700',
  Health:   '#ff4d4d',
};

export default function App() {
  const [currentUser,     setCurrentUser]     = useState<User | null>(null);
  const [authLoading,     setAuthLoading]     = useState(true);
  const [currentView,     setCurrentView]     = useState<AppView>('hub');
  const [systemCards,     setSystemCards]     = useState<SystemCard[]>([]);
  const [roles,           setRoles]           = useState<Role[]>([]);
  const [projects,        setProjects]        = useState<Project[]>([]);
  const [users,           setUsers]           = useState<User[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [unreadCounts,    setUnreadCounts]    = useState<Record<string, number>>({});
  const [showViewOnlyToast, setShowViewOnlyToast] = useState(false);
  const [showAllProjects,   setShowAllProjects]   = useState(false);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);

  // Resolve current user's permissions from the /roles collection
  const userRoleDef    = roles.find(r => r.name === currentUser?.role);
  const basePerms: RolePermissions = userRoleDef?.permissions
    ?? { ...DEFAULT_PERMISSIONS, ...LEGACY_PERMS[currentUser?.role ?? ''] };

  // Apply view-only restrictions from system cards (IT Admins are exempt)
  const isViewOnlyCard = (link: string) =>
    !basePerms.access_it_admin &&
    systemCards.some(c => c.link === link && c.link_type === 'internal' && (c.is_view_only ?? false));

  const trackerViewOnly = isViewOnlyCard('tracker');
  const trackerCard     = systemCards.find((c: SystemCard) => c.link === 'tracker' && c.link_type === 'internal');
  const perms: RolePermissions = trackerViewOnly
    ? { ...basePerms, edit_projects: false, create_projects: false }
    : basePerms;

  const userRoleColor  = userRoleDef?.color
    ?? (currentUser?.role === 'Director' ? '#ff00ff' : currentUser?.role === 'IT Admin' ? '#a855f7' : '#00ffff');

  // ── Auth state listener ────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (snap.exists()) {
          setCurrentUser({ id: firebaseUser.uid, email: firebaseUser.email || '', ...snap.data() } as User);
        } else {
          // No Firestore profile — sign out
          await signOut(auth);
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ── Load data when user signs in ───────────────────────────────
  useEffect(() => {
    if (currentUser) {
      fetchRoles();
      fetchSystemCards();
      fetchData();
    }
  }, [currentUser?.id]);

  // ── Fetch unread counts after projects are loaded ──────────────
  useEffect(() => {
    if (currentUser && projects.length > 0) {
      fetchUnreadCounts(currentUser.id, projects);
    }
  }, [projects]);

  // ── External drag-to-calendar (edit_projects permission only) ──
  useEffect(() => {
    if (!tableBodyRef.current || !perms.edit_projects || loading || currentView !== 'tracker') return;
    const draggable = new Draggable(tableBodyRef.current, {
      itemSelector: '[data-fc-draggable]',
      eventData: (el) => ({
        title: el.getAttribute('data-project-name') || '',
        duration: { days: 1 },
        extendedProps: { projectId: el.getAttribute('data-project-id') || '' },
      }),
    });
    return () => draggable.destroy();
  }, [perms.edit_projects, loading, currentView]);

  // ── Show view-only toast when entering a restricted system ─────
  useEffect(() => {
    const isViewOnly =
      (currentView === 'workflow' && isViewOnlyCard('workflow')) ||
      (currentView === 'tracker'  && trackerViewOnly) ||
      (currentView === 'workers'  && isViewOnlyCard('workers'));
    if (isViewOnly) {
      setShowViewOnlyToast(true);
      const t = setTimeout(() => setShowViewOnlyToast(false), 7000);
      return () => clearTimeout(t);
    } else {
      setShowViewOnlyToast(false);
    }
  }, [currentView, systemCards]);

  // ── Data fetchers ──────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [projectsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'projects')),
        getDocs(collection(db, 'users')),
      ]);

      const fetchedUsers: User[] = usersSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as User));

      const fetchedProjects: Project[] = projectsSnap.docs.map(d => {
        const data = d.data();
        const lead = fetchedUsers.find(u => u.id === data.account_lead_id);
        return {
          id: d.id,
          ...data,
          account_lead_name: lead?.name ?? data.account_lead_name ?? 'Unknown',
          is_priority_focus: Boolean(data.is_priority_focus),
          is_time_critical:  Boolean(data.is_time_critical),
        } as Project;
      });

      setUsers(fetchedUsers);
      setProjects(fetchedProjects);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const fetchSystemCards = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'system_cards'), orderBy('sort_order')));
      const cards = snap.docs.map(d => ({ id: d.id, ...d.data() } as SystemCard));

      // Auto-seed internal systems if they don't exist yet
      const hasWorkflow = cards.some(c => c.link === 'workflow' && c.link_type === 'internal');
      const hasWorkers = cards.some(c => c.link === 'workers' && c.link_type === 'internal');
      if (!hasWorkflow) {
        await addDoc(collection(db, 'system_cards'), {
          title: 'Workflow Automation',
          description: 'Build and run automated workflows with a visual node-based editor.',
          icon: '⚡',
          color_accent: '#a855f7',
          link: 'workflow',
          link_type: 'internal',
          is_active: true,
          sort_order: 99,
        });
      }
      if (!hasWorkers) {
        await addDoc(collection(db, 'system_cards'), {
          title: 'Worker Roster',
          description: 'Spreadsheet-style roster to record employee shifts, jobs, pay rates, IDs, and notes.',
          icon: '📊',
          color_accent: '#38bdf8',
          link: 'workers',
          link_type: 'internal',
          is_active: true,
          is_view_only: false,
          sort_order: 100,
        });
      }
      if (!hasWorkflow || !hasWorkers) {
        const reSnap = await getDocs(query(collection(db, 'system_cards'), orderBy('sort_order')));
        setSystemCards(reSnap.docs.map(d => ({ id: d.id, ...d.data() } as SystemCard)));
        return;
      }

      setSystemCards(cards);
    } catch {}
  };

  const fetchRoles = async () => {
    try {
      const snap = await getDocs(collection(db, 'roles'));
      setRoles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Role)));
    } catch {}
  };

  const fetchUnreadCounts = async (userId: string, projectList: Project[]) => {
    try {
      // Load the user's last-read timestamps (one doc per project)
      const readsSnap = await getDocs(collection(db, 'users', userId, 'reads'));
      const reads: Record<string, Date | null> = {};
      readsSnap.docs.forEach(d => {
        const ts = d.data().last_read_at;
        reads[d.id] = ts ? ts.toDate() : null;
      });

      // For each project count messages the current user hasn't sent after their last read
      const counts: Record<string, number> = {};
      await Promise.all(projectList.map(async project => {
        const msgsSnap = await getDocs(collection(db, 'projects', project.id, 'messages'));
        const lastRead = reads[project.id];
        const unread = msgsSnap.docs.filter(d => {
          const data = d.data();
          if (data.sender_id === userId) return false;
          if (!lastRead) return true;
          const msgTime: Date | undefined = data.timestamp?.toDate();
          return msgTime && msgTime > lastRead;
        });
        if (unread.length > 0) counts[project.id] = unread.length;
      }));

      setUnreadCounts(counts);
    } catch {}
  };

  // ── Actions ────────────────────────────────────────────────────
  const handleDateChange = async (projectId: string, newStart: string, newEnd: string) => {
    await updateDoc(doc(db, 'projects', projectId), { start_date: newStart, end_date: newEnd });
    // Optimistic local update — no full re-fetch needed
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, start_date: newStart, end_date: newEnd } : p
    ));
  };

  const handleLogout = async () => {
    await signOut(auth);
    setProjects([]);
    setUsers([]);
    setSystemCards([]);
    setLoading(true);
    setSelectedOwnerId(null);
    setUnreadCounts({});
    setCurrentView('hub');
  };

  // ── Derived data ───────────────────────────────────────────────
  const visibleProjects = useMemo(() => {
    // Directors always see everything; others see all if they toggled "All Projects"
    if (perms.view_all_projects || showAllProjects) return projects;
    if (currentUser) return projects.filter(p =>
      (p.assignee_ids ?? [p.account_lead_id]).includes(currentUser.id)
    );
    return projects;
  }, [projects, perms.view_all_projects, showAllProjects, currentUser]);

  const filteredProjects = useMemo(() => {
    if (selectedOwnerId === null) return visibleProjects;
    return visibleProjects.filter(p =>
      (p.assignee_ids ?? [p.account_lead_id]).includes(selectedOwnerId)
    );
  }, [visibleProjects, selectedOwnerId]);

  const stats = useMemo(() => {
    const total      = visibleProjects.length;
    const completed  = visibleProjects.filter(p => p.status === 'Done').length;
    const onboarding = visibleProjects.filter(p => p.status === 'Not Started').length;
    const overdue    = visibleProjects.filter(p => p.end_date && isBefore(parseISO(p.end_date), new Date()) && p.status !== 'Done').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, onboarding, overdue, completionRate };
  }, [visibleProjects]);

  const deptData = useMemo(() => {
    const depts: Department[] = ['Personal', 'Business', 'Finance', 'Health'];
    return depts.map(dept => ({ name: dept, count: visibleProjects.filter(p => p.department === dept).length }));
  }, [visibleProjects]);

  // Users that can be assigned to projects (have is_assignable permission)
  const assignableUsers = useMemo(() =>
    users.filter(u => {
      const roleDef = roles.find(r => r.name === u.role);
      return roleDef ? roleDef.permissions.is_assignable : u.role === 'Admin';
    }),
  [users, roles]);

  const workloadData = useMemo(() =>
    assignableUsers.map(u => ({
      id:    u.id,
      name:  u.name.split(' ')[0],
      count: projects.filter(p => (p.assignee_ids ?? [p.account_lead_id]).includes(u.id)).length,
    })),
  [assignableUsers, projects]);

  const nextDeadlines = useMemo(() =>
    [...visibleProjects]
      .filter(p => p.status !== 'Done' && p.end_date)
      .sort((a, b) => parseISO(a.end_date).getTime() - parseISO(b.end_date).getTime())
      .slice(0, 5),
  [visibleProjects]);

  // ── Render guards ──────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex items-center justify-center h-screen bg-[#0a0510]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ff00ff]" />
    </div>
  );

  if (!currentUser) return <LoginScreen />;

  if (currentView === 'hub') return (
    <>
      <SystemHub
        currentUser={currentUser}
        systemCards={systemCards.filter(c => c.is_active)}
        onNavigate={v => setCurrentView(v)}
        onLogout={handleLogout}
        permissions={perms}
        roleColor={userRoleColor}
        projects={visibleProjects}
        allProjects={projects}
      />
      <BottomNav current={currentView} onNavigate={v => setCurrentView(v)} perms={perms} roleColor={userRoleColor} systemCards={systemCards} />
    </>
  );

  if (currentView === 'workflow') return (
    <>
      <WorkflowAutomation
        currentUser={currentUser}
        onBackToHub={() => setCurrentView('hub')}
        onLogout={handleLogout}
        roleColor={userRoleColor}
        viewOnly={isViewOnlyCard('workflow')}
      />
      <BottomNav current={currentView} onNavigate={v => setCurrentView(v)} perms={perms} roleColor={userRoleColor} systemCards={systemCards} />
      <ViewOnlyToast show={showViewOnlyToast} onClose={() => setShowViewOnlyToast(false)} />
    </>
  );

  if (currentView === 'workers') return (
    <>
      <WorkerRoster
        currentUser={currentUser}
        onBackToHub={() => setCurrentView('hub')}
        onLogout={handleLogout}
        roleColor={userRoleColor}
        viewOnly={isViewOnlyCard('workers')}
      />
      <BottomNav current={currentView} onNavigate={v => setCurrentView(v)} perms={perms} roleColor={userRoleColor} systemCards={systemCards} />
      <ViewOnlyToast show={showViewOnlyToast} onClose={() => setShowViewOnlyToast(false)} />
    </>
  );

  if (currentView === 'it-admin') {
    if (!perms.access_it_admin) { setCurrentView('hub'); return null; }
    return (
      <>
        <SystemAdminPanel
          currentUser={currentUser}
          onBackToHub={() => setCurrentView('hub')}
          onCardsChanged={fetchSystemCards}
          onUsersChanged={fetchData}
          onRolesChanged={fetchRoles}
          onLogout={handleLogout}
          permissions={perms}
          roleColor={userRoleColor}
        />
        <BottomNav current={currentView} onNavigate={v => setCurrentView(v)} perms={perms} roleColor={userRoleColor} systemCards={systemCards} />
      </>
    );
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[#0a0510]">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ff00ff]" />
    </div>
  );

  // ── Tracker view ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0510] text-white font-sans selection:bg-[#ff00ff]/30 pb-nav md:pb-0">
      <ViewOnlyToast show={showViewOnlyToast} onClose={() => setShowViewOnlyToast(false)} />
      <BottomNav current={currentView} onNavigate={v => setCurrentView(v)} perms={perms} roleColor={userRoleColor} systemCards={systemCards} />
      <header className="h-16 border-b border-white/10 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {/* Hub link — hidden on mobile (use bottom nav instead) */}
          <button
            onClick={() => setCurrentView('hub')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[#ff00ff]/30 text-slate-400 hover:text-[#ff00ff] transition-all text-xs font-bold shrink-0"
          >
            ← Hub
          </button>
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#ff00ff] rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-pink-500/20 shrink-0">W</div>
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#ff00ff] drop-shadow-[0_0_8px_rgba(255,0,255,0.4)] truncate">Workflow Manager</h1>

          {/* View scope toggle — shown for non-Directors, text hidden on very small screens */}
          {!perms.view_all_projects && (
            <div className="hidden xs:flex sm:flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-white/5 shrink-0">
              <button
                onClick={() => { setShowAllProjects(false); setSelectedOwnerId(null); }}
                className={cn(
                  'px-2 sm:px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all',
                  !showAllProjects ? 'bg-[#ff00ff] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                )}
              >
                <span className="hidden sm:inline">My Projects</span>
                <span className="sm:hidden">Mine</span>
              </button>
              <button
                onClick={() => setShowAllProjects(true)}
                className={cn(
                  'px-2 sm:px-3 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all',
                  showAllProjects ? 'bg-[#00ffff] text-[#0a0510] shadow-sm' : 'text-slate-400 hover:text-white'
                )}
              >
                <span className="hidden sm:inline">All Projects</span>
                <span className="sm:hidden">All</span>
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {/* Date — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
            <Calendar size={16} className="text-[#00ffff]" />
            <span className="text-sm font-medium text-slate-300">{format(new Date(), 'EEEE, MMMM do yyyy')}</span>
          </div>
          {perms.create_projects && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 hover:opacity-90 transition-opacity rounded-full text-sm font-bold text-white shadow-lg min-h-[40px]"
              style={{ backgroundColor: userRoleColor, boxShadow: `0 4px 15px ${userRoleColor}33` }}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Create Project</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full p-0.5 shrink-0" style={{ border: `2px solid ${userRoleColor}` }}>
              <img
                src={currentUser.photo || `https://picsum.photos/seed/${currentUser.id}/100/100`}
                className="w-full h-full rounded-full object-cover"
                alt="Profile"
              />
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-bold text-white leading-none">{currentUser.name}</p>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: userRoleColor }}>
                {currentUser.role}
              </p>
            </div>
            <button onClick={handleLogout} title="Logout" className="ml-1 p-2 text-slate-500 hover:text-white transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {showCreateModal && (
        <CreateProjectModal
          adminUsers={assignableUsers}
          currentUser={currentUser}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchData}
        />
      )}

      {selectedProject && (
        <ProjectDetailModal
          project={selectedProject}
          users={users}
          assignableUsers={assignableUsers}
          currentUser={currentUser}
          onClose={() => setSelectedProject(null)}
          onUpdated={() => { fetchData(); setSelectedProject(null); }}
          onDelete={() => { fetchData(); setSelectedProject(null); }}
          onMarkRead={() => currentUser && fetchUnreadCounts(currentUser.id, projects)}
          viewOnly={trackerViewOnly}
        />
      )}

      <main className="p-4 sm:p-8 max-w-[1600px] mx-auto space-y-6 sm:space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
          <KPICard label="Total Projects"    value={stats.total}      icon={<ClipboardList className="text-[#00ffff]" />} />
          <KPICard label="Completed"         value={stats.completed}  icon={<CheckCircle2  className="text-[#00ffff]" />} />
          <KPICard label="Onboarding"        value={stats.onboarding} icon={<Zap           className="text-[#ffd700]" />} />
          <KPICard label="Overdue"           value={stats.overdue}    icon={<AlertCircle   className="text-[#ff4d4d]" />} critical={stats.overdue > 0} />
          <div className="glass-card p-4 sm:p-6 rounded-3xl flex items-center justify-between group overflow-hidden relative col-span-2 sm:col-span-2 lg:col-span-1">
            <div className="relative z-10">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Overall Completion</p>
              <p className="text-5xl font-display font-bold text-[#00ffff]">{stats.completionRate}%</p>
            </div>
            <div className="relative w-20 h-20 z-10">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="40" cy="40" r="32" stroke="currentColor" strokeWidth="7" fill="transparent" className="text-white/5" />
                <circle cx="40" cy="40" r="32" stroke="currentColor" strokeWidth="7" fill="transparent"
                  strokeDasharray={201} strokeDashoffset={201 - (201 * stats.completionRate) / 100}
                  className="text-[#00ffff] transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <Target size={20} className="text-[#00ffff]/50" />
              </div>
            </div>
            <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-[#00ffff]/5 rounded-full blur-3xl group-hover:bg-[#00ffff]/10 transition-all" />
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {perms.view_workload && (
            <div className="xl:col-span-3 glass-card p-6 rounded-3xl">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6">Workload by Admin</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workloadData} onClick={data => {
                    if (data?.activePayload?.[0]) setSelectedOwnerId(data.activePayload[0].payload.id);
                  }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: '#1a1025', border: 'none', borderRadius: '8px' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {workloadData.map((entry, i) => (
                        <Cell key={i} fill={selectedOwnerId === entry.id ? '#ff00ff' : '#44318d'} className="cursor-pointer hover:opacity-80 transition-opacity" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-center text-slate-500 mt-2 italic">Click bar to filter Master Table</p>
            </div>
          )}

          <div className="xl:col-span-3 glass-card p-6 rounded-3xl">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6">Progress by Area</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} width={80} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: '#1a1025', border: 'none', borderRadius: '8px' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {deptData.map((entry, i) => <Cell key={i} fill={DEPT_COLORS[entry.name as Department]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="xl:col-span-3 glass-card p-6 rounded-3xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Next Deadlines</h3>
              <Clock size={16} className="text-[#ff00ff]" />
            </div>
            <div className="space-y-4">
              {nextDeadlines.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all group">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold group-hover:text-[#00ffff] transition-colors">{p.name}</span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase">{p.account_lead_name}</span>
                  </div>
                  <span className={cn('text-xs font-mono font-bold', isBefore(parseISO(p.end_date), new Date()) ? 'text-[#ff4d4d]' : 'text-[#ffd700]')}>
                    {format(parseISO(p.end_date), 'MMM dd')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar */}
        <CalendarView
          projects={visibleProjects}
          currentUserId={currentUser.id}
          onDateChange={handleDateChange}
          onProjectClick={p => setSelectedProject(p)}
          readOnly={!perms.edit_projects}
          unreadCounts={unreadCounts}
        />

        {/* Master Account Table */}
        <div className="glass-card rounded-[2rem] overflow-hidden border border-white/10">
          <div className="p-4 sm:p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-display font-bold text-[#ff00ff] drop-shadow-[0_0_8px_rgba(255,0,255,0.4)] mb-1">{trackerCard?.title ?? 'Project Tracker'}</h2>
              <p className="text-xs sm:text-sm text-slate-400">{trackerCard?.description ?? 'Manage and track all project lifecycles across accounts.'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Search projects..."
                  className="bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[#ff00ff] outline-none transition-all w-full sm:w-64"
                />
              </div>
              {(perms.view_all_projects || showAllProjects) && assignableUsers.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl p-1">
                  <button
                    onClick={() => setSelectedOwnerId(null)}
                    className={cn('px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all', selectedOwnerId === null ? 'bg-[#ff00ff] text-white' : 'text-slate-400 hover:text-white')}
                  >
                    ALL
                  </button>
                  {assignableUsers.map(user => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedOwnerId(user.id)}
                      className={cn('px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all', selectedOwnerId === user.id ? 'bg-[#00ffff] text-[#0a0510]' : 'text-slate-400 hover:text-white')}
                    >
                      {user.name.split(' ')[0].toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {perms.edit_projects && (
            <p className="text-[10px] text-slate-600 italic px-8 pb-3">⠿ Drag any row onto the calendar above to set its due date</p>
          )}

          {/* ── Mobile card list (< md) ── */}
          <div className="md:hidden divide-y divide-white/5">
            {filteredProjects.length === 0 && (
              <p className="p-6 text-sm text-slate-500 text-center">No projects found.</p>
            )}
            {filteredProjects.map(p => {
              const daysLeft = p.end_date ? differenceInDays(parseISO(p.end_date), new Date()) : null;
              const isOverdue = daysLeft !== null && daysLeft < 0 && p.status !== 'Done';
              const isDone = p.status === 'Done';
              return (
                <div key={p.id} className={cn("p-4 flex items-start gap-3 active:bg-white/5 cursor-pointer transition-opacity", isDone && "opacity-50")} onClick={() => setSelectedProject(p)}>
                  <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: isDone ? '#4b5563' : DEPT_COLORS[p.department] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className={cn("text-sm font-bold truncate", isDone && "line-through text-slate-500")}>{p.name}</p>
                      {(unreadCounts[p.id] ?? 0) > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff00ff] text-white text-[9px] font-black flex items-center justify-center animate-pulse">
                          {unreadCounts[p.id]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mb-1.5">{p.assignee_names?.join(', ') ?? p.account_lead_name} · {p.department}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border', STATUS_COLORS[p.status])}>
                        {p.status}
                      </span>
                      {p.end_date && (
                        <span className={cn('text-xs font-mono font-bold', isOverdue ? 'text-[#ff4d4d]' : 'text-slate-400')}>
                          {format(parseISO(p.end_date), 'MMM dd')}
                          {daysLeft !== null && (
                            <span className={cn('ml-1', daysLeft < 0 ? 'text-[#ff4d4d]' : daysLeft < 3 ? 'text-[#ffd700]' : 'text-slate-600')}>
                              ({daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})
                            </span>
                          )}
                        </span>
                      )}
                      {p.is_priority_focus && <span className="text-xs">⭐</span>}
                      {p.is_time_critical && <span className="text-xs">⚠️</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (≥ md) ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/[0.02] text-slate-500 text-[10px] uppercase tracking-[0.2em] font-black">
                  {perms.edit_projects && <th className="px-4 py-5 w-8"></th>}
                  <th className="px-8 py-5">Project Name</th>
                  <th className="px-8 py-5">Account Owner</th>
                  <th className="px-8 py-5">Department</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5">Due Date</th>
                  <th className="px-8 py-5">Days Left</th>
                  <th className="px-8 py-5">Focus</th>
                  <th className="px-8 py-5">Critical</th>
                </tr>
              </thead>
              <tbody ref={tableBodyRef} className="divide-y divide-white/5">
                {filteredProjects.map(p => {
                  const daysLeft = p.end_date ? differenceInDays(parseISO(p.end_date), new Date()) : null;
                  const isOverdue = daysLeft !== null && daysLeft < 0 && p.status !== 'Done';
                  const isDone = p.status === 'Done';

                  return (
                    <tr
                      key={p.id}
                      className={cn("group hover:bg-white/[0.03] transition-all cursor-pointer", isDone && "opacity-50")}
                      data-fc-draggable={perms.edit_projects ? 'true' : undefined}
                      data-project-id={p.id}
                      data-project-name={p.name}
                      onClick={() => setSelectedProject(p)}
                    >
                      {perms.edit_projects && (
                        <td className="pl-4 pr-0 py-5" onClick={e => e.stopPropagation()}>
                          <GripVertical size={14} className="text-slate-600 group-hover:text-slate-400 cursor-grab transition-colors" />
                        </td>
                      )}
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isDone ? '#4b5563' : DEPT_COLORS[p.department] }} />
                          <span className={cn("text-sm font-bold tracking-tight transition-colors", isDone ? "line-through text-slate-500" : "group-hover:text-[#ff00ff]")}>{p.name}</span>
                          {(unreadCounts[p.id] ?? 0) > 0 && (
                            <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff00ff] text-white text-[9px] font-black flex items-center justify-center shadow-lg shadow-[#ff00ff]/40 animate-pulse">
                              {unreadCounts[p.id]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className="text-xs font-medium text-slate-400">
                          {p.assignee_names?.join(', ') ?? p.account_lead_name}
                        </span>
                      </td>
                      <td className="px-8 py-5"><span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{p.department}</span></td>
                      <td className="px-8 py-5">
                        <span className={cn('text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border', STATUS_COLORS[p.status])}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn('text-xs font-mono font-bold', isOverdue ? 'text-[#ff4d4d] animate-pulse' : 'text-slate-300')}>
                          {p.end_date ? format(parseISO(p.end_date), 'yyyy-MM-dd') : '---'}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn('text-xs font-mono font-bold',
                          daysLeft !== null && daysLeft < 3 && daysLeft >= 0 ? 'text-[#ffd700]' :
                          daysLeft !== null && daysLeft < 0 ? 'text-[#ff4d4d]' : 'text-slate-500'
                        )}>
                          {daysLeft !== null ? `${daysLeft}d` : '---'}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all', p.is_priority_focus ? 'bg-[#ff00ff] border-[#ff00ff]' : 'border-white/10')}>
                          {p.is_priority_focus && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all', p.is_time_critical ? 'bg-[#ff4d4d] border-[#ff4d4d]' : 'border-white/10')}>
                          {p.is_time_critical && <Zap size={12} className="text-white" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>{/* end desktop table */}
        </div>
      </main>
    </div>
  );
}

// ── Bottom Navigation Bar (mobile only) ───────────────────────────────────────
function BottomNav({ current, onNavigate, perms, roleColor, systemCards }: {
  current: AppView; onNavigate: (v: AppView) => void;
  perms: RolePermissions; roleColor: string; systemCards: SystemCard[];
}) {
  const trackerLabel = systemCards.find((c: SystemCard) => c.link === 'tracker' && c.link_type === 'internal')?.title ?? 'Tracker';
  const items = [
    { view: 'hub'      as AppView, icon: <Home size={20} />,         label: 'Hub',         always: true },
    { view: 'tracker'  as AppView, icon: <ClipboardList size={20} />, label: trackerLabel,  always: false, show: perms.access_tracker },
    { view: 'workflow' as AppView, icon: <Zap size={20} />,           label: 'Workflow',    always: false, show: true },
    { view: 'it-admin' as AppView, icon: <SettingsIcon size={20} />,  label: 'Admin',       always: false, show: perms.access_it_admin },
  ].filter(i => i.always || i.show);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bottom-nav-safe"
      style={{ background: 'rgba(9,5,26,.97)', borderTop: '1px solid rgba(255,255,255,.08)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-stretch">
        {items.map(item => {
          const active = current === item.view;
          return (
            <button
              key={item.view}
              onClick={() => onNavigate(item.view)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-all min-h-[56px]"
              style={{ color: active ? roleColor : 'rgba(148,163,184,.6)' }}>
              <div style={{ filter: active ? `drop-shadow(0 0 6px ${roleColor})` : 'none', transition: 'filter .2s' }}>
                {item.icon}
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider">{item.label}</span>
              {active && (
                <div className="absolute bottom-0 h-0.5 w-8 rounded-full" style={{ background: roleColor, boxShadow: `0 0 8px ${roleColor}` }} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── View-Only Toast ────────────────────────────────────────────────────────────
function ViewOnlyToast({ show, onClose }: { show: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="view-only-toast-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{    opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(5,2,10,.55)', backdropFilter: 'blur(4px)' }}>
          <motion.div
            key="view-only-toast"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.92, y: 16  }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="pointer-events-auto flex flex-col items-center gap-4 px-8 py-7 rounded-3xl border shadow-2xl"
            style={{
              width: 'min(420px, calc(100vw - 2rem))',
              background: 'linear-gradient(135deg, #110924 0%, #0d071e 100%)',
              borderColor: 'rgba(255,149,0,.45)',
              boxShadow: '0 0 0 1px rgba(255,149,0,.12), 0 0 60px rgba(255,149,0,.2), 0 30px 80px rgba(0,0,0,.8)',
            }}>
            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(255,149,0,.15)', border: '1.5px solid rgba(255,149,0,.35)', boxShadow: '0 0 24px rgba(255,149,0,.2)' }}>
              <EyeOff size={22} style={{ color: '#ff9500' }} />
            </div>
            {/* Text */}
            <div className="text-center">
              <p className="text-sm font-black uppercase tracking-widest mb-2" style={{ color: '#ff9500' }}>
                View Only Mode
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Some features are hidden and you cannot make any changes in this system.
              </p>
            </div>
            {/* Dismiss button */}
            <button onClick={onClose}
              className="mt-1 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              style={{ background: 'rgba(255,149,0,.15)', border: '1px solid rgba(255,149,0,.35)', color: '#ff9500' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,149,0,.25)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,149,0,.15)')}>
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function KPICard({ label, value, icon, critical }: { label: string; value: number; icon: React.ReactNode; critical?: boolean }) {
  return (
    <div className={cn('glass-card p-6 rounded-3xl transition-all duration-300 group relative overflow-hidden', critical && 'border-rose-500/30 bg-rose-500/5')}>
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="p-2 bg-white/5 rounded-xl group-hover:scale-110 transition-transform">{icon}</div>
        <ArrowUpRight size={16} className="text-slate-500 group-hover:text-white transition-colors" />
      </div>
      <div className="relative z-10">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
        <p className={cn('text-3xl font-display font-bold', critical ? 'text-[#ff4d4d]' : 'text-white')}>{value}</p>
      </div>
      <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-all" />
    </div>
  );
}
