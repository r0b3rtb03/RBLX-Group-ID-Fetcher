const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const WORKER_URL = process.env.ROBLOX_API_URL || "";
const BAN_WORKER_URL = process.env.ROBLOX_BAN_URL || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";

// Blacklist persistence (JSON file)
const BLACKLIST_FILE = path.join(__dirname, "blacklist.json");

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
    res.writeHead(302, { Location: "/login" });
    res.end();
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
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { groupId, groupName } = JSON.parse(body);
        if (!groupId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "groupId required" }));
          return;
        }
        const list = loadBlacklist();
        if (list.some(g => String(g.groupId) === String(groupId))) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Already blacklisted" }));
          return;
        }
        list.push({ groupId: String(groupId), groupName: groupName || "Unknown", addedAt: new Date().toISOString() });
        saveBlacklist(list);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, list }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (url.pathname.startsWith("/api/blacklist/") && req.method === "DELETE") {
    const groupId = url.pathname.split("/").pop();
    const list = loadBlacklist();
    const filtered = list.filter(g => String(g.groupId) !== String(groupId));
    saveBlacklist(filtered);
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

server.listen(PORT, () => console.log("Listening on port " + PORT));
