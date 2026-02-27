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
      const { fileId } = parseJsonBody(req);
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

      return sendJson(res, 200, { summary: lines.join("\n"), aloha, ohana, gateway, rawText: text.slice(0, 400) });
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
      await db.collection("drive_watcher_state").doc("status").set(statusUpdate, { merge: true });
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
