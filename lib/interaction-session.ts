import type { InteractionPlaybackPhase, InteractionSpaceLevel } from "./action-unit";
import type { DuoInteractionKind, DuoInteractionValidation } from "./duo-interaction";

export const INTERACTION_SESSION_SCHEMA = "cp-dance/interaction-session/v1" as const;

export type InteractionSessionPhase = "orient" | "approach" | "align" | InteractionPlaybackPhase | "complete" | "cancelled";
export type InteractionMatchResult = "pending" | "perfect" | "acceptable" | "invalid";

export type InteractionSession = {
  schema: typeof INTERACTION_SESSION_SCHEMA;
  id: string;
  eventId: string;
  kind: DuoInteractionKind | "approach";
  initiatorId: string;
  receiverId: string;
  consent: "not_required" | "accepted";
  spaceLevel: InteractionSpaceLevel;
  phase: InteractionSessionPhase;
  phaseStep: number;
  initiatorAction: string;
  receiverAction: string;
  fallbackActions: { initiator: string; receiver: string };
  idealDistance: number;
  allowedError: number;
  maxRootCorrection: number;
  maintainFacing: boolean;
  maintainDistance: boolean;
  facingMode: "toward_each_other" | "travel_direction";
  movesTogether: boolean;
  validation?: DuoInteractionValidation;
  match: InteractionMatchResult;
  failureReason: string | null;
  startedTurn: number;
};

type Blueprint = {
  spaceLevel: InteractionSpaceLevel;
  initiatorAction: string;
  receiverAction: string;
  fallbackActions: { initiator: string; receiver: string };
  idealDistance: number;
  allowedError: number;
  maxRootCorrection: number;
  maintainDistance: boolean;
  facingMode: InteractionSession["facingMode"];
  movesTogether: boolean;
};

