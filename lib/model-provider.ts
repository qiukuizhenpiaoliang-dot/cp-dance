import type { GameState, Relationship } from "./agent-engine";
import { selectCharacterMemory, selectRoleplayMemoryCues } from "./character-memory";
import { availablePixelPetActions, pixelPetActionCatalog } from "./pixel-pet";
import { deriveRelationshipCues, relationshipDirectionLabel } from "./relationship-engine";
import { normalizeCharacterProfile } from "./roleplay";
import { buildCharacterReferenceContext } from "./character-reference";
import { CHARACTER_AGENT_ACTIONS, CHARACTER_CONTEXT_SCHEMA, PUBLIC_DIALOGUE_SCHEMA, type CharacterAgentCapabilityEnvelope, type CharacterAgentDecision, type CharacterAgentTask, type CharacterAgentTaskType, type CharacterAgentTrigger, type CharacterAgentTurnBrief, type PublicDialogueBeat, type PublicDialogueState } from "./natural-agent-types";
import { approxTokensSum } from "./tokens";

function beatAddressees(beat: PublicDialogueBeat) {
  return beat.addresseeIds?.length ? beat.addresseeIds : beat.targetId ? [beat.targetId] : [];
}

function pairFor(state: GameState, actorId: string, counterpartId: string | null) {
  if (!counterpartId) return null;
  return state.relationships.find((item) => item.directions.some((direction) => direction.from === actorId && direction.to === counterpartId)) || null;
}

function viewFor(relationship: Relationship | null, actorId: string) {
  return relationship?.directions.find((item) => item.from === actorId) || null;
}

function knownBoundaries(view: ReturnType<typeof viewFor>) {
  if (!view) return ["当前没有关系对象，不得虚构另一个角色"];
  const boundaries = [
    view.contactConsent === "closed" ? "对方曾拒绝身体接触；不得直接接触或重复施压" : "身体接触必须先提出请求，并等待对方独立同意",
    "对方可以沉默、延后、拒绝、提出替代或离开",
  ];
  if (view.rejectionLocks.length) boundaries.push(`仍然有效的拒绝记录：${view.rejectionLocks.join("、")}`);
  return boundaries;
}

function relationshipSummary(view: ReturnType<typeof viewFor>, targetName: string | null) {
  if (!view || !targetName) return "当前是单角色世界，我只需要决定自己的生活动作。";
  const cues = deriveRelationshipCues(view).filter((cue) => cue.available).map((cue) => cue.label).slice(0, 3);
  return `我把与${targetName}的关系理解为“${relationshipDirectionLabel(view)}”${cues.length ? `；我注意到：${cues.join("、")}` : "；我仍在观察"}。`;
}

function observableEvents(state: GameState, actorId: string, counterpartId: string | null) {
  return state.events
    .filter((event) => event.actorIds.includes(actorId) || Boolean(counterpartId && event.actorIds.includes(counterpartId)))
    .slice(0, 3)
    .map((event) => `${event.title}：${event.summary}`);
}

function visibleEventIds(state: GameState, actorId: string, counterpartId: string | null) {
  return state.events
    .filter((event) => event.actorIds.includes(actorId) || Boolean(counterpartId && event.actorIds.includes(counterpartId)))
    .slice(0, 12)
    .map((event) => event.id);
}

function stageInstruction(taskType: CharacterAgentTaskType) {
  if (taskType === "RESPOND_TO_INTERACTION_REQUEST") return "只对已经公开提出的请求作出独立回应；可以接受、犹豫、拒绝、反提议或离开。用这个角色自己的口吻和非语言动作表达，不替对方完成结果。";
  if (taskType === "RESPOND_TO_SPEECH") return "接住对方刚刚的具体措辞或动作；可以直接回答、含蓄回应、反问、回避、沉默或结束。不要把对话重新开场。";
  if (taskType === "HANDLE_ACTION_RESULT") return "根据本地运行时已经裁决的公开结果调整自己的下一步。";
  if (taskType === "REFLECT_AND_STORE") return "只整理自己可见且有证据的经历，优先保留以后能体现自己表达方式或与此人相处方式的细节。";
  return "从自己的性格、当前目标、对这个人的主观关系和刚刚可见的具体情况出发，决定一个像本人会做的小动作；不需要为了推进剧情而互动。";
}

