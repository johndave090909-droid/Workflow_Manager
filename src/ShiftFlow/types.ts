export type Semester = 'Winter' | 'Spring' | 'Summer' | 'Fall';

export type ShiftType = 'Morning' | 'Afternoon' | 'Night';

export interface Position {
  id: string;
  name: string;
  shiftType: ShiftType;
  days: number[];      // 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  startTime: string;
  endTime: string;
}

export interface Department {
  id: string;
  name: string;
  teamLeaderId?: string;
  positions: Position[];
}

export interface Unavailability {
  id: string;
  date: string;
  dayOfWeek?: number; // 0=Mon,1=Tue,2=Wed,3=Thu,4=Fri,5=Sat,6=Sun — set by AI extraction; if absent, blocks all days
  startTime: string;
  endTime: string;
  label?: string;
}

export interface Staff {
  id: string;
  name: string;
  idNumber?: string;
  departmentId: string;
  positionId: string;
  color: string;
  unavailability: Unavailability[];
  needsReview?: boolean;
  scheduleImageUrl?: string;
  /** When true, this worker is excluded from auto-scheduling (e.g. terminated, on leave) */
  excluded?: boolean;
}

export interface ShiftRequirement {
  type: ShiftType;
  startTime: string;
  endTime: string;
  staffNeeded: number;
  positionId?: string; // Optional: if specified, only staff in this position can fill the shift
}

export interface Assignment {
  id: string;
  staffId: string;
  date: string;
  shiftType: ShiftType;
}

export interface ScheduleState {
  semester: Semester;
  staff: Staff[];
  requirements: ShiftRequirement[];
  assignments: Assignment[];
}
