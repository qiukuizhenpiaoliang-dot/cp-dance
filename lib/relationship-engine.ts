export type RelationshipSignals = {
  warmth: number;
  honesty: number;
  vulnerability: number;
  reliability: number;
  boundaryRespect: number;
  sharedRisk: number;
  friction: number;
  jealousy: number;
};

export type RelationshipDelta = {
  affinity: number;
  trust: number;
  tension: number;
  attraction: number;
  attachment: number;
  resentment: number;
  reason: string;
};

export type DirectionSnapshot = {
  affinity: number;
  trust: number;
  tension: number;
  attraction: number;
  attachment: number;
  resentment: number;
  fear: number;
  respect: number;
  contactConsent: "open" | "ask_first" | "closed";
  rejectionLocks: string[];
};

export type RelationshipCue = {
  id: string;
  label: string;
  available: boolean;
  reason: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Character agents emit semantic observations. Only the deterministic judge
 * turns those observations into directional state changes.
 */
export function evaluateRelationship(signals: RelationshipSignals): RelationshipDelta {
  const affinity = clamp(
    signals.warmth * 1.6 + signals.vulnerability * 0.7 + signals.sharedRisk * 0.6 + signals.boundaryRespect * 0.6 - signals.friction * 1.2 - signals.jealousy * 0.35,
    -7,
    8,
  );
  const trust = clamp(
    signals.honesty * 1.4 + signals.reliability * 1.3 + signals.boundaryRespect * 1.4 + signals.sharedRisk * 0.4 - signals.friction * 0.7 - signals.jealousy,
    -8,
    9,
  );
  const tension = clamp(
    signals.friction * 1.9 + signals.jealousy * 1.6 + Math.max(0, signals.vulnerability) * 0.4 - signals.boundaryRespect * 0.9 - signals.warmth * 0.4,
    -9,
    12,
  );
  const positives = [
    signals.warmth > 1 ? "感受到明显关心" : "",
    signals.honesty > 1 ? "看见了真实表达" : "",
    signals.sharedRisk > 1 ? "共同承担了风险" : "",
    signals.boundaryRespect > 1 ? "边界被认真尊重" : "",
  ].filter(Boolean);
  const negatives = [
    signals.friction > 1 ? "冲突仍未解决" : "",
    signals.jealousy > 1 ? "嫉妒与猜疑升高" : "",
    signals.boundaryRespect < 0 ? "边界被越过" : "",
  ].filter(Boolean);
  return {
    affinity,
    trust,
    tension,
    attraction: clamp(signals.warmth + signals.vulnerability - Math.max(0, signals.friction - 1), -3, 4),
    attachment: clamp(signals.reliability + signals.sharedRisk + Math.max(0, signals.warmth), -2, 4),
    resentment: clamp(signals.friction * 2 + Math.max(0, -signals.boundaryRespect) * 3 - Math.max(0, signals.honesty), -4, 7),
    reason: [...positives, ...negatives].join("；") || "一次普通但被各自记住的相处",
  };
}

export function qualitativeStage(metric: "affinity" | "trust" | "tension", value: number) {
  const stages = metric === "affinity"
    ? ["排斥", "冷淡", "在意", "亲近", "依恋"]
    : metric === "trust"
      ? ["戒备", "存疑", "基本信任", "托付", "毫无保留"]
      : ["平静", "微妙", "升温", "紧绷", "即将爆发"];
  if (value < 18) return stages[0];
  if (value < 38) return stages[1];
  if (value < 60) return stages[2];
  if (value < 82) return stages[3];
  return stages[4];
}

export function relationshipDirectionLabel(snapshot: DirectionSnapshot) {
  if (snapshot.rejectionLocks.includes("permanent_break")) return "不可逆决裂";
  if (snapshot.resentment > 68 && snapshot.trust < 24) return "敌意与防备";
  if (snapshot.attraction > 62 && snapshot.trust < 38 && snapshot.tension > 58) return "危险吸引";
  if (snapshot.attachment > 66 && snapshot.trust > 58) return snapshot.attraction > 54 ? "深度依恋" : "重要知己";
  if (snapshot.affinity > 56 && snapshot.trust > 48) return snapshot.attraction > 48 ? "明显心动" : "亲近信赖";
  if (snapshot.respect > 60 && snapshot.affinity < 38) return "尊敬的对手";
  if (snapshot.affinity > 34) return "开始在意";
  return snapshot.trust < 22 ? "保持观察" : "普通相处";
}

/**
 * These are opportunities, not unlock buttons. A visible cue never guarantees
 * that either character will carry it out or accept it.
 */
export function deriveRelationshipCues(snapshot: DirectionSnapshot): RelationshipCue[] {
  const blockedByRefusal = snapshot.rejectionLocks.includes("romantic_pursuit");
  return [
    { id: "talk", label: "普通交谈", available: true, reason: "可以创造交谈机会" },
    { id: "quiet_company", label: "安静陪伴", available: snapshot.resentment < 58, reason: snapshot.resentment < 58 ? "对方尚未要求完全远离" : "应先尊重对方的空间" },
    { id: "repair", label: "尝试修复", available: snapshot.resentment > 18 || snapshot.tension > 42, reason: "存在需要被理解的余波" },
    { id: "romantic_signal", label: "表达心意的可能", available: snapshot.attraction > 48 && !blockedByRefusal, reason: blockedByRefusal ? "明确拒绝仍然有效" : "角色可能愿意表达，也可能临阵退缩" },
  ];
}
