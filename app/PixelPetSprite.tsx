"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  availablePixelPetActions,
  resolvePixelPetAction,
  type PixelPetActionDefinition,
  type PixelPetActionName,
  type PixelPetFacing,
  type PixelPetProfile,
  type PixelPetRuntimeActionName,
} from "@/lib/pixel-pet";
import type { ActionPhaseMarker, InteractionPlaybackPhase } from "@/lib/action-unit";
import { repairExistingSpriteSheet } from "./sprite-sheet-normalizer";

type Props = {
  visual: PixelPetProfile;
  name: string;
  action?: PixelPetRuntimeActionName;
  facing?: PixelPetFacing;
  small?: boolean;
  interactive?: boolean;
  playbackPhase?: InteractionPlaybackPhase | null;
  playbackRate?: number;
  strictFacing?: boolean;
};

function framesForPlaybackPhase(frames: readonly number[], markers: ActionPhaseMarker[] | undefined, phase: InteractionPlaybackPhase | null | undefined) {
  if (!phase || !markers?.length || frames.length < 2) return frames;
  const markerIndex = markers.findIndex((marker) => marker.phase === phase);
  if (markerIndex < 0) return frames;
  const start = Math.min(frames.length - 1, Math.floor(markers[markerIndex].progress * frames.length));
  const nextProgress = markers[markerIndex + 1]?.progress ?? 1;
  const end = Math.max(start + 1, Math.min(frames.length, Math.ceil(nextProgress * frames.length)));
  return frames.slice(start, end);
}

const INTERACTION_LINES: Record<string, string> = {
  idle: "今天也要慢慢发光。",
  walk: "去那边看看吧。",
  wave: "嗨！我看到你啦。",
  cry: "只是眼睛进像素了……",
  love: "收到你的喜欢啦！",
  shy: "被你发现我脸红了……",
  angry: "我需要一点空间。",
  talk: "我想把这件事告诉你。",
  listen: "嗯，我在认真听。",
};

const ACTION_SYMBOLS: Record<string, string> = {
  idle: "···",
  walk: "→",
  wave: "⌁",
  cry: "•",
  love: "♥",
  shy: "⁄⁄",
  angry: "!!",
  talk: "…",
  listen: "◌",
};

export function PixelPetSprite({ visual, name, action = "idle", facing = "front", small = false, interactive = false, playbackPhase = null, playbackRate = 1, strictFacing = false }: Props) {
  const [frameStep, setFrameStep] = useState(0);
  const [overrideAction, setOverrideAction] = useState<PixelPetActionName | null>(null);
  const [repairState, setRepairState] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);
  const returnTimer = useRef<number | null>(null);
  const activeAction = overrideAction || action;
  const requestedAction = resolvePixelPetAction(visual, activeAction);
  const requestedConfig = requestedAction.config as PixelPetActionDefinition;
  const requestedDirectionalFrames = requestedConfig.facingFrames?.[facing];
  const useRecoveryPose = strictFacing && (playbackPhase === "prepare" || playbackPhase === "recover");
  const resolvedAction = useRecoveryPose || (strictFacing && facing !== "front" && !requestedDirectionalFrames?.length)
    ? resolvePixelPetAction(visual, "idle")
    : requestedAction;
  const repairKey = resolvedAction.requiresSmartRepair
    ? `${resolvedAction.sheetUrl}|${resolvedAction.grid.columns}x${resolvedAction.grid.rows}`
    : null;
  const repairedSheetUrl = repairState?.key === repairKey ? repairState.url : null;
  const repairFailed = repairState?.key === repairKey && repairState.failed;
  const actionConfig: PixelPetActionDefinition = resolvedAction.config;
  const directionalFrames = actionConfig.facingFrames?.[facing];
  const waitingForSmartRepair = resolvedAction.requiresSmartRepair && !repairedSheetUrl;
  const baseActionFrames = waitingForSmartRepair ? [0] : directionalFrames?.length ? directionalFrames : actionConfig.frames;
  const actionFrames = framesForPlaybackPhase(baseActionFrames, actionConfig.unit?.phases, playbackPhase);
  const hasDirectionalFrames = Boolean(directionalFrames?.length);
  const frame = actionFrames[frameStep % actionFrames.length];
  const column = frame % resolvedAction.grid.columns;
  const row = Math.floor(frame / resolvedAction.grid.columns);

  useEffect(() => {
    const duration = (small ? Math.max(420, actionConfig.frameDuration) : actionConfig.frameDuration) / Math.max(0.65, Math.min(1.5, playbackRate));
    const timer = window.setInterval(() => setFrameStep((value) => value + 1), duration);
    return () => window.clearInterval(timer);
  }, [actionConfig.frameDuration, activeAction, playbackPhase, playbackRate, small]);

  useEffect(() => {
    let cancelled = false;
    if (!repairKey || !resolvedAction.sheetUrl) return () => { cancelled = true; };
    void repairExistingSpriteSheet(
      resolvedAction.sheetUrl,
      resolvedAction.grid.columns,
      resolvedAction.grid.rows,
    ).then((result) => {
      if (!cancelled) setRepairState({ key: repairKey, url: result.sheetUrl, failed: false });
    }).catch(() => {
      if (!cancelled) setRepairState({ key: repairKey, url: null, failed: true });
    });
    return () => { cancelled = true; };
  }, [repairKey, resolvedAction.grid.columns, resolvedAction.grid.rows, resolvedAction.sheetUrl]);

  useEffect(() => () => {
    if (returnTimer.current) window.clearTimeout(returnTimer.current);
  }, []);

  const style = useMemo(() => ({
    "--pet-frame-x": `${(column / Math.max(1, resolvedAction.grid.columns - 1)) * 100}%`,
    "--pet-frame-y": `${(row / Math.max(1, resolvedAction.grid.rows - 1)) * 100}%`,
    "--pet-sheet": `url(${JSON.stringify(repairedSheetUrl || resolvedAction.sheetUrl)})`,
    "--pet-sheet-size-x": `${resolvedAction.grid.columns * 100}%`,
    "--pet-sheet-size-y": `${resolvedAction.grid.rows * 100}%`,
    "--pet-hue": visual.usesDemoAsset ? `${visual.hueRotate}deg` : "0deg",
  }) as CSSProperties, [column, repairedSheetUrl, row, resolvedAction.grid.columns, resolvedAction.grid.rows, resolvedAction.sheetUrl, visual.hueRotate, visual.usesDemoAsset]);

  function interact() {
    if (!interactive || visual.status !== "ready") return;
    const next = overrideAction === "wave" ? "love" : "wave";
    setOverrideAction(next);
    setFrameStep(0);
    if (returnTimer.current) window.clearTimeout(returnTimer.current);
    returnTimer.current = window.setTimeout(() => setOverrideAction(null), 2400);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      interact();
    }
  }

  if (visual.status !== "ready" || !visual.spriteSheetUrl) {
    return <div className={`pixel-pet-pending ${small ? "small" : ""}`} aria-label={`${name}的可交互角色待制作`}><i /><span>?</span></div>;
  }

  return (
    <div
      className={`pixel-pet-avatar action-${resolvedAction.action} facing-${facing} ${playbackPhase ? `sync-phase-${playbackPhase}` : ""} ${strictFacing ? "strict-facing" : ""} ${hasDirectionalFrames ? "has-directional-frames" : ""} ${repairedSheetUrl ? "smart-repaired" : ""} ${repairFailed ? "repair-failed" : ""} ${small ? "small" : ""} ${interactive ? "interactive" : ""}`}
      style={style}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      onClick={interact}
      onKeyDown={onKeyDown}
      aria-label={`${name}的可交互角色·${actionConfig.label}·${facing === "front" ? "正面" : `朝${facing === "left" ? "左" : "右"}侧转`}`}
    >
      <span className="pixel-pet-shadow" />
      <span className="pixel-pet-frame" />
    </div>
  );
}

