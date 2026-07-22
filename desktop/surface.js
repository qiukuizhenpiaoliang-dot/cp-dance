const api = window.cpDanceDesktop;
const surface = document.querySelector("#desktop-surface");
const frameSteps = new Map();
const consumedReactionKeys = new Set();
const scheduledReactionKeys = new Set();
const consumedDialogueKeys = new Set();
const scheduledDialogueKeys = new Set();
let bridgeState = null;
let renderedRevision = -1;
let dragging = null;
let lastMoveSentAt = 0;

const baseActions = {
  idle: { frames: [0, 1, 0, 1], duration: 360 },
  walk: { frames: [4, 5, 6, 7], duration: 170 },
  wave: { frames: [8, 9, 8, 9, 8], duration: 210 },
  cry: { frames: [12, 12, 15], duration: 420 },
  love: { frames: [16, 16, 19, 16], duration: 330 },
  shy: { frames: [0, 1, 0, 1], duration: 420 },
  angry: { frames: [2, 3, 2, 3], duration: 260 },
  talk: { frames: [4, 5, 4, 5], duration: 260 },
  listen: { frames: [6, 7, 6, 7], duration: 360 },
};

const v2Facing = {
  idle: { front: [0, 1, 0, 1], left: [2, 2, 2, 2], right: [3, 3, 3, 3] },
  walk: { left: [4, 5, 4, 5], right: [6, 7, 6, 7] },
  wave: { front: [8, 9, 8, 9], left: [10, 10, 10], right: [11, 11, 11] },
  cry: { front: [12, 12, 15], left: [13, 13, 2], right: [14, 14, 3] },
  love: { front: [16, 16, 19, 16], left: [17, 17, 2, 17], right: [18, 18, 3, 18] },
};

