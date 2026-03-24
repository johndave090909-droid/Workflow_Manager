import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
import { format } from 'date-fns';
import { Calendar, LogOut, Paperclip, Upload } from 'lucide-react';
import { User, SystemCard, AppView, RolePermissions, Project, Deliverable } from './types';
import { db, storage } from './firebase';
import ComplaintsView from './ComplaintsView';
import { collection, collectionGroup, getDocs, getDoc, orderBy, query, where, updateDoc, doc, addDoc, deleteDoc, setDoc, onSnapshot, serverTimestamp, Timestamp, increment } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { renderAsync as docxRenderAsync } from 'docx-preview';

// ── File-type helpers (mirrored from ProjectDetailModal) ───────────────────────

type FileViewType = 'image' | 'video' | 'pdf' | 'office' | 'other';

function getFileViewType(contentType: string, name: string): FileViewType {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'pdf';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'csv'].includes(ext)) return 'office';
  return 'other';
}

function getFileIcon(type: FileViewType, name: string): string {
  if (type === 'image') return '🖼️';
  if (type === 'video') return '🎬';
  if (type === 'pdf')   return '📄';
  if (type === 'office') {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📊';
    if (['ppt', 'pptx', 'odp'].includes(ext))        return '📊';
    return '📝';
  }
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type HubSection = 'home' | 'complaints' | 'deliverables' | 'org-chart' | 'directory' | 'rules' | 'member-profile' | 'live-guest-count' | 'office-schedules';
type DeliverableWithProject = Deliverable & {
  projectId: string;
  projectName: string;
  projectDirectorsNote: string | null;
  sharedWithAll: boolean;
};

const NAV_ITEMS: { id: HubSection; label: string; emoji: string }[] = [
  { id: 'home',              label: 'Home',              emoji: '🏠' },
  { id: 'complaints',        label: 'Guest Experience',  emoji: '📋' },
  { id: 'deliverables',      label: 'Deliverables',      emoji: '📁' },
  { id: 'org-chart',         label: 'Org Chart',         emoji: '🧭' },
  { id: 'directory',         label: 'Directory',         emoji: '👥' },
  { id: 'rules',             label: 'Rules & Policies',  emoji: '📜' },
  { id: 'live-guest-count',  label: 'Live Guest Count',  emoji: '👥' },
  { id: 'office-schedules', label: 'Office Schedules',  emoji: '🗓️' },
];

// ── Props ──────────────────────────────────────────────────────────────────────

interface SystemHubProps {
  currentUser: User;
  systemCards: SystemCard[];
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
  permissions: RolePermissions;
  roleColor: string;
  projects: Project[];       // visible projects for this user
  allProjects: Project[];    // all projects (for shared deliverable lookup)
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SystemHub({
  currentUser, systemCards, onNavigate, onLogout, permissions, roleColor, projects, allProjects,
}: SystemHubProps) {
  const firstName  = currentUser.name.split(' ')[0];
  const isDirector = permissions.view_all_projects;

  // Restore state when returning from Workflow Automation
  const [hubReturnTarget] = useState<{ user: User; tab: 'profile' | 'work' } | null>(() => {
    try {
      const raw = localStorage.getItem('hub_return_to');
      if (raw) { localStorage.removeItem('hub_return_to'); return JSON.parse(raw); }
    } catch {}
    return null;
  });

  const [activeSection,   setActiveSection]   = useState<HubSection>(hubReturnTarget ? 'member-profile' : 'home');
  const [allDeliverables, setAllDeliverables] = useState<DeliverableWithProject[]>([]);
  const [delivLoading,    setDelivLoading]    = useState(false);
  const [viewerFile,      setViewerFile]      = useState<DeliverableWithProject | null>(null);
  const [directoryUsers,  setDirectoryUsers]  = useState<User[]>([]);
  const [directoryWorkers, setDirectoryWorkers] = useState<{id:string;name:string;role:string;workerId?:string;email?:string;phone?:string;notes?:string;gender?:string;dob?:string;identityCode?:string;hometown?:string;nationality?:string;religion?:string;languages?:string;maritalStatus?:string;permanentAddress?:string;currentAddress?:string}[]>([]);
  const [dirLoading,      setDirLoading]      = useState(false);
  const [profileUser,     setProfileUser]     = useState<User | null>(hubReturnTarget?.user ?? null);

  // Fetch deliverables: visible-project deliverables + shared deliverables for non-directors
  useEffect(() => {
    if (activeSection !== 'deliverables') return;
    setDelivLoading(true);
    const fetchAll = async () => {
      const all: DeliverableWithProject[] = [];
      const seenIds = new Set<string>();

      // Always fetch from the user's visible projects
      await Promise.all(
        projects.map(async (project) => {
          try {
            const snap = await getDocs(
              query(collection(db, 'projects', project.id, 'deliverables'), orderBy('uploadedAt', 'desc'))
            );
            snap.docs.forEach(d => {
              if (!seenIds.has(d.id)) {
                seenIds.add(d.id);
                const data = d.data() as Omit<Deliverable, 'id'>;
                all.push({
                  id: d.id,
                  projectId: project.id,
                  projectName: project.name,
                  projectDirectorsNote: project.directors_note,
                  sharedWithAll: data.sharedWithAll ?? false,
                  ...data,
                } as DeliverableWithProject);
              }
            });
          } catch {}
        })
      );

      // Non-directors also see deliverables shared with all accounts
      if (!isDirector) {
        try {
          const sharedSnap = await getDocs(
            query(collectionGroup(db, 'deliverables'), where('sharedWithAll', '==', true))
          );
          sharedSnap.docs.forEach(d => {
            if (!seenIds.has(d.id)) {
              seenIds.add(d.id);
              const projectId = d.ref.parent.parent?.id ?? '';
              const proj = allProjects.find(p => p.id === projectId);
              const data = d.data() as Omit<Deliverable, 'id'>;
              all.push({
                id: d.id,
                projectId,
                projectName: proj?.name ?? 'Unknown Project',
                projectDirectorsNote: proj?.directors_note ?? null,
                sharedWithAll: true,
                ...data,
              } as DeliverableWithProject);
            }
          });
        } catch {}
      }

      all.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      setAllDeliverables(all);
      setDelivLoading(false);
    };
    fetchAll();
  }, [activeSection, projects, allProjects, isDirector]);

  // Fetch directory users + workers on mount (powers sidebar Members + Directory tab)
  useEffect(() => {
    if (directoryUsers.length > 0) return;
    setDirLoading(true);
    Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'workers')),
    ]).then(([usersSnap, workersSnap]) => {
      const users = usersSnap.docs.map(d => ({ ...d.data(), id: d.id } as User)); // id last so Firestore doc ID always wins
      users.sort((a, b) => a.name.localeCompare(b.name));
      setDirectoryUsers(users);
      const workers = workersSnap.docs.map(d => ({ id: d.id, ...d.data() } as {id:string;name:string;role:string;email?:string;phone?:string;notes?:string}));
      workers.sort((a, b) => a.name.localeCompare(b.name));
      setDirectoryWorkers(workers);
      setDirLoading(false);
    }).catch(() => setDirLoading(false));
  }, [activeSection]);

  // Director toggle: share/unshare a deliverable with all accounts
  const handleToggleShared = async (deliv: DeliverableWithProject) => {
    const newVal = !deliv.sharedWithAll;
    try {
      await updateDoc(doc(db, 'projects', deliv.projectId, 'deliverables', deliv.id), {
        sharedWithAll: newVal,
      });
      setAllDeliverables(prev =>
        prev.map(d =>
          d.id === deliv.id && d.projectId === deliv.projectId
            ? { ...d, sharedWithAll: newVal }
            : d
        )
      );
    } catch {}
  };

  const handleView = (deliv: DeliverableWithProject) => {
    const type = getFileViewType(deliv.contentType, deliv.name);
    if (type === 'image' || type === 'video') {
      setViewerFile(deliv);
    } else if (type === 'pdf') {
      window.open(deliv.url, '_blank');
    } else {
      window.open(`https://docs.google.com/viewer?url=${encodeURIComponent(deliv.url)}`, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0510] text-white flex flex-col">

      {/* ── Header ── */}
      <header className="h-16 border-b border-white/10 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#ff00ff] rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-pink-500/20">W</div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#ff00ff] drop-shadow-[0_0_8px_rgba(255,0,255,0.4)]">Workflow Manager</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
            <Calendar size={16} className="text-[#00ffff]" />
            <span className="text-sm font-medium text-slate-300">{format(new Date(), 'EEEE, MMMM do yyyy')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full p-0.5" style={{ border: `2px solid ${roleColor}` }}>
              <img
                src={currentUser.photo || `https://picsum.photos/seed/${currentUser.id}/100/100`}
                className="w-full h-full rounded-full object-cover"
                alt="Profile"
              />
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-bold text-white leading-none">{currentUser.name}</p>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: roleColor }}>{currentUser.role}</p>
            </div>
            <button onClick={onLogout} title="Logout" className="ml-1 p-2 text-slate-500 hover:text-white transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile section tabs (visible only on mobile) ── */}
      <div className="md:hidden flex border-b border-white/10 bg-[#0a0510]/80 backdrop-blur-md sticky top-16 z-40">
        {NAV_ITEMS.map(item => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide transition-colors touch-target"
              style={{ color: active ? roleColor : '#64748b', borderBottom: active ? `2px solid ${roleColor}` : '2px solid transparent' }}
            >
              <span className="text-base leading-none">{item.emoji}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Body: sidebar + content ── */}
      <div className="flex flex-1">

        {/* Sidebar */}
        <aside
          className="hidden md:flex w-60 shrink-0 border-r border-white/8 sticky top-16 h-[calc(100vh-4rem)] flex-col overflow-y-auto"
          style={{ background: 'rgba(6,3,11,0.98)' }}
        >
          {/* User block */}
          <div className="px-5 pt-6 pb-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden shrink-0" style={{ border: `2px solid ${roleColor}` }}>
              <img
                src={currentUser.photo || `https://picsum.photos/seed/${currentUser.id}/100/100`}
                className="w-full h-full object-cover"
                alt=""
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate leading-none">{currentUser.name}</p>
              <p className="text-[9px] font-black uppercase tracking-widest truncate mt-0.5" style={{ color: roleColor }}>
                {currentUser.role}
              </p>
            </div>
          </div>

          {/* MENU section */}
          <div className="px-5 pt-4 pb-1">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-600 mb-2">Menu</p>
            <nav className="flex flex-col gap-0.5">
              {NAV_ITEMS.map(item => {
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className="group flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 text-left w-full"
                    style={active
                      ? { backgroundColor: roleColor, color: '#fff', boxShadow: `0 2px 12px ${roleColor}40` }
                      : { color: '#64748b' }
                    }
                    onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1'; } }}
                    onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; } }}
                  >
                    <span className="text-base leading-none w-5 text-center shrink-0">{item.emoji}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* MEMBERS section */}
          <div className="px-5 pt-6 pb-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-600">Members</p>
              {permissions.access_it_admin && (
                <button
                  onClick={() => onNavigate('it-admin')}
                  title="Manage users"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-slate-500 hover:text-white hover:bg-white/10 transition-all border border-white/10"
                >+</button>
              )}
            </div>
            {dirLoading ? (
              <div className="flex justify-center py-3">
                <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                {directoryUsers.filter(u => u.role !== 'Director').slice(0, 8).map(u => {
                  const rc = ROLE_PALETTE[u.role] ?? '#64748b';
                  return (
                    <button key={u.id} onClick={() => { setProfileUser(u); setActiveSection('member-profile'); }} className="flex items-center gap-2.5 w-full text-left rounded-lg px-1 -mx-1 py-0.5 hover:bg-white/5 transition-colors">
                      <div className="relative shrink-0">
                        <img
                          src={u.photo || `https://picsum.photos/seed/${u.id}/100/100`}
                          className="w-7 h-7 rounded-full object-cover"
                          style={{ border: `1.5px solid ${rc}70` }}
                          alt={u.name}
                        />
                        <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-[#06030b]" style={{ backgroundColor: rc }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-slate-200 truncate leading-tight">{u.name}</p>
                        <p className="text-[8px] text-slate-500 truncate">{u.role}</p>
                      </div>
                    </button>
                  );
                })}
                {directoryUsers.length > 8 && (
                  <button
                    onClick={() => setActiveSection('directory')}
                    className="text-[9px] font-bold text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    +{directoryUsers.length - 8} more
                  </button>
                )}
              </div>
            )}
          </div>

          {/* GENERAL section */}
          <div className="px-5 pt-6 pb-4 mt-auto border-t border-white/8">
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-600 mb-2">General</p>
            <nav className="flex flex-col gap-0.5">
              <button
                onClick={onLogout}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 text-left w-full"
                style={{ color: '#64748b' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; }}
              >
                <span className="text-base leading-none w-5 text-center shrink-0">🚪</span>
                <span>Sign Out</span>
              </button>
            </nav>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto pb-nav md:pb-0">

          {/* HOME */}
          {activeSection === 'home' && (
            <>
              <div className="py-4 sm:py-16 text-center px-4 sm:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-2 sm:mb-3">System Hub</p>
                <h2 className="text-2xl sm:text-4xl font-bold text-white mb-1 sm:mb-3">
                  Welcome back, <span style={{ color: roleColor }}>{firstName}</span>
                </h2>
                <p className="hidden sm:block text-sm text-slate-400">Select a system to get started.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6 max-w-5xl mx-auto px-3 sm:px-8 pb-16 sm:pb-24">
                {systemCards.filter(c => c.link !== 'management-council' && c.link !== 'workflow').map(card => (
                  <SystemCardTile key={card.id} card={card} onNavigate={onNavigate} />
                ))}
                {systemCards.filter(c => c.link !== 'management-council' && c.link !== 'workflow').length === 0 && (
                  <div className="col-span-3 text-center py-20 text-slate-600 italic text-sm">
                    No systems available. Contact your IT Administrator.
                  </div>
                )}
              </div>
            </>
          )}

          {/* COMPLAINTS */}
          {activeSection === 'complaints' && (
            <ComplaintsView currentUser={currentUser} roleColor={roleColor} isItAdmin={permissions.access_it_admin} canAnalyze={permissions.access_it_admin || permissions.view_all_projects} />
          )}

          {/* DELIVERABLES */}
          {activeSection === 'deliverables' && (
            <div className="p-4 sm:p-8 max-w-5xl mx-auto">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-1">Deliverables</h2>
                <p className="text-sm text-slate-400">All files uploaded across projects.</p>
              </div>

              <DeliverableGroups
                deliverables={allDeliverables}
                loading={delivLoading}
                isDirector={isDirector}
                onToggleShared={handleToggleShared}
                onView={handleView}
              />
            </div>
          )}

          {/* ORG CHART */}
          {activeSection === 'org-chart' && (
            <OrgChartView roleColor={roleColor} />
          )}

          {/* DIRECTORY */}
          {activeSection === 'directory' && (
            <DirectoryView users={directoryUsers} workers={directoryWorkers} loading={dirLoading} roleColor={roleColor} currentUserId={currentUser.id} isAdmin={permissions.manage_policies ?? (permissions.access_it_admin || permissions.view_all_projects)} />
          )}

          {/* MEMBER PROFILE */}
          {activeSection === 'member-profile' && profileUser && (
            <MemberProfilePage
              key={profileUser.id}
              profileUser={profileUser}
              worker={directoryWorkers.find(w => w.name === profileUser.name) ?? null}
              onBack={() => setActiveSection('home')}
              onWorkerUpdated={(updated) =>
                setDirectoryWorkers(prev => prev.map(w => w.id === updated.id ? { ...w, ...updated } : w))
              }
              onNavigate={onNavigate}
              systemCards={systemCards}
              defaultTab={hubReturnTarget?.user.id === profileUser?.id ? hubReturnTarget?.tab : undefined}
              currentUser={currentUser}
              isDirector={isDirector}
            />
          )}

          {/* LIVE GUEST COUNT */}
          {activeSection === 'live-guest-count' && (
            <LiveGuestCountView roleColor={roleColor} />
          )}

          {/* RULES & POLICIES */}
          {activeSection === 'rules' && (
            <RulesAndPoliciesView
              isAdmin={permissions.manage_policies ?? (permissions.access_it_admin || permissions.view_all_projects)}
              currentUserName={currentUser.name}
              roleColor={roleColor}
            />
          )}

          {/* OFFICE SCHEDULES */}
          {activeSection === 'office-schedules' && (
            <OfficeSchedulesView
              roleColor={roleColor}
              currentUser={currentUser}
              isDirector={isDirector}
              directoryUsers={directoryUsers}
              onViewProfile={u => { setProfileUser(u); setActiveSection('member-profile'); }}
            />
          )}

        </main>
      </div>

      {/* IT Admin FAB */}
      {permissions.access_it_admin && (
        <button
          onClick={() => onNavigate('it-admin')}
          className="fixed bottom-[calc(5rem+var(--sab))] md:bottom-8 right-4 md:right-8 flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-bold text-sm z-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#a855f7', boxShadow: '0 0 24px rgba(168,85,247,0.4)' }}
        >
          ⚙ Manage Systems
        </button>
      )}

      {/* Image / video viewer overlay */}
      {viewerFile && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center"
          onClick={() => setViewerFile(null)}
        >
          <div className="absolute top-4 right-4 flex gap-3" onClick={e => e.stopPropagation()}>
            <a
              href={viewerFile.url}
              download={viewerFile.name}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-bold rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              ↓ Download
            </a>
            <button
              onClick={() => setViewerFile(null)}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              ✕ Close
            </button>
          </div>
          <div className="max-w-5xl max-h-[80vh] w-full px-8" onClick={e => e.stopPropagation()}>
            {getFileViewType(viewerFile.contentType, viewerFile.name) === 'image' ? (
              <img src={viewerFile.url} alt={viewerFile.name} className="max-h-[80vh] max-w-full mx-auto rounded-2xl object-contain" />
            ) : (
              <video src={viewerFile.url} controls autoPlay className="max-h-[80vh] max-w-full mx-auto rounded-2xl" />
            )}
          </div>
          <p className="mt-4 text-sm text-slate-400">{viewerFile.name}</p>
        </div>
      )}

    </div>
  );
}

// ── DeliverableGroups ──────────────────────────────────────────────────────────

const PROJECT_ACCENTS = [
  '#ff00ff', '#00ffff', '#ffd700', '#ff4d4d',
  '#a855f7', '#22d3ee', '#fb923c', '#4ade80',
];

interface DeliverableGroupsProps {
  deliverables: DeliverableWithProject[];
  loading: boolean;
  isDirector: boolean;
  onToggleShared: (d: DeliverableWithProject) => void;
  onView: (d: DeliverableWithProject) => void;
}

type OrgCardTone = 'blue' | 'red' | 'green' | 'purple';

interface OrgCardItem {
  id: string;
  name: string;
  personName?: string;
  tone: OrgCardTone;
  x: number;
  y: number;
}

const ORG_TONE_STYLES: Record<OrgCardTone, { border: string; bg: string; glow: string }> = {
  blue: {
    border: 'rgba(96, 165, 250, 0.7)',
    bg: 'linear-gradient(180deg, rgba(30,58,138,0.2), rgba(15,23,42,0.75))',
    glow: 'rgba(96, 165, 250, 0.35)',
  },
  red: {
    border: 'rgba(248, 113, 113, 0.75)',
    bg: 'linear-gradient(180deg, rgba(153,27,27,0.2), rgba(15,23,42,0.75))',
    glow: 'rgba(248, 113, 113, 0.35)',
  },
  green: {
    border: 'rgba(74, 222, 128, 0.75)',
    bg: 'linear-gradient(180deg, rgba(20,83,45,0.2), rgba(15,23,42,0.75))',
    glow: 'rgba(74, 222, 128, 0.3)',
  },
  purple: {
    border: 'rgba(196, 181, 253, 0.8)',
    bg: 'linear-gradient(180deg, rgba(88,28,135,0.2), rgba(15,23,42,0.75))',
    glow: 'rgba(196, 181, 253, 0.35)',
  },
};

const ORG_CARD_WIDTH = 86;
const ORG_CARD_HEIGHT = 112;
const ORG_CANVAS_WIDTH = 2200;
const ORG_CANVAS_HEIGHT = 1450;

function buildOrgChartDefaults(): OrgCardItem[] {
  const items: OrgCardItem[] = [];
  const push = (name: string, tone: OrgCardTone, x: number, y: number) => {
    items.push({
      id: `org-card-${items.length + 1}`,
      name,
      tone,
      x,
      y,
    });
  };
  const placeRow = (names: string[], tone: OrgCardTone, startX: number, y: number, gapX = 96) => {
    names.forEach((name, idx) => push(name, tone, startX + idx * gapX, y));
  };

  const redStartX = 10;
  const redGap = 96;
  const greenStartX = 1210;
  const greenGap = 96;
  const purpleStartX = 1498;
  const purpleGap = 96;
  const yOffset = 120;
  const topY = (y: number) => y + yOffset;

  // Top leadership rows
  push('Culinary Director/Executive Chef', 'blue', 1040, topY(18));
  push('Sous Chef', 'blue', 1040, topY(144));
  placeRow(['Accountant', 'Leadership', 'Supply Chain'], 'blue', 430, topY(218), 104);
  placeRow(['Junior Sous Chef', 'Junior Sous Chef', 'Junior Sous Chef'], 'blue', 935, topY(218), 96);
  push('Pastry Chef', 'blue', 1668, topY(218));

  // Lead row
  push('CDP', 'red', 1040, topY(344));
  placeRow(
    ['Student Lead Morning', 'Student Lead Afternoon', 'Front of the House Lead', 'Student Lead Kitchen Pass', 'Student Lead Prep Team'],
    'red',
    60,
    topY(436),
    274
  );
  push('Pantry Lead', 'green', greenStartX, topY(436));
  placeRow(['Student Lead Morning', 'Student Lead Morning', 'Student Lead Afternoon', 'Student Lead Morning'], 'purple', purpleStartX, topY(436), purpleGap * 2);

  // Main matrix rows (exact rows/columns pattern)
  placeRow(
    ['Beef & Ribs Prep', 'Luau Prep', 'Gateway Braiser', 'Oven & Wok Prep', 'Student Expo', 'Wok', 'Poke Bar 1', 'Poke Bar 2', 'Night Prep 1', 'Garnish Prep', 'Prep Cook 1', 'Prep Cook 2'],
    'red',
    redStartX,
    topY(548),
    redGap
  );
  placeRow(['Pantry Prep 1', 'Pantry Prep 2'], 'green', greenStartX, topY(548), greenGap);
  placeRow(['Student Early Morning 1', 'Student Early Morning 2', 'Student Morning 1', 'Student Morning 2', 'Student Afternoon 1', 'Student Night 1', 'Student Night 2'], 'purple', purpleStartX, topY(548), purpleGap);

  placeRow(
    ['Veg Prep', 'Sauce Prep', 'AM Fryer 1', 'AM Fryer 2', 'Grill Station', 'Sashimi Station', 'Poke Bar 3', 'Imu Carver', 'Night Oven 1', 'Night Oven 2', 'Prep Cook 3', 'Prep Cook 4'],
    'red',
    redStartX,
    topY(670),
    redGap
  );
  placeRow(['Pantry Prep 3', 'Pantry Prep 4'], 'green', greenStartX, topY(670), greenGap);
  placeRow(['Student Early Morning 3', 'Student Early Morning 4', 'Student Morning 3', 'Student Morning 4', 'Student Afternoon 2', 'Student Night 3', 'Student Night 4'], 'purple', purpleStartX, topY(670), purpleGap);

  placeRow(
    ['Luau Braiser', 'Rice Prep', 'Sauces & Soup', 'Oven & Weight', 'Chicken Carver', 'Kampachi Carver', 'Imu Carver', 'Imu Carver', 'Night Garnish 1', 'Night Garnish 2', 'Prep Cook 5', 'Prep Cook 6'],
    'red',
    redStartX,
    topY(792),
    redGap
  );
  placeRow(['Pantry Prep 5', 'Pantry Prep 6'], 'green', greenStartX, topY(792), greenGap);
  placeRow(['Student Early Morning 5', 'Student Morning 5', 'Student Afternoon 3', 'Student Night 5'], 'purple', purpleStartX, topY(792), purpleGap * 2);

  placeRow(
    ['Imu Student', 'Imu Student', 'Chicken & Fish Prep', 'Poisson Cru 1', 'Poisson Cru 2', 'Kampachi Carver', 'Kampachi Carver', 'PM Fryer 1', 'PM Fryer 2', 'Prep Cook 7', 'Prep Cook 8'],
    'red',
    redStartX,
    topY(914),
    redGap
  );
  placeRow(['Pantry Prep 7', 'Pantry Prep 8'], 'green', greenStartX, topY(914), greenGap);
  placeRow(['Student Afternoon 4'], 'purple', purpleStartX + purpleGap * 4, topY(914), purpleGap);

  // Lowest row offsets shown in reference
  placeRow(['Stock Carver 1', 'Stock Carver 2'], 'red', redStartX + redGap * 3, topY(1036), redGap);
  placeRow(['Kampachi Carver'], 'red', redStartX + redGap * 7, topY(1036), redGap);
  placeRow(['Pantry Prep 9', 'Pantry Prep 10'], 'green', greenStartX, topY(1036), greenGap);

  return items;
}

// ── DirectoryView ──────────────────────────────────────────────────────────────

interface DirectoryEntry extends Omit<User, 'id'> {
  id: string;
  isWorkerRecord?: boolean;
  phone?: string;
  notes?: string;
}

interface DirectoryViewProps {
  users: User[];
  workers: { id: string; name: string; role: string; email?: string }[];
  loading: boolean;
  roleColor: string;
  currentUserId: string;
  isAdmin: boolean;
}

const ROLE_PALETTE: Record<string, string> = {
  Director:       '#ff00ff',
  'IT Admin':     '#a855f7',
  'Office Admin': '#00ffff',
  Manager:        '#ffd700',
  Staff:          '#22c55e',
};

function getRoleColor(role: string): string {
  return ROLE_PALETTE[role] ?? '#64748b';
}

// Classify a role into a directory section
function classifyRole(role: string): 'leadership' | 'team-leaders' | 'workers' {
  const r = role.toLowerCase();
  if (/director|chef|manager|admin|accountant|supply|leadership|pastry/.test(r)) return 'leadership';
  if (/lead|supervisor|cdp|sous|captain|senior/.test(r)) return 'team-leaders';
  return 'workers';
}

interface EmployeeCardProps { u: DirectoryEntry; isMe: boolean; onClick: () => void; }
function EmployeeCard({ u, isMe, onClick }: EmployeeCardProps) {
  const rc = getRoleColor(u.role);
  return (
    <div
      onClick={onClick}
      className="relative flex flex-col items-center text-center rounded-2xl border p-3 sm:p-4 transition-all hover:scale-[1.02] cursor-pointer"
      style={{
        background: isMe ? `${rc}10` : 'rgba(255,255,255,0.02)',
        borderColor: isMe ? `${rc}50` : 'rgba(255,255,255,0.08)',
        boxShadow: isMe ? `0 0 18px ${rc}20` : 'none',
      }}
    >
      {isMe && (
        <span className="absolute top-2 right-2 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{ background: `${rc}25`, color: rc }}>You</span>
      )}
      {u.isWorkerRecord && !isMe && (
        <span className="absolute top-2 right-2 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-600">No account</span>
      )}
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden mb-2 sm:mb-2.5 shrink-0"
        style={{ border: `2px solid ${rc}60` }}>
        <img src={u.photo || `https://picsum.photos/seed/${u.id}/100/100`} alt={u.name}
          className="w-full h-full object-cover" />
      </div>
      <p className="text-xs sm:text-sm font-bold text-white leading-snug">{u.name}</p>
      <span className="mt-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
        style={{ background: `${rc}20`, color: rc }}>
        {u.role}
      </span>
      {u.email && (
        <a href={`mailto:${u.email}`}
          className="mt-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors truncate max-w-full"
          onClick={e => e.stopPropagation()}>
          {u.email}
        </a>
      )}
    </div>
  );
}

// ── DocxIframe — renders stored HTML in an isolated iframe via Blob URL ────────
function DocxIframe({ html, editing, iframeRef }: { html: string; editing: boolean; iframeRef: React.RefObject<HTMLIFrameElement> }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const apply = () => {
      try { if (iframe.contentDocument) iframe.contentDocument.designMode = editing ? 'on' : 'off'; } catch {}
    };
    iframe.addEventListener('load', apply);
    apply();
    return () => iframe.removeEventListener('load', apply);
  }, [editing, src, iframeRef]);

  return src ? (
    <iframe ref={iframeRef} src={src} className="w-full h-full border-0 bg-white" title="Document preview" sandbox="allow-same-origin allow-scripts" />
  ) : null;
}

