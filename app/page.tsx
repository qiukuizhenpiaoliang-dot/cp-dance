"use client";

import { type CSSProperties, type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CharacterSpatialState, ChronicleEvent, ExperienceMode, GameState, StoryAgent } from "@/lib/agent-engine";
import { directionSummary, gameReducer, initialGameState, projectRuntimeSurface, relationshipLabel, spatialIntentLabel } from "@/lib/agent-engine";
import { interactionPhaseLabel, type InteractionSession } from "@/lib/interaction-session";
import type { InteractionPlaybackPhase } from "@/lib/action-unit";
import type { PixelPetProfile, PixelPetRuntimeActionName } from "@/lib/pixel-pet";
import {
  createCharacterSave,
  readCharacterSaveLibrary,
  syncCharactersFromWorld,
  upsertCharacterSave,
  type CharacterSaveRecord,
} from "@/lib/character-save";
import {
  createWorldSave,
  readWorldSaveLibrary,
  upsertWorldSave,
  type WorldSaveRecord,
} from "@/lib/world-save";
import { PixelPetForge } from "./PixelPetForge";
import { PixelPetSprite } from "./PixelPetSprite";
import { acknowledgeDesktopActions, handoffWorldToDesktop, publishDesktopWorld, readDesktopActions, readDesktopBridgeState, stopDesktopPet } from "./desktop-pet-bridge";
import { RelationshipGraphEditor } from "./RelationshipGraphEditor";
import { runNaturalAgentTurn, type AssetUpdate } from "./natural-agent-runtime";
import { requestDirectorDecision, requestStoryCompaction } from "./story-director-runtime";
import { resolveBackgroundAsset } from "./background-agent-runtime";
import { buildDirectorTask, DEFAULT_STORY_SCENE, DEFAULT_STORY_SETUP, directorTaskTypeForState, normalizeStorySetup, parsePlayerDirective, shouldInvokeDirector } from "@/lib/director-runtime";
import type { StorySetup } from "@/lib/director-types";
import { buildStoryCompactionTask, deterministicStorySummary, shrinkStoryCompactionTask, storyCompactionReady, storyCompactionRequiredBeforeDirector } from "@/lib/story-context";
import { latestMemoryRevision, memoryEpistemicLabel, memoryRevisionCount, selectCharacterMemory, selectRoleplayMemoryCues } from "@/lib/character-memory";
import {
  createEmptyCharacterReferencePack,
  normalizeCharacterProfileDistillation,
  normalizeCharacterReferencePack,
  type CharacterProfileDistillationV1,
  type CharacterReferencePackV1,
  type CharacterResearchCandidate,
} from "@/lib/character-reference";

type SaveKind = "world" | "character";

async function fetchSaveLibrary() {
  const response = await fetch("/api/saves", { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as { worlds?: unknown[]; characters?: unknown[]; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || "后端存档暂时不可用");
  return {
    worlds: readWorldSaveLibrary(JSON.stringify(payload?.worlds || [])),
    characters: readCharacterSaveLibrary(JSON.stringify(payload?.characters || [])),
  };
}

async function persistSave(kind: SaveKind, record: WorldSaveRecord | CharacterSaveRecord) {
  const response = await fetch("/api/saves", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, record }),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || "后端存档写入失败");
}

function formatSaveTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function worldRevision(state: GameState) {
  // R1: selective stringify. Fully serializes small/critical structures
  // (relationships, spatial, assetJobs, director, publicDialogue, storyContext)
  // but reduces memory documents to `{id, revCount, latestRevId}` per file to
  // avoid a deep clone of every long-text memory revision every comparison.
  // Every change that used to flip the old JSON string still flips this one.
  const comparable = projectRuntimeSurface(state, "web");
  return JSON.stringify({
    turn: comparable.turn,
    eventIds: comparable.events.map((event) => event.id),
    compressionCount: comparable.compressionCount,
    agents: comparable.agents.map((agent) => ({
      id: agent.id,
      mood: agent.mood,
      privateThought: agent.privateThought,
      profile: agent.profile,
      referencePack: agent.referencePack,
      memoryDigest: {
        recent: agent.memory.recent,
        summaries: agent.memory.summaries,
        facts: agent.memory.facts,
        unresolvedThreads: agent.memory.unresolvedThreads,
        roleplayCues: agent.memory.roleplayCues,
        accessLogCount: agent.memory.accessLog.length,
        files: agent.memory.files.map((file) => ({
          id: file.id,
          latestRevisionId: file.revisions.at(-1)?.id ?? "",
          revCount: file.revisions.length,
        })),
      },
      actionRevision: agent.visual.actionRevision,
    })),
    relationships: comparable.relationships.map((relationship) => ({ id: relationship.id, directions: relationship.directions, history: relationship.history, lastReason: relationship.lastReason })),
    spatial: comparable.spatial,
    assetJobs: comparable.assetJobs,
    interactionSession: comparable.interactionSession,
    publicDialogue: comparable.publicDialogue,
    mode: comparable.mode,
    director: comparable.director,
    storyScene: comparable.storyScene,
    worldEntities: comparable.worldEntities,
    storyPublicEvents: comparable.storyPublicEvents,
    storySummaryRevisions: comparable.storySummaryRevisions,
    storyContextRuntime: comparable.storyContextRuntime,
  });
}

function actionForAgent(agent: StoryAgent, event: ChronicleEvent | undefined, spatial?: CharacterSpatialState, session?: InteractionSession | null): PixelPetRuntimeActionName {
  if (session && (agent.id === session.initiatorId || agent.id === session.receiverId)) {
    const initiator = agent.id === session.initiatorId;
    if (session.phase === "approach") return initiator ? "walk" : "listen";
    if (session.phase === "orient" || session.phase === "align") return initiator ? "idle" : "listen";
    if (session.phase === "recover" || session.phase === "cancelled") return initiator ? session.fallbackActions.initiator : session.fallbackActions.receiver;
    return initiator ? session.initiatorAction : session.receiverAction;
  }
  if (!event?.id.startsWith("event-agent-")) return "idle";
  const assetAction = event?.assetActions?.[agent.id];
  if (assetAction) return assetAction;
  if (spatial) {
    if (spatial.intent === "cuddle" || spatial.intent === "comfort") return "love";
    if (spatial.intent === "retreat" || spatial.intent === "wander" || spatial.intent === "approach" || spatial.intent === "play") return "walk";
    if (spatial.intent === "keep_distance") return "angry";
    if (spatial.intent === "observe") return "listen";
    if (spatial.intent === "rest") return "idle";
  }
  if (!event?.actorIds.includes(agent.id)) return "idle";
  if (event.resolution?.outcome === "boundary" || /拒绝|疏远|未解决/.test(`${event.title}${event.summary}`)) return "angry";
  if (/靠近|心动|愿意|修复/.test(`${event.title}${event.summary}${agent.mood}`)) return "shy";
  if (event.dialogue.length > 1) return event.dialogue[0]?.speaker === agent.name ? "talk" : "listen";
  return "wave";
}

function sessionPlaybackPhase(session: InteractionSession | null): InteractionPlaybackPhase | null {
  return session && ["prepare", "contact_start", "contact_hold", "contact_end", "recover"].includes(session.phase)
    ? session.phase as InteractionPlaybackPhase
    : null;
}

type StageAgentStyle = CSSProperties & {
  "--agent-x": string;
  "--agent-y": string;
  "--agent-depth": number;
};
function stageAgentStyle(spatial: CharacterSpatialState | undefined): StageAgentStyle | undefined {
  if (!spatial) return undefined;
  return {
    "--agent-x": `${spatial.x}%`,
    "--agent-y": `${spatial.y}%`,
    "--agent-depth": (0.86 + (spatial.y - 57) / 100) * (spatial.renderScale || 1),
    zIndex: 6 + Math.min(2, Math.round((spatial.y - 57) / 11)),
  };
}

function duoInteractionLabel(interaction: NonNullable<ChronicleEvent["duoValidation"]>["interaction"]) {
  return { touch: "轻触", hand_contact: "牵手", hug: "拥抱", cuddle: "贴贴", head_touch: "摸头", shoulder_lean: "靠肩", pat: "轻拍", push: "推开", shared_action: "共同动作", joint_walk: "一起走", dance: "跳舞", chase: "追逐", assist: "搀扶", conversation: "面对面交谈", eye_contact: "相互对视" }[interaction];
}

function interactionSessionLabel(session: InteractionSession) {
  return session.kind === "approach" ? "正常接近" : duoInteractionLabel(session.kind);
}

function NoticeToast({ label, message, tone = "default", onClose }: { label: string; message: string; tone?: "default" | "fallback" | "story"; onClose?: () => void }) {
  return (
    <div className={`toast-notice tone-${tone}`} role="status">
      <b>{label}</b>
      <span>{message}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="关闭提示">×</button>}
    </div>
  );
}

function paginateDisplayText(value: string, maxCharacters: number) {
  const pages: string[] = [];
  let remaining = value.trim();
  const preferredBreaks = ["\n", "。", "！", "？", "；", "……", "，", "、", ".", "!", "?", ";", ",", " "];
  while (remaining.length > maxCharacters) {
    const candidate = remaining.slice(0, maxCharacters + 1);
    let cut = preferredBreaks.reduce((best, marker) => Math.max(best, candidate.lastIndexOf(marker)), -1);
    if (cut < Math.floor(maxCharacters * 0.55)) cut = maxCharacters;
    else cut += 1;
    pages.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) pages.push(remaining);
  return pages.length ? pages : [""];
}

function PagedText({ text, pageSize = 72, quoted = false, className = "" }: { text: string; pageSize?: number; quoted?: boolean; className?: string }) {
  const pages = useMemo(() => paginateDisplayText(text, pageSize), [pageSize, text]);
  const [pageState, setPageState] = useState({ source: text, index: 0 });
  const currentPage = pageState.source === text ? Math.min(pageState.index, pages.length - 1) : 0;
  return (
    <div className={`paged-copy ${className}`.trim()}>
      <p>{quoted ? `“${pages[currentPage]}”` : pages[currentPage]}</p>
      {pages.length > 1 && <nav className="paged-copy-controls" aria-label="文字翻页"><button type="button" onClick={() => setPageState({ source: text, index: Math.max(0, currentPage - 1) })} disabled={currentPage === 0} aria-label="上一页">‹</button><span>{currentPage + 1} / {pages.length}</span><button type="button" onClick={() => setPageState({ source: text, index: Math.min(pages.length - 1, currentPage + 1) })} disabled={currentPage === pages.length - 1} aria-label="下一页">›</button></nav>}
    </div>
  );
}

function CollapseButton({ expanded, controls, onToggle }: { expanded: boolean; controls: string; onToggle: () => void }) {
  return <button className="panel-collapse-button" type="button" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>{expanded ? "收起" : "展开"}</button>;
}

function actionAssetStatusLabel(status: GameState["assetJobs"][number]["status"]) {
  return { requested: "已请求", generating: "生成中", validating: "校验中", ready: "可用", failed: "失败", deprecated: "已停用" }[status];
}

function ActionAssetControl({ jobs, agents }: { jobs: GameState["assetJobs"]; agents: StoryAgent[] }) {
  if (!jobs.length) return null;
  return <details className="control-asset-menu"><summary>动作资产 {jobs.length}</summary><div>{jobs.map((job) => <article key={job.id}><b>{agents.find((agent) => agent.id === job.characterId)?.name || "角色"}</b><span>{job.semanticIntent}</span><em className={`status-${job.status}`}>{actionAssetStatusLabel(job.status)}</em>{job.error && <small>{job.error}</small>}</article>)}</div></details>;
}

type RuntimeStatusItem = { id: string; label: string; message: string; tone?: "default" | "fallback" | "story"; onClose?: () => void };