function completionCondition(taskType: CharacterAgentTaskType) {
  if (taskType === "RESPOND_TO_INTERACTION_REQUEST") return "只交付自己的一个明确回应，不替请求者完成共同结果。";
  if (taskType === "RESPOND_TO_SPEECH") return "接住当前一句话或明确选择沉默、回避、结束，不重开话题。";
  if (taskType === "HANDLE_ACTION_RESULT") return "只根据已裁决结果决定一个后续小动作。";
  if (taskType === "REFLECT_AND_STORE") return "只提出一条有公开证据且值得长期保留的记忆，或明确不写。";
  return "只决定一个符合角色当下状态的小动作或明确停留，然后结束本回合。";
}

function stageCapabilities(taskType: CharacterAgentTaskType, hasTarget: boolean, animationCatalog: Array<{ id: string; label: string }>): CharacterAgentCapabilityEnvelope {
  const blockedActions: CharacterAgentCapabilityEnvelope["blockedActions"] = [];
  if (!hasTarget) {
    for (const action of ["move_closer", "move_away", "face_other", "look_away", "request_conversation", "request_touch", "request_shared_action", "respond_accept", "respond_hesitate", "respond_reject", "respond_counter"] as const) {
      blockedActions.push({ action, reason: "当前没有可指向的另一角色" });
    }
  } else if (taskType !== "RESPOND_TO_INTERACTION_REQUEST" && taskType !== "RESPOND_TO_SPEECH") {
    for (const action of ["respond_accept", "respond_hesitate", "respond_reject", "respond_counter"] as const) {
      blockedActions.push({ action, reason: "当前不是对公开互动请求的回应回合" });
    }
  }
  return {
    behaviorActions: CHARACTER_AGENT_ACTIONS.filter((action) => !blockedActions.some((entry) => entry.action === action)),
    requestRequiredActions: ["request_touch", "request_shared_action"],
    blockedActions,
    animationCatalog,
  };
}

function buildTurnBrief(
  taskType: CharacterAgentTaskType,
  attentionReason: string,
  currentAction: string,
  unfinishedGoal: string | null,
  distance: CharacterAgentTurnBrief["distance"],
  pendingQuestion: string | null,
  lastOwnBeat: string | null,
): CharacterAgentTurnBrief {
  return {
    whyAwakened: attentionReason,
    currentAction,
    unfinishedGoal,
    distance,
    pendingQuestion,
    lastOwnBeat,
    completionCondition: completionCondition(taskType),
  };
}

function lastActedTurn(state: GameState, actorId: string) {
  return state.agentStageHistory[actorId]?.[0]?.turn ?? -1;
}

function stableTieBreaker(value: string) {
  let score = 0;
  for (let index = 0; index < value.length; index += 1) score = (score * 31 + value.charCodeAt(index)) >>> 0;
  return score % 17;
}

export type AttentionSelection = {
  actorId: string;
  counterpartId: string | null;
  reason: string;
};

