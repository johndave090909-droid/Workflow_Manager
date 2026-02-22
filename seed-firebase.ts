/**
 * seed-firebase.ts  —  One-time data seed for the Workflow Manager Firebase project.
 *
 * Run:  npx tsx seed-firebase.ts
 *
 * What it does:
 *   1. Creates Firebase Auth accounts for the initial users
 *   2. Writes user profiles to /users/{uid}
 *   3. Writes system cards to /system_cards
 *   4. Writes sample projects to /projects
 *
 * Uses only the Firebase REST APIs — no service account needed.
 * Re-running is safe: existing Auth accounts are detected and reused.
 */

const API_KEY    = 'AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg';
const PROJECT_ID = 'systems-hub';

const AUTH_BASE = `https://identitytoolkit.googleapis.com/v1/accounts`;
const FS_BASE   = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Auth helpers ────────────────────────────────────────────────────────────

async function createAuthUser(email: string, password: string): Promise<string> {
  const res  = await fetch(`${AUTH_BASE}:signUp?key=${API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    if (data.error?.message === 'EMAIL_EXISTS') {
      console.log(`    ↩  ${email} already exists — reusing`);
      return signInGetUid(email, password);
    }
    throw new Error(`createAuthUser(${email}): ${data.error?.message}`);
  }
  return data.localId as string;
}

async function signInGetUid(email: string, password: string): Promise<string> {
  const data = await signIn(email, password);
  return data.localId as string;
}

async function signInGetToken(email: string, password: string): Promise<string> {
  const data = await signIn(email, password);
  return data.idToken as string;
}

async function signIn(email: string, password: string): Promise<any> {
  const res  = await fetch(`${AUTH_BASE}:signInWithPassword?key=${API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(`signIn(${email}): ${data.error?.message}`);
  return data;
}

// ─── Firestore helpers ───────────────────────────────────────────────────────

function toFirestoreValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')         return { stringValue: v };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date)             return { timestampValue: v.toISOString() };
  if (typeof v === 'object')         return { mapValue: { fields: toFirestoreFields(v as Record<string, unknown>) } };
  throw new Error(`Unsupported value type: ${typeof v} (${JSON.stringify(v)})`);
}

function toFirestoreFields(obj: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, toFirestoreValue(v)])
  );
}

async function fsSet(docPath: string, data: Record<string, unknown>, token: string) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const e = await res.json() as any;
    throw new Error(`fsSet(${docPath}): ${e.error?.message}`);
  }
}

