import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import fs from "fs";
import cron from "node-cron";
import admin from "firebase-admin";
import nodemailer from "nodemailer";
import crypto from "crypto";

// ── Firebase Admin SDK (optional — needed for email/password updates) ─────────
let adminAuth: admin.auth.Auth | null = null;
try {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) {
    const serviceAccount = JSON.parse(sa);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    adminAuth = admin.auth();
    console.log("[Firebase Admin] Initialized — auth management enabled.");
  } else {
    console.warn("[Firebase Admin] FIREBASE_SERVICE_ACCOUNT not set — password/email updates disabled.");
  }
} catch (e) {
  console.error("[Firebase Admin] Failed to initialize:", e);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("sync.db");

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type WorkerSheetRow = {
  id?: string;
  shift: string;
  job: string;
  firstName: string;
  lastName: string;
  payRate: string;
  idNumber: string;
  preferredName: string;
  birthDay: string;
  messenger: string;
  persona: string;
  knife: string;
  custom?: Record<string, string>;
};

type WorkerSheetCustomColumn = { id: string; label: string };

const WORKER_FIXED_HEADERS = [
  "", "Job", "First Name", "Last Name", "Pay Rate", "Id Number",
  "Prefered Name", "Birth Day", "Messenger", "Persona", "Knife",
];
const WORKER_FIXED_KEYS = [
  "shift", "job", "firstName", "lastName", "payRate", "idNumber",
  "preferredName", "birthDay", "messenger", "persona", "knife",
] as const;

function parseGoogleServiceAccount(): GoogleServiceAccount | null {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.client_email || !parsed?.private_key) return null;
    return parsed as GoogleServiceAccount;
  } catch {
    return null;
  }
}

function getWorkerSheetConfig() {
  return {
    spreadsheetId: process.env.GOOGLE_WORKER_ROSTER_SPREADSHEET_ID || "",
    sheetName: process.env.GOOGLE_WORKER_ROSTER_SHEET_NAME || "Workers",
  };
}

function b64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken(scopes: string[]) {
  const sa = parseGoogleServiceAccount();
  if (!sa) throw new Error("Google service account is not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(sa.private_key);
  const assertion = `${unsigned}.${b64url(signature)}`;
  const resp = await fetch(claim.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) throw new Error(`Token request failed (${resp.status})`);
  const data = await resp.json() as any;
  if (!data.access_token) throw new Error("No access token returned from Google");
  return data.access_token as string;
}

async function sheetsApi(pathname: string, init: RequestInit = {}) {
  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const resp = await fetch(`https://sheets.googleapis.com/v4/${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google Sheets API ${resp.status}: ${text.slice(0, 500)}`);
  }
  return resp;
}

function normalizeSheetCell(v: unknown) {
  return typeof v === "string" ? v : (v == null ? "" : String(v));
}

function parseWorkerRosterFromSheet(values: unknown[][]) {
  const rows = Array.isArray(values) ? values : [];
  const headerRow = (rows[0] ?? []).map(normalizeSheetCell);
  const customHeaders = headerRow.slice(WORKER_FIXED_KEYS.length);
  const customColumns: WorkerSheetCustomColumn[] = customHeaders.map((label, i) => ({
    id: `col_${i + 1}`,
    label: label || `Column ${i + 1}`,
  }));

  const parsedRows: WorkerSheetRow[] = rows.slice(1)
    .map((r) => Array.isArray(r) ? r.map(normalizeSheetCell) : [])
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const fixedVals = WORKER_FIXED_KEYS.map((_, i) => normalizeSheetCell(r[i]));
      const custom: Record<string, string> = {};
      customColumns.forEach((c, idx) => { custom[c.id] = normalizeSheetCell(r[WORKER_FIXED_KEYS.length + idx]); });
      return {
        shift: fixedVals[0],
        job: fixedVals[1],
        firstName: fixedVals[2],
        lastName: fixedVals[3],
        payRate: fixedVals[4],
        idNumber: fixedVals[5],
        preferredName: fixedVals[6],
        birthDay: fixedVals[7],
        messenger: fixedVals[8],
        persona: fixedVals[9],
        knife: fixedVals[10],
        custom,
      };
    });

  return { customColumns, rows: parsedRows };
}