export function selectAttentionTarget(state: GameState): AttentionSelection {
  if (!state.agents.length) throw new Error("当前世界没有可唤醒的角色");
  const desktopTrigger = state.desktopAttentionQueue?.find((trigger) => (
    state.agents.some((agent) => agent.id === trigger.actorId)
      && (!trigger.counterpartId || state.agents.some((agent) => agent.id === trigger.counterpartId))
  ));
  if (desktopTrigger) return {
    actorId: desktopTrigger.actorId,
    counterpartId: desktopTrigger.counterpartId,
    reason: `桌面公开事件需要该角色独立感知：${desktopTrigger.reason}`,
  };
  const storyTrigger = state.mode === "story" && state.storyAttentionQueue?.find((trigger) => state.agents.some((agent) => agent.id === trigger.actorId));
  if (storyTrigger) return {
    actorId: storyTrigger.actorId,
    counterpartId: null,
    reason: `公开世界事件需要该角色独立感知：${storyTrigger.reason}`,
  };
  if (state.agents.length === 1) return { actorId: state.agents[0].id, counterpartId: null, reason: "当前只有自己，按个人目标和未完成事项行动" };

  const candidates = state.agents.flatMap((actor) => state.agents.filter((target) => target.id !== actor.id).map((target) => {
    let score = Math.max(0, state.turn - lastActedTurn(state, actor.id)) * 8;
    const reasons: string[] = [];
    const openQuestion = state.publicDialogue.pendingQuestions.find((question) => question.status === "open" && question.toAgentId === actor.id && question.fromAgentId === target.id);
    if (openQuestion) {
      score += 180;
      reasons.push(`有待回答的问题：“${openQuestion.text}”`);
    }
    const sameActivePair = state.publicDialogue.status === "active"
      && state.publicDialogue.participants.includes(actor.id)
      && state.publicDialogue.participants.includes(target.id);
    if (sameActivePair) {
      score += 90;
      reasons.push("当前公开对话仍在继续");
      if (state.publicDialogue.lastSpeakerId === target.id) score += 55;
      if (state.publicDialogue.lastSpeakerId === actor.id) score -= 30;
    }
    const groupParticipation = state.publicDialogue.groupScene.participation[actor.id];
    if (state.publicDialogue.status === "active" && state.publicDialogue.groupScene.participantIds.includes(actor.id)) {
      score += 48;
      reasons.push("正在同一个多人公开场景中");
      if (state.publicDialogue.groupScene.addresseeIds.includes(actor.id) && state.publicDialogue.groupScene.currentSpeakerId === target.id) score += 85;
      if (groupParticipation?.wantsFloor) score += 40;
      if (groupParticipation?.stance === "observing") score -= 18;
      if (groupParticipation?.stance === "withdrawing" || groupParticipation?.stance === "excluded") score -= 70;
    }
    const spatial = state.spatial[actor.id];
    if (spatial?.targetId === target.id) score += 28;
    if (spatial?.proximity === "near" || spatial?.proximity === "touching") {
      score += 24;
      reasons.push("双方处在可自然感知的距离");
    } else if (spatial?.proximity === "normal") {
      score += 12;
      reasons.push("双方处在正常社交距离");
    }
    const view = viewFor(pairFor(state, actor.id, target.id), actor.id);
    if (view?.unresolvedThreads.length) {
      score += 22;
      reasons.push("对这个人仍有未完成事项");
    }
    if (actor.memory.unresolvedThreads.length) score += 12;
    score += stableTieBreaker(`${state.turn}-${actor.id}-${target.id}`);
    return { actorId: actor.id, counterpartId: target.id, score, reason: reasons.join("；") || "当前注意力、距离与行动间隔最相关" };
  }));

  candidates.sort((left, right) => right.score - left.score || `${left.actorId}-${left.counterpartId}`.localeCompare(`${right.actorId}-${right.counterpartId}`));
  return candidates[0];
}

