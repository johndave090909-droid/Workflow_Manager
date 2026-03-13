const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const WORKER_FIXED_HEADERS = [
  "", "Job", "First Name", "Last Name", "Pay Rate", "Id Number",
  "Prefered Name", "Birth Day", "Messenger", "Persona", "Knife",
];
const WORKER_FIXED_KEYS = [
  "shift", "job", "firstName", "lastName", "payRate", "idNumber",
  "preferredName", "birthDay", "messenger", "persona", "knife",
];

function parseGoogleServiceAccount() {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
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

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken(scopes) {
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
  const data = await resp.json();
  if (!data.access_token) throw new Error("No access token returned from Google");
  return data.access_token;
}

async function sheetsApi(pathname, init = {}) {
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

function normalizeSheetCell(v) {
  return typeof v === "string" ? v : (v == null ? "" : String(v));
}

function normalizeRowLike(row) {
  if (!row || typeof row !== "object") return {};
  return row;
}

function parseWorkerRosterFromSheet(values) {
  const rows = Array.isArray(values) ? values : [];
  const headerRow = (rows[0] || []).map(normalizeSheetCell);
  const customHeaders = headerRow.slice(WORKER_FIXED_KEYS.length);
  const customColumns = customHeaders.map((label, i) => ({
    id: `col_${i + 1}`,
    label: label || `Column ${i + 1}`,
  }));

  const parsedRows = rows.slice(1)
    .map((r) => Array.isArray(r) ? r.map(normalizeSheetCell) : [])
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const fixedVals = WORKER_FIXED_KEYS.map((_, i) => normalizeSheetCell(r[i]));
      const custom = {};
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

function buildWorkerRosterSheetValues(rows, customColumns) {
  const header = [...WORKER_FIXED_HEADERS, ...(customColumns || []).map((c) => c.label || "New Column")];
  const body = (rows || []).map((row) => {
    const r = normalizeRowLike(row);
    const fixed = WORKER_FIXED_KEYS.map((k) => normalizeSheetCell(r[k]));
    const custom = (customColumns || []).map((c) => normalizeSheetCell((r.custom || {})[c.id]));
    return [...fixed, ...custom];
  });
  return [header, ...body];
}

async function readWorkerRosterFromGoogleSheet() {
  const { spreadsheetId, sheetName } = getWorkerSheetConfig();
  if (!spreadsheetId) throw new Error("GOOGLE_WORKER_ROSTER_SPREADSHEET_ID is not set");
  const range = encodeURIComponent(`${sheetName}!A:ZZ`);
  const resp = await sheetsApi(`spreadsheets/${spreadsheetId}/values/${range}`);
  const data = await resp.json();
  const parsed = parseWorkerRosterFromSheet(data.values || []);
  return {
    spreadsheetId,
    sheetName,
    ...parsed,
    hash: crypto.createHash("sha256").update(JSON.stringify(data.values || [])).digest("hex"),
  };
}

async function writeWorkerRosterToGoogleSheet(payload) {
  const { spreadsheetId, sheetName } = getWorkerSheetConfig();
  if (!spreadsheetId) throw new Error("GOOGLE_WORKER_ROSTER_SPREADSHEET_ID is not set");
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const customColumns = Array.isArray(payload?.customColumns) ? payload.customColumns : [];
  const values = buildWorkerRosterSheetValues(rows, customColumns);
  const range = encodeURIComponent(`${sheetName}!A1`);
  await sheetsApi(`spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  return {
    spreadsheetId,
    sheetName,
    rowCount: Math.max(0, values.length - 1),
    columnCount: values[0] ? values[0].length : 0,
    hash: crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex"),
  };
}

async function getCurrentWorkerRosterHash() {
  const { spreadsheetId, sheetName } = getWorkerSheetConfig();
  if (!spreadsheetId) throw new Error("GOOGLE_WORKER_ROSTER_SPREADSHEET_ID is not set");
  const range = encodeURIComponent(`${sheetName}!A:ZZ`);
  const resp = await sheetsApi(`spreadsheets/${spreadsheetId}/values/${range}`);
  const data = await resp.json();
  return crypto.createHash("sha256").update(JSON.stringify(data.values || [])).digest("hex");
}

function sendJson(res, status, body) {
  res.status(status);
  res.set("Content-Type", "application/json");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.send(JSON.stringify(body));
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    if (req.rawBody) return JSON.parse(Buffer.from(req.rawBody).toString("utf8"));
  } catch {}
  return {};
}

function normalizeStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

async function resolveDriveWatcherFacebookConfig() {
  const envRecipientId = normalizeStr(process.env.FB_DEFAULT_RECIPIENT_ID || process.env.FB_RECIPIENT_ID);
  const envMessage = normalizeStr(process.env.FB_DEFAULT_MESSAGE) || "🆕 New PDFs found in Google Drive:";

  let docConfig = null;
  try {
    const snap = await db.collection("automation_config").doc("drive_pdf_watcher").get();
    if (snap.exists) docConfig = snap.data() || null;
  } catch {
    // Continue with env fallback if config doc isn't readable.
  }

  const fb = docConfig?.facebook || {};
  const recipientId = normalizeStr(fb.recipientId) || envRecipientId;
  const header = normalizeStr(fb.message) || envMessage;
  const enabled = fb.enabled !== false;
  return { enabled, recipientId, header, source: docConfig ? "firestore" : "env" };
}

// Downloads a Drive PDF and extracts Aloha/Ohana/Gateway guest counts.
// Returns a summary string like "Aloha: 344\nOhana: 212\nGateway: 854", or null if not found.
async function extractDailyCounts(fileId) {
  try {
    const token = await getDriveAccessToken(null);
    const fileResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!fileResp.ok) {
      console.log(`extractDailyCounts: Drive download failed (${fileResp.status}) for ${fileId}`);
      return null;
    }
    const buffer = Buffer.from(await fileResp.arrayBuffer());
    const { text } = await pdfParse(buffer);

    // Ohana Luau — value appears directly after "Ohana Luau" in the text stream
    let ohana = null;
    const ohanaM = text.match(/Ohana[\s\n]+Luau[\s\n]+(\d{2,4})/i);
    if (ohanaM) ohana = ohanaM[1];

    // Gateway Buffet — Daily Attendance Summary row sits at the top of the text
    let gateway = null;
    const gatewayM = text.match(/(?:\d+,\d{3}|\d{5,})\n(\d{3,4})\n\d{3,4}\n\d{3,4}\nDate/i);
    if (gatewayM) gateway = gatewayM[1];

    // Aloha Luau — Super Amb. and Aloha values are concatenated, last 3 digits = Aloha count
    let aloha = null;
    const alohaM = text.match(/(\d{3,7})\n\d{1,4}\nDate[\s\n]+Total[\s\n]+Luau[\s\n]*PAX/i);
    if (alohaM) {
      const raw = alohaM[1];
      aloha = raw.length <= 3 ? raw : String(parseInt(raw.slice(-3)));
    }

    if (!aloha && !ohana && !gateway) return null;

    const lines = [];
    if (aloha)   lines.push(`Aloha: ${aloha}`);
    if (ohana)   lines.push(`Ohana: ${ohana}`);
    if (gateway) lines.push(`Gateway: ${gateway}`);
    console.log(`extractDailyCounts (${fileId}): ${lines.join(", ")}`);
    return lines.join("\n");
  } catch (err) {
    console.log(`extractDailyCounts error for ${fileId}:`, err?.message);
    return null;
  }
}

async function buildFacebookPdfMessages(header, files) {
  const entries = [];
  for (const f of files) {
    const name = normalizeStr(f.name) || "(Unnamed PDF)";
    const link = normalizeStr(f.webViewLink);
    const isDailyCounts = /daily\s*counts/i.test(name);
    let entry = link ? `📄 ${name}\n${link}` : `📄 ${name}`;
    if (isDailyCounts && f.id) {
      const summary = await extractDailyCounts(f.id);
      if (summary) {
        entry += `\n\n${summary}`;
        // Store summary back on the drive_pdf_history document so UI can show it beside the PDF
        await db.collection('drive_pdf_history').doc(f.id).set(
          { guestCountSummary: summary }, { merge: true }
        );
        // Persist guest counts so Guest Experience tab can display ratios
        const dateKey = (f.discoveredAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
        const counts = {};
        for (const line of summary.split('\n')) {
          const m = line.match(/^(Aloha|Ohana|Gateway):\s*(\d+)/i);
          if (m) counts[m[1].toLowerCase()] = parseInt(m[2]);
        }
        if (Object.keys(counts).length) {
          await db.collection('daily_guest_counts').doc(dateKey).set(
            { ...counts, savedAt: new Date().toISOString(), sourceFileId: f.id }, { merge: true }
          );
        }
      }
    }
    entries.push(entry);
  }

  const maxLen = 1800;
  const chunks = [];
  let current = header;
  for (const entry of entries) {
    const next = current ? `${current}\n\n${entry}` : entry;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = entry;
    } else if (entry.length > maxLen) {
      chunks.push(entry.slice(0, maxLen));
      current = "";
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [header];
}

async function sendFacebookTextMessage(recipientId, message) {
  const token = process.env.FB_PAGE_TOKEN;
  if (!token) throw new Error("FB_PAGE_TOKEN is not configured");
  const fbRes = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "MESSAGE_TAG",
        tag: "CONFIRMED_EVENT_UPDATE",
        recipient: { id: recipientId },
        message: { text: message },
      }),
    }
  );
  const data = await fbRes.json().catch(() => ({}));
  if (!fbRes.ok) throw new Error(data?.error?.message || `Facebook API ${fbRes.status}`);
  return data;
}

// ── Workflow-based backend execution ────────────────────────────────────────────
// Reads the visual workflow layout from Firestore and executes IF node routing,
// sending files to the correct Facebook recipients — no browser needed.
async function executeWorkflowNodes(nodes, edges, files) {
  const results = [];

  const savePdfNode = nodes.find((n) => n.type === "save_pdf");
  if (!savePdfNode) {
    console.log("executeWorkflowNodes: no save_pdf node found");
    return { ok: false, reason: "no_save_pdf_node", results };
  }

  async function executeBranch(nodeIds, branchFiles) {
    for (const nodeId of nodeIds) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      if (node.type === "if") {
        const cond = ((node.config && node.config.value) || "").trim().toLowerCase();
        const yesFiles = branchFiles.filter((f) => f.name.toLowerCase().includes(cond));
        const noFiles  = branchFiles.filter((f) => !f.name.toLowerCase().includes(cond));
        console.log(`IF node condition="${cond}": YES=${yesFiles.length} NO=${noFiles.length}`);
        const yesTargets = edges.filter((e) => e.fromId === nodeId && e.label === "yes").map((e) => e.toId);
        const noTargets  = edges.filter((e) => e.fromId === nodeId && e.label === "no").map((e) => e.toId);
        if (yesTargets.length && yesFiles.length) await executeBranch(yesTargets, yesFiles);
        if (noTargets.length  && noFiles.length)  await executeBranch(noTargets,  noFiles);

      } else if (node.type === "facebook" || node.type === "facebook_daily_counts") {
        const recipientId = ((node.config && node.config.recipientId) || "").trim();
        if (!recipientId) {
          console.log(`Facebook node ${nodeId}: no recipientId — skipping`);
          results.push({ nodeId, ok: false, reason: "missing_recipient" });
          continue;
        }
        let filesToSend = branchFiles;
        if (node.type === "facebook_daily_counts") {
          filesToSend = branchFiles.filter((f) => /daily\s*counts/i.test(f.name));
        }
        if (filesToSend.length === 0) {
          console.log(`Facebook node ${nodeId}: no matching files — skipping`);
          results.push({ nodeId, ok: true, skipped: true, reason: "no_files" });
        } else {
          const header = ((node.config && node.config.message) || "").trim() || "🆕 New PDFs found in Google Drive:";
          const messages = await buildFacebookPdfMessages(header, filesToSend);
          for (const msg of messages) await sendFacebookTextMessage(recipientId, msg);
          console.log(`Facebook node ${nodeId}: sent ${filesToSend.length} file(s) to ${recipientId}`);
          results.push({ nodeId, ok: true, recipientId, filesSent: filesToSend.length });
        }
        // Follow unlabelled edges onward
        const next = edges.filter((e) => e.fromId === nodeId && !e.label).map((e) => e.toId);
        if (next.length) await executeBranch(next, branchFiles);
      }
    }
  }

  const firstIds = edges.filter((e) => e.fromId === savePdfNode.id && !e.label).map((e) => e.toId);
  await executeBranch(firstIds, files);
  return { ok: true, results };
}

// ── Google Drive API ────────────────────────────────────────────────────────────
async function getDriveAccessToken(saJson) {
  // Priority: 1) custom SA JSON from node config, 2) GOOGLE_DRIVE_SERVICE_ACCOUNT, 3) GOOGLE_SHEETS_SERVICE_ACCOUNT
  let sa;
  if (saJson) {
    try {
      sa = JSON.parse(saJson);
      if (!sa.client_email || !sa.private_key) sa = null;
    } catch { sa = null; }
  }
  if (!sa) {
    const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.client_email && parsed.private_key) sa = parsed;
      } catch { /* ignore */ }
    }
  }
  if (!sa) sa = parseGoogleServiceAccount();
  if (!sa) throw new Error("Google service account is not configured");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
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
  const data = await resp.json();
  if (!data.access_token) throw new Error("No access token returned");
  return data.access_token;
}

exports.googleDriveApi = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  try {
    const path = req.path || req.url || "";

    // GET /status — check if Drive is configured
    if (req.method === "GET" && path.endsWith("/status")) {
      const sa = parseGoogleServiceAccount();
      return sendJson(res, 200, {
        configured: Boolean(sa),
        email: sa ? sa.client_email : null,
      });
    }

    // POST /poll — list PDFs in a folder
    if (req.method === "POST" && path.endsWith("/poll")) {
      const body = parseJsonBody(req);
      const { folderId, since, serviceAccountJson } = body;

      if (!folderId) {
        return sendJson(res, 400, { error: "folderId is required" });
      }

      const token = await getDriveAccessToken(serviceAccountJson || null);

      let q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
      if (since) q += ` and createdTime > '${since}'`;

      const driveResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,webViewLink,size,mimeType)&orderBy=createdTime%20desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveResp.ok) {
        const text = await driveResp.text();
        return sendJson(res, 500, { error: `Drive API ${driveResp.status}: ${text.slice(0, 400)}` });
      }

      const data = await driveResp.json();
      return sendJson(res, 200, { files: data.files || [] });
    }

    // POST /parse-daily-counts — download a Drive PDF and extract guest counts
    if (req.method === "POST" && path.endsWith("/parse-daily-counts")) {
      const { fileId, date: dateParam } = parseJsonBody(req);
      if (!fileId) return sendJson(res, 400, { error: "fileId is required" });

      const token = await getDriveAccessToken(null);

      // Download the PDF binary from Drive
      const fileResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!fileResp.ok) {
        return sendJson(res, 500, { error: `Drive download failed (${fileResp.status})` });
      }
      const buffer = Buffer.from(await fileResp.arrayBuffer());

      // Parse PDF text
      const { text } = await pdfParse(buffer);

      // ── Keyword-proximity extraction ──────────────────────────────────────────
      // This PDF renders table DATA before column HEADERS in the text stream
      // (non-linear due to multi-column layout). Patterns below match the actual
      // observed text order.

      // Ohana Luau — its value appears directly after "Ohana Luau" in the stream
      let ohana = null;
      const ohanaM = text.match(/Ohana[\s\n]+Luau[\s\n]+(\d{2,4})/i);
      if (ohanaM) ohana = ohanaM[1];

      // Gateway Buffet — Daily Attendance Summary data row sits at the very top
      // of the text, before any section headers. Layout observed:
      //   (big comma-total or 5+ digit concat)\n[GATEWAY]\n[val]\n[val]\nDate...
      let gateway = null;
      const gatewayM = text.match(/(?:\d+,\d{3}|\d{5,})\n(\d{3,4})\n\d{3,4}\n\d{3,4}\nDate/i);
      if (gatewayM) gateway = gatewayM[1];

      // Aloha Luau — Super Amb. and Aloha values are concatenated (no space)
      // just before the luau column headers, e.g. "107348\n548\nDate\nTotal\nLuau PAX"
      // → last 3 digits of the long number = Aloha count
      let aloha = null;
      const alohaM = text.match(/(\d{3,7})\n\d{1,4}\nDate[\s\n]+Total[\s\n]+Luau[\s\n]*PAX/i);
      if (alohaM) {
        const raw = alohaM[1];
        aloha = raw.length <= 3 ? raw : String(parseInt(raw.slice(-3)));
      }

      if (!aloha && !ohana && !gateway) {
        // Nothing found — return raw text to help diagnose the PDF layout
        return sendJson(res, 200, { summary: null, rawText: text.slice(0, 2000) });
      }

      const lines = [];
      if (aloha)   lines.push(`Aloha: ${aloha}`);
      if (ohana)   lines.push(`Ohana: ${ohana}`);
      if (gateway) lines.push(`Gateway: ${gateway}`);

      // Persist guest counts so Guest Experience tab can display ratios
      const dateKey = (dateParam || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const counts = {};
      if (aloha)   counts.aloha   = parseInt(aloha);
      if (ohana)   counts.ohana   = parseInt(ohana);
      if (gateway) counts.gateway = parseInt(gateway);
      if (Object.keys(counts).length) {
        await db.collection('daily_guest_counts').doc(dateKey).set(
          { ...counts, savedAt: new Date().toISOString(), sourceFileId: fileId }, { merge: true }
        );
      }

      return sendJson(res, 200, { summary: lines.join("\n"), aloha, ohana, gateway, rawText: text.slice(0, 400) });
    }

    // POST /backfill-guest-counts — run all Daily Counts PDFs through extraction
    if (req.method === "POST" && path.endsWith("/backfill-guest-counts")) {
      const snap = await db.collection('drive_pdf_history').get();
      const results = [];
      for (const docSnap of snap.docs) {
        const f = docSnap.data();
        if (!/daily\s*counts/i.test(f.name || '')) continue;
        const dateKey = (f.discoveredAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
        try {
          const summary = await extractDailyCounts(f.fileId);
          if (summary) {
            // Store summary back on the drive_pdf_history document
            await db.collection('drive_pdf_history').doc(docSnap.id).set(
              { guestCountSummary: summary }, { merge: true }
            );
            const counts = {};
            for (const line of summary.split('\n')) {
              const m = line.match(/^(Aloha|Ohana|Gateway):\s*(\d+)/i);
              if (m) counts[m[1].toLowerCase()] = parseInt(m[2]);
            }
            if (Object.keys(counts).length) {
              await db.collection('daily_guest_counts').doc(dateKey).set(
                { ...counts, savedAt: new Date().toISOString(), sourceFileId: f.fileId, sourceName: f.name },
                { merge: true }
              );
              results.push({ name: f.name, date: dateKey, counts, ok: true });
            } else {
              results.push({ name: f.name, date: dateKey, ok: false, reason: 'no counts extracted' });
            }
          } else {
            results.push({ name: f.name, date: dateKey, ok: false, reason: 'extraction returned null' });
          }
        } catch (err) {
          results.push({ name: f.name, date: dateKey, ok: false, reason: err?.message });
        }
      }
      return sendJson(res, 200, { processed: results.length, results });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Google Drive error" });
  }
});

exports.workerRosterGoogleApi = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  try {
    const path = req.path || req.url || "";

    if (req.method === "GET" && path.endsWith("/status")) {
      const sa = parseGoogleServiceAccount();
      const { spreadsheetId, sheetName } = getWorkerSheetConfig();
      return sendJson(res, 200, {
        configured: Boolean(sa && spreadsheetId),
        spreadsheetId: spreadsheetId || null,
        sheetName: sheetName || "Workers",
        authConfigured: Boolean(sa),
      });
    }

    if (req.method === "GET" && path.endsWith("/pull")) {
      const data = await readWorkerRosterFromGoogleSheet();
      return sendJson(res, 200, data);
    }

    if ((req.method === "PUT" || req.method === "POST") && path.endsWith("/push")) {
      const body = parseJsonBody(req);
      const expectedHash = typeof body.expectedHash === "string" ? body.expectedHash : null;
      if (expectedHash) {
        const currentHash = await getCurrentWorkerRosterHash();
        if (currentHash !== expectedHash) {
          return sendJson(res, 409, {
            error: "Remote sheet changed",
            code: "REMOTE_CONFLICT",
            currentHash,
          });
        }
      }
      const result = await writeWorkerRosterToGoogleSheet(body);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Worker roster Google sync error" });
  }
});

// ── Scheduled Drive Watcher ──────────────────────────────────────────────────────
exports.driveWatcherScheduled = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1" },
  async () => {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      console.error("GOOGLE_DRIVE_FOLDER_ID is not set — skipping poll");
      return;
    }

    try {
      const token = await getDriveAccessToken(null);
      const q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
      const driveResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,webViewLink,size,mimeType)&orderBy=createdTime%20desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveResp.ok) {
        const text = await driveResp.text();
        console.error(`Drive API error ${driveResp.status}: ${text.slice(0, 400)}`);
        return;
      }

      const data = await driveResp.json();
      const files = data.files || [];

      // Load existing doc IDs from Firestore to skip already-recorded files
      const existingSnap = await db.collection("drive_pdf_history").select().get();
      const existingIds = new Set(existingSnap.docs.map((d) => d.id));
      const newFiles = files.filter((f) => !existingIds.has(f.id));

      const savedAt = new Date().toISOString();
      let facebookForward = null;
      if (newFiles.length > 0) {
        const batch = db.batch();
        for (const f of newFiles) {
          const ref = db.collection("drive_pdf_history").doc(f.id);
          batch.set(ref, {
            fileId: f.id,
            name: f.name,
            webViewLink: f.webViewLink || "",
            discoveredAt: f.createdTime || savedAt,
            savedAt,
            size: f.size || "",
            mimeType: f.mimeType || "application/pdf",
          });
        }
        await batch.commit();
        console.log(`Saved ${newFiles.length} new PDF(s) to Firestore`);

        // Forward new files using the visual workflow layout stored in Firestore.
        // Executes IF node routing and sends to the correct Facebook recipients.
        try {
          const layoutSnap = await db.collection("workflow_layouts").doc("gdrive").get();
          if (layoutSnap.exists) {
            const layout = layoutSnap.data();
            const wfNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
            const wfEdges = Array.isArray(layout.edges) ? layout.edges : [];
            facebookForward = await executeWorkflowNodes(wfNodes, wfEdges, newFiles);
            facebookForward.sentAt = savedAt;
            facebookForward.source = "workflow";
            facebookForward.filesForwarded = newFiles.length;
            console.log(`Workflow execution done:`, JSON.stringify(facebookForward.results));
          } else {
            // Fallback: no workflow layout saved yet — use simple env-based config
            const cfg = await resolveDriveWatcherFacebookConfig();
            if (!cfg.enabled) {
              facebookForward = { ok: false, skipped: true, reason: "disabled" };
            } else if (!cfg.recipientId) {
              facebookForward = { ok: false, skipped: true, reason: "missing_recipient" };
            } else {
              const messages = await buildFacebookPdfMessages(cfg.header, newFiles);
              for (const msg of messages) await sendFacebookTextMessage(cfg.recipientId, msg);
              facebookForward = { ok: true, sentAt: savedAt, recipientId: cfg.recipientId, source: "env", filesForwarded: newFiles.length };
              console.log(`Fallback: forwarded ${newFiles.length} PDF(s) to ${cfg.recipientId}`);
            }
          }
        } catch (fbErr) {
          facebookForward = {
            ok: false,
            skipped: false,
            reason: "facebook_send_failed",
            error: fbErr?.message || "Unknown Facebook send error",
          };
          console.error("driveWatcherScheduled Facebook forward error:", fbErr?.message || fbErr);
        }
      } else {
        console.log(`Found ${files.length} PDF(s), all already recorded`);
      }

      // Always update status so the UI countdown stays accurate
      const statusUpdate = {
        lastRun: savedAt,
        status: "ok",
        newFilesFound: newFiles.length,
        totalInFolder: files.length,
        lastFoundFileIds: newFiles.map((f) => f.id),
      };
      // Preserve the most recent check that actually had new files
      if (newFiles.length > 0) {
        statusUpdate.lastCheckWithFiles = {
          runAt: savedAt,
          fileIds: newFiles.map((f) => f.id),
        };
      }
      if (facebookForward) statusUpdate.facebookForward = facebookForward;
      await db.collection("drive_watcher_state").doc("status").set(statusUpdate, { merge: true });

      // Backfill pass — process any Daily Counts PDFs that don't have guest counts yet
      const allSnap = await db.collection("drive_pdf_history").get();
      for (const docSnap of allSnap.docs) {
        const f = docSnap.data();
        if (!/daily\s*counts/i.test(f.name || "")) continue;
        if (f.guestCountSummary) continue; // already done
        try {
          const summary = await extractDailyCounts(f.fileId);
          if (summary) {
            await db.collection("drive_pdf_history").doc(docSnap.id).set(
              { guestCountSummary: summary }, { merge: true }
            );
            const dateKey = (f.discoveredAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
            const counts = {};
            for (const line of summary.split("\n")) {
              const m = line.match(/^(Aloha|Ohana|Gateway):\s*(\d+)/i);
              if (m) counts[m[1].toLowerCase()] = parseInt(m[2]);
            }
            if (Object.keys(counts).length) {
              await db.collection("daily_guest_counts").doc(dateKey).set(
                { ...counts, savedAt: new Date().toISOString(), sourceFileId: f.fileId }, { merge: true }
              );
            }
            console.log(`Backfill: saved counts for ${f.name} (${dateKey})`);
          }
        } catch (bErr) {
          console.error(`Backfill error for ${f.name}:`, bErr?.message);
        }
      }
    } catch (e) {
      console.error("driveWatcherScheduled error:", e?.message || e);
      await db.collection("drive_watcher_state").doc("status").set({
        lastRun: new Date().toISOString(),
        status: "error",
        error: e?.message || "Unknown error",
        newFilesFound: 0,
        totalInFolder: 0,
      }).catch(() => {});
    }
  }
);

// ── Food Prep Drive Watcher (separate folder, separate collections) ───────────
exports.foodPrepWatcherScheduled = onSchedule(
  { schedule: "every 5 minutes", region: "us-central1" },
  async () => {
    const HISTORY_COL = "food-prep_pdf_history";
    const STATUS_COL  = "food-prep_watcher_state";
    const LAYOUT_KEY  = "food-prep";

    // Only run between 6:30 AM and 7:30 PM Hawaii time (HST = UTC-10, no DST)
    const hawaiiParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      hour: "numeric", minute: "numeric", hour12: false,
    }).formatToParts(new Date());
    const hh = parseInt(hawaiiParts.find(p => p.type === "hour").value);
    const mm = parseInt(hawaiiParts.find(p => p.type === "minute").value);
    const minuteOfDay = hh * 60 + mm;
    if (minuteOfDay < 390 || minuteOfDay > 1170) { // 390 = 6:30, 1170 = 19:30
      console.log(`Food Prep: outside active hours (${hh}:${String(mm).padStart(2,"0")} HST) — skipping`);
      return;
    }

    // Extract bare folder ID from either a full Drive URL or a plain ID
    const extractFolderId = (val) => {
      if (!val) return "";
      const m = val.match(/folders\/([a-zA-Z0-9_-]+)/);
      return m ? m[1] : val.trim();
    };

    // Read folder ID from Firestore config first, fall back to env var, then hardcoded default
    const DEFAULT_FOOD_PREP_FOLDER = "1lfiinyI5VaZY9eWgpEaSUVxrQljOOTfp";
    let folderId = extractFolderId(process.env.FOOD_PREP_DRIVE_FOLDER_ID) || DEFAULT_FOOD_PREP_FOLDER;
    try {
      const configSnap = await db.collection(STATUS_COL).doc("config").get();
      if (configSnap.exists && configSnap.data().folderId) {
        folderId = extractFolderId(configSnap.data().folderId) || DEFAULT_FOOD_PREP_FOLDER;
      } else {
        // Save the default folder ID to Firestore config so the UI shows it
        await db.collection(STATUS_COL).doc("config").set({ folderId }, { merge: true });
      }
    } catch { /* use default */ }
    console.log(`Food Prep: using folder ID "${folderId}"`);

    try {
      const token = await getDriveAccessToken(null);
      const q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
      const driveResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,webViewLink,size,mimeType)&orderBy=modifiedTime%20desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveResp.ok) {
        const text = await driveResp.text();
        console.error(`Food Prep Drive API error ${driveResp.status}: ${text.slice(0, 400)}`);
        return;
      }

      const data = await driveResp.json();
      const files = data.files || [];
      const savedAt = new Date().toISOString();
      let facebookForward = null;

      // Always take the most recently modified PDF regardless of whether we've seen it before.
      // The file is overwritten in-place every 2 minutes, so we detect changes via modifiedTime.
      const latestFile = files[0] || null;

      // Read last processed modifiedTime from status doc
      const statusSnap = await db.collection(STATUS_COL).doc("status").get();
      const lastModifiedTime = statusSnap.exists ? (statusSnap.data().lastModifiedTime || "") : "";

      const fileChanged = latestFile && latestFile.modifiedTime !== lastModifiedTime;

      if (fileChanged) {
        // Download PDF and extract guest counts from the summary table
        let guestCounts = null;
        try {
          const pdfResp = await fetch(
            `https://www.googleapis.com/drive/v3/files/${latestFile.id}?alt=media`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (pdfResp.ok) {
            const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
            const parsed = await pdfParse(pdfBuffer);
            const text = parsed.text || "";

            // Extract pax from lines like "Luau at Hale Ohana 5:00 PM  203"
            const extractPax = (label) => {
              const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const m = text.match(new RegExp(escaped + "[^\\n]*?(\\d+)\\s*(?:\\n|$)", "i"));
              return m ? parseInt(m[1], 10) : null;
            };

            const ohana   = extractPax("Luau at Hale Ohana");
            const aloha   = extractPax("Luau at Hale Aloha");
            const gateway = extractPax("Gateway Buffet");

            if (ohana !== null || aloha !== null || gateway !== null) {
              guestCounts = { ohana, aloha, gateway, total: (ohana||0) + (aloha||0) + (gateway||0) };
              console.log(`Food Prep: extracted counts — Ohana:${ohana} Aloha:${aloha} Gateway:${gateway}`);
            } else {
              console.log("Food Prep: PDF parsed but no guest counts found in text");
            }
          }
        } catch (pdfErr) {
          console.error("Food Prep: PDF extraction error:", pdfErr?.message);
        }

        // Record this version in history (keyed by modifiedTime so each overwrite is a new entry)
        const historyId = `${latestFile.id}_${latestFile.modifiedTime.replace(/[:.]/g, "-")}`;
        await db.collection(HISTORY_COL).doc(historyId).set({
          fileId: latestFile.id,
          name: latestFile.name,
          webViewLink: latestFile.webViewLink || "",
          modifiedTime: latestFile.modifiedTime,
          discoveredAt: savedAt,
          savedAt,
          size: latestFile.size || "",
          mimeType: latestFile.mimeType || "application/pdf",
          ...(guestCounts ? { guestCounts } : {}),
        });
        console.log(`Food Prep: new version detected — ${latestFile.name} (modified ${latestFile.modifiedTime})`);

        try {
          const layoutSnap = await db.collection("workflow_layouts").doc(LAYOUT_KEY).get();
          if (layoutSnap.exists) {
            const layout = layoutSnap.data();
            const wfNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
            const wfEdges = Array.isArray(layout.edges) ? layout.edges : [];
            facebookForward = await executeWorkflowNodes(wfNodes, wfEdges, [latestFile]);
            facebookForward.sentAt = savedAt;
            facebookForward.source = "workflow";
          }
        } catch (fbErr) {
          facebookForward = { ok: false, reason: "workflow_failed", error: fbErr?.message };
          console.error("Food Prep workflow error:", fbErr?.message);
        }
      } else {
        console.log(`Food Prep: no change since last run (modifiedTime: ${lastModifiedTime})`);
      }

      const statusUpdate = {
        lastRun: savedAt,
        status: "ok",
        newFilesFound: fileChanged ? 1 : 0,
        totalInFolder: files.length,
        lastModifiedTime: latestFile ? latestFile.modifiedTime : lastModifiedTime,
        lastFoundFileIds: fileChanged && latestFile ? [latestFile.id] : [],
      };
      if (fileChanged && latestFile) statusUpdate.lastCheckWithFiles = { runAt: savedAt, fileIds: [latestFile.id] };
      if (facebookForward) statusUpdate.facebookForward = facebookForward;
      await db.collection(STATUS_COL).doc("status").set(statusUpdate, { merge: true });

    } catch (e) {
      console.error("foodPrepWatcherScheduled error:", e?.message || e);
      await db.collection(STATUS_COL).doc("status").set({
        lastRun: new Date().toISOString(),
        status: "error",
        error: e?.message || "Unknown error",
        newFilesFound: 0,
        totalInFolder: 0,
      }).catch(() => {});
    }
  }
);

