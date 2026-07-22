import type { DuoInteractionKind, InteractionRig, RigPointName } from "./duo-interaction";

export const ACTION_UNIT_SCHEMA = "pixel-pet/action-unit/v1" as const;

export type InteractionSpaceLevel = "orientation" | "approach" | "contact" | "sustained";
export type InteractionActionRole = "solo" | "initiator" | "receiver" | "either";
export type InteractionFacingRequirement = "any" | "toward_target" | "away_from_target" | "travel_direction";
export type InteractionPlaybackPhase = "prepare" | "contact_start" | "contact_hold" | "contact_end" | "recover";

export type ActionPhaseMarker = {
  phase: InteractionPlaybackPhase;
  progress: number;
};

export type ActionUnitMetadata = {
  schema: typeof ACTION_UNIT_SCHEMA;
  role: InteractionActionRole;
  interactionTypes: DuoInteractionKind[];
  spaceLevel: InteractionSpaceLevel;
  facing: InteractionFacingRequirement;
  contact?: { self: RigPointName; target: RigPointName };
  idealDistance: number;
  allowedError: number;
  maxRootCorrection: number;
  allowHorizontalFlip: boolean;
  interruptible: boolean;
  phases: ActionPhaseMarker[];
  rigSource?: "profile" | "keyframe-analysis";
  keyframeRigs?: Partial<Record<InteractionPlaybackPhase, Partial<Record<"front" | "left" | "right", InteractionRig>>>>;
  fallbackAction: string;
};

const STANDARD_PHASES: ActionPhaseMarker[] = [
  { phase: "prepare", progress: 0 },
  { phase: "contact_start", progress: 0.24 },
  { phase: "contact_hold", progress: 0.46 },
  { phase: "contact_end", progress: 0.74 },
  { phase: "recover", progress: 0.9 },
];

const SOLO_PHASES: ActionPhaseMarker[] = [
  { phase: "prepare", progress: 0 },
  { phase: "contact_hold", progress: 0.35 },
  { phase: "recover", progress: 0.82 },
];

function contactMetadata(
  interactionTypes: DuoInteractionKind[],
  contact: ActionUnitMetadata["contact"],
  role: InteractionActionRole = "either",
): ActionUnitMetadata {
  return {
    schema: ACTION_UNIT_SCHEMA,
    role,
    interactionTypes,
    spaceLevel: "contact",
    facing: "toward_target",
    contact,
    idealDistance: interactionTypes.includes("hug") ? 7 : interactionTypes.includes("hand_contact") ? 12 : 10,
    allowedError: 2.5,
    maxRootCorrection: 4,
    allowHorizontalFlip: false,
    interruptible: true,
    phases: STANDARD_PHASES,
    fallbackAction: role === "receiver" ? "shy" : "wave",
  };
}

export function inferActionUnitMetadata(actionName: string, label = actionName): ActionUnitMetadata {
  const semantic = `${actionName} ${label}`.toLowerCase();
  if (/walk|走|靠近|接近|追逐|搀扶/.test(semantic)) {
    const sustained = /一起|共同|牵着|追逐|搀扶/.test(semantic);
    return {
      schema: ACTION_UNIT_SCHEMA,
      role: "either",
      interactionTypes: sustained ? ["joint_walk", "chase", "assist"] : [],
      spaceLevel: sustained ? "sustained" : "approach",
      facing: "travel_direction",
      contact: sustained ? { self: "hip", target: "hip" } : undefined,
      idealDistance: sustained ? 15 : 20,
      allowedError: sustained ? 3 : 7,
      maxRootCorrection: sustained ? 3 : 0,
      allowHorizontalFlip: false,
      interruptible: true,
      phases: sustained ? STANDARD_PHASES : SOLO_PHASES,
      fallbackAction: "walk",
    };
  }
  if (/talk|交谈|说话|表达/.test(semantic)) {
    return { schema: ACTION_UNIT_SCHEMA, role: "initiator", interactionTypes: ["conversation"], spaceLevel: "orientation", facing: "toward_target", idealDistance: 24, allowedError: 14, maxRootCorrection: 0, allowHorizontalFlip: false, interruptible: true, phases: STANDARD_PHASES, fallbackAction: "wave" };
  }
  if (/listen|倾听|回应|观察|对视/.test(semantic)) {
    return { schema: ACTION_UNIT_SCHEMA, role: "receiver", interactionTypes: ["conversation", "eye_contact"], spaceLevel: "orientation", facing: "toward_target", idealDistance: 24, allowedError: 14, maxRootCorrection: 0, allowHorizontalFlip: false, interruptible: true, phases: STANDARD_PHASES, fallbackAction: "idle" };
  }
  if (/牵手|hand.?contact/.test(semantic)) return contactMetadata(["hand_contact"], { self: "rightHand", target: "leftHand" });
  if (/拥抱|hug/.test(semantic)) return contactMetadata(["hug"], { self: "chest", target: "chest" });
  if (/贴贴|cuddle|靠肩/.test(semantic)) return contactMetadata(["cuddle", "shoulder_lean"], { self: "chest", target: "chest" });
  if (/摸头|head.?touch/.test(semantic)) return contactMetadata(["head_touch"], { self: "rightHand", target: "head" }, "initiator");
  if (/轻拍|pat/.test(semantic)) return contactMetadata(["pat"], { self: "rightHand", target: "chest" }, "initiator");
  if (/推开|push/.test(semantic)) return contactMetadata(["push"], { self: "rightHand", target: "chest" }, "initiator");
  if (/love|心动|喜欢/.test(semantic)) return contactMetadata(["touch", "hand_contact", "hug", "cuddle", "shoulder_lean"], { self: "chest", target: "chest" });
  if (/wave|挥手|招呼|dance|跳舞/.test(semantic)) {
    const sustained = /dance|跳舞/.test(semantic);
    return { schema: ACTION_UNIT_SCHEMA, role: "either", interactionTypes: sustained ? ["dance"] : ["shared_action"], spaceLevel: sustained ? "sustained" : "orientation", facing: "toward_target", contact: sustained ? { self: "rightHand", target: "leftHand" } : undefined, idealDistance: sustained ? 13 : 24, allowedError: 3, maxRootCorrection: sustained ? 4 : 0, allowHorizontalFlip: false, interruptible: true, phases: STANDARD_PHASES, fallbackAction: "wave" };
  }
  if (/angry|生气|拒绝/.test(semantic)) return { schema: ACTION_UNIT_SCHEMA, role: "receiver", interactionTypes: [], spaceLevel: "orientation", facing: "away_from_target", idealDistance: 30, allowedError: 16, maxRootCorrection: 0, allowHorizontalFlip: false, interruptible: true, phases: SOLO_PHASES, fallbackAction: "idle" };
  return { schema: ACTION_UNIT_SCHEMA, role: "solo", interactionTypes: [], spaceLevel: "orientation", facing: "any", idealDistance: 24, allowedError: 16, maxRootCorrection: 0, allowHorizontalFlip: false, interruptible: true, phases: SOLO_PHASES, fallbackAction: "idle" };
}

export function normalizeActionUnitMetadata(value: ActionUnitMetadata | undefined, actionName: string, label: string) {
  return value?.schema === ACTION_UNIT_SCHEMA ? value : inferActionUnitMetadata(actionName, label);
}
