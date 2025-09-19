// src/agent/aiToken.js
const https = require("https");

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method: "POST",
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      headers: { "Content-Type": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data || "{}") }); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

async function getAiToken() {
  const ENDPOINT = process.env.AISHA_AI_TOKEN_URL || "https://hub.aishacrm.app/api/ai/token";
  try {
    const { status, json } = await postJSON(ENDPOINT, { client: "electron" });
    if (status === 200 && json && json.token) return json.token;
    console.warn("[aiToken] Unexpected response", status, json);
    return null;
  } catch (err) {
    console.warn("[aiToken] token fetch failed (stub fallback):", err?.message || err);
    return null;
  }
}

module.exports = { getAiToken };