const BLUEPRINTS: Record<DuoInteractionKind | "approach", Blueprint> = {
  approach: { spaceLevel: "approach", initiatorAction: "walk", receiverAction: "listen", fallbackActions: { initiator: "idle", receiver: "idle" }, idealDistance: 20, allowedError: 4, maxRootCorrection: 0, maintainDistance: false, facingMode: "toward_each_other", movesTogether: false },
  conversation: { spaceLevel: "orientation", initiatorAction: "talk", receiverAction: "listen", fallbackActions: { initiator: "wave", receiver: "idle" }, idealDistance: 24, allowedError: 14, maxRootCorrection: 0, maintainDistance: false, facingMode: "toward_each_other", movesTogether: false },
  eye_contact: { spaceLevel: "orientation", initiatorAction: "listen", receiverAction: "listen", fallbackActions: { initiator: "idle", receiver: "idle" }, idealDistance: 24, allowedError: 14, maxRootCorrection: 0, maintainDistance: false, facingMode: "toward_each_other", movesTogether: false },
  touch: { spaceLevel: "contact", initiatorAction: "love", receiverAction: "love", fallbackActions: { initiator: "wave", receiver: "shy" }, idealDistance: 10, allowedError: 2.5, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  hand_contact: { spaceLevel: "contact", initiatorAction: "love", receiverAction: "love", fallbackActions: { initiator: "wave", receiver: "shy" }, idealDistance: 12, allowedError: 2.5, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  hug: { spaceLevel: "contact", initiatorAction: "love", receiverAction: "love", fallbackActions: { initiator: "shy", receiver: "shy" }, idealDistance: 7, allowedError: 2, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  cuddle: { spaceLevel: "contact", initiatorAction: "love", receiverAction: "love", fallbackActions: { initiator: "shy", receiver: "shy" }, idealDistance: 8, allowedError: 2.5, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  head_touch: { spaceLevel: "contact", initiatorAction: "wave", receiverAction: "shy", fallbackActions: { initiator: "wave", receiver: "idle" }, idealDistance: 10, allowedError: 2.5, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  shoulder_lean: { spaceLevel: "contact", initiatorAction: "love", receiverAction: "shy", fallbackActions: { initiator: "shy", receiver: "idle" }, idealDistance: 8, allowedError: 2.5, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  pat: { spaceLevel: "contact", initiatorAction: "wave", receiverAction: "shy", fallbackActions: { initiator: "wave", receiver: "idle" }, idealDistance: 11, allowedError: 3, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  push: { spaceLevel: "contact", initiatorAction: "angry", receiverAction: "walk", fallbackActions: { initiator: "angry", receiver: "walk" }, idealDistance: 13, allowedError: 3, maxRootCorrection: 3, maintainDistance: false, facingMode: "toward_each_other", movesTogether: false },
  shared_action: { spaceLevel: "sustained", initiatorAction: "wave", receiverAction: "wave", fallbackActions: { initiator: "wave", receiver: "wave" }, idealDistance: 16, allowedError: 4, maxRootCorrection: 3, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  joint_walk: { spaceLevel: "sustained", initiatorAction: "walk", receiverAction: "walk", fallbackActions: { initiator: "walk", receiver: "walk" }, idealDistance: 15, allowedError: 3, maxRootCorrection: 3, maintainDistance: true, facingMode: "travel_direction", movesTogether: true },
  dance: { spaceLevel: "sustained", initiatorAction: "wave", receiverAction: "wave", fallbackActions: { initiator: "wave", receiver: "wave" }, idealDistance: 13, allowedError: 3, maxRootCorrection: 4, maintainDistance: true, facingMode: "toward_each_other", movesTogether: false },
  chase: { spaceLevel: "sustained", initiatorAction: "walk", receiverAction: "walk", fallbackActions: { initiator: "walk", receiver: "walk" }, idealDistance: 22, allowedError: 5, maxRootCorrection: 2, maintainDistance: true, facingMode: "travel_direction", movesTogether: true },
  assist: { spaceLevel: "sustained", initiatorAction: "walk", receiverAction: "walk", fallbackActions: { initiator: "idle", receiver: "idle" }, idealDistance: 12, allowedError: 3, maxRootCorrection: 4, maintainDistance: true, facingMode: "travel_direction", movesTogether: true },
};

export function createInteractionSession(input: {
  eventId: string;
  kind: DuoInteractionKind | "approach";
  initiatorId: string;
  receiverId: string;
  consent: InteractionSession["consent"];
  startedTurn: number;
  validation?: DuoInteractionValidation;
}): InteractionSession {
  const blueprint = BLUEPRINTS[input.kind];
  return {
    schema: INTERACTION_SESSION_SCHEMA,
    id: `interaction-${input.startedTurn}-${input.initiatorId}-${input.receiverId}`,
    eventId: input.eventId,
    kind: input.kind,
    initiatorId: input.initiatorId,
    receiverId: input.receiverId,
    consent: input.consent,
    spaceLevel: blueprint.spaceLevel,
    phase: "orient",
    phaseStep: 0,
    initiatorAction: blueprint.initiatorAction,
    receiverAction: blueprint.receiverAction,
    fallbackActions: blueprint.fallbackActions,
    idealDistance: input.validation?.idealDistance ?? blueprint.idealDistance,
    allowedError: input.validation?.allowedError ?? blueprint.allowedError,
    maxRootCorrection: input.validation?.maxRootCorrection ?? blueprint.maxRootCorrection,
    maintainFacing: true,
    maintainDistance: blueprint.maintainDistance,
    facingMode: blueprint.facingMode,
    movesTogether: blueprint.movesTogether,
    validation: input.validation,
    match: "pending",
    failureReason: null,
    startedTurn: input.startedTurn,
  };
}

export function interactionPhaseLabel(phase: InteractionSessionPhase) {
  return {
    orient: "转向确认",
    approach: "正常接近",
    align: "骨骼微调",
    prepare: "动作准备",
    contact_start: "接触/动作起始",
    contact_hold: "接触/动作保持",
    contact_end: "接触/动作结束",
    recover: "恢复自主",
    complete: "互动完成",
    cancelled: "已安全降级",
  }[phase];
}