const v1Facing = {
  idle: { front: [0, 2, 0, 2], left: [1, 1, 1, 1], right: [3, 3, 3, 3] },
  walk: { left: [4, 5, 4, 5], right: [6, 7, 6, 7] },
  wave: { left: [8, 8, 8], right: [9, 9, 9] },
  cry: { front: [10, 10, 10] },
  love: { front: [11, 11, 11] },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function absoluteAssetUrl(value) {
  if (!value) return "";
  try { return new URL(value, bridgeState?.sourceOrigin || undefined).toString(); } catch { return ""; }
}

function latestEvent(state) {
  return Array.isArray(state.events) ? state.events[0] : null;
}

function latestAgentDialogueEvent(state) {
  return Array.isArray(state.events) ? state.events.find((event) => event?.id?.startsWith("event-agent-")) || null : null;
}

function transientReactionKey(state) {
  const reaction = state.desktopTransientReaction;
  return reaction ? `${reaction.agentId}:${reaction.revision}` : "";
}

function activeTransientReaction(state, agentId) {
  const reaction = state.desktopTransientReaction;
  const key = transientReactionKey(state);
  return reaction?.agentId === agentId && key && !consumedReactionKeys.has(key) ? reaction : null;
}

function activeAgentDialogue(event, agentName) {
  if (!event?.id?.startsWith("event-agent-")) return null;
  const line = (event.dialogue || []).find((entry) => entry.speaker === agentName)?.text || null;
  const key = line ? `${event.id}:${agentName}` : "";
  return line && !consumedDialogueKeys.has(key) ? { key, line } : null;
}

function actionForAgent(agent, state) {
  const event = latestEvent(state);
  const spatial = state.spatial?.[agent.id];
  const session = state.interactionSession;
  if (session && (agent.id === session.initiatorId || agent.id === session.receiverId)) {
    const initiator = agent.id === session.initiatorId;
    if (session.phase === "approach") return initiator ? "walk" : "listen";
    if (["orient", "align"].includes(session.phase)) return initiator ? "idle" : "listen";
    if (["recover", "cancelled"].includes(session.phase)) return initiator ? session.fallbackActions?.initiator || "idle" : session.fallbackActions?.receiver || "idle";
    return initiator ? session.initiatorAction || "idle" : session.receiverAction || "idle";
  }
  const transient = activeTransientReaction(state, agent.id);
  if (transient) return transient.animationAction || "wave";
  if (!event?.id?.startsWith("event-agent-")) return "idle";
  if (event?.assetActions?.[agent.id]) return event.assetActions[agent.id];
  if (["cuddle", "comfort"].includes(spatial?.intent)) return "love";
  if (["retreat", "wander", "approach", "play"].includes(spatial?.intent)) return "walk";
  if (spatial?.intent === "keep_distance") return "angry";
  if (spatial?.intent === "observe") return "listen";
  if (!event?.actorIds?.includes(agent.id)) return "idle";
  if (event?.dialogue?.length > 1) return event.dialogue[0]?.speaker === agent.name ? "talk" : "listen";
  return "wave";
}

function resolveSprite(agent, state) {
  const visual = agent.visual || {};
  const requested = actionForAgent(agent, state);
  const extension = [...(visual.actionPacks || [])].reverse().find((pack) => pack?.actions?.[requested]);
  if (extension) {
    const config = extension.actions[requested];
    const facing = state.spatial?.[agent.id]?.facing || "front";
    return { sheet: absoluteAssetUrl(extension.sheetUrl), grid: extension.grid, frames: config.facingFrames?.[facing] || config.frames || [0], duration: config.frameDuration || 260 };
  }
  const action = baseActions[requested] ? requested : "idle";
  const config = baseActions[action];
  const facing = state.spatial?.[agent.id]?.facing || "front";
  const map = visual.orientationProtocol === "front-three-quarter-v2" ? v2Facing : visual.orientationProtocol === "front-three-quarter-v1" ? v1Facing : null;
  return { sheet: absoluteAssetUrl(visual.spriteSheetUrl), grid: visual.grid, frames: map?.[action]?.[facing] || map?.[action]?.front || config.frames, duration: config.duration };
}

function sendAction(action) {
  void api.dispatchAction(action).catch(() => {});
}

function pointerPosition(event) {
  return {
    x: Math.max(4, Math.min(96, event.clientX / window.innerWidth * 100)),
    y: Math.max(8, Math.min(92, event.clientY / window.innerHeight * 100)),
  };
}

function bindPetInteraction(card, agent) {
  card.addEventListener("pointerenter", () => api.setMousePassthrough(false));
  card.addEventListener("pointerleave", () => { if (!dragging) api.setMousePassthrough(true); });
  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    api.setMousePassthrough(false);
    card.setPointerCapture(event.pointerId);
    dragging = { agentId: agent.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: event.timeStamp, moved: false, card };
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const displacement = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
    dragging.moved ||= displacement > 5;
    const position = pointerPosition(event);
    card.style.setProperty("--desktop-x", `${position.x}%`);
    card.style.setProperty("--desktop-y", `${position.y}%`);
    if (event.timeStamp - lastMoveSentAt > 55) {
      lastMoveSentAt = event.timeStamp;
      sendAction({ type: "APPLY_DESKTOP_DRAG", agentId: agent.id, ...position, phase: "move" });
    }
  });
  const finish = (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const position = pointerPosition(event);
    const displacement = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
    if (dragging.moved) sendAction({ type: "APPLY_DESKTOP_DRAG", agentId: agent.id, ...position, phase: "drop", sudden: event.timeStamp - dragging.startedAt < 700 && displacement > Math.min(window.innerWidth, window.innerHeight) * .16 });
    else {
      card.classList.add("clicked");
      window.setTimeout(() => card.classList.remove("clicked"), 360);
      sendAction({ type: "APPLY_DESKTOP_POINTER_EVENT", agentId: agent.id, kind: event.detail > 1 ? "double_click" : "click" });
    }
    card.classList.remove("dragging");
    dragging = null;
  };
  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", finish);
}

