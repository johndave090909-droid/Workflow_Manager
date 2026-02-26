const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

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
  // Use custom SA JSON if provided, otherwise fall back to env var
  let sa;
  if (saJson) {
    try {
      sa = JSON.parse(saJson);
      if (!sa.client_email || !sa.private_key) sa = null;
    } catch { sa = null; }
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
