import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { ACTIONS_SCHEMA, BRIDGE_HEADER, STATE_SCHEMA, corsHeaders, isAllowedOrigin, validateDesktopAction, validateHandoffPayload, validatePublishedState } from "./bridge-core.mjs";

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeHost = "127.0.0.1";
const bridgePort = 47831;
const maxBodyBytes = 24 * 1024 * 1024;
const configuredOrigins = (process.env.CP_DANCE_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);

let overlayWindow = null;
let bridgeServer = null;
let currentState = null;
let currentOrigin = null;
let revision = 0;
let connectedAt = null;
let active = false;
let pendingActions = [];
let actionCounter = 0;
let mousePassthrough = true;
let mouseForwardingTimer = null;

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("桌宠接力数据超过 24 MB 上限");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function statePayload() {
  return { schema: STATE_SCHEMA, active, revision, state: currentState, connectedAt };
}

function preserveInlinedAssets(nextState, previousState) {
  const next = structuredClone(nextState);
  const previousAgents = new Map((previousState?.agents || []).map((agent) => [agent.id, agent]));
  for (const agent of next.agents || []) {
    const previous = previousAgents.get(agent.id);
    if (!previous) continue;
    if (previous.visual?.spriteSheetUrl?.startsWith("data:")) agent.visual.spriteSheetUrl = previous.visual.spriteSheetUrl;
    const previousPacks = new Map((previous.visual?.actionPacks || []).map((pack) => [`${pack.id}:${pack.version}`, pack]));
    agent.visual.actionPacks = (agent.visual.actionPacks || []).map((pack) => {
      const previousPack = previousPacks.get(`${pack.id}:${pack.version}`);
      return previousPack?.sheetUrl?.startsWith("data:") ? { ...pack, sheetUrl: previousPack.sheetUrl } : pack;
    });
  }
  return next;
}

function stopOverlay() {
  active = false;
  revision += 1;
  if (mouseForwardingTimer) clearInterval(mouseForwardingTimer);
  mouseForwardingTimer = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  overlayWindow = null;
}

function setMousePassthrough(passthrough) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  mousePassthrough = Boolean(passthrough);
  if (process.platform === "darwin" || process.platform === "win32") {
    overlayWindow.setIgnoreMouseEvents(mousePassthrough, mousePassthrough ? { forward: true } : undefined);
  }
}

function startMouseForwardingWatchdog() {
  if (mouseForwardingTimer) clearInterval(mouseForwardingTimer);
  mouseForwardingTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (mousePassthrough) {
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = overlayWindow.getBounds();
    overlayWindow.webContents.send("desktop:probe-hit-test", {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
    });
  }, 750);
  mouseForwardingTimer.unref?.();
}

function createOverlay() {
  if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("当前桌宠 MVP 先支持 macOS 与 Windows；Linux 穿透窗口将在下一阶段接入");
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    active = true;
    overlayWindow.showInactive();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const nextOverlayWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: "CP 跳动桌宠",
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: join(desktopDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  overlayWindow = nextOverlayWindow;
  nextOverlayWindow.setAlwaysOnTop(true, "floating", 1);
  nextOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  nextOverlayWindow.setWindowButtonVisibility?.(false);
  nextOverlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  nextOverlayWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith("file:")) event.preventDefault();
  });
  nextOverlayWindow.once("ready-to-show", () => {
    if (overlayWindow !== nextOverlayWindow) return;
    nextOverlayWindow.showInactive();
    setMousePassthrough(true);
    startMouseForwardingWatchdog();
  });
  nextOverlayWindow.on("closed", () => {
    if (overlayWindow !== nextOverlayWindow) return;
    overlayWindow = null;
    active = false;
    revision += 1;
    if (mouseForwardingTimer) clearInterval(mouseForwardingTimer);
    mouseForwardingTimer = null;
  });
  void nextOverlayWindow.loadFile(join(desktopDirectory, "surface.html"));
}

