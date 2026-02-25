export interface User {
  id: string;        // Firebase UID
  name: string;
  role: string;      // matches a Role.name in the /roles collection
  photo: string;
  email: string;
}

export interface RolePermissions {
  access_tracker:    boolean;  // Can open Project Tracker
  access_it_admin:   boolean;  // Can open IT Admin panel
  view_all_projects: boolean;  // Sees all projects (not just own)
  create_projects:   boolean;  // Can create new projects
  edit_projects:     boolean;  // Can edit project dates/details
  view_workload:     boolean;  // Can see workload chart
  is_assignable:     boolean;  // Appears in project assignment & workload chart
}

export interface Role {
  id: string;                  // Firestore document ID
  name: string;                // e.g. 'Director', 'Office Admin', 'IT Admin'
  color: string;               // hex accent color, e.g. '#ff00ff'
  permissions: RolePermissions;
}

export type ProjectStatus   = 'On Hold' | 'In Progress' | 'Not Started' | 'Done';
export type ProjectPriority = 'High' | 'Medium' | 'Low';
export type Department      = 'Personal' | 'Business' | 'Finance' | 'Health';

export interface Project {
  id: string;        // Firestore document ID
  name: string;
  account_lead_id: string;
  account_lead_name: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  department: Department;
  start_date: string;
  end_date: string;
  directors_note: string | null;
  is_priority_focus: boolean;
  is_time_critical: boolean;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  completed: boolean;
}

export interface Message {
  id: string;
  project_id: string;
  sender_id: string;
  sender_name: string;
  sender_photo: string;
  sender_role: string;
  content: string;
  timestamp: string;   // ISO string
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string;
  user_name: string;
  action: string;
  details: string;
}

export interface Deliverable {
  id: string;
  name: string;           // original filename
  url: string;            // Firebase Storage download URL
  contentType: string;    // MIME type
  size: number;           // bytes
  uploadedBy: string;     // user ID
  uploadedByName: string;
  uploadedAt: string;     // ISO string
  storagePath: string;    // path in Firebase Storage (used for deletion)
}

export type AppView = 'hub' | 'tracker' | 'it-admin' | 'workflow' | 'workers';

export interface SystemCard {
  id: string;        // Firestore document ID
  title: string;
  description: string;
  icon: string;
  color_accent: string;
  link: string;
  link_type: 'internal' | 'external';
  is_active: boolean;
  is_view_only: boolean;
  sort_order: number;
}
