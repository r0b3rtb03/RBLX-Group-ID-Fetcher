const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const WORKER_URL = process.env.ROBLOX_API_URL || "";
const BAN_WORKER_URL = process.env.ROBLOX_BAN_URL || "";

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Inject the worker URL into index.html
    if (ext === ".html") {
      data = data.replace("__WORKER_URL__", WORKER_URL);
      data = data.replace("__BAN_WORKER_URL__", BAN_WORKER_URL);
    }

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log("Listening on port " + PORT));