function buildWorkerRosterSheetValues(rows: WorkerSheetRow[], customColumns: WorkerSheetCustomColumn[]) {
  const header = [...WORKER_FIXED_HEADERS, ...customColumns.map(c => c.label || "New Column")];
  const body = rows.map((r) => {
    const fixed = WORKER_FIXED_KEYS.map((k) => normalizeSheetCell((r as any)[k]));
    const custom = customColumns.map((c) => normalizeSheetCell(r.custom?.[c.id]));
    return [...fixed, ...custom];
  });
  return [header, ...body];
}

async function readWorkerRosterFromGoogleSheet() {
  const { spreadsheetId, sheetName } = getWorkerSheetConfig();
  if (!spreadsheetId) throw new Error("GOOGLE_WORKER_ROSTER_SPREADSHEET_ID is not set");
  const range = encodeURIComponent(`${sheetName}!A:ZZ`);
  const resp = await sheetsApi(`spreadsheets/${spreadsheetId}/values/${range}`);
  const data = await resp.json() as any;
  const parsed = parseWorkerRosterFromSheet(data.values ?? []);
  return {
    spreadsheetId,
    sheetName,
    ...parsed,
    hash: crypto.createHash("sha256").update(JSON.stringify(data.values ?? [])).digest("hex"),
  };
}

