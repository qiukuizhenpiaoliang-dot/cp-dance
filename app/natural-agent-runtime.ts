import type { GameState } from "@/lib/agent-engine";
import { buildAttentionAgentTask, buildResponseTasks } from "@/lib/model-provider";
import type { CharacterAgentDecision, CharacterAgentTask, CharacterAssetJob, GeneratedCharacterAsset, NaturalAgentTurn } from "@/lib/natural-agent-types";
import { availablePixelPetActions } from "@/lib/pixel-pet";
import { generatePixelPetActionPack } from "./pixel-pet-runtime";

type AgentApiPayload = CharacterAgentDecision & { error?: string };

export type AssetUpdate = {
  job: CharacterAssetJob;
  asset?: GeneratedCharacterAsset;
};

export type NaturalAgentRuntimeResult = {
  turn: NaturalAgentTurn;
  model: string;
};

async function requestDecision(task: CharacterAgentTask) {
  const response = await fetch("/api/ai/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  const payload = await response.json().catch(() => null) as AgentApiPayload | null;
  if (!response.ok || !payload?.action || payload.actorId !== task.assignedTo || payload.taskId !== task.taskId) {
    throw new Error(payload?.error || "Character Agent 没有返回有效决策");
  }
  return payload;
}

function fallbackAnimation(action: CharacterAgentDecision["action"]) {
  if (["explore", "move_closer", "move_away", "end_interaction"].includes(action)) return "walk";
  if (["speak", "request_conversation", "request_touch", "request_shared_action", "respond_counter"].includes(action)) return "talk";
  if (["respond_reject", "look_away"].includes(action)) return "angry";
  if (action === "respond_accept") return "shy";
  if (["observe", "face_other", "respond_hesitate"].includes(action)) return "listen";
  return "idle";
}

function desktopExpressiveFallback(decision: CharacterAgentDecision) {
  const performance = `${decision.emotionalState} ${decision.animationDescription} ${decision.observableBehavior}`;
  if (/(害羞|脸红|羞涩|羞赧|不好意思|慌乱|shy|blush|fluster)/i.test(performance)) return "shy";
  if (/(生气|恼火|愤怒|不悦|冒犯|angry|annoyed|mad)/i.test(performance)) return "angry";
  return fallbackAnimation(decision.action);
}

function generatedSemanticIntent(decision: CharacterAgentDecision) {
  const standardExpressions: Record<string, string> = { shy: "害羞", angry: "生气", talk: "交谈", listen: "倾听" };
  const standardExpression = standardExpressions[decision.animationAction];
  return standardExpression || decision.animationDescription || decision.observableBehavior;
}

function ensureAnimation(
  state: GameState,
  decision: CharacterAgentDecision,
  onAssetUpdate?: (update: AssetUpdate) => void,
) {
  const agent = state.agents.find((item) => item.id === decision.actorId);
  if (!agent) return decision;
  const available = availablePixelPetActions(agent.visual);
  if (decision.animationAction !== "custom" && available.includes(decision.animationAction)) return decision;

  const fallbackAction = state.surface === "desktop_pet" ? desktopExpressiveFallback(decision) : fallbackAnimation(decision.action);
  const semanticIntent = generatedSemanticIntent(decision);
  const alreadyQueued = state.assetJobs.some((job) => job.characterId === agent.id
    && job.semanticIntent === semanticIntent
    && ["requested", "generating", "validating"].includes(job.status));
  if (alreadyQueued) return { ...decision, animationAction: fallbackAction };
  const job: CharacterAssetJob = {
    id: `asset-job-${state.turn + 1}-${agent.id}-${Date.now()}`,
    characterId: agent.id,
    semanticIntent,
    fallbackAction,
    status: "generating",
    requestedTurn: state.turn + 1,
    assetId: null,
    error: null,
  };
  onAssetUpdate?.({ job });
  void generatePixelPetActionPack({ visual: agent.visual, requestedActions: [semanticIntent] })
    .then((pack) => {
      onAssetUpdate?.({ job: { ...job, status: "validating" } });
      const readyJob = { ...job, status: "ready" as const, assetId: pack.id };
      onAssetUpdate?.({ job: readyJob, asset: { job: readyJob, pack } });
    })
    .catch((reason) => {
      const error = reason instanceof Error ? reason.message : "缺失动作生成失败";
      onAssetUpdate?.({ job: { ...job, status: "failed", error } });
    });
  return { ...decision, animationAction: fallbackAction };
}

export async function runNaturalAgentTurn(
  state: GameState,
  onAssetUpdate?: (update: AssetUpdate) => void,
): Promise<NaturalAgentRuntimeResult> {
  const actorTask = buildAttentionAgentTask(state);
  let actorDecision = await requestDecision(actorTask);
  let responderDecisions: CharacterAgentDecision[] = [];

  const responseTasks = buildResponseTasks(state, actorDecision);
  if (responseTasks.length) {
    // R5: allSettled lets one responder fail without dropping the others.
    // Character Agents are contractually independent, so partial success is
    // valid — reducers already accept any number of responderDecisions.
    const settled = await Promise.allSettled(responseTasks.map(requestDecision));
    responderDecisions = settled
      .filter((result): result is PromiseFulfilledResult<CharacterAgentDecision> => result.status === "fulfilled")
      .map((result) => result.value);
    if (!responderDecisions.length && settled.length) {
      const firstReason = settled.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
      throw firstReason?.reason instanceof Error ? firstReason.reason : new Error("Character Agent 全部响应失败");
    }
  }

  actorDecision = ensureAnimation(state, actorDecision, onAssetUpdate);
  responderDecisions = responderDecisions.map((decision) => ensureAnimation(state, decision, onAssetUpdate));
  const responderDecision = responderDecisions[0] || null;

  return {
    turn: { actorDecision, responderDecision, responderDecisions },
    model: responderDecisions.find((decision) => decision.model)?.model || actorDecision.model || "Character Agent API",
  };
}