// ── WorkDocuments ──────────────────────────────────────────────────────────────

interface WorkDoc {
  id: string; name: string; url: string; storagePath: string; uploadedAt: string;
  htmlContent?: string;
  approved?: boolean; approvedBy?: string; approvedAt?: string;
  commentCount?: number;
}
interface DocComment { id: string; text: string; authorName: string; authorId: string; createdAt: string; }

function fileExt(name: string)        { return name.split('.').pop()?.toLowerCase() ?? ''; }
function isImage(name: string)        { return ['jpg','jpeg','png','gif','webp','svg'].includes(fileExt(name)); }
function isPdf(name: string)          { return fileExt(name) === 'pdf'; }
function isDocx(name: string)         { return ['doc','docx'].includes(fileExt(name)); }
function isVideo(name: string)        { return ['mp4','mov','webm','avi','mkv','m4v'].includes(fileExt(name)); }
function isSpreadsheet(name: string)  { return ['xls','xlsx','csv','ods'].includes(fileExt(name)); }
function isPptx(name: string)         { return ['ppt','pptx','odp'].includes(fileExt(name)); }
function isOfficeViewer(name: string) { return isSpreadsheet(name) || isPptx(name); }
function getDocIcon(name: string) {
  if (isImage(name))       return '🖼️';
  if (isPdf(name))         return '📋';
  if (isDocx(name))        return '📝';
  if (isVideo(name))       return '🎬';
  if (isSpreadsheet(name)) return '📊';
  if (isPptx(name))        return '📊';
  return '📄';
}

