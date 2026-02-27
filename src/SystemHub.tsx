import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut } from 'lucide-react';
import { User, SystemCard, AppView, RolePermissions, Project, Deliverable } from './types';
import { db } from './firebase';
import ComplaintsView from './ComplaintsView';
import { collection, collectionGroup, getDocs, orderBy, query, where, updateDoc, doc } from 'firebase/firestore';

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

type HubSection = 'home' | 'complaints' | 'deliverables' | 'org-chart';
type DeliverableWithProject = Deliverable & {
  projectId: string;
  projectName: string;
  projectDirectorsNote: string | null;
  sharedWithAll: boolean;
};

const NAV_ITEMS: { id: HubSection; label: string; emoji: string }[] = [
  { id: 'home',         label: 'Home',         emoji: '🏠' },
  { id: 'complaints',   label: 'Complaints',   emoji: '📋' },
  { id: 'deliverables', label: 'Deliverables', emoji: '📁' },
  { id: 'org-chart',    label: 'Org Chart',    emoji: '🧭' },
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
          className="hidden md:flex w-56 shrink-0 border-r border-white/8 sticky top-16 h-[calc(100vh-4rem)] flex-col py-6 overflow-y-auto"
          style={{ background: 'rgba(6,3,11,0.95)' }}
        >
          {/* User block */}
          <div className="px-4 mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0" style={{ border: `2px solid ${roleColor}` }}>
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

          {/* Divider */}
          <div className="mx-4 mb-4 border-t border-white/8" />

          {/* Nav label */}
          <p className="px-4 mb-2 text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">Menu</p>

          {/* Nav items */}
          <nav className="flex flex-col gap-0.5 px-2">
            {NAV_ITEMS.map(item => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left w-full"
                  style={
                    active
                      ? { backgroundColor: `${roleColor}22`, color: roleColor }
                      : { color: '#94a3b8' }
                  }
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0'; }}
                  onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; } }}
                >
                  <span className="text-base leading-none">{item.emoji}</span>
                  <span>{item.label}</span>
                  {active && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: roleColor }} />
                  )}
                </button>
              );
            })}
          </nav>
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
                {systemCards.map(card => (
                  <SystemCardTile key={card.id} card={card} onNavigate={onNavigate} />
                ))}
                {systemCards.length === 0 && (
                  <div className="col-span-3 text-center py-20 text-slate-600 italic text-sm">
                    No systems available. Contact your IT Administrator.
                  </div>
                )}
              </div>
            </>
          )}

          {/* COMPLAINTS */}
          {activeSection === 'complaints' && (
            <ComplaintsView currentUser={currentUser} roleColor={roleColor} />
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