function StatusObservatory({ items, collapsed, onToggle }: { items: RuntimeStatusItem[]; collapsed: boolean; onToggle: () => void }) {
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const [pageIndex, setPageIndex] = useState(0);
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const visibleItems = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className={`status-observatory ${collapsed ? "is-collapsed" : ""}`} aria-labelledby="status-observatory-title"><header><div><span>STATUS</span><h2 id="status-observatory-title">状态观测台</h2><small>{items.length} 项运行信息 · 不影响角色与世界结果</small></div><div>{!collapsed && pageCount > 1 && <nav className="rail-page-controls" aria-label="状态信息翻页"><button type="button" onClick={() => setPageIndex(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>‹</button><span>{currentPage + 1} / {pageCount}</span><button type="button" onClick={() => setPageIndex(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage === pageCount - 1}>›</button></nav>}<CollapseButton expanded={!collapsed} controls="status-observatory-content" onToggle={onToggle} /></div></header>{!collapsed && <div id="status-observatory-content" className="status-observatory-content">{visibleItems.map((item) => <article className={`tone-${item.tone || "default"}`} key={item.id}><b>{item.label}</b><PagedText text={item.message} pageSize={180} />{item.onClose && <button type="button" className="status-dismiss" onClick={item.onClose} aria-label={`关闭${item.label}`}>×</button>}</article>)}</div>}</section>;
}

function EventEntry({ event, index }: { event: ChronicleEvent; index: number }) {
  return (
    <details className={`event-entry kind-${event.kind}`} open={index === 0 || undefined}>
      <summary>
        <span className="event-index">{event.level}</span>
        <span className="event-copy"><small>DAY {event.day} · {event.time} · {event.mode === "story" ? "导演模式" : "自然模式"}</small><strong>{event.title}</strong><em>{event.summary}</em></span>
        <span className="event-toggle">＋</span>
      </summary>
      <div className="event-detail">
        {event.resolution?.actionSequence?.length ? <div className="spatial-sequence"><span>行动</span><p>{event.resolution.actionSequence.map((action, actionIndex) => <b key={`${event.id}-action-${actionIndex}`}>{actionIndex + 1}. {action}</b>)}</p></div> : null}
        {event.dialogue.map((line, lineIndex) => <blockquote key={`${event.id}-${lineIndex}`}><b>{line.speaker}</b><p>“{line.text}”</p></blockquote>)}
        {event.impact && <div className="event-impact"><span>后续</span><b>{event.impact}</b></div>}
        {Object.values(event.memoryWrites || {}).length > 0 && <div className="memory-write"><span>角色内心</span>{Object.values(event.memoryWrites).map((memory, memoryIndex) => <p key={`${event.id}-memory-${memoryIndex}`}>{memory}</p>)}</div>}
      </div>
    </details>
  );
}

type AgentDraft = { name: string; personality: string; background: string; roleplayNotes: string; referencePack: CharacterReferencePackV1 };
const emptyDraft = (): AgentDraft => ({ name: "", personality: "", background: "", roleplayNotes: "", referencePack: createEmptyCharacterReferencePack() });

function referenceClaimLabel(type: string) {
  return { identity: "身份", background: "背景", timeline: "时间线", behavior: "行为锚点", value: "价值观", speech_pattern: "表达方式", boundary: "边界", relationship: "关系" }[type] || "设定";
}

function researchCandidateLabel(candidate: CharacterResearchCandidate) {
  const source = candidate.sourceKind === "moegirl" ? "萌娘百科" : candidate.sourceKind === "wikidata" ? "Wikidata" : "Wikipedia";
  if (candidate.matchKind === "exact") return `${source} · ${candidate.entityKind === "character" ? "精确角色" : candidate.entityKind === "person" ? "精确人物" : "精确条目·待核对"}`;
  if (candidate.matchKind === "alias") return `${source} · 别名匹配`;
  return `${source} · ${candidate.entityKind === "character" ? "角色候选" : candidate.entityKind === "person" ? "人物候选" : "相关条目·待核对"}`;
}

function researchCandidateSource(candidate: CharacterResearchCandidate) {
  if (candidate.sourceKind === "moegirl") return "萌娘百科页面";
  if (candidate.sourceKind === "wikidata") return candidate.qid || "Wikidata 实体";
  return candidate.qid ? `${candidate.qid} · Wikipedia` : "Wikipedia 页面";
}

function referenceSourceName(kind: "wikipedia" | "wikidata" | "moegirl", language: string) {
  if (kind === "moegirl") return "萌娘百科";
  return kind === "wikidata" ? "Wikidata" : `${language.toUpperCase()} Wikipedia`;
}

function referenceEvidenceLabel(pack: CharacterReferencePackV1, sourceIds: string[]) {
  return sourceIds.map((id) => pack.sources.find((source) => source.id === id)).filter(Boolean).map((source) => source?.kind === "moegirl" ? "萌娘百科" : source?.kind === "wikidata" ? "Wikidata" : "Wikipedia").join(" + ");
}

function referenceCoverageLabel(pack: CharacterReferencePackV1) {
  const pages = pack.sources.filter((source) => source.contentMode === "full_page");
  if (!pages.length) return "百科摘要整理";
  const characters = pages.reduce((total, source) => total + (source.contentCharacters || 0), 0);
  const sections = pages.reduce((total, source) => total + (source.contentSections || 0), 0);
  const chunks = pages.reduce((total, source) => total + (source.contentChunks || 0), 0);
  return `整页扫描 ${characters.toLocaleString("zh-CN")} 字 · ${sections} 个章节 · ${chunks} 段提炼`;
}

function referenceSourceCoverage(source: CharacterReferencePackV1["sources"][number]) {
  if (source.contentMode === "structured") return "结构化实体读取";
  if (source.contentMode !== "full_page") return "摘要读取";
  return `整页正文 ${Number(source.contentCharacters || 0).toLocaleString("zh-CN")} 字 · ${source.contentSections || 0} 个章节 · ${source.contentChunks || 0} 段${source.contentTruncated ? " · 已达读取上限" : ""}`;
}

export default function Home() {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const [storageReady, setStorageReady] = useState(false);
  const [storageConnected, setStorageConnected] = useState(false);
  const [creationStarted, setCreationStarted] = useState(false);
  const [libraryView, setLibraryView] = useState<SaveKind | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [agentTurnBusy, setAgentTurnBusy] = useState(false);
  const [agentApiReady, setAgentApiReady] = useState<boolean | null>(null);
  const [agentRuntimeNotice, setAgentRuntimeNotice] = useState("正在检查 Character Agent API");
  const [actionApiReady, setActionApiReady] = useState<boolean | null>(null);
  const [actionAssetNotice, setActionAssetNotice] = useState("正在检查缺失动作通道");
  const [backgroundAgentNotice, setBackgroundAgentNotice] = useState("正在检查 Background Asset Agent");
  const [directorBusy, setDirectorBusy] = useState(false);
  const [compactorBusy, setCompactorBusy] = useState(false);
  const [storyStartBusy, setStoryStartBusy] = useState(false);
  const [directorNotice, setDirectorNotice] = useState("");
  const [selectedWorldMode, setSelectedWorldMode] = useState<ExperienceMode | null>(null);
  const [storySetup, setStorySetup] = useState<StorySetup>(DEFAULT_STORY_SETUP);
  const [storyDirective, setStoryDirective] = useState("");
  const [worldSaves, setWorldSaves] = useState<WorldSaveRecord[]>([]);
  const [characterSaves, setCharacterSaves] = useState<CharacterSaveRecord[]>([]);
  const [saveNotice, setSaveNotice] = useState("");
  const agentTurnInFlight = useRef(false);
  const compactorInFlight = useRef(false);
  const attemptedDirectiveIds = useRef(new Set<string>());
  const archiveInFlight = useRef(new Set<string>());
  const backgroundRequestsInFlight = useRef(new Set<string>());
  const [form, setForm] = useState<AgentDraft>(() => emptyDraft());
  const [researchEnabled, setResearchEnabled] = useState(false);
  const [researchScope, setResearchScope] = useState("");
  const [researchCandidates, setResearchCandidates] = useState<CharacterResearchCandidate[]>([]);
  const [selectedResearchCandidateIds, setSelectedResearchCandidateIds] = useState<Set<string>>(new Set());
  const [researchResult, setResearchResult] = useState<CharacterReferencePackV1 | null>(null);
  const [researchDistillation, setResearchDistillation] = useState<CharacterProfileDistillationV1 | null>(null);
  const [selectedResearchClaims, setSelectedResearchClaims] = useState<Set<string>>(new Set());
  const [selectedResearchRelations, setSelectedResearchRelations] = useState<Set<string>>(new Set());
  const [researchStatus, setResearchStatus] = useState<"idle" | "searching" | "extracting" | "distilling" | "ready" | "applied">("idle");
  const [researchNotice, setResearchNotice] = useState("");
  const [forgeAgentId, setForgeAgentId] = useState<string | null>(null);
  const [relationshipConfirmed, setRelationshipConfirmed] = useState(false);
  const [desktopTransferActive, setDesktopTransferActive] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(() => new Set(["status"]));
  const desktopRevision = useRef(0);
  const desktopTransferInFlight = useRef(false);
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const stageCanvasRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panelId: string) => {
    setCollapsedPanels((current) => {
      const next = new Set(current);
      if (next.has(panelId)) next.delete(panelId);
      else next.add(panelId);
      return next;
    });
  }, []);

  const dismissDesktopPetSurface = useCallback(async () => {
    try {
      await stopDesktopPet();
    } catch {
      // The local companion is optional. Ending or entering a world must still
      // complete when the bridge is not running.
    } finally {
      desktopRevision.current = 0;
      setDesktopTransferActive(false);
    }
  }, []);

  useEffect(() => {
    if (window.cpDanceDesktop) return;
    // A browser reload starts at the entrance and therefore ends the previous
    // browser-owned world. Close any overlay left by that previous session.
    void dismissDesktopPetSurface();
  }, [dismissDesktopPetSurface]);

  useEffect(() => {
    if (!immersiveMode) return;
    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImmersiveMode(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [immersiveMode]);

  useLayoutEffect(() => {
    if (!immersiveMode) return;
    const viewport = stageViewportRef.current;
    const canvas = stageCanvasRef.current;
    if (!viewport || !canvas) return;
    const updateStageScale = () => {
      const baseWidth = Number.parseFloat(canvas.style.getPropertyValue("--stage-base-width")) || canvas.offsetWidth;
      const baseHeight = Number.parseFloat(canvas.style.getPropertyValue("--stage-base-height")) || canvas.offsetHeight;
      const scale = Math.min(viewport.clientWidth / baseWidth, viewport.clientHeight / baseHeight);
      canvas.style.setProperty("--immersive-stage-scale", String(Math.max(0.1, scale)));
    };
    updateStageScale();
    const observer = new ResizeObserver(updateStageScale);
    observer.observe(viewport);
    window.addEventListener("resize", updateStageScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStageScale);
    };
  }, [immersiveMode]);

  const toggleImmersiveMode = () => {
    if (!immersiveMode) {
      const canvas = stageCanvasRef.current;
      const bounds = canvas?.getBoundingClientRect();
      if (canvas && bounds?.width && bounds.height) {
        canvas.style.setProperty("--stage-base-width", `${bounds.width}px`);
        canvas.style.setProperty("--stage-base-height", `${bounds.height}px`);
        canvas.style.setProperty("--immersive-stage-scale", "1");
      }
    }
    setImmersiveMode((current) => !current);
  };

  useEffect(() => {
    if (window.cpDanceDesktop) return;
    let cancelled = false;
    void fetchSaveLibrary()
      .then((library) => {
        if (cancelled) return;
        setWorldSaves(library.worlds);
        setCharacterSaves(library.characters);
        setStorageConnected(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setStorageConnected(false);
        setSaveNotice(error instanceof Error ? error.message : "后端存档暂时不可用");
      })
      .finally(() => {
        if (!cancelled) setStorageReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const missingCharacters = state.agents.filter((agent) => !characterSaves.some((save) => save.id === agent.id) && !archiveInFlight.current.has(agent.id));
    if (missingCharacters.length === 0) return;
    const archiveTimer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      const sourceWorldTitle = state.worldId ? `${state.agents.map((agent) => agent.name).join("、")}的世界` : "尚未进入世界";
      const records = missingCharacters.map((agent) => createCharacterSave(agent, undefined, state.worldId || null, sourceWorldTitle, savedAt));
      records.forEach((record) => archiveInFlight.current.add(record.id));
      const next = records.reduce((characters, record) => upsertCharacterSave(characters, record), characterSaves);
      setCharacterSaves(next);
      void Promise.all(records.map((record) => persistSave("character", record)))
        .then(() => setSaveNotice(`角色档案已安全保存到后端 · ${records.map((record) => record.name).join("、")}`))
        .catch((error) => {
          setCharacterSaves((current) => current.filter((save) => !records.some((record) => record.id === save.id)));
          setSaveNotice(error instanceof Error ? error.message : "角色档案写入后端失败");
        })
        .finally(() => records.forEach((record) => archiveInFlight.current.delete(record.id)));
    }, 0);
    return () => window.clearTimeout(archiveTimer);
  }, [characterSaves, state.agents, state.worldId, storageReady]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { textConfigured?: boolean; textModel?: string; imageConfigured?: boolean; imageModel?: string; imageProtocol?: string }) => {
        if (cancelled) return;
        const ready = payload.textConfigured === true;
        setAgentApiReady(ready);
        setAgentRuntimeNotice(ready ? `${payload.textModel || "文本模型"} 已连接，等待唤醒角色` : "Character Agent API 尚未配置，将使用本地安全回退");
        const imageReady = payload.imageConfigured === true;
        setActionApiReady(imageReady);
        setActionAssetNotice(imageReady
          ? `${payload.imageModel || "图像模型"} 缺失动作通道已配置（${payload.imageProtocol || "images/edits"}）；每次输出仍需通过动作表完整性校验`
          : "缺失动作通道尚未配置；角色会继续使用已有基础动作");
      })
      .catch(() => {
        if (cancelled) return;
        setAgentApiReady(false);
        setActionApiReady(false);
        setAgentRuntimeNotice("无法读取 Agent API 状态，将使用本地安全回退");
        setActionAssetNotice("无法读取缺失动作通道状态；角色会继续使用已有基础动作");
      });
    fetch("/api/ai/background/status", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }: { response: Response; payload: { callable?: boolean; bundledAssetCount?: number; autoGenerationOnMiss?: boolean; error?: string } }) => {
        if (cancelled) return;
        if (!response.ok || payload.callable !== true) throw new Error(payload.error || "Background Asset Agent 状态异常");
        setBackgroundAgentNotice(`可调用 · ${payload.bundledAssetCount || 0} 个内置背景优先复用 · ${payload.autoGenerationOnMiss ? "无匹配时自动生成并登记" : "无匹配时使用安全预设"}`);
      })
      .catch((error) => {
        if (!cancelled) setBackgroundAgentNotice(error instanceof Error ? error.message : "Background Asset Agent 暂不可用");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const scene = state.mode === "story" ? state.storyScene : null;
    if (state.phase !== "town" || !state.worldId || !scene || scene.backgroundAssetId) return;
    const requestKey = [state.worldId, scene.sceneId, scene.location, scene.timeOfDay, scene.weather, scene.atmosphere, ...scene.visualKeywords].join("|");
    if (backgroundRequestsInFlight.current.has(requestKey)) return;
    backgroundRequestsInFlight.current.add(requestKey);
    let cancelled = false;
    void resolveBackgroundAsset(state.worldId, scene)
      .then((result) => {
        if (cancelled || !result.asset || (result.status !== "reused" && result.status !== "generated")) return;
        dispatch({ type: "REGISTER_BACKGROUND_ASSET", asset: result.asset, sceneId: scene.sceneId });
        setDirectorNotice(result.status === "generated"
          ? `Background Asset Agent 未找到合适资产，已生成“${result.asset.title}”并同步更新背景总索引与当前世界索引。`
          : `Background Asset Agent 已复用“${result.asset.title}”，并更新当前世界背景索引。`);
      })
      .catch((error) => {
        if (!cancelled) setDirectorNotice(error instanceof Error ? `${error.message}；继续使用安全预设场景。` : "背景资产 Agent 暂不可用；继续使用安全预设场景。");
      })
      .finally(() => backgroundRequestsInFlight.current.delete(requestKey));
    return () => { cancelled = true; };
  }, [state.mode, state.phase, state.storyScene, state.worldId]);

  const advanceNaturalAgent = useCallback(async () => {
    if (agentTurnInFlight.current || state.phase !== "town") return;
    if (state.interactionSession) {
      dispatch({ type: "ADVANCE_INTERACTION_SESSION" });
      setAgentRuntimeNotice(`空间执行器正在推进：${interactionPhaseLabel(state.interactionSession.phase)}`);
      return;
    }
    agentTurnInFlight.current = true;
    setAgentTurnBusy(true);
    setAgentRuntimeNotice("调度器正在唤醒一名角色，并组装其有权读取的上下文");
    const onAssetUpdate = (update: AssetUpdate) => {
      if (update.asset) dispatch({ type: "REGISTER_AGENT_ASSET", job: update.job, agentId: update.job.characterId, pack: update.asset.pack });
      else dispatch({ type: "UPDATE_ASSET_JOB", job: update.job });
      if (update.job.status === "generating") setActionAssetNotice(`正在生成缺失动作“${update.job.semanticIntent}”；本回合先播放 ${update.job.fallbackAction} 回退`);
      if (update.job.status === "ready") setActionAssetNotice(`缺失动作“${update.job.semanticIntent}”已校验并加入角色资产索引`);
      if (update.job.status === "failed") setActionAssetNotice(`缺失动作“${update.job.semanticIntent}”失败：${update.job.error || "未返回具体原因"}；本回合已使用 ${update.job.fallbackAction} 回退`);
    };
    try {
      const result = await runNaturalAgentTurn(state, onAssetUpdate);
      dispatch({ type: "APPLY_NATURAL_AGENT_TURN", turn: result.turn });
      setAgentApiReady(true);
      setAgentRuntimeNotice(`${result.model} 已返回独立角色决策；可见结果已交给本地执行器`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Character Agent API 暂不可用";
      const desktopTrigger = state.desktopAttentionQueue[0];
      if (state.surface === "desktop_pet") {
        if (desktopTrigger) dispatch({ type: "DISMISS_DESKTOP_ATTENTION", agentId: desktopTrigger.actorId });
        dispatch({ type: "SET_RUNNING", running: false });
      } else dispatch({ type: "ADVANCE" });
      setAgentApiReady(false);
      setAgentRuntimeNotice(state.surface === "desktop_pet" ? `${message}；自主交互已暂停，本次没有生成预设台词或伪造角色动作` : `${message}；本回合已使用本地安全规则回退`);
    } finally {
      agentTurnInFlight.current = false;
      setAgentTurnBusy(false);
    }
  }, [state]);

  const compactStoryContext = useCallback(async () => {
    if (compactorInFlight.current || state.mode !== "story") return false;
    const task = buildStoryCompactionTask(state);
    if (!task) return false;
    compactorInFlight.current = true;
    setCompactorBusy(true);
    setDirectorNotice(task.reason === "legacy_restore" ? "正在从旧存档的公开卷轴重建稳定剧情摘要；完成前 Director 保持阻断。" : "Story Context Compactor 正在压缩已经发生的公开剧情；原始卷轴不会被删除。");
    dispatch({ type: "BEGIN_STORY_COMPACTION", task });
    try {
      try {
        const result = await requestStoryCompaction(task);
        dispatch({ type: "COMMIT_STORY_COMPACTION", summary: result.summary, usedDeterministicFallback: false });
        setDirectorNotice(`${result.model} 已提交可追溯的稳定剧情摘要；Director 下一次只读取摘要、最近原始事件与置顶公开事实。`);
      } catch {
        const retryTask = shrinkStoryCompactionTask(task);
        dispatch({ type: "BEGIN_STORY_COMPACTION", task: retryTask });
        try {
          const retry = await requestStoryCompaction(retryTask);
          dispatch({ type: "COMMIT_STORY_COMPACTION", summary: retry.summary, usedDeterministicFallback: false });
          setDirectorNotice("压缩器缩小了连续输入范围并重试成功；未处理的公开事件会在下一次安全节点继续压缩。");
        } catch {
          dispatch({ type: "COMMIT_STORY_COMPACTION", summary: deterministicStorySummary(retryTask), usedDeterministicFallback: true });
          setDirectorNotice("模型压缩连续失败，已使用不补写因果的确定性摘要；原始公开事件仍完整保留。");
        }
      }
      return true;
    } finally {
      compactorInFlight.current = false;
      setCompactorBusy(false);
    }
  }, [state]);

  const advanceWorldRuntime = useCallback(async (allowFailedCompactionRetry = false) => {
    if (state.mode === "story" && storyCompactionReady(state, allowFailedCompactionRetry)) {
      const started = await compactStoryContext();
      if (started || storyCompactionRequiredBeforeDirector(state)) return;
    }
    if (state.mode === "story" && storyCompactionRequiredBeforeDirector(state)) {
      if (state.storyContextRuntime?.compactionStatus === "failed") {
        dispatch({ type: "SET_RUNNING", running: false });
        setDirectorNotice("剧情摘要没有通过本地边界校验，已停止自动重试。请点击“重试剧情整理”再次尝试；Director 在摘要有效前保持阻断。");
      }
      return;
    }
    if (state.mode === "story" && state.director && shouldInvokeDirector(state) && !directorBusy) {
      setDirectorBusy(true);
      const taskType = directorTaskTypeForState(state);
      const latestDirective = state.director.pendingDirectives.find((directive) => directive.status === "pending") || null;
      if (latestDirective) attemptedDirectiveIds.current.add(latestDirective.id);
      setDirectorNotice(latestDirective ? "Director Agent 正在处理玩家输入，但只会提交公开世界事实。" : "Director Agent 正在依据公开证据评估剧情节拍。");
      try {
        const result = await requestDirectorDecision(buildDirectorTask(state, taskType, latestDirective));
        dispatch({ type: "APPLY_DIRECTOR_DECISION", decision: result.decision });
        setDirectorNotice(result.decision.decision === "wait" ? "导演选择等待，继续让角色自主发展。" : "新的公开世界变化已经通过 Story Runtime 校验。角色会在后续回合分别回应。" );
        return;
      } catch (error) {
        setDirectorNotice(error instanceof Error ? `${error.message}；本轮不投放世界事件，角色继续自主行动。` : "Director Agent 暂不可用；角色继续自主行动。");
      } finally {
        setDirectorBusy(false);
      }
    }
    await advanceNaturalAgent();
  }, [advanceNaturalAgent, compactStoryContext, directorBusy, state]);

  useEffect(() => {
    if (!state.running || agentTurnBusy || directorBusy || compactorBusy || state.interactionSession) return;
    const timer = window.setTimeout(() => void advanceWorldRuntime(), 3200);
    return () => window.clearTimeout(timer);
  }, [advanceWorldRuntime, agentTurnBusy, compactorBusy, directorBusy, state.interactionSession, state.running, state.turn]);

  useEffect(() => {
    const directive = state.mode === "story" ? state.director?.pendingDirectives.find((item) => item.status === "pending") : null;
    if (!directive || state.running || agentTurnBusy || directorBusy || compactorBusy || state.interactionSession || attemptedDirectiveIds.current.has(directive.id)) return;
    const timer = window.setTimeout(() => void advanceWorldRuntime(), 0);
    return () => window.clearTimeout(timer);
  }, [advanceWorldRuntime, agentTurnBusy, compactorBusy, directorBusy, state.director?.pendingDirectives, state.interactionSession, state.mode, state.running, state.storyContextRuntime?.currentStableSummaryRevisionId]);

  useEffect(() => {
    if (!state.running || !state.interactionSession) return;
    const phase = state.interactionSession.phase;
    const delay = phase === "approach" ? 430 : phase === "align" ? 520 : 680;
    const timer = window.setTimeout(() => dispatch({ type: "ADVANCE_INTERACTION_SESSION" }), delay);
    return () => window.clearTimeout(timer);
  }, [state.interactionSession, state.running]);

  const selectedAgent = state.agents.find((agent) => agent.id === state.selectedMemoryAgentId) || state.agents[0];
  const latestEvent = state.events[0];
  const chronicleEvents = state.events.filter((event) => !event.id.startsWith("event-asset-ready-"));
  const activeSession = state.interactionSession;
  const activePlaybackPhase = sessionPlaybackPhase(activeSession);
  const dialogueBySpeaker = useMemo(() => new Map((latestEvent?.dialogue || []).map((line) => [line.speaker, line.text])), [latestEvent]);
  const hasStageDialogue = state.agents.some((agent) => dialogueBySpeaker.has(agent.name));
  const currentStoryBeat = state.mode === "story" && state.director
    ? state.director.beats.find((beat) => beat.id === state.director?.currentBeatId) || null
    : null;
  const storyContextRuntime = state.mode === "story" ? state.storyContextRuntime : null;
  const effectiveDirectorNotice = storyContextRuntime?.compactionStatus === "failed" && storyContextRuntime.lastFailure
    ? `剧情摘要没有通过本地边界校验：${storyContextRuntime.lastFailure}。已停止自动重试；请手动点击“重试剧情整理”。`
    : directorNotice;
  const statusObservatoryItems: RuntimeStatusItem[] = [
    {
      id: "agent-api",
      label: "AGENT API",
      message: `${agentRuntimeNotice} · ${agentApiReady ? "文本 Character Agent 可用" : agentApiReady === false ? "文本通道安全回退可用" : "正在探测文本通道"}`,
      tone: agentApiReady === false ? "fallback" : "default",
    },
    {
      id: "action-agent",
      label: "动作 AGENT",
      message: actionAssetNotice,
      tone: actionApiReady === false || state.assetJobs[0]?.status === "failed" ? "fallback" : "default",
    },
    {
      id: "background-agent",
      label: "背景 AGENT",
      message: backgroundAgentNotice,
      tone: /暂不可用|异常|失败/.test(backgroundAgentNotice) ? "fallback" : "default",
    },
    ...(state.mode === "story" && effectiveDirectorNotice ? [{ id: "director", label: compactorBusy ? "导演 · 剧情整理" : "导演", message: effectiveDirectorNotice, tone: "story" as const }] : []),
    ...(saveNotice ? [{ id: "world-save", label: "WORLD SAVE", message: saveNotice, onClose: () => setSaveNotice("") }] : []),
    ...(activeSession ? [{ id: "interaction-session", label: "空间执行", message: `${interactionSessionLabel(activeSession)} · ${interactionPhaseLabel(activeSession.phase)} · ${activeSession.match === "perfect" ? "完美匹配" : activeSession.match === "acceptable" ? "可接受匹配" : activeSession.match === "invalid" ? "准备安全降级" : `空间等级 ${activeSession.spaceLevel}`}` }] : []),
  ];
  const selectedContextMemory = useMemo(() => selectedAgent ? selectCharacterMemory({
    memory: selectedAgent.memory,
    ownerAgentId: selectedAgent.id,
    counterpartId: state.spatial[selectedAgent.id]?.targetId || null,
    taskType: "PERCEIVE_AND_DECIDE",
    turn: state.turn + 1,
    visibleEventIds: state.events.map((event) => event.id),
  }) : [], [selectedAgent, state.events, state.spatial, state.turn]);
  const selectedContextCues = useMemo(() => selectedAgent ? selectRoleplayMemoryCues(selectedAgent.memory, state.spatial[selectedAgent.id]?.targetId || null) : [], [selectedAgent, state.spatial]);
  const selectedContextHistory = useMemo(() => selectedAgent ? (state.agentStageHistory[selectedAgent.id] || []).slice(0, 6) : [], [selectedAgent, state.agentStageHistory]);
  const totalContextTokens = useMemo(() => selectedAgent ? Math.ceil((
    selectedAgent.personality.length
    + selectedAgent.background.length
    + selectedAgent.profile.roleplayNotes.length
    + selectedAgent.referencePack.claims.filter((claim) => claim.selectedByPlayer).reduce((total, claim) => total + claim.text.length, 0)
    + selectedContextMemory.reduce((total, memory) => total + memory.summary.length + memory.contentExcerpt.length, 0)
    + selectedContextCues.reduce((total, cue) => total + cue.text.length, 0)
    + selectedContextHistory.reduce((total, entry) => total + entry.ownAction.length + (entry.spokenContent?.length || 0) + entry.privateReflection.length + entry.publicResult.length, 0)
  ) * 0.9) : 0, [selectedAgent, selectedContextCues, selectedContextHistory, selectedContextMemory]);
  const formComplete = Boolean(form.name.trim() && form.background.trim());
  const readyAgentCount = state.agents.filter((agent) => agent.visual.status === "ready").length;
  const castReady = state.agents.length >= 1 && readyAgentCount === state.agents.length;
  const forgeAgent = state.agents.find((agent) => agent.id === forgeAgentId);
  const matchingSavedWorld = worldSaves.find((item) => item.id === state.worldId);
  const currentWorldIsSaved = Boolean(matchingSavedWorld && worldRevision(matchingSavedWorld.state) === worldRevision(state));

  const addAgent = (event: FormEvent) => {
    event.preventDefault();
    if (!storageReady || !storageConnected || !formComplete || state.agents.length >= 3) return;
    dispatch({ type: "ADD_AGENT", agent: form });
    setForm(emptyDraft());
    setResearchEnabled(false);
    setResearchScope("");
    setResearchCandidates([]);
    setSelectedResearchCandidateIds(new Set());
    setResearchResult(null);
    setResearchDistillation(null);
    setSelectedResearchClaims(new Set());
    setSelectedResearchRelations(new Set());
    setResearchStatus("idle");
    setResearchNotice("");
    setRelationshipConfirmed(false);
    setSaveNotice("");
  };

  const searchCharacterReference = async () => {
    if (!form.name.trim() || researchStatus === "searching" || researchStatus === "extracting" || researchStatus === "distilling") return;
    setResearchStatus("searching");
    setResearchNotice("正在搜索 Wikipedia、Wikidata 与萌娘百科，请确认人物和来源。");
    setResearchCandidates([]);
    setSelectedResearchCandidateIds(new Set());
    setResearchResult(null);
    setResearchDistillation(null);
    try {
      const response = await fetch("/api/research/character/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: form.name.trim(), canonScope: researchScope.trim(), language: "zh" }),
      });
      const payload = await response.json().catch(() => null) as { candidates?: CharacterResearchCandidate[]; searchAliases?: string[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "人物搜索失败");
      setResearchCandidates(payload?.candidates || []);
      setResearchStatus("idle");
      const aliasNotice = payload?.searchAliases?.length ? ` 已根据所属作品补搜可能规范名：${payload.searchAliases.join("、")}。` : "";
      setResearchNotice(`找到 ${payload?.candidates?.length || 0} 个经过人物筛选的候选。游戏、歌曲、消歧义和作品页已排除。${aliasNotice}`);
    } catch (error) {
      setResearchStatus("idle");
      setResearchNotice(error instanceof Error ? error.message : "人物搜索暂时不可用");
    }
  };

  const extractCharacterReference = async () => {
    if (researchStatus === "extracting" || researchStatus === "distilling") return;
    const candidates = researchCandidates.filter((candidate) => selectedResearchCandidateIds.has(candidate.id));
    if (!candidates.length) return;
    setResearchStatus("extracting");
    setResearchNotice(`正在读取 ${candidates.length} 个已确认百科来源并合并为可编辑草稿。`);
    try {
      const response = await fetch("/api/research/character/extract", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: form.name.trim(), canonScope: researchScope.trim(), language: "zh", candidates }),
      });
      const payload = await response.json().catch(() => null) as { pack?: CharacterReferencePackV1; error?: string } | null;
      if (!response.ok || !payload?.pack) throw new Error(payload?.error || "人物资料提炼失败");
      const pack = normalizeCharacterReferencePack(payload.pack, form.name);
      setResearchResult(pack);
      setResearchDistillation(null);
      setSelectedResearchClaims(new Set());
      setSelectedResearchRelations(new Set());
      setResearchStatus("ready");
      setResearchNotice(`${referenceCoverageLabel(pack)}，已整理为 ${pack.claims.length} 条可编辑设定与 ${pack.relationships.length} 条方向性关系。当前仍是草稿，尚未写入角色档案或 Agent 记忆。`);
    } catch (error) {
      setResearchStatus("idle");
      setResearchNotice(error instanceof Error ? error.message : "人物资料提炼暂时不可用");
    }
  };

  const editResearchClaim = (claimId: string, value: string) => {
    setResearchResult((current) => current ? {
      ...current,
      claims: current.claims.map((claim) => claim.id === claimId ? { ...claim, text: value.slice(0, 500), selectedByPlayer: false } : claim),
    } : current);
    setSelectedResearchClaims((current) => {
      const next = new Set(current);
      if (value.trim()) next.add(claimId); else next.delete(claimId);
      return next;
    });
    setResearchDistillation(null);
    setResearchStatus("ready");
  };

  const editResearchRelation = (relationId: string, field: "targetName" | "directionDescription", value: string) => {
    setResearchResult((current) => current ? {
      ...current,
      relationships: current.relationships.map((relation) => relation.id === relationId ? {
        ...relation,
        [field]: value.slice(0, field === "targetName" ? 100 : 500),
        selectedByPlayer: false,
      } : relation),
    } : current);
    setSelectedResearchRelations((current) => {
      const next = new Set(current);
      if (value.trim()) next.add(relationId); else next.delete(relationId);
      return next;
    });
    setResearchDistillation(null);
    setResearchStatus("ready");
  };

  const setResearchClaimConfirmation = (claimId: string, selected: boolean) => {
    setSelectedResearchClaims((current) => {
      const next = new Set(current);
      if (selected) next.add(claimId); else next.delete(claimId);
      return next;
    });
    setResearchDistillation(null);
    setResearchStatus("ready");
  };

  const setResearchRelationConfirmation = (relationId: string, selected: boolean) => {
    setSelectedResearchRelations((current) => {
      const next = new Set(current);
      if (selected) next.add(relationId); else next.delete(relationId);
      return next;
    });
    setResearchDistillation(null);
    setResearchStatus("ready");
  };

  const confirmedReferencePack = (appliedAt: string | null) => {
    if (!researchResult) return null;
    const confirmedClaims = researchResult.claims.filter((claim) => selectedResearchClaims.has(claim.id) && claim.text.trim()).map((claim) => ({ ...claim, selectedByPlayer: true }));
    const confirmedRelationships = researchResult.relationships.filter((relation) => selectedResearchRelations.has(relation.id) && relation.targetName.trim() && relation.directionDescription.trim()).map((relation) => ({ ...relation, selectedByPlayer: true }));
    const confirmedSourceIds = new Set([...confirmedClaims, ...confirmedRelationships].flatMap((item) => item.evidenceSourceIds));
    return normalizeCharacterReferencePack({
      ...researchResult,
      enabled: appliedAt !== null,
      appliedAt,
      canonScope: researchScope.trim(),
      sources: researchResult.sources.filter((source) => confirmedSourceIds.has(source.id)),
      claims: confirmedClaims,
      relationships: confirmedRelationships,
    }, form.name);
  };

  const distillCharacterReference = async () => {
    const pack = confirmedReferencePack(null);
    if (!pack || (!pack.claims.length && !pack.relationships.length) || researchStatus === "distilling") return;
    setResearchStatus("distilling");
    setResearchNotice("正在把玩家填写资料与已确认资料整合成一份完整角色档案；此时仍不会写入角色或记忆。");
    try {
      const response = await fetch("/api/research/character/distill", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerProfile: { name: form.name, personality: form.personality, background: form.background, roleplayNotes: form.roleplayNotes }, pack }),
      });
      const payload = await response.json().catch(() => null) as { distillation?: CharacterProfileDistillationV1; mode?: "agent" | "deterministic"; model?: string | null; error?: string } | null;
      if (!response.ok || !payload?.distillation) throw new Error(payload?.error || "角色档案整合失败");
      setResearchDistillation(normalizeCharacterProfileDistillation(payload.distillation, form));
      setResearchStatus("ready");
      setResearchNotice(payload.mode === "agent" ? `${payload.model || "角色档案 Agent"} 已整合玩家资料与已确认资料。请在预览中继续编辑，确认后再应用。` : "已使用安全规则生成档案预览。请继续编辑，确认后再应用。");
    } catch (error) {
      setResearchStatus("ready");
      setResearchNotice(error instanceof Error ? error.message : "角色档案整合暂时不可用");
    }
  };

  const editResearchDistillation = (field: "personality" | "background" | "roleplayNotes", value: string) => {
    const limit = field === "personality" ? 160 : field === "background" ? 1200 : 1600;
    setResearchDistillation((current) => current ? { ...current, [field]: value.slice(0, limit) } : current);
    setResearchStatus("ready");
  };

  const applyCharacterReference = () => {
    if (!researchResult || !researchDistillation) return;
    const pack = confirmedReferencePack(new Date().toISOString());
    if (!pack) return;
    setForm((current) => ({
      ...current,
      personality: researchDistillation.personality,
      background: researchDistillation.background,
      roleplayNotes: researchDistillation.roleplayNotes,
      referencePack: pack,
    }));
    setResearchStatus("applied");
    setResearchNotice("档案已写回人物设定；只有已确认的百科资料进入 Reference Pack，未确认内容仍未进入角色或 Agent 记忆。");
  };

  const enterSelectedWorld = async () => {
    if (!selectedWorldMode || !castReady || !relationshipConfirmed || storyStartBusy) return;
    await dismissDesktopPetSurface();
    if (selectedWorldMode === "natural") {
      dispatch({ type: "ENTER_TOWN", mode: "natural" });
      return;
    }
    const setup = normalizeStorySetup(storySetup);
    if (!setup.premise.trim()) {
      setSaveNotice("请先写下故事的核心设定，再进入故事剧场。");
      return;
    }
    setStoryStartBusy(true);
    setSaveNotice("Director Agent 正在建立故事背景、公开开场与可调整 Plot Beats…");
    try {
      const result = await requestDirectorDecision({
        taskType: "create_outline",
        worldId: "",
        turn: 0,
        setup,
        cast: state.agents.map((agent) => ({ id: agent.id, name: agent.name, publicMood: "等待故事开始" })),
        currentScene: DEFAULT_STORY_SCENE,
        currentBeat: null,
        outline: [],
        summaryRevisionId: null,
        outlineBaseRevision: 0,
        coveredThroughEventId: null,
        stableSummary: null,
        recentPublicEvents: [],
        pinnedContext: { unansweredQuestions: [], activeRequests: [], activeWorldEntities: [], publicCharacterStatuses: [], unresolvedClues: [], pendingPlayerDirectives: [], currentBeatConditions: [] },
        contextMetrics: { estimatedTokens: 0, estimatedBytes: 0, inputBudget: 12_000 },
        latestDirective: null,
      });
      dispatch({ type: "ENTER_TOWN", mode: "story", story: { setup, outline: result.outline!, decision: result.decision } });
      setDirectorNotice(`${result.model} 已建立故事大纲；导演只会投放公开世界事实。`);
      setSaveNotice("");
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "故事大纲创建失败，请稍后重试");
    } finally {
      setStoryStartBusy(false);
    }
  };

  const submitStoryDirective = () => {
    if (state.mode !== "story" || !state.director || !storyDirective.trim() || directorBusy || compactorBusy || state.interactionSession) return;
    const directive = parsePlayerDirective(storyDirective, state.turn);
    setStoryDirective("");
    attemptedDirectiveIds.current.delete(directive.id);
    dispatch({ type: "QUEUE_PLAYER_DIRECTIVE", directive });
    setDirectorNotice("玩家输入已加入置顶公开上下文；若它要求重排大纲，会先完成稳定摘要再交给 Director，角色不会直接收到这段指令。");
  };

  const saveCurrentWorld = async () => {
    if (state.phase !== "town" || !state.worldId) return;
    if (state.running || agentTurnBusy || directorBusy || compactorBusy) {
      setSaveNotice("请先停止 Agent 自主交互，并等待当前回合结束后再保存世界；未停止时不会写入后端。");
      return;
    }
    const savedAt = new Date().toISOString();
    const previous = worldSaves.find((item) => item.id === state.worldId);
    const record = createWorldSave(state, previous, savedAt);
    const next = upsertWorldSave(worldSaves, record);
    const nextCharacters = syncCharactersFromWorld(characterSaves, record.state, record.title, savedAt);
    try {
      setSaveNotice("正在保存世界记忆，并同步角色的设定与形象…");
      await Promise.all([
        persistSave("world", record),
        ...nextCharacters.map((character) => persistSave("character", character)),
      ]);
      setWorldSaves(next);
      setCharacterSaves(nextCharacters);
      setSaveNotice(`已保存“${record.title}”：${record.memoryEntryCount} 条世界专属记忆索引、${record.eventCount} 条世界记录；角色存档仅同步设定与形象。`);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "世界或角色存档写入后端失败");
    }
  };

  const saveCompletedCharacter = async (agent: StoryAgent, visual: PixelPetProfile) => {
    const completedAgent = { ...agent, visual };
    dispatch({ type: "SET_AGENT_VISUAL", id: agent.id, visual });
    const previous = characterSaves.find((item) => item.id === agent.id);
    const record = createCharacterSave(completedAgent, previous, state.worldId || null, state.worldId ? `${state.agents.map((item) => item.name).join("、")}的世界` : "尚未进入世界");
    const next = upsertCharacterSave(characterSaves, record);
    try {
      setCharacterSaves(next);
      setSaveNotice(`正在保存“${agent.name}”的形象与设定…`);
      await persistSave("character", record);
      setSaveNotice(`“${agent.name}”的形象与设定已保存；世界中产生的记忆只保留在对应世界存档。`);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "角色已制作完成，但后端角色存档写入失败");
    }
  };

  const addCharacterFromSave = (save: CharacterSaveRecord) => {
    if (state.agents.length >= 3 || state.agents.some((agent) => agent.id === save.id)) return;
    dispatch({ type: "ADD_SAVED_AGENT", agent: save.agent });
    setRelationshipConfirmed(false);
    setSaveNotice(`已从角色存档加入“${save.name}”；这是新的世界经历，不会携带其他世界产生的记忆。`);
  };

  const chooseCharacterFromEntrance = (save: CharacterSaveRecord) => {
    addCharacterFromSave(save);
    setLibraryView(null);
    setCreationStarted(true);
    setWizardStep(1);
  };

  const loadWorldSave = async (save: WorldSaveRecord) => {
    await dismissDesktopPetSurface();
    dispatch({ type: "HYDRATE", state: save.state });
    setSaveNotice(`已读取“${save.title}”，角色在这个世界产生的记忆与索引已恢复。`);
  };

  const returnToEntrance = async () => {
    if (!currentWorldIsSaved && !window.confirm("将返回入口创建或读取其他世界；当前世界未点击保存的进度不会进入存档库。确定继续吗？")) return;
    await dismissDesktopPetSurface();
    setImmersiveMode(false);
    setSaveNotice("");
    setCreationStarted(false);
    setLibraryView(null);
    setWizardStep(1);
    setRelationshipConfirmed(false);
    setSelectedWorldMode(null);
    setStorySetup(DEFAULT_STORY_SETUP);
    setStoryDirective("");
    setDirectorNotice("");
    dispatch({ type: "RESET" });
  };

  const startDesktopPetMode = async () => {
    if (state.phase !== "town" || state.mode !== "natural" || desktopTransferActive || desktopTransferInFlight.current) return;
    desktopTransferInFlight.current = true;
    try {
      setSaveNotice("正在连接本机桌宠伴侣；这一步不会自动保存世界…");
      const desktopState = projectRuntimeSurface(state, "desktop_pet");
      await handoffWorldToDesktop(desktopState);
      desktopRevision.current = 0;
      setImmersiveMode(false);
      setDesktopTransferActive(true);
      dispatch({ type: "SET_SURFACE", surface: "desktop_pet" });
      setSaveNotice(`角色已转移到桌面并从网页舞台隐藏；展示模式没有改变 Agent 自主交互开关，当前为${state.running ? "运行中" : "已停止"}。`);
    } catch (error) {
      setSaveNotice(error instanceof Error ? `${error.message}。请先在本机运行 npm run desktop:dev，再重试。` : "无法连接本机桌宠伴侣");
    } finally {
      desktopTransferInFlight.current = false;
    }
  };

  const stopDesktopPetMode = async () => {
    try {
      await stopDesktopPet();
      desktopRevision.current = 0;
      setDesktopTransferActive(false);
      dispatch({ type: "SET_SURFACE", surface: "web" });
      setSaveNotice("桌宠已收回网页；未手动保存的记忆仍只属于当前会话。");
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "暂时无法收回桌宠");
    }
  };

  useEffect(() => {
    if (!desktopTransferActive || state.phase !== "town") return;
    void publishDesktopWorld({ ...state, surface: "desktop_pet" }).catch((error) => {
      if (error instanceof Error && error.message === "桌宠当前未运行") return;
      setSaveNotice(error instanceof Error ? `桌宠表层同步暂时失败：${error.message}` : "桌宠表层同步暂时失败");
    });
  }, [desktopTransferActive, state]);

  useEffect(() => {
    if (!desktopTransferActive) return;
    let cancelled = false;
    const processed = new Set<string>();
    const pullActions = async () => {
      try {
        const entries = await readDesktopActions();
        if (cancelled) return;
        const fresh = entries.filter((entry) => !processed.has(entry.id));
        fresh.forEach((entry) => {
          processed.add(entry.id);
          dispatch(entry.action);
        });
        await acknowledgeDesktopActions(fresh.map((entry) => entry.id));
      } catch (error) {
        if (!cancelled) setSaveNotice(error instanceof Error ? `桌宠交互同步暂时失败：${error.message}` : "桌宠交互同步暂时失败");
      }
    };
    void pullActions();
    const timer = window.setInterval(() => void pullActions(), 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [desktopTransferActive]);

  useEffect(() => {
    if (!desktopTransferActive) return;
    let cancelled = false;
    const pullDesktopState = async () => {
      try {
        const payload = await readDesktopBridgeState();
        if (cancelled || !payload.state || payload.revision <= desktopRevision.current) return;
        desktopRevision.current = payload.revision;
        if (!payload.active) {
          dispatch({ type: "SET_SURFACE", surface: "web" });
          setDesktopTransferActive(false);
          setSaveNotice(`桌宠已收回网页；展示模式没有改变 Agent 自主交互开关，当前为${payload.state.running ? "运行中" : "已停止"}。停止后点击“保存世界”才会写入后端。`);
        }
      } catch (error) {
        if (!cancelled) setSaveNotice(error instanceof Error ? `桌宠状态读取暂时失败：${error.message}` : "桌宠状态读取暂时失败");
      }
    };
    void pullDesktopState();
    const timer = window.setInterval(() => void pullDesktopState(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [desktopTransferActive]);

  const wizardSteps = [
    { number: 1, title: "建档与制作", detail: "填写设定并完成可交互动作角色", enabled: true, done: castReady },
    { number: 2, title: "绑定关系网", detail: "预览互动与设定关系", enabled: castReady, done: relationshipConfirmed },
    { number: 3, title: "进入世界", detail: "确认阵容并开始故事", enabled: castReady && relationshipConfirmed, done: false },
  ];

  const saveLibraryDialog = libraryView ? (
    <div className="launch-library-overlay" role="presentation">
      <section className="launch-library-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-library-title">
        <header>
          <div><p>{libraryView === "world" ? "WORLD SAVE LIBRARY" : "CHARACTER ARCHIVE"}</p><h2 id="launch-library-title">{libraryView === "world" ? "选择一个已有存档" : "选择一个已有角色"}</h2></div>
          <button type="button" onClick={() => setLibraryView(null)} aria-label="关闭存档页">×</button>
        </header>
        {libraryView === "world" ? (
          <div className="launch-world-list">
            {worldSaves.map((save, index) => (
              <article key={save.id}>
                <span>存档 {String(index + 1).padStart(2, "0")}</span>
                <div><strong>{save.title}</strong><p>{save.state.mode === "story" ? "导演模式" : "自然模式"} · 第 {save.day} 天 · {save.turn} 回合 · {save.eventCount} 条世界记录</p><small>{save.castNames.join(" × ")} · {formatSaveTime(save.updatedAt)}</small></div>
                <button type="button" onClick={() => void loadWorldSave(save)}>进入世界 <i>→</i></button>
              </article>
            ))}
            {worldSaves.length === 0 && <div className="launch-library-empty"><span>00</span><div><b>还没有世界存档</b></div></div>}
          </div>
        ) : (
          <div className="launch-character-list">
            {characterSaves.map((save) => {
              const selected = state.agents.some((agent) => agent.id === save.id);
              return (
                <article className={selected ? "selected" : ""} key={save.id}>
                  <PixelPetSprite visual={save.agent.visual} name={save.name} small />
                  <div><small>独立角色档案</small><strong>{save.name}</strong>{save.agent.personality && <p>{save.agent.personality}</p>}<em>设定与形象 · 世界记忆不随角色携带 · {formatSaveTime(save.updatedAt)}</em></div>
                  <button type="button" disabled={selected || state.agents.length >= 3} onClick={() => chooseCharacterFromEntrance(save)}>{selected ? "已在阵容" : state.agents.length >= 3 ? "角色已满" : "选择角色 →"}</button>
                </article>
              );
            })}
            {characterSaves.length === 0 && <div className="launch-library-empty"><span>00</span><div><b>还没有角色存档</b><p>从 0 创建第一位角色后，档案会自动写入。</p></div></div>}
          </div>
        )}
      </section>
    </div>
  ) : null;

  if (state.phase === "onboarding") {
    if (!creationStarted) {
      return (
        <main className="launch-shell">
          <header className="launch-hero">
            <div className="launch-logo-lockup">
              <span className="launch-brand-logo" aria-label="CP 跳动 · Couple Dance">CP<br />跳动</span>
            </div>
            <div className="launch-guide-copy">
              <strong>一款为角色厨与 CP 爱好者打造的 AI 角色扮演游戏。</strong>
              <p>创建你喜欢的角色，为 TA 们设定关系，把他们放进一个世界。你可以观察角色自由生活、聊天、贴贴或闹别扭，也可以进入导演剧场，亲手安排世界背景、剧情和走向。</p>
              <p className="launch-guide-emphasis">你负责嗑 CP 和搭舞台，TA 们来把故事真正演下去。</p>
              <div><i>01</i><span>建档＋制作角色</span><b>→</b><i>02</i><span>互动关系绑定</span><b>→</b><i>03</i><span>创建世界</span></div>
            </div>
            <div className="pixel-couple-mark" aria-hidden="true">
              <div className="pixel-heart-mark">♥</div>
              <div className="pixel-person pixel-person-left"><i /><b /><span /><em /></div>
              <div className="pixel-person pixel-person-right"><i /><b /><span /><em /></div>
            </div>
          </header>

          <section className="launch-choice" aria-label="选择创建起点">
            <div className="launch-existing-column">
              <div className="launch-section-label"><span>01</span><p>WELCOME BACK</p><b>继续存档</b></div>
              <button className="launch-entry-card world-entry" type="button" onClick={() => setLibraryView("world")} aria-haspopup="dialog">
                <span className="entry-index">A</span>
                <div className="entry-copy"><strong>查看已有存档</strong><p>{worldSaves.length ? `已保存 ${worldSaves.length} 个世界` : "还没有世界存档"}</p></div>
                <div className="entry-previews">
                  {worldSaves.slice(0, 2).map((save, index) => <span key={save.id}><i>存档 {index + 1}</i><b>{save.title}</b></span>)}
                </div>
                <em className="entry-arrow">→</em>
              </button>
              <button className="launch-entry-card character-entry" type="button" onClick={() => setLibraryView("character")} aria-haspopup="dialog">
                <span className="entry-index">B</span>
                <div className="entry-copy"><strong>查看已有角色</strong><p>{characterSaves.length ? `已保存 ${characterSaves.length} 位角色` : "尚未有存档角色"}</p></div>
                <div className="entry-character-previews">
                  {characterSaves.slice(0, 2).map((save) => <span key={save.id}><PixelPetSprite visual={save.agent.visual} name={save.name} small /><b>{save.name}</b></span>)}
                  {characterSaves.length === 0 && <span className="empty-character-preview"><i>＋</i><b>角色一</b></span>}
                </div>
                <em className="entry-arrow">→</em>
              </button>
            </div>

            <button className="launch-start-card" type="button" onClick={() => { setCreationStarted(true); setWizardStep(1); }}>
              <span className="start-card-label"><i>02</i> FIRST TIME HERE?</span>
              <div className="start-card-burst" aria-hidden="true"><i>♥</i><span>✦</span><b>＋</b></div>
              <div className="start-card-cn"><b>从 0 开始创造角色</b><p>建档并制作角色 · 绑定关系 · 进入世界 · 开始书写故事</p></div>
              <em className="start-card-arrow" aria-hidden="true">→</em>
            </button>
          </section>

          {saveNotice && <div className="toast-stack"><NoticeToast label="提示" message={saveNotice} onClose={() => setSaveNotice("")} /></div>}
          {saveLibraryDialog}
        </main>
      );
    }

    return (
      <main className="creation-shell">
        <header className="creation-topbar">
          <button className="creation-exit" type="button" onClick={() => setCreationStarted(false)}>← 返回</button>
        </header>

        <section className="creation-workspace">
          <aside className="wizard-sidebar">
            <nav aria-label="角色创建步骤">
              {wizardSteps.map((step) => (
                <button className={`${wizardStep === step.number ? "active" : ""} ${step.done ? "done" : ""}`} type="button" disabled={!step.enabled} onClick={() => setWizardStep(step.number)} aria-current={wizardStep === step.number ? "step" : undefined} key={step.number}>
                  <i>{step.done ? "✓" : String(step.number).padStart(2, "0")}</i>
                  <span><strong>{step.title}</strong><small>{step.detail}</small></span>
                  <em>{wizardStep === step.number ? "NOW" : step.done ? "DONE" : step.enabled ? "OPEN" : "LOCK"}</em>
                </button>
              ))}
            </nav>
            <div className={`wizard-save-note ${storageConnected ? "" : "offline"}`}><i /><div><b>BACKEND SAVE · {storageConnected ? "READY" : "OFFLINE"}</b><p>{storageConnected ? "角色、图片、记忆和世界时间线均已存储。" : "连接恢复前不会创建未保存的角色。"}</p></div></div>
          </aside>

          <section className="wizard-stage">
            <header className="wizard-stage-heading">
              <div><p>STEP {String(wizardStep).padStart(2, "0")} / {wizardSteps[wizardStep - 1].title.toUpperCase()}</p><h2>{wizardSteps[wizardStep - 1].title}</h2></div>
              <span>{wizardStep === 1 ? `${readyAgentCount} / ${state.agents.length || 1} 可交互` : wizardStep === 2 ? `${state.relationshipDrafts.length} 条关系边` : "CP DANCE"}</span>
            </header>

            {saveNotice && <div className="toast-stack"><NoticeToast label="提示" message={saveNotice} onClose={() => setSaveNotice("")} /></div>}

            {wizardStep === 1 && (
              <div className="wizard-step-panel character-profile-step">
                <div className="step-lead"><span>01 / PROFILE + INTERACTIVE CAST</span><h3>建好档案，马上让角色动起来。</h3><button type="button" onClick={() => setLibraryView("character")}>＋ 从已有角色中选择</button></div>
                <div className="onboarding-slots">
                  {[0, 1, 2].map((index) => {
                    const agent = state.agents[index];
                    return agent ? (
                      <article className="onboarding-agent" key={agent.id}>
                        <PixelPetSprite visual={agent.visual} name={agent.name} small />
                        <div><small>ROLE {String(index + 1).padStart(2, "0")}</small><strong>{agent.name}</strong>{agent.personality && <p>{agent.personality}</p>}<em className={agent.visual.status === "ready" ? "pet-ready-copy" : ""}>{agent.visual.status === "ready" ? "可交互角色已完成" : "基础档案已保存"}</em></div>
                        <button className="remove-onboarding-agent" type="button" onClick={() => { dispatch({ type: "REMOVE_AGENT", id: agent.id }); setRelationshipConfirmed(false); if (forgeAgentId === agent.id) setForgeAgentId(null); }} aria-label={`移除${agent.name}`}>×</button>
                      </article>
                    ) : <article className="empty-agent-slot" key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>等待角色建档</p></article>;
                  })}
                </div>
                <form className="onboarding-form" onSubmit={addAgent}>
                  <label><span>角色名字</span><input value={form.name} maxLength={12} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="输入名字" disabled={!storageReady || !storageConnected || state.agents.length >= 3} /></label>
                  <label><span>性格设定（可选）</span><textarea value={form.personality} maxLength={160} onChange={(event) => setForm({ ...form, personality: event.target.value })} placeholder="例如：克制、需要独处；愿意道歉，但很难先开口。" disabled={!storageReady || !storageConnected || state.agents.length >= 3} /></label>
                  <label><span>背景介绍</span><textarea value={form.background} maxLength={1200} onChange={(event) => setForm({ ...form, background: event.target.value })} placeholder="写下经历、目标、秘密、边界，以及害怕被怎样对待。" disabled={!storageReady || !storageConnected || state.agents.length >= 3} /></label>
                  <label><span>角色扮演资料（可选）</span><textarea value={form.roleplayNotes} maxLength={1600} onChange={(event) => setForm({ ...form, roleplayNotes: event.target.value })} placeholder="由玩家填写：说话口吻、称呼、习惯动作、价值观、雷点，以及哪些表达绝不像这个角色。" disabled={!storageReady || !storageConnected || state.agents.length >= 3} /></label>
                  <section className={`character-research-panel ${researchEnabled ? "enabled" : ""}`} aria-labelledby="character-research-title">
                    <label className="research-opt-in"><input type="checkbox" checked={researchEnabled} onChange={(event) => {
                      const enabled = event.target.checked;
                      setResearchEnabled(enabled);
                      setForm((current) => ({ ...current, referencePack: { ...current.referencePack, enabled: enabled && current.referencePack.appliedAt !== null } }));
                      setResearchNotice(enabled ? "输入人物名字，可选填所属作品，再主动点击搜索。" : "角色考据已关闭；不会发起新的百科请求。已写入的文字仍可由你继续编辑。");
                    }} disabled={!storageReady || !storageConnected || state.agents.length >= 3} /><span><b id="character-research-title">启用角色考据 Skill</b></span></label>
                    {researchEnabled && <div className="research-workbench">
                      <div className="research-search-row"><label><span>所属作品 / 时期（可选）</span><input value={researchScope} maxLength={80} onChange={(event) => setResearchScope(event.target.value)} placeholder="例如：某部作品、第一季、原作结局前" /></label><button type="button" onClick={() => void searchCharacterReference()} disabled={!form.name.trim() || researchStatus === "searching" || researchStatus === "extracting" || researchStatus === "distilling"}>{researchStatus === "searching" ? "正在搜索…" : "搜索人物资料"}</button></div>
                      {researchNotice && <p className="research-notice" role="status">{researchNotice}</p>}
                      {researchCandidates.length > 0 && !researchResult && <div className="research-candidates"><span>选择正确人物</span>{researchCandidates.map((candidate) => { const selected = selectedResearchCandidateIds.has(candidate.id); const selectionFull = selectedResearchCandidateIds.size >= 3 && !selected; return <label className={selected ? "selected" : ""} key={candidate.id}><input type="checkbox" checked={selected} disabled={researchStatus === "extracting" || researchStatus === "distilling" || selectionFull} onChange={(event) => setSelectedResearchCandidateIds((current) => { const next = new Set(current); if (event.target.checked && next.size < 3) next.add(candidate.id); else if (!event.target.checked) next.delete(candidate.id); return next; })} /><span><i>{researchCandidateLabel(candidate)}</i><b>{candidate.title}</b><p>{candidate.description || candidate.excerpt || "暂无描述，请打开来源进一步核对"}</p><small>{researchCandidateSource(candidate)} · {candidate.language.toUpperCase()}</small></span></label>; })}<div className="research-candidate-actions"><small>最多选择 3 个来源；只有你确认的页面会被读取。</small><button type="button" onClick={() => void extractCharacterReference()} disabled={selectedResearchCandidateIds.size === 0 || researchStatus === "extracting" || researchStatus === "distilling"}>{researchStatus === "extracting" ? "正在混合整理…" : `混合整理已选来源（${selectedResearchCandidateIds.size}）`}</button></div></div>}
                      {researchResult && <div className="research-review">
                        <header><div><span>REFERENCE PACK</span><strong>{researchResult.entity.name}</strong><p>{researchResult.entity.description || researchResult.canonScope || "公开百科资料"}</p></div><em>{researchResult.claims.length} 条设定 · {researchResult.relationships.length} 条关系<small>{referenceCoverageLabel(researchResult)}</small></em></header>
                        <p className="research-draft-boundary">点击“应用已确认内容”后，确认项才进入角色档案。</p>
                        <div className="research-claims"><span>01 / 编辑并确认资料</span>{researchResult.claims.map((claim) => <article className={claim.confidence === "inferred" ? "inferred" : ""} key={claim.id}><label className="research-confirm-toggle"><input type="checkbox" checked={selectedResearchClaims.has(claim.id)} onChange={(event) => setResearchClaimConfirmation(claim.id, event.target.checked)} /><span>确认</span></label><div><b>{referenceClaimLabel(claim.type)}</b><textarea aria-label={`编辑${referenceClaimLabel(claim.type)}考据内容`} value={claim.text} maxLength={500} onChange={(event) => editResearchClaim(claim.id, event.target.value)} /><small>{referenceEvidenceLabel(researchResult, claim.evidenceSourceIds) || "来源待核对"}{claim.evidenceSnippet ? ` · 原文证据：“${claim.evidenceSnippet}”` : ""}</small></div></article>)}</div>
                        {researchResult.relationships.length > 0 && <div className="research-relations"><span>方向性关系证据</span>{researchResult.relationships.map((relation) => <article key={relation.id}><label className="research-confirm-toggle"><input type="checkbox" checked={selectedResearchRelations.has(relation.id)} onChange={(event) => setResearchRelationConfirmation(relation.id, event.target.checked)} /><span>确认</span></label><div><b>{researchResult.entity.name} →</b><input aria-label="编辑关系对象" value={relation.targetName} maxLength={100} onChange={(event) => editResearchRelation(relation.id, "targetName", event.target.value)} /><textarea aria-label={`编辑${researchResult.entity.name}到${relation.targetName}的关系事实`} value={relation.directionDescription} maxLength={500} onChange={(event) => editResearchRelation(relation.id, "directionDescription", event.target.value)} /><small>{referenceEvidenceLabel(researchResult, relation.evidenceSourceIds) || "来源待核对"}</small></div></article>)}</div>}
                        {!researchDistillation && <div className="research-distill-prompt"><b>02 / 生成档案</b><p>勾选要采用的资料后，系统会与玩家填写资料进行整合；生成前不会覆盖任何字段。</p><span>{selectedResearchClaims.size} 条设定 · {selectedResearchRelations.size} 条关系已确认</span><button type="button" onClick={() => void distillCharacterReference()} disabled={(selectedResearchClaims.size === 0 && selectedResearchRelations.size === 0) || researchStatus === "distilling"}>{researchStatus === "distilling" ? "正在整合资料…" : "生成完整人物档案预览 →"}</button><small>{selectedResearchClaims.size === 0 && selectedResearchRelations.size === 0 ? "请先勾选至少一条设定或关系后点击按钮。" : "已生成；预览直接展开，并可继续编辑。"}</small></div>}
                        {researchDistillation && <section className="research-distillation" aria-labelledby="research-distillation-title">
                          <header><div><span>02 / DISTILLED CHARACTER PROFILE</span><strong id="research-distillation-title">蒸馏档案编辑与预览</strong></div><em>{researchDistillation.sourceClaimIds.length} 条设定 · {researchDistillation.sourceRelationshipIds.length} 条关系</em></header>
                          <div className="research-distillation-workspace">
                            <div className="research-distillation-editor">
                              <label><span>性格设定</span><textarea id="research-distilled-personality" aria-label="编辑蒸馏档案性格" value={researchDistillation.personality} maxLength={160} onChange={(event) => editResearchDistillation("personality", event.target.value)} /></label>
                              <label><span>背景介绍</span><textarea id="research-distilled-background" aria-label="编辑蒸馏档案背景" value={researchDistillation.background} maxLength={1200} onChange={(event) => editResearchDistillation("background", event.target.value)} /></label>
                              <label><span>角色扮演资料</span><textarea id="research-distilled-roleplay" aria-label="编辑蒸馏档案角色表演" value={researchDistillation.roleplayNotes} maxLength={1600} onChange={(event) => editResearchDistillation("roleplayNotes", event.target.value)} /></label>
                            </div>
                            <aside className="research-distillation-preview" aria-label="最终角色档案预览">
                              <div className="research-distillation-preview-heading"><span>FINAL PROFILE PREVIEW</span><button type="button" onClick={() => document.getElementById("research-distilled-personality")?.focus()}>编辑档案 ↗</button></div>
                              <h4>{researchDistillation.name}</h4>
                              <div><b>性格</b><p>{researchDistillation.personality}</p></div>
                              <div><b>背景</b><p>{researchDistillation.background}</p></div>
                              <div><b>角色表演</b><p>{researchDistillation.roleplayNotes}</p></div>
                              {researchDistillation.summary && <small>{researchDistillation.summary}</small>}
                            </aside>
                          </div>
                        </section>}
                        <div className="research-sources"><span>来源与边界</span>{researchResult.sources.map((source) => <div className={source.kind === "moegirl" ? "research-source-entry noncommercial" : "research-source-entry"} key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{referenceSourceName(source.kind, source.language)} · {source.title}<b>↗</b></a><small>{referenceSourceCoverage(source)} · {source.attributionText} · {source.licenseName}{source.commercialUse === "prohibited" ? " · 内容不可商用" : ""} · <a href={source.licenseUrl} target="_blank" rel="noreferrer">许可说明</a></small></div>)}{researchResult.limitations.map((limitation, index) => <p key={`${index}-${limitation}`}>△ {limitation}</p>)}</div>
                        <div className="research-actions"><button className="secondary" type="button" onClick={() => { setResearchResult(null); setResearchDistillation(null); setResearchCandidates([]); setSelectedResearchCandidateIds(new Set()); setSelectedResearchClaims(new Set()); setSelectedResearchRelations(new Set()); setResearchStatus("idle"); setResearchNotice("可以修改名字或作品范围后重新搜索；此前未应用的草稿不会保存。"); }}>重新搜索</button>{researchDistillation && <button type="button" onClick={() => void distillCharacterReference()} disabled={researchStatus === "distilling"}>{researchStatus === "distilling" ? "正在重新整合…" : "重新生成预览"}</button>}<button type="button" onClick={applyCharacterReference} disabled={!researchDistillation || researchStatus === "distilling" || researchStatus === "applied"}>{researchStatus === "applied" ? "已应用" : "应用已确认内容"}</button></div>
                      </div>}
                    </div>}
                  </section>
                  <button type="submit" disabled={!storageReady || !storageConnected || !formComplete || state.agents.length >= 3}>{!storageReady ? "正在连接" : !storageConnected ? "存档暂不可用" : state.agents.length >= 3 ? "三个角色槽已满" : "＋ 添加并保存角色"}</button>
                </form>
                {state.agents.length > 0 && <section className="interactive-character-studio profile-forge-studio" aria-labelledby="interactive-character-title">
                  <div className="interactive-character-heading"><div><p>ACTION CAST / SAME STEP</p><h3 id="interactive-character-title">制作成可交互角色</h3></div><span>{readyAgentCount} / {state.agents.length} 已完成</span></div>
                  <div className="interactive-character-list">
                    {state.agents.map((agent) => {
                      const ready = agent.visual.status === "ready";
                      const generationLabel = agent.visual.generationMode === "aigc" ? "AI 生成动作" : "本地回退动作";
                      return <article className={ready ? "ready" : ""} key={agent.id}><PixelPetSprite visual={agent.visual} name={agent.name} action={ready ? "wave" : "idle"} small /><div><strong>{agent.name}</strong><p>{ready ? `${generationLabel}与 7 点互动骨骼已就绪 · ${agent.visual.qa?.uniquePoseCount || 0} 姿势` : "档案已保存，等待制作动作角色"}</p></div><button type="button" onClick={() => setForgeAgentId(agent.id)}>{ready ? "测试或重新制作" : "现在制作可交互角色"} <span>↗</span></button></article>;
                    })}
                  </div>
                  {forgeAgent && <PixelPetForge key={forgeAgent.id} agent={forgeAgent} onDraft={(visual: PixelPetProfile) => { setRelationshipConfirmed(false); dispatch({ type: "SET_AGENT_VISUAL", id: forgeAgent.id, visual }); }} onComplete={(visual: PixelPetProfile) => saveCompletedCharacter(forgeAgent, visual)} onClose={() => setForgeAgentId(null)} />}
                </section>}
                <div className="wizard-panel-actions"><span>{state.agents.length === 0 ? "至少需要 1 位角色" : castReady ? "全部角色已可交互" : `还差 ${state.agents.length - readyAgentCount} 位角色需要制作`}</span><button type="button" disabled={!castReady} onClick={() => setWizardStep(2)}>下一步 · 看他们互动并绑定关系 <i>→</i></button></div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="wizard-step-panel relationship-step">
                <RelationshipGraphEditor key={state.agents.map((agent) => agent.id).join("|")} agents={state.agents} drafts={state.relationshipDrafts} onChange={(draft) => { setRelationshipConfirmed(false); dispatch({ type: "SET_RELATIONSHIP_DRAFT", draft }); }} />
                <div className="wizard-panel-actions"><button className="secondary" type="button" onClick={() => setWizardStep(1)}>← 返回建档与制作</button><button type="button" onClick={() => { setRelationshipConfirmed(true); setWizardStep(3); }}>确认关系网 · 下一步 <i>→</i></button></div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="wizard-step-panel enter-world-step">
                <div className="world-ready-hero"><span>03 / READY TO DANCE</span><h3>你们的世界，<br />准备开始跳动。</h3></div>
                <div className="world-ready-cast">{state.agents.map((agent, index) => <article key={agent.id}><i>0{index + 1}</i><PixelPetSprite visual={agent.visual} name={agent.name} small /><div><strong>{agent.name}</strong><span>{agent.personality || "等待世界展开"}</span></div><em>READY</em></article>)}</div>
                <section className="world-mode-picker" aria-labelledby="world-mode-title">
                  <header><span>WORLD MODE / ENTER ONCE</span><h3 id="world-mode-title">这次进入哪一种世界？</h3><p>两种模式复用同一套角色互动、关系裁决与记忆机制。选择只在进入前出现，进入后顶部不会提供切换。</p></header>
                  <div className="world-mode-options" role="radiogroup" aria-label="世界模式">
                    <button type="button" role="radio" aria-checked={selectedWorldMode === "natural"} className={selectedWorldMode === "natural" ? "selected natural" : "natural"} onClick={() => setSelectedWorldMode("natural")}>
                      <i>01</i><span><b>自然模式</b><small>NATURAL WORLD</small><p>没有预设剧情目标。调度器唤醒角色，角色按自己的意愿生活与互动。</p></span><em>{selectedWorldMode === "natural" ? "已选择" : "选择"}</em>
                    </button>
                    <button type="button" role="radio" aria-checked={selectedWorldMode === "story"} className={selectedWorldMode === "story" ? "selected story" : "story"} onClick={() => setSelectedWorldMode("story")}>
                      <i>02</i><span><b>导演模式</b><small>STORY THEATRE</small><p>Director Agent 只管理公开剧情、场景与世界事件；Character Agent 仍只控制自己。</p></span><em>{selectedWorldMode === "story" ? "已选择" : "选择"}</em>
                    </button>
                  </div>
                </section>
                {selectedWorldMode === "story" && <section className="story-setup-panel" aria-labelledby="story-setup-title">
                  <header><div><span>DIRECTOR SETUP</span><h3 id="story-setup-title">给导演一个故事框架</h3></div><p>这些信息只交给 Director Agent。隐藏的结局目标、Plot Beats 与导演理由不会进入角色上下文。</p></header>
                  <label className="story-premise-field"><span>核心设定 / 想看的故事 *</span><textarea value={storySetup.premise} maxLength={1600} rows={5} placeholder="例如：一场持续到清晨的暴雨让三人困在即将关闭的旧车站，他们必须决定是否一起寻找失踪的站务员。" onChange={(event) => setStorySetup((current) => ({ ...current, premise: event.target.value }))} /></label>
                  <div className="story-setup-grid">
                    <label><span>故事舞台</span><input value={storySetup.setting} maxLength={500} onChange={(event) => setStorySetup((current) => ({ ...current, setting: event.target.value }))} /></label>
                    <label><span>整体气质</span><input value={storySetup.tone} maxLength={500} onChange={(event) => setStorySetup((current) => ({ ...current, tone: event.target.value }))} /></label>
                    <label><span>结局倾向</span><select value={storySetup.endingTarget} onChange={(event) => setStorySetup((current) => ({ ...current, endingTarget: event.target.value as StorySetup["endingTarget"] }))}><option value="NATURAL">自然收束</option><option value="HE">偏向 HE</option><option value="BE">偏向 BE</option><option value="TRUE_END">寻找 TRUE END</option></select></label>
                    <label><span>推进方式</span><select value={storySetup.endingMode} onChange={(event) => setStorySetup((current) => ({ ...current, endingMode: event.target.value as StorySetup["endingMode"] }))}><option value="adaptive">自适应 · 角色选择优先</option><option value="strict">明确目标 · 仍不可强迫角色</option></select></label>
                  </div>
                  <label><span>额外限制与禁区</span><textarea value={storySetup.constraints} maxLength={800} rows={3} onChange={(event) => setStorySetup((current) => ({ ...current, constraints: event.target.value }))} /></label>
                  <div className="story-authority-note"><b>导演权限边界</b><span>可以：公开世界事件、场景切换、剧情节拍</span><span>不可以：代替角色说话、规定感情结果、绕过拒绝或读取私有记忆</span></div>
                </section>}
                <div className="world-ready-checks"><span>✓ 角色档案已保存</span><span>✓ 关系网已绑定</span><span>✓ 互动动作已生成</span><span>✓ 双角色骨骼与接触点已校验</span><span>✓ 后端存档已连接</span></div>
                <div className="wizard-panel-actions"><button className="secondary" type="button" onClick={() => setWizardStep(2)}>← 返回互动关系网</button><button className="enter-world-button" type="button" disabled={!castReady || !relationshipConfirmed || !selectedWorldMode || storyStartBusy || (selectedWorldMode === "story" && !storySetup.premise.trim())} onClick={() => void enterSelectedWorld()}>{storyStartBusy ? "Director Agent 正在编排…" : selectedWorldMode === "story" ? "进入导演剧场" : selectedWorldMode === "natural" ? "进入自然世界" : "先选择世界模式"} <i>→</i></button></div>
              </div>
            )}
          </section>
        </section>
        {saveLibraryDialog}
      </main>
    );
  }

  return (
    <main className={`story-shell mode-${state.mode} ${immersiveMode ? "immersive-mode" : ""}`}>
      <header className="story-topbar">
        <div className="story-brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div><div><p>CP DANCE / {state.mode === "story" ? "STORY RUNTIME 1.0" : "NATURAL RUNTIME 1.0"}</p><h1>CP 跳动</h1></div></div>
        <div className="natural-runtime-badge"><i>{state.mode === "story" ? "02" : "01"}</i><span><b>{state.mode === "story" ? "导演模式" : "自然模式"}</b>{state.mode === "story" && <small>Director 编排世界 · Character Agent 自主回应</small>}</span></div>
        <div className="engine-chip"><i className={state.running || agentTurnBusy || directorBusy || compactorBusy ? "running" : ""} /><span>{compactorBusy ? "Story Context Compactor 正在整理公开剧情" : directorBusy ? "Director Agent 正在评估公开剧情" : agentTurnBusy ? "Character Agent 正在决策" : state.running ? state.mode === "story" ? "故事剧场正在运行" : "角色正在自然生活" : "Agent 自主交互已暂停"}</span></div>
      </header>

      <section className="story-grid">
        <aside className={`story-panel cast-panel ${collapsedPanels.has("cast") ? "is-collapsed" : ""}`}>
          <div className="section-heading"><div><span>01</span><p>CAST</p></div><h2>角色与当前意愿</h2><div className="panel-heading-actions"><em>{state.agents.length} / 3</em><CollapseButton expanded={!collapsedPanels.has("cast")} controls="cast-panel-content" onToggle={() => togglePanel("cast")} /></div></div>
          {!collapsedPanels.has("cast") && <div className="cast-list" id="cast-panel-content">{state.agents.map((agent, index) => <article className={`cast-card ${agent.id === state.selectedMemoryAgentId ? "selected" : ""}`} key={agent.id}><button className="cast-main" type="button" onClick={() => dispatch({ type: "SELECT_MEMORY", id: agent.id })}>{desktopTransferActive ? <span className="desktop-away-avatar" aria-label={`${agent.name}已转移到桌面`}>↗</span> : <PixelPetSprite visual={agent.visual} name={agent.name} action={actionForAgent(agent, latestEvent, undefined, activeSession)} small />}<span><small>AGENT {String(index + 1).padStart(2, "0")}</small><strong>{agent.name}</strong><em>{agent.mood}</em></span></button><p>{agent.personality}</p><div className="thought"><span>目前心理</span><q>{agent.privateThought}</q></div>{desktopTransferActive && <div className="visual-status ready"><i /> 形象已在桌面显示</div>}</article>)}</div>}
        </aside>

        <section className="center-column">
          <section className={`story-panel town-panel ${collapsedPanels.has("town") ? "is-collapsed" : ""}`}>
            <div className="town-heading"><div><p>02 / {state.mode === "story" ? "STORY INTERACTION" : "NATURAL INTERACTION"}</p><h2>{state.mode === "story" ? state.storyScene?.location || "故事剧场" : "共享空间"} · 第 {state.day} 天</h2>{(desktopTransferActive || immersiveMode || state.mode === "story") && <span className="scene-agent-note">{desktopTransferActive ? `桌宠展示模式 · Agent 自主交互${state.running ? "运行中" : "已停止"}` : immersiveMode ? "沉浸剧场 · 按 Esc 恢复全部面板" : `${state.storyScene?.timeOfDay || "day"} · ${state.storyScene?.weather || "clear"}`}</span>}</div><div className="time-controls"><span className="control-panel-label">操控面板</span><CollapseButton expanded={!collapsedPanels.has("town")} controls="town-panel-content" onToggle={() => togglePanel("town")} />{!collapsedPanels.has("town") && <><button type="button" className={`immersive-mode-button ${immersiveMode ? "active" : ""}`} aria-pressed={immersiveMode} onClick={toggleImmersiveMode} disabled={desktopTransferActive}>{immersiveMode ? "↙ 退出沉浸（Esc）" : "▣ 沉浸模式"}</button><button type="button" className="save-world-button" onClick={saveCurrentWorld} disabled={state.running || agentTurnBusy || directorBusy || compactorBusy} title={state.running || agentTurnBusy || directorBusy || compactorBusy ? "停止 Agent 自主交互并等待当前回合与摘要提交结束后才能保存" : "保存当前世界与已产生的角色 context"}>▣ 保存世界</button>{state.mode === "natural" && <button type="button" className={`desktop-mode-button ${desktopTransferActive ? "active" : ""}`} onClick={() => void (desktopTransferActive ? stopDesktopPetMode() : startDesktopPetMode())}>{desktopTransferActive ? "↙ 切回网页展示" : "↗ 切到桌宠展示"}</button>}<button type="button" className={state.running ? "pause" : "play"} onClick={() => dispatch({ type: "TOGGLE_RUNNING" })}>{state.running ? "Ⅱ 停止 Agent 自主交互" : "▶ 开始 Agent 自主交互"}</button><button type="button" onClick={() => void advanceWorldRuntime(true)} disabled={agentTurnBusy || directorBusy || compactorBusy || state.running}>{compactorBusy ? "剧情压缩中…" : directorBusy ? "导演评估中…" : agentTurnBusy ? "Agent 决策中…" : state.running ? "自主交互运行中" : activeSession ? `手动推进${interactionPhaseLabel(activeSession.phase)} →` : state.mode === "story" && (storyCompactionReady(state, true) || storyCompactionRequiredBeforeDirector(state)) ? state.storyContextRuntime?.compactionStatus === "failed" ? "重试剧情整理 →" : "手动压缩公开剧情 →" : state.mode === "story" && shouldInvokeDirector(state) ? "手动推进导演评估 →" : `手动唤醒一次${state.agents.length === 1 ? "行动" : "互动"} →`}</button><ActionAssetControl jobs={state.assetJobs} agents={state.agents} /></>}</div></div>
            {!collapsedPanels.has("town") && <div id="town-panel-content" className="town-panel-content">
            <div className="town-stage-viewport" ref={stageViewportRef}>
            <div
              className={`town-stage ${state.mode === "story" ? `story-stage scene-${state.storyScene?.sceneId || "story-room"}${state.storyScene?.backgroundUrl ? " has-background-asset" : ""}` : "natural-stage"}`}
              ref={stageCanvasRef}
              style={state.mode === "story" && state.storyScene?.backgroundUrl ? { backgroundImage: `url(${state.storyScene.backgroundUrl})` } : undefined}
            >
              {state.mode === "story" && <><div className="desktop-window"><i /><i /><i /></div><div className="desktop-shelf"><span /><span /><span /></div><div className="desktop-rug" /></>}
              {desktopTransferActive ? <div className="desktop-transfer-placeholder"><span>↗ DESKTOP PET DISPLAY</span><b>角色形象已完整转移到桌面</b></div> : <>
                {!hasStageDialogue && latestEvent && <div className="scene-caption"><small>{latestEvent.level} · {latestEvent.kind === "daily" ? "刚刚发生" : "世界记录"}</small><strong>{latestEvent.title}</strong><PagedText text={latestEvent.summary} pageSize={90} /></div>}
                {hasStageDialogue && <div className="stage-dialogue-deck" role="region" aria-label="角色当前对话">{state.agents.map((agent) => { const line = dialogueBySpeaker.get(agent.name); return line ? <article className="agent-dialogue-card" key={agent.id}><b>{agent.name}</b><PagedText text={line} pageSize={72} quoted /></article> : null; })}</div>}
                <div className="stage-cast">{state.agents.map((agent) => {
                  const spatial = state.spatial[agent.id];
                  const sessionIndex = activeSession ? [activeSession.initiatorId, activeSession.receiverId].indexOf(agent.id) : -1;
                  const sessionClass = sessionIndex >= 0 ? `duo-participant duo-${activeSession!.kind} duo-role-${sessionIndex === 0 ? "actor" : "target"} session-phase-${activeSession!.phase}` : "";
                  return <div className={`stage-agent spatial-agent intent-${spatial?.intent || "idle"} facing-${spatial?.facing || "right"} ${sessionClass}`} style={stageAgentStyle(spatial)} title={spatial?.perception} data-agent-id={agent.id} key={agent.id}><PixelPetSprite visual={agent.visual} name={agent.name} action={actionForAgent(agent, latestEvent, spatial, activeSession)} facing={spatial?.facing || "right"} playbackPhase={sessionIndex >= 0 ? activePlaybackPhase : null} playbackRate={sessionIndex === 1 ? 0.92 : 1} strictFacing={sessionIndex >= 0} interactive /><b>{agent.name}</b><em>{spatialIntentLabel(spatial?.intent || "idle")}</em></div>;
                })}</div>
              </>}
            </div>
            </div>
            {state.mode === "story" && state.director && <section className={`director-panel ${collapsedPanels.has("director") ? "is-collapsed" : ""}`} aria-labelledby="director-panel-title">
              <header><div><span>导演 · STORY DIRECTOR</span><h3 id="director-panel-title">{state.director.storyTitle}</h3>{!collapsedPanels.has("director") && <p>{state.director.storySummary}</p>}</div><div className="panel-heading-actions"><em>{state.director.status === "completed" ? "故事已收束" : `节拍 ${Math.max(1, state.director.beats.findIndex((beat) => beat.id === state.director?.currentBeatId) + 1)} / ${state.director.beats.length}`}</em><CollapseButton expanded={!collapsedPanels.has("director")} controls="director-panel-content" onToggle={() => togglePanel("director")} /></div></header>
              {!collapsedPanels.has("director") && <div id="director-panel-content" className="director-panel-content"><div className="director-public-state"><article><span>当前公开场景</span><b>{state.storyScene?.location || "故事剧场"}</b><p>{state.storyScene?.atmosphere || "等待场景建立"}</p></article><article><span>当前剧情节拍</span><b>{currentStoryBeat?.title || "自由发展"}</b><p>{currentStoryBeat?.purpose || "导演正在根据公开证据判断是否推进。"}</p></article></div>
              <form className="director-directive-form" onSubmit={(event) => { event.preventDefault(); submitStoryDirective(); }}><label><span>给导演新的世界或剧情方向</span><textarea value={storyDirective} maxLength={800} rows={3} placeholder="例如：下一幕去旧车站；突然停电；让剧情更偏向寻找线索。输入不会直接命令角色。" onChange={(event) => setStoryDirective(event.target.value)} /></label><button type="submit" disabled={!storyDirective.trim() || directorBusy || compactorBusy || Boolean(state.interactionSession) || state.director.status === "completed"}>{compactorBusy ? "先整理公开剧情…" : directorBusy ? "编排中…" : "提交给导演"}</button></form>
              </div>}
            </section>}
            </div>}
          </section>

          <section className={`story-panel relationship-panel ${collapsedPanels.has("relationships") ? "is-collapsed" : ""}`}>
            <div className="section-heading compact"><div><span>04</span><p>DIRECTIONAL RELATIONSHIPS</p></div>{state.agents.length === 1 ? <h2>角色自己的状态与故事</h2> : <span aria-hidden="true" />}<CollapseButton expanded={!collapsedPanels.has("relationships")} controls="relationship-panel-content" onToggle={() => togglePanel("relationships")} /></div>
            {!collapsedPanels.has("relationships") && <div className="relationship-list" id="relationship-panel-content">{state.relationships.map((relationship) => {
              const a = state.agents.find((agent) => agent.id === relationship.a)!;
              const b = state.agents.find((agent) => agent.id === relationship.b)!;
              const ab = directionSummary(relationship, a.id);
              const ba = directionSummary(relationship, b.id);
              return <article className="relationship-card directional" key={relationship.id}><div className="pair-heading"><div className="avatar-pair">{desktopTransferActive ? <span className="relationship-desktop-away">DESKTOP</span> : <><PixelPetSprite visual={a.visual} name={a.name} small /><PixelPetSprite visual={b.visual} name={b.name} small /></>}</div><div><strong>{a.name} × {b.name}</strong><span>{relationshipLabel(relationship)}</span></div></div><div className="direction-grid">{[[a, b, ab], [b, a, ba]].map(([from, to, summary]) => { const fromAgent = from as StoryAgent; const toAgent = to as StoryAgent; const info = summary as typeof ab; return <section key={`${fromAgent.id}-${toAgent.id}`}><header><b>{fromAgent.name} → {toAgent.name}</b><em>{info.label}</em></header><div className="qualitative-metrics"><span>好感 <b>{info.affinity}</b></span><span>信任 <b>{info.trust}</b></span><span>张力 <b>{info.tension}</b></span></div><p>{info.lens.relationshipKind}{info.lens.playerAuthoredView ? ` · ${info.lens.playerAuthoredView}` : " · 仍在形成自己的理解"}</p></section>; })}</div><div className="relationship-explain"><span>最近事件</span><p>{relationship.lastReason}</p></div></article>;
            })}{state.relationships.length === 0 && <div className="solo-relationship-empty"><b>当前是单角色世界</b><p>没有关系边，也不会生成虚构的关系对象。角色会独自探索、观察、休息并积累自己的记忆。</p></div>}</div>}
          </section>
        </section>

        <aside className="right-column">
          <section className={`story-panel chronicle-panel ${collapsedPanels.has("chronicle") ? "is-collapsed" : ""}`}><div className="section-heading"><div><span>05</span><p>CHRONICLE</p></div><h2>对话与记录卷轴</h2><div className="panel-heading-actions"><em>{chronicleEvents.length} 条</em><CollapseButton expanded={!collapsedPanels.has("chronicle")} controls="chronicle-panel-content" onToggle={() => togglePanel("chronicle")} /></div></div>{!collapsedPanels.has("chronicle") && <div id="chronicle-panel-content"><div className="scroll-top" aria-hidden="true"><i /><span>最新记录在上方</span><i /></div><div className="chronicle-scroll">{chronicleEvents.map((event, index) => <EventEntry event={event} index={index} key={event.id} />)}</div><div className="scroll-bottom" aria-hidden="true"><i /><span>卷轴末端</span><i /></div></div>}</section>
          <section className={`story-panel memory-panel ${collapsedPanels.has("memory") ? "is-collapsed" : ""}`}>
            <div className="memory-header"><div><p>06 / PRIVATE CONTEXT</p><h2>角色记忆与索引</h2></div><div className="panel-heading-actions"><span>{state.compressionCount} 次写入</span><CollapseButton expanded={!collapsedPanels.has("memory")} controls="memory-panel-content" onToggle={() => togglePanel("memory")} /></div></div>
            {!collapsedPanels.has("memory") && <div id="memory-panel-content"><div className="memory-tabs" role="tablist" aria-label="选择角色记忆">{state.agents.map((agent) => <button role="tab" aria-selected={selectedAgent?.id === agent.id} className={selectedAgent?.id === agent.id ? "active" : ""} type="button" key={agent.id} onClick={() => dispatch({ type: "SELECT_MEMORY", id: agent.id })}>{agent.name}</button>)}</div>
            {selectedAgent && <div className="context-stack">
              <div className="context-budget"><span>实际检索后的上下文估算 · {selectedContextMemory.length} 份相关记忆 + {selectedContextHistory.length}/6 条本角色历史</span><strong>≈ {totalContextTokens} tokens</strong><i><em style={{ width: `${Math.min(100, totalContextTokens / 12)}%` }} /></i></div>
              <details open><summary><span>01</span><strong>Character Profile v2 · 玩家资料</strong></summary><div><p>{selectedAgent.personality}</p><p>{selectedAgent.background}</p>{selectedAgent.profile.roleplayNotes && <p>{selectedAgent.profile.roleplayNotes}</p>}</div></details>
              {selectedAgent.referencePack.enabled && <details open><summary><span>WK</span><strong>角色考据 · Reference Pack</strong><em>{selectedAgent.referencePack.claims.filter((claim) => claim.selectedByPlayer).length} 条已采用</em></summary><div><p>{selectedAgent.referencePack.entity.name}{selectedAgent.referencePack.canonScope ? ` · ${selectedAgent.referencePack.canonScope}` : ""}</p><ul>{selectedAgent.referencePack.claims.filter((claim) => claim.selectedByPlayer).slice(0, 8).map((claim) => <li key={claim.id}><b>{referenceClaimLabel(claim.type)}</b> · {referenceEvidenceLabel(selectedAgent.referencePack, claim.evidenceSourceIds) || "来源待核对"}<br />{claim.text}</li>)}</ul><p>{selectedAgent.referencePack.relationships.filter((relation) => relation.selectedByPlayer).length} 条原作关系事实只用于生成方向性 Lens 草稿，不替代当前世界互动。</p>{selectedAgent.referencePack.sources.map((source) => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.attributionText}：{source.title}</a> · {source.licenseName}</p>)}</div></details>}
              <details open><summary><span>02</span><strong>长期记忆文档</strong><em>{selectedAgent.memory.files.length} 份 / {memoryRevisionCount(selectedAgent.memory)} 版</em></summary><div><ul>{selectedAgent.memory.files.map((file) => { const revision = latestMemoryRevision(file); return <li key={file.id}><b>{file.path}</b> · {memoryEpistemicLabel(revision.epistemicStatus)} · r{file.revisions.length}<br />{revision.summary}</li>; })}</ul></div></details>
              <details><summary><span>RP</span><strong>角色感回调线索</strong><em>{selectedAgent.memory.roleplayCues.length} 条</em></summary><div><ul>{selectedAgent.memory.roleplayCues.slice(0, 8).map((cue) => <li key={cue.id}><b>{cue.kind}</b> · 显著度 {Math.round(cue.salience * 100)}%<br />{cue.text}</li>)}</ul>{selectedAgent.memory.roleplayCues.length === 0 && <p>只有具体措辞、承诺、偏好、边界或未完成问题值得影响未来表达时，才会写入这里。</p>}</div></details>
              <details><summary><span>03</span><strong>Stage · 当前阶段历史</strong><em>{state.agentStageHistory[selectedAgent.id]?.length || 0} / 10</em></summary><div><ul>{(state.agentStageHistory[selectedAgent.id] || []).map((entry) => <li key={entry.id}><b>{entry.taskType}</b> · {entry.ownAction}<br />{entry.publicResult}</li>)}</ul></div></details>
              <details><summary><span>04</span><strong>兼容短期视图</strong><em>{selectedAgent.memory.recent.length} / 6</em></summary><div><ul>{selectedAgent.memory.recent.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></details>
              <div className="context-rule"><span>角色表演上下文 v6</span><p>Character Profile v2 固定玩家人设；Relationship Lens 只提供 A→B 的主观关系；Public Dialogue 保存逐字台词、动作与待回答问题。导演模式下只增加公开场景、可见世界事件、实体与状态，不会下发隐藏大纲、结局目标或导演理由。</p></div>
            </div>}</div>}
          </section>
        </aside>
      </section>

      <StatusObservatory items={statusObservatoryItems} collapsed={collapsedPanels.has("status")} onToggle={() => togglePanel("status")} />

      <footer className="story-footer"><span>{state.mode === "story" ? "DIRECT → PUBLISH → PERCEIVE → DECIDE → EXECUTE → REMEMBER" : "SCHEDULE → DECIDE → REQUEST / RESPOND → EXECUTE → REMEMBER"}</span><p>{state.mode === "story" ? "导演编排公开世界，角色 Agent 仍决定自己的语言、动作、边界与去留。" : "调度器决定调用谁，角色 Agent 决定自己做什么，执行器只落实真实结果。"}</p><button type="button" onClick={() => void returnToEntrance()}>{currentWorldIsSaved ? "已保存 · 返回入口" : "返回入口 / 新建世界"}</button></footer>
    </main>
  );
}
