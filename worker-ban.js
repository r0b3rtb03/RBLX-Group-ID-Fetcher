// Cloudflare Worker — Roblox Ban API Proxy
// Env vars needed: ROBLOX_API_KEY, UNIVERSE_ID
// Actions: "ban" | "check" | "lookup" | "unban"

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405, headers: corsHeaders,
      });
    }

    const apiKey = env.ROBLOX_API_KEY;
    const universeId = env.UNIVERSE_ID;

    if (!apiKey || !universeId) {
      return new Response(JSON.stringify({ error: "Missing API key or Universe ID" }), {
        status: 500, headers: corsHeaders,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const action = body.action || "ban";

    // Lookup full ban details
    if (action === "lookup") {
      const userId = body.userId;
      if (!userId) {
        return new Response(JSON.stringify({ error: "No user ID" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
      try {
        const resp = await fetch(url, {
          headers: { "x-api-key": apiKey, Accept: "application/json" },
        });
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({ found: true, data }), {
            status: 200, headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({ found: false }), {
          status: 200, headers: corsHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // Check ban status (bulk)
    if (action === "check") {
      const { userIds } = body;
      if (!userIds || !Array.isArray(userIds) || !userIds.length) {
        return new Response(JSON.stringify({ error: "No user IDs" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const results = [];
      for (const userId of userIds) {
        const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
        try {
          const resp = await fetch(url, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
          if (resp.ok) {
            const data = await resp.json();
            const active = data?.gameJoinRestriction?.active === true;
            results.push({ userId, banned: active });
          } else {
            results.push({ userId, banned: false });
          }
        } catch {
          results.push({ userId, banned: false });
        }
      }

      return new Response(JSON.stringify({ results }), {
        status: 200, headers: corsHeaders,
      });
    }

    // Unban user
    if (action === "unban") {
      const userId = body.userId;
      if (!userId) {
        return new Response(JSON.stringify({ error: "No user ID" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const url = `https://apis.roblox.com/cloud/v2/universes/${universeId}/user-restrictions/${userId}`;
      const restriction = {
        gameJoinRestriction: {
          active: false,
        },
      };

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
        return new Response(JSON.stringify({
          success: resp.ok,
          status: resp.status,
          response: resp.ok ? JSON.parse(data) : data,
        }), {
          status: 200, headers: corsHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // Ban users
    const { userIds, banAlts, permanent, durationSeconds, publicReason, privateReason } = body;

    if (!userIds || !Array.isArray(userIds) || !userIds.length) {
      return new Response(JSON.stringify({ error: "No user IDs provided" }), {
        status: 400, headers: corsHeaders,
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
      status: 200, headers: corsHeaders,
    });
  },
};
