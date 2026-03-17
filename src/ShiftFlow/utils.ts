import { Staff, ShiftRequirement, Assignment, Semester, ShiftType } from './types';

const isTimeOverlapping = (s1: string, e1: string, s2: string, e2: string) => {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  let start1 = toMinutes(s1);
  let end1 = toMinutes(e1);
  let start2 = toMinutes(s2);
  let end2 = toMinutes(e2);

  if (end1 <= start1) end1 += 24 * 60;
  if (end2 <= start2) end2 += 24 * 60;

  return start1 < end2 && start2 < end1;
};

export const generateSchedule = (
  staff: Staff[],
  requirements: ShiftRequirement[],
  days: string[]
): Assignment[] => {
  const assignments: Assignment[] = [];
  
  // 1. Pre-determine which staff members are assigned to which shifts
  // This ensures the schedule is the "same everyday"
  const shiftAssignments: Record<string, string[]> = {};
  const usedStaffIds = new Set<string>();
  
  // Shuffle staff to ensure variety across different generation runs
  const shuffledStaff = [...staff].sort(() => Math.random() - 0.5);

  requirements.forEach(req => {
    shiftAssignments[req.type] = [];
    let foundCount = 0;
    
    for (const member of shuffledStaff) {
      if (foundCount >= req.staffNeeded) break;
      
      // Check if staff matches position and isn't already assigned to a shift pattern
      const matchesPosition = !req.positionId || member.positionId === req.positionId;
      const isAvailableForPattern = !usedStaffIds.has(member.id);
      
      if (matchesPosition && isAvailableForPattern) {
        shiftAssignments[req.type].push(member.id);
        usedStaffIds.add(member.id);
        foundCount++;
      }
    }
  });

  // 2. Apply the pre-determined assignments to every day
  days.forEach(date => {
    requirements.forEach(req => {
      const assignedStaffIds = shiftAssignments[req.type] || [];
      
      assignedStaffIds.forEach(staffId => {
        const member = staff.find(s => s.id === staffId);
        if (!member) return;

        // Check if staff is unavailable on this specific date/time
        const isUnavailable = member.unavailability.some(un => {
          if (un.date !== date) return false;
          return isTimeOverlapping(un.startTime, un.endTime, req.startTime, req.endTime);
        });

        if (!isUnavailable) {
          assignments.push({
            id: Math.random().toString(36).substr(2, 9),
            staffId: member.id,
            date,
            shiftType: req.type
          });
        }
      });
    });
  });
  
  return assignments;
};

export const getSemesterDates = (semester: Semester, year: number = 2025): string[] => {
  const dates: string[] = [];
  let startMonth = 0;
  let endMonth = 2;

  switch (semester) {
    case 'Winter': startMonth = 0; endMonth = 2; break;
    case 'Spring': startMonth = 3; endMonth = 5; break;
    case 'Summer': startMonth = 6; endMonth = 8; break;
    case 'Fall': startMonth = 9; endMonth = 11; break;
  }

  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, endMonth + 1, 0);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }

  return dates;
};
