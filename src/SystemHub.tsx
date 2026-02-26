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

type HubSection = 'home' | 'complaints' | 'deliverables';
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
