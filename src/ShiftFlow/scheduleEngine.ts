/**
 * ShiftFlow Scheduling Engine
 *
 * Maximum bipartite matching via augmenting paths (three-pass).
 *
 * The scheduler builds a bipartite graph:
 *   Left  nodes — free positions (not pinned, have a time set)
 *   Right nodes — free staff    (not pinned, not excluded)
 *
 * Each edge carries a priority tier:
 *   Tier 0 — Primary   (staff.positionId === pos.id)
 *   Tier 1 — Dept-sub  (same department, any position)
 *   Tier 2 — Cross-sub (any department)
 *   (blocked by unavailability = no edge)
 *
 * Passes run in order [0 → 1 → 2].  Each pass augments only previously
 * unmatched positions but the DFS can traverse *any already-matched* pair
 * within the allowed tier, enabling the Person-A / Person-B swap described
 * in the problem statement.  This guarantees a maximum-cardinality matching
 * while honouring the primary > dept-sub > cross-sub preference.
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
  positionId:     string;
  departmentId:   string;
  departmentName: string;
  positionName:   string;
  reason:         string;
}

export interface SubstituteWarning {
  staffId:      string;
  staffName:    string;
  positionId:   string;
  positionName: string;
  reason:       string;
}

export interface BenchEntry {
  staffId:        string;
  staffName:      string;
  departmentId:   string;
  departmentName: string;
  positionName:   string;
}

export interface ScheduleResult {
  /** positionId → staffId */
  assignments:        Record<string, string>;
  assignmentDetails:  Record<string, AssignmentDetail>;
  unassigned:         UnassignedDetail[];
  substituteWarnings: SubstituteWarning[];
  bench:              BenchEntry[];
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
 */
export function isStaffBlocked(member: Staff, pos: Position): string | null {
  if (!pos.startTime || !pos.endTime) return null;

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (const un of member.unavailability) {
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
      const timeStr = `${un.startTime}–${un.endTime}`;
      return un.label
        ? `Blocked all days (${un.label})`
        : `Blocked all days ${timeStr}`;
    }
  }
  return null;
}

// ── Bipartite matching ────────────────────────────────────────────────────────

/**
 * Returns the priority tier of the edge between position `pi` and staff `si`,
 * or Infinity when the staff member is blocked for that position.
 *
 *   0 — primary   (staff.positionId === pos.id)
 *   1 — dept-sub  (same department)
 *   2 — cross-sub (any other department)
 */
function computeTier(
  s:    Staff,
  pos:  Position,
  dept: Department,
): number {
  if (isStaffBlocked(s, pos) !== null) return Infinity;
  if (s.positionId === pos.id)         return 0;
  if (s.departmentId === dept.id)      return 1;
  return 2;
}

/**
 * Augmenting-path DFS for bipartite matching.
 *
 * @param pi        Position index to try matching.
 * @param maxTier   Only traverse edges with tier <= maxTier.
 * @param visited   Per-DFS visited flags for staff nodes (prevents cycles).
 * @param matchStaff  Current matching: staffIdx → posIdx (-1 = unmatched).
 * @param matchPos    Current matching: posIdx → staffIdx (-1 = unmatched).
 * @param tiers     Pre-computed tier matrix [posIdx][staffIdx].
 */
function tryAugment(
  pi:         number,
  maxTier:    number,
  visited:    Uint8Array,
  matchStaff: Int32Array,
  matchPos:   Int32Array,
  tiers:      number[][],
): boolean {
  const row = tiers[pi];
  for (let si = 0; si < row.length; si++) {
    if (row[si] > maxTier)  continue; // edge not allowed at this tier
    if (visited[si])        continue;
    visited[si] = 1;

    // Staff si is free, or their current position can be re-routed
    if (
      matchStaff[si] === -1 ||
      tryAugment(matchStaff[si], maxTier, visited, matchStaff, matchPos, tiers)
    ) {
      matchPos[pi]   = si;
      matchStaff[si] = pi;
      return true;
    }
  }
  return false;
}

// ── Core algorithm ────────────────────────────────────────────────────────────

