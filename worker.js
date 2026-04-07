// Cloudflare Worker — Roblox API Proxy (multi-service)
// Routes: /groups/... → groups.roblox.com/...
//         /friends/... → friends.roblox.com/...
//         /thumbnails/... → thumbnails.roblox.com/...
//         /users/... → users.roblox.com/...

const HOSTS = {
  groups: "groups.roblox.com",
  friends: "friends.roblox.com",
  thumbnails: "thumbnails.roblox.com",
  users: "users.roblox.com",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const service = parts[0];
    const host = HOSTS[service];

    if (!host) {
      return new Response(JSON.stringify({ error: "Unknown service" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const apiPath = "/" + parts.slice(1).join("/") + url.search;
    const apiUrl = "https://" + host + apiPath;

    const resp = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
    });

    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
