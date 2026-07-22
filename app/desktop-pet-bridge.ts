import type { GameAction, GameState } from "@/lib/agent-engine";

export const DESKTOP_BRIDGE_URL = "http://127.0.0.1:47831";
export const DESKTOP_HANDOFF_SCHEMA = "cp-dance/desktop-handoff/v1";
export const DESKTOP_BRIDGE_HEADER = "cp-dance-desktop-v1";

export type DesktopBridgeState = {
  schema: "cp-dance/desktop-bridge-state/v1";
  active: boolean;
  revision: number;
  state: GameState | null;
  connectedAt: string | null;
};

export type DesktopActionEntry = { id: string; action: GameAction };
const desktopAssetCache = new Map<string, Promise<string>>();
let desktopAssetFingerprint = "";

async function desktopBridgeRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${DESKTOP_BRIDGE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "x-cp-dance-bridge": DESKTOP_BRIDGE_HEADER,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "桌宠伴侣暂时不可用");
  return payload;
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("桌宠动作图片转换失败"));
    reader.onerror = () => reject(new Error("桌宠动作图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function inlineDesktopAssets(state: GameState) {
  const copy = structuredClone(state);
  const inline = (value: string | null) => {
    if (!value || value.startsWith("data:")) return Promise.resolve(value || "");
    if (!desktopAssetCache.has(value)) {
      desktopAssetCache.set(value, (async () => {
        const url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin && url.protocol !== "blob:") throw new Error("桌宠只接收已归档到当前站点的角色动作图片");
        const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
        if (!response.ok) throw new Error(`无法读取桌宠动作图片：${response.status}`);
        return blobAsDataUrl(await response.blob());
      })());
    }
    return desktopAssetCache.get(value)!;
  };
  await Promise.all(copy.agents.map(async (agent) => {
    if (agent.visual.spriteSheetUrl) agent.visual.spriteSheetUrl = await inline(agent.visual.spriteSheetUrl);
    if (agent.visual.actionPacks?.length) {
      agent.visual.actionPacks = await Promise.all(agent.visual.actionPacks.map(async (pack) => ({ ...pack, sheetUrl: await inline(pack.sheetUrl) })));
    }
  }));
  return copy;
}

function assetFingerprint(state: GameState) {
  return JSON.stringify(state.agents.map((agent) => ({
    id: agent.id,
    spriteSheetUrl: agent.visual.spriteSheetUrl,
    actionPacks: (agent.visual.actionPacks || []).map((pack) => [pack.id, pack.version, pack.sheetUrl]),
  })));
}

export async function handoffWorldToDesktop(state: GameState) {
  const desktopState = await inlineDesktopAssets(state);
  desktopAssetFingerprint = assetFingerprint(state);
  return desktopBridgeRequest("/v1/handoff", {
    method: "POST",
    body: JSON.stringify({
      schema: DESKTOP_HANDOFF_SCHEMA,
      sourceOrigin: window.location.origin,
      state: desktopState,
    }),
  });
}

export async function readDesktopBridgeState() {
  return desktopBridgeRequest("/v1/state") as Promise<DesktopBridgeState>;
}

export async function publishDesktopWorld(state: GameState) {
  const fingerprint = assetFingerprint(state);
  const desktopState = fingerprint === desktopAssetFingerprint ? state : await inlineDesktopAssets(state);
  desktopAssetFingerprint = fingerprint;
  return desktopBridgeRequest("/v1/state", {
    method: "POST",
    body: JSON.stringify({ schema: "cp-dance/desktop-bridge-state/v1", state: desktopState }),
  }) as Promise<{ accepted: true; revision: number }>;
}

export async function readDesktopActions() {
  const payload = await desktopBridgeRequest("/v1/actions") as { actions?: DesktopActionEntry[] };
  return payload.actions || [];
}

export async function acknowledgeDesktopActions(ids: string[]) {
  if (!ids.length) return;
  await desktopBridgeRequest("/v1/actions/ack", { method: "POST", body: JSON.stringify({ ids }) });
}

export async function stopDesktopPet() {
  return desktopBridgeRequest("/v1/stop", { method: "POST", body: "{}" });
}