function render() {
  const state = bridgeState?.state;
  if (!state || dragging) return;
  surface.replaceChildren();
  const dialogueEvent = latestAgentDialogueEvent(state);
  for (const agent of state.agents || []) {
    const spatial = state.spatial?.[agent.id] || { x: 50, y: 65 };
    const card = element("article", "desktop-agent");
    card.dataset.agentId = agent.id;
    card.style.setProperty("--desktop-x", `${spatial.x}%`);
    card.style.setProperty("--desktop-y", `${spatial.y}%`);
    card.style.setProperty("--desktop-scale", String(spatial.renderScale || 1));
    card.style.zIndex = String(10 + Math.round(spatial.y || 0));
    const transient = activeTransientReaction(state, agent.id);
    const agentDialogue = activeAgentDialogue(dialogueEvent, agent.name);
    const line = transient?.dialogue || agentDialogue?.line;
    if (line) {
      const bubble = element("div", "desktop-bubble");
      bubble.append(element("b", "", agent.name), element("span", "", `“${line}”`));
      card.append(bubble);
    }
    if (agentDialogue && !scheduledDialogueKeys.has(agentDialogue.key)) {
      scheduledDialogueKeys.add(agentDialogue.key);
      window.setTimeout(() => {
        consumedDialogueKeys.add(agentDialogue.key);
        scheduledDialogueKeys.delete(agentDialogue.key);
        render();
      }, 3200);
    }
    card.append(element("span", "desktop-shadow"));
    const resolved = resolveSprite(agent, state);
    if (agent.visual?.status === "ready" && resolved.sheet) {
      const sprite = element("span", "desktop-sprite");
      sprite.dataset.agentId = agent.id;
      sprite.dataset.sprite = JSON.stringify(resolved);
      sprite.style.setProperty("--desktop-hue", agent.visual.usesDemoAsset ? `${agent.visual.hueRotate || 0}deg` : "0deg");
      card.append(sprite);
    } else card.append(element("span", "desktop-pending", "?"));
    card.append(element("span", "desktop-name", agent.name));
    bindPetInteraction(card, agent);
    surface.append(card);
  }
  const reactionKey = transientReactionKey(state);
  if (reactionKey && !consumedReactionKeys.has(reactionKey) && !scheduledReactionKeys.has(reactionKey)) {
    scheduledReactionKeys.add(reactionKey);
    window.setTimeout(() => {
      consumedReactionKeys.add(reactionKey);
      scheduledReactionKeys.delete(reactionKey);
      if (transientReactionKey(bridgeState?.state || {}) === reactionKey) render();
    }, 2600);
  }
  updateFrames();
}

function updateFrames() {
  for (const sprite of surface.querySelectorAll(".desktop-sprite")) {
    let resolved;
    try { resolved = JSON.parse(sprite.dataset.sprite || "{}"); } catch { continue; }
    const frames = Array.isArray(resolved.frames) && resolved.frames.length ? resolved.frames : [0];
    const step = frameSteps.get(sprite.dataset.agentId) || 0;
    const frame = frames[step % frames.length];
    const columns = Math.max(1, resolved.grid?.columns || 4);
    const rows = Math.max(1, resolved.grid?.rows || 5);
    const column = frame % columns;
    const row = Math.floor(frame / columns);
    sprite.style.backgroundImage = `url(${JSON.stringify(resolved.sheet)})`;
    sprite.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
    sprite.style.backgroundPosition = `${column / Math.max(1, columns - 1) * 100}% ${row / Math.max(1, rows - 1) * 100}%`;
    frameSteps.set(sprite.dataset.agentId, step + 1);
  }
}

async function refresh() {
  try {
    const next = await api.getBridgeState();
    if (!next?.active) return;
    bridgeState = next;
    if (next.revision !== renderedRevision) {
      renderedRevision = next.revision;
      render();
    }
  } catch {
    // Keep the last visible state while the owner page reconnects.
  }
}

api.setMousePassthrough(true);
api.onProbeHitTest?.(({ x, y }) => {
  if (dragging) {
    api.setMousePassthrough(false);
    return;
  }
  const target = document.elementFromPoint(x, y);
  api.setMousePassthrough(!target?.closest?.(".desktop-agent"));
});
void refresh();
window.setInterval(() => void refresh(), 250);
window.setInterval(updateFrames, 190);
