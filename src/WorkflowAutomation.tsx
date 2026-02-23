import React, { useState, useRef, useEffect } from 'react';
import { LogOut, Play, X, Trash2, Plus, RotateCcw, Code2, Settings2, Terminal, Camera, Upload } from 'lucide-react';
import { collection, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db as firestoreDb } from './firebase';
import { User } from './types';

// API base — empty for Railway (same-origin), set VITE_API_BASE for external backend
const API_BASE = (import.meta.env.VITE_API_BASE as string) || '';

// ── Constants ──────────────────────────────────────────────────────────────────
const NODE_W   = 215;
const NODE_H   = 88;
const PORT_R   = 7;
const CANVAS_W = 2400;
const CANVAS_H = 800;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Type Definitions ───────────────────────────────────────────────────────────
interface NodeTypeDef {
  type: string;
  label: string;
  icon: string;
  color: string;
  category: 'trigger' | 'action';
  defaultConfig: Record<string, string>;
}

const NODE_TYPE_DEFS: NodeTypeDef[] = [
  { type: 'schedule',      label: 'Schedule',      icon: '⏰', color: '#ff9500', category: 'trigger', defaultConfig: { frequency: 'daily', time: '09:00', timezone: 'Pacific/Honolulu' } },
  { type: 'webhook',       label: 'Webhook',        icon: '⚡', color: '#ff7849', category: 'trigger', defaultConfig: { path: '/webhook', method: 'POST' } },
  { type: 'screenshot',    label: 'Screenshot',     icon: '🌐', color: '#00cc7a', category: 'action',  defaultConfig: { url: 'https://example.com', selector: '', format: 'PNG', fullPage: 'true' } },
  { type: 'facebook',      label: 'Facebook',       icon: '📘', color: '#1877f2', category: 'action',  defaultConfig: { recipientId: '', message: 'Daily screenshot report' } },
  { type: 'data_transform',label: 'Data Transform', icon: '⚙️', color: '#a855f7', category: 'action', defaultConfig: { mode: 'JSON → CSV', filter: '' } },
  { type: 'email',         label: 'Send Email',     icon: '✉️', color: '#00ffff', category: 'action', defaultConfig: { to: 'recipient@example.com', subject: 'Automated Report' } },
];

type NodeStatus = 'idle' | 'running' | 'success' | 'error';
type EditorTab  = 'code' | 'params' | 'output';

interface WFNode {
  id: string; type: string; label: string; icon: string; color: string;
  x: number;  y: number;   status: NodeStatus; config: Record<string, string>;
}
interface WFEdge { id: string; fromId: string; toId: string; }
interface ScreenshotRecord {
  id: number | string;
  url: string;
  filename: string;
  captured_at: string;
  storage_url?: string;
  source?: string;
}

// ── Initial workflow ───────────────────────────────────────────────────────────
const INITIAL_NODES: WFNode[] = [
  { id: 'n1', type: 'schedule',   label: 'On Schedule', icon: '⏰', color: '#ff9500', x: 60,  y: 120, status: 'idle', config: { frequency: 'daily', time: '09:00', timezone: 'Pacific/Honolulu' } },
  { id: 'n2', type: 'screenshot', label: 'Screenshot',  icon: '🌐', color: '#00cc7a', x: 370, y: 120, status: 'idle', config: { url: 'https://nidl3r.github.io/PCC-KDS/', selector: '#current-guest-counts', format: 'PNG', fullPage: 'true' } },
  { id: 'n3', type: 'facebook',   label: 'Facebook',    icon: '📘', color: '#1877f2', x: 680, y: 120, status: 'idle', config: { recipientId: '33484104667900049', message: 'Daily screenshot report' } },
];
const INITIAL_EDGES: WFEdge[] = [
  { id: 'e1', fromId: 'n1', toId: 'n2' },
  { id: 'e2', fromId: 'n2', toId: 'n3' },
];

// ── Execution order ────────────────────────────────────────────────────────────
function getExecutionOrder(nodes: WFNode[], edges: WFEdge[]): string[] {
  const hasIncoming = new Set(edges.map(e => e.toId));
  const visited = new Set<string>(); const order: string[] = [];
  const dfs = (id: string) => {
    if (visited.has(id)) return; visited.add(id); order.push(id);
    edges.filter(e => e.fromId === id).forEach(e => dfs(e.toId));
  };
  nodes.filter(n => !hasIncoming.has(n.id)).forEach(n => dfs(n.id));
  nodes.forEach(n => { if (!visited.has(n.id)) dfs(n.id); });
  return order;
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  idle: '#475569', running: '#ffd700', success: '#00cc7a', error: '#ff4d4d',
};

