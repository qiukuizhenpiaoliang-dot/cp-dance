import test from "node:test";
import assert from "node:assert/strict";
import { HANDOFF_SCHEMA, STATE_SCHEMA, corsHeaders, isAllowedOrigin, validateDesktopAction, validateHandoffPayload, validatePublishedState } from "./bridge-core.mjs";

const state = {
  phase: "town",
  mode: "natural",
  agents: [{ id: "a", name: "A", visual: { status: "ready" } }],
  spatial: { a: { x: 20, y: 70 } },
};

test("desktop bridge accepts configured sites and local development origins", () => {
  const productionOrigin = "https://cp-dance-demo-qxy.otter233.chatgpt.site";
  assert.equal(isAllowedOrigin(productionOrigin), true);
  assert.equal(corsHeaders(productionOrigin)["access-control-allow-origin"], productionOrigin);
  assert.equal(corsHeaders(productionOrigin)["access-control-allow-private-network"], "true");
  assert.equal(isAllowedOrigin("https://cp-dance.example", ["https://cp-dance.example"]), true);
  assert.equal(isAllowedOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedOrigin("https://example.com"), false);
  assert.equal(isAllowedOrigin("https://another-demo.otter233.chatgpt.site"), false);
});

test("desktop handoff validates natural world and matching origin", () => {
  const origin = "http://localhost:3000";
  assert.deepEqual(validateHandoffPayload({ schema: HANDOFF_SCHEMA, sourceOrigin: origin, state }, origin), { ok: true, state });
  assert.equal(validateHandoffPayload({ schema: HANDOFF_SCHEMA, sourceOrigin: "https://example.com", state }, origin).ok, false);
  assert.equal(validateHandoffPayload({ schema: HANDOFF_SCHEMA, sourceOrigin: origin, state: { ...state, mode: "director" } }, origin).ok, false);
});

test("owner page remains authoritative for desktop state", () => {
  const origin = "http://localhost:3000";
  const desktopState = { ...state, surface: "desktop_pet" };
  assert.equal(validatePublishedState({ schema: STATE_SCHEMA, state: desktopState }, origin, origin).ok, true);
  assert.equal(validatePublishedState({ schema: STATE_SCHEMA, state: { ...desktopState, surface: "web" } }, origin, origin).ok, false);
  assert.equal(validatePublishedState({ schema: STATE_SCHEMA, state: desktopState }, "https://example.com", origin).ok, false);
});

test("desktop renderer can propose only bounded public pointer actions", () => {
  assert.deepEqual(validateDesktopAction({ type: "APPLY_DESKTOP_DRAG", agentId: "a", x: 200, y: -20, phase: "drop", sudden: true }), {
    ok: true,
    action: { type: "APPLY_DESKTOP_DRAG", agentId: "a", x: 96, y: 8, phase: "drop", sudden: true },
  });
  assert.equal(validateDesktopAction({ type: "APPLY_DESKTOP_POINTER_EVENT", agentId: "a", kind: "click" }).ok, true);
  assert.equal(validateDesktopAction({ type: "HYDRATE", state }).ok, false);
});
