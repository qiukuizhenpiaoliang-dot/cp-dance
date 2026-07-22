export const CHARACTER_MEMORY_SCHEMA = "cp-dance/character-memory/v1" as const;
export const CHARACTER_MEMORY_FILE_SCHEMA = "cp-dance/character-memory-file/v1" as const;

export type CharacterMemoryKind = "general" | "character" | "topic";
export type MemoryEpistemicStatus = "observed" | "inferred" | "rumor";

export type CharacterMemoryRevision = {
  id: string;
  baseRevisionId: string | null;
  summary: string;
  content: string;
  epistemicStatus: MemoryEpistemicStatus;
  confidence: number;
  evidenceEventIds: string[];
  createdTurn: number;
  createdAt: string;
};

export type CharacterMemoryFile = {
  schema: typeof CHARACTER_MEMORY_FILE_SCHEMA;
  id: string;
  ownerAgentId: string;
  path: string;
  kind: CharacterMemoryKind;
  subjectAgentId: string | null;
  topic: string | null;
  title: string;
  salience: number;
  createdTurn: number;
  lastAccessedTurn: number;
  latestRevisionId: string;
  revisions: CharacterMemoryRevision[];
};

export type CharacterMemoryAccess = {
  id: string;
  fileId: string;
  revisionId: string;
  action: "read" | "write";
  turn: number;
  taskId: string;
};

export type RoleplayMemoryCueKind = "exact_wording" | "promise" | "preference" | "boundary" | "unfinished" | "shared_detail";

export type CharacterRoleplayMemoryCue = {
  id: string;
  kind: RoleplayMemoryCueKind;
  counterpartId: string | null;
  text: string;
  salience: number;
  evidenceEventId: string;
  createdTurn: number;
};

export type CharacterRoleplayMemoryProposal = {
  kind: RoleplayMemoryCueKind;
  text: string;
  salience: number;
} | null;

export type AgentMemory = {
  schema: typeof CHARACTER_MEMORY_SCHEMA;
  recent: string[];
  summaries: string[];
  facts: string[];
  unresolvedThreads: string[];
  roleplayCues: CharacterRoleplayMemoryCue[];
  files: CharacterMemoryFile[];
  accessLog: CharacterMemoryAccess[];
};

export type CharacterAgentMemoryReference = {
  documentId: string;
  path: string;
  kind: CharacterMemoryKind;
  subjectAgentId: string | null;
  revisionId: string;
  summary: string;
  contentExcerpt: string;
  epistemicStatus: MemoryEpistemicStatus;
  confidence: number;
  evidenceEventIds: string[];
};

export type CharacterMemoryProposal = {
  documentId: string | null;
  kind: CharacterMemoryKind;
  subjectAgentId: string | null;
  topic: string | null;
  baseRevisionId: string | null;
  summary: string;
  content: string;
  epistemicStatus: MemoryEpistemicStatus;
  confidence: number;
  salience: number;
  evidenceEventIds: string[];
};

export type MemoryCommitAudit = {
  proposalAccepted: boolean;
  commitApplied: boolean;
  reason: string;
  documentId: string;
  revisionId: string;
  evidenceEventIds: string[];
};

type LegacyMemory = Partial<AgentMemory> & {
  recent?: string[];
  summaries?: string[];
  facts?: string[];
  unresolvedThreads?: string[];
  roleplayCues?: CharacterRoleplayMemoryCue[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maxLength) : "";
}

function safeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 96) || "memory";
}

function memoryFileId(ownerAgentId: string, kind: CharacterMemoryKind, key: string) {
  return `memory-${safeIdPart(ownerAgentId)}-${kind}-${safeIdPart(key)}`;
}

function revisionId(fileId: string, turn: number, evidenceEventId: string, revision: number) {
  return `memory-rev-${turn}-${revision}-${safeIdPart(evidenceEventId || fileId)}`;
}

function normalizeEpistemicStatus(value: unknown): MemoryEpistemicStatus {
  return value === "observed" || value === "rumor" ? value : "inferred";
}