export function runScheduleAlgorithm(
  departments:       Department[],
  staff:             Staff[],
  pinnedAssignments: Record<string, string> = {},
): ScheduleResult {
  const assignmentDetails: Record<string, AssignmentDetail> = {};
  const unassigned:        UnassignedDetail[]               = [];
  const substituteWarnings: SubstituteWarning[]             = [];

  const pinnedPosIds   = new Set(Object.keys(pinnedAssignments));
  const pinnedStaffIds = new Set(Object.values(pinnedAssignments));

  // ── Step 1: Seed pinned assignments (untouched by matching) ───────────────
  for (const [posId, staffId] of Object.entries(pinnedAssignments)) {
    assignmentDetails[posId] = { positionId: posId, staffId, matchType: 'pinned' };
  }

  // ── Step 2: Collect free positions and staff ──────────────────────────────
  const freePositions: { pos: Position; dept: Department }[] = [];
  for (const dept of departments) {
    for (const pos of dept.positions) {
      if (pinnedPosIds.has(pos.id))     continue; // manager-locked
      if (!pos.startTime || !pos.endTime) continue; // no time set — excluded
      freePositions.push({ pos, dept });
    }
  }

  // Excluded staff are filtered before this function is called, but guard anyway.
  const freeStaff = staff.filter(s => !pinnedStaffIds.has(s.id) && !s.excluded);

  const numPos   = freePositions.length;
  const numStaff = freeStaff.length;

  if (numPos === 0) {
    return finalise(
      assignmentDetails, unassigned, substituteWarnings,
      freeStaff, staff, departments, pinnedAssignments, 0, 0,
    );
  }

  if (numStaff === 0) {
    for (const { pos, dept } of freePositions) {
      unassigned.push({
        positionId:     pos.id,
        departmentId:   dept.id,
        departmentName: dept.name,
        positionName:   pos.name,
        reason:         'No staff in the system',
      });
    }
    return finalise(
      assignmentDetails, unassigned, substituteWarnings,
      freeStaff, staff, departments, pinnedAssignments, 0, 0,
    );
  }

  // ── Step 3: Pre-compute tier matrix ──────────────────────────────────────
  const tiers: number[][] = freePositions.map(({ pos, dept }) =>
    freeStaff.map(s => computeTier(s, pos, dept)),
  );

  // ── Step 4: Three-pass augmenting-path matching ───────────────────────────
  // matchPos[pi]   = si  or -1
  // matchStaff[si] = pi  or -1
  const matchPos   = new Int32Array(numPos).fill(-1);
  const matchStaff = new Int32Array(numStaff).fill(-1);

  for (const maxTier of [0, 1, 2]) {
    for (let pi = 0; pi < numPos; pi++) {
      if (matchPos[pi] !== -1) continue; // already matched in a previous pass
      tryAugment(pi, maxTier, new Uint8Array(numStaff), matchStaff, matchPos, tiers);
    }
  }

  // ── Step 5: Collect results ───────────────────────────────────────────────
  let primaryCount    = 0;
  let substituteCount = 0;

  for (let pi = 0; pi < numPos; pi++) {
    const { pos, dept } = freePositions[pi];

    if (matchPos[pi] === -1) {
      // Unassigned — emit a substitute warning if there was a designated primary
      const designatedPrimary = staff.find(s => s.positionId === pos.id);
      if (designatedPrimary) {
        const blockReason = isStaffBlocked(designatedPrimary, pos);
        substituteWarnings.push({
          staffId:      designatedPrimary.id,
          staffName:    designatedPrimary.name,
          positionId:   pos.id,
          positionName: pos.name,
          reason:
            blockReason ??
            (pinnedStaffIds.has(designatedPrimary.id)
              ? 'Pinned to another position'
              : 'All eligible staff are unavailable or already assigned'),
        });
      }
      unassigned.push({
        positionId:     pos.id,
        departmentId:   dept.id,
        departmentName: dept.name,
        positionName:   pos.name,
        reason:         'All eligible staff are unavailable or already assigned',
      });
      continue;
    }

    const member    = freeStaff[matchPos[pi]];
    const isPrimary = member.positionId === pos.id;

    // Substitute warning only when the primary is genuinely blocked (not just
    // optimally swapped to another position — that is expected and desired).
    if (!isPrimary) {
      const designatedPrimary = staff.find(s => s.positionId === pos.id);
      if (designatedPrimary) {
        const blockReason = isStaffBlocked(designatedPrimary, pos);
        if (blockReason) {
          substituteWarnings.push({
            staffId:      designatedPrimary.id,
            staffName:    designatedPrimary.name,
            positionId:   pos.id,
            positionName: pos.name,
            reason:       blockReason,
          });
        }
        // Primary swapped away to maximise coverage — no warning (intentional).
      }
    }

    const matchType: MatchType = isPrimary ? 'primary' : 'substitute';
    assignmentDetails[pos.id]  = { positionId: pos.id, staffId: member.id, matchType };

    if (isPrimary) primaryCount++;
    else           substituteCount++;
  }

  return finalise(
    assignmentDetails, unassigned, substituteWarnings,
    freeStaff, staff, departments, pinnedAssignments,
    primaryCount, substituteCount,
  );
}

// ── Result builder ────────────────────────────────────────────────────────────

function finalise(
  assignmentDetails:  Record<string, AssignmentDetail>,
  unassigned:         UnassignedDetail[],
  substituteWarnings: SubstituteWarning[],
  freeStaff:          Staff[],
  allStaff:           Staff[],
  departments:        Department[],
  pinnedAssignments:  Record<string, string>,
  primaryCount:       number,
  substituteCount:    number,
): ScheduleResult {
  const assignments: Record<string, string> = {};
  for (const [posId, detail] of Object.entries(assignmentDetails)) {
    assignments[posId] = detail.staffId;
  }

  const usedStaffIds = new Set(Object.values(assignments));

  const bench: BenchEntry[] = allStaff
    .filter(s => s.departmentId && !usedStaffIds.has(s.id))
    .map(s => {
      const dept = departments.find(d => d.id === s.departmentId);
      const pos  = dept?.positions.find(p => p.id === s.positionId);
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