function WorkDocuments({ collPath, currentUser, isDirector }: {
  collPath: string;
  currentUser: { id: string; name: string };
  isDirector: boolean;
}) {
  const [docs,      setDocs]      = useState<WorkDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [viewing,   setViewing]   = useState<WorkDoc | null>(null);
  const [editing,   setEditing]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [approving, setApproving] = useState(false);
  const [comments,  setComments]  = useState<DocComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [readTick, setReadTick] = useState(0); // bumped to re-render list after marking read
  const [dragging, setDragging] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const iframeRef      = useRef<HTMLIFrameElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  // localStorage helpers for tracking unread comments
  const seenKey = (docId: string) => `comments_seen_${currentUser.id}_${collPath}_${docId}`;
  const getSeen  = (docId: string) => parseInt(localStorage.getItem(seenKey(docId)) ?? '0', 10);
  const markSeen = (docId: string, count: number) => {
    localStorage.setItem(seenKey(docId), String(count));
    setReadTick(t => t + 1);
  };
  const getUnread = (d: WorkDoc) => Math.max(0, (d.commentCount ?? 0) - getSeen(d.id));

  const load = () =>
    getDocs(collection(db, collPath))
      .then(s => setDocs(s.docs.map(d => ({ id: d.id, ...d.data() } as WorkDoc))))
      .catch(() => {});

  useEffect(() => { load(); }, [collPath]);

  // Real-time comments; syncs count + marks as read while doc is open
  useEffect(() => {
    if (!viewing) { setComments([]); return; }
    const docId = viewing.id;
    const commentsCol = collection(db, `${collPath}/${docId}/comments`);
    const q = query(commentsCol, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setComments(snap.docs.map(d => {
        const data = d.data();
        const ts = data.createdAt;
        const createdAt = ts instanceof Timestamp ? ts.toDate().toISOString() : (ts ?? '');
        return { id: d.id, text: data.text, authorName: data.authorName, authorId: data.authorId, createdAt };
      }));
      const liveCount = snap.docs.length;
      // Keep commentCount in sync on the doc list
      setDocs(prev => prev.map(d => d.id === docId ? { ...d, commentCount: liveCount } : d));
      // Auto-mark as read while the viewer is open
      markSeen(docId, liveCount);
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });
    return unsub;
  }, [viewing?.id, collPath]);

  const handleUpload = async (file: File) => {
    setUploading(true); setProgress(0);
    let htmlContent: string | undefined;
    if (isDocx(file.name)) {
      try {
        const buf = await file.arrayBuffer();
        const container = document.createElement('div');
        const styleContainer = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;';
        document.body.appendChild(container);
        document.body.appendChild(styleContainer);
        await docxRenderAsync(buf, container, styleContainer);
        htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8">${styleContainer.innerHTML}</head><body style="margin:0;padding:32px;background:#fff;color:#000;">${container.innerHTML}</body></html>`;
        document.body.removeChild(container);
        document.body.removeChild(styleContainer);
      } catch (err) {
        console.warn('docx-preview conversion failed:', err);
      }
    }
    const storagePath = `${collPath}/${Date.now()}_${file.name}`;
    const task = uploadBytesResumable(ref(storage, storagePath), file);
    task.on('state_changed',
      s => setProgress(Math.round(s.bytesTransferred / s.totalBytes * 100)),
      () => setUploading(false),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await addDoc(collection(db, collPath), {
          name: file.name, url, storagePath,
          uploadedAt: new Date().toISOString(),
          ...(htmlContent ? { htmlContent } : {}),
        });
        setUploading(false); setProgress(0); load();
      }
    );
  };

  const handleDelete = async (d: WorkDoc) => {
    if (!window.confirm(`Delete "${d.name}"?`)) return;
    if (viewing?.id === d.id) { setViewing(null); setEditing(false); }
    await deleteObject(ref(storage, d.storagePath)).catch(() => {});
    await deleteDoc(doc(db, collPath, d.id));
    load();
  };

  const handleSaveEdit = async () => {
    if (!viewing) return;
    setSaving(true);
    try {
      const newHtml = iframeRef.current?.contentDocument?.documentElement?.outerHTML;
      if (newHtml) {
        await updateDoc(doc(db, collPath, viewing.id), { htmlContent: newHtml });
        const updated = { ...viewing, htmlContent: newHtml };
        setDocs(prev => prev.map(d => d.id === viewing.id ? updated : d));
        setViewing(updated);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const handleApprove = async () => {
    if (!viewing || !isDirector) return;
    setApproving(true);
    try {
      const already = !!viewing.approved;
      const update = already
        ? { approved: false, approvedBy: null, approvedAt: null }
        : { approved: true, approvedBy: currentUser.name, approvedAt: new Date().toISOString() };
      await updateDoc(doc(db, collPath, viewing.id), update);
      const updated = { ...viewing, ...update } as WorkDoc;
      setDocs(prev => prev.map(d => d.id === viewing.id ? updated : d));
      setViewing(updated);
    } finally {
      setApproving(false);
    }
  };

  const handlePostComment = async () => {
    const text = newComment.trim();
    if (!text || !viewing) return;
    setPostingComment(true);
    try {
      await addDoc(collection(db, `${collPath}/${viewing.id}/comments`), {
        text,
        authorName: currentUser.name,
        authorId: currentUser.id,
        createdAt: serverTimestamp(),
      });
      // Persist comment count on the parent doc for list-view badge
      await updateDoc(doc(db, collPath, viewing.id), { commentCount: increment(1) });
      setNewComment('');
    } finally {
      setPostingComment(false);
    }
  };

  return (
    <>
      {/* Inline viewer modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0d0816] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-sm font-bold text-white truncate max-w-[300px]">{viewing.name}</p>
              {viewing.approved && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 border border-emerald-400/30 text-emerald-300">
                  ✓ Approved by {viewing.approvedBy}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isDirector && (
                <button onClick={handleApprove} disabled={approving}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors disabled:opacity-50 ${
                    viewing.approved
                      ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300 hover:bg-rose-500/20 hover:border-rose-400/30 hover:text-rose-300'
                      : 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30'
                  }`}>
                  {approving ? '…' : viewing.approved ? 'Revoke Approval' : 'Approve'}
                </button>
              )}
              {isDocx(viewing.name) && viewing.htmlContent && !editing && (
                <button onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 hover:bg-indigo-500/30 transition-colors">
                  Edit
                </button>
              )}
              {editing && (
                <>
                  <button onClick={handleSaveEdit} disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-green-500/20 border border-green-400/30 text-green-300 hover:bg-green-500/30 transition-colors disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)} disabled={saving}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/10 border border-white/15 text-slate-300 hover:bg-white/15 transition-colors">
                    Cancel
                  </button>
                </>
              )}
              {!editing && (
                <a href={viewing.url} download={viewing.name}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/10 border border-white/15 text-slate-300 hover:bg-white/15 transition-colors">
                  Download
                </a>
              )}
              <button onClick={() => { setViewing(null); setEditing(false); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors text-lg leading-none">✕</button>
            </div>
          </div>
          {editing && (
            <div className="px-4 py-2 bg-indigo-900/30 border-b border-indigo-400/20 shrink-0">
              <p className="text-[10px] text-indigo-300 font-semibold">Editing — click anywhere in the document to start typing. Press Save when done.</p>
            </div>
          )}

          {/* Body: document + comments side panel */}
          <div className="flex-1 flex overflow-hidden">
            {/* Document area */}
            <div className="flex-1 overflow-hidden">
              {isImage(viewing.name) ? (
                <img src={viewing.url} alt={viewing.name} className="w-full h-full object-contain p-4" />
              ) : isPdf(viewing.name) ? (
                <iframe src={viewing.url} className="w-full h-full border-0" title={viewing.name} />
              ) : isVideo(viewing.name) ? (
                <div className="w-full h-full flex items-center justify-center bg-black p-4">
                  <video src={viewing.url} controls className="max-w-full max-h-full rounded-xl" />
                </div>
              ) : isOfficeViewer(viewing.name) ? (
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(viewing.url)}`}
                  className="w-full h-full border-0 bg-white"
                  title={viewing.name}
                />
              ) : isDocx(viewing.name) ? (
                viewing.htmlContent
                  ? <DocxIframe html={viewing.htmlContent} editing={editing} iframeRef={iframeRef} />
                  : <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 text-center px-6">
                      <span className="text-4xl">📄</span>
                      <p className="text-sm font-semibold text-white">Preview not available</p>
                      <p className="text-xs text-slate-500">This file was uploaded before preview support was added.<br/>Delete it and re-upload to enable inline viewing.</p>
                    </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                  <span className="text-4xl">📄</span>
                  <p className="text-sm">Preview not available for this file type.</p>
                  <a href={viewing.url} download={viewing.name}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-bold transition-colors">
                    Download to open
                  </a>
                </div>
              )}
            </div>

            {/* Comments panel */}
            <div className="w-72 shrink-0 border-l border-white/10 bg-[#0d0816] flex flex-col">
              <div className="px-4 py-3 border-b border-white/10 shrink-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Comments</p>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {comments.length === 0 && (
                  <p className="text-xs text-slate-600 italic text-center mt-4">No comments yet.</p>
                )}
                {comments.map(c => (
                  <div key={c.id} className="rounded-xl bg-white/[0.04] border border-white/10 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-cyan-400 truncate">{c.authorName}</span>
                      <span className="text-[9px] text-slate-600 shrink-0">
                        {(() => { try { return format(new Date(c.createdAt), 'MMM d, h:mm a'); } catch { return ''; } })()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>
              {/* Comment input */}
              <div className="px-3 py-3 border-t border-white/10 shrink-0 space-y-2">
                <textarea
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                  placeholder="Add a comment…"
                  rows={3}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 resize-none focus:outline-none focus:border-cyan-500/50 focus:bg-white/[0.08] transition-colors"
                />
                <button onClick={handlePostComment} disabled={postingComment || !newComment.trim()}
                  className="w-full py-1.5 rounded-lg text-[10px] font-bold bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 hover:bg-cyan-500/30 transition-colors disabled:opacity-40">
                  {postingComment ? 'Posting…' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paperclip size={14} className="text-[#ff00ff]" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Deliverables</p>
            {docs.length > 0 && <span className="text-[9px] text-slate-600">{docs.length} file{docs.length !== 1 ? 's' : ''}</span>}
          </div>
          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer select-none transition-all
            ${uploading
              ? 'opacity-60 cursor-wait border-white/10 text-slate-500'
              : 'border-[#ff00ff]/30 text-[#ff00ff] hover:bg-[#ff00ff]/10 hover:border-[#ff00ff]/50'}`}>
            {uploading ? (
              <><span className="w-3 h-3 border-2 border-[#ff00ff]/30 border-t-[#ff00ff] rounded-full animate-spin block" />{progress}%</>
            ) : (
              <><Upload size={12} /> Upload File</>
            )}
            <input ref={fileInputRef} type="file" className="hidden" disabled={uploading}
              accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.csv"
              onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }} />
          </label>
        </div>

        {/* Upload progress bar */}
        {uploading && (
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#ff00ff] rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* Empty drop zone */}
        {docs.length === 0 && !uploading && (
          <div
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all
              ${dragging ? 'border-[#ff00ff]/50 bg-[#ff00ff]/5' : 'border-white/10 hover:border-white/20'}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-slate-500 text-sm font-medium">Drop files here or click to upload</p>
            <p className="text-slate-700 text-[10px] mt-1">PDF · Excel · Word · PowerPoint · Images · Videos · Max 100 MB</p>
          </div>
        )}

        {/* File list (also a drop target) */}
        {docs.length > 0 && (
          <div
            className={`space-y-2 rounded-2xl transition-all ${dragging ? 'outline-dashed outline-2 outline-[#ff00ff]/30 outline-offset-4' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); }}
          >
            {docs.map(d => {
              const unread = getUnread(d);
              const total  = d.commentCount ?? 0;
              return (
                <div key={d.id} className={`flex items-center gap-3 p-3 rounded-xl border group transition-colors ${
                  unread > 0 ? 'bg-cyan-500/[0.06] border-cyan-500/25' : 'bg-white/[0.03] border-white/10'
                }`}>
                  <span className="text-lg shrink-0">{getDocIcon(d.name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setViewing(d)}
                        className="text-sm font-semibold text-white hover:text-cyan-300 transition-colors truncate block text-left">
                        {d.name}
                      </button>
                      {d.approved && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 border border-emerald-400/30 text-emerald-400">✓</span>
                      )}
                      {unread > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-black bg-cyan-500 text-white flex items-center justify-center">
                          {unread}
                        </span>
                      )}
                      {unread === 0 && total > 0 && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-slate-500 font-semibold">
                          💬 {total}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {(() => { try { return format(new Date(d.uploadedAt), 'MMM d, yyyy'); } catch { return ''; } })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => setViewing(d)}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors">
                      View
                    </button>
                    <a href={d.url} download={d.name}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-colors">↓</a>
                    <button onClick={() => handleDelete(d)}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-colors">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── MemberProfilePage ──────────────────────────────────────────────────────────

type WorkerData = {
  id: string; name: string; role: string; workerId?: string; email?: string;
  phone?: string; notes?: string; gender?: string; dob?: string; identityCode?: string;
  hometown?: string; nationality?: string; religion?: string; languages?: string;
  maritalStatus?: string; permanentAddress?: string; currentAddress?: string;
};

interface MemberProfilePageProps {
  profileUser: User;
  worker: WorkerData | null;
  onBack: () => void;
  onWorkerUpdated: (updated: WorkerData) => void;
  onNavigate: (view: AppView) => void;
  systemCards: SystemCard[];
  defaultTab?: 'profile' | 'work';
  currentUser: User;
  isDirector: boolean;
}

function MemberProfilePage({ profileUser, worker, onBack, onWorkerUpdated, onNavigate, systemCards, defaultTab, currentUser, isDirector }: MemberProfilePageProps) {
  const rc = ROLE_PALETTE[profileUser.role] ?? '#64748b';

  const [profileTab, setProfileTab] = React.useState<'profile' | 'work'>(defaultTab ?? 'profile');
  const [editing, setEditing] = React.useState(false);
  const [saving,  setSaving]  = React.useState(false);
  const [form, setForm] = React.useState<Omit<WorkerData, 'id' | 'name' | 'role'>>({
    workerId: worker?.workerId || '',
    email: worker?.email || profileUser.email || '',
    phone: worker?.phone || '',
    notes: worker?.notes || '',
    gender: worker?.gender || '',
    dob: worker?.dob || '',
    identityCode: worker?.identityCode || '',
    hometown: worker?.hometown || '',
    nationality: worker?.nationality || '',
    religion: worker?.religion || '',
    languages: worker?.languages || '',
    maritalStatus: worker?.maritalStatus || '',
    permanentAddress: worker?.permanentAddress || '',
    currentAddress: worker?.currentAddress || '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      if (worker) {
        await updateDoc(doc(db, 'workers', worker.id), form as Record<string, string>);
        onWorkerUpdated({ ...worker, ...form });
      } else {
        const newData = { name: profileUser.name, role: profileUser.role, ...form };
        const ref = await addDoc(collection(db, 'workers'), newData);
        onWorkerUpdated({ id: ref.id, name: profileUser.name, role: profileUser.role, ...form });
      }
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const renderField = (label: string, field: keyof typeof form) => (
    <div key={field}>
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">{label}</p>
      {editing ? (
        <input
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25"
          value={form[field] || ''}
          onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
        />
      ) : (
        <p className="text-sm font-semibold text-slate-300">{(worker as any)?.[field] || form[field] || '—'}</p>
      )}
    </div>
  );

  return (
    <div className={`${profileUser.name.toLowerCase() === 'linda daeli' && profileTab === 'work' ? 'w-full' : 'max-w-2xl'} mx-auto px-4 sm:px-6 py-8 pb-32`}>
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-white transition-colors mb-6"
      >
        ← Back
      </button>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-white/[0.03] border border-white/8 rounded-xl p-1 w-fit">
        {(['profile', 'work'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setProfileTab(tab); setEditing(false); }}
            className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={profileTab === tab
              ? { background: `${rc}20`, color: rc, border: `1px solid ${rc}30` }
              : { color: '#64748b' }}
          >
            {tab === 'profile' ? 'User Profile' : 'Work Information'}
          </button>
        ))}
      </div>

      {profileTab === 'work' && (() => {
        const docsPath = worker?.id
          ? `workers/${worker.id}/work_documents`
          : `users/${profileUser.id}/work_documents`;

        const docProps = { collPath: docsPath, currentUser, isDirector };

        if (profileUser.role === 'Accountant') {
          return (
            <div>
              <CustomSectionsPanel profileUser={profileUser} isDirector={isDirector} />
              <WorkInformationTab workerDocId={worker?.id || ''} profileUser={profileUser}>
                <WorkDocuments {...docProps} />
              </WorkInformationTab>
            </div>
          );
        }
        if (profileUser.role.includes('IT Admin')) {
          const wfCard = systemCards.find(c => c.link === 'workflow');
          const navigateToWorkflow = (v: AppView) => {
            try {
              localStorage.setItem('hub_return_to', JSON.stringify({ user: profileUser, tab: 'work' }));
            } catch {}
            onNavigate(v);
          };
          return (
            <div className="space-y-4">
              <CustomSectionsPanel profileUser={profileUser} isDirector={isDirector} />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Tools</p>
              {wfCard ? (
                <SystemCardTile card={wfCard} onNavigate={navigateToWorkflow} />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <button
                    onClick={() => navigateToWorkflow('workflow' as AppView)}
                    className="flex items-center gap-3 w-full text-left group"
                  >
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl bg-purple-500/10 border border-purple-500/20">⚙️</div>
                    <div>
                      <p className="font-bold text-white group-hover:text-purple-400 transition-colors">Workflow Automation</p>
                      <p className="text-xs text-slate-500">Open workflow automation tool</p>
                    </div>
                  </button>
                </div>
              )}
              <WorkDocuments {...docProps} />
            </div>
          );
        }
        return (
          <div>
            <CustomSectionsPanel profileUser={profileUser} isDirector={isDirector} />
            <WorkDocuments {...docProps} />
          </div>
        );
      })()}

      {profileTab === 'profile' && <div>

      {/* Header card */}
      <div
        className="rounded-3xl border border-white/10 overflow-hidden mb-4"
        style={{ background: `linear-gradient(135deg, ${rc}14 0%, #0f0a1a 70%)` }}
      >
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 p-6">
          {/* Photo */}
          <div
            className="w-24 h-24 rounded-2xl overflow-hidden shrink-0"
            style={{ border: `2.5px solid ${rc}70` }}
          >
            <img
              src={profileUser.photo || `https://picsum.photos/seed/${profileUser.id}/200/200`}
              alt={profileUser.name}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Name / meta */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <h2 className="text-2xl font-bold text-white mb-1">{profileUser.name}</h2>
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full inline-block mb-4"
              style={{ background: `${rc}20`, color: rc, border: `1px solid ${rc}30` }}
            >{profileUser.role}</span>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {(worker?.workerId || form.workerId) && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-0.5">Staff ID</p>
                  <p className="text-xs font-semibold text-slate-300">{worker?.workerId || form.workerId}</p>
                </div>
              )}
              {(worker?.phone || form.phone) && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-0.5">Phone</p>
                  <p className="text-xs font-semibold text-slate-300">{worker?.phone || form.phone}</p>
                </div>
              )}
              {(profileUser.email || worker?.email || form.email) && (
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-0.5">Email</p>
                  <p className="text-xs font-semibold text-slate-300 truncate">{profileUser.email || worker?.email || form.email}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Personal Information card */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Personal Information</p>
          {editing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setEditing(false); setForm({ workerId: worker?.workerId||'', email: worker?.email||profileUser.email||'', phone: worker?.phone||'', notes: worker?.notes||'', gender: worker?.gender||'', dob: worker?.dob||'', identityCode: worker?.identityCode||'', hometown: worker?.hometown||'', nationality: worker?.nationality||'', religion: worker?.religion||'', languages: worker?.languages||'', maritalStatus: worker?.maritalStatus||'', permanentAddress: worker?.permanentAddress||'', currentAddress: worker?.currentAddress||'' }); }}
                className="text-[10px] font-bold text-slate-500 hover:text-white transition-colors px-2.5 py-1 rounded-lg border border-white/10 hover:border-white/20"
              >Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                style={{ background: `${rc}20`, color: rc, border: `1px solid ${rc}30` }}
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-slate-500 hover:text-white"
              title="Edit personal information"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {/* Gender — dropdown */}
          <div key="gender">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">Gender</p>
            {editing ? (
              <select
                className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25"
                value={form.gender || ''}
                onChange={e => setForm(prev => ({ ...prev, gender: e.target.value }))}
              >
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            ) : (
              <p className="text-sm font-semibold text-slate-300">{form.gender || worker?.gender || '—'}</p>
            )}
          </div>

          {/* Date of Birth — date picker */}
          <div key="dob">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">Date of Birth</p>
            {editing ? (
              <input
                type="date"
                className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25"
                value={form.dob || ''}
                onChange={e => setForm(prev => ({ ...prev, dob: e.target.value }))}
              />
            ) : (
              <p className="text-sm font-semibold text-slate-300">{form.dob || worker?.dob || '—'}</p>
            )}
          </div>

          {renderField('Identity Code',  'identityCode')}
          {renderField('Hometown',       'hometown')}
          {renderField('Nationality',    'nationality')}
          <div key="maritalStatus">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">Marital Status</p>
            {editing ? (
              <select
                className="w-full bg-[#1a1a2e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25"
                value={form.maritalStatus || ''}
                onChange={e => setForm(prev => ({ ...prev, maritalStatus: e.target.value }))}
              >
                <option value="">Select…</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
                <option value="Separated">Separated</option>
              </select>
            ) : (
              <p className="text-sm font-semibold text-slate-300">{form.maritalStatus || worker?.maritalStatus || '—'}</p>
            )}
          </div>
          {(editing || worker?.phone) && renderField('Phone', 'phone')}
          {(editing || worker?.notes) && (
            <div className="col-span-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1">Notes</p>
              {editing ? (
                <textarea
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25 resize-none"
                  value={form.notes || ''}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              ) : (
                <p className="text-sm text-slate-400 leading-relaxed">{worker?.notes || '—'}</p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>}
    </div>
  );
}

// ── Per-member custom sections ──────────────────────────────────────────────────

type CustomSection =
  | { id: string; type: 'chart'; title: string; weekKey?: string }
  | { id: string; type: 'notes'; title: string; content: string };

function LaborChart({ profileUserId, section, onWeekChange }: {
  profileUserId: string;
  section: { id: string; type: 'chart'; title: string; weekKey?: string };
  onWeekChange: (weekKey: string) => void;
}) {
  const [hours, setHours] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const weeks = useMemo(() => {
    const base = new Date();
    const day = base.getDay();
    base.setDate(base.getDate() + (day === 0 ? -6 : 1 - day) - 14);
    base.setHours(0, 0, 0, 0);
    return getLaborWeeks(base, 8);
  }, []);
  const [selectedWeek, setSelectedWeek] = useState(section.weekKey || '');
  useEffect(() => {
    if (!selectedWeek && weeks.length) setSelectedWeek(weeks[weeks.length - 1].key);
  }, [weeks, selectedWeek]);
  useEffect(() => {
    getDoc(doc(db, 'users', profileUserId, 'work_data', 'labor_report'))
      .then(snap => { if (snap.exists()) setHours(snap.data().stationHours || {}); })
      .finally(() => setLoading(false));
  }, [profileUserId]);

  const handleWeekChange = (key: string) => { setSelectedWeek(key); onWeekChange(key); };

  const data = LABOR_STATIONS
    .map(st => ({ name: st.name.length > 14 ? st.name.slice(0, 14) + '…' : st.name, hours: parseFloat(hours[`${st.name}||${selectedWeek}`] || '0') || 0, highlight: st.highlight }))
    .filter(d => d.hours > 0);

  if (loading) return <div className="text-xs text-slate-600 p-4 text-center">Loading…</div>;

  return (
    <div className="space-y-3">
      <select value={selectedWeek} onChange={e => handleWeekChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none">
        {weeks.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
      </select>
      {data.length === 0
        ? <p className="text-xs text-slate-600 italic">No hours recorded for this week.</p>
        : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: '#64748b', fontSize: 9 }} />
              <Tooltip contentStyle={{ background: '#0d0816', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {data.map((entry, i) => <Cell key={i} fill={entry.highlight ? '#d4a0bc' : '#8b5cf6'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      }
    </div>
  );
}

function NotesSection({ section, isDirector, onSave }: {
  section: { id: string; type: 'notes'; title: string; content: string };
  isDirector: boolean;
  onSave: (content: string) => void;
}) {
  const [value, setValue] = useState(section.content || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const handleSave = async () => { setSaving(true); await onSave(value); setDirty(false); setSaving(false); };
  return (
    <div className="space-y-2">
      <textarea value={value}
        onChange={e => { setValue(e.target.value); setDirty(true); }}
        rows={4} readOnly={!isDirector}
        placeholder={isDirector ? 'Enter notes…' : 'No notes yet.'}
        className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder-slate-700 resize-none focus:outline-none focus:border-white/20 transition-colors"
      />
      {isDirector && dirty && (
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  );
}

function CustomSectionsPanel({ profileUser, isDirector }: { profileUser: User; isDirector: boolean }) {
  const sectionsRef = doc(db, 'users', profileUser.id, 'work_data', 'custom_sections');
  const [sections, setSections] = useState<CustomSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<'chart' | 'notes'>('chart');
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    getDoc(sectionsRef)
      .then(snap => { if (snap.exists()) setSections(snap.data().sections || []); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUser.id]);

  const persist = async (updated: CustomSection[]) => {
    await setDoc(sectionsRef, { sections: updated });
    setSections(updated);
  };

  const addSection = async () => {
    if (!newTitle.trim()) return;
    const s: CustomSection = newType === 'chart'
      ? { id: Date.now().toString(), type: 'chart', title: newTitle.trim() }
      : { id: Date.now().toString(), type: 'notes', title: newTitle.trim(), content: '' };
    await persist([...sections, s]);
    setNewTitle(''); setAdding(false);
  };

  const deleteSection = (id: string) => persist(sections.filter(s => s.id !== id));

  const updateSection = (id: string, patch: Partial<CustomSection>) =>
    persist(sections.map(s => s.id === id ? { ...s, ...patch } as CustomSection : s));

  if (loading) return null;
  if (!isDirector && sections.length === 0) return null;

  return (
    <div className="space-y-4 mb-4">
      {sections.map(section => (
        <div key={section.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{section.title}</p>
            {isDirector && (
              <button onClick={() => deleteSection(section.id)}
                className="p-1 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-colors">✕</button>
            )}
          </div>
          {section.type === 'chart' && (
            <LaborChart profileUserId={profileUser.id} section={section}
              onWeekChange={weekKey => updateSection(section.id, { weekKey })} />
          )}
          {section.type === 'notes' && (
            <NotesSection section={section} isDirector={isDirector}
              onSave={content => updateSection(section.id, { content })} />
          )}
        </div>
      ))}

      {isDirector && (
        adding ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">New Section</p>
            <div className="flex gap-2">
              {(['chart', 'notes'] as const).map(t => (
                <button key={t} onClick={() => setNewType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${newType === t
                    ? t === 'chart' ? 'bg-violet-500/20 border-violet-400/30 text-violet-300' : 'bg-cyan-500/20 border-cyan-400/30 text-cyan-300'
                    : 'border-white/10 text-slate-500'}`}>
                  {t === 'chart' ? 'Chart' : 'Notes'}
                </button>
              ))}
            </div>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Section title…" onKeyDown={e => e.key === 'Enter' && addSection()}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/25" />
            <div className="flex gap-2">
              <button onClick={addSection}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/30 transition-colors">
                Add
              </button>
              <button onClick={() => { setAdding(false); setNewTitle(''); }}
                className="px-4 py-1.5 text-xs font-bold rounded-lg border border-white/10 text-slate-500 hover:text-white hover:bg-white/10 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-white/15 text-xs font-bold text-slate-600 hover:text-slate-300 hover:border-white/25 transition-all w-full justify-center">
            + Add Section
          </button>
        )
      )}
    </div>
  );
}

// ── WorkInformationTab ─────────────────────────────────────────────────────────

function sliceRange(values: string[][], rowStart: number, rowEnd: number, colStart: number, colEnd: number): string[][] {
  if (rowStart < 0 || rowEnd < 0) return [];
  return values.slice(rowStart, rowEnd + 1).map(row =>
    Array.from({ length: colEnd - colStart + 1 }, (_, i) => row[colStart + i] ?? '')
  );
}

// Scan a specific column for a keyword (case-insensitive, trim), return row index or -1
function findRowByCol(values: string[][], col: number, keyword: string, startRow = 0): number {
  for (let r = startRow; r < values.length; r++) {
    if ((values[r]?.[col] ?? '').trim().toLowerCase() === keyword.toLowerCase()) return r;
  }
  return -1;
}

// Locate Budget Summary: col 14 = "Budget", col 15 = "Total" → 4 rows, cols 14-15
function locateBudgetSummary(values: string[][]): string[][] {
  const r = findRowByCol(values, 14, 'Budget');
  if (r < 0) return [];
  return sliceRange(values, r, r + 3, 14, 15);
}

// Locate Planned Budget: col 18 = "Aloha" → include 1 row above (spacer), extend until "Average" row, cols 17-22
function locatePlannedBudget(values: string[][]): { table: string[][], endRow: number } {
  const anchor = findRowByCol(values, 18, 'Aloha');
  if (anchor < 0) return { table: [], endRow: -1 };
  const startRow = Math.max(0, anchor - 1);
  let endRow = anchor;
  for (let r = anchor; r < Math.min(values.length, anchor + 20); r++) {
    endRow = r;
    if ((values[r]?.[17] ?? '').trim().toLowerCase() === 'average') break;
  }
  return { table: sliceRange(values, startRow, endRow, 17, 22), endRow };
}

// Locate Actual: search for the actual table after the planned section ends.
// Strategy: look for "Total" in cols 17-19, OR any row with a $ sign in cols 21-23,
// starting after the planned table. Falls back to searching the full sheet if needed.
function locateActual(values: string[][], afterRow: number): string[][] {
  const startSearch = afterRow > 0 ? afterRow + 1 : 0;

  // Try finding "Total" or "Actual" as an anchor in cols 17, 18, or 19
  let anchor = -1;
  const keywords = ['total', 'actual'];
  for (const kw of keywords) {
    for (const col of [17, 18, 16]) {
      const r = findRowByCol(values, col, kw, startSearch);
      if (r >= 0) { anchor = r; break; }
    }
    if (anchor >= 0) break;
  }

  // Fallback: find first row after planned that has a $ in cols 21-23
  if (anchor < 0) {
    for (let r = startSearch; r < Math.min(values.length, startSearch + 30); r++) {
      const hasDollar = values[r]?.slice(21, 24).some(c => (c ?? '').includes('$'));
      if (hasDollar) { anchor = r; break; }
    }
  }

  if (anchor < 0) return [];
  let endRow = anchor;
  for (let r = anchor; r < Math.min(values.length, anchor + 15); r++) {
    const rowHasData = values[r]?.slice(17, 24).some(c => c.trim() !== '');
    if (!rowHasData && r > anchor) break;
    endRow = r;
  }
  return sliceRange(values, anchor, endRow, 17, 23);
}

const SYNC_INTERVAL_MS = 30_000; // 30 seconds
const LABOR_API = import.meta.env.PROD
  ? 'https://us-central1-systems-hub.cloudfunctions.net/laborSheetApi'
  : '/api/labor-sheet';

// ── TrendSection ────────────────────────────────────────────────────────────

type WeekSummary = { tab: string; cpgBudget: number; cpgActual: number; budgetTotal: number; actualTotal: number; totalGuests: number };
type TrendPeriod = 'weekly' | 'monthly' | 'quarterly' | '6months' | 'yearly';

const MONTH_MAP: Record<string, number> = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

function parseWeekStart(tabName: string): Date | null {
  const m = tabName.match(/^([A-Za-z]+)\s+(\d+)/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const year = now.getFullYear();
  const thisYear = new Date(year, month, day);
  const lastYear = new Date(year - 1, month, day);
  // Prefer the most recent date that is not in the future
  if (thisYear.getTime() <= now.getTime()) return thisYear;
  if (lastYear.getTime() <= now.getTime()) return lastYear;
  return thisYear;
}

function aggregateCpg(weeks: WeekSummary[]) {
  const sumBudget = weeks.reduce((s, w) => s + w.budgetTotal, 0);
  const sumActual = weeks.reduce((s, w) => s + w.actualTotal, 0);
  const sumGuests = weeks.reduce((s, w) => s + w.totalGuests, 0);
  return {
    cpgBudget: sumGuests > 0 ? sumBudget / sumGuests : 0,
    cpgActual: sumGuests > 0 ? sumActual / sumGuests : 0,
  };
}

function groupByPeriod(summaries: WeekSummary[], period: TrendPeriod) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = summaries
    .map(w => ({ ...w, date: parseWeekStart(w.tab) }))
    .filter(w => w.date !== null && w.date.getTime() <= today.getTime() && (w.cpgBudget > 0 || w.cpgActual > 0))
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());

  if (period === 'weekly') {
    return parsed.map(w => ({
      label: w.tab,
      ...aggregateCpg([w]),
    }));
  }

  const groups = new Map<string, WeekSummary[]>();
  for (const w of parsed) {
    const d = w.date!;
    let key = '';
    if (period === 'monthly') {
      key = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    } else if (period === 'quarterly') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      key = `Q${q} '${String(d.getFullYear()).slice(2)}`;
    } else if (period === '6months') {
      const h = d.getMonth() < 6 ? 'H1' : 'H2';
      key = `${h} '${String(d.getFullYear()).slice(2)}`;
    } else if (period === 'yearly') {
      key = String(d.getFullYear());
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(w);
  }

  return Array.from(groups.entries()).map(([label, weeks]) => ({
    label,
    ...aggregateCpg(weeks),
  }));
}

function TrendSection() {
  const [summaries, setSummaries] = React.useState<WeekSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [period, setPeriod] = React.useState<TrendPeriod>('weekly');

  React.useEffect(() => {
    fetch(`${LABOR_API}/summary-all`)
      .then(r => r.json())
      .then((d: { summaries?: WeekSummary[] }) => {
        setSummaries(d.summaries ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const chartData = React.useMemo(() => groupByPeriod(summaries, period), [summaries, period]);

  const PERIODS: { key: TrendPeriod; label: string }[] = [
    { key: 'weekly',    label: 'Weekly' },
    { key: 'monthly',   label: 'Monthly' },
    { key: 'quarterly', label: 'Quarterly' },
    { key: '6months',   label: '6 Months' },
    { key: 'yearly',    label: 'Yearly' },
  ];

  const green  = '#22c55e';
  const accent = '#a855f7';

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between flex-wrap gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cost / Guest Trend</span>
        <div className="flex gap-1 flex-wrap">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all"
              style={period === p.key
                ? { background: `${accent}30`, color: accent, border: `1px solid ${accent}60` }
                : { background: 'transparent', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {loading && <div className="py-8 text-center text-slate-600 text-xs">Loading trend data…</div>}
        {!loading && chartData.length === 0 && (
          <div className="py-8 text-center text-slate-600 text-xs">No data available for this period</div>
        )}
        {!loading && chartData.length > 0 && (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `$${v.toFixed(2)}`}
                  width={44}
                />
                <Tooltip
                  contentStyle={{ background: '#0f0a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11 }}
                  formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name]}
                  cursor={{ stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: '#64748b', paddingTop: 8 }} />
                <Line
                  type="monotone"
                  dataKey="cpgBudget"
                  name="Budget CPG"
                  stroke={accent}
                  strokeWidth={2}
                  dot={{ fill: accent, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  strokeDasharray="5 3"
                />
                <Line
                  type="monotone"
                  dataKey="cpgActual"
                  name="Actual CPG"
                  stroke={green}
                  strokeWidth={2}
                  dot={{ fill: green, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 justify-center mt-1">
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block w-5 h-0.5" style={{ background: accent, borderTop: `2px dashed ${accent}` }} />
                Budget CPG
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className="inline-block w-5 h-0.5" style={{ background: green }} />
                Actual CPG
              </span>
            </div>

            {(() => {
              const zeroActual  = chartData.filter(d => d.cpgActual  === 0).map(d => d.label);
              const zeroBudget  = chartData.filter(d => d.cpgBudget  === 0).map(d => d.label);
              const allZero     = Array.from(new Set([...zeroActual, ...zeroBudget]));
              if (allZero.length === 0) return null;
              return (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 flex gap-2.5 items-start">
                  <span className="text-amber-400 text-sm leading-none mt-0.5">⚠</span>
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-amber-300">Zero values detected on graph</p>
                    <p className="text-[10px] text-amber-200/60 leading-relaxed">
                      {zeroActual.length > 0 && (
                        <span><span className="font-semibold text-amber-200/80">Actual CPG = $0.00</span> — {zeroActual.join(', ')}. </span>
                      )}
                      {zeroBudget.length > 0 && (
                        <span><span className="font-semibold text-amber-200/80">Budget CPG = $0.00</span> — {zeroBudget.join(', ')}. </span>
                      )}
                      These appear as sharp dips and may indicate missing or incomplete data for those periods.
                    </p>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

function LaborSheetView({ profileUser, children }: { profileUser: User; children?: React.ReactNode }) {
  const [tabs, setTabs]           = React.useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = React.useState<number>(-1);
  const [activeTab, setActiveTab] = React.useState<string>('');
  const [values, setValues]       = React.useState<string[][]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [syncing, setSyncing]     = React.useState(false);
  const [error, setError]         = React.useState('');
  const [lastSynced, setLastSynced] = React.useState<Date | null>(null);

  const sheetDocRef = doc(db, 'users', profileUser.id, 'work_data', 'labor_sheet');

  // Load tabs from API + restore last active tab from Firestore
  React.useEffect(() => {
    Promise.all([
      fetch(`${LABOR_API}/tabs`).then(r => r.json()),
      getDoc(sheetDocRef),
    ]).then(([tabData, snap]) => {
      const isDateTab = (name: string) => /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(name);
      const list: string[] = (tabData.tabs ?? []).filter(isDateTab);
      setTabs(list);
      const saved = snap.data()?.activeTab as string | undefined;
      const idx = saved ? list.findIndex(t => t === saved) : list.length - 1;
      const safeIdx = idx !== -1 ? idx : list.length - 1;
      if (list.length) {
        setCurrentIdx(safeIdx);
        setActiveTab(list[safeIdx]);
      } else {
        setLoading(false);
      }
    }).catch(e => { setError(String(e)); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDateTab = (name: string) => /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(name);

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= tabs.length) return;
    const name = tabs[idx];
    if (!isDateTab(name)) return;
    setCurrentIdx(idx);
    setActiveTab(name);
    setDoc(sheetDocRef, { activeTab: name }, { merge: true }).catch(() => {});
  };

  const canPrev = currentIdx > 0;
  const canNext = currentIdx < tabs.length - 1;

  const fetchData = React.useCallback((tab: string, isBackground = false) => {
    if (!tab || !/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(tab)) return;
    if (isBackground) setSyncing(true); else setLoading(true);
    setError('');
    fetch(`${LABOR_API}/data?tab=${encodeURIComponent(tab)}`)
      .then(r => r.json())
      .then((data: { values?: string[][]; error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setValues(data.values ?? []);
        setLastSynced(new Date());
      })
      .catch(e => setError(String(e)))
      .finally(() => { setLoading(false); setSyncing(false); });
  }, []);

  // Fetch on tab change
  React.useEffect(() => {
    if (!activeTab) return;
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  // Live sync: poll every 30s in the background
  React.useEffect(() => {
    if (!activeTab) return;
    const id = setInterval(() => fetchData(activeTab, true), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTab, fetchData]);

  const tableA = React.useMemo(() => locateBudgetSummary(values), [values]);
  const { table: tableB, endRow: plannedEndRow } = React.useMemo(() => locatePlannedBudget(values), [values]);
  const tableC = React.useMemo(() => locateActual(values, plannedEndRow), [values, plannedEndRow]);

  // ── Analysis computations ──────────────────────────────────────────────────
  const parseMoney = (s: string) => parseFloat(s.replace(/[$,]/g, '')) || 0;
  const parseNum   = (s: string) => parseFloat(s.replace(/,/g, ''))    || 0;

  // From O85:P88
  const budgetTotal  = parseMoney(tableA[1]?.[0] ?? '');
  const actualTotal  = parseMoney(tableA[1]?.[1] ?? '');
  const totalGuests  = parseNum(tableA[2]?.[0] ?? '');
  const cpgBudget    = parseMoney(tableA[3]?.[0] ?? '');
  const cpgActual    = parseMoney(tableA[3]?.[1] ?? '');
  const variance     = budgetTotal - actualTotal;
  const variancePct  = budgetTotal > 0 ? (variance / budgetTotal) * 100 : 0;
  const cpgVariance  = cpgBudget - cpgActual;

  // From R85:W94 (planned) — header row is index 1, data starts index 2
  const plannedHeaders = tableB[1] ?? [];                 // ['', 'Aloha', 'Ohana', 'Gateway', 'Total', 'Budget']
  const locations      = plannedHeaders.slice(1, 4);      // ['Aloha', 'Ohana', 'Gateway']
  const plannedRows    = tableB.slice(2).filter(r => r[0] && r[0] !== 'Total' && r[0] !== 'Average');
  const activeDays     = plannedRows.filter(r => parseNum(r[4]) > 0);

  // Location totals from planned Total row
  const plannedTotalRow = tableB.find(r => r[0] === 'Total') ?? [];
  const locTotals = locations.map((loc, i) => ({
    name: loc.trim(),
    guests: parseNum(plannedTotalRow[i + 1] ?? ''),
  }));
  const totalGuestsFromB = parseNum(plannedTotalRow[4] ?? '') || totalGuests;
  const busiestLoc = [...locTotals].sort((a, b) => b.guests - a.guests)[0];

  // From R97:X102 (actual) — compare to planned by day
  const actualHeaders  = tableC[0] ?? [];
  const actualDataRows = tableC.slice(1).filter(r => r[0] && r[0] !== 'Total' && r[0] !== 'Average');
  const actualTotalRow = tableC.find(r => r[0] === 'Total') ?? [];

  // Day-level variance (planned budget col vs actual budget col)
  type DayVar = { day: string; planned: number; actual: number; diff: number };
  const dayVariances: DayVar[] = [];
  plannedRows.forEach(pr => {
    const day = pr[0];
    const ar  = actualDataRows.find(r => r[0] === day);
    if (!ar) return;
    const pl = parseMoney(pr[5] ?? pr[pr.length - 1]);  // planned budget col
    const ac = parseMoney(ar[ar.length - 1]);            // actual budget col
    if (pl || ac) dayVariances.push({ day, planned: pl, actual: ac, diff: pl - ac });
  });

  const overBudgetDays  = dayVariances.filter(d => d.diff < 0);
  const underBudgetDays = dayVariances.filter(d => d.diff >= 0);

  const isUnderBudget = variance >= 0;
  const green  = '#22c55e';
  const red    = '#ef4444';
  const yellow = '#eab308';
  const accent = '#a855f7';

  const cellCls = 'border border-white/[0.08] px-3 py-2 text-xs text-slate-300';
  const headCls = 'border border-white/[0.08] px-3 py-2 text-xs font-bold text-slate-400 bg-white/[0.04]';

  const Metric = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-black" style={{ color: color ?? '#e2e8f0' }}>{value}</span>
      {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
    </div>
  );

  return (
    <div className="overflow-x-auto">
    <div style={{ width: 'fit-content', margin: '0 auto' }} className="space-y-5">
      {/* Week navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => goTo(currentIdx - 1)}
          disabled={!canPrev}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-white border border-white/10 hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >← Prev</button>

        <span className="flex-1 min-w-[180px] max-w-xs rounded-lg px-3 py-1.5 text-xs font-bold text-slate-300 text-center bg-white/[0.04] border border-white/10">
          {activeTab || '—'}
        </span>

        <button
          onClick={() => goTo(currentIdx + 1)}
          disabled={!canNext}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-white border border-white/10 hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >Next →</button>

        <div className="flex items-center gap-2 ml-auto">
          {syncing && (
            <span className="text-[10px] text-slate-500 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Syncing…
            </span>
          )}
          {!syncing && lastSynced && (
            <span className="text-[10px] text-slate-600">Updated {lastSynced.toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => fetchData(activeTab, true)}
            disabled={syncing || loading}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:text-white border border-white/10 hover:border-white/20 transition-all disabled:opacity-40"
          >Refresh</button>
        </div>
      </div>

      {loading && <div className="py-10 text-center text-slate-600 text-sm">Loading…</div>}
      {error   && <div className="py-6 text-center text-red-400 text-xs">{error}</div>}

      {!loading && !error && (
        <div className="flex gap-5 items-start">

          {/* ── LEFT column: fit-content so graph matches tables width exactly ── */}
          <div className="space-y-4" style={{ width: 'fit-content' }}>

            {/* Trend graph — stretches to match tables width below */}
            <div style={{ width: '100%' }}>
            <TrendSection />
            </div>

            {/* All three tables side by side — their combined width drives graph width */}
            <div className="flex gap-4 items-start">
              {/* Budget Summary */}
              <div className="rounded-2xl border border-white/10 overflow-hidden flex-shrink-0">
                <div className="px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Budget Summary</span>
                </div>
                <table className="border-collapse">
                  <tbody>
                    {tableA.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={ri === 0 ? headCls : cellCls}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Planned Budget */}
              <div className="rounded-2xl border border-white/10 overflow-hidden flex-shrink-0">
                <div className="px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Planned Budget</span>
                </div>
                <table className="border-collapse">
                  <tbody>
                    {tableB.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={ri === 0 ? headCls : cellCls}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Actual */}
              <div className="rounded-2xl border border-white/10 overflow-hidden flex-shrink-0">
                <div className="px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Actual</span>
                </div>
                <table className="border-collapse">
                  <tbody>
                    {tableC.length > 0
                      ? tableC.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} className={ri === 0 ? headCls : cellCls}>{cell}</td>
                            ))}
                          </tr>
                        ))
                      : <tr><td className={cellCls} colSpan={7}>No actual data yet</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── RIGHT column: Analysis ── */}
          <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)', width: '280px', flexShrink: 0 }}>
            <div className="px-5 py-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: accent }}>Labor Analysis</span>
              {syncing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
            </div>

            <div className="p-5 space-y-5">

              {/* Budget performance */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Budget Performance</p>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Planned" value={`$${budgetTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
                  <Metric label="Actual" value={`$${actualTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
                  <Metric
                    label="Variance"
                    value={`${isUnderBudget ? '-' : '+'}$${Math.abs(variance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                    sub={`${Math.abs(variancePct).toFixed(1)}% ${isUnderBudget ? 'under' : 'over'} budget`}
                    color={isUnderBudget ? green : red}
                  />
                  <Metric
                    label="Cost / Guest"
                    value={`$${cpgActual.toFixed(2)}`}
                    sub={`budget $${cpgBudget.toFixed(2)} · saved $${cpgVariance.toFixed(2)}/guest`}
                    color={cpgVariance >= 0 ? green : red}
                  />
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Guest volume */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Guest Volume</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Total guests</span>
                    <span className="font-bold text-slate-200">{totalGuestsFromB.toLocaleString()}</span>
                  </div>
                  {locTotals.map(loc => {
                    const pct = totalGuestsFromB > 0 ? (loc.guests / totalGuestsFromB) * 100 : 0;
                    return (
                      <div key={loc.name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-500">{loc.name}</span>
                          <span className="text-slate-400">{loc.guests.toLocaleString()} <span className="text-slate-600">({pct.toFixed(0)}%)</span></span>
                        </div>
                        <div className="w-full h-1 rounded-full bg-white/[0.06]">
                          <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Day breakdown */}
              {dayVariances.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Daily Labor Cost</p>
                  <div className="space-y-1.5">
                    {dayVariances.map(d => {
                      const diff = d.diff;
                      const isUnder = diff >= 0;
                      return (
                        <div key={d.day} className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 w-20">{d.day}</span>
                          <div className="flex-1 mx-3 h-1 rounded-full bg-white/[0.06]">
                            <div className="h-1 rounded-full" style={{
                              width: d.planned > 0 ? `${Math.min((d.actual / d.planned) * 100, 100)}%` : '0%',
                              background: isUnder ? green : red,
                            }} />
                          </div>
                          <span className="font-bold w-16 text-right" style={{ color: isUnder ? green : red }}>
                            {isUnder ? '-' : '+'}${Math.abs(diff).toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="border-t border-white/[0.06]" />

              {/* Insights */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Insights</p>
                <div className="space-y-2">
                  {/* Overall budget status */}
                  <div className="flex gap-2 text-xs">
                    <span style={{ color: isUnderBudget ? green : red }}>{isUnderBudget ? '↓' : '↑'}</span>
                    <span className="text-slate-400">
                      {isUnderBudget
                        ? `Labor came in ${variancePct.toFixed(1)}% under budget — good cost control.`
                        : `Labor exceeded budget by ${Math.abs(variancePct).toFixed(1)}% — review scheduling.`}
                    </span>
                  </div>
                  {/* Cost per guest */}
                  <div className="flex gap-2 text-xs">
                    <span style={{ color: cpgVariance >= 0 ? green : red }}>{cpgVariance >= 0 ? '↓' : '↑'}</span>
                    <span className="text-slate-400">
                      {cpgVariance >= 0
                        ? `Saved $${cpgVariance.toFixed(2)} per guest vs. planned — efficient staffing.`
                        : `Spent $${Math.abs(cpgVariance).toFixed(2)} more per guest than planned.`}
                    </span>
                  </div>
                  {/* Busiest location */}
                  {busiestLoc && totalGuestsFromB > 0 && (
                    <div className="flex gap-2 text-xs">
                      <span style={{ color: accent }}>→</span>
                      <span className="text-slate-400">
                        {busiestLoc.name} drove {((busiestLoc.guests / totalGuestsFromB) * 100).toFixed(0)}% of guest volume ({busiestLoc.guests.toLocaleString()} guests).
                      </span>
                    </div>
                  )}
                  {/* Active days */}
                  {activeDays.length > 0 && activeDays.length < 5 && (
                    <div className="flex gap-2 text-xs">
                      <span style={{ color: yellow }}>!</span>
                      <span className="text-slate-400">
                        {activeDays.length} of 5 days have guest data — remaining days may not be complete yet.
                      </span>
                    </div>
                  )}
                  {/* Over budget days */}
                  {overBudgetDays.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <span style={{ color: red }}>↑</span>
                      <span className="text-slate-400">
                        {overBudgetDays.map(d => d.day).join(', ')} ran over planned labor budget.
                      </span>
                    </div>
                  )}
                  {overBudgetDays.length === 0 && dayVariances.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <span style={{ color: green }}>✓</span>
                      <span className="text-slate-400">All days came in at or under planned labor cost.</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Chart: Planned vs Actual labor cost by day */}
              {dayVariances.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Planned vs Actual Labor Cost</p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={dayVariances.map(d => ({ day: d.day, Planned: d.planned, Actual: d.actual }))} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} width={40} />
                      <Tooltip
                        contentStyle={{ background: '#0f0a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11 }}
                        formatter={(v: number) => [`$${v.toFixed(2)}`, undefined]}
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      />
                      <Bar dataKey="Planned" fill="#a855f740" stroke="#a855f7" strokeWidth={1} radius={[3,3,0,0]} />
                      <Bar dataKey="Actual" radius={[3,3,0,0]}>
                        {dayVariances.map((d, i) => (
                          <Cell key={i} fill={d.diff >= 0 ? '#22c55e99' : '#ef444499'} stroke={d.diff >= 0 ? green : red} strokeWidth={1} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-1 justify-center">
                    <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#a855f740', border: '1px solid #a855f7' }} />Planned</span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#22c55e99', border: `1px solid ${green}` }} />Actual (under)</span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: '#ef444499', border: `1px solid ${red}` }} />Actual (over)</span>
                  </div>
                </div>
              )}

              {/* Chart: Guest volume by location */}
              {locTotals.some(l => l.guests > 0) && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Guest Volume by Location</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={locTotals.map(l => ({ name: l.name, Guests: l.guests }))} layout="vertical" barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip
                        contentStyle={{ background: '#0f0a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11 }}
                        formatter={(v: number) => [v.toLocaleString(), 'Guests']}
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      />
                      <Bar dataKey="Guests" radius={[0,3,3,0]}>
                        {locTotals.map((_, i) => (
                          <Cell key={i} fill={['#a855f7','#7c3aed','#6d28d9'][i] ?? '#a855f7'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>
          </div>

        </div>
      )}

      {children && <div>{children}</div>}
    </div>
    </div>
  );
}

function WorkInformationTab({ profileUser, children }: { workerDocId: string; profileUser: User; children?: React.ReactNode }) {
  const isLindaDaeli = profileUser.name.toLowerCase() === 'linda daeli';
  if (isLindaDaeli) return <LaborSheetView profileUser={profileUser}>{children}</LaborSheetView>;
  return null;
}

// ── DirectorySectionProps ───────────────────────────────────────────────────────

interface DirectorySectionProps {
  title: string; icon: string; accentColor: string;
  users: DirectoryEntry[]; currentUserId: string; defaultOpen?: boolean;
  onSelect: (u: DirectoryEntry) => void;
}
function DirectorySection({ title, icon, accentColor, users, currentUserId, defaultOpen = true, onSelect }: DirectorySectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!users.length) return null;
  return (
    <div className="rounded-xl sm:rounded-2xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="text-base">{icon}</span>
        <span className="text-xs sm:text-sm font-black uppercase tracking-widest" style={{ color: accentColor }}>{title}</span>
        <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${accentColor}20`, color: accentColor }}>{users.length}</span>
        <span className="ml-auto text-slate-600 text-xs transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
      </button>
      {open && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 border-t border-white/8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pt-4">
            {users.map(u => <EmployeeCard key={u.id} u={u} isMe={u.id === currentUserId} onClick={() => onSelect(u)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function DirectoryView({ users, workers: workerRecords, loading, roleColor, currentUserId, isAdmin }: DirectoryViewProps) {
  const [search, setSearch] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'sections' | 'all'>('sections');
  const [selected, setSelected] = React.useState<DirectoryEntry | null>(null);

  // Merge users and worker records into a unified list
  const allEntries: DirectoryEntry[] = [
    ...users,
    ...workerRecords.map(w => ({ ...w, photo: '', isWorkerRecord: true as const, phone: w.phone, notes: w.notes })),
  ];

  const q = search.toLowerCase();
  const matchesSearch = (u: DirectoryEntry) =>
    !q || u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || u.role.toLowerCase().includes(q);

  const leadership   = allEntries.filter(u => classifyRole(u.role) === 'leadership'    && matchesSearch(u));
  const teamLeaders  = allEntries.filter(u => classifyRole(u.role) === 'team-leaders'  && matchesSearch(u));
  const workers      = allEntries.filter(u => classifyRole(u.role) === 'workers'       && matchesSearch(u));
  const allFiltered  = allEntries.filter(matchesSearch);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: roleColor }} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">Directory</h2>
          <p className="text-xs sm:text-sm text-slate-400">All employees in the department · <span className="font-bold text-slate-300">{allEntries.length}</span> total</p>
        </div>
        {/* View toggle */}
        <div className="flex gap-1 p-1 rounded-xl border border-white/10 bg-white/[0.03]">
          {(['sections', 'all'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={activeTab === t
                ? { background: `${roleColor}22`, color: roleColor }
                : { color: '#64748b' }}>
              {t === 'sections' ? '≡ Sections' : '⊞ All'}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          type="text"
          placeholder="Search by name, role, or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1"
          style={{ '--tw-ring-color': roleColor } as React.CSSProperties}
        />
      </div>

      {allFiltered.length === 0 ? (
        <p className="text-center py-20 text-slate-600 italic text-sm">No employees found.</p>
      ) : activeTab === 'sections' ? (
        <div className="flex flex-col gap-4">
          <DirectorySection title="Leadership" icon="⭐" accentColor="#ff00ff"
            users={leadership} currentUserId={currentUserId} defaultOpen onSelect={setSelected} />
          <DirectorySection title="Team Leaders" icon="🎯" accentColor="#ffd700"
            users={teamLeaders} currentUserId={currentUserId} defaultOpen onSelect={setSelected} />
          <DirectorySection title="Workers" icon="👷" accentColor="#22c55e"
            users={workers} currentUserId={currentUserId} defaultOpen onSelect={setSelected} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
          {allFiltered.map(u => <EmployeeCard key={u.id} u={u} isMe={u.id === currentUserId} onClick={() => setSelected(u)} />)}
        </div>
      )}

      {/* ── Employee Detail Modal ── */}
      {selected && (
        <EmployeeDetailModal
          entry={selected}
          isMe={selected.id === currentUserId}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ── Employee Detail Modal ───────────────────────────────────────────────────────
interface EmployeeDetailModalProps {
  entry: DirectoryEntry;
  isMe: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: DirectoryEntry) => void;
}
function EmployeeDetailModal({ entry, isMe, isAdmin, onClose, onSaved }: EmployeeDetailModalProps) {
  const rc = getRoleColor(entry.role);
  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#a855f7] transition-all placeholder-slate-600';
  const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5';

  const [phone, setPhone] = React.useState(entry.phone ?? '');
  const [notes, setNotes] = React.useState(entry.notes ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError]   = React.useState('');

  // Signed policies for worker records
  const [signedPolicies, setSignedPolicies]     = React.useState<SignedPolicyRecord[]>([]);
  const [policiesLoading, setPoliciesLoading]   = React.useState(false);
  const [viewingPolicy, setViewingPolicy]       = React.useState<SignedPolicyRecord | null>(null);
  const [deletingId, setDeletingId]             = React.useState<string | null>(null);

  const deleteSignedPolicy = async (id: string) => {
    await deleteDoc(doc(db, 'workers', entry.id, 'signed_policies', id));
    setSignedPolicies(prev => prev.filter(sp => sp.id !== id));
    setDeletingId(null);
  };

  React.useEffect(() => {
    if (!entry.isWorkerRecord) return;
    setPoliciesLoading(true);
    getDocs(query(collection(db, 'workers', entry.id, 'signed_policies'), orderBy('signedAt', 'desc')))
      .then(snap => {
        setSignedPolicies(snap.docs.map(d => ({ id: d.id, ...d.data() } as SignedPolicyRecord)));
        setPoliciesLoading(false);
      })
      .catch(() => setPoliciesLoading(false));
  }, [entry.id, entry.isWorkerRecord]);

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await updateDoc(doc(db, 'workers', entry.id), {
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      });
      onSaved({ ...entry, phone: phone.trim() || undefined, notes: notes.trim() || undefined });
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-sm shadow-2xl"
        style={{ boxShadow: `0 0 60px ${rc}15` }}
        onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 text-slate-500 hover:text-white transition-colors z-10" style={{ position: 'absolute' }}>✕</button>

        {/* Header — avatar + name */}
        <div className="flex flex-col items-center pt-8 pb-5 px-6" style={{ background: `linear-gradient(180deg, ${rc}12 0%, transparent 100%)` }}>
          <div className="w-20 h-20 rounded-full overflow-hidden mb-3" style={{ border: `3px solid ${rc}70` }}>
            <img
              src={entry.photo || `https://picsum.photos/seed/${entry.id}/200/200`}
              alt={entry.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold text-white">{entry.name}</h3>
            {isMe && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: `${rc}25`, color: rc }}>You</span>}
            {entry.isWorkerRecord && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-500">No account</span>}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full" style={{ background: `${rc}20`, color: rc }}>{entry.role}</span>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-4">
          {/* Contact info — read-only for accounts */}
          {entry.email && (
            <div>
              <p className={labelCls}>Email</p>
              <a href={`mailto:${entry.email}`} className="text-sm text-slate-300 hover:text-white transition-colors">{entry.email}</a>
            </div>
          )}

          {entry.isWorkerRecord ? (
            <>
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" className={inputCls} placeholder="+1 (555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea rows={3} className={inputCls + ' resize-none'} placeholder="Schedule, skills, or other info…" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              {error && <p className="text-[11px] text-[#ff4d4d] font-semibold">{error}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2.5 rounded-xl text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.3)' }}>
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" /> : 'Save'}
              </button>

              {/* Signed Policies */}
              <div className="pt-2 border-t border-white/8">
                <p className={labelCls + ' mb-2'}>Signed Policies</p>
                {policiesLoading ? (
                  <div className="flex justify-center py-3">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
                  </div>
                ) : signedPolicies.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic text-center py-3">No signed policies yet.</p>
                ) : (
                  <div className="space-y-2">
                    {signedPolicies.map(sp => (
                      <div key={sp.id} className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
                        <button
                          onClick={() => setViewingPolicy(sp)}
                          className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 shrink-0">Signed</span>
                            <p className="text-xs font-semibold text-white truncate group-hover:text-purple-300 transition-colors">{sp.policyTitle}</p>
                          </div>
                          <p className="text-[9px] text-slate-600 mt-1 pl-0.5">
                            {new Date(sp.signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            {' · '}Signed by <span className="text-slate-400">{sp.signedBy}</span>
                            {sp.assistedBy && <> · Assisted by <span className="text-slate-400">{sp.assistedBy}</span></>}
                          </p>
                        </button>
                        {isAdmin && (
                          deletingId === sp.id ? (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border-t border-rose-500/20">
                              <span className="text-[10px] text-rose-400 font-bold flex-1">Delete this record?</span>
                              <button onClick={() => deleteSignedPolicy(sp.id)}
                                className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors">
                                Yes
                              </button>
                              <button onClick={() => setDeletingId(null)}
                                className="text-[10px] font-black px-2 py-0.5 rounded-md border border-white/10 text-slate-400 hover:bg-white/5 transition-colors">
                                No
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setDeletingId(sp.id)}
                              className="w-full text-left px-3 py-1 text-[10px] font-bold text-rose-500/50 hover:text-rose-400 hover:bg-rose-500/5 transition-colors border-t border-white/5">
                              🗑 Remove
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-600 italic text-center py-2">Account managed via Manage Systems.</p>
          )}
        </div>
      </div>

      {/* Signed policy viewer */}
      {viewingPolicy && (
        <SignedPolicyViewer record={viewingPolicy} onClose={() => setViewingPolicy(null)} />
      )}
    </div>
  );
}

// ── Live Guest Count ──────────────────────────────────────────────────────────

interface DailyGuestCounts {
  aloha?: number;
  ohana?: number;
  gateway?: number;
  savedAt?: string;
}

function LiveGuestCountView({ roleColor }: { roleColor: string }) {
  const [counts, setCounts] = useState<{ ohana: number | null; aloha: number | null; gateway: number | null; savedAt?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'food_prep_state', 'latest'), snap => {
      const d = snap.data();
      setCounts(d ? { aloha: d.aloha, ohana: d.ohana, gateway: d.gateway, savedAt: d.savedAt } : null);
      setLoading(false);
    });
    return unsub;
  }, []);

  const venues = [
    { key: 'aloha',   label: 'Aloha Luau',      color: '#f59e0b' },
    { key: 'ohana',   label: 'Hale Ohana Luau', color: '#10b981' },
    { key: 'gateway', label: 'Gateway Buffet',  color: '#6366f1' },
  ] as const;

  const total = (counts?.aloha ?? 0) + (counts?.ohana ?? 0) + (counts?.gateway ?? 0);
  const updatedAt = counts?.savedAt ? new Date(counts.savedAt).toLocaleTimeString() : null;
  const [copied, setCopied] = useState(false);
  const publicUrl = `${window.location.origin}/guest-count`;
  const handlePublish = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: roleColor }}>Real-time</p>
          <h2 className="text-2xl font-bold text-white">Live Guest Count</h2>
          <p className="text-xs text-slate-500 mt-1">
            {loading ? 'Loading…' : updatedAt ? `Last updated at ${updatedAt}` : 'No data yet'}
          </p>
          <p className="text-xs text-slate-600 mt-0.5">⏰ Active 6:30 AM – 7:30 PM (Hawaii time)</p>
        </div>
        <button
          onClick={handlePublish}
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all"
          style={{ background: copied ? 'rgba(34,197,94,.15)' : 'rgba(167,139,250,.12)', border: `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'rgba(167,139,250,.3)'}`, color: copied ? '#22c55e' : '#a78bfa' }}>
          {copied ? '✓ Link copied!' : '🌐 Publish to Web'}
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : !counts ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-white font-semibold">No guest counts available</p>
          <p className="text-slate-500 text-sm mt-1">Counts appear here automatically once the Food Prep PDF is processed by the watcher.</p>
          <p className="text-slate-600 text-xs mt-2">⏰ Active hours: 6:30 AM – 7:30 PM (Hawaii time)</p>
        </div>
      ) : (
        <>
          {/* Total */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 mb-6 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Total Guests Today</p>
            <p className="text-6xl font-black text-white">{total.toLocaleString()}</p>
          </div>

          {/* Per-venue cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {venues.map(v => {
              const val = counts[v.key];
              return (
                <div key={v.key} className="rounded-2xl border bg-white/[0.02] p-6"
                  style={{ borderColor: `${v.color}33` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full" style={{ background: v.color }} />
                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: v.color }}>{v.label}</p>
                  </div>
                  <p className="text-4xl font-black text-white">
                    {val != null ? val.toLocaleString() : '—'}
                  </p>
                  {total > 0 && val != null && (
                    <p className="text-xs text-slate-500 mt-2">
                      {((val / total) * 100).toFixed(1)}% of total
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Food Prep Report ──────────────────────────────────────────────────────────

interface FoodPrepReport {
  url: string;
  updatedAt: string;
  size?: number;
}

function FoodPrepView({ roleColor }: { roleColor: string }) {
  const [report, setReport] = useState<FoodPrepReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'food_prep_reports', 'latest'), snap => {
      if (snap.exists()) {
        setReport(snap.data() as FoodPrepReport);
      } else {
        setReport(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const formattedDate = report?.updatedAt
    ? new Date(report.updatedAt).toLocaleString()
    : null;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto h-full flex flex-col">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: roleColor }}>Live Report</p>
          <h2 className="text-2xl font-bold text-white">Food Prep</h2>
          {formattedDate && (
            <p className="text-xs text-slate-500 mt-1">Last updated: {formattedDate}</p>
          )}
        </div>
        {report && (
          <a
            href={report.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold px-4 py-2 rounded-xl border transition-colors"
            style={{ color: roleColor, borderColor: `${roleColor}40` }}
          >
            Open in new tab
          </a>
        )}
      </div>

      <div className="flex-1 rounded-2xl border border-white/10 overflow-hidden bg-white" style={{ minHeight: '70vh' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm bg-[#0d0816]">
            Loading report...
          </div>
        ) : !report ? (
          <div className="h-full flex flex-col items-center justify-center bg-[#0d0816] gap-4 text-center px-8">
            <p className="text-4xl">🍽️</p>
            <p className="text-white font-semibold">No report available yet</p>
            <p className="text-slate-500 text-sm max-w-sm">
              Set up Power Automate to send the Food Prep PDF to this page. It will appear here automatically every time it's updated.
            </p>
          </div>
        ) : (
          <iframe
            src={report.url}
            className="w-full h-full border-0"
            title="Food Prep Report"
            style={{ minHeight: '70vh' }}
          />
        )}
      </div>
    </div>
  );
}

// ── Rules & Policies ──────────────────────────────────────────────────────────

const CULINARY_RULES_CONTENT = `Below are the Rules for our Culinary Department. If you do not follow these rules you will be given a disciplinary action in the form of a PA or Personnel Action. First PA is verbal Council, Second PA is written warning, Third PA will be a 3 Day Suspension, Fourth PA will be Termination.

─────────────────────────────────────────
BREAKS / TIME OFF AND SCHEDULES
─────────────────────────────────────────

• If you are missing from your workstation excessively to go to the restroom, and if this negatively affects your performance or you are abusing your restroom breaks, you will receive a PA.

• All part-time employees and students do not have a break during regular schedules unless their shift is over 5 hours. (Summer schedules are the exception.)

• Students may grab lunch, breakfast, or dinner before or after their shifts but NOT during their scheduled shift. (One plate.)

• For students, all days off and schedule adjustments must be approved by the Chef Managers (Sous Chef and Pastry Chef). This must be TWO WEEKS IN ADVANCE for everything except sick days.

• Students must clock out at their scheduled times unless an extension or adjustment has been approved by their leads.

• All iWork students must stay within their 19-hour limit.

• If you are sick, call in before your shift is supposed to start and inform the Chef Managers and your lead. Then get a doctor's note as soon as possible and turn it in to HR and show a copy to the Chef Managers.

• You are expected to be reliable with your timing. If you have an absence that has not been approved or covered with a doctor's note, you will be written up (PA). If this happens twice in a month, you will be terminated.

• Come to work on time and inform your leads if you are going to be more than 5 minutes late. If you are more than 30 minutes late, you will be asked to stay home, and you may not make up the missed hours.

• You must clock in at the kiosk or on the UKG app between Gate 10A and the main kitchen. (Forgetting to clock in twice will result in a PA.)

• All time sheets should be submitted on Saturday night during submission week.

• For new employees, get an SSN within one week after hiring.

─────────────────────────────────────────
UNIFORM
─────────────────────────────────────────

• Be in full uniform and ready to work before you clock in. This includes your white coat, black pants, apron, hat, knife (if given one), and closed-toed shoes.

• All girls must wear a hair net with all hair covered, and may wear a hat as well.

• If you work in Hot Foods or Pantry, a knife will be assigned to you by the Chef Managers. If you lose your knife, you are responsible for buying a new one. Cut-resistant gloves are to be worn at all times.

• If you do not have your knife at work, you will be given a PA as this is considered part of your uniform.

─────────────────────────────────────────
ELECTRONICS
─────────────────────────────────────────

• Headphones of any kind are not allowed in the kitchen at any time.

• Phones are only to be used by the leads for work-related information (e.g., texts and calls from the venues or Chef Managers).

• When using the iPad, make sure to wipe down the screen with an alcohol wipe.

• The speaker should not be louder than your voice. Make sure others can hear you when you talk to them.

─────────────────────────────────────────
SANITATION / CLEANLINESS
─────────────────────────────────────────

• Wash your hands before you start work and every 30 minutes.

• Gloves must be changed after eating, touching your hair or face, touching phones or the iPad, going to the office, the bathroom, outside, or the chill.

• No food is to be eaten in the kitchen area. Spoons are available to taste as you go, but you cannot eat your lunch in the kitchen work area.

• Red sanitation buckets are required in each area. Use them in between each task you complete.

• Keep rags off the floor, and when dirty, place them in the dirty bin to go to laundry.

• All plastic gloves should be thrown away when leaving the kitchen. You may get a new pair when you come back from your break or the bathroom.

• Do not bring your fabric apron into the bathroom with you.

─────────────────────────────────────────
CHILL
─────────────────────────────────────────

• All boxes must be thrown away, and products should be taken out once the box is opened.

• All items you place in the chill should be labeled with a name and date. (If there are no labels or markers, please ask the Chef Managers.)

• Put all ingredients back in the same space you got them from, and use open ingredients first.

• Anything that is in an open bag should be transferred to a clear Cambro container and labeled — i.e. shredded carrots, bean sprouts, mozzarella cheese, salted salmon, etc.

• Carts should not be left in the chill.

• Keep all meats separate from all other foods in the chill.

• If you spill or drop something, clean it up right away.

─────────────────────────────────────────
KNIVES AND EQUIPMENT
─────────────────────────────────────────

• Do not leave knives in the sink after use. Clean them right away and put them in their place.

• When walking with a knife, hold it to your side to avoid any accidents.

• Do not let anyone else use your knife.

• If equipment is broken, please inform your leads and Chef Managers.

─────────────────────────────────────────
RECIPES
─────────────────────────────────────────

• All recipes must be followed exactly. You may not change the recipe, but feel free to discuss ideas with the Chef Managers and your leads.

─────────────────────────────────────────
OPEN DOOR
─────────────────────────────────────────

• We have an open-door policy, so if you need anything, you can go in and talk with them anytime.

• If the Chef Managers are not there, you may find the leads or other Chef Managers to help you.`;

interface Policy {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface SignedPolicyRecord {
  id: string;
  policyId: string;
  policyTitle: string;
  policyContent: string;
  signatureDataUrl: string;
  signedAt: string;
  signedBy: string;      // worker's name — who physically signed
  assistedBy: string;    // admin account name — who facilitated
  workerName: string;
}

interface RulesAndPoliciesViewProps {
  isAdmin: boolean;
  currentUserName: string;
  roleColor: string;
}

function RulesAndPoliciesView({ isAdmin, currentUserName, roleColor }: RulesAndPoliciesViewProps) {
  const [policies, setPolicies] = React.useState<Policy[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [selected, setSelected] = React.useState<Policy | null>(null);
  const [editing, setEditing]   = React.useState(false);
  const [editTitle, setEditTitle]     = React.useState('');
  const [editContent, setEditContent] = React.useState('');
  const [saving, setSaving]           = React.useState(false);
  const [saveErr, setSaveErr]         = React.useState('');
  const [showSign, setShowSign]       = React.useState(false);
  const [pendingSig, setPendingSig]   = React.useState<string | null>(null);
  const [showAssign, setShowAssign]   = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [fullscreen, setFullscreen]   = React.useState(false);
  const textareaRef    = React.useRef<HTMLTextAreaElement>(null);
  const pendingRestore = React.useRef<{ start: number; end: number; scrollTop: number } | null>(null);

  // Synchronously restore cursor position + scroll after any editContent change caused by a format button
  React.useLayoutEffect(() => {
    const r = pendingRestore.current;
    if (!r || !textareaRef.current) return;
    textareaRef.current.setSelectionRange(r.start, r.end);
    textareaRef.current.scrollTop = r.scrollTop;
    pendingRestore.current = null;
  }, [editContent]);

  // ── Line-prefix toggle (center / heading) ──────────────────────────────────
  const toggleLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, scrollTop } = ta;
    const lines = editContent.split('\n');
    let pos = 0;
    let startShift = 0;
    let endShift   = 0;

    const newLines = lines.map(line => {
      const lineStart = pos;
      pos += line.length + 1;           // +1 for the \n
      const lineEnd = pos - 1;
      if (lineEnd >= start && lineStart <= end) {
        if (line.startsWith(prefix)) {
          const n = prefix.length;
          if (lineStart < start) startShift -= n;
          endShift -= n;
          return line.slice(n);
        } else {
          const n = prefix.length;
          if (lineStart < start) startShift += n;
          endShift += n;
          return prefix + line;
        }
      }
      return line;
    });

    pendingRestore.current = {
      start: Math.max(0, start + startShift),
      end:   Math.max(0, end   + endShift),
      scrollTop,
    };
    setEditContent(newLines.join('\n'));
  };

  const toggleCenter   = () => toggleLinePrefix('>> ');
  const toggleHeading1 = () => toggleLinePrefix('# ');
  const toggleHeading2 = () => toggleLinePrefix('## ');

  // ── Inline bold toggle ─────────────────────────────────────────────────────
  const toggleBold = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, scrollTop } = ta;
    const selected = editContent.slice(start, end);
    let newContent: string;
    let newStart: number;
    let newEnd: number;

    if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
      const inner = selected.slice(2, -2);
      newContent = editContent.slice(0, start) + inner + editContent.slice(end);
      newStart = start; newEnd = start + inner.length;
    } else {
      newContent = editContent.slice(0, start) + '**' + selected + '**' + editContent.slice(end);
      newStart = start + 2; newEnd = end + 2;
    }
    pendingRestore.current = { start: newStart, end: newEnd, scrollTop };
    setEditContent(newContent);
  };

  React.useEffect(() => {
    setLoading(true);
    getDocs(query(collection(db, 'policies'), orderBy('updatedAt', 'desc')))
      .then(async snap => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Policy));
          setPolicies(list);
          setSelected(list[0]);
          setLoading(false);
          return;
        }
        // Auto-seed the Culinary Rules & Policies document on first load
        const now = new Date().toISOString();
        const ref = await addDoc(collection(db, 'policies'), {
          title: 'Culinary Team Rules and Policies',
          content: CULINARY_RULES_CONTENT,
          createdAt: now,
          updatedAt: now,
        });
        const seeded: Policy = {
          id: ref.id,
          title: 'Culinary Team Rules and Policies',
          content: CULINARY_RULES_CONTENT,
          createdAt: now,
          updatedAt: now,
        };
        setPolicies([seeded]);
        setSelected(seeded);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setSelected(null); setEditTitle('New Policy'); setEditContent('');
    setSaveErr(''); setEditing(true);
  };

  const startEdit = (p: Policy) => {
    setSelected(p); setEditTitle(p.title); setEditContent(p.content);
    setSaveErr(''); setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const savePolicy = async () => {
    if (!editTitle.trim()) { setSaveErr('Title is required.'); return; }
    setSaving(true); setSaveErr('');
    const now = new Date().toISOString();
    try {
      if (selected) {
        await updateDoc(doc(db, 'policies', selected.id), {
          title: editTitle.trim(), content: editContent, updatedAt: now,
        });
        const updated: Policy = { ...selected, title: editTitle.trim(), content: editContent, updatedAt: now };
        setPolicies(prev => prev.map(p => p.id === selected.id ? updated : p));
        setSelected(updated);
      } else {
        const ref = await addDoc(collection(db, 'policies'), {
          title: editTitle.trim(), content: editContent, createdAt: now, updatedAt: now,
        });
        const newP: Policy = { id: ref.id, title: editTitle.trim(), content: editContent, createdAt: now, updatedAt: now };
        setPolicies(prev => [newP, ...prev]);
        setSelected(newP);
      }
      setEditing(false);
    } catch {
      setSaveErr('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const deletePolicy = async () => {
    if (!selected) return;
    await deleteDoc(doc(db, 'policies', selected.id));
    const remaining = policies.filter(p => p.id !== selected.id);
    setPolicies(remaining);
    setSelected(remaining[0] ?? null);
    setConfirmDelete(false);
  };

  const handleSigned = (sigDataUrl: string) => {
    setPendingSig(sigDataUrl);
    setShowSign(false);
    setShowAssign(true);
  };

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all placeholder-slate-600';

  return (
    <div className="flex h-full" style={{ minHeight: 'calc(100vh - 4rem)' }}>

      {/* ── Policy list sidebar ── */}
      <div
        className="shrink-0 border-r border-white/8 flex flex-col transition-all duration-300"
        style={{ width: sidebarOpen ? 240 : 48, background: 'rgba(6,3,11,0.98)', overflow: 'hidden' }}
      >
        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-white/8 shrink-0">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-all shrink-0"
            title={sidebarOpen ? 'Collapse' : 'Expand'}
          >
            {sidebarOpen ? '◂' : '▸'}
          </button>
          {sidebarOpen && (
            <div className="flex items-center justify-between flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 truncate">Policies</p>
              {isAdmin && (
                <button
                  onClick={startNew}
                  className="text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors shrink-0 ml-2"
                >+ New</button>
              )}
            </div>
          )}
        </div>

        {/* Policy list */}
        {sidebarOpen && (
          loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/20 border-t-purple-400 rounded-full animate-spin" />
            </div>
          ) : policies.length === 0 ? (
            <p className="text-xs text-slate-600 italic px-4 text-center mt-10">No policies yet.{isAdmin && <><br/>Click + New to create one.</>}</p>
          ) : (
            <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
              {policies.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setEditing(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all"
                  style={selected?.id === p.id
                    ? { background: `${roleColor}18`, borderLeft: `3px solid ${roleColor}` }
                    : { color: '#94a3b8' }}
                >
                  <p className="truncate text-xs font-semibold" style={selected?.id === p.id ? { color: roleColor } : {}}>
                    {p.title}
                  </p>
                  <p className="text-[9px] text-slate-600 mt-0.5">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Empty state */}
        {!selected && !editing && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
            <span className="text-6xl opacity-30">📜</span>
            <p className="text-sm font-semibold text-slate-500">Select a policy to view</p>
            {isAdmin && (
              <button onClick={startNew}
                className="mt-2 px-5 py-2 text-sm font-bold rounded-xl text-white hover:opacity-90 transition-all"
                style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.25)' }}>
                + Create First Policy
              </button>
            )}
          </div>
        )}

        {/* Editor — white paper theme */}
        {editing && (
          <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#d1d5db' }}>
            {/* Editor toolbar bar */}
            <div className="px-6 py-3 flex items-center justify-between gap-4 shrink-0"
              style={{ background: '#1e1b2e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 mr-0.5">Format:</span>
                {/* Bold */}
                <button type="button" onClick={toggleBold} title="Bold (wrap selection with **)"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
                  B
                </button>
                {/* Heading 1 — large */}
                <button type="button" onClick={toggleHeading1} title="Heading (large text)"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
                  H1
                </button>
                {/* Heading 2 — medium */}
                <button type="button" onClick={toggleHeading2} title="Subheading (medium text)"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
                  H2
                </button>
                {/* Center */}
                <button type="button" onClick={toggleCenter} title="Center selected lines"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors">
                  ⊞
                </button>
                <span className="text-[9px] text-slate-700 italic hidden sm:inline ml-1">Select text then click a format button</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={cancelEdit}
                  className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg border border-white/15 text-slate-400 hover:bg-white/5 transition-colors">
                  Cancel
                </button>
                <button onClick={savePolicy} disabled={saving || !editTitle.trim()}
                  className="px-4 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg text-white hover:opacity-90 disabled:opacity-40 transition-all"
                  style={{ backgroundColor: '#a855f7' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* White paper editor */}
            <div className="flex-1 overflow-y-auto py-8 px-4 sm:px-8">
              <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-2xl px-8 sm:px-14 py-10 min-h-[calc(100vh-12rem)] flex flex-col gap-3">
                {saveErr && <p className="text-[11px] text-red-500 font-semibold">{saveErr}</p>}
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="Policy title…"
                  className="w-full text-2xl font-bold text-gray-900 border-b-2 border-gray-200 pb-2 focus:outline-none focus:border-purple-400 placeholder-gray-300 bg-transparent"
                />
                <textarea
                  ref={textareaRef}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  placeholder="Enter the full policy text here…"
                  className="flex-1 w-full text-sm text-gray-800 leading-relaxed focus:outline-none resize-none bg-transparent placeholder-gray-300 min-h-[60vh]"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Policy view */}
        {!editing && selected && (
          <div className={fullscreen
            ? 'fixed inset-0 z-[55] flex flex-col'
            : 'flex-1 flex flex-col overflow-hidden'
          }>
            {/* Policy header */}
            <div className="px-6 sm:px-10 py-4 border-b border-white/8 flex flex-wrap items-center justify-between gap-3 shrink-0"
              style={{ background: '#0a0510' }}>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-0.5">Policy Document</p>
                <h2 className="text-lg sm:text-xl font-bold text-white leading-snug">{selected.title}</h2>
                <p className="text-[9px] text-slate-600 mt-0.5">
                  Last updated: {new Date(selected.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isAdmin && (
                  <>
                    <button onClick={() => { setFullscreen(false); startEdit(selected); }}
                      className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg border border-white/15 text-slate-400 hover:bg-white/5 transition-colors">
                      ✎ Edit
                    </button>
                    {confirmDelete ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-rose-400 font-bold">Delete?</span>
                        <button onClick={deletePolicy}
                          className="px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30 transition-colors">
                          Yes
                        </button>
                        <button onClick={() => setConfirmDelete(false)}
                          className="px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg border border-white/15 text-slate-400 hover:bg-white/5 transition-colors">
                          No
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(true)}
                        className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors">
                        🗑
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => setShowSign(true)}
                  className="px-4 py-1.5 text-[11px] font-black uppercase tracking-wide rounded-lg text-white hover:opacity-90 transition-all"
                  style={{ backgroundColor: '#22c55e', boxShadow: '0 0 14px rgba(34,197,94,0.3)' }}>
                  ✍ Sign
                </button>
                <button
                  onClick={() => setFullscreen(v => !v)}
                  title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/15 text-slate-400 hover:bg-white/5 hover:text-white transition-colors text-base"
                >
                  {fullscreen ? '⤓' : '⤢'}
                </button>
              </div>
            </div>

            {/* Policy content — white paper */}
            <div className="flex-1 overflow-y-auto py-8 px-4 sm:px-8" style={{ background: '#d1d5db' }}>
              <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-2xl px-8 sm:px-14 py-12 min-h-[calc(100vh-16rem)]">
                {selected.content ? (
                  selected.content.split('\n').map((line, i) => {
                    // Strip format prefixes in order
                    let centered = false;
                    let rest = line;
                    if (rest.startsWith('>> ')) { centered = true; rest = rest.slice(3); }
                    const align: React.CSSProperties['textAlign'] = centered ? 'center' : 'left';

                    let size: 'h1' | 'h2' | 'body' = 'body';
                    if (rest.startsWith('# '))       { size = 'h1'; rest = rest.slice(2); }
                    else if (rest.startsWith('## ')) { size = 'h2'; rest = rest.slice(3); }

                    if (!rest.trim()) return <div key={i} className="h-3" />;

                    // Parse inline bold (**text**)
                    const parts = rest.split(/(\*\*[^*]*\*\*)/g);
                    const nodes = parts.map((part, j) =>
                      part.startsWith('**') && part.endsWith('**') && part.length > 4
                        ? <strong key={j}>{part.slice(2, -2)}</strong>
                        : part
                    );

                    if (size === 'h1') return <h2 key={i} className="text-xl font-bold text-gray-900 mt-5 mb-1" style={{ textAlign: align }}>{nodes}</h2>;
                    if (size === 'h2') return <h3 key={i} className="text-base font-semibold text-gray-700 mt-3 mb-0.5" style={{ textAlign: align }}>{nodes}</h3>;
                    return <p key={i} className="text-sm text-gray-800 leading-relaxed" style={{ textAlign: align, marginBottom: '2px' }}>{nodes}</p>;
                  })
                ) : (
                  <p className="text-gray-400 italic text-sm text-center py-10">
                    This policy has no content yet.{isAdmin && ' Click Edit to add content.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Signature modal */}
      {showSign && selected && (
        <SignatureModal
          policyTitle={selected.title}
          onClose={() => setShowSign(false)}
          onSigned={handleSigned}
        />
      )}

      {/* Assign worker modal */}
      {showAssign && selected && pendingSig && (
        <AssignWorkerModal
          policy={selected}
          signatureDataUrl={pendingSig}
          assistedBy={currentUserName}
          onClose={() => { setShowAssign(false); setPendingSig(null); }}
          onAssigned={() => { setShowAssign(false); setPendingSig(null); }}
        />
      )}
    </div>
  );
}

// ── Signature Modal ────────────────────────────────────────────────────────────

interface SignatureModalProps {
  policyTitle: string;
  onClose: () => void;
  onSigned: (dataUrl: string) => void;
}
function SignatureModal({ policyTitle, onClose, onSigned }: SignatureModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing   = React.useRef(false);
  const lastPos   = React.useRef<{ x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = React.useState(true);

  const getCtx = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    return ctx;
  };

  const posFromEvent = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = true;
    setIsEmpty(false);
    const pos = posFromEvent(e);
    lastPos.current = pos;
    const ctx = getCtx();
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!drawing.current || !lastPos.current) return;
    const ctx = getCtx(); if (!ctx) return;
    const pos = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  };

  const endDraw = () => { drawing.current = false; lastPos.current = null; };

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setIsEmpty(true);
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-md shadow-2xl"
        style={{ boxShadow: '0 0 60px rgba(34,197,94,0.12)' }}
        onClick={e => e.stopPropagation()}>

        <div className="px-6 pt-6 pb-4 border-b border-white/8 relative">
          <button onClick={onClose} className="absolute top-4 right-5 text-slate-500 hover:text-white transition-colors text-xl leading-none">✕</button>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Sign Document</p>
          <h3 className="text-base font-bold text-white pr-8">{policyTitle}</h3>
        </div>

        <div className="p-6">
          <p className="text-xs text-slate-500 mb-3">Draw your signature in the box below:</p>
          <div className="rounded-2xl border border-white/15 overflow-hidden bg-white/[0.02]" style={{ touchAction: 'none' }}>
            <canvas
              ref={canvasRef}
              width={440}
              height={190}
              className="w-full block"
              style={{ cursor: 'crosshair', touchAction: 'none' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-2 text-center italic">Sign with your mouse or finger</p>

          <div className="flex gap-3 mt-5">
            <button onClick={clearCanvas}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl border border-white/15 text-slate-400 hover:bg-white/5 transition-colors">
              Clear
            </button>
            <button
              onClick={() => { if (canvasRef.current) onSigned(canvasRef.current.toDataURL('image/png')); }}
              disabled={isEmpty}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl text-white hover:opacity-90 disabled:opacity-40 transition-all"
              style={{ backgroundColor: '#22c55e', boxShadow: '0 0 18px rgba(34,197,94,0.25)' }}>
              Confirm Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Assign Worker Modal ────────────────────────────────────────────────────────

interface AssignWorkerModalProps {
  policy: Policy;
  signatureDataUrl: string;
  assistedBy: string;   // admin account name facilitating the signing
  onClose: () => void;
  onAssigned: () => void;
}
function AssignWorkerModal({ policy, signatureDataUrl, assistedBy, onClose, onAssigned }: AssignWorkerModalProps) {
  type WorkerOption = { id: string; workerId: string; name: string; role: string };
  const [workers,   setWorkers]   = React.useState<WorkerOption[]>([]);
  const [wLoading,  setWLoading]  = React.useState(true);
  const [search,    setSearch]    = React.useState('');
  const [picked,    setPicked]    = React.useState<WorkerOption | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  const [done,      setDone]      = React.useState(false);

  React.useEffect(() => {
    getDocs(collection(db, 'workers'))
      .then(snap => {
        const ws = snap.docs.map(d => ({ id: d.id, workerId: '', ...d.data() } as WorkerOption));
        ws.sort((a, b) => a.name.localeCompare(b.name));
        setWorkers(ws);
        setWLoading(false);
      })
      .catch(() => setWLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = workers.filter(w =>
    w.name.toLowerCase().includes(q) ||
    w.role.toLowerCase().includes(q) ||
    (w.workerId && w.workerId.toLowerCase().includes(q))
  );

  const handleAssign = async () => {
    if (!picked) return;
    setAssigning(true);
    try {
      await addDoc(collection(db, 'workers', picked.id, 'signed_policies'), {
        policyId:         policy.id,
        policyTitle:      policy.title,
        policyContent:    policy.content,
        signatureDataUrl,
        signedAt:         new Date().toISOString(),
        signedBy:         picked.name,   // worker who physically signed
        assistedBy,                      // admin account that facilitated
        workerName:       picked.name,
      });
      setDone(true);
      setTimeout(onAssigned, 1800);
    } catch {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-sm shadow-2xl max-h-[85vh] flex flex-col"
        style={{ boxShadow: '0 0 60px rgba(168,85,247,0.12)' }}
        onClick={e => e.stopPropagation()}>

        <div className="px-6 pt-6 pb-4 border-b border-white/8 relative shrink-0">
          <button onClick={onClose} className="absolute top-4 right-5 text-slate-500 hover:text-white transition-colors text-xl leading-none">✕</button>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Assign Signed Policy</p>
          <h3 className="text-base font-bold text-white pr-8">{policy.title}</h3>
          <p className="text-xs text-slate-500 mt-1">Search by name, role, or Worker ID.</p>
        </div>

        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
            <span className="text-5xl">✅</span>
            <p className="text-sm font-bold text-green-400">Assigned to {picked?.name}!</p>
            <p className="text-xs text-slate-500">The signed policy is now in their profile.</p>
          </div>
        ) : (
          <>
            <div className="px-6 pt-4 shrink-0">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, role, or Worker ID…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-slate-600"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
              {wLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-purple-400 rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-slate-600 italic text-center py-8">No workers found.</p>
              ) : (
                filtered.map(w => (
                  <button
                    key={w.id}
                    onClick={() => setPicked(w)}
                    className="w-full text-left px-4 py-3 rounded-xl transition-all border"
                    style={picked?.id === w.id
                      ? { background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.4)' }
                      : { background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-xs text-white">{w.name}</p>
                      {w.workerId && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-white/8 text-slate-400 border border-white/10">{w.workerId}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{w.role}</p>
                  </button>
                ))
              )}
            </div>

            <div className="px-6 pb-6 pt-3 border-t border-white/8 shrink-0 space-y-2">
              {picked && (
                <p className="text-[10px] text-slate-500 text-center">
                  Signed by <span className="text-slate-300 font-semibold">{picked.name}</span> · Assisted by <span className="text-slate-300 font-semibold">{assistedBy}</span>
                </p>
              )}
              <button
                onClick={handleAssign}
                disabled={!picked || assigning}
                className="w-full py-2.5 text-sm font-bold rounded-xl text-white hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                style={{ backgroundColor: '#a855f7', boxShadow: '0 0 20px rgba(168,85,247,0.25)' }}>
                {assigning
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
                  : `Assign to ${picked?.name ?? 'Selected Worker'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Signed Policy Viewer Modal ─────────────────────────────────────────────────

interface SignedPolicyViewerProps {
  record: SignedPolicyRecord;
  onClose: () => void;
}
function SignedPolicyViewer({ record, onClose }: SignedPolicyViewerProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12091e] border border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col"
        style={{ boxShadow: '0 0 60px rgba(34,197,94,0.1)' }}
        onClick={e => e.stopPropagation()}>

        <div className="px-6 pt-6 pb-4 border-b border-white/8 relative shrink-0">
          <button onClick={onClose} className="absolute top-4 right-5 text-slate-500 hover:text-white transition-colors text-xl leading-none">✕</button>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">Signed</span>
          </div>
          <h3 className="text-base font-bold text-white pr-8">{record.policyTitle}</h3>
          <p className="text-[10px] text-slate-500 mt-1">
            Signed by <span className="text-slate-300 font-semibold">{record.signedBy}</span> on {new Date(record.signedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          {record.assistedBy && (
            <p className="text-[10px] text-slate-600 mt-0.5">
              Assisted by <span className="text-slate-400 font-semibold">{record.assistedBy}</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Signature */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Signature</p>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden p-2">
              <img src={record.signatureDataUrl} alt="Signature" className="w-full h-24 object-contain" />
            </div>
          </div>

          {/* Policy content */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Policy Content</p>
            <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 max-h-64 overflow-y-auto">
              <pre className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: 'inherit' }}>
                {record.policyContent || '(No content)'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeliverableGroups({ deliverables, loading, isDirector, onToggleShared, onView }: DeliverableGroupsProps) {
  // Group by projectId; preserve chronological order within each group;
  // sort groups by their most-recent upload.
  const groups = useMemo(() => {
    const map = new Map<string, DeliverableWithProject[]>();
    for (const d of deliverables) {
      if (!map.has(d.projectId)) map.set(d.projectId, []);
      map.get(d.projectId)!.push(d);
    }
    return Array.from(map.entries())
      .map(([projectId, items]) => ({ projectId, items }))
      .sort((a, b) => b.items[0].uploadedAt.localeCompare(a.items[0].uploadedAt));
  }, [deliverables]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ff00ff]" />
      </div>
    );
  }
  if (deliverables.length === 0) {
    return (
      <div className="text-center py-20 text-slate-600 italic text-sm">
        No deliverables uploaded yet.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map(({ projectId, items }, groupIdx) => {
        const accent = PROJECT_ACCENTS[groupIdx % PROJECT_ACCENTS.length];
        const first  = items[0];
        return (
          <div key={projectId}>
            {/* ── Project group header ── */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}80` }} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-bold text-white">{first.projectName}</span>
                {first.projectDirectorsNote && (
                  <span className="text-[11px] text-slate-500 ml-2">
                    — {first.projectDirectorsNote.length > 80
                      ? first.projectDirectorsNote.slice(0, 80) + '…'
                      : first.projectDirectorsNote}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-black px-2 py-0.5 rounded-full border shrink-0"
                style={{ color: accent, borderColor: `${accent}40`, background: `${accent}15` }}
              >
                {items.length} file{items.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* ── Deliverable cards (left accent bar connects them) ── */}
            <div className="flex gap-3">
              {/* Connecting left rail */}
              <div className="flex flex-col items-center shrink-0" style={{ width: '3px' }}>
                <div className="flex-1 rounded-full" style={{ width: '3px', background: `linear-gradient(to bottom, ${accent}, ${accent}30)` }} />
              </div>

              {/* Cards */}
              <div className="flex-1 min-w-0 space-y-2">
                {items.map(deliv => {
                  const type    = getFileViewType(deliv.contentType, deliv.name);
                  const icon    = getFileIcon(type, deliv.name);
                  const initials = deliv.uploadedByName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <div
                      key={`${deliv.projectId}-${deliv.id}`}
                      className="rounded-2xl border transition-all group"
                      style={{
                        background: deliv.sharedWithAll ? 'rgba(16,185,129,0.04)' : 'rgba(255,255,255,0.02)',
                        borderColor: deliv.sharedWithAll ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = deliv.sharedWithAll ? 'rgba(16,185,129,0.35)' : `${accent}50`)}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = deliv.sharedWithAll ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)')}
                    >
                      <div className="flex items-start gap-3 px-5 pt-4 pb-4">
                        <span className="text-2xl shrink-0 mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          {/* Filename + shared badge */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white truncate">{deliv.name}</p>
                            {deliv.sharedWithAll && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                                🌐 Shared with all
                              </span>
                            )}
                          </div>
                          {/* Submitter chip + meta */}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/5 text-slate-300 border border-white/10 shrink-0">
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ backgroundColor: accent + '80' }}>
                                {initials}
                              </span>
                              {deliv.uploadedByName}
                            </span>
                            <span className="text-[11px] text-slate-600">·</span>
                            <span className="text-[11px] text-slate-500">{formatBytes(deliv.size)}</span>
                            <span className="text-[11px] text-slate-600">·</span>
                            <span className="text-[11px] text-slate-500">{deliv.uploadedAt ? format(new Date(deliv.uploadedAt), 'MMM d, yyyy') : ''}</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {isDirector && (
                            <button
                              onClick={() => onToggleShared(deliv)}
                              title={deliv.sharedWithAll ? 'Remove from all accounts' : 'Share with all accounts'}
                              className={`px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${
                                deliv.sharedWithAll
                                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400'
                                  : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                              }`}
                            >
                              {deliv.sharedWithAll ? '🌐 Shared' : '🔒 Private'}
                            </button>
                          )}
                          <button
                            onClick={() => onView(deliv)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors opacity-0 group-hover:opacity-100"
                          >
                            {type === 'image' || type === 'video' ? 'View' : 'Open'}
                          </button>
                          <a
                            href={deliv.url}
                            download={deliv.name}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors opacity-0 group-hover:opacity-100"
                          >
                            ↓
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SystemCardTile ─────────────────────────────────────────────────────────────

function OrgChartView({ roleColor }: { roleColor: string }) {
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    ids: string[];
    startPointerX: number;
    startPointerY: number;
    startPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadedRef = React.useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [cards, setCards] = useState<OrgCardItem[]>(buildOrgChartDefaults);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [workersByRole, setWorkersByRole] = useState<Record<string, string[]>>({});

  // Load workers and build role → names map
  useEffect(() => {
    getDocs(collection(db, 'workers')).then(snap => {
      const map: Record<string, string[]> = {};
      snap.docs.forEach(d => {
        const { name, role } = d.data() as { name: string; role: string };
        if (!name || !role) return;
        const key = role.trim().toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(name.trim());
      });
      setWorkersByRole(map);
    }).catch(() => {});
  }, []);

  // Load persisted layout from Firestore on mount
  useEffect(() => {
    getDoc(doc(db, 'org_chart', 'layout'))
      .then(snap => {
        if (snap.exists()) {
          const parsed = (snap.data().cards ?? []) as (OrgCardItem & { role?: string })[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCards(parsed.map(card => ({
              ...card,
              personName: card.personName ?? card.role ?? '',
            })));
          }
        }
      })
      .finally(() => { isLoadedRef.current = true; });
  }, []);

  // Debounced save to Firestore whenever cards change (after initial load).
  // Also detects card renames and syncs matching worker roles automatically.
  useEffect(() => {
    if (!isLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // Detect renames by comparing with the previously saved state
      const prevSnap = await getDoc(doc(db, 'org_chart', 'layout'));
      if (prevSnap.exists()) {
        const prevCards = (prevSnap.data().cards ?? []) as { id: string; name: string }[];
        const prevMap: Record<string, string> = {};
        prevCards.forEach(c => { prevMap[c.id] = c.name; });

        const renames: { oldName: string; newName: string }[] = [];
        cards.forEach(c => {
          const prev = prevMap[c.id];
          if (prev && prev !== c.name) renames.push({ oldName: prev, newName: c.name });
        });

        if (renames.length > 0) {
          const workersSnap = await getDocs(collection(db, 'workers'));
          await Promise.all(
            workersSnap.docs.flatMap(d => {
              const rename = renames.find(r => r.oldName === (d.data() as { role: string }).role);
              return rename ? [updateDoc(doc(db, 'workers', d.id), { role: rename.newName })] : [];
            })
          );
        }
      }
      await setDoc(doc(db, 'org_chart', 'layout'), { cards });
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [cards]);

  const selectedCard = selectedCardIds.length === 1
    ? cards.find(card => card.id === selectedCardIds[0]) ?? null
    : null;

  const updateCard = (id: string, patch: Partial<OrgCardItem>) => {
    setCards(prev => prev.map(card => (card.id === id ? { ...card, ...patch } : card)));
  };

  const deleteCard = (id: string) => {
    setCards(prev => prev.filter(card => card.id !== id));
    setSelectedCardIds(prev => prev.filter(cardId => cardId !== id));
  };

  const addCard = () => {
    const tone = selectedCard?.tone ?? 'blue';
    setCards(prev => [
      ...prev,
      {
        id: `org-card-${Date.now()}`,
        name: 'New Card',
        personName: '',
        tone,
        x: 20,
        y: 20,
      },
    ]);
  };

  const resetChart = () => {
    setCards(buildOrgChartDefaults());
    setSelectedCardIds([]);
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startPointerX;
    const dy = event.clientY - drag.startPointerY;
    setCards(prev =>
      prev.map(card => {
        const start = drag.startPositions[card.id];
        if (!start) return card;
        return {
          ...card,
          x: clamp(start.x + dx, 0, ORG_CANVAS_WIDTH - ORG_CARD_WIDTH),
          y: clamp(start.y + dy, 0, ORG_CANVAS_HEIGHT - ORG_CARD_HEIGHT),
        };
      })
    );
  };

  const stopDragging = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
  };

  const startDragging = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (!isEditing || event.button !== 0) return;

    const isMultiSelectKey = event.ctrlKey || event.metaKey;
    if (isMultiSelectKey) {
      event.preventDefault();
      setSelectedCardIds(prev => (prev.includes(id) ? prev.filter(cardId => cardId !== id) : [...prev, id]));
      return;
    }

    const idsToMove = selectedCardIds.includes(id) ? selectedCardIds : [id];
    setSelectedCardIds(idsToMove);
    const startPositions: Record<string, { x: number; y: number }> = {};
    cards.forEach(card => {
      if (idsToMove.includes(card.id)) startPositions[card.id] = { x: card.x, y: card.y };
    });

    dragRef.current = {
      ids: idsToMove,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startPositions,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
  };

  useEffect(() => () => stopDragging(), []);

  return (
    <section
      className="px-2 sm:px-4 pb-6"
      style={{
        background:
          'radial-gradient(1200px 600px at 5% 10%, rgba(250,204,21,0.08), transparent 45%), radial-gradient(1000px 500px at 95% 0%, rgba(236,72,153,0.08), transparent 50%), linear-gradient(180deg, rgba(10,5,16,0.96), rgba(6,3,11,0.98))',
      }}
    >
      <div className="w-full">
        <div className="px-3 sm:px-4 py-5 sm:py-6 border-b border-white/10">
          <p className="text-[10px] sm:text-xs font-black tracking-[0.28em] uppercase text-slate-400">Culinary Department</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl sm:text-4xl font-display font-bold text-white">Organizational Chart</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditing(v => !v)}
                className="px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-[0.14em] rounded-full border"
                style={{
                  color: isEditing ? '#fda4af' : roleColor,
                  borderColor: isEditing ? 'rgba(244,63,94,0.5)' : `${roleColor}66`,
                  background: isEditing ? 'rgba(244,63,94,0.14)' : `${roleColor}1A`,
                }}
              >
                {isEditing ? 'Done Editing' : 'Edit Chart'}
              </button>
              <button
                onClick={addCard}
                className="px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-[0.14em] rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              >
                + Add Card
              </button>
              <button
                onClick={resetChart}
                className="px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-[0.14em] rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/15"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="py-3 sm:py-4 overflow-auto">
          <div
            ref={canvasRef}
            className="relative bg-black/10"
            style={{ width: ORG_CANVAS_WIDTH, height: ORG_CANVAS_HEIGHT, minWidth: ORG_CANVAS_WIDTH, minHeight: ORG_CANVAS_HEIGHT }}
          >
            {cards.map(card => {
              const cardTone = ORG_TONE_STYLES[card.tone];
              const selected = selectedCardIds.includes(card.id);
              return (
                <div
                  key={card.id}
                  onPointerDown={(event) => startDragging(event, card.id)}
                  onClick={() => {
                    if (!isEditing) setSelectedCardIds([card.id]);
                  }}
                  className="absolute rounded-xl border px-2 py-2 select-none"
                  style={{
                    width: ORG_CARD_WIDTH,
                    minHeight: ORG_CARD_HEIGHT,
                    transform: `translate(${card.x}px, ${card.y}px)`,
                    borderColor: selected ? '#fef3c7' : cardTone.border,
                    background: cardTone.bg,
                    boxShadow: selected
                      ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 18px rgba(254,243,199,0.45)'
                      : `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 14px ${cardTone.glow}`,
                    cursor: isEditing ? 'grab' : 'pointer',
                  }}
                >
                  {isEditing && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteCard(card.id);
                      }}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-[10px] font-black bg-rose-500 text-white border border-rose-200/50"
                      title="Delete"
                    >
                      ×
                    </button>
                  )}
                  <div className="w-7 h-7 rounded-md border border-white/25 bg-white/10 mx-auto mb-2" />
                  {isEditing ? (
                    <div className="space-y-1">
                      <input
                        value={card.name}
                        onChange={(event) => updateCard(card.id, { name: event.target.value })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="Position"
                        className="w-full text-[9px] font-semibold text-white text-center leading-tight bg-black/30 border border-white/20 rounded px-1 py-1"
                      />
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-[9px] font-semibold text-white text-center leading-tight">{card.name}</p>
                      {(() => {
                        const assigned = workersByRole[card.name.trim().toLowerCase()] ?? [];
                        const display = assigned.length > 0 ? assigned : (card.personName ? [card.personName] : []);
                        return display.map((n, i) => (
                          <p key={i} className="text-[8px] font-medium italic tracking-wide text-cyan-200/95 text-center leading-tight">{n}</p>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedCard && (
          <div className="px-3 sm:px-4 pb-5 sm:pb-6">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3 sm:p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">Selected Card</p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <input
                  value={selectedCard.name}
                  onChange={e => updateCard(selectedCard.id, { name: e.target.value })}
                  placeholder="Position"
                  className="sm:col-span-3 w-full text-xs text-white bg-black/30 border border-white/20 rounded px-2 py-2"
                />
                <select
                  value={selectedCard.tone}
                  onChange={e => updateCard(selectedCard.id, { tone: e.target.value as OrgCardTone })}
                  className="w-full text-xs text-white bg-black/30 border border-white/20 rounded px-2 py-2"
                >
                  <option value="blue">Blue</option>
                  <option value="red">Red</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                </select>
                <button
                  onClick={() => deleteCard(selectedCard.id)}
                  className="w-full text-xs font-black uppercase tracking-[0.1em] px-2 py-2 rounded border border-rose-400/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                >
                  Delete Card
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedCardIds.length > 1 && (
          <div className="px-3 sm:px-4 pb-5 sm:pb-6">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-3 sm:p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3">
                {selectedCardIds.length} Cards Selected
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  defaultValue=""
                  onChange={e => {
                    const tone = e.target.value as OrgCardTone;
                    if (!tone) return;
                    setCards(prev => prev.map(card => (selectedCardIds.includes(card.id) ? { ...card, tone } : card)));
                    e.currentTarget.value = '';
                  }}
                  className="w-full text-xs text-white bg-black/30 border border-white/20 rounded px-2 py-2"
                >
                  <option value="" disabled>Change color</option>
                  <option value="blue">Blue</option>
                  <option value="red">Red</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                </select>
                <button
                  onClick={() => {
                    setCards(prev => prev.filter(card => !selectedCardIds.includes(card.id)));
                    setSelectedCardIds([]);
                  }}
                  className="w-full text-xs font-black uppercase tracking-[0.1em] px-2 py-2 rounded border border-rose-400/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                >
                  Delete Selected
                </button>
                <button
                  onClick={() => setSelectedCardIds([])}
                  className="w-full text-xs font-black uppercase tracking-[0.1em] px-2 py-2 rounded border border-white/30 bg-white/10 text-white hover:bg-white/20"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Office Schedules ──────────────────────────────────────────────────────────

const OFFICE_SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_TO_JS: Record<string, number> = { Monday: 1, Tuesday: 2, Thursday: 4, Friday: 5, Saturday: 6 };

const OFFICE_SCHEDULE_ROWS: { name: string; shifts: Record<string, string[]> }[] = [
  {
    name: 'Linda',
    shifts: {
      Monday:   ['3:30 PM – 7:00 PM'],
      Tuesday:  ['12:00 PM – 4:00 PM'],
      Thursday: ['12:00 PM – 4:00 PM'],
      Friday:   ['12:00 PM – 4:00 PM'],
      Saturday: ['11:30 AM – 3:30 PM'],
    },
  },
  {
    name: 'Mayeen',
    shifts: {
      Monday:   ['3:30 PM – 7:00 PM'],
      Tuesday:  ['3:30 PM – 7:00 PM'],
      Thursday: ['3:30 PM – 7:00 PM'],
      Friday:   ['3:30 PM – 7:00 PM'],
      Saturday: ['11:30 AM – 3:30 PM'],
    },
  },
  {
    name: 'JD',
    shifts: {
      Monday:   ['3:30 PM – 7:00 PM'],
      Tuesday:  ['3:30 PM – 7:00 PM'],
      Thursday: ['3:30 PM – 7:00 PM'],
      Friday:   ['1:00 PM – 4:30 PM'],
      Saturday: ['11:30 AM – 4:00 PM'],
    },
  },
  {
    name: 'Bella',
    shifts: {
      Monday:   ['10:30 AM – 2:00 PM'],
      Tuesday:  ['11:00 AM – 3:00 PM'],
      Thursday: ['11:00 AM – 3:00 PM'],
      Friday:   ['11:00 AM – 3:00 PM'],
      Saturday: ['11:30 AM – 3:30 PM'],
    },
  },
  {
    name: 'Taylor',
    shifts: {
      Monday:   ['6:30–11:45 AM', '2:00–7:00 PM'],
      Tuesday:  ['6:30–7:45 AM', '4:30–7:00 PM'],
      Thursday: ['6:30–7:45 AM', '4:30–7:00 PM'],
      Friday:   ['6:30–11:45 AM', '2:00–7:00 PM'],
      Saturday: ['7:00 AM – 7:00 PM'],
    },
  },
];

function parseShiftToMinutes(shift: string): [number, number] | null {
  const idx = shift.indexOf('–');
  if (idx === -1) return null;
  const left = shift.slice(0, idx).trim();
  const right = shift.slice(idx + 1).trim();
  const toMin = (part: string, fallback?: string): number | null => {
    const m = part.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    const p = (m[3] || fallback || '').toUpperCase();
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  const rp = right.match(/(AM|PM)$/i)?.[1];
  const lp = left.match(/(AM|PM)$/i)?.[1] || rp;
  const s = toMin(left.replace(/(AM|PM)/i, '').trim(), lp);
  const e = toMin(right.replace(/(AM|PM)/i, '').trim(), rp);
  if (s === null || e === null) return null;
  return [s, e];
}

type ScheduleRow = { name: string; userId?: string; shifts: Record<string, string[]> };

function OfficeSchedulesView({
  roleColor, currentUser: _currentUser, isDirector, directoryUsers, onViewProfile,
}: {
  roleColor: string;
  currentUser: User;
  isDirector: boolean;
  directoryUsers: User[];
  onViewProfile: (u: User) => void;
}) {
  const [rows, setRows] = useState<ScheduleRow[]>(OFFICE_SCHEDULE_ROWS);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<ScheduleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [hawaiiNow, setHawaiiNow] = useState(() =>
    new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' }))
  );

  useEffect(() => {
    const t = setInterval(() => {
      setHawaiiNow(new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' })));
    }, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'officeSchedule', 'main'))
      .then(snap => { if (snap.exists() && snap.data().rows) setRows(snap.data().rows); })
      .finally(() => setLoading(false));
  }, []);

  const hawaiiDay = hawaiiNow.getDay();
  const hawaiiMinutes = hawaiiNow.getHours() * 60 + hawaiiNow.getMinutes();
  const todayJs = new Date().getDay();

  const startEdit = () => {
    setDraft(rows.map(r => ({
      name: r.name,
      userId: r.userId,
      shifts: Object.fromEntries(OFFICE_SCHEDULE_DAYS.map(d => [d, [...(r.shifts[d] ?? [])]]))
    })));
    setEditMode(true);
  };

  const [editingShift, setEditingShift] = useState<{ rowIdx: number; day: string; shiftIdx: number | null } | null>(null);
  const [shiftDraft, setShiftDraft] = useState({ start: '', end: '' });

  const to24h = (time12: string): string => {
    const m = time12.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return '';
    let h = parseInt(m[1]); const min = m[2]; const p = m[3].toUpperCase();
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  };

  const to12h = (time24: string): string => {
    const [hStr, min] = time24.split(':');
    let h = parseInt(hStr); const period = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12; if (h === 0) h = 12;
    return `${h}:${min} ${period}`;
  };

  const parseShiftTimes = (shift: string): { start: string; end: string } => {
    const idx = shift.indexOf('–');
    if (idx === -1) return { start: '', end: '' };
    const left = shift.slice(0, idx).trim();
    const right = shift.slice(idx + 1).trim();
    const rp = right.match(/(AM|PM)$/i)?.[1];
    const lp = left.match(/(AM|PM)$/i)?.[1] || rp;
    const leftFull = left.match(/(AM|PM)/i) ? left : `${left} ${lp ?? ''}`;
    const rightFull = right.match(/(AM|PM)/i) ? right : `${right} ${rp ?? ''}`;
    return { start: to24h(leftFull.trim()), end: to24h(rightFull.trim()) };
  };

  const openTimePicker = (rowIdx: number, day: string, shiftIdx: number | null) => {
    if (shiftIdx !== null) {
      const shift = draft[rowIdx]?.shifts[day]?.[shiftIdx] ?? '';
      setShiftDraft(parseShiftTimes(shift));
    } else {
      setShiftDraft({ start: '', end: '' });
    }
    setEditingShift({ rowIdx, day, shiftIdx });
  };

  const confirmShift = () => {
    if (!editingShift || !shiftDraft.start || !shiftDraft.end) return;
    const { rowIdx, day, shiftIdx } = editingShift;
    const formatted = `${to12h(shiftDraft.start)} – ${to12h(shiftDraft.end)}`;
    setDraft(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const shifts = [...(r.shifts[day] ?? [])];
      if (shiftIdx !== null) shifts[shiftIdx] = formatted; else shifts.push(formatted);
      return { ...r, shifts: { ...r.shifts, [day]: shifts } };
    }));
    setEditingShift(null);
  };

  const removeShift = (rowIdx: number, day: string, shiftIdx: number) => {
    setDraft(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const shifts = (r.shifts[day] ?? []).filter((_, si) => si !== shiftIdx);
      return { ...r, shifts: { ...r.shifts, [day]: shifts } };
    }));
  };

  const updateDraftUser = (rowIdx: number, userId: string) => {
    const linked = directoryUsers.find(u => u.id === userId);
    setDraft(prev => prev.map((r, i) => i !== rowIdx ? r : {
      ...r,
      userId: userId || undefined,
      name: linked ? linked.name : r.name,
    }));
  };

  const updateDraftName = (rowIdx: number, name: string) => {
    setDraft(prev => prev.map((r, i) => i !== rowIdx ? r : { ...r, name }));
  };

  const addRow = () => {
    setDraft(prev => [...prev, {
      name: '',
      userId: undefined,
      shifts: Object.fromEntries(OFFICE_SCHEDULE_DAYS.map(d => [d, []]))
    }]);
  };

  const removeRow = (rowIdx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== rowIdx));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      // Strip undefined fields — Firestore rejects them
      const cleanRows = draft.map(r => {
        const row: Record<string, unknown> = { name: r.name, shifts: r.shifts };
        if (r.userId) row.userId = r.userId;
        return row;
      });
      await setDoc(doc(db, 'officeSchedule', 'main'), { rows: cleanRows });
      setRows(draft);
      setEditMode(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    }
    setSaving(false);
  };

  const displayRows = editMode ? draft : rows;

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">Office Schedules</h2>
          <p className="text-sm text-slate-400">Weekly shift schedule for office staff.</p>
        </div>
        {isDirector && !editMode && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={startEdit}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border"
              style={{ borderColor: `${roleColor}50`, color: roleColor, background: `${roleColor}12` }}
            >✏️ Edit Schedule</button>
            <span className="text-[9px] text-slate-600 font-semibold tracking-wide">🔒 Only you can edit this</span>
          </div>
        )}
        {isDirector && editMode && (
          <div className="flex flex-col items-end gap-1 shrink-0">
            {saveError && <p className="text-[10px] text-red-400 max-w-[200px] text-right">{saveError}</p>}
            <div className="flex items-center gap-2">
            <button onClick={() => { setEditMode(false); setSaveError(''); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white border border-white/10 transition-all">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50" style={{ background: roleColor }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-white/10 w-40">
                    {editMode ? 'Member' : 'Name'}
                  </th>
                  {OFFICE_SCHEDULE_DAYS.map(day => {
                    const isToday = DAY_TO_JS[day] === todayJs;
                    return (
                      <th key={day} className="px-3 py-3 text-[10px] font-black uppercase tracking-widest border-b border-white/10 text-center"
                        style={isToday ? { color: roleColor, background: `${roleColor}12` } : { color: '#475569' }}>
                        {day}
                        {isToday && <span className="block text-[8px] normal-case tracking-normal font-semibold opacity-70">today</span>}
                      </th>
                    );
                  })}
                  {editMode && <th className="px-2 py-3 border-b border-white/10 w-8" />}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, ri) => {
                  const linkedUser = directoryUsers.find(u => u.id === row.userId);
                  const todayKey = OFFICE_SCHEDULE_DAYS.find(d => DAY_TO_JS[d] === hawaiiDay);
                  const todayShifts = todayKey ? (row.shifts[todayKey] ?? []) : [];
                  const presentNow = todayShifts.some(s => {
                    const r = parseShiftToMinutes(s);
                    return r ? hawaiiMinutes >= r[0] && hawaiiMinutes < r[1] : false;
                  });
                  const rc = linkedUser ? (ROLE_PALETTE[linkedUser.role] ?? '#64748b') : '#64748b';

                  return (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td className="px-4 py-3 border-b border-white/5">
                        {editMode ? (
                          <div className="flex flex-col gap-1.5 min-w-[160px]">
                            {/* Custom styled dropdown */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setOpenDropdown(openDropdown === ri ? null : ri)}
                                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-xs text-left transition-colors"
                                style={{ background: 'rgba(255,255,255,0.06)', borderColor: openDropdown === ri ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)', color: row.userId ? '#e2e8f0' : '#64748b' }}
                              >
                                <span className="truncate">
                                  {row.userId
                                    ? directoryUsers.find(u => u.id === row.userId)?.name ?? '— No account —'
                                    : '— No account —'}
                                </span>
                                <span className="text-slate-500 shrink-0 text-[9px]">{openDropdown === ri ? '▲' : '▼'}</span>
                              </button>
                              {openDropdown === ri && (
                                <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                                <div
                                  className="absolute z-50 left-0 top-full mt-1 w-56 rounded-xl border border-white/10 overflow-y-auto shadow-2xl"
                                  style={{ background: '#1a1025', maxHeight: '220px' }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => { updateDraftUser(ri, ''); setOpenDropdown(null); }}
                                    className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-white/8 transition-colors border-b border-white/5"
                                    style={{ background: !row.userId ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                                  >— No account —</button>
                                  {directoryUsers.filter(u =>
                                    !draft.some((r, i) => i !== ri && r.userId === u.id)
                                  ).map(u => (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => { updateDraftUser(ri, u.id); setOpenDropdown(null); }}
                                      className="w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2"
                                      style={row.userId === u.id ? { background: `${roleColor}20`, color: roleColor } : { color: '#cbd5e1' }}
                                      onMouseEnter={e => { if (row.userId !== u.id) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
                                      onMouseLeave={e => { if (row.userId !== u.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                                    >
                                      <img src={u.photo || `https://picsum.photos/seed/${u.id}/100/100`} className="w-5 h-5 rounded-full object-cover shrink-0" alt="" />
                                      <span className="truncate flex-1">{u.name}</span>
                                      <span className="text-[9px] text-slate-500 shrink-0">{u.role}</span>
                                    </button>
                                  ))}
                                </div>
                                </>
                              )}
                            </div>
                            {!row.userId && (
                              <input
                                value={row.name}
                                onChange={e => updateDraftName(ri, e.target.value)}
                                placeholder="Name"
                                className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-white/30"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {presentNow ? (
                              <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                              </span>
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />
                            )}
                            {linkedUser ? (
                              <button
                                onClick={() => onViewProfile(linkedUser)}
                                className="flex items-center gap-2 group"
                                title={`View ${linkedUser.name}'s profile`}
                              >
                                <img
                                  src={linkedUser.photo || `https://picsum.photos/seed/${linkedUser.id}/100/100`}
                                  className="w-6 h-6 rounded-full object-cover shrink-0"
                                  style={{ border: `1.5px solid ${rc}70` }}
                                  alt={linkedUser.name}
                                />
                                <span className="font-bold text-slate-200 group-hover:underline group-hover:text-white transition-colors">{linkedUser.name}</span>
                              </button>
                            ) : (
                              <span className="font-bold text-slate-200">{row.name || '—'}</span>
                            )}
                            {presentNow && (
                              <span className="text-[8px] font-black uppercase tracking-widest text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/30 bg-green-500/10">In</span>
                            )}
                          </div>
                        )}
                      </td>
                      {OFFICE_SCHEDULE_DAYS.map(day => {
                        const isToday = DAY_TO_JS[day] === todayJs;
                        const shifts = row.shifts[day] ?? [];
                        return (
                          <td key={day}
                            className="border-b border-white/5 align-top"
                            style={{ ...(isToday ? { background: `${roleColor}08` } : {}), padding: editMode ? '10px 8px' : '12px' }}>
                            {editMode ? (
                              <div className="flex flex-col gap-1.5 min-w-[140px]">
                                {shifts.map((s, si) => (
                                  <div key={si} className="flex items-center gap-1 rounded-lg border border-white/10 overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                    <button
                                      type="button"
                                      onClick={() => openTimePicker(ri, day, si)}
                                      className="flex-1 text-left px-2 py-2 text-xs text-slate-200 hover:text-white transition-colors leading-tight"
                                    >{s}</button>
                                    <button
                                      type="button"
                                      onClick={() => removeShift(ri, day, si)}
                                      className="px-2 py-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm leading-none"
                                    >×</button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => openTimePicker(ri, day, null)}
                                  className="text-[10px] text-slate-600 hover:text-slate-300 border border-dashed border-white/15 rounded-lg px-2 py-1.5 transition-colors text-center"
                                >+ shift</button>
                              </div>
                            ) : shifts.length === 0 ? (
                              <span className="text-slate-700">—</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {shifts.map((s, i) => (
                                  <div key={i} className="text-slate-300 text-xs leading-tight whitespace-nowrap">{s}</div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {editMode && (
                        <td className="px-2 py-3 border-b border-white/5 align-middle text-center">
                          <button
                            onClick={() => removeRow(ri)}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs font-bold"
                            title="Remove row"
                          >×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editMode && (
            <button
              onClick={addRow}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-dashed border-white/20 text-slate-500 hover:text-white hover:border-white/40 transition-all w-full justify-center"
            >
              + Add Member
            </button>
          )}
        </>
      )}

      {/* Time picker modal */}
      {editingShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setEditingShift(null)}>
          <div className="rounded-2xl border border-white/10 p-5 shadow-2xl w-72" style={{ background: '#1a1025' }} onClick={e => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-1">
              {editingShift.shiftIdx !== null ? 'Edit Shift' : 'Add Shift'}
            </h4>
            <p className="text-[10px] text-slate-500 mb-4 uppercase tracking-widest">{editingShift.day}</p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 block">Start Time</label>
                <input
                  type="time"
                  value={shiftDraft.start}
                  onChange={e => setShiftDraft(d => ({ ...d, start: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none border border-white/10 focus:border-white/30"
                  style={{ background: 'rgba(255,255,255,0.06)', colorScheme: 'dark' }}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 block">End Time</label>
                <input
                  type="time"
                  value={shiftDraft.end}
                  onChange={e => setShiftDraft(d => ({ ...d, end: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none border border-white/10 focus:border-white/30"
                  style={{ background: 'rgba(255,255,255,0.06)', colorScheme: 'dark' }}
                />
              </div>
              {shiftDraft.start && shiftDraft.end && (
                <p className="text-xs text-slate-400 text-center">
                  {to12h(shiftDraft.start)} – {to12h(shiftDraft.end)}
                </p>
              )}
              <div className="flex gap-2 mt-1">
                <button onClick={() => setEditingShift(null)} className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white border border-white/10 transition-all">
                  Cancel
                </button>
                <button
                  onClick={confirmShift}
                  disabled={!shiftDraft.start || !shiftDraft.end}
                  className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: roleColor }}
                >
                  {editingShift.shiftIdx !== null ? 'Update' : 'Add Shift'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemCardTile({ card, onNavigate }: { card: SystemCard; onNavigate: (view: AppView) => void }) {
  const handleClick = () => {
    if (card.link_type === 'internal') {
      onNavigate(card.link as AppView);
    } else {
      window.open(card.link, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="glass-card rounded-2xl sm:rounded-3xl p-3 sm:p-8 text-left group transition-all duration-300 hover:-translate-y-1 w-full relative overflow-hidden border border-white/10 hover:border-white/20"
    >
      <div
        className="absolute -bottom-6 -right-6 w-32 h-32 rounded-full blur-3xl opacity-15 group-hover:opacity-35 transition-all duration-300"
        style={{ backgroundColor: card.color_accent }}
      />
      <div
        className="w-8 h-8 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-2 sm:mb-6 relative z-10 overflow-hidden"
        style={{ backgroundColor: card.color_accent + '20', border: `1px solid ${card.color_accent}40` }}
      >
        {card.icon.startsWith('http') || card.icon.startsWith('data:')
          ? <img src={card.icon} className="w-5 h-5 sm:w-9 sm:h-9 object-contain" alt={card.title} />
          : <span className="text-base sm:text-2xl">{card.icon}</span>
        }
      </div>
      <h3 className="text-xs sm:text-lg font-bold mb-1 sm:mb-2 relative z-10 transition-opacity group-hover:opacity-90 leading-tight" style={{ color: card.color_accent }}>
        {card.title}
      </h3>
      <p className="hidden sm:block text-sm text-slate-400 leading-relaxed relative z-10">{card.description}</p>
      <div className="mt-2 sm:mt-6 flex items-center gap-1 sm:gap-2 relative z-10">
        <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-600">
          {card.link_type === 'external' ? '↗' : '→'}
          <span className="hidden sm:inline"> {card.link_type === 'external' ? 'External' : 'Open'}</span>
        </span>
        {card.is_view_only && (
          <span className="text-[7px] sm:text-[9px] font-black uppercase tracking-widest px-1.5 sm:px-2 py-0.5 rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]">
            View Only
          </span>
        )}
      </div>
    </button>
  );
}
