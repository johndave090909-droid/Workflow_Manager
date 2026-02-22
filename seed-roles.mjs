/**
 * seed-roles.mjs  —  One-time script to seed default roles into /roles collection.
 * Run:  node seed-roles.mjs
 */

const API_KEY    = 'AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg';
const PROJECT_ID = 'systems-hub';
const AUTH_BASE  = `https://identitytoolkit.googleapis.com/v1/accounts`;
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFV(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')         return { stringValue: v };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object')         return { mapValue: { fields: toFF(v) } };
}
function toFF(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFV(v)]));
}

const ROLES = [
  {
    name: 'Director', color: '#ff00ff',
    permissions: { access_tracker: true, access_it_admin: false, view_all_projects: true, create_projects: true, edit_projects: true, view_workload: true, is_assignable: false },
  },
  {
    name: 'Admin', color: '#00ffff',
    permissions: { access_tracker: true, access_it_admin: false, view_all_projects: false, create_projects: false, edit_projects: false, view_workload: false, is_assignable: true },
  },
  {
    name: 'IT Admin', color: '#a855f7',
    permissions: { access_tracker: false, access_it_admin: true, view_all_projects: false, create_projects: false, edit_projects: false, view_workload: false, is_assignable: false },
  },
];

async function main() {
  console.log('Signing in as Director...');
  const signinRes = await fetch(`${AUTH_BASE}:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sarah@company.com', password: 'Password123!', returnSecureToken: true }),
  });
  const signin = await signinRes.json();
  if (!signinRes.ok) { console.error('Sign-in failed:', signin.error?.message); process.exit(1); }
  const token = signin.idToken;
  console.log('Signed in. Writing roles...\n');

  for (const role of ROLES) {
    const res = await fetch(`${FS_BASE}/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: toFF(role) }),
    });
    const d = await res.json();
    if (!res.ok) { console.error(`  ✗  ${role.name}:`, d.error?.message); continue; }
    console.log(`  ✓  ${role.name.padEnd(12)} -> ${d.name.split('/').pop()}`);
  }
  console.log('\nDone!');
}

main().catch(e => { console.error(e.message); process.exit(1); });
