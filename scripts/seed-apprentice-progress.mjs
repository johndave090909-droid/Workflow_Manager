/**
 * seed-apprentice-progress.mjs — no-auth REST API version
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT   = 'systems-hub';
const BASE      = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── 1. Parse CSV ──────────────────────────────────────────────────────────────
const csvPath = resolve(__dirname, '../directory/Active_Apprentices_2026-03-25T04-10-53.csv');
const lines   = readFileSync(csvPath, 'utf8').trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

function col(row, name) {
  const i = headers.findIndex(h => h.includes(name.toLowerCase()));
  return i >= 0 ? (row[i] || '').trim() : '';
}
function pct(completed, assigned) {
  const c = parseFloat(completed) || 0;
  const a = parseFloat(assigned)  || 0;
  if (a === 0) return 0;
  return Math.min(100, Math.round((c / a) * 100));
}

const csvData = lines.slice(1).filter(l => l.trim()).map(line => {
  const row              = line.split(',');
  const name             = col(row, 'apprentice name');
  const assignedRTI      = col(row, 'assigned rti');
  const completedRTI     = col(row, 'completed rti');
  const assignedOJT      = col(row, 'assigned ojt hours');
  const completedOJT     = col(row, 'completed ojt hours');
  const completedOJTDays = col(row, 'completed ojt days');
  const remainingOJTDays = col(row, 'remaining ojt days');
  const compPct          = parseFloat(col(row, 'competencies percentage')) || 0;
  const journeyStatus    = col(row, 'journey status');

  const rtiPct  = pct(completedRTI, assignedRTI);
  const ojtHPct = pct(completedOJT, assignedOJT);
  const total   = (parseFloat(completedOJTDays)||0) + (parseFloat(remainingOJTDays)||0);
  const ojtDPct = total > 0 ? Math.min(100, Math.round(((parseFloat(completedOJTDays)||0)/total)*100)) : 0;
  const compRnd = Math.round(compPct);
  const journeyPct = journeyStatus === 'IN-PROGRESS' ? Math.round((rtiPct+ojtHPct+ojtDPct+compRnd)/4) : 0;

  return { name, progress: { 'RTI Hours': rtiPct, 'OJT Hours': ojtHPct, 'OJT Days': ojtDPct, 'Competencies': compRnd, 'Journey Progress': journeyPct } };
});

console.log(`Parsed ${csvData.length} apprentices\n`);

// ── 2. Fetch all docs (no auth needed — rules temporarily open) ───────────────
const res  = await fetch(`${BASE}/ccbl_apprentices?pageSize=100`);
const json = await res.json();
const docs  = json.documents || [];
console.log(`Found ${docs.length} docs in Firestore\n`);

function normalize(n) { return n.toLowerCase().replace(/\s+/g,' ').trim(); }

let updated = 0, skipped = 0;

for (const csvRow of csvData) {
  const match = docs.find(d => normalize(d.fields?.name?.stringValue||'') === normalize(csvRow.name));
  if (!match) { console.warn(`  SKIP: "${csvRow.name}"`); skipped++; continue; }

  const docId = match.name.split('/').pop();
  const progressFields = {};
  for (const [k,v] of Object.entries(csvRow.progress)) {
    progressFields[k] = { integerValue: String(v) };
  }

  const patchRes = await fetch(`${BASE}/ccbl_apprentices/${docId}?updateMask.fieldPaths=progress`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { progress: { mapValue: { fields: progressFields } } } }),
  });

  if (patchRes.ok) {
    console.log(`  ✓ ${csvRow.name}`, csvRow.progress);
    updated++;
  } else {
    const err = await patchRes.json();
    console.error(`  ✗ ${csvRow.name}:`, err.error?.message);
  }
}

console.log(`\nDone. Updated: ${updated}  Skipped: ${skipped}`);
