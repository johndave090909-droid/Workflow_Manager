/**
 * ShiftFlow Scheduling Engine
 *
 * Pure rule-based algorithm — no external dependencies.
 * Used as the primary scheduler; Claude AI may post-process the result.
 */

import { Department, Staff, Position } from './types';

// ── Output types ──────────────────────────────────────────────────────────────

export type MatchType = 'pinned' | 'primary' | 'substitute';

export interface AssignmentDetail {
  positionId:  string;
  staffId:     string;
  matchType:   MatchType;
}

export interface UnassignedDetail {
  positionId:    string;
  departmentId:  string;
  departmentName: string;
  positionName:  string;
  reason:        string;
}

export interface SubstituteWarning {
  staffId:      string;
  staffName:    string;
  positionId:   string;
  positionName: string;
  reason:       string;  // why the primary was skipped
}

export interface BenchEntry {
  staffId:        string;
  staffName:      string;
  departmentId:   string;
  departmentName: string;
  positionName:   string; // their designated position name
}

export interface ScheduleResult {
  /** positionId → staffId  (ready to drop into weekSchedule) */
  assignments:       Record<string, string>;
  /** per-position detail (matchType, etc.) */
  assignmentDetails: Record<string, AssignmentDetail>;
  unassigned:        UnassignedDetail[];
  substituteWarnings: SubstituteWarning[];
  /** Workers with a department but no assigned position this run */
  bench:             BenchEntry[];
  stats: {
    total:      number;
    pinned:     number;
    primary:    number;
    substitute: number;
    unassigned: number;
    bench:      number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  const start1 = toMinutes(s1);
  const end1   = toMinutes(e1) === 0 ? 1440 : toMinutes(e1);
  const start2 = toMinutes(s2);
  const end2   = toMinutes(e2) === 0 ? 1440 : toMinutes(e2);
  return start1 < end2 && start2 < end1;
}

/**
 * Returns a human-readable conflict reason if the staff member is blocked
 * for the given position, or null if they are available.
 *
 * - Entries with a non-empty `date` field are date-specific (skipped here;
 *   handled by per-day scheduling).
 * - Entries with `dayOfWeek` block only that specific weekday.
 * - Entries without `dayOfWeek` block every day the position runs.
 */
export function isStaffBlocked(member: Staff, pos: Position): string | null {
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (const un of member.unavailability) {
    // Skip date-specific entries — those are handled in per-date scheduling
    if (un.date && un.date !== '') continue;

    const overlaps = timesOverlap(un.startTime, un.endTime, pos.startTime, pos.endTime);
    if (!overlaps) continue;

    if (un.dayOfWeek !== undefined) {
      if (pos.days.includes(un.dayOfWeek)) {
        const dayLabel = DAY_LABELS[un.dayOfWeek];
        const timeStr  = `${un.startTime}–${un.endTime}`;
        return un.label
          ? `Blocked ${dayLabel} (${un.label})`
          : `Blocked ${dayLabel} ${timeStr}`;
      }
    } else {
      // All-week block
      const timeStr = `${un.startTime}–${un.endTime}`;
      return un.label
        ? `Blocked all days (${un.label})`
        : `Blocked all days ${timeStr}`;
    }
  }
  return null;
}

// ── Core algorithm ────────────────────────────────────────────────────────────

/**
 * runScheduleAlgorithm
 *
 * Step 1 — Seed pinned assignments (manager-locked, untouched).
 * Step 2 — For each free position:
 *   a) Find the primary worker (staff.positionId === pos.id),
 *      check they are not blocked and not already used.
 *   b) If primary unavailable/used, find a substitute from the
 *      same department (first available, not used).
 *   c) If no one is available, mark unassigned.
 * Step 3 — Track `usedGlobal` to prevent any worker appearing twice.
 */
export function runScheduleAlgorithm(
  departments:      Department[],
  staff:            Staff[],
  pinnedAssignments: Record<string, string> = {},
): ScheduleResult {
  const assignmentDetails: Record<string, AssignmentDetail> = {};
  const unassigned:        UnassignedDetail[]               = [];
  const substituteWarnings: SubstituteWarning[]             = [];

  const pinnedPosIds  = new Set(Object.keys(pinnedAssignments));
  const usedGlobal    = new Set<string>(Object.values(pinnedAssignments));

  // ── Step 1: Seed pinned ───────────────────────────────────────────────────
  for (const [posId, staffId] of Object.entries(pinnedAssignments)) {
    assignmentDetails[posId] = { positionId: posId, staffId, matchType: 'pinned' };
  }

  let primaryCount    = 0;
  let substituteCount = 0;

  // ── Steps 2 & 3 ──────────────────────────────────────────────────────────
  for (const dept of departments) {
    // Dept staff used for substitute pass — workers explicitly in this department
    const deptStaff = staff.filter(s => s.departmentId === dept.id);

    for (const pos of dept.positions) {
      if (pinnedPosIds.has(pos.id)) continue;

      // ── a) Primary pass ──────────────────────────────────────────────────
      // Search ALL staff for the designated worker (positionId match),
      // regardless of whether their departmentId is set correctly.
      // This ensures workers with the right qualification are found even if
      // their department field hasn't been configured yet.
      const primary = staff.find(s =>
        s.positionId === pos.id &&
        !usedGlobal.has(s.id)  &&
        isStaffBlocked(s, pos) === null,
      );

      if (primary) {
        assignmentDetails[pos.id] = { positionId: pos.id, staffId: primary.id, matchType: 'primary' };
        usedGlobal.add(primary.id);
        primaryCount++;
        continue;
      }

      // Diagnose why the primary was skipped (for substitution warning)
      const designatedPrimary = staff.find(s => s.positionId === pos.id);
      if (designatedPrimary) {
        const blockReason = isStaffBlocked(designatedPrimary, pos);
        substituteWarnings.push({
          staffId:      designatedPrimary.id,
          staffName:    designatedPrimary.name,
          positionId:   pos.id,
          positionName: pos.name,
          reason:       blockReason
            ?? (usedGlobal.has(designatedPrimary.id) ? 'Already assigned to another position' : 'Unknown conflict'),
        });
      }

      // ── b) Substitute pass ───────────────────────────────────────────────
      // Use any available worker from the same department who isn't blocked.
      // If no dept workers are available, fall back to any unblocked staff.
      const sub =
        deptStaff.find(s => !usedGlobal.has(s.id) && isStaffBlocked(s, pos) === null) ??
        staff.find(s => !usedGlobal.has(s.id) && isStaffBlocked(s, pos) === null);

      if (sub) {
        assignmentDetails[pos.id] = { positionId: pos.id, staffId: sub.id, matchType: 'substitute' };
        usedGlobal.add(sub.id);
        substituteCount++;
        continue;
      }

      // ── c) Unassigned ────────────────────────────────────────────────────
      unassigned.push({
        positionId:     pos.id,
        departmentId:   dept.id,
        departmentName: dept.name,
        positionName:   pos.name,
        reason: staff.length === 0
          ? 'No staff in the system'
          : 'All eligible staff are unavailable or already assigned',
      });
    }
  }

  // ── Build final positionId → staffId map ─────────────────────────────────
  const assignments: Record<string, string> = {};
  for (const [posId, detail] of Object.entries(assignmentDetails)) {
    assignments[posId] = detail.staffId;
  }

  // ── Bench: staff with a department but not scheduled this run ─────────────
  const bench: BenchEntry[] = staff
    .filter(s => s.departmentId && !usedGlobal.has(s.id))
    .map(s => {
      const dept      = departments.find(d => d.id === s.departmentId);
      const pos       = dept?.positions.find(p => p.id === s.positionId);
      return {
        staffId:        s.id,
        staffName:      s.name,
        departmentId:   s.departmentId,
        departmentName: dept?.name ?? 'Unknown',
        positionName:   pos?.name  ?? 'Unassigned',
      };
    });

  return {
    assignments,
    assignmentDetails,
    unassigned,
    substituteWarnings,
    bench,
    stats: {
      total:      Object.keys(assignmentDetails).length + unassigned.length,
      pinned:     Object.keys(pinnedAssignments).length,
      primary:    primaryCount,
      substitute: substituteCount,
      unassigned: unassigned.length,
      bench:      bench.length,
    },
  };
}