function normalizeRevision(raw: Partial<CharacterMemoryRevision>, fileId: string, index: number): CharacterMemoryRevision {
  const createdTurn = Number.isFinite(raw.createdTurn) ? Number(raw.createdTurn) : 0;
  return {
    id: safeText(raw.id, 180) || revisionId(fileId, createdTurn, fileId, index + 1),
    baseRevisionId: safeText(raw.baseRevisionId, 180) || null,
    summary: safeText(raw.summary, 320) || "尚未形成稳定摘要",
    content: safeText(raw.content, 2400) || "尚未写入完整内容",
    epistemicStatus: normalizeEpistemicStatus(raw.epistemicStatus),
    confidence: clamp(Number(raw.confidence) || 0.5, 0, 1),
    evidenceEventIds: Array.isArray(raw.evidenceEventIds) ? raw.evidenceEventIds.map((item) => safeText(item, 180)).filter(Boolean).slice(0, 12) : [],
    createdTurn,
    createdAt: safeText(raw.createdAt, 80) || `turn-${createdTurn}`,
  };
}

function createMemoryFile(input: {
  ownerAgentId: string;
  kind: CharacterMemoryKind;
  subjectAgentId?: string | null;
  topic?: string | null;
  title: string;
  summary: string;
  content: string;
  epistemicStatus: MemoryEpistemicStatus;
  confidence: number;
  salience: number;
  turn: number;
  evidenceEventIds?: string[];
}) {
  const key = input.kind === "general" ? "general" : input.kind === "character" ? input.subjectAgentId || "unknown" : input.topic || "untitled";
  const id = memoryFileId(input.ownerAgentId, input.kind, key);
  const firstRevisionId = revisionId(id, input.turn, input.evidenceEventIds?.[0] || id, 1);
  const path = input.kind === "general" ? "general.txt" : input.kind === "character" ? `characters/${input.subjectAgentId}.txt` : `topics/${safeIdPart(input.topic || "untitled")}.txt`;
  const revision: CharacterMemoryRevision = {
    id: firstRevisionId,
    baseRevisionId: null,
    summary: safeText(input.summary, 320),
    content: safeText(input.content, 2400),
    epistemicStatus: input.epistemicStatus,
    confidence: clamp(input.confidence, 0, 1),
    evidenceEventIds: (input.evidenceEventIds || []).slice(0, 12),
    createdTurn: input.turn,
    createdAt: `turn-${input.turn}`,
  };
  return {
    schema: CHARACTER_MEMORY_FILE_SCHEMA,
    id,
    ownerAgentId: input.ownerAgentId,
    path,
    kind: input.kind,
    subjectAgentId: input.subjectAgentId || null,
    topic: input.topic || null,
    title: safeText(input.title, 160),
    salience: clamp(input.salience, 0, 1),
    createdTurn: input.turn,
    lastAccessedTurn: input.turn,
    latestRevisionId: firstRevisionId,
    revisions: [revision],
  } satisfies CharacterMemoryFile;
}

export function latestMemoryRevision(file: CharacterMemoryFile) {
  return file.revisions.find((revision) => revision.id === file.latestRevisionId) || file.revisions[0];
}