// ── Code templates per node type ───────────────────────────────────────────────
function getNodeCode(node: WFNode): string {
  const c = node.config;
  switch (node.type) {
    case 'schedule': {
      const freq = c.frequency || 'daily';
      const [hh, mm] = (c.time || '09:00').split(':').map(Number);
      const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      const ampm = hh < 12 ? 'AM' : 'PM';
      const mmStr = String(mm).padStart(2, '0');
      const timeLabel = `${h12}:${mmStr} ${ampm}`;
      const label = freq === 'hourly'  ? 'Every hour'
                  : freq === 'daily'   ? `Every day at ${timeLabel}`
                  : freq === 'weekly'  ? `Every week on Mon at ${timeLabel}`
                  : `Every month on the 1st at ${timeLabel}`;
      const cronPat = freq === 'hourly'  ? `"0 * * * *"`
                    : freq === 'daily'   ? `"${mm} ${hh} * * *"`
                    : freq === 'weekly'  ? `"${mm} ${hh} * * 1"`
                    : `"${mm} ${hh} 1 * *"`;
      return `// ⏰  Schedule Trigger — fires the workflow on a set interval
// Configured: ${label} (${c.timezone || 'UTC+8'})

const cron = require("node-cron");

// Cron pattern: minute  hour  day  month  weekday
const pattern = ${cronPat};

cron.schedule(pattern, async () => {
  const payload = {
    triggeredAt : new Date().toISOString(),
    timezone    : "${c.timezone || 'UTC+8'}",
    schedule    : "${label}",
    runId       : crypto.randomUUID(),
  };

  console.log("[Schedule] Workflow triggered", payload);

  // Emit payload to the next connected node
  return payload;

}, { timezone: "${c.timezone || 'Pacific/Honolulu'}" });`;
    }

    case 'webhook': return `// ⚡  Webhook Trigger — listens for incoming HTTP requests
// Endpoint: ${c.method || 'POST'} ${c.path || '/webhook'}

const express = require("express");
const app     = express();
app.use(express.json());

// Register the webhook route
app.${(c.method || 'POST').toLowerCase()}("${c.path || '/webhook'}", async (req, res) => {
  const payload = {
    receivedAt : new Date().toISOString(),
    method     : req.method,
    headers    : req.headers,
    body       : req.body,
    query      : req.query,
    ip         : req.ip,
  };

  console.log("[Webhook] Request received:", payload);

  // Acknowledge the request immediately
  res.status(200).json({ status: "received", runId: crypto.randomUUID() });

  // Emit payload to the next connected node
  return payload;
});`;

    case 'screenshot': return `// 🌐  Screenshot Action — captures a page with Puppeteer
// Target URL : ${c.url || 'https://example.com'}
// Format     : ${c.format || 'PNG'}
// Full page  : ${c.fullPage || 'true'}

const puppeteer = require("puppeteer");

async function execute(input) {
  const browser = await puppeteer.launch({
    headless : "new",
    args     : ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Navigate to target
  await page.goto("${c.url || 'https://example.com'}", {
    waitUntil : "networkidle2",
    timeout   : 30000,
  });

  // Capture screenshot
  const buffer = await page.screenshot({
    type     : "${(c.format || 'PNG').toLowerCase()}",
    fullPage : ${c.fullPage === 'false' ? 'false' : 'true'},
    encoding : "base64",
  });

  await browser.close();

  return {
    imageBase64 : buffer,
    format      : "${c.format || 'PNG'}",
    url         : "${c.url || 'https://example.com'}",
    capturedAt  : new Date().toISOString(),
    sizeBytes   : Buffer.byteLength(buffer, "base64"),
  };
}`;

    case 'facebook': return `// 📘  Facebook Action — sends screenshot via Messenger API
// Recipient PSID : ${c.recipientId || 'SET IN PARAMETERS TAB'}
// Message        : "${c.message || 'Daily screenshot report'}"
// Page token     : process.env.FB_PAGE_TOKEN  ← set in .env, never in code

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
const RECIPIENT_ID  = "${c.recipientId || 'RECIPIENT_PSID'}";
const BASE          = \`https://graph.facebook.com/v19.0/me/messages?access_token=\${FB_PAGE_TOKEN}\`;

async function execute(input) {
  // 1. Send screenshot as image attachment (URL from Firebase Storage)
  if (input.imageUrl) {
    await fetch(BASE, {
      method  : "POST",
      headers : { "Content-Type": "application/json" },
      body    : JSON.stringify({
        recipient : { id: RECIPIENT_ID },
        message   : {
          attachment: {
            type    : "image",
            payload : { url: input.imageUrl, is_reusable: true },
          },
        },
      }),
    });
  }

  // 2. Send caption / text message
  const r    = await fetch(BASE, {
    method  : "POST",
    headers : { "Content-Type": "application/json" },
    body    : JSON.stringify({
      recipient : { id: RECIPIENT_ID },
      message   : { text: "${c.message || 'Daily screenshot report'}" },
    }),
  });
  const data = await r.json();
  console.log("[Facebook] Message sent:", data.message_id);

  return {
    messageId  : data.message_id,
    recipientId: data.recipient_id,
    sentAt     : new Date().toISOString(),
  };
}`;

    case 'data_transform': return `// ⚙️  Data Transform — reshapes data between nodes
// Mode   : ${c.mode || 'JSON → CSV'}
// Filter : "${c.filter || '(none)'}"

const { parse }    = require("json2csv");
const { DateTime } = require("luxon");

async function execute(input) {
  let result = input;

  // ── Step 1: Apply filter expression (if set)
  ${c.filter ? `const filtered = input.filter(row => ${c.filter});
  result = filtered;` : `// No filter configured — passing data through unchanged`}

  // ── Step 2: Transform based on mode
  if ("${c.mode || 'JSON → CSV'}" === "JSON → CSV") {
    const fields = Object.keys(Array.isArray(result) ? result[0] : result);
    const csv    = parse(Array.isArray(result) ? result : [result], { fields });

    return {
      output      : csv,
      format      : "csv",
      rowCount    : Array.isArray(result) ? result.length : 1,
      processedAt : new Date().toISOString(),
    };
  }

  // ── Step 3: Pass through for other modes
  return {
    output      : result,
    format      : "json",
    processedAt : new Date().toISOString(),
  };
}`;

    case 'email': return `// ✉️  Send Email Action — delivers an email via SMTP
// To      : ${c.to || 'recipient@example.com'}
// Subject : "${c.subject || 'Automated Report'}"

const nodemailer = require("nodemailer");

// Configure SMTP transport (credentials from environment)
const transporter = nodemailer.createTransport({
  host   : process.env.SMTP_HOST,
  port   : 587,
  secure : false,
  auth   : {
    user : process.env.SMTP_USER,
    pass : process.env.SMTP_PASS,
  },
});

async function execute(input) {
  const mailOptions = {
    from    : process.env.SMTP_FROM,
    to      : "${c.to || 'recipient@example.com'}",
    subject : "${c.subject || 'Automated Report'}",
    html    : buildEmailBody(input),

    // Attach screenshot if available from previous node
    ...(input.imageBase64 && {
      attachments: [{
        filename    : \`report-\${Date.now()}.${(c.subject || '').toLowerCase().includes('png') ? 'png' : 'png'}\`,
        content     : input.imageBase64,
        encoding    : "base64",
        contentType : "image/png",
      }],
    }),
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("[Email] Sent:", info.messageId);

  return {
    messageId : info.messageId,
    to        : "${c.to || 'recipient@example.com'}",
    sentAt    : new Date().toISOString(),
  };
}`;

    default: return `// Node type: ${node.type}\n// No code template available for this node.`;
  }
}

// ── Sample output per node type ────────────────────────────────────────────────
function getNodeOutput(node: WFNode): string {
  const t = new Date().toISOString();
  switch (node.type) {
    case 'schedule': return JSON.stringify({ triggeredAt: t, timezone: node.config.timezone || 'UTC+8', frequency: node.config.frequency || 'daily', time: node.config.time || '09:00', runId: 'a3f8c2d1-...' }, null, 2);
    case 'webhook':  return JSON.stringify({ receivedAt: t, method: node.config.method || 'POST', body: { event: 'ping', data: {} }, ip: '192.168.1.1' }, null, 2);
    case 'screenshot': return JSON.stringify({ imageBase64: 'iVBORw0KGgoAAAANSUhEUgA...', format: node.config.format || 'PNG', url: node.config.url, capturedAt: t, sizeBytes: 48320 }, null, 2);
    case 'facebook': return JSON.stringify({ messageId: 'mid.166023:41d13d...', recipientId: node.config.recipientId || 'RECIPIENT_PSID', sentAt: t }, null, 2);
    case 'data_transform': return JSON.stringify({ output: 'id,name,value\n1,Alpha,100\n2,Beta,200', format: 'csv', rowCount: 2, processedAt: t }, null, 2);
    case 'email':    return JSON.stringify({ messageId: '<abc123@smtp.example.com>', to: node.config.to, sentAt: t }, null, 2);
    default:         return '{}';
  }
}

// ── Minimal syntax highlighter ─────────────────────────────────────────────────
function highlightCode(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    // Comments
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#4a5568;font-style:italic">$1</span>')
    // Strings (double-quoted)
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#00cc7a">$1</span>')
    // Strings (single-quoted, not inside already replaced)
    .replace(/(?<!color:)('(?:[^'\\]|\\.)*')/g, '<span style="color:#00cc7a">$1</span>')
    // Template literal variables — \`...\` (we can't handle backtick easily, skip)
    // Keywords
    .replace(/\b(const|let|var|async|await|function|return|if|else|for|of|in|new|typeof|require|import|from|export|default)\b/g,
      '<span style="color:#ff9500">$1</span>')
    // Booleans / null
    .replace(/\b(true|false|null|undefined)\b/g, '<span style="color:#ff7849">$1</span>')
    // Numbers
    .replace(/(?<![#a-fA-F])\b(\d+)\b/g, '<span style="color:#a855f7">$1</span>')
    // Property access
    .replace(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '.<span style="color:#00ffff">$1</span>');
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  currentUser: User;
  onBackToHub: () => void;
  onLogout: () => void;
  roleColor: string;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function WorkflowAutomation({ currentUser, onBackToHub, onLogout, roleColor }: Props) {
  const [nodes, setNodes]           = useState<WFNode[]>(() => {
    try {
      const s = localStorage.getItem('wf_nodes');
      if (!s) return INITIAL_NODES;
      const saved: WFNode[] = JSON.parse(s);
      // Merge saved config with current defaults so new fields (e.g. selector) appear automatically
      return saved.map(node => {
        const def = NODE_TYPE_DEFS.find(d => d.type === node.type);
        if (!def) return node;
        const merged = { ...def.defaultConfig, ...node.config };
        // For known node IDs: if a field is empty after merging but INITIAL_NODES has a non-empty
        // value for it, use the INITIAL_NODES value. This handles cases where a new pre-configured
        // field (like selector) was added after the user already saved their node config.
        const initial = INITIAL_NODES.find(n => n.id === node.id);
        if (initial) {
          for (const [k, v] of Object.entries(initial.config)) {
            if (v !== '' && merged[k] === '') merged[k] = v;
          }
        }
        return { ...node, config: merged };
      });
    } catch { return INITIAL_NODES; }
  });
  const [edges, setEdges]           = useState<WFEdge[]>(() => {
    try { const s = localStorage.getItem('wf_edges'); return s ? JSON.parse(s) : INITIAL_EDGES; } catch { return INITIAL_EDGES; }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeModal, setNodeModal]   = useState<WFNode | null>(null);
  const [editorTab, setEditorTab]   = useState<EditorTab>('code');
  const [executing, setExecuting]   = useState(false);
  const [liveMode, setLiveMode]     = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos]     = useState({ x: 0, y: 0 });
  const [nodeLog, setNodeLog]           = useState<Record<string, string[]>>({});
  const [screenshots, setScreenshots]   = useState<ScreenshotRecord[]>([]);
  const [capturingScreenshot, setCapturing] = useState(false);
  const [nextTriggerIn, setNextTriggerIn] = useState('');

  const dragging            = useRef<{ nodeId: string; offX: number; offY: number } | null>(null);
  const dragMoved           = useRef(false);
  const wrapperRef          = useRef<HTMLDivElement>(null);
  const fileInputRef        = useRef<HTMLInputElement>(null);
  const screenshotsRef      = useRef<ScreenshotRecord[]>([]);
  const handleExecuteRef    = useRef<() => Promise<void>>(async () => {});
  const executingRef        = useRef(false);
  const lastTriggeredMinRef = useRef('');

  const fetchScreenshots = async () => {
    const all: ScreenshotRecord[] = [];

    // Local screenshots (captured via Python/Selenium on this machine)
    try {
      const res = await fetch(API_BASE + '/api/screenshots');
      if (res.ok) {
        const local = await res.json();
        all.push(...local.map((s: any) => ({ ...s, source: 'local' })));
      }
    } catch {}

    // Firebase screenshots (from GitHub Actions — auto-synced)
    try {
      const q = query(collection(firestoreDb, 'screenshots'), orderBy('captured_at', 'desc'));
      const snap = await getDocs(q);
      snap.docs.forEach(doc => {
        const d = doc.data();
        all.push({
          id: doc.id,
          url: d.url || '',
          filename: d.filename || '',
          captured_at: d.captured_at || new Date().toISOString(),
          storage_url: d.storage_url,
          source: 'github-actions',
        });
      });
      console.log(`[Screenshots] Firestore: ${snap.docs.length} records`);
    } catch (err) {
      console.error('[Screenshots] Firestore fetch failed:', err);
    }

    all.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    setScreenshots(all);
  };

  useEffect(() => {
    fetchScreenshots();
    // Live listener — new GitHub Actions screenshot appears instantly
    const q = query(collection(firestoreDb, 'screenshots'), orderBy('captured_at', 'desc'));
    const unsub = onSnapshot(
      q,
      () => fetchScreenshots(),
      (err) => console.error('[Screenshots] Firestore listener error:', err)
    );
    return () => unsub();
  }, []);

  // Persist node positions and edges to localStorage
  useEffect(() => { try { localStorage.setItem('wf_nodes', JSON.stringify(nodes)); } catch {} }, [nodes]);
  useEffect(() => { try { localStorage.setItem('wf_edges', JSON.stringify(edges)); } catch {} }, [edges]);

  // Keep screenshotsRef in sync so handleExecute can read latest count without stale closures
  useEffect(() => { screenshotsRef.current = screenshots; }, [screenshots]);

  // Keep executing ref in sync (used by scheduler to avoid double-fire)
  useEffect(() => { executingRef.current = executing; }, [executing]);

  // ── Auto-scheduler: fires the workflow when the schedule node's time is reached ──
  useEffect(() => {
    if (!liveMode) return;
    const scheduleNode = nodes.find(n => n.type === 'schedule');
    if (!scheduleNode) return;

    const check = () => {
      if (executingRef.current) return;
      const freq = scheduleNode.config.frequency || 'daily';
      const [hh, mm] = (scheduleNode.config.time || '09:00').split(':').map(Number);
      const now = new Date();
      const H = now.getHours(), M = now.getMinutes();

      let match = false;
      if      (freq === 'hourly')   match = M === 0;
      else if (freq === 'daily')    match = H === hh && M === mm;
      else if (freq === 'weekly')   match = now.getDay() === 1 && H === hh && M === mm;
      else if (freq === 'monthly')  match = now.getDate() === 1 && H === hh && M === mm;

      // Use a "date + H:M" key to fire at most once per matching minute
      const key = `${now.toDateString()}_${H}_${M}`;
      if (match && lastTriggeredMinRef.current !== key) {
        lastTriggeredMinRef.current = key;
        handleExecuteRef.current();
      }
    };

    check(); // Check immediately in case we just enabled live mode at the right moment
    const id = setInterval(check, 15_000); // Re-check every 15 s for responsiveness
    return () => clearInterval(id);
  }, [liveMode, nodes]);

  // Countdown label — updates every 5 s so the header shows "fires in Xm Ys"
  useEffect(() => {
    const scheduleNode = nodes.find(n => n.type === 'schedule');
    if (!liveMode || !scheduleNode) { setNextTriggerIn(''); return; }

    const compute = () => {
      const freq = scheduleNode.config.frequency || 'daily';
      const [hh, mm] = (scheduleNode.config.time || '09:00').split(':').map(Number);
      const now = new Date();
      let next = new Date(now);

      if (freq === 'hourly') {
        next.setMinutes(0, 0, 0);
        if (next <= now) next = new Date(next.getTime() + 3_600_000);
      } else if (freq === 'daily') {
        next.setHours(hh, mm, 0, 0);
        if (next <= now) next = new Date(next.getTime() + 86_400_000);
      } else if (freq === 'weekly') {
        const daysUntilMon = (1 - now.getDay() + 7) % 7 || 7;
        next.setDate(now.getDate() + daysUntilMon);
        next.setHours(hh, mm, 0, 0);
        if (next <= now) next = new Date(next.getTime() + 7 * 86_400_000);
      } else {
        next.setDate(1); next.setHours(hh, mm, 0, 0);
        if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(1); }
      }

      const diff = Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setNextTriggerIn(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };

    compute();
    const id = setInterval(compute, 5_000);
    return () => clearInterval(id);
  }, [liveMode, nodes]);

  // Keep modal in sync when node config changes
  useEffect(() => {
    if (nodeModal) {
      const updated = nodes.find(n => n.id === nodeModal.id);
      if (updated) setNodeModal(updated);
    }
  }, [nodes]);

  // ── Global mouse tracking ──────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const wr = wrapperRef.current; if (!wr) return;
      const rect = wr.getBoundingClientRect();
      const x = e.clientX - rect.left + wr.scrollLeft;
      const y = e.clientY - rect.top  + wr.scrollTop;
      setMousePos({ x, y });
      if (dragging.current) {
        dragMoved.current = true;
        const { nodeId, offX, offY } = dragging.current;
        setNodes(prev => prev.map(n =>
          n.id === nodeId ? { ...n, x: Math.max(0, x - offX), y: Math.max(0, y - offY) } : n
        ));
      }
    };
    const onUp = () => { dragging.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Node interaction ────────────────────────────────────────────────────────
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).closest('[data-port]')) return;
    e.preventDefault(); e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId)!;
    const wr = wrapperRef.current!;
    const rect = wr.getBoundingClientRect();
    const mx = e.clientX - rect.left + wr.scrollLeft;
    const my = e.clientY - rect.top  + wr.scrollTop;
    dragging.current = { nodeId, offX: mx - node.x, offY: my - node.y };
    dragMoved.current = false;
    setSelectedId(nodeId);
  };

  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (dragMoved.current) return; // was a drag, not a click
    const node = nodes.find(n => n.id === nodeId);
    if (node) { setNodeModal(node); setEditorTab('code'); }
  };

  const handleOutputPortClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setConnectingFrom(prev => prev === nodeId ? null : nodeId);
  };

  const handleInputPortClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (connectingFrom && connectingFrom !== nodeId) {
      if (!edges.some(ed => ed.fromId === connectingFrom && ed.toId === nodeId)) {
        setEdges(prev => [...prev, { id: `e-${Date.now()}`, fromId: connectingFrom, toId: nodeId }]);
      }
      setConnectingFrom(null);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.wf-node')) return;
    setSelectedId(null); setConnectingFrom(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(ed => ed.fromId !== nodeId && ed.toId !== nodeId));
    setSelectedId(null); setNodeModal(null);
  };

  const handleUpdateConfig = (nodeId: string, key: string, value: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n));
  };

  const handleUpdateLabel = (nodeId: string, label: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n));
  };

  const handleAddNode = (def: NodeTypeDef) => {
    const id = `n-${Date.now()}`;
    const wr = wrapperRef.current!;
    const x = wr.scrollLeft + 150 + Math.random() * 250;
    const y = wr.scrollTop  + 200 + Math.random() * 150;
    const newNode: WFNode = { id, type: def.type, label: def.label, icon: def.icon, color: def.color, x, y, status: 'idle', config: { ...def.defaultConfig } };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(id); setNodeModal(newNode); setEditorTab('params');
  };

  // Polls screenshotsRef until a new screenshot arrives (count > prevCount) or times out
  const waitForNewScreenshot = (prevCount: number, timeoutMs = 120_000): Promise<boolean> =>
    new Promise(resolve => {
      const start = Date.now();
      const check = setInterval(() => {
        if (screenshotsRef.current.length > prevCount) {
          clearInterval(check); resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(check); resolve(false);
        }
      }, 2000);
    });

  // ── Execute ────────────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true); setNodeLog({}); setSelectedId(null);
    setNodes(prev => prev.map(n => ({ ...n, status: 'idle' })));
    await sleep(250);
    const order = getExecutionOrder(nodes, edges);
    const log = (nodeId: string, msg: string) =>
      setNodeLog(prev => ({ ...prev, [nodeId]: [...(prev[nodeId] ?? []), msg] }));
    for (const id of order) {
      const node = nodes.find(n => n.id === id); if (!node) continue;
      log(id, '⏳ Running…');
      setNodes(prev => prev.map(n => n.id === id ? { ...n, status: 'running' } : n));
      if (node.type === 'screenshot' && node.config.url) {
        const prevCount = screenshotsRef.current.length;
        try {
          const selector = node.config.selector?.trim() || '';
          log(id, `📸 Triggering GitHub Actions…`);
          if (selector) log(id, `🎯 Selector: ${selector}`);
          const r = await fetch(API_BASE + '/api/trigger-screenshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: node.config.url, selector }),
          });
          if (r.ok) {
            log(id, '⏳ Waiting for screenshot…');
            const arrived = await waitForNewScreenshot(prevCount, 120_000);
            if (arrived) {
              log(id, '📥 Screenshot received');
            } else {
              log(id, '⚠ Timed out — check Actions');
            }
          } else {
            const err = await r.json().catch(() => ({}));
            log(id, `⚠ Trigger failed: ${err.error || r.status}`);
          }
        } catch { log(id, '⚠ Couldn\'t reach GitHub'); }
      } else if (node.type === 'facebook') {
        const latestShot  = screenshotsRef.current[0];
        const imageUrl    = latestShot?.storage_url || '';
        const recipientId = node.config.recipientId?.trim() || '';
        const message     = node.config.message?.trim() || '';
        if (!recipientId) {
          log(id, '⚠ No Recipient PSID set');
        } else {
          try {
            log(id, '📘 Sending to Messenger…');
            if (imageUrl) log(id, '🖼 Attaching screenshot');
            const r = await fetch(API_BASE + '/api/send-facebook-message', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipientId, message, imageUrl }),
            });
            const data = await r.json() as any;
            if (r.ok) {
              log(id, '✓ Message sent');
            } else {
              log(id, `⚠ ${data.error || r.status}`);
            }
          } catch { log(id, '⚠ Couldn\'t reach Facebook'); }
        }
      } else {
        await sleep(750 + Math.random() * 750);
      }
      setNodes(prev => prev.map(n => n.id === id ? { ...n, status: 'success' } : n));
      log(id, '✓ Done');
      await sleep(180);
    }
    setExecuting(false);
  };

  // Always keep the ref pointing to the latest handleExecute (avoids stale closure in scheduler)
  useEffect(() => { handleExecuteRef.current = handleExecute; });

  const handleReset = () => {
    localStorage.removeItem('wf_nodes'); localStorage.removeItem('wf_edges');
    setNodes(INITIAL_NODES); setEdges(INITIAL_EDGES);
    setSelectedId(null); setConnectingFrom(null); setNodeLog({}); setNodeModal(null);
  };

  // ── SVG paths ──────────────────────────────────────────────────────────────
  const getPath = (fromId: string, toId: string) => {
    const f = nodes.find(n => n.id === fromId); const t = nodes.find(n => n.id === toId);
    if (!f || !t) return '';
    const x1 = f.x + NODE_W; const y1 = f.y + NODE_H / 2;
    const x2 = t.x;           const y2 = t.y + NODE_H / 2;
    const cp = Math.max(60, Math.abs(x2 - x1) * 0.42);
    return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
  };

  const getTempPath = () => {
    if (!connectingFrom) return '';
    const f = nodes.find(n => n.id === connectingFrom); if (!f) return '';
    const x1 = f.x + NODE_W; const y1 = f.y + NODE_H / 2;
    const cp = Math.max(50, Math.abs(mousePos.x - x1) * 0.4);
    return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${mousePos.x - cp} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`;
  };

  const triggers = NODE_TYPE_DEFS.filter(d => d.category === 'trigger');
  const actions  = NODE_TYPE_DEFS.filter(d => d.category === 'action');

  return (
    <div className="bg-[#0a0510] text-white flex flex-col" style={{ height: '100vh', overflow: 'hidden' }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes wf-pulse { 0%,100%{opacity:1;box-shadow:0 0 6px #ffd700,0 0 14px #ffd70080}50%{opacity:.55;box-shadow:0 0 2px #ffd700} }
        @keyframes wf-dash  { to{stroke-dashoffset:-20} }
        .wf-running-dot { animation: wf-pulse .75s ease-in-out infinite; }
        .wf-temp-line   { animation: wf-dash .4s linear infinite; }
      `}</style>

      {/* ── Header ── */}
      <header className="shrink-0 border-b border-white/10 px-5 flex items-center gap-3"
        style={{ height: 52, background: 'rgba(8,4,14,0.97)', backdropFilter: 'blur(16px)' }}>
        <button onClick={onBackToHub}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-[#ff00ff] transition-all text-xs font-bold shrink-0">
          ← Hub
        </button>
        <div className="w-px h-5 bg-white/10 shrink-0" />
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black"
            style={{ background: 'linear-gradient(135deg,#ff00ff,#a855f7)', boxShadow: '0 0 12px rgba(255,0,255,.4)' }}>⚡</div>
          <span className="text-sm font-bold tracking-tight">Workflow Automation</span>
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 border border-white/10 px-1.5 py-0.5 rounded-md">BETA</span>
        </div>
        <div className="flex-1" />
        <button onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all text-xs font-bold">
          <RotateCcw size={11} /> Reset
        </button>
        <button onClick={handleExecute} disabled={executing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-xs font-bold transition-all disabled:opacity-60"
          style={{ background: executing ? 'rgba(255,0,255,.25)' : '#ff00ff', boxShadow: executing ? 'none' : '0 0 20px rgba(255,0,255,.4)' }}>
          <Play size={12} fill="white" />{executing ? 'Running…' : 'Execute Workflow'}
        </button>
        <button onClick={() => {
            const next = !liveMode;
            setLiveMode(next);
            const sched = nodes.find(n => n.type === 'schedule');
            const fb    = nodes.find(n => n.type === 'facebook');
            const shot  = nodes.find(n => n.type === 'screenshot');
            fetch(API_BASE + '/api/schedule', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                enabled:       next,
                frequency:     sched?.config.frequency  || 'daily',
                time:          sched?.config.time        || '09:00',
                timezone:      sched?.config.timezone    || 'Pacific/Honolulu',
                screenshotUrl: shot?.config.url          || '',
                selector:      shot?.config.selector     || '',
                recipientId:   fb?.config.recipientId    || '',
                message:       fb?.config.message        || '',
              }),
            }).catch(() => {});
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all"
          style={{ borderColor: liveMode ? 'rgba(0,204,122,.4)' : 'rgba(255,255,255,.1)', background: liveMode ? 'rgba(0,204,122,.08)' : 'rgba(255,255,255,.03)', color: liveMode ? '#00cc7a' : '#64748b' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: liveMode ? '#00cc7a' : '#64748b', boxShadow: liveMode ? '0 0 6px #00cc7a' : 'none' }} />
          {liveMode ? 'Live' : 'Test Mode'}
          {liveMode && nextTriggerIn && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(0,204,122,.15)', color: '#00cc7a', border: '1px solid rgba(0,204,122,.25)' }}>
              ⏰ {nextTriggerIn}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 pl-2 border-l border-white/10">
          <div className="w-7 h-7 rounded-full overflow-hidden" style={{ border: `2px solid ${roleColor}` }}>
            <img src={currentUser.photo || `https://picsum.photos/seed/${currentUser.id}/100/100`} className="w-full h-full object-cover" alt="" />
          </div>
          <button onClick={onLogout} className="p-1.5 text-slate-500 hover:text-white transition-colors"><LogOut size={15} /></button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <aside className="shrink-0 border-r border-white/8 flex flex-col py-4 overflow-y-auto"
          style={{ width: 172, background: 'rgba(5,2,10,.98)' }}>
          <p className="px-4 mb-2 text-[9px] font-black uppercase tracking-[.22em] text-slate-600">Triggers</p>
          <div className="flex flex-col gap-0.5 px-2 mb-4">
            {triggers.map(d => <SidebarItem key={d.type} def={d} onAdd={handleAddNode} />)}
          </div>
          <div className="mx-4 border-t border-white/6 mb-4" />
          <p className="px-4 mb-2 text-[9px] font-black uppercase tracking-[.22em] text-slate-600">Actions</p>
          <div className="flex flex-col gap-0.5 px-2">
            {actions.map(d => <SidebarItem key={d.type} def={d} onAdd={handleAddNode} />)}
          </div>
          <div className="mt-auto px-4 pt-4 border-t border-white/6">
            <p className="text-[9px] text-slate-600 leading-relaxed">
              Click a node to <span style={{ color: '#a855f7' }}>view its code</span>. Drag to reposition. Click ● to connect.
            </p>
          </div>
        </aside>

        {/* Right column: canvas + screenshots */}
        <div className="flex-1 flex flex-col overflow-hidden">

        {/* Canvas wrapper */}
        <div ref={wrapperRef} className="flex-1 overflow-auto"
          style={{ cursor: connectingFrom ? 'crosshair' : 'default', minHeight: 0 }}
          onClick={handleCanvasClick}>
          <div style={{ width: CANVAS_W, height: CANVAS_H, position: 'relative',
            backgroundImage: 'radial-gradient(circle,rgba(255,255,255,.055) 1px,transparent 1px)',
            backgroundSize: '24px 24px' }}>
            {/* Ambient glow */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 60% 50% at 30% 35%,rgba(255,0,255,.04) 0%,transparent 70%)' }} />

            {/* SVG connections */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
              <defs>
                {(['Idle','Running','Success'] as const).map(s => (
                  <marker key={s} id={`arr${s}`} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                    <path d="M 0 0.5 L 6 3.5 L 0 6.5 z" fill={s==='Running'?'#ffd700':s==='Success'?'#00cc7a':'rgba(255,255,255,.18)'} />
                  </marker>
                ))}
              </defs>
              {edges.map(edge => {
                const from = nodes.find(n => n.id === edge.fromId);
                const to   = nodes.find(n => n.id === edge.toId);
                if (!from || !to) return null;
                const isRun = from.status === 'running'; const isOk = from.status === 'success';
                const col = isOk ? '#00cc7a' : isRun ? '#ffd700' : 'rgba(255,255,255,.13)';
                const mark = isOk ? 'arrSuccess' : isRun ? 'arrRunning' : 'arrIdle';
                return (
                  <path key={edge.id} d={getPath(edge.fromId, edge.toId)}
                    stroke={col} strokeWidth={isRun||isOk?2.5:1.8} fill="none"
                    markerEnd={`url(#${mark})`}
                    style={{ transition: 'stroke .5s,stroke-width .3s' }} />
                );
              })}
              {connectingFrom && getTempPath() && (
                <path d={getTempPath()} className="wf-temp-line" stroke="#ff00ff" strokeWidth="2" fill="none" strokeDasharray="7 4" />
              )}
            </svg>

            {/* Nodes */}
            {nodes.map(node => (
              <WFNodeCard key={node.id} node={node}
                selected={selectedId === node.id}
                connecting={connectingFrom === node.id}
                logs={nodeLog[node.id]}
                onMouseDown={handleNodeMouseDown}
                onClick={handleNodeClick}
                onOutputPortClick={handleOutputPortClick}
                onInputPortClick={handleInputPortClick} />
            ))}

            {nodes.length === 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div className="text-center"><p className="text-5xl mb-4">⚡</p><p className="text-sm font-bold text-slate-500">Click a node type in the sidebar to get started</p></div>
              </div>
            )}
          </div>
        </div>{/* end canvas wrapper */}

        {/* ── Screenshots Panel ── */}
        <div className="shrink-0 border-t border-white/10 flex flex-col"
          style={{ height: 260, background: 'rgba(5,2,10,.98)' }}>
          {/* Panel header */}
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/6 shrink-0">
            <Camera size={13} style={{ color: '#00cc7a' }} />
            <span className="text-xs font-bold text-white">Screenshot History</span>
            {screenshots.length > 0 && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                style={{ background: '#00cc7a18', color: '#00cc7a', border: '1px solid #00cc7a30' }}>
                {screenshots.length}
              </span>
            )}
            <div className="flex-1" />
            {/* Hidden file input for upload */}
            <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,image/*" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return;
                setCapturing(true);
                const reader = new FileReader();
                reader.onload = async (ev) => {
                  try {
                    const base64 = ev.target?.result as string;
                    const screenshotNode = nodes.find(n => n.type === 'screenshot');
                    const r = await fetch(API_BASE + '/api/screenshots/upload', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ base64, source_url: screenshotNode?.config?.url || 'GitHub Actions' }),
                    });
                    if (r.ok) await fetchScreenshots();
                  } catch {}
                  setCapturing(false);
                };
                reader.readAsDataURL(file);
                e.target.value = '';
              }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={capturingScreenshot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)', color: '#94a3b8' }}>
              <Upload size={11} />
              Upload PNG
            </button>
            <button
              onClick={async () => {
                const screenshotNode = nodes.find(n => n.type === 'screenshot');
                const url = screenshotNode?.config?.url || window.prompt('Enter URL to screenshot:') || '';
                if (!url) return;
                setCapturing(true);
                try {
                  const r = await fetch(API_BASE + '/api/screenshots/capture', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                  });
                  if (r.ok) await fetchScreenshots();
                } catch {}
                setCapturing(false);
              }}
              disabled={capturingScreenshot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              style={{ background: 'rgba(0,204,122,.1)', border: '1px solid rgba(0,204,122,.25)', color: '#00cc7a' }}>
              <Camera size={11} />
              {capturingScreenshot ? 'Capturing…' : 'Take Screenshot'}
            </button>
          </div>
          {/* Screenshots list */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {screenshots.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-slate-600">No screenshots yet — execute the workflow or click "Take Screenshot".</p>
              </div>
            ) : (
              <div className="grid gap-3 px-5 py-3" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {screenshots.map(shot => (
                  <div key={shot.id}
                    className="flex flex-col rounded-2xl overflow-hidden border border-white/8 group cursor-pointer hover:border-white/20 transition-all"
                    style={{ background: 'rgba(10,5,18,.9)' }}
                    onClick={() => window.open(shot.storage_url || `/screenshots/${shot.filename}`, '_blank')}>
                    <div className="relative overflow-hidden bg-slate-900" style={{ height: 108 }}>
                      <img src={shot.storage_url || `/screenshots/${shot.filename}`} alt={shot.url}
                        className="w-full h-full object-cover object-top" />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                        style={{ background: 'rgba(0,0,0,.55)' }}>
                        <span className="text-[10px] font-black text-white tracking-widest uppercase">Open ↗</span>
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-300 truncate" title={shot.url}>
                        {shot.url.replace(/^https?:\/\//, '')}
                      </p>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-[9px] text-slate-600">
                          {new Date(shot.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' · '}{new Date(shot.captured_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {shot.source === 'github-actions' && (
                          <span className="text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded"
                            style={{ background: 'rgba(255,149,0,.12)', color: '#ff9500' }}>GH</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>{/* end screenshots panel */}

        </div>{/* end right column */}
      </div>


      {/* ── Node Editor Modal ── */}
      {nodeModal && (
        <NodeEditorModal
          node={nodeModal}
          tab={editorTab}
          onTabChange={setEditorTab}
          onUpdateConfig={handleUpdateConfig}
          onUpdateLabel={handleUpdateLabel}
          onDelete={handleDeleteNode}
          onClose={() => { setNodeModal(null); setSelectedId(null); }}
        />
      )}
    </div>
  );
}

// ── Sidebar Item ───────────────────────────────────────────────────────────────
function SidebarItem({ def, onAdd }: { def: NodeTypeDef; onAdd: (d: NodeTypeDef) => void }) {
  return (
    <button onClick={() => onAdd(def)}
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all text-left w-full group"
      style={{ color: '#94a3b8' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = def.color + '12'; (e.currentTarget as HTMLElement).style.color = '#e2e8f0'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}>
      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0"
        style={{ background: def.color + '18', border: `1px solid ${def.color}28` }}>{def.icon}</div>
      <span className="flex-1 truncate">{def.label}</span>
      <Plus size={10} className="opacity-0 group-hover:opacity-50 shrink-0 transition-opacity" />
    </button>
  );
}

// ── Workflow Node Card ─────────────────────────────────────────────────────────
interface WFNodeCardProps {
  node: WFNode; selected: boolean; connecting: boolean;
  logs?: string[];
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onOutputPortClick: (e: React.MouseEvent, id: string) => void;
  onInputPortClick:  (e: React.MouseEvent, id: string) => void;
}

function WFNodeCard({ node, selected, connecting, logs, onMouseDown, onClick, onOutputPortClick, onInputPortClick }: WFNodeCardProps) {
  const sc = STATUS_COLOR[node.status];
  return (
    <div className="wf-node"
      style={{ position: 'absolute', left: node.x, top: node.y, width: NODE_W, height: NODE_H, zIndex: selected ? 20 : 5, userSelect: 'none', cursor: 'grab' }}
      onMouseDown={e => onMouseDown(e, node.id)}
      onClick={e => onClick(e, node.id)}>
      {/* Card */}
      <div style={{
        width: '100%', height: '100%', position: 'relative',
        background: selected ? 'rgba(18,8,30,.99)' : 'rgba(10,5,18,.96)',
        borderRadius: 14,
        border: `1.5px solid ${selected ? node.color + '90' : 'rgba(255,255,255,.08)'}`,
        boxShadow: selected ? `0 0 0 2.5px ${node.color}22,0 10px 40px rgba(0,0,0,.7)` : '0 4px 24px rgba(0,0,0,.55)',
        backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center',
        gap: 12, padding: '0 16px 0 20px', overflow: 'hidden',
        transition: 'border-color .2s,box-shadow .25s',
      }}>
        {/* Accent stripe */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
          background: `linear-gradient(to bottom,${node.color}dd,${node.color}55)`, borderRadius: '14px 0 0 14px' }} />
        {/* Icon */}
        <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: node.color + '18', border: `1px solid ${node.color}32`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>{node.icon}</div>
        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', margin: 0, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
            <div className={node.status === 'running' ? 'wf-running-dot' : ''}
              style={{ width: 5, height: 5, borderRadius: '50%', background: sc,
                boxShadow: node.status === 'success' ? `0 0 5px ${sc}` : undefined, transition: 'background .35s' }} />
            <span style={{ fontSize: 9, color: sc, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.12em', transition: 'color .35s' }}>{node.status}</span>
          </div>
        </div>
        {/* "View code" hint */}
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,.18)', fontFamily: 'monospace', flexShrink: 0, letterSpacing: '.05em' }}>{'</>'}</div>
        {/* Glow */}
        <div style={{ position: 'absolute', right: -20, bottom: -20, width: 70, height: 70,
          borderRadius: '50%', background: node.color, filter: 'blur(24px)',
          opacity: selected ? .16 : node.status === 'running' ? .22 : .06, transition: 'opacity .4s' }} />
      </div>
      {/* Input port */}
      <div data-port="input" onClick={e => onInputPortClick(e, node.id)} title="Drop connection here"
        style={{ position: 'absolute', left: -(PORT_R + .5), top: NODE_H / 2 - PORT_R,
          width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%', background: '#0a0510',
          border: '2px solid rgba(255,255,255,.18)', cursor: 'pointer', zIndex: 3, transition: 'border-color .15s,transform .15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor='#ff00ff'; (e.currentTarget as HTMLDivElement).style.transform='scale(1.35)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor='rgba(255,255,255,.18)'; (e.currentTarget as HTMLDivElement).style.transform='scale(1)'; }} />
      {/* Output port */}
      <div data-port="output" onClick={e => onOutputPortClick(e, node.id)} title="Click to connect"
        style={{ position: 'absolute', right: -(PORT_R + .5), top: NODE_H / 2 - PORT_R,
          width: PORT_R * 2, height: PORT_R * 2, borderRadius: '50%',
          background: connecting ? node.color : '#0a0510',
          border: `2px solid ${connecting ? node.color : selected ? node.color + '80' : 'rgba(255,255,255,.18)'}`,
          cursor: 'crosshair', zIndex: 3, boxShadow: connecting ? `0 0 12px ${node.color}` : 'none',
          transition: 'border-color .15s,background .15s,transform .15s,box-shadow .2s' }}
        onMouseEnter={e => { const d = e.currentTarget as HTMLDivElement; d.style.transform='scale(1.35)'; d.style.background=node.color; d.style.boxShadow=`0 0 10px ${node.color}80`; }}
        onMouseLeave={e => { const d = e.currentTarget as HTMLDivElement; d.style.transform='scale(1)'; d.style.background=connecting?node.color:'#0a0510'; d.style.boxShadow=connecting?`0 0 12px ${node.color}`:'none'; }} />
      {/* Per-node execution log — appears below node, moves with drag */}
      {logs && logs.length > 0 && (
        <div style={{
          position: 'absolute', top: NODE_H + 7, left: 0, width: NODE_W,
          background: 'rgba(5,2,10,.97)',
          border: `1px solid ${node.color}28`,
          borderRadius: 9, padding: '5px 10px', zIndex: 10, pointerEvents: 'none',
        }}>
          {/* Notch connecting bubble to node */}
          <div style={{
            position: 'absolute', top: -5, left: NODE_W / 2 - 5,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderBottom: `5px solid ${node.color}28`,
          }} />
          {logs.map((line, i) => (
            <p key={i} style={{
              fontSize: 9, fontFamily: 'monospace', margin: 0, lineHeight: '1.75',
              color: line.startsWith('✓') ? '#00cc7a'
                   : line.startsWith('⚠') ? '#ff7849'
                   : line.startsWith('⏳') ? '#ffd700'
                   : line.startsWith('📥') ? '#00cc7a'
                   : '#94a3b8',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Node Editor Modal ──────────────────────────────────────────────────────────
interface ModalProps {
  node: WFNode; tab: EditorTab;
  onTabChange: (t: EditorTab) => void;
  onUpdateConfig: (id: string, key: string, val: string) => void;
  onUpdateLabel:  (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function NodeEditorModal({ node, tab, onTabChange, onUpdateConfig, onUpdateLabel, onDelete, onClose }: ModalProps) {
  const codeHtml = highlightCode(getNodeCode(node));
  const outputHtml = highlightCode(getNodeOutput(node));
  const [applying, setApplying]       = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleApplySchedule = async () => {
    setApplying(true); setApplyResult(null);

    const frequency = node.config.frequency || 'daily';
    const time      = node.config.time      || '09:00';
    const timezone  = node.config.timezone  || 'Pacific/Honolulu';

    // ── Build UTC cron pattern ────────────────────────────────────────────────
    const [localH, localM] = time.split(':').map(Number);
    const now     = new Date();
    const utcMs   = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    const localMs = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getTime();
    const offsetH = Math.round((utcMs - localMs) / 3_600_000);
    const utcH    = ((localH + offsetH) % 24 + 24) % 24;
    const cronPat =
      frequency === 'hourly'  ? '0 * * * *'                  :
      frequency === 'weekly'  ? `${localM} ${utcH} * * 1`    :
      frequency === 'monthly' ? `${localM} ${utcH} 1 * *`    :
                                `${localM} ${utcH} * * *`;    // daily
    const utcLabel = `${utcH}:${String(localM).padStart(2,'0')} UTC`;

    // ── Try direct GitHub API call first (works on live site) ────────────────
    const ghToken = (import.meta.env.VITE_GITHUB_TOKEN as string) || '';
    const OWNER = 'johndave090909-droid';
    const REPO  = 'Workflow_Manager';
    const PATH  = '.github/workflows/screenshot.yml';
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
    const ghHeaders = {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };

    if (ghToken) {
      try {
        const getR = await fetch(apiUrl, { headers: ghHeaders });
        const getD = await getR.json() as any;
        if (!getR.ok) { setApplyResult({ ok: false, msg: `⚠ GitHub: ${getD.message}` }); setApplying(false); return; }

        const currentYaml = atob(getD.content.replace(/\n/g, ''));
        const updatedYaml = currentYaml.replace(/([ \t]*- cron: ")[^"]+(")/,`$1${cronPat}$2`);

        if (updatedYaml !== currentYaml) {
          const putR = await fetch(apiUrl, {
            method: 'PUT', headers: ghHeaders,
            body: JSON.stringify({
              message: `chore: set schedule to ${frequency} at ${time} ${timezone}`,
              content: btoa(updatedYaml),
              sha: getD.sha,
            }),
          });
          const putD = await putR.json() as any;
          if (!putR.ok) { setApplyResult({ ok: false, msg: `⚠ GitHub: ${putD.message}` }); setApplying(false); return; }
        }
        setApplyResult({ ok: true, msg: `✓ Schedule updated — cron "${cronPat}" (${utcLabel})` });
        setApplying(false); return;
      } catch {
        // fall through to backend
      }
    }

    // ── Fallback: call backend (localhost dev) ────────────────────────────────
    try {
      const r = await fetch(API_BASE + '/api/github-schedule', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency, time, timezone }),
      });
      const d = await r.json() as any;
      if (r.ok) {
        setApplyResult({ ok: true, msg: `✓ Schedule updated — cron "${d.cronPat}" (${d.utcLabel})` });
      } else {
        setApplyResult({ ok: false, msg: `⚠ ${d.error || 'Unknown error'}` });
      }
    } catch {
      setApplyResult({ ok: false, msg: '⚠ No backend or GitHub token — set VITE_GITHUB_TOKEN to use on live site' });
    }
    setApplying(false);
  };

  const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
    { id: 'code',   label: 'Code',       icon: <Code2    size={12} /> },
    { id: 'params', label: 'Parameters', icon: <Settings2 size={12} /> },
    { id: 'output', label: 'Output',     icon: <Terminal  size={12} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(5,2,10,.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div
        className="flex flex-col rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
        style={{ width: 760, maxHeight: '85vh', background: '#09051a', boxShadow: `0 0 0 1px rgba(255,255,255,.06), 0 40px 120px rgba(0,0,0,.8), 0 0 60px ${node.color}18` }}
        onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-white/8 shrink-0"
          style={{ background: 'rgba(255,255,255,.02)' }}>
          {/* Left accent */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: node.color + '18', border: `1.5px solid ${node.color}40` }}>{node.icon}</div>
          <div className="flex-1 min-w-0">
            <input
              className="text-sm font-bold bg-transparent outline-none text-white w-full border-b border-transparent hover:border-white/20 focus:border-white/30 transition-colors pb-0.5"
              value={node.label}
              onChange={e => onUpdateLabel(node.id, e.target.value)}
              onClick={e => e.stopPropagation()} />
            <p className="text-[10px] font-black uppercase tracking-widest mt-1" style={{ color: node.color }}>
              {node.type.replace(/_/g, ' ')} · {node.category}
            </p>
          </div>
          {/* Status badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border shrink-0"
            style={{ borderColor: STATUS_COLOR[node.status] + '40', background: STATUS_COLOR[node.status] + '12' }}>
            <div className={node.status === 'running' ? 'wf-running-dot' : ''}
              style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[node.status] }} />
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: STATUS_COLOR[node.status] }}>
              {node.status}
            </span>
          </div>
          <button onClick={onClose}
            className="p-2 text-slate-600 hover:text-white hover:bg-white/5 transition-all rounded-xl">
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-0 shrink-0 border-b border-white/6">
          {TABS.map(t => (
            <button key={t.id} onClick={() => onTabChange(t.id)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-t-xl transition-all border-b-2"
              style={{
                color: tab === t.id ? node.color : '#64748b',
                borderBottomColor: tab === t.id ? node.color : 'transparent',
                background: tab === t.id ? node.color + '10' : 'transparent',
              }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ── CODE TAB ── */}
        {tab === 'code' && (
          <div className="flex-1 overflow-auto" style={{ background: '#06030f' }}>
            {/* Code toolbar */}
            <div className="flex items-center justify-between px-6 py-2.5 border-b border-white/6 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Node.js</span>
                <span className="text-[9px] text-slate-700">·</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Read-only</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              </div>
            </div>
            {/* Code body */}
            <div className="overflow-auto" style={{ maxHeight: 'calc(85vh - 200px)' }}>
              <table className="w-full border-collapse" style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: 12.5, lineHeight: 1.7 }}>
                <tbody>
                  {getNodeCode(node).split('\n').map((line, i) => (
                    <tr key={i} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="text-right pr-5 pl-5 select-none align-top"
                        style={{ color: '#2d3748', minWidth: 48, fontSize: 11, paddingTop: 0, paddingBottom: 0, borderRight: '1px solid rgba(255,255,255,.04)' }}>
                        {i + 1}
                      </td>
                      <td className="pl-5 pr-8 align-top" style={{ paddingTop: 0, paddingBottom: 0 }}>
                        <span dangerouslySetInnerHTML={{ __html: highlightCode(line) || '&nbsp;' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PARAMETERS TAB ── */}
        {tab === 'params' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-5 max-w-lg">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Node Label</label>
                <input
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}
                  value={node.label}
                  onChange={e => onUpdateLabel(node.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onFocus={e => { e.currentTarget.style.borderColor = node.color + '70'; e.currentTarget.style.boxShadow = `0 0 0 3px ${node.color}18`; }}
                  onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; e.currentTarget.style.boxShadow = 'none'; }} />
              </div>
              <div className="border-t border-white/6 pt-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Configuration</p>
                <div className="space-y-4">
                  {node.type === 'schedule' ? (
                    <>
                      {/* Frequency pills */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Frequency</label>
                        <div className="grid grid-cols-4 gap-2">
                          {(['hourly','daily','weekly','monthly'] as const).map(freq => {
                            const active = (node.config.frequency || 'daily') === freq;
                            return (
                              <button key={freq} onClick={e => { e.stopPropagation(); onUpdateConfig(node.id, 'frequency', freq); }}
                                className="py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                                style={{
                                  background: active ? node.color + '22' : 'rgba(255,255,255,.04)',
                                  border: `1px solid ${active ? node.color + '60' : 'rgba(255,255,255,.08)'}`,
                                  color: active ? node.color : '#64748b',
                                  boxShadow: active ? `0 0 10px ${node.color}20` : 'none',
                                }}>
                                {freq}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {/* Time picker — hidden for hourly */}
                      {node.config.frequency !== 'hourly' && (
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Time</label>
                          <input
                            type="time" value={node.config.time || '09:00'}
                            onChange={e => onUpdateConfig(node.id, 'time', e.target.value)}
                            className="rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all"
                            style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', colorScheme: 'dark', width: '100%' }}
                            onClick={e => e.stopPropagation()}
                            onFocus={e => { e.currentTarget.style.borderColor = node.color + '60'; e.currentTarget.style.boxShadow = `0 0 0 3px ${node.color}14`; }}
                            onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; e.currentTarget.style.boxShadow = 'none'; }} />
                        </div>
                      )}
                      {/* Timezone */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">Timezone</label>
                        <input
                          type="text" value={node.config.timezone || 'Pacific/Honolulu'}
                          onChange={e => onUpdateConfig(node.id, 'timezone', e.target.value)}
                          className="w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all"
                          style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', fontFamily: 'inherit' }}
                          onClick={e => e.stopPropagation()}
                          onFocus={e => { e.currentTarget.style.borderColor = node.color + '60'; e.currentTarget.style.boxShadow = `0 0 0 3px ${node.color}14`; }}
                          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; e.currentTarget.style.boxShadow = 'none'; }} />
                      </div>
                      {/* Apply to GitHub */}
                      <div className="pt-2 border-t border-white/6">
                        <p className="text-[10px] text-slate-600 mb-3">
                          This updates the GitHub Actions workflow directly — no server or browser needs to be running.
                        </p>
                        <button
                          onClick={e => { e.stopPropagation(); handleApplySchedule(); }}
                          disabled={applying}
                          className="w-full py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                          style={{
                            background: applying ? 'rgba(255,149,0,.15)' : 'rgba(255,149,0,.2)',
                            border: `1px solid ${node.color}50`,
                            color: node.color,
                            boxShadow: applying ? 'none' : `0 0 16px ${node.color}20`,
                          }}>
                          {applying ? '⏳ Pushing to GitHub…' : '🚀 Apply Schedule to GitHub'}
                        </button>
                        {applyResult && (
                          <p className="mt-2 text-[10px] font-mono px-3 py-2 rounded-lg"
                            style={{
                              background: applyResult.ok ? 'rgba(0,204,122,.08)' : 'rgba(255,77,77,.08)',
                              color: applyResult.ok ? '#00cc7a' : '#ff7849',
                              border: `1px solid ${applyResult.ok ? '#00cc7a30' : '#ff4d4d30'}`,
                            }}>
                            {applyResult.msg}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    Object.entries(node.config).map(([key, value]) => (
                      <div key={key}>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-wider">
                          {key.replace(/_/g, ' ')}
                        </label>
                        <input
                          type="text" value={value}
                          onChange={e => onUpdateConfig(node.id, key, e.target.value)}
                          className="w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all"
                          style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', fontFamily: 'inherit' }}
                          onClick={e => e.stopPropagation()}
                          onFocus={e => { e.currentTarget.style.borderColor = node.color + '60'; e.currentTarget.style.boxShadow = `0 0 0 3px ${node.color}14`; }}
                          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'; e.currentTarget.style.boxShadow = 'none'; }} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── OUTPUT TAB ── */}
        {tab === 'output' && (
          <div className="flex-1 overflow-auto" style={{ background: '#06030f' }}>
            <div className="flex items-center justify-between px-6 py-2.5 border-b border-white/6 shrink-0">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Sample output · JSON</span>
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md"
                style={{ background: node.status === 'success' ? '#00cc7a18' : 'rgba(255,255,255,.04)', color: node.status === 'success' ? '#00cc7a' : '#475569' }}>
                {node.status === 'success' ? '✓ Last run succeeded' : 'Run workflow to see live output'}
              </span>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 'calc(85vh - 200px)' }}>
              <table className="w-full border-collapse" style={{ fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace", fontSize: 12.5, lineHeight: 1.7 }}>
                <tbody>
                  {getNodeOutput(node).split('\n').map((line, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      <td className="text-right pr-5 pl-5 select-none align-top"
                        style={{ color: '#2d3748', minWidth: 48, fontSize: 11, borderRight: '1px solid rgba(255,255,255,.04)' }}>
                        {i + 1}
                      </td>
                      <td className="pl-5 pr-8 align-top">
                        <span dangerouslySetInnerHTML={{ __html: highlightCode(line) || '&nbsp;' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/8 shrink-0"
          style={{ background: 'rgba(255,255,255,.01)' }}>
          <button onClick={() => { if (window.confirm(`Delete node "${node.label}"?`)) onDelete(node.id); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ border: '1px solid rgba(255,77,77,.2)', background: 'rgba(255,77,77,.07)', color: '#ff4d4d' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,77,77,.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,77,77,.07)')}>
            <Trash2 size={12} /> Delete Node
          </button>
          <button onClick={onClose}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white transition-all"
            style={{ background: node.color + 'cc', boxShadow: `0 0 16px ${node.color}40` }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