async function fsAdd(collection: string, data: Record<string, unknown>, token: string): Promise<string> {
  const res = await fetch(`${FS_BASE}/${collection}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const e = await res.json() as any;
    throw new Error(`fsAdd(${collection}): ${e.error?.message}`);
  }
  const d = await res.json() as any;
  return d.name.split('/').pop() as string;
}

// ─── Seed definitions ────────────────────────────────────────────────────────

const ROLES = [
  {
    name: 'Director',
    color: '#ff00ff',
    permissions: {
      access_tracker:    true,
      access_it_admin:   false,
      view_all_projects: true,
      create_projects:   true,
      edit_projects:     true,
      view_workload:     true,
      is_assignable:     false,
    },
  },
  {
    name: 'Admin',
    color: '#00ffff',
    permissions: {
      access_tracker:    true,
      access_it_admin:   false,
      view_all_projects: false,
      create_projects:   false,
      edit_projects:     false,
      view_workload:     false,
      is_assignable:     true,
    },
  },
  {
    name: 'IT Admin',
    color: '#a855f7',
    permissions: {
      access_tracker:    false,
      access_it_admin:   true,
      view_all_projects: false,
      create_projects:   false,
      edit_projects:     false,
      view_workload:     false,
      is_assignable:     false,
    },
  },
];

const USERS = [
  { email: 'sarah@company.com', password: 'Password123!', name: 'Sarah', role: 'Director', photo: 'https://picsum.photos/seed/sarah/100/100' },
  { email: 'james@company.com', password: 'Password123!', name: 'James', role: 'Admin',    photo: 'https://picsum.photos/seed/james/100/100' },
  { email: 'maria@company.com', password: 'Password123!', name: 'Maria', role: 'Admin',    photo: 'https://picsum.photos/seed/maria/100/100' },
  { email: 'alex@company.com',  password: 'Password123!', name: 'Alex',  role: 'IT Admin', photo: 'https://picsum.photos/seed/alex/100/100'  },
];

const SYSTEM_CARDS = [
  { title: 'Project Tracker',   description: 'Manage projects, tasks, timelines and team workload.',       icon: '📋', color_accent: '#ff00ff', link: 'tracker',                    link_type: 'internal', is_active: true, sort_order: 1 },
  { title: 'Document Vault',    description: 'Centralized storage for all company documents and SOPs.',    icon: '📁', color_accent: '#00ffff', link: 'https://drive.google.com',    link_type: 'external', is_active: true, sort_order: 2 },
  { title: 'HR Portal',         description: 'Employee records, leave requests, and onboarding tools.',    icon: '👥', color_accent: '#ffd700', link: 'https://example.com/hr',      link_type: 'external', is_active: true, sort_order: 3 },
  { title: 'Finance Dashboard', description: 'Budget tracking, expense reports, and invoicing.',           icon: '💰', color_accent: '#ff4d4d', link: 'https://example.com/finance', link_type: 'external', is_active: true, sort_order: 4 },
  { title: 'IT Support Desk',   description: 'Submit tickets, track requests, access the knowledge base.', icon: '🛠', color_accent: '#a855f7', link: 'https://example.com/itdesk',  link_type: 'external', is_active: true, sort_order: 5 },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding Firebase — project:', PROJECT_ID, '\n');

  // 1. Create Auth accounts
  console.log('Step 1 — Creating Auth accounts...');
  const uids: Record<string, string> = {};
  for (const u of USERS) {
    const uid     = await createAuthUser(u.email, u.password);
    uids[u.email] = uid;
    console.log(`    ✓  ${u.name.padEnd(8)} ${u.role.padEnd(10)} ${uid}`);
  }

  // 2. Get a write token (sign in as Director)
  console.log('\nStep 2 — Signing in as Director for Firestore writes...');
  const token = await signInGetToken('sarah@company.com', 'Password123!');
  console.log('    ✓  Token acquired');

  // 3. Write user profiles
  console.log('\nStep 3 — Writing user profiles to /users...');
  for (const u of USERS) {
    await fsSet(`users/${uids[u.email]}`, {
      name:  u.name,
      role:  u.role,
      email: u.email,
      photo: u.photo,
    }, token);
    console.log(`    ✓  /users/${uids[u.email]}  (${u.name})`);
  }

  // 4. Write default roles
  console.log('\nStep 4 — Writing default roles to /roles...');
  for (const role of ROLES) {
    const id = await fsAdd('roles', role as unknown as Record<string, unknown>, token);
    console.log(`    ✓  ${role.name.padEnd(12)} ${id}`);
  }

  // 5. Write system cards
  console.log('\nStep 5 — Writing system cards to /system_cards...');
  for (const card of SYSTEM_CARDS) {
    const id = await fsAdd('system_cards', card as unknown as Record<string, unknown>, token);
    console.log(`    ✓  ${card.title.padEnd(22)} ${id}`);
  }

  // 6. Write sample projects (assigned to James and Maria)
  console.log('\nStep 6 — Writing sample projects to /projects...');
  const jamesId = uids['james@company.com'];
  const mariaId = uids['maria@company.com'];
  const now = new Date();

  const PROJECTS: Array<Record<string, unknown>> = [
    {
      name:               'Q1 Budget Review',
      account_lead_id:    jamesId,
      account_lead_name:  'James',
      status:             'In Progress',
      priority:           'High',
      department:         'Finance',
      start_date:         '2026-01-01',
      end_date:           '2026-03-31',
      directors_note:     null,
      is_priority_focus:  true,
      is_time_critical:   true,
      created_at:         now,
    },
    {
      name:               'Website Redesign',
      account_lead_id:    jamesId,
      account_lead_name:  'James',
      status:             'Not Started',
      priority:           'Medium',
      department:         'Business',
      start_date:         '2026-02-01',
      end_date:           '2026-04-30',
      directors_note:     'Focus on mobile-first layout.',
      is_priority_focus:  false,
      is_time_critical:   false,
      created_at:         now,
    },
    {
      name:               'Employee Health Program',
      account_lead_id:    mariaId,
      account_lead_name:  'Maria',
      status:             'Not Started',
      priority:           'Low',
      department:         'Health',
      start_date:         '2026-03-01',
      end_date:           '2026-06-30',
      directors_note:     null,
      is_priority_focus:  false,
      is_time_critical:   false,
      created_at:         now,
    },
    {
      name:               'Annual Policy Update',
      account_lead_id:    mariaId,
      account_lead_name:  'Maria',
      status:             'On Hold',
      priority:           'Medium',
      department:         'Business',
      start_date:         '2026-01-15',
      end_date:           '2026-02-28',
      directors_note:     'Waiting on legal review.',
      is_priority_focus:  false,
      is_time_critical:   false,
      created_at:         now,
    },
  ];

  for (const p of PROJECTS) {
    const id = await fsAdd('projects', p, token);
    console.log(`    ✓  ${String(p.name).padEnd(28)} ${id}`);
  }

  // Done
  console.log('\n✅  Seed complete!\n');
  console.log('─'.repeat(55));
  console.log('Login credentials (all passwords: Password123!)');
  console.log('─'.repeat(55));
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(10)}  ${u.email}`);
  }
  console.log('─'.repeat(55));
}

main().catch(err => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});