function normalizeFile(raw: Partial<CharacterMemoryFile>, ownerAgentId: string, index: number): CharacterMemoryFile | null {
  const kind = raw.kind === "general" || raw.kind === "character" || raw.kind === "topic" ? raw.kind : null;
  if (!kind) return null;
  const subjectAgentId = safeText(raw.subjectAgentId, 180) || null;
  const topic = safeText(raw.topic, 120) || null;
  const key = kind === "general" ? "general" : kind === "character" ? subjectAgentId || `unknown-${index}` : topic || `topic-${index}`;
  const id = safeText(raw.id, 180) || memoryFileId(ownerAgentId, kind, key);
  const revisions = Array.isArray(raw.revisions) ? raw.revisions.map((revision, revisionIndex) => normalizeRevision(revision, id, revisionIndex)).slice(-12) : [];
  if (!revisions.length) return null;
  const latestRevisionId = revisions.some((revision) => revision.id === raw.latestRevisionId) ? String(raw.latestRevisionId) : revisions[revisions.length - 1].id;
  return {
    schema: CHARACTER_MEMORY_FILE_SCHEMA,
    id,
    ownerAgentId,
    path: safeText(raw.path, 220) || (kind === "general" ? "general.txt" : kind === "character" ? `characters/${subjectAgentId}.txt` : `topics/${safeIdPart(topic || key)}.txt`),
    kind,
    subjectAgentId,
    topic,
    title: safeText(raw.title, 160) || (kind === "general" ? "自我、计划与长期反思" : kind === "character" ? `关于 ${subjectAgentId}` : topic || "其他主题"),
    salience: clamp(Number(raw.salience) || 0.5, 0, 1),
    createdTurn: Number.isFinite(raw.createdTurn) ? Number(raw.createdTurn) : revisions[0].createdTurn,
    lastAccessedTurn: Number.isFinite(raw.lastAccessedTurn) ? Number(raw.lastAccessedTurn) : revisions[revisions.length - 1].createdTurn,
    latestRevisionId,
    revisions,
  };
}

export function createInitialAgentMemory(ownerAgentId: string, facts: string[] = []): AgentMemory {
  const cleanFacts = facts.map((fact) => safeText(fact, 320)).filter(Boolean).slice(0, 12);
  const summary = cleanFacts[0] || "刚刚开始积累自己的长期记忆";
  return {
    schema: CHARACTER_MEMORY_SCHEMA,
    recent: [],
    summaries: [],
    facts: cleanFacts,
    unresolvedThreads: [],
    roleplayCues: [],
    files: [createMemoryFile({
      ownerAgentId,
      kind: "general",
      title: "自我、计划与长期反思",
      summary,
      content: cleanFacts.join("；") || "我还没有需要长期保存的计划或反思。",
      epistemicStatus: "observed",
      confidence: 1,
      salience: 1,
      turn: 0,
    })],
    accessLog: [],
  };
}

/**
 * Independent character archives are portable identity/visual records, not a
 * container for experiences produced inside a particular world. World saves
 * own those memories and restore them when that same world is loaded again.
 */
export function createPortableAgentMemory(ownerAgentId: string): AgentMemory {
  return createInitialAgentMemory(ownerAgentId);
}