async function writeWorkerRosterToGoogleSheet(payload: { rows: WorkerSheetRow[]; customColumns: WorkerSheetCustomColumn[] }) {
  const { spreadsheetId, sheetName } = getWorkerSheetConfig();
  if (!spreadsheetId) throw new Error("GOOGLE_WORKER_ROSTER_SPREADSHEET_ID is not set");
  const values = buildWorkerRosterSheetValues(payload.rows ?? [], payload.customColumns ?? []);
  const range = encodeURIComponent(`${sheetName}!A1`);
  await sheetsApi(`spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  return {
    spreadsheetId,
    sheetName,
    rowCount: Math.max(0, values.length - 1),
    columnCount: values[0]?.length ?? 0,
    hash: crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex"),
  };
}

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL, -- 'Director' or 'Admin'
    photo TEXT,
    workload_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    account_lead_id INTEGER,
    status TEXT DEFAULT 'Not Started', -- 'On Hold', 'In Progress', 'Not Started', 'Done'
    priority TEXT DEFAULT 'Medium', -- 'High', 'Medium', 'Low'
    department TEXT DEFAULT 'Business', -- 'Personal', 'Business', 'Finance', 'Health'
    start_date TEXT,
    end_date TEXT,
    directors_note TEXT,
    is_priority_focus INTEGER DEFAULT 0,
    is_time_critical INTEGER DEFAULT 0,
    FOREIGN KEY (account_lead_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    title TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS audit_trail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS message_reads (
    user_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    last_read_message_id INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS system_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    color_accent TEXT NOT NULL,
    link TEXT NOT NULL,
    link_type TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  );
`);

// Seed data if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  const insertUser = db.prepare("INSERT INTO users (name, role, photo) VALUES (?, ?, ?)");
  insertUser.run("Sarah Director", "Director", "https://picsum.photos/seed/sarah/100/100");
  insertUser.run("James Admin", "Admin", "https://picsum.photos/seed/james/100/100");
  insertUser.run("Elena Admin", "Admin", "https://picsum.photos/seed/elena/100/100");
  insertUser.run("Marcus Admin", "Admin", "https://picsum.photos/seed/marcus/100/100");
  insertUser.run("Alex IT Admin", "IT Admin", "https://picsum.photos/seed/alex/100/100");

  const insertProject = db.prepare("INSERT INTO projects (name, account_lead_id, status, priority, department, start_date, end_date, is_priority_focus, is_time_critical) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertProject.run("Q1 Office Relocation", 2, "In Progress", "High", "Business", "2026-01-15", "2026-03-30", 1, 1);
  insertProject.run("Annual Audit Prep", 3, "On Hold", "Medium", "Finance", "2026-02-01", "2026-02-28", 0, 1);
  insertProject.run("New Hire Onboarding", 4, "Not Started", "Low", "Business", "2026-03-01", "2026-04-15", 0, 0);
  insertProject.run("Personal Tax Filing", 2, "Done", "High", "Personal", "2026-01-01", "2026-02-15", 1, 0);
  insertProject.run("Health Insurance Renewal", 3, "In Progress", "Medium", "Health", "2026-02-10", "2026-03-10", 0, 1);
}

const cardCount = db.prepare("SELECT COUNT(*) as count FROM system_cards").get() as { count: number };
if (cardCount.count === 0) {
  const insertCard = db.prepare("INSERT INTO system_cards (title, description, icon, color_accent, link, link_type, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insertCard.run("Project Tracker",   "Manage projects, tasks, timelines and team workload.",        "📋", "#ff00ff", "tracker",                     "internal", 1, 1);
  insertCard.run("Document Vault",    "Centralized storage for all company documents and SOPs.",     "📁", "#00ffff", "https://drive.google.com",     "external", 1, 2);
  insertCard.run("HR Portal",         "Employee records, leave requests, and onboarding tools.",     "👥", "#ffd700", "https://example.com/hr",       "external", 1, 3);
  insertCard.run("Finance Dashboard", "Budget tracking, expense reports, and invoicing.",            "💰", "#ff4d4d", "https://example.com/finance",  "external", 1, 4);
  insertCard.run("IT Support Desk",   "Submit tickets, track requests, access the knowledge base.", "🛠️", "#a855f7", "https://example.com/itdesk",  "external", 1, 5);
}

async function startServer() {
  const app = express();
  app.use(express.json());
  const PORT = Number(process.env.PORT) || 3000;

  // CORS — allows Firebase-hosted frontend to call this Railway backend
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // Screenshots directory + static serving
  const screenshotsDir = path.join(__dirname, "screenshots");
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  app.use("/screenshots", express.static(screenshotsDir));

  // API Routes
  app.get("/api/worker-roster/google/status", (_req, res) => {
    const sa = parseGoogleServiceAccount();
    const { spreadsheetId, sheetName } = getWorkerSheetConfig();
    res.json({
      configured: Boolean(sa && spreadsheetId),
      spreadsheetId: spreadsheetId || null,
      sheetName: sheetName || "Workers",
      authConfigured: Boolean(sa),
    });
  });

  app.get("/api/worker-roster/google/pull", async (_req, res) => {
    try {
      const data = await readWorkerRosterFromGoogleSheet();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to pull from Google Sheets" });
    }
  });

  app.put("/api/worker-roster/google/push", async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const customColumns = Array.isArray(req.body?.customColumns) ? req.body.customColumns : [];
      const result = await writeWorkerRosterToGoogleSheet({ rows, customColumns });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to push to Google Sheets" });
    }
  });

  app.get("/api/users", (req, res) => {
    const users = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM projects WHERE account_lead_id = u.id AND status != 'Done') as workload_count 
      FROM users u
    `).all();
    res.json(users);
  });

  app.get("/api/projects", (req, res) => {
    const projects = db.prepare(`
      SELECT p.*, u.name as account_lead_name 
      FROM projects p 
      LEFT JOIN users u ON p.account_lead_id = u.id
    `).all();
    res.json(projects);
  });

  app.get("/api/projects/:id/tasks", (req, res) => {
    const tasks = db.prepare("SELECT * FROM tasks WHERE project_id = ?").all(req.params.id);
    res.json(tasks);
  });

  app.post("/api/projects/:id/update", (req, res) => {
    const { name, status, priority, department, account_lead_id, directors_note, start_date, end_date, is_priority_focus, is_time_critical, user_id } = req.body;
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as any;

    let action = "Updated project";
    let details = "";

    if (name !== undefined && name !== project.name) {
      db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, req.params.id);
      details += `Name changed to ${name}. `;
    }

    if (status && status !== project.status) {
      db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, req.params.id);
      details += `Status changed from ${project.status} to ${status}. `;
    }

    if (priority !== undefined && priority !== project.priority) {
      db.prepare("UPDATE projects SET priority = ? WHERE id = ?").run(priority, req.params.id);
      details += `Priority changed to ${priority}. `;
    }

    if (department !== undefined && department !== project.department) {
      db.prepare("UPDATE projects SET department = ? WHERE id = ?").run(department, req.params.id);
      details += `Department changed to ${department}. `;
    }

    if (account_lead_id && account_lead_id !== project.account_lead_id) {
      db.prepare("UPDATE projects SET account_lead_id = ? WHERE id = ?").run(account_lead_id, req.params.id);
      details += `Reassigned project. `;
    }

    if (directors_note !== undefined) {
      db.prepare("UPDATE projects SET directors_note = ? WHERE id = ?").run(directors_note, req.params.id);
      details += `Updated director's note. `;
    }

    if (start_date !== undefined && start_date !== project.start_date) {
      db.prepare("UPDATE projects SET start_date = ? WHERE id = ?").run(start_date, req.params.id);
      details += `Start date changed to ${start_date}. `;
    }

    if (end_date !== undefined && end_date !== project.end_date) {
      db.prepare("UPDATE projects SET end_date = ? WHERE id = ?").run(end_date, req.params.id);
      details += `End date changed to ${end_date}. `;
    }

    if (is_priority_focus !== undefined) {
      db.prepare("UPDATE projects SET is_priority_focus = ? WHERE id = ?").run(is_priority_focus ? 1 : 0, req.params.id);
    }

    if (is_time_critical !== undefined) {
      db.prepare("UPDATE projects SET is_time_critical = ? WHERE id = ?").run(is_time_critical ? 1 : 0, req.params.id);
    }

    if (details) {
      db.prepare("INSERT INTO audit_trail (user_id, action, details) VALUES (?, ?, ?)")
        .run(user_id || 1, action, details);
    }

    res.json({ success: true });
  });

  // Task routes
  app.post("/api/projects/:id/tasks", (req, res) => {
    const { title } = req.body;
    const result = db.prepare("INSERT INTO tasks (project_id, title) VALUES (?, ?)").run(req.params.id, title);
    res.json({ id: result.lastInsertRowid, project_id: Number(req.params.id), title, completed: 0 });
  });

  app.post("/api/tasks/:id/toggle", (req, res) => {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as any;
    if (!task) return res.status(404).json({ error: "Task not found" });
    db.prepare("UPDATE tasks SET completed = ? WHERE id = ?").run(task.completed ? 0 : 1, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/projects", (req, res) => {
    const { name, account_lead_id, status, priority, department, start_date, end_date, directors_note, is_priority_focus, is_time_critical, created_by_user_id } = req.body;
    const result = db.prepare(`
      INSERT INTO projects (name, account_lead_id, status, priority, department, start_date, end_date, directors_note, is_priority_focus, is_time_critical)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, account_lead_id, status || 'Not Started', priority || 'Medium', department || 'Business', start_date || null, end_date || null, directors_note || null, is_priority_focus ? 1 : 0, is_time_critical ? 1 : 0);

    db.prepare("INSERT INTO audit_trail (user_id, action, details) VALUES (?, ?, ?)")
      .run(created_by_user_id || 1, 'CREATE_PROJECT', `Created project: ${name}`);

    const newProject = db.prepare(`
      SELECT p.*, u.name as account_lead_name FROM projects p LEFT JOIN users u ON p.account_lead_id = u.id WHERE p.id = ?
    `).get(result.lastInsertRowid);

    res.json(newProject);
  });

  // Chat routes
  app.get("/api/projects/:id/messages", (req, res) => {
    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.photo as sender_photo, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.project_id = ?
      ORDER BY m.timestamp ASC
    `).all(req.params.id);
    res.json(messages);
  });

  app.post("/api/projects/:id/messages", (req, res) => {
    const { content, sender_id } = req.body;
    const result = db.prepare("INSERT INTO messages (project_id, sender_id, content) VALUES (?, ?, ?)")
      .run(req.params.id, sender_id, content);
    const message = db.prepare(`
      SELECT m.*, u.name as sender_name, u.photo as sender_photo, u.role as sender_role
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(result.lastInsertRowid);
    res.json(message);
  });

  app.post("/api/projects/:id/messages/mark-read", (req, res) => {
    const { user_id } = req.body;
    const row = db.prepare("SELECT COALESCE(MAX(id), 0) as max_id FROM messages WHERE project_id = ?")
      .get(req.params.id) as any;
    db.prepare(`
      INSERT INTO message_reads (user_id, project_id, last_read_message_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, project_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id
    `).run(user_id, req.params.id, row.max_id);
    res.json({ success: true });
  });

  app.get("/api/unread-counts", (req, res) => {
    const userId = Number(req.query.user_id);
    const counts = db.prepare(`
      SELECT m.project_id, COUNT(*) as unread_count
      FROM messages m
      WHERE m.sender_id != ?
        AND m.id > COALESCE(
          (SELECT last_read_message_id FROM message_reads WHERE user_id = ? AND project_id = m.project_id),
          0
        )
      GROUP BY m.project_id
    `).all(userId, userId);
    res.json(counts);
  });

  app.get("/api/audit-trail", (req, res) => {
    const trail = db.prepare(`
      SELECT a.*, u.name as user_name
      FROM audit_trail a
      JOIN users u ON a.user_id = u.id
      ORDER BY timestamp DESC LIMIT 50
    `).all();
    res.json(trail);
  });

  // User Management
  app.post("/api/users", (req, res) => {
    const { name, role, photo } = req.body;
    if (!name || !role) return res.status(400).json({ error: "Name and role are required." });
    const r = db.prepare("INSERT INTO users (name, role, photo) VALUES (?, ?, ?)").run(name, role, photo || null);
    res.json(db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid));
  });

  app.put("/api/users/:id", (req, res) => {
    const { name, role, photo } = req.body;
    if (!name || !role) return res.status(400).json({ error: "Name and role are required." });
    db.prepare("UPDATE users SET name=?, role=?, photo=? WHERE id=?").run(name, role, photo || null, req.params.id);
    res.json(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id));
  });

  app.delete("/api/users/:id", (req, res) => {
    db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // System Cards
  app.get("/api/system-cards", (req, res) => {
    res.json(db.prepare("SELECT * FROM system_cards ORDER BY sort_order ASC, id ASC").all());
  });

  app.post("/api/system-cards", (req, res) => {
    const { title, description, icon, color_accent, link, link_type, is_active, sort_order } = req.body;
    const r = db.prepare("INSERT INTO system_cards (title, description, icon, color_accent, link, link_type, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(title, description, icon, color_accent, link, link_type, is_active ? 1 : 0, sort_order || 0);
    res.json(db.prepare("SELECT * FROM system_cards WHERE id = ?").get(r.lastInsertRowid));
  });

  app.put("/api/system-cards/:id", (req, res) => {
    const { title, description, icon, color_accent, link, link_type, is_active, sort_order } = req.body;
    db.prepare("UPDATE system_cards SET title=?, description=?, icon=?, color_accent=?, link=?, link_type=?, is_active=?, sort_order=? WHERE id=?")
      .run(title, description, icon, color_accent, link, link_type, is_active ? 1 : 0, sort_order || 0, req.params.id);
    res.json(db.prepare("SELECT * FROM system_cards WHERE id = ?").get(req.params.id));
  });

  app.patch("/api/system-cards/:id/toggle", (req, res) => {
    const card = db.prepare("SELECT * FROM system_cards WHERE id = ?").get(req.params.id) as any;
    if (!card) return res.status(404).json({ error: "Not found" });
    db.prepare("UPDATE system_cards SET is_active = ? WHERE id = ?").run(card.is_active ? 0 : 1, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/system-cards/:id", (req, res) => {
    db.prepare("DELETE FROM system_cards WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Screenshots API
  app.get("/api/screenshots", (req, res) => {
    const shots = db.prepare("SELECT * FROM screenshots ORDER BY id DESC LIMIT 50").all();
    res.json(shots);
  });

  app.post("/api/screenshots/upload", (req, res) => {
    const { base64, source_url } = req.body;
    if (!base64) { res.status(400).json({ error: "base64 required" }); return; }
    const filename = `shot-${Date.now()}.png`;
    const filepath = path.join(__dirname, "screenshots", filename);
    try {
      const data = base64.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(filepath, Buffer.from(data, "base64"));
      const r = db.prepare("INSERT INTO screenshots (url, filename) VALUES (?, ?)").run(source_url || "uploaded", filename);
      res.json({ id: r.lastInsertRowid, url: source_url || "uploaded", filename, captured_at: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/screenshots/capture", async (req, res) => {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: "URL required" }); return; }
    const filename = `shot-${Date.now()}.png`;
    const filepath = path.join(__dirname, "screenshots", filename);
    const scriptPath = path.join(__dirname, "screenshot.py");
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("python", [scriptPath, url, filepath], { timeout: 60000 }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
      const r = db.prepare("INSERT INTO screenshots (url, filename) VALUES (?, ?)").run(url, filename);
      res.json({ id: r.lastInsertRowid, url, filename, captured_at: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Screenshot failed" });
    }
  });

  // Trigger GitHub Actions screenshot workflow
  app.post("/api/trigger-screenshot", async (req, res) => {
    const { url, filename, selector } = req.body;
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) { res.status(500).json({ error: "GITHUB_TOKEN not configured in .env" }); return; }
    try {
      const response = await fetch(
        "https://api.github.com/repos/johndave090909-droid/Workflow_Manager/actions/workflows/screenshot.yml/dispatches",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: {
              url: url || "https://nidl3r.github.io/PCC-KDS/",
              filename: filename || "screenshot",
              selector: selector || "",
            },
          }),
        }
      );
      if (response.status === 204) {
        res.json({ success: true, message: "GitHub Actions workflow triggered" });
      } else {
        const body = await response.text();
        res.status(response.status).json({ error: body });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Facebook Messenger
  app.post("/api/send-facebook-message", async (req, res) => {
    const { recipientId, message, imageUrl } = req.body;
    const pageToken = process.env.FB_PAGE_TOKEN;
    if (!pageToken) { res.status(500).json({ error: "FB_PAGE_TOKEN not configured in .env" }); return; }
    if (!recipientId) { res.status(400).json({ error: "recipientId required" }); return; }
    const base = `https://graph.facebook.com/v19.0/me/messages?access_token=${pageToken}`;
    try {
      // 1. Send image attachment if a screenshot URL is available
      if (imageUrl) {
        const imgResp = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            messaging_type: "MESSAGE_TAG",
            tag: "CONFIRMED_EVENT_UPDATE",
            message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } },
          }),
        });
        const imgData = await imgResp.json() as any;
        if (imgData.error) { res.status(400).json({ error: imgData.error.message }); return; }
      }
      // 2. Send caption text
      if (message) {
        const txtResp = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            messaging_type: "MESSAGE_TAG",
            tag: "CONFIRMED_EVENT_UPDATE",
            message: { text: message },
          }),
        });
        const txtData = await txtResp.json() as any;
        if (txtData.error) { res.status(400).json({ error: txtData.error.message }); return; }
        res.json({ success: true, messageId: txtData.message_id }); return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send Email (SMTP via nodemailer) ────────────────────────────────────────
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body, cc, attachScreenshot, imageUrl } = req.body as {
      to: string; subject?: string; body?: string;
      cc?: string; attachScreenshot?: string; imageUrl?: string;
    };

    const smtpHost   = process.env.SMTP_HOST;
    const smtpPort   = Number(process.env.SMTP_PORT  || 587);
    const smtpSecure = process.env.SMTP_SECURE === 'true';
    const smtpUser   = process.env.SMTP_USER;
    const smtpPass   = process.env.SMTP_PASS;
    const smtpFrom   = process.env.SMTP_FROM || smtpUser;

    if (!smtpHost || !smtpUser || !smtpPass) {
      res.status(500).json({ error: "SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env" });
      return;
    }
    if (!to?.trim()) {
      res.status(400).json({ error: "to is required" });
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
      });

      let htmlBody = body || '<p>This is an automated message from <strong>Workflow Manager</strong>.</p>';

      // Embed screenshot if requested and available
      if (attachScreenshot === 'true' && imageUrl) {
        htmlBody += `<br><br><img src="${imageUrl}" alt="Screenshot" style="max-width:100%;border-radius:8px;border:1px solid #eee">`;
      }

      const info = await transporter.sendMail({
        from:    smtpFrom,
        to:      to.trim(),
        cc:      cc?.trim() || undefined,
        subject: subject || 'Automated Report',
        html:    htmlBody,
      });

      console.log(`[Email] Sent to ${to} — messageId: ${info.messageId}`);
      res.json({ success: true, messageId: info.messageId });
    } catch (err: any) {
      console.error("[Email] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update GitHub Actions schedule ─────────────────────────────────────────
  app.put("/api/github-schedule", async (req, res) => {
    const { frequency, time, timezone } = req.body;
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) { res.status(500).json({ error: "GITHUB_TOKEN not set" }); return; }

    // Convert local time → UTC (GitHub Actions cron is always UTC)
    const [localH, localM] = (time || "09:00").split(":").map(Number);
    const now = new Date();
    const utcMs   = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    const localMs = new Date(now.toLocaleString("en-US", { timeZone: timezone || "Pacific/Honolulu" })).getTime();
    const offsetH = Math.round((utcMs - localMs) / 3_600_000);
    const utcH = ((localH + offsetH) % 24 + 24) % 24;

    const cronPat =
      frequency === "hourly"  ? "0 * * * *"               :
      frequency === "weekly"  ? `${localM} ${utcH} * * 1` :
      frequency === "monthly" ? `${localM} ${utcH} 1 * *` :
                                `${localM} ${utcH} * * *`;  // daily

    // Fetch current file + sha from GitHub
    const OWNER  = "johndave090909-droid";
    const REPO   = "Workflow_Manager";
    const PATH   = ".github/workflows/screenshot.yml";
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
    const ghHeaders = {
      Authorization: `Bearer ${ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    try {
      const getR = await fetch(apiUrl, { headers: ghHeaders });
      const getD = await getR.json() as any;
      if (!getR.ok) { res.status(500).json({ error: getD.message }); return; }

      const currentYaml = Buffer.from(getD.content, "base64").toString("utf8");
      const sha = getD.sha;

      // Replace only the cron line, preserving surrounding indentation
      const updatedYaml = currentYaml.replace(
        /([ \t]*- cron: ")[^"]+(")/,
        `$1${cronPat}$2`
      );

      if (updatedYaml === currentYaml) {
        res.json({ success: true, message: "Schedule already set to this value", cronPat });
        return;
      }

      // Commit the change back to GitHub
      const mmStr = String(localM).padStart(2, "0");
      const putR = await fetch(apiUrl, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          message: `chore: set schedule to ${frequency} at ${time} ${timezone} → cron "${cronPat}" UTC`,
          content: Buffer.from(updatedYaml).toString("base64"),
          sha,
        }),
      });
      const putD = await putR.json() as any;
      if (!putR.ok) { res.status(500).json({ error: putD.message }); return; }

      console.log(`[Schedule] GitHub Actions cron updated → "${cronPat}"`);
      res.json({
        success: true,
        cronPat,
        utcLabel: `${utcH}:${mmStr} UTC`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Server-side scheduler ────────────────────────────────────────────────────
  // Holds the current active cron task so we can destroy and recreate it on update.
  let activeTask: ReturnType<typeof cron.schedule> | null = null;

  // Runs the full workflow: screenshot → wait → facebook message.
  // Called by the cron job (server-side, works even when browser is closed).
  async function runScheduledWorkflow(cfg: {
    screenshotUrl: string; selector: string;
    recipientId: string; message: string;
  }) {
    const ghToken = process.env.GITHUB_TOKEN;
    const fbToken = process.env.FB_PAGE_TOKEN;
    console.log(`[Scheduler] Workflow triggered at ${new Date().toISOString()}`);

    // 1. Trigger GitHub Actions screenshot
    if (ghToken) {
      try {
        const r = await fetch(
          "https://api.github.com/repos/johndave090909-droid/Workflow_Manager/actions/workflows/screenshot.yml/dispatches",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ghToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref: "main",
              inputs: { url: cfg.screenshotUrl, filename: "scheduled", selector: cfg.selector },
            }),
          }
        );
        console.log(`[Scheduler] GitHub Actions triggered (${r.status})`);
      } catch (e) {
        console.error("[Scheduler] GitHub Actions trigger failed:", e);
      }
    }

    // 2. Wait ~4 min for GitHub Actions to complete and upload to Firebase
    await new Promise(r => setTimeout(r, 4 * 60 * 1000));

    // 3. Fetch latest screenshot URL from Firestore REST API
    let storageUrl = "";
    try {
      const FB_API_KEY = "AIzaSyAgNSwj4LTeMbuVMTSbFRmbI6eKRYUsRXg";
      // Get anonymous Firebase token
      const authR = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) }
      );
      const { idToken } = await authR.json() as any;

      // Query Firestore for most recent screenshot
      const fsR = await fetch(
        `https://firestore.googleapis.com/v1/projects/systems-hub/databases/(default)/documents/screenshots?pageSize=1&orderBy=captured_at+desc`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const fsData = await fsR.json() as any;
      storageUrl = fsData.documents?.[0]?.fields?.storage_url?.stringValue ?? "";
      console.log(`[Scheduler] Latest screenshot URL: ${storageUrl ? "found" : "not found"}`);
    } catch (e) {
      console.error("[Scheduler] Firestore fetch failed:", e);
    }

    // 4. Send Facebook message
    if (fbToken && cfg.recipientId) {
      const base = `https://graph.facebook.com/v19.0/me/messages?access_token=${fbToken}`;
      try {
        if (storageUrl) {
          await fetch(base, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: cfg.recipientId },
              messaging_type: "MESSAGE_TAG",
              tag: "CONFIRMED_EVENT_UPDATE",
              message: { attachment: { type: "image", payload: { url: storageUrl, is_reusable: true } } },
            }),
          });
        }
        if (cfg.message) {
          await fetch(base, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: cfg.recipientId },
              messaging_type: "MESSAGE_TAG",
              tag: "CONFIRMED_EVENT_UPDATE",
              message: { text: cfg.message },
            }),
          });
        }
        console.log("[Scheduler] Facebook message sent");
      } catch (e) {
        console.error("[Scheduler] Facebook send failed:", e);
      }
    }
  }

  // Endpoint: frontend calls this when Live Mode is toggled on/off or schedule changes.
  app.post("/api/schedule", (req, res) => {
    const { enabled, frequency, time, timezone, screenshotUrl, selector, recipientId, message } = req.body;

    // Tear down existing job
    if (activeTask) { activeTask.stop(); activeTask = null; }

    if (!enabled) {
      console.log("[Scheduler] Disabled");
      res.json({ active: false });
      return;
    }

    // Build cron pattern from frequency + time
    const [hh, mm] = (time || "09:00").split(":").map(Number);
    const pattern =
      frequency === "hourly"  ? "0 * * * *"       :
      frequency === "weekly"  ? `${mm} ${hh} * * 1` :
      frequency === "monthly" ? `${mm} ${hh} 1 * *` :
                                `${mm} ${hh} * * *`;  // daily (default)

    const tz = timezone || "Pacific/Honolulu";
    if (!cron.validate(pattern)) {
      res.status(400).json({ error: "Invalid cron pattern" });
      return;
    }

    activeTask = cron.schedule(pattern, () => {
      runScheduledWorkflow({ screenshotUrl, selector, recipientId, message });
    }, { timezone: tz });

    console.log(`[Scheduler] Active — pattern: "${pattern}", tz: ${tz}`);
    res.json({ active: true, pattern, timezone: tz });
  });

  // ── Firebase Auth admin update (email + password) ────────────────────────────
  app.post("/api/admin/update-user-auth", async (req, res) => {
    if (!adminAuth) {
      res.status(503).json({ error: "Firebase Admin SDK not configured. Add FIREBASE_SERVICE_ACCOUNT to your .env file." });
      return;
    }
    const { uid, email, password } = req.body as { uid?: string; email?: string; password?: string };
    if (!uid) { res.status(400).json({ error: "uid is required." }); return; }

    const updates: { email?: string; password?: string } = {};
    if (email)    updates.email    = email.trim();
    if (password) updates.password = password;

    if (Object.keys(updates).length === 0) {
      res.json({ success: true, message: "Nothing to update." });
      return;
    }

    try {
      await adminAuth.updateUser(uid, updates);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? "Failed to update user." });
    }
  });

  // ── Google Drive API ────────────────────────────────────────────────────────

  async function driveApi(pathname: string, saJson?: string) {
    // Use node-provided SA JSON first, fallback to env var
    let token: string;
    if (saJson) {
      try {
        const sa = JSON.parse(saJson) as GoogleServiceAccount;
        if (!sa.client_email || !sa.private_key) throw new Error("bad sa");
        // Temporarily swap env to reuse getGoogleAccessToken
        const original = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT;
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT = saJson;
        token = await getGoogleAccessToken(["https://www.googleapis.com/auth/drive.readonly"]);
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT = original;
      } catch {
        token = await getGoogleAccessToken(["https://www.googleapis.com/auth/drive.readonly"]);
      }
    } else {
      token = await getGoogleAccessToken(["https://www.googleapis.com/auth/drive.readonly"]);
    }
    const resp = await fetch(`https://www.googleapis.com/drive/v3/${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Drive API ${resp.status}: ${text.slice(0, 400)}`);
    }
    return resp.json();
  }

  // Status check — tells the frontend whether Drive is usable
  app.get("/api/google-drive/status", (_req, res) => {
    const sa = parseGoogleServiceAccount();
    res.json({ configured: !!sa, email: sa?.client_email ?? null });
  });

  // Poll a folder for PDF files (optionally filtered by createdTime > since)
  app.post("/api/google-drive/poll", async (req, res) => {
    const { folderId, since, serviceAccountJson } = req.body as {
      folderId?: string;
      since?: string;        // ISO date — only return files newer than this
      serviceAccountJson?: string;
    };

    if (!folderId) {
      res.status(400).json({ error: "folderId is required" });
      return;
    }

    try {
      let q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
      if (since) {
        q += ` and createdTime > '${since}'`;
      }

      const data = await driveApi(
        `files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,webViewLink,size,mimeType)&orderBy=createdTime%20desc`,
        serviceAccountJson
      ) as { files: any[] };

      res.json({ files: data.files ?? [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Drive API error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