// ── Facebook Messenger ───────────────────────────────────────────────────────────
exports.sendFacebookMessage = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const { recipientId, message } = parseJsonBody(req);
    if (!recipientId || !message) return sendJson(res, 400, { error: "recipientId and message are required" });

    const token = process.env.FB_PAGE_TOKEN;
    if (!token) return sendJson(res, 500, { error: "FB_PAGE_TOKEN is not configured" });

    const fbRes = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_type: "MESSAGE_TAG",
          tag: "CONFIRMED_EVENT_UPDATE",
          recipient: { id: recipientId },
          message: { text: message },
        }),
      }
    );
    const data = await fbRes.json();
    if (!fbRes.ok) return sendJson(res, fbRes.status, { error: data?.error?.message || "Facebook API error", details: data });
    return sendJson(res, 200, { ok: true, messageId: data.message_id, recipientId: data.recipient_id });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Facebook send error" });
  }
});

// Manual backend-only test trigger for Drive -> Facebook forwarding.
// Useful to verify forwarding works even when no browser is open.
exports.driveWatcherTestForward = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    const body = parseJsonBody(req);
    const limit = Math.min(20, Math.max(1, Number(body.limit || 5)));
    const useLatest = body.source === "latest";

    const cfg = await resolveDriveWatcherFacebookConfig();
    if (!cfg.enabled) return sendJson(res, 400, { error: "Forwarding is disabled in config" });
    if (!cfg.recipientId) return sendJson(res, 400, { error: "No Facebook recipientId configured" });

    let files = [];
    if (!useLatest) {
      const statusSnap = await db.collection("drive_watcher_state").doc("status").get();
      const status = statusSnap.exists ? (statusSnap.data() || {}) : {};
      const fileIds = (status.lastFoundFileIds?.length ? status.lastFoundFileIds : status.lastCheckWithFiles?.fileIds) || [];
      if (fileIds.length > 0) {
        const histSnap = await db.collection("drive_pdf_history").where("fileId", "in", fileIds.slice(0, 10)).get();
        files = histSnap.docs.map((d) => d.data()).filter(Boolean);
      }
    }

    if (files.length === 0) {
      const snap = await db.collection("drive_pdf_history").orderBy("discoveredAt", "desc").limit(limit).get();
      files = snap.docs.map((d) => d.data()).filter(Boolean);
    }

    if (files.length === 0) return sendJson(res, 400, { error: "No PDF history found to forward" });

    const mapped = files.map((f) => ({
      id: f.fileId || "",
      name: f.name || "",
      webViewLink: f.webViewLink || "",
    }));
    const messages = await buildFacebookPdfMessages(`[TEST] ${cfg.header}`, mapped);
    for (const msg of messages) {
      await sendFacebookTextMessage(cfg.recipientId, msg);
    }

    return sendJson(res, 200, {
      ok: true,
      recipientId: cfg.recipientId,
      filesForwarded: mapped.length,
      messageChunks: messages.length,
      source: useLatest ? "latest" : "last_check_or_latest",
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Drive forward test failed" });
  }
});

