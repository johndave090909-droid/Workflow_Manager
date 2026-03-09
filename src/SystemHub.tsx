import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut } from 'lucide-react';
import { User, SystemCard, AppView, RolePermissions, Project, Deliverable } from './types';
import { db } from './firebase';
import ComplaintsView from './ComplaintsView';
import { collection, collectionGroup, getDocs, orderBy, query, where, updateDoc, doc, addDoc, deleteDoc } from 'firebase/firestore';

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

type HubSection = 'home' | 'complaints' | 'deliverables' | 'org-chart' | 'directory' | 'rules';
type DeliverableWithProject = Deliverable & {
  projectId: string;
  projectName: string;
  projectDirectorsNote: string | null;
  sharedWithAll: boolean;
};

const NAV_ITEMS: { id: HubSection; label: string; emoji: string }[] = [
  { id: 'home',         label: 'Home',              emoji: '🏠' },
  { id: 'complaints',   label: 'Guest Experience',  emoji: '📋' },
  { id: 'deliverables', label: 'Deliverables',      emoji: '📁' },
  { id: 'org-chart',    label: 'Org Chart',         emoji: '🧭' },
  { id: 'directory',    label: 'Directory',         emoji: '👥' },
  { id: 'rules',        label: 'Rules & Policies',  emoji: '📜' },
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

  const [activeSection,   setActiveSection]   = useState<HubSection>('home');
  const [allDeliverables, setAllDeliverables] = useState<DeliverableWithProject[]>([]);
  const [delivLoading,    setDelivLoading]    = useState(false);
  const [viewerFile,      setViewerFile]      = useState<DeliverableWithProject | null>(null);
  const [directoryUsers,  setDirectoryUsers]  = useState<User[]>([]);
  const [directoryWorkers, setDirectoryWorkers] = useState<{id:string;name:string;role:string;email?:string;phone?:string;notes?:string}[]>([]);
  const [dirLoading,      setDirLoading]      = useState(false);

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
      const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
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
                    className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 text-left w-full"
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
                {directoryUsers.slice(0, 8).map(u => {
                  const rc = ROLE_PALETTE[u.role] ?? '#64748b';
                  return (
                    <div key={u.id} className="flex items-center gap-2.5">
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
                        <p className="text-[11px] font-semibold text-slate-200 truncate leading-tight">{u.name}</p>
                        <p className="text-[9px] text-slate-500 truncate">{u.role}</p>
                      </div>
                    </div>
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
                {systemCards.filter(c => c.link !== 'management-council').map(card => (
                  <SystemCardTile key={card.id} card={card} onNavigate={onNavigate} />
                ))}
                {systemCards.filter(c => c.link !== 'management-council').length === 0 && (
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

          {/* RULES & POLICIES */}
          {activeSection === 'rules' && (
            <RulesAndPoliciesView
              isAdmin={permissions.manage_policies ?? (permissions.access_it_admin || permissions.view_all_projects)}
              currentUserName={currentUser.name}
              roleColor={roleColor}
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
  const storageKey = 'workflow_manager_org_chart_canvas_v4';
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    ids: string[];
    startPointerX: number;
    startPointerY: number;
    startPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [cards, setCards] = useState<OrgCardItem[]>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return buildOrgChartDefaults();
      const parsed = JSON.parse(saved) as (OrgCardItem & { role?: string })[];
      if (!Array.isArray(parsed)) throw new Error('Invalid org chart');
      // Backward compatibility for previously saved cards that used `role`.
      return parsed.map(card => ({
        ...card,
        personName: card.personName ?? card.role ?? '',
      }));
    } catch {
      return buildOrgChartDefaults();
    }
  });
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(cards));
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
                      <input
                        value={card.personName ?? ''}
                        onChange={(event) => updateCard(card.id, { personName: event.target.value })}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="Name"
                        className="w-full text-[8px] font-medium text-cyan-200 text-center leading-tight bg-black/25 border border-cyan-300/25 rounded px-1 py-0.5"
                      />
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-[9px] font-semibold text-white text-center leading-tight">{card.name}</p>
                      {card.personName && (
                        <p className="text-[8px] font-medium italic tracking-wide text-cyan-200/95 text-center leading-tight">
                          {card.personName}
                        </p>
                      )}
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
                  className="sm:col-span-2 w-full text-xs text-white bg-black/30 border border-white/20 rounded px-2 py-2"
                />
                <input
                  value={selectedCard.personName ?? ''}
                  onChange={e => updateCard(selectedCard.id, { personName: e.target.value })}
                  placeholder="Name"
                  className="w-full text-xs text-cyan-200 bg-black/30 border border-cyan-300/30 rounded px-2 py-2"
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