export function normalizeAgentMemory(raw: LegacyMemory | undefined, ownerAgentId: string, turn = 0): AgentMemory {
  const recent = Array.isArray(raw?.recent) ? raw.recent.map((item) => safeText(item, 320)).filter(Boolean).slice(0, 6) : [];
  const summaries = Array.isArray(raw?.summaries) ? raw.summaries.map((item) => safeText(item, 500)).filter(Boolean).slice(0, 8) : [];
  const facts = Array.isArray(raw?.facts) ? raw.facts.map((item) => safeText(item, 320)).filter(Boolean).slice(0, 20) : [];
  const unresolvedThreads = Array.isArray(raw?.unresolvedThreads) ? raw.unresolvedThreads.map((item) => safeText(item, 320)).filter(Boolean).slice(0, 8) : [];
  const roleplayCues = Array.isArray(raw?.roleplayCues) ? raw.roleplayCues.map((cue, index) => {
    const kind = ["exact_wording", "promise", "preference", "boundary", "unfinished", "shared_detail"].includes(cue?.kind) ? cue.kind : "shared_detail";
    const text = safeText(cue?.text, 600);
    if (!text) return null;
    return {
      id: safeText(cue?.id, 180) || `roleplay-cue-${turn}-${index}-${safeIdPart(text)}`,
      kind,
      counterpartId: safeText(cue?.counterpartId, 180) || null,
      text,
      salience: clamp(Number(cue?.salience) || 0.5, 0, 1),
      evidenceEventId: safeText(cue?.evidenceEventId, 180),
      createdTurn: Number.isFinite(cue?.createdTurn) ? Number(cue.createdTurn) : turn,
    } satisfies CharacterRoleplayMemoryCue;
  }).filter((cue): cue is CharacterRoleplayMemoryCue => Boolean(cue)).slice(0, 40) : [];
  const normalizedFiles = Array.isArray(raw?.files) ? raw.files.map((file, index) => normalizeFile(file, ownerAgentId, index)).filter((file): file is CharacterMemoryFile => Boolean(file)) : [];
  const files = normalizedFiles.length ? normalizedFiles : createInitialAgentMemory(ownerAgentId, facts).files;
  if (!files.some((file) => file.kind === "general")) {
    files.unshift(createMemoryFile({
      ownerAgentId,
      kind: "general",
      title: "自我、计划与长期反思",
      summary: summaries[0] || facts[0] || recent[0] || "从旧存档恢复的长期记忆",
      content: [...facts, ...summaries, ...recent].join("；") || "旧存档没有可迁移的长期内容。",
      epistemicStatus: "observed",
      confidence: 0.9,
      salience: 1,
      turn,
    }));
  }
  const accessLog = Array.isArray(raw?.accessLog) ? raw.accessLog.map((entry, index) => ({
    id: safeText(entry.id, 180) || `memory-access-${turn}-${index}`,
    fileId: safeText(entry.fileId, 180),
    revisionId: safeText(entry.revisionId, 180),
    action: entry.action === "write" ? "write" as const : "read" as const,
    turn: Number.isFinite(entry.turn) ? Number(entry.turn) : turn,
    taskId: safeText(entry.taskId, 180) || "memory-migration",
  })).filter((entry) => entry.fileId && entry.revisionId).slice(0, 80) : [];
  return { schema: CHARACTER_MEMORY_SCHEMA, recent, summaries, facts, unresolvedThreads, roleplayCues, files, accessLog };
}

export function seedCharacterMemory(
  raw: AgentMemory,
  ownerAgentId: string,
  subjectAgentId: string,
  summary: string,
  turn: number,
  evidenceEventId: string,
) {
  const memory = normalizeAgentMemory(raw, ownerAgentId, turn);
  if (memory.files.some((file) => file.kind === "character" && file.subjectAgentId === subjectAgentId)) return memory;
  return {
    ...memory,
    files: [...memory.files, createMemoryFile({
      ownerAgentId,
      kind: "character",
      subjectAgentId,
      title: `我对 ${subjectAgentId} 的理解`,
      summary: safeText(summary, 320) || "关系仍在观察中",
      content: safeText(summary, 1600) || "我还没有足够经历形成稳定判断。",
      epistemicStatus: "inferred",
      confidence: 0.55,
      salience: 0.8,
      turn,
      evidenceEventIds: evidenceEventId ? [evidenceEventId] : [],
    })],
  };
}

function referenceScore(file: CharacterMemoryFile, counterpartId: string | null, turn: number, taskType: string) {
  let score = file.salience * 100;
  if (file.kind === "general") score += 240;
  if (counterpartId && file.subjectAgentId === counterpartId) score += 420;
  if (/RESPOND|HANDLE/.test(taskType) && file.kind === "character") score += 90;
  score += Math.max(0, 80 - Math.max(0, turn - file.lastAccessedTurn) * 4);
  return score;
}