function dialogueFor(state: GameState, actorId: string, counterpartId: string | null): PublicDialogueState {
  const activeGroup = state.publicDialogue.status === "active"
    && state.publicDialogue.groupScene.participantIds.length > 2
    && state.publicDialogue.groupScene.participantIds.includes(actorId);
  const belongs = (beat: PublicDialogueBeat) => counterpartId
    ? activeGroup || (beat.speakerId === actorId && (beatAddressees(beat).includes(counterpartId) || beat.audienceScope === "everyone"))
      || (beat.speakerId === counterpartId && (beatAddressees(beat).includes(actorId) || beat.audienceScope === "everyone"))
    : beat.speakerId === actorId || beatAddressees(beat).includes(actorId) || beat.audienceScope === "everyone";
  const transcript = state.publicDialogue.transcript.filter(belongs).slice(0, 12).reverse();
  const pendingQuestions = state.publicDialogue.pendingQuestions.filter((question) => activeGroup || (counterpartId
    ? (question.fromAgentId === actorId && question.toAgentId === counterpartId)
      || (question.fromAgentId === counterpartId && question.toAgentId === actorId)
    : question.fromAgentId === actorId || question.toAgentId === actorId)).slice(0, 8);
  const activePair = Boolean(counterpartId
    && state.publicDialogue.status === "active"
    && state.publicDialogue.participants.includes(actorId)
    && state.publicDialogue.participants.includes(counterpartId));
  return {
    schema: PUBLIC_DIALOGUE_SCHEMA,
    sessionId: activePair ? state.publicDialogue.sessionId : null,
    participants: activeGroup ? state.publicDialogue.participants : activePair ? [actorId, counterpartId!] : [],
    status: activePair ? "active" : "idle",
    currentTopic: activePair ? state.publicDialogue.currentTopic : transcript[transcript.length - 1]?.topic || null,
    lastSpeakerId: activePair ? state.publicDialogue.lastSpeakerId : transcript[transcript.length - 1]?.speakerId || null,
    consecutiveBeats: activePair ? state.publicDialogue.consecutiveBeats : 0,
    transcript,
    pendingQuestions,
    groupScene: activeGroup ? state.publicDialogue.groupScene : {
      ...state.publicDialogue.groupScene,
      id: null,
      participantIds: [],
      addresseeIds: [],
      audienceIds: [],
      openQuestionIds: [],
      participation: {},
    },
  };
}