// ── Food Prep Report Receiver ─────────────────────────────────────────────────
// Power Automate POSTs the PDF binary to this endpoint every 5 minutes.
// Saves to Firebase Storage and records metadata in Firestore so the web app
// can display the latest report in real time.
exports.receiveFoodPrepReport = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  // Optional API key check — set FOOD_PREP_API_KEY env var to secure the endpoint
  const apiKey = process.env.FOOD_PREP_API_KEY;
  if (apiKey && req.headers["x-api-key"] !== apiKey) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  try {
    const buffer = req.rawBody;
    if (!buffer || buffer.length === 0) {
      return sendJson(res, 400, { error: "No PDF data received" });
    }

    const bucket = admin.storage().bucket();
    const storagePath = "food_prep/latest.pdf";
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      metadata: { contentType: "application/pdf", cacheControl: "no-cache" },
    });

    // Make publicly readable so the iframe can display it directly
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    const updatedAt = new Date().toISOString();
    await db.collection("food_prep_reports").doc("latest").set({
      url: publicUrl,
      storagePath,
      updatedAt,
      size: buffer.length,
    });

    return sendJson(res, 200, { ok: true, url: publicUrl, updatedAt });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Failed to save report" });
  }
});

// ── Food Prep History Cleanup ────────────────────────────────────────────────
// Runs at midnight and deletes all food-prep_pdf_history entries
exports.foodPrepHistoryCleanup = onSchedule(
  { schedule: "0 0 * * *", region: "us-central1" },
  async () => {
    const HISTORY_COL = "food-prep_pdf_history";

    const snap = await db.collection(HISTORY_COL).get();

    if (snap.empty) {
      console.log("Food Prep Cleanup: nothing to delete");
      return;
    }

    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`Food Prep Cleanup: deleted ${snap.docs.length} record(s) at midnight`);

    // Reset lastModifiedTime so the next watcher run treats the current file as new
    // and creates a fresh history entry (keeps Live Guest Count populated after cleanup)
    await db.collection("food-prep_watcher_state").doc("status").set(
      { lastModifiedTime: "" }, { merge: true }
    );
  }
);
