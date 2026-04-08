const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const WORKER_URL = process.env.ROBLOX_API_URL || "";
const BAN_WORKER_URL = process.env.ROBLOX_BAN_URL || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";

// Persistent data directory (mount a Railway Volume here)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");

function loadBlacklist() {
  try {
    return JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveBlacklist(list) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
}

const FAMILY_FILE = path.join(DATA_DIR, "family_names.json");

function loadFamilyNames() {
  try {
    return JSON.parse(fs.readFileSync(FAMILY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveFamilyNames(list) {
  fs.writeFileSync(FAMILY_FILE, JSON.stringify(list, null, 2));
}

function readJSONBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(null); }
    });
  });
}

// ===== SSE (Server-Sent Events) =====
const sseClients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch {}
  }
}

// Simple session store (in-memory)
const sessions = {};

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.split(";").map(c => c.trim()).find(c => c.startsWith(name + "="));
  return match ? match.split("=")[1] : null;
}

function isAuthenticated(req) {
  const token = getCookie(req, "session");
  return token && sessions[token];
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        resolve(Object.fromEntries(new URLSearchParams(body)));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Login page
  if (url.pathname === "/login" && req.method === "GET") {
    fs.readFile(path.join(__dirname, "login.html"), "utf8", (err, data) => {
      if (err) { res.writeHead(500); res.end("Error"); return; }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return;
  }

  // Login POST
  if (url.pathname === "/login" && req.method === "POST") {
    const body = await parseBody(req);
    if (body.username === ADMIN_USER && body.password === ADMIN_PASS) {
      const token = generateToken();
      sessions[token] = { user: body.username, created: Date.now() };
      res.writeHead(302, {
        "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Strict`,
        Location: "/",
      });
      res.end();
    } else {
      res.writeHead(302, { Location: "/login?error=1" });
      res.end();
    }
    return;
  }

  // Logout
  if (url.pathname === "/logout") {
    const token = getCookie(req, "session");
    if (token) delete sessions[token];
    res.writeHead(302, {
      "Set-Cookie": "session=; Path=/; HttpOnly; Max-Age=0",
      Location: "/login",
    });
    res.end();
    return;
  }

  // Protect everything else behind auth
  if (!isAuthenticated(req)) {
    if (url.pathname === "/api/events") {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }

  // SSE endpoint
  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");

    // Send current state immediately
    res.write(`event: blacklist\ndata: ${JSON.stringify(loadBlacklist())}\n\n`);
    res.write(`event: family-names\ndata: ${JSON.stringify(loadFamilyNames())}\n\n`);

    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // Blacklist API
  if (url.pathname === "/api/blacklist" && req.method === "GET") {
    const list = loadBlacklist();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
    return;
  }

  if (url.pathname === "/api/blacklist" && req.method === "POST") {
    const body = await readJSONBody(req);
    if (!body || !body.groupId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "groupId required" }));
      return;
    }
    const list = loadBlacklist();
    if (list.some(g => String(g.groupId) === String(body.groupId))) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Already blacklisted" }));
      return;
    }
    list.push({
      groupId: String(body.groupId),
      groupName: body.groupName || "Unknown",
      addedAt: new Date().toISOString(),
    });
    saveBlacklist(list);
    broadcast("blacklist", list);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, list }));
    return;
  }

  if (url.pathname.startsWith("/api/blacklist/") && req.method === "DELETE") {
    const groupId = url.pathname.split("/").pop();
    const list = loadBlacklist();
    const filtered = list.filter(g => String(g.groupId) !== String(groupId));
    saveBlacklist(filtered);
    broadcast("blacklist", filtered);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, list: filtered }));
    return;
  }

  // Family Names API
  if (url.pathname === "/api/family-names" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadFamilyNames()));
    return;
  }

  if (url.pathname === "/api/family-names" && req.method === "POST") {
    const body = await readJSONBody(req);
    if (!body || !body.name || !body.name.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "name required" }));
      return;
    }
    const name = body.name.trim();
    const list = loadFamilyNames();
    if (list.some(n => n.toLowerCase() === name.toLowerCase())) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Already exists" }));
      return;
    }
    list.push(name);
    saveFamilyNames(list);
    broadcast("family-names", list);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, list }));
    return;
  }

  if (url.pathname.startsWith("/api/family-names/") && req.method === "DELETE") {
    const name = decodeURIComponent(url.pathname.split("/").pop());
    const list = loadFamilyNames();
    const filtered = list.filter(n => n.toLowerCase() !== name.toLowerCase());
    saveFamilyNames(filtered);
    broadcast("family-names", filtered);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, list: filtered }));
    return;
  }

  // Serve static files
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Inject env vars into HTML
    if (ext === ".html") {
      data = data.replace("__WORKER_URL__", WORKER_URL);
      data = data.replace("__BAN_WORKER_URL__", BAN_WORKER_URL);
    }

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// Heartbeat to keep SSE connections alive
setInterval(() => {
  for (const client of sseClients) {
    try { client.write(":heartbeat\n\n"); } catch {}
  }
}, 30000);

server.listen(PORT, () => console.log("Listening on port " + PORT));