export function buildCharacterAgentTask(
  state: GameState,
  taskType: CharacterAgentTaskType = "PERCEIVE_AND_DECIDE",
  assignedTo?: string,
  counterpartId?: string | null,
  trigger: CharacterAgentTrigger = null,
  stageSessionId?: string,
  attentionReason?: string,
): CharacterAgentTask {
  const attention = assignedTo ? null : selectAttentionTarget(state);
  const scheduledActorId = assignedTo || attention?.actorId;
  const actor = state.agents.find((item) => item.id === scheduledActorId) || state.agents[0];
  if (!actor) throw new Error("当前世界没有可唤醒的角色");
  const scheduledCounterpartId = counterpartId === undefined ? attention?.counterpartId || null : counterpartId;
  const target = state.agents.find((item) => item.id === scheduledCounterpartId) || null;
  const relationship = pairFor(state, actor.id, target?.id || null);
  const view = viewFor(relationship, actor.id);
  const spatial = state.spatial[actor.id];
  const targetSpatial = target ? state.spatial[target.id] : null;
  const profile = normalizeCharacterProfile(actor.profile, actor);
  const characterReference = buildCharacterReferenceContext(actor.referencePack, target ? { name: target.name, referencePack: target.referencePack } : null);
  const currentAttitude = view?.currentEmotion || actor.mood || "观察当前环境";
  const publicEventIds = visibleEventIds(state, actor.id, target?.id || null);
  const relevantMemory = selectCharacterMemory({ memory: actor.memory, ownerAgentId: actor.id, counterpartId: target?.id || null, taskType, turn: state.turn + 1, visibleEventIds: publicEventIds });
  const roleplayCues = selectRoleplayMemoryCues(actor.memory, target?.id || null);
  const actions = availablePixelPetActions(actor.visual);
  const animationCatalog = pixelPetActionCatalog(actor.visual);
  const boundaries = knownBoundaries(view);
  const history = [...(state.agentStageHistory[actor.id] || [])].slice(0, 6).reverse();
  const scopedDialogue = dialogueFor(state, actor.id, target?.id || null);
  const visibleGroupIds = state.agents.map((agent) => agent.id).slice(0, 3);
  const publicDialogue: PublicDialogueState = scopedDialogue.groupScene.id ? scopedDialogue : {
    ...scopedDialogue,
    groupScene: {
      ...scopedDialogue.groupScene,
      participantIds: visibleGroupIds,
      audienceIds: visibleGroupIds.filter((id) => id !== actor.id),
      participation: Object.fromEntries(visibleGroupIds.map((id) => [id, {
        agentId: id,
        stance: id === actor.id ? "engaged" as const : "observing" as const,
        attentionTo: [],
        wantsFloor: false,
        lastSpokeTurn: state.publicDialogue.groupScene.participation[id]?.lastSpokeTurn ?? null,
      }])),
    },
  };
  const continuingSession = publicDialogue.status === "active" ? publicDialogue.sessionId : null;
  const sessionId = stageSessionId || continuingSession || `stage-${state.turn + 1}-${actor.id}`;
  const instruction = stageInstruction(taskType);
  const surfaceGuidance = state.surface === "desktop_pet"
    ? "当前处于持续运行的桌宠模式，但控制者仍是这个角色自己的 Character Agent：不需要等待玩家，角色可以自主探索、靠近或远离、说话、发起需要对方独立回应的互动请求、休息或继续自己的事。若现有动画无法准确表达这个 Agent 已决定的情绪或动作，可以选择 custom 并描述需要的表情/动作；素材生成服务只会异步制作视觉资源，不参与行为决策。"
    : "";
  const resolvedAttentionReason = [surfaceGuidance, attentionReason || attention?.reason || "当前任务由公开请求路由"].filter(Boolean).join(" ");
  const lens = view ? {
    ...view.lens,
    currentStance: relationshipDirectionLabel(view),
    currentEmotion: view.currentEmotion,
    knownBoundaries: boundaries,
    unresolvedMatters: view.unresolvedThreads.slice(0, 4),
    lastPublicMoment: relationship?.history[0] || null,
  } : null;
  const lastOwnHistory = history.at(-1) || null;
  const pendingQuestion = publicDialogue.pendingQuestions.find((question) => question.status === "open" && question.toAgentId === actor.id)?.text || null;
  const distance = spatial?.proximity || (target ? "far" : "alone");
  const turnBrief = buildTurnBrief(
    taskType,
    resolvedAttentionReason,
    spatial?.perception || lastOwnHistory?.ownAction || "当前没有进行中的动作",
    actor.memory.unresolvedThreads[0] || view?.unresolvedThreads[0] || null,
    distance,
    pendingQuestion,
    lastOwnHistory ? [lastOwnHistory.ownAction, lastOwnHistory.spokenContent].filter(Boolean).join("；") : null,
  );
  const capabilities = stageCapabilities(taskType, Boolean(target), animationCatalog);
  const visibleWorldEvents = state.mode === "story"
    ? state.events.filter((event) => event.mode === "story" && event.actorIds.includes(actor.id)).slice(0, 6).map((event) => `${event.title}：${event.summary}`)
    : [];
  const visibleEntities = state.mode === "story" ? state.worldEntities.filter((entity) => entity.visibility === "public").slice(0, 8).map((entity) => ({ id: entity.id, type: entity.type, description: entity.description, state: entity.state })) : [];
  const publicCharacterStatuses = state.mode === "story" ? state.events.filter((event) => event.mode === "story" && event.actorIds.includes(actor.id)).slice(0, 4).map((event) => event.impact).filter(Boolean) : [];
  const sceneBrief = state.mode === "story" && state.storyScene ? {
    sceneId: state.storyScene.sceneId,
    location: state.storyScene.location,
    timeOfDay: state.storyScene.timeOfDay,
    weather: state.storyScene.weather,
    atmosphere: state.storyScene.atmosphere,
  } : null;

  return {
    taskId: `task-${state.turn + 1}-${actor.id}-${taskType.toLowerCase()}`,
    worldId: state.worldId,
    turn: state.turn + 1,
    stageSessionId: sessionId,
    taskType,
    assignedTo: actor.id,
    counterpartId: target?.id || null,
    trigger,
    context: {
      contextSchema: CHARACTER_CONTEXT_SCHEMA,
      layers: {
        roleplay: {
          characterProfile: profile,
          characterReference,
          worldviewRules: [
            "每个角色只控制自己的身体、语言、私人想法与记忆。",
            "对方拥有拒绝、犹豫、反悔、提出替代和离开的权利。",
            "模型只提出行动和记忆建议；公开世界状态与关系结果由本地运行时裁决。",
          ],
          memorySummaries: relevantMemory,
          roleplayCues,
        },
        stage: {
          taskType,
          instruction,
          knownBoundaries: boundaries,
          turnBrief,
          capabilities,
          allowedActions: actions,
          animationCatalog,
          trigger,
          attentionReason: resolvedAttentionReason,
          sceneBrief,
          visibleWorldEvents,
          visibleEntities,
          publicCharacterStatuses,
          environmentAffordances: state.mode === "story" ? [...state.scene.tags, "角色可以在安全舞台范围内自主移动、观察、说话、停留或离开互动"] : [],
        },
        messageHistory: history,
        publicDialogue,
        groupScene: publicDialogue.groupScene,
        budget: {
          memoryCharacters: relevantMemory.reduce((total, item) => total + item.summary.length + item.contentExcerpt.length, 0) + roleplayCues.reduce((total, cue) => total + cue.text.length, 0) + (characterReference?.claims.reduce((total, claim) => total + claim.text.length, 0) || 0),
          historyCharacters: history.reduce((total, item) => total + item.ownAction.length + (item.spokenContent?.length || 0) + (item.nonverbalBeat?.length || 0) + item.privateReflection.length + item.publicResult.length, 0),
          memoryTokens: approxTokensSum([
            ...relevantMemory.flatMap((item) => [item.summary, item.contentExcerpt]),
            ...roleplayCues.map((cue) => cue.text),
            ...(characterReference?.claims.map((claim) => claim.text) || []),
          ]),
          historyTokens: approxTokensSum(history.flatMap((item) => [item.ownAction, item.spokenContent, item.nonverbalBeat, item.privateReflection, item.publicResult])),
        },
      },
      identity: { id: actor.id, name: actor.name, profile },
      currentState: {
        physicalState: spatial?.intent === "rest" ? "正在休息，不适合激烈活动" : "身体状态稳定，可以自主移动或停留",
        emotionalState: actor.mood,
        socialState: target ? `我知道${target.name}也在这个空间里，但不需要为了互动而互动` : "当前没有其他角色，我可以独自探索、观察或休息",
        currentFocus: spatial?.perception || actor.privateThought,
      },
      goals: {
        immediateGoal: actor.privateThought || "观察当前环境后决定一个小动作",
        relationshipIntention: target ? `通过我对${target.name}的方向性理解，自主决定怎样表达、回应、沉默或离开` : "按自己的节奏生活，不虚构关系对象",
        unspokenIntention: actor.memory.unresolvedThreads[0] || view?.unresolvedThreads[0] || "没有必须立刻完成的隐藏目标",
      },
      understandingOfOther: {
        targetId: target?.id || null,
        targetName: target?.name || null,
        relationshipSummary: relationshipSummary(view, target?.name || null),
        currentAttitude,
        knownBoundaries: boundaries,
        unresolvedMatters: [...(view?.unresolvedThreads || []), ...actor.memory.unresolvedThreads].slice(0, 4),
        relationshipLens: lens,
      },
      relevantMemory,
      observableSituation: {
        distance,
        orientation: targetSpatial ? `${actor.name}朝向${spatial?.facing || "未知"}，${target?.name || "对方"}朝向${targetSpatial.facing}` : "当前只有自己",
        publicEvents: observableEvents(state, actor.id, target?.id || null),
        visibleDescription: trigger
          ? `${trigger.actorName}的可见行为：${trigger.observableBehavior}${trigger.nonverbalBeat ? `；非语言动作：${trigger.nonverbalBeat}` : ""}${trigger.spokenContent ? `；说：“${trigger.spokenContent}”` : ""}`
          : spatial?.perception || (target ? `我能看见${target.name}的公开动作，但不知道对方未表达的想法。` : "这里暂时只有我一个人。"),
      },
      availableActions: actions,
    },
  };
}

