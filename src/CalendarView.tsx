import React, { useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { EventDropArg } from '@fullcalendar/core';
import { format, addDays, parseISO } from 'date-fns';
import { Project, ProjectStatus, Department } from './types';

const DEPT_COLORS: Record<Department, string> = {
  Personal: '#ff00ff',
  Business: '#00ffff',
  Finance: '#ffd700',
  Health: '#ff4d4d',
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  'Not Started': '○',
  'In Progress': '◑',
  'On Hold': '⏸',
  'Done': '✓',
};

interface CalendarViewProps {
  projects: Project[];
  currentUserId: string;
  onDateChange: (projectId: string, newStart: string, newEnd: string) => Promise<void>;
  onProjectClick?: (project: Project) => void;
  readOnly?: boolean;
  unreadCounts?: Record<string, number>;
}

export default function CalendarView({ projects, currentUserId: _currentUserId, onDateChange, onProjectClick, readOnly = false, unreadCounts = {} }: CalendarViewProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const [tooltip, setTooltip] = useState<{ project: Project; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Each project appears only on its due date (end_date) as a single-day event
  const events = projects
    .filter(p => p.end_date)
    .map(p => {
      const isDone = p.status === 'Done';
      return {
        id: String(p.id),
        title: p.name,
        start: p.end_date,
        allDay: true,
        backgroundColor: isDone ? '#374151' : DEPT_COLORS[p.department],
        borderColor:     isDone ? '#374151' : DEPT_COLORS[p.department],
        textColor:       isDone ? '#9ca3af' : '#0a0510',
        classNames:      isDone ? ['fc-event-done'] : [],
        extendedProps: { project: p },
      };
    });

  // When dragged, the new due date is wherever it was dropped
  const handleEventDrop = async (info: EventDropArg) => {
    const project: Project = info.event.extendedProps.project;
    const newEnd = info.event.startStr.slice(0, 10);
    // Keep start_date unchanged, only update the due date
    try {
      await onDateChange(project.id, project.start_date, newEnd);
    } catch {
      info.revert();
    }
  };

  // Resize not meaningful for single-day events — no-op
  const handleEventResize = async (info: EventResizeDoneArg) => {
    info.revert();
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <style>{`
        /* FullCalendar dark neon overrides */
        .fc {
          --fc-border-color: rgba(255,255,255,0.08);
          --fc-page-bg-color: #0a0510;
          --fc-neutral-bg-color: rgba(255,255,255,0.03);
          --fc-neutral-text-color: #94a3b8;
          --fc-today-bg-color: rgba(255,0,255,0.07);
          --fc-highlight-color: rgba(255,0,255,0.15);
          --fc-event-border-color: transparent;
          --fc-event-text-color: #0a0510;
          --fc-button-bg-color: rgba(255,255,255,0.05);
          --fc-button-border-color: rgba(255,255,255,0.12);
          --fc-button-hover-bg-color: rgba(255,0,255,0.15);
          --fc-button-hover-border-color: rgba(255,0,255,0.4);
          --fc-button-active-bg-color: #ff00ff;
          --fc-button-active-border-color: #ff00ff;
          --fc-button-text-color: #fff;
          font-family: inherit;
        }
        .fc-theme-standard td, .fc-theme-standard th {
          border-color: rgba(255,255,255,0.08);
        }
        .fc-col-header-cell {
          background: rgba(255,255,255,0.02);
          padding: 10px 0;
        }
        .fc-col-header-cell-cushion {
          color: #94a3b8 !important;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          text-decoration: none !important;
        }
        .fc-daygrid-day-number {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          text-decoration: none !important;
          padding: 6px 10px;
        }
        .fc-day-today .fc-daygrid-day-number {
          color: #ff00ff;
          background: rgba(255,0,255,0.15);
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .fc-day-today {
          background: rgba(255,0,255,0.04) !important;
        }
        .fc-toolbar-title {
          color: #fff;
          font-size: 1.25rem !important;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .fc-button {
          border-radius: 10px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          letter-spacing: 0.05em !important;
          text-transform: uppercase !important;
          padding: 6px 14px !important;
          transition: all 0.2s !important;
          backdrop-filter: blur(8px);
        }
        .fc-button:focus {
          box-shadow: none !important;
        }
        .fc-button-active, .fc-button-active:hover {
          background: #ff00ff !important;
          border-color: #ff00ff !important;
          box-shadow: 0 0 16px rgba(255,0,255,0.4) !important;
        }
        .fc-event {
          border-radius: 6px !important;
          border: none !important;
          padding: 2px 6px !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          cursor: grab !important;
          transition: opacity 0.15s, transform 0.15s !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
        }
        .fc-event:hover {
          opacity: 0.9;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
        }
        .fc-event.fc-event-dragging {
          cursor: grabbing !important;
          opacity: 0.75 !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
        }
        .fc-event-mirror {
          transition: none !important;
          transform: none !important;
        }
        .fc-event-resizer {
          width: 8px !important;
        }
        .fc-daygrid-day-events {
          padding: 2px 4px;
        }
        .fc-daygrid-more-link {
          color: #ff00ff !important;
          font-size: 10px;
          font-weight: 700;
        }
        .fc-daygrid-event-dot {
          display: none;
        }
        .fc-popover {
          background: #1a1025 !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          border-radius: 16px !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5) !important;
        }
        .fc-popover-header {
          background: rgba(255,255,255,0.05) !important;
          color: #fff !important;
          border-radius: 16px 16px 0 0 !important;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .fc-popover-close {
          color: #94a3b8 !important;
        }
        .fc-scrollgrid {
          border-radius: 16px;
          overflow: hidden;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .fc-daygrid-day-frame {
          min-height: 110px;
        }
        .fc-event-done {
          opacity: 0.45 !important;
        }
      `}</style>

      {/* Tooltip */}
      {tooltip && !dragging && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="bg-[#1a1025] border border-white/10 rounded-2xl p-4 shadow-2xl min-w-[220px]">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-white text-sm">{tooltip.project.name}</p>
              {(unreadCounts[tooltip.project.id] ?? 0) > 0 && (
                <span className="ml-2 text-[9px] font-black text-[#ff00ff] bg-[#ff00ff]/15 border border-[#ff00ff]/30 rounded-full px-2 py-0.5">
                  {unreadCounts[tooltip.project.id]} new msg{unreadCounts[tooltip.project.id] !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                {STATUS_LABEL[tooltip.project.status]} {tooltip.project.status}
              </p>
              <p className="text-[10px] text-slate-400">
                <span className="text-slate-500">Owner:</span> {tooltip.project.assignee_names?.join(', ') ?? tooltip.project.account_lead_name}
              </p>
              <p className="text-[10px] text-slate-400">
                <span className="text-slate-500">Priority:</span> {tooltip.project.priority}
              </p>
              <p className="text-[10px] text-slate-400">
                <span className="text-slate-500">Dept:</span> {tooltip.project.department}
              </p>
              {tooltip.project.start_date && (
                <p className="text-[10px] text-slate-400">
                  <span className="text-slate-500">Start:</span> {tooltip.project.start_date}
                </p>
              )}
              {tooltip.project.end_date && (
                <p className="text-[10px] text-slate-400">
                  <span className="text-slate-500">End:</span> {tooltip.project.end_date}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className="glass-card rounded-3xl overflow-hidden border border-white/10 p-6"
        style={{ background: 'rgba(10,5,16,0.8)' }}
      >
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek',
          }}
          events={events}
          editable={!readOnly}
          droppable={!readOnly}
          eventResizableFromStart={false}
          eventDurationEditable={false}
          eventStartEditable={!readOnly}
          dragScroll={true}
          longPressDelay={150}
          eventLongPressDelay={150}
          dragRevertDuration={200}
          dayMaxEvents={4}
          height="auto"
          eventDrop={!readOnly ? handleEventDrop : undefined}
          eventResize={!readOnly ? handleEventResize : undefined}
          eventReceive={!readOnly ? (info) => {
            // External drag from the Master Account Table
            const projectId = info.event.extendedProps.projectId as string;
            const project = projects.find(p => p.id === projectId);
            const newEnd = info.event.startStr.slice(0, 10);
            info.event.remove(); // remove temp event; fetchData will re-add it properly
            if (project) onDateChange(project.id, project.start_date, newEnd);
          } : undefined}
          eventClick={(info) => {
            const project: Project = info.event.extendedProps.project;
            if (project && onProjectClick) onProjectClick(project);
          }}
          eventDragStart={!readOnly ? () => {
            if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
            setDragging(true);
            setTooltip(null);
          } : undefined}
          eventDragStop={!readOnly ? () => { setDragging(false); } : undefined}
          eventMouseEnter={(info) => {
            const project: Project = info.event.extendedProps.project;
            if (!project) return;
            const rect = info.el.getBoundingClientRect();
            if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
            tooltipTimeout.current = setTimeout(() => {
              if (!dragging) setTooltip({ project, x: rect.left, y: rect.top });
            }, 1400);
          }}
          eventMouseLeave={() => {
            if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
            setTooltip(null);
          }}
          eventContent={(arg) => {
            const project: Project = arg.event.extendedProps.project;
            if (!project) return <span className="truncate text-[11px] font-bold px-1">{arg.event.title}</span>;
            const unread = unreadCounts[project.id] ?? 0;
            const isDone = project.status === 'Done';
            return (
              <div className="flex flex-col px-1 overflow-hidden w-full leading-tight">
                <div className="flex items-center gap-1 w-full">
                  <span className="text-[10px] opacity-70 shrink-0">{STATUS_LABEL[project.status]}</span>
                  <span className={`truncate text-[11px] font-bold flex-1 min-w-0 ${isDone ? 'line-through' : ''}`}>{arg.event.title}</span>
                  {project.is_time_critical && <span className="text-[9px] shrink-0">⚡</span>}
                  {unread > 0 && (
                    <span
                      style={{
                        background: 'rgba(10,5,16,0.85)',
                        color: '#ff00ff',
                        fontSize: '8px',
                        fontWeight: 900,
                        minWidth: '15px',
                        height: '15px',
                        borderRadius: '99px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 3px',
                        border: '1.5px solid #ff00ff',
                        flexShrink: 0,
                      }}
                    >
                      {unread}
                    </span>
                  )}
                </div>
                {project.account_lead_name && (
                  <span className="truncate text-[9px] opacity-55 pl-3">{project.account_lead_name}</span>
                )}
              </div>
            );
          }}
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 px-2">
        {(Object.entries(DEPT_COLORS) as [Department, string][]).map(([dept, color]) => (
          <div key={dept} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{dept}</span>
          </div>
        ))}
        {!readOnly && <span className="text-[10px] text-slate-600 ml-auto italic">Drag from table or within calendar to change due date</span>}
        {readOnly && <span className="text-[10px] text-slate-600 ml-auto italic">View only — contact your Director to change dates</span>}
      </div>
    </div>
  );
}
