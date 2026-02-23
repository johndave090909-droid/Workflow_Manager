import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import fs from "fs";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("sync.db");

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
          body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
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
              message: { attachment: { type: "image", payload: { url: storageUrl, is_reusable: true } } },
            }),
          });
        }
        if (cfg.message) {
          await fetch(base, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient: { id: cfg.recipientId }, message: { text: cfg.message } }),
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