function triggerFromBeat(state: GameState, beat: PublicDialogueBeat, requiredResponse = false): CharacterAgentTrigger {
  const actor = state.agents.find((agent) => agent.id === beat.speakerId);
  if (!actor) return null;
  return {
    actorId: actor.id,
    actorName: actor.name,
    observableBehavior: beat.observableBehavior,
    spokenContent: beat.spokenContent,
    nonverbalBeat: beat.nonverbalBeat,
    speechAct: beat.speechAct,
    topic: beat.topic,
    interactionType: null,
    consentRequired: false,
    requiredResponse,
  };
}

export function buildAttentionAgentTask(state: GameState) {
  const attention = selectAttentionTarget(state);
  const actorLastTurn = state.agentStageHistory[attention.actorId]?.[0]?.turn ?? -1;
  const incoming = state.publicDialogue.transcript.find((beat) => beat.speakerId === attention.counterpartId
    && (beatAddressees(beat).includes(attention.actorId) || (beat.audienceScope === "everyone" && beat.audienceIds.includes(attention.actorId)))
    && beat.turn > actorLastTurn);
  const openQuestion = state.publicDialogue.pendingQuestions.find((question) => question.status === "open" && question.toAgentId === attention.actorId && question.fromAgentId === attention.counterpartId);
  const taskType: CharacterAgentTaskType = incoming || openQuestion ? "RESPOND_TO_SPEECH" : "PERCEIVE_AND_DECIDE";
  const trigger = incoming ? triggerFromBeat(state, incoming) : null;
  return buildCharacterAgentTask(state, taskType, attention.actorId, attention.counterpartId, trigger, state.publicDialogue.status === "active" ? state.publicDialogue.sessionId || undefined : undefined, attention.reason);
}

