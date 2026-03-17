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
  startTime: string;
  endTime: string;
}

export interface Staff {
  id: string;
  name: string;
  departmentId: string;
  positionId: string;
  color: string;
  unavailability: Unavailability[];
  needsReview?: boolean;
  scheduleImageUrl?: string;
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
