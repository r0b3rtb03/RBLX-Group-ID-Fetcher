// Cloudflare Worker — Roblox Groups API Proxy
// Deploy this on Cloudflare, then point your site to the worker URL.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const baseUrl = env.ROBLOX_API_URL || "https://groups.roblox.com";
    const apiUrl = baseUrl + url.pathname + url.search;

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