export function selectCharacterMemory(input: {
  memory: AgentMemory;
  ownerAgentId: string;
  counterpartId: string | null;
  taskType: string;
  turn: number;
  visibleEventIds: string[];
  maxFiles?: number;
  maxCharacters?: number;
}) {
  const memory = normalizeAgentMemory(input.memory, input.ownerAgentId, input.turn);
  const maxFiles = input.maxFiles || 6;
  const maxCharacters = input.maxCharacters || 3600;
  const visible = new Set(input.visibleEventIds);
  const selected = [...memory.files]
    .sort((left, right) => referenceScore(right, input.counterpartId, input.turn, input.taskType) - referenceScore(left, input.counterpartId, input.turn, input.taskType))
    .slice(0, maxFiles);
  const references: CharacterAgentMemoryReference[] = [];
  let usedCharacters = 0;
  for (const file of selected) {
    const revision = latestMemoryRevision(file);
    if (!revision) continue;
    const remaining = maxCharacters - usedCharacters;
    if (remaining <= 120) break;
    const summary = revision.summary.slice(0, remaining);
    const contentBudget = Math.max(0, remaining - summary.length);
    const contentExcerpt = revision.content.slice(0, Math.min(900, contentBudget));
    usedCharacters += summary.length + contentExcerpt.length;
    references.push({
      documentId: file.id,
      path: file.path,
      kind: file.kind,
      subjectAgentId: file.subjectAgentId,
      revisionId: revision.id,
      summary,
      contentExcerpt,
      epistemicStatus: revision.epistemicStatus,
      confidence: revision.confidence,
      evidenceEventIds: revision.evidenceEventIds.filter((eventId) => visible.has(eventId)).slice(0, 8),
    });
  }
  return references;
}

export function selectRoleplayMemoryCues(
  memory: AgentMemory,
  counterpartId: string | null,
  maxCues = 6,
) {
  return [...(memory.roleplayCues || [])]
    .sort((left, right) => {
      const leftTarget = counterpartId && left.counterpartId === counterpartId ? 1 : 0;
      const rightTarget = counterpartId && right.counterpartId === counterpartId ? 1 : 0;
      return rightTarget - leftTarget || right.salience - left.salience || right.createdTurn - left.createdTurn;
    })
    .slice(0, maxCues);
}

export function appendRoleplayMemoryCue(input: {
  memory: AgentMemory;
  proposal: CharacterRoleplayMemoryProposal;
  counterpartId: string | null;
  evidenceEventId: string;
  turn: number;
}) {
  if (!input.proposal?.text.trim()) return input.memory;
  const text = safeText(input.proposal.text, 600);
  const duplicate = input.memory.roleplayCues.some((cue) => cue.counterpartId === input.counterpartId && cue.kind === input.proposal?.kind && cue.text === text);
  if (duplicate) return input.memory;
  const cue: CharacterRoleplayMemoryCue = {
    id: `roleplay-cue-${input.turn}-${safeIdPart(input.evidenceEventId)}-${safeIdPart(text)}`,
    kind: input.proposal.kind,
    counterpartId: input.counterpartId,
    text,
    salience: clamp(input.proposal.salience, 0, 1),
    evidenceEventId: safeText(input.evidenceEventId, 180),
    createdTurn: input.turn,
  };
  return { ...input.memory, roleplayCues: [cue, ...input.memory.roleplayCues].slice(0, 40) };
}

function isProposalSafe(proposal: CharacterMemoryProposal, counterpartId: string | null, visibleEventIds: Set<string>) {
  if (proposal.kind === "character" && (!counterpartId || proposal.subjectAgentId !== counterpartId)) return "只能更新当前互动对象的方向记忆";
  if (proposal.kind === "topic" && !safeText(proposal.topic, 120)) return "主题记忆必须提供名称";
  if (!safeText(proposal.summary, 320) || !safeText(proposal.content, 2400)) return "记忆摘要和正文不能为空";
  if (/\b(?:affinity|trust|tension|attraction|attachment)\b\s*[:=]?\s*-?\d|(?:好感|信任|张力|吸引|依恋)\s*[:=]?\s*-?\d/i.test(`${proposal.summary} ${proposal.content}`)) return "模型不能把内部关系数字写进记忆";
  if (!proposal.evidenceEventIds.length) return "长期记忆提案必须引用至少一个可见事件";
  if (proposal.evidenceEventIds.some((eventId) => !visibleEventIds.has(eventId))) return "记忆引用了该角色不可见的事件";
  return "";
}