function createBridgeServer() {
  bridgeServer = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const headers = corsHeaders(origin, configuredOrigins);
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, configuredOrigins)) return json(response, 403, { error: "网页来源不被允许" });
      response.writeHead(204, headers);
      return response.end();
    }
    if (request.headers["x-cp-dance-bridge"] !== BRIDGE_HEADER) return json(response, 403, { error: "桌宠桥接标识无效" }, headers);
    const url = new URL(request.url || "/", `http://${bridgeHost}:${bridgePort}`);
    try {
      if (request.method === "GET" && url.pathname === "/v1/status") return json(response, 200, { ready: true, platform: process.platform, active }, headers);
      if (request.method === "GET" && url.pathname === "/v1/state") return json(response, 200, statePayload(), headers);
      if (request.method === "GET" && url.pathname === "/v1/actions") return json(response, 200, { schema: ACTIONS_SCHEMA, actions: pendingActions }, headers);
      if (request.method === "POST" && url.pathname === "/v1/handoff") {
        const payload = await readJsonBody(request);
        const validation = validateHandoffPayload(payload, origin, configuredOrigins);
        if (!validation.ok) return json(response, 400, { error: validation.error }, headers);
        currentState = structuredClone(validation.state);
        currentOrigin = payload.sourceOrigin;
        connectedAt = new Date().toISOString();
        active = true;
        pendingActions = [];
        revision += 1;
        createOverlay();
        return json(response, 202, { accepted: true, revision }, headers);
      }
      if (request.method === "POST" && url.pathname === "/v1/state") {
        const payload = await readJsonBody(request);
        const validation = validatePublishedState(payload, origin, currentOrigin, configuredOrigins);
        if (!active || !validation.ok) return json(response, 400, { error: validation.error || "桌宠当前未运行" }, headers);
        currentState = preserveInlinedAssets(validation.state, currentState);
        revision += 1;
        return json(response, 200, { accepted: true, revision }, headers);
      }
      if (request.method === "POST" && url.pathname === "/v1/actions/ack") {
        const payload = await readJsonBody(request);
        const ids = new Set(Array.isArray(payload.ids) ? payload.ids.filter((id) => typeof id === "string") : []);
        pendingActions = pendingActions.filter((entry) => !ids.has(entry.id));
        return json(response, 200, { acknowledged: ids.size }, headers);
      }
      if (request.method === "POST" && url.pathname === "/v1/stop") {
        stopOverlay();
        return json(response, 200, statePayload(), headers);
      }
      return json(response, 404, { error: "未知桌宠桥接路径" }, headers);
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "桌宠桥接请求失败" }, headers);
    }
  });
  bridgeServer.listen(bridgePort, bridgeHost, () => {
    process.stdout.write(`CP 跳动桌宠伴侣已就绪：http://${bridgeHost}:${bridgePort}\n`);
  });
}

ipcMain.handle("desktop:get-initial-state", (event) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents) return null;
  return currentState ? structuredClone(currentState) : null;
});

ipcMain.handle("desktop:get-bridge-state", (event) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents) return null;
  return { ...statePayload(), sourceOrigin: currentOrigin };
});

ipcMain.handle("desktop:dispatch-action", (event, value) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || !active) throw new Error("桌宠交互被拒绝");
  const validation = validateDesktopAction(value);
  if (!validation.ok) throw new Error(validation.error);
  if ("agentId" in validation.action && !currentState?.agents?.some((agent) => agent.id === validation.action.agentId)) throw new Error("桌宠角色不存在");
  const entry = { id: `desktop-action-${Date.now()}-${actionCounter += 1}`, action: validation.action };
  pendingActions = [...pendingActions.slice(-49), entry];
  return { id: entry.id };
});

ipcMain.on("desktop:set-mouse-passthrough", (event, passthrough) => {
  if (overlayWindow && event.sender === overlayWindow.webContents) setMousePassthrough(Boolean(passthrough));
});

ipcMain.handle("desktop:request-stop", (event) => {
  if (overlayWindow && event.sender === overlayWindow.webContents) stopOverlay();
});

app.whenReady().then(() => {
  app.setName("CP 跳动桌宠");
  app.dock?.hide();
  createBridgeServer();
});

app.on("window-all-closed", () => {
  // The loopback bridge stays available so the browser can launch pets again.
});

app.on("before-quit", () => {
  if (mouseForwardingTimer) clearInterval(mouseForwardingTimer);
  bridgeServer?.close();
});