export function InteractivePixelPetPlayground({ visual, name }: Pick<Props, "visual" | "name">) {
  const [currentAction, setCurrentAction] = useState<PixelPetRuntimeActionName>("idle");
  const [position, setPosition] = useState({ x: 50, y: 62 });
  const [friendship, setFriendship] = useState(86);
  const [speech, setSpeech] = useState(INTERACTION_LINES.idle);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const returnTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const ready = visual.status === "ready" && Boolean(visual.spriteSheetUrl);
  const availableActions = availablePixelPetActions(visual);

  useEffect(() => () => {
    if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
  }, []);

  useEffect(() => {
    if (currentAction !== "walk" || !ready) return;
    let direction = 1;
    const timer = window.setInterval(() => {
      setPosition((value) => {
        if (value.x >= 82) direction = -1;
        if (value.x <= 18) direction = 1;
        return { ...value, x: value.x + direction * 1.35 };
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [currentAction, ready]);

  function triggerAction(action: PixelPetRuntimeActionName) {
    if (!ready) return;
    if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current);
    setCurrentAction(action);
    setSpeech(INTERACTION_LINES[action] || `${resolvePixelPetAction(visual, action).config.label}！`);
    if (action === "love") setFriendship((value) => Math.min(100, value + 3));
    if (action !== "idle") {
      returnTimerRef.current = window.setTimeout(() => {
        setCurrentAction("idle");
        setSpeech(INTERACTION_LINES.idle);
      }, action === "walk" ? 4200 : 2600);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!ready) return;
    draggingRef.current = true;
    movedRef.current = false;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !stageRef.current) return;
    const distance = Math.hypot(
      event.clientX - pointerStartRef.current.x,
      event.clientY - pointerStartRef.current.y,
    );
    if (distance > 4) movedRef.current = true;
    const bounds = stageRef.current.getBoundingClientRect();
    setPosition({
      x: Math.max(16, Math.min(84, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(32, Math.min(72, ((event.clientY - bounds.top) / bounds.height) * 100)),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleClick() {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => triggerAction("wave"), 220);
  }

  function handleDoubleClick() {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    triggerAction("love");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      triggerAction(event.shiftKey ? "love" : "wave");
    }
  }

  return (
    <div className="interactive-pet-playground">
      <div className="interactive-pet-stage" ref={stageRef}>
        <output className="interactive-pet-speech" style={{ left: `${position.x}%` }}>{speech}</output>
        <div
          className="interactive-pet-character"
          style={{ left: `${position.x}%`, top: `${position.y}%` }}
          role="button"
          tabIndex={ready ? 0 : -1}
          aria-label={`拖动${name}；单击挥手；双击心动`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={onKeyDown}
        >
          <PixelPetSprite visual={visual} name={name} action={currentAction} />
        </div>
        <div className="interactive-pet-friendship"><span>FRIENDSHIP</span><i><b style={{ width: `${friendship}%` }} /></i><strong>{friendship}</strong></div>
      </div>
      <div className="interactive-pet-actions" aria-label="角色动作控制">
        {availableActions.map((action) => (
          <button
            className={currentAction === action ? "active" : ""}
            type="button"
            key={action}
            disabled={!ready}
            onClick={() => triggerAction(action)}
            aria-pressed={currentAction === action}
          >
            <span aria-hidden="true">{ACTION_SYMBOLS[action] || "+"}</span>{resolvePixelPetAction(visual, action).config.label}
          </button>
        ))}
      </div>
      <p className="interactive-pet-hint">拖动角色 · 单击挥手 · 双击心动</p>
    </div>
  );
}