function defaultProposal(input: {
  memory: AgentMemory;
  counterpartId: string | null;
  fallbackText: string;
  evidenceEventId: string;
}) {
  const file = input.counterpartId
    ? input.memory.files.find((item) => item.kind === "character" && item.subjectAgentId === input.counterpartId)
    : input.memory.files.find((item) => item.kind === "general");
  const latest = file ? latestMemoryRevision(file) : null;
  return {
    documentId: file?.id || null,
    kind: input.counterpartId ? "character" as const : "general" as const,
    subjectAgentId: input.counterpartId,
    topic: null,
    baseRevisionId: latest?.id || null,
    summary: safeText(input.fallbackText, 260) || "我记住了这一回合的可见结果",
    content: safeText(input.fallbackText, 1200) || "这一回合没有形成更多可写入内容。",
    epistemicStatus: "observed" as const,
    confidence: 0.9,
    salience: 0.72,
    evidenceEventIds: [input.evidenceEventId],
  };
}

export function commitCharacterMemory(input: {
  memory: AgentMemory;
  ownerAgentId: string;
  counterpartId: string | null;
  proposal: CharacterMemoryProposal | null;
  fallbackText: string;
  evidenceEventId: string;
  visibleEventIds: string[];
  turn: number;
  taskId: string;
  readRevisions: string[];
}) {
  let memory = normalizeAgentMemory(input.memory, input.ownerAgentId, input.turn);
  if (input.counterpartId) {
    memory = seedCharacterMemory(memory, input.ownerAgentId, input.counterpartId, input.fallbackText, input.turn, input.evidenceEventId);
  }
  const visibleEventIds = new Set([...input.visibleEventIds, input.evidenceEventId]);
  const readRevisions = new Set(input.readRevisions);
  let proposal = input.proposal;
  let rejectionReason = "";

  if (proposal) {
    rejectionReason = isProposalSafe(proposal, input.counterpartId, visibleEventIds);
    const existing = proposal.documentId ? memory.files.find((file) => file.id === proposal?.documentId) : null;
    const matchingExisting = memory.files.find((file) => file.kind === proposal?.kind
      && (file.kind !== "character" || file.subjectAgentId === proposal?.subjectAgentId)
      && (file.kind !== "topic" || file.topic === proposal?.topic));
    if (!rejectionReason && proposal.documentId && !existing) rejectionReason = "不能更新不存在的记忆文档；新文档必须把 documentId 写为 null";
    if (!rejectionReason && !proposal.documentId && matchingExisting) rejectionReason = "同一路径已有记忆文档，必须先读取最新 revision 再更新";
    if (!rejectionReason && existing) {
      const latest = latestMemoryRevision(existing);
      if (!latest || proposal.baseRevisionId !== latest.id || !readRevisions.has(latest.id)) rejectionReason = "现有记忆必须在本次调用读取最新 revision 后才能更新";
    }
    if (!rejectionReason && !existing && proposal.baseRevisionId) rejectionReason = "新记忆不能携带不存在的基础 revision";
  }

  const proposalAccepted = Boolean(proposal && !rejectionReason);
  if (!proposalAccepted) proposal = defaultProposal({ memory, counterpartId: input.counterpartId, fallbackText: input.fallbackText, evidenceEventId: input.evidenceEventId });
  if (!proposal) proposal = defaultProposal({ memory, counterpartId: input.counterpartId, fallbackText: input.fallbackText, evidenceEventId: input.evidenceEventId });

  let file = proposal.documentId ? memory.files.find((item) => item.id === proposal?.documentId) : null;
  if (!file) {
    file = createMemoryFile({
      ownerAgentId: input.ownerAgentId,
      kind: proposal.kind,
      subjectAgentId: proposal.subjectAgentId,
      topic: proposal.topic,
      title: proposal.kind === "general" ? "自我、计划与长期反思" : proposal.kind === "character" ? `我对 ${proposal.subjectAgentId} 的理解` : proposal.topic || "其他主题",
      summary: proposal.summary,
      content: proposal.content,
      epistemicStatus: proposal.epistemicStatus,
      confidence: proposal.confidence,
      salience: proposal.salience,
      turn: input.turn,
      evidenceEventIds: proposal.evidenceEventIds.length ? proposal.evidenceEventIds : [input.evidenceEventId],
    });
    memory = { ...memory, files: [...memory.files, file] };
  } else {
    const latest = latestMemoryRevision(file);
    const nextRevision: CharacterMemoryRevision = {
      id: revisionId(file.id, input.turn, input.evidenceEventId, file.revisions.length + 1),
      baseRevisionId: latest?.id || null,
      summary: safeText(proposal.summary, 320),
      content: safeText(proposal.content, 2400),
      epistemicStatus: normalizeEpistemicStatus(proposal.epistemicStatus),
      confidence: clamp(proposal.epistemicStatus === "observed" ? proposal.confidence : Math.min(proposal.confidence, proposal.epistemicStatus === "rumor" ? 0.6 : 0.75), 0, 1),
      evidenceEventIds: (proposal.evidenceEventIds.length ? proposal.evidenceEventIds : [input.evidenceEventId]).filter((eventId) => visibleEventIds.has(eventId)).slice(0, 12),
      createdTurn: input.turn,
      createdAt: `turn-${input.turn}`,
    };
    file = {
      ...file,
      salience: clamp(proposal.salience, 0, 1),
      lastAccessedTurn: input.turn,
      latestRevisionId: nextRevision.id,
      revisions: [...file.revisions, nextRevision].slice(-12),
    };
    memory = { ...memory, files: memory.files.map((item) => item.id === file?.id ? file as CharacterMemoryFile : item) };
  }

  const latest = latestMemoryRevision(file);
  const accessReads = input.readRevisions.map<CharacterMemoryAccess | null>((revision, index) => {
    const readFile = memory.files.find((item) => item.revisions.some((candidate) => candidate.id === revision));
    return readFile ? {
      id: `memory-access-${input.turn}-read-${index}-${safeIdPart(readFile.id)}`,
      fileId: readFile.id,
      revisionId: revision,
      action: "read" as const,
      turn: input.turn,
      taskId: input.taskId,
    } : null;
  }).filter((entry): entry is CharacterMemoryAccess => Boolean(entry));
  const writeAccess: CharacterMemoryAccess = {
    id: `memory-access-${input.turn}-write-${safeIdPart(file.id)}`,
    fileId: file.id,
    revisionId: latest.id,
    action: "write",
    turn: input.turn,
    taskId: input.taskId,
  };
  const recent = [safeText(input.fallbackText, 320), ...memory.recent].filter(Boolean).slice(0, 6);
  const summaries = [latest.summary, ...memory.summaries.filter((summary) => summary !== latest.summary)].slice(0, 8);
  memory = { ...memory, recent, summaries, accessLog: [...accessReads, writeAccess, ...memory.accessLog].slice(0, 80) };

  return {
    memory,
    audit: {
      proposalAccepted,
      commitApplied: true,
      reason: proposalAccepted ? "模型基于本次已读 revision 提交，证据与权限校验通过" : `${rejectionReason || "模型未提交结构化更新"}；已由 Memory Runtime 写入当前可见结果`,
      documentId: file.id,
      revisionId: latest.id,
      evidenceEventIds: latest.evidenceEventIds,
    } satisfies MemoryCommitAudit,
  };
}

export function memoryDocumentCount(memory: AgentMemory) {
  return memory.files.length;
}

export function memoryRevisionCount(memory: AgentMemory) {
  return memory.files.reduce((total, file) => total + file.revisions.length, 0);
}

export function memoryContextEstimate(memory: AgentMemory) {
  return Math.ceil(memory.files.reduce((total, file) => {
    const latest = latestMemoryRevision(file);
    return total + file.title.length + (latest?.summary.length || 0) + Math.min(900, latest?.content.length || 0);
  }, 0) * 0.9);
}

export function memoryEpistemicLabel(status: MemoryEpistemicStatus) {
  return status === "observed" ? "亲历事实" : status === "rumor" ? "听闻信息" : "主观理解";
}
