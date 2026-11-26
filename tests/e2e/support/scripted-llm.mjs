// A scripted stand-in for an LLM provider, for tests only.
//
// It speaks the OpenAI chat-completions streaming protocol the official runtime uses, and
// decides what to "say" from fixed rules instead of a model. That makes the model-driven
// path testable without a real key: the runtime, the agent loop, tool dispatch, consent
// and confirmation are all real; only the model's choices are scripted.
//
// It is never shipped with the sites and nothing in the product points at it. It also
// records every request it receives, so a test can check where a visitor's key went.
import http from "node:http";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, anthropic-dangerous-direct-browser-access",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const SCRIPTED_MODEL = "scripted-test-model";
export const MARK = "SCRIPTED-MODEL";

/** The scripted "model": which tool to call, or what to answer, for one request. */
export function decide({ messages, tools }) {
  const system = String(messages[0]?.content || "");
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  const userText = String(messages[lastUser]?.content || "");
  const results = messages.slice(lastUser + 1).filter((message) => message.role === "tool");
  const names = (tools || []).map((tool) => tool.function?.name);
  const call = (name, args) => ({ tool: { name, args } });

  if (results.length) {
    const summary = results.map((message) => `${message.name}: ${String(message.content).replace(/\s+/g, " ").slice(0, 220)}`).join(" | ");
    return { text: `${MARK} answer. ${summary}` };
  }
  // A partner network (ShelterConnect) running in the caller's browser.
  if (/assistant on the ShelterConnect website/.test(system) && names.includes("website_get_shelter_overview")) return call("website_get_shelter_overview", {});
  // ReliefMesh Command's NeedAssessmentAgent.
  if (/assess shelter needs/.test(system) && /urgent/i.test(userText) && names.includes("shelterconnect")) return call("shelterconnect", { request: "Which shelters are most urgent right now?" });
  // ReliefMesh Command's front agent.
  if (/coordinating assistant on the ReliefMesh Command website/.test(system)) {
    if (/approv/i.test(userText) && names.includes("website_submit_plan_for_approval")) return call("website_submit_plan_for_approval", {});
    if (/urgent/i.test(userText) && names.includes("NeedAssessmentAgent")) return call("NeedAssessmentAgent", { request: userText });
    if (names.includes("website_get_command_state")) return call("website_get_command_state", {});
  }
  return { text: `${MARK} answer. No tool was needed.` };
}

function sse(response, chunks) {
  response.writeHead(200, { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

export async function startScriptedLlm(port = 0) {
  const requests = [];
  let sequence = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") { response.writeHead(204, CORS); response.end(); return; }
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      response.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: SCRIPTED_MODEL, object: "model" }] }));
      return;
    }
    if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      let body = "";
      request.on("data", (part) => { body += part; });
      request.on("end", () => {
        let payload;
        try { payload = JSON.parse(body); } catch { response.writeHead(400, CORS); response.end("bad json"); return; }
        const decision = decide(payload);
        requests.push({
          origin: request.headers.origin || "",
          authorization: request.headers.authorization || "",
          model: payload.model,
          system: String(payload.messages?.[0]?.content || ""),
          tools: (payload.tools || []).map((tool) => tool.function?.name),
          decision: decision.tool ? `call ${decision.tool.name}` : "answer",
        });
        const id = `chatcmpl-scripted-${++sequence}`;
        const base = { id, object: "chat.completion.chunk", model: payload.model };
        if (decision.tool) {
          sse(response, [
            { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${sequence}`, type: "function", function: { name: decision.tool.name, arguments: JSON.stringify(decision.tool.args) } }] }, finish_reason: null }] },
            { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
          ]);
        } else {
          const words = decision.text.match(/\S+\s*/g) || [decision.text];
          sse(response, [
            { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
            ...words.map((word) => ({ ...base, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] })),
            { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ]);
        }
      });
      return;
    }
    response.writeHead(404, CORS);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    // "localhost", not 127.0.0.1: the pages under test are served from localhost.
    baseUrl: `http://localhost:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