export function buildResponseTasks(state: GameState, actorDecision: CharacterAgentDecision): CharacterAgentTask[] {
  const actor = state.agents.find((item) => item.id === actorDecision.actorId);
  if (!actor || actorDecision.responseExpectation === "none") return [];
  const consentRequired = actorDecision.action === "request_touch" || actorDecision.action === "request_shared_action" || actorDecision.interactionType === "sensitive_topic";
  const explicitIds = actorDecision.addresseeIds?.length
    ? actorDecision.addresseeIds
    : actorDecision.addressedTo ? [actorDecision.addressedTo] : actorDecision.targetId ? [actorDecision.targetId] : [];
  const audienceIds = actorDecision.audienceScope === "everyone"
    ? state.publicDialogue.groupScene.participantIds.filter((id) => id !== actor.id)
    : explicitIds;
  const candidateIds = [...new Set(audienceIds)].filter((id) => id !== actor.id && state.agents.some((agent) => agent.id === id));
  const routedIds = consentRequired ? candidateIds.slice(0, 1) : candidateIds.slice(0, 2);
  const directSpeech = Boolean(actorDecision.spokenContent)
    && (["question", "invitation", "challenge", "confession", "boundary"].includes(actorDecision.speechAct) || actorDecision.responseExpectation === "welcome");
  if (!consentRequired && !directSpeech && actorDecision.action !== "request_conversation") return [];
  const taskType: CharacterAgentTaskType = consentRequired ? "RESPOND_TO_INTERACTION_REQUEST" : "RESPOND_TO_SPEECH";
  return routedIds.map((targetId) => buildCharacterAgentTask(state, taskType, targetId, actor.id, {
      actorId: actor.id,
      actorName: actor.name,
      observableBehavior: actorDecision.observableBehavior,
      spokenContent: actorDecision.spokenContent,
      nonverbalBeat: actorDecision.nonverbalBeat,
      speechAct: actorDecision.speechAct,
      topic: actorDecision.topic,
      interactionType: actorDecision.interactionType,
      consentRequired,
      requiredResponse: consentRequired || actorDecision.responseExpectation === "required",
    }, actorDecision.stageSessionId, consentRequired ? "需要对公开的同意请求作出独立回应" : "对方在多人公开场景里把一句话交给了我；我可以回应、沉默、观察或退出"));
}

export function buildResponseTask(state: GameState, actorDecision: CharacterAgentDecision): CharacterAgentTask | null {
  return buildResponseTasks(state, actorDecision)[0] || null;
}

export interface CharacterAgentModelProvider {
  decide(task: CharacterAgentTask): Promise<CharacterAgentDecision>;
}
