import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, LogOut } from 'lucide-react';
import { User, SystemCard, AppView, RolePermissions, Project, Deliverable } from './types';
import { db } from './firebase';
import ComplaintsView from './ComplaintsView';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

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
type DeliverableWithProject = Deliverable & { projectId: string; projectName: string };

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
  projects: Project[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SystemHub({
  currentUser, systemCards, onNavigate, onLogout, permissions, roleColor, projects,
}: SystemHubProps) {
  const firstName = currentUser.name.split(' ')[0];

  const [activeSection,   setActiveSection]   = useState<HubSection>('home');
  const [allDeliverables, setAllDeliverables] = useState<DeliverableWithProject[]>([]);
  const [delivLoading,    setDelivLoading]    = useState(false);
  const [viewerFile,      setViewerFile]      = useState<DeliverableWithProject | null>(null);

  // Fetch deliverables from all visible projects when tab opens
  useEffect(() => {
    if (activeSection !== 'deliverables') return;
    setDelivLoading(true);
    const fetchAll = async () => {
      const all: DeliverableWithProject[] = [];
      await Promise.all(
        projects.map(async (project) => {
          try {
            const snap = await getDocs(
              query(collection(db, 'projects', project.id, 'deliverables'), orderBy('uploadedAt', 'desc'))
            );
            snap.docs.forEach(d =>
              all.push({ id: d.id, projectId: project.id, projectName: project.name, ...d.data() } as DeliverableWithProject)
            );
          } catch {}
        })
      );
      // Sort newest first across all projects
      all.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      setAllDeliverables(all);
      setDelivLoading(false);
    };
    fetchAll();
  }, [activeSection, projects]);

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
      <header className="h-16 border-b border-white/10 px-8 flex items-center justify-between sticky top-0 z-50 bg-[#0a0510]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#ff00ff] rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-pink-500/20">W</div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#ff00ff] drop-shadow-[0_0_8px_rgba(255,0,255,0.4)]">Workflow Manager</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
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

      {/* ── Body: sidebar + content ── */}
      <div className="flex flex-1">

        {/* Sidebar */}
        <aside
          className="w-56 shrink-0 border-r border-white/8 sticky top-16 h-[calc(100vh-4rem)] flex flex-col py-6 overflow-y-auto"
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
        <main className="flex-1 overflow-y-auto">

          {/* HOME */}
          {activeSection === 'home' && (
            <>
              <div className="py-16 text-center px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">System Hub</p>
                <h2 className="text-4xl font-bold text-white mb-3">
                  Welcome back, <span style={{ color: roleColor }}>{firstName}</span>
                </h2>
                <p className="text-sm text-slate-400">Select a system to get started.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto px-8 pb-24">
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
            <div className="p-8 max-w-5xl mx-auto">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-1">Deliverables</h2>
                <p className="text-sm text-slate-400">All files uploaded across projects.</p>
              </div>

              {delivLoading ? (
                <div className="flex justify-center py-20">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ff00ff]" />
                </div>
              ) : allDeliverables.length === 0 ? (
                <div className="text-center py-20 text-slate-600 italic text-sm">
                  No deliverables uploaded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {allDeliverables.map(deliv => {
                    const type = getFileViewType(deliv.contentType, deliv.name);
                    const icon = getFileIcon(type, deliv.name);
                    return (
                      <div
                        key={`${deliv.projectId}-${deliv.id}`}
                        className="flex items-center gap-4 px-5 py-4 rounded-2xl border transition-all group"
                        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)')}
                      >
                        <span className="text-xl shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{deliv.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            <span className="text-slate-300 font-medium">{deliv.projectName}</span>
                            {' · '}{formatBytes(deliv.size)}
                            {' · '}{deliv.uploadedByName}
                            {' · '}{deliv.uploadedAt ? format(new Date(deliv.uploadedAt), 'MMM d, yyyy') : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => handleView(deliv)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                          >
                            {type === 'image' || type === 'video' ? 'View' : 'Open'}
                          </button>
                          <a
                            href={deliv.url}
                            download={deliv.name}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                          >
                            ↓
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* IT Admin FAB */}
      {permissions.access_it_admin && (
        <button
          onClick={() => onNavigate('it-admin')}
          className="fixed bottom-8 right-8 flex items-center gap-2 px-5 py-3 rounded-2xl text-white font-bold text-sm z-40 transition-opacity hover:opacity-90"
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
      className="glass-card rounded-3xl p-8 text-left group transition-all duration-300 hover:-translate-y-1 w-full relative overflow-hidden border border-white/10 hover:border-white/20"
    >
      <div
        className="absolute -bottom-6 -right-6 w-32 h-32 rounded-full blur-3xl opacity-15 group-hover:opacity-35 transition-all duration-300"
        style={{ backgroundColor: card.color_accent }}
      />
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 relative z-10 overflow-hidden"
        style={{ backgroundColor: card.color_accent + '20', border: `1px solid ${card.color_accent}40` }}
      >
        {card.icon.startsWith('http') || card.icon.startsWith('data:')
          ? <img src={card.icon} className="w-9 h-9 object-contain" alt={card.title} />
          : <span className="text-2xl">{card.icon}</span>
        }
      </div>
      <h3 className="text-lg font-bold mb-2 relative z-10 transition-opacity group-hover:opacity-90" style={{ color: card.color_accent }}>
        {card.title}
      </h3>
      <p className="text-sm text-slate-400 leading-relaxed relative z-10">{card.description}</p>
      <div className="mt-6 flex items-center gap-1.5 relative z-10">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
          {card.link_type === 'external' ? '↗ External' : '→ Open'}
        </span>
      </div>
    </button>
  );
}
