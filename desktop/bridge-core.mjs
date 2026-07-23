export const HANDOFF_SCHEMA = "cp-dance/desktop-handoff/v1";
export const STATE_SCHEMA = "cp-dance/desktop-bridge-state/v1";
export const ACTIONS_SCHEMA = "cp-dance/desktop-actions/v1";
export const BRIDGE_HEADER = "cp-dance-desktop-v1";
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://cp-dance-demo-qxy.otter233.chatgpt.site",
];

export function isAllowedOrigin(origin, configured = []) {
  if (typeof origin !== "string") return false;
  if ([...DEFAULT_ALLOWED_ORIGINS, ...configured].includes(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

export function validateHandoffPayload(payload, requestOrigin, configuredOrigins = []) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "桌宠接力数据不是有效对象" };
  if (payload.schema !== HANDOFF_SCHEMA) return { ok: false, error: "桌宠接力协议版本不受支持" };
  if (!isAllowedOrigin(requestOrigin, configuredOrigins) || payload.sourceOrigin !== requestOrigin) return { ok: false, error: "当前网页来源不在桌宠伴侣允许列表中" };
  const state = payload.state;
  if (!state || typeof state !== "object" || state.phase !== "town" || state.mode !== "natural") return { ok: false, error: "只有已经进入自然模式的世界可以转移到桌面" };
  if (!Array.isArray(state.agents) || state.agents.length < 1 || state.agents.length > 3) return { ok: false, error: "桌宠模式只接受 1—3 名有效角色" };
  if (!state.agents.every((agent) => agent && typeof agent.id === "string" && typeof agent.name === "string" && agent.visual)) return { ok: false, error: "角色桌宠数据不完整" };
  if (!state.spatial || typeof state.spatial !== "object") return { ok: false, error: "角色空间状态不完整" };
  return { ok: true, state };
}

export function validatePublishedState(payload, requestOrigin, currentOrigin, configuredOrigins = []) {
  if (payload?.schema !== STATE_SCHEMA) return { ok: false, error: "桌宠状态协议版本不受支持" };
  const validation = validateHandoffPayload({ schema: HANDOFF_SCHEMA, sourceOrigin: currentOrigin, state: payload.state }, requestOrigin, configuredOrigins);
  if (!validation.ok) return validation;
  if (validation.state.surface !== "desktop_pet") return { ok: false, error: "网页只能向桌宠伴侣发布桌面坐标状态" };
  return validation;
}

export function validateDesktopAction(value) {
  if (!value || typeof value !== "object") return { ok: false, error: "桌宠交互不是有效对象" };
  if (value.type === "SET_RUNNING" && typeof value.running === "boolean") return { ok: true, action: { type: value.type, running: value.running } };
  if (typeof value.agentId !== "string" || !value.agentId) return { ok: false, error: "桌宠交互缺少有效角色" };
  if (value.type === "APPLY_DESKTOP_DRAG") {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !["move", "drop"].includes(value.phase)) return { ok: false, error: "桌宠拖拽坐标无效" };
    return { ok: true, action: { type: value.type, agentId: value.agentId, x: Math.max(4, Math.min(96, value.x)), y: Math.max(8, Math.min(92, value.y)), phase: value.phase, sudden: Boolean(value.sudden) } };
  }
  if (value.type === "APPLY_DESKTOP_POINTER_EVENT" && ["click", "double_click"].includes(value.kind)) {
    return { ok: true, action: { type: value.type, agentId: value.agentId, kind: value.kind } };
  }
  return { ok: false, error: "桌宠交互类型不受支持" };
}

export function corsHeaders(origin, configuredOrigins = []) {
  if (!isAllowedOrigin(origin, configuredOrigins)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-cp-dance-bridge",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}
