// Cloudflare Worker — Roblox Ban API Proxy
// Env vars needed: ROBLOX_API_KEY, UNIVERSE_ID

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const apiKey = env.ROBLOX_API_KEY;
    const universeId = env.UNIVERSE_ID;

    if (!apiKey || !universeId) {
      return new Response(JSON.stringify({ error: "Missing API key or Universe ID" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const { userIds, banAlts, permanent, durationSeconds, publicReason, privateReason } = body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({ error: "No user IDs provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const results = [];

    for (const userId of userIds) {
      const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;

      const restriction = {
        gameJoinRestriction: {
          active: true,
          privateReason: privateReason || "",
          displayReason: publicReason || "",
          excludeAltAccounts: !banAlts,
        },
      };

      if (!permanent && durationSeconds) {
        restriction.gameJoinRestriction.duration = durationSeconds + "s";
      }

      try {
        const resp = await fetch(url, {
          method: "PATCH",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(restriction),
        });

        const data = await resp.text();
        results.push({
          userId,
          status: resp.status,
          success: resp.ok,
          response: resp.ok ? JSON.parse(data) : data,
        });
      } catch (err) {
        results.push({ userId, status: 0, success: false, response: err.message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  },
};
