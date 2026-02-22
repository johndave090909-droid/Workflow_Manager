import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

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
  const PORT = 3000;

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
