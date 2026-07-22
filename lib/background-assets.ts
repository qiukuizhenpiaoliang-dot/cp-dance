import rawCatalog from "../public/backgrounds/index.json";

export const BACKGROUND_CATALOG_SCHEMA = "cp-dance/background-catalog/v1" as const;
export const BACKGROUND_WORLD_INDEX_SCHEMA = "cp-dance/background-world-index/v1" as const;

export type BackgroundAssetSource = "bundled" | "bundled-converted" | "generated";
export type BackgroundAssetStatus = "ready" | "failed" | "deprecated";

export type BackgroundAssetRecord = {
  id: string;
  filename: string;
  url: string;
  sourceType: BackgroundAssetSource;
  originalSourceFilename?: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  title: string;
  description: string;
  tags: string[];
  license: string;
  status: BackgroundAssetStatus;
  createdAt?: string;
  generatedBy?: "background-asset-agent";
  model?: string;
};

export type BackgroundCatalog = {
  schema: typeof BACKGROUND_CATALOG_SCHEMA;
  revision: number;
  updatedAt: string;
  naming: { bundled: string; generated: string };
  assets: BackgroundAssetRecord[];
};

export type BackgroundSceneDescriptor = {
  sceneId?: string;
  location: string;
  timeOfDay?: string;
  weather?: string;
  atmosphere?: string;
  visualKeywords?: string[];
};

export type BackgroundWorldIndex = {
  schema: typeof BACKGROUND_WORLD_INDEX_SCHEMA;
  worldId: string;
  activeAssetId: string | null;
  assetIds: string[];
  sceneBindings: Record<string, string>;
  updatedAt: string | null;
};

const catalog = rawCatalog as BackgroundCatalog;

if (catalog.schema !== BACKGROUND_CATALOG_SCHEMA) {
  throw new Error(`Unsupported background catalog schema: ${String(catalog.schema)}`);
}

export const bundledBackgroundCatalog: BackgroundCatalog = catalog;

const semanticAliases: Array<[RegExp, string[]]> = [
  [/共享|房间|客厅|公寓|room|home|apartment|living/, ["公寓", "客厅", "房间", "共享空间", "apartment", "living-room", "interior"]],
  [/学校|教室|走廊|school|classroom|corridor/, ["学校", "教室", "走廊", "school", "classroom", "corridor", "interior"]],
  [/海边|海岸|沙滩|seaside|coast|beach/, ["海边", "海岸", "沙滩", "seaside", "coast", "beach", "outdoor"]],
  [/城市|车站|站台|铁路|city|station|rail/, ["城市", "夜晚", "city", "night", "skyline"]],
  [/咖啡|会面|coffee|cafe/, ["咖啡店", "会面", "coffee", "cafe", "conversation"]],
  [/森林|树林|forest|pine|birch/, ["森林", "松林", "白桦林", "forest", "pine", "birch", "outdoor"]],
  [/农田|乡村|田野|丘陵|farm|field|country|hill/, ["农田", "乡村", "田野", "丘陵", "farmland", "field", "countryside", "rolling-hills"]],
  [/山|悬崖|mountain|cliff/, ["山峰", "悬崖", "mountain", "cliff", "outdoor"]],
  [/城堡|中世纪|castle|medieval/, ["城堡", "中世纪", "castle", "medieval", "fantasy"]],
  [/飞船|太空|舰桥|spaceship|space|bridge/, ["太空", "飞船", "舰桥", "spaceship", "bridge", "scifi"]],
  [/海底|珊瑚|水下|underwater|coral|ocean/, ["海底", "珊瑚礁", "海洋", "underwater", "coral", "ocean"]],
  [/风暴|暴雨|雷雨|storm|thunder/, ["风暴", "云层", "storm", "clouds", "dramatic"]],
  [/日落|黄昏|sunset|dusk/, ["日落", "黄昏", "sunset", "dusk"]],
  [/夜晚|夜间|night/, ["夜晚", "night"]],
  [/像素|pixel/, ["像素", "pixel"]],
];

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function descriptorText(scene: BackgroundSceneDescriptor) {
  return [scene.location, scene.timeOfDay, scene.weather, scene.atmosphere, ...(scene.visualKeywords || [])]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function resolveBackgroundFromCatalog(assets: BackgroundAssetRecord[], scene: BackgroundSceneDescriptor) {
  const text = descriptorText(scene);
  const desiredTags = new Set<string>();
  for (const [pattern, tags] of semanticAliases) {
    if (pattern.test(text)) tags.forEach((tag) => desiredTags.add(tag.toLowerCase()));
  }
  for (const keyword of scene.visualKeywords || []) desiredTags.add(cleanText(keyword).toLowerCase());

  const ranked = assets
    .filter((asset) => asset.status === "ready")
    .map((asset) => {
      const searchable = `${asset.title} ${asset.description} ${asset.tags.join(" ")}`.toLowerCase();
      const matches = [...desiredTags].filter((tag) => tag && searchable.includes(tag));
      let score = matches.length * 12;
      if (text.includes(asset.title.toLowerCase())) score += 40;
      if (/共享|房间|room/.test(text) && asset.id === "bg-apartment-living-room") score += 18;
      if (/车站|站台|station/.test(text) && asset.id === "bg-city-night-skyline-cyberpunk") score += 8;
      return { asset, score, matchedTags: matches };
    })
    .sort((left, right) => right.score - left.score || left.asset.id.localeCompare(right.asset.id));

  const best = ranked[0];
  return best && best.score >= 12 ? best : null;
}

export function resolveBundledBackground(scene: BackgroundSceneDescriptor) {
  return resolveBackgroundFromCatalog(bundledBackgroundCatalog.assets, scene);
}

const slugAliases: Array<[RegExp, string]> = [
  [/公寓|客厅|房间|共享空间/i, "shared-room"],
  [/学校|教室/i, "school-classroom"],
  [/走廊/i, "corridor"],
  [/海边|海岸|沙滩/i, "seaside"],
  [/车站|站台|铁路/i, "station"],
  [/屋顶|天台/i, "rooftop"],
  [/森林|树林/i, "forest"],
  [/城堡/i, "castle"],
  [/城市/i, "city"],
  [/咖啡/i, "coffee-shop"],
  [/太空|飞船|舰桥/i, "spaceship-bridge"],
  [/海底|珊瑚|海洋/i, "underwater-reef"],
  [/夜晚|夜间/i, "night"],
  [/黄昏|日落/i, "dusk"],
  [/白天|日间/i, "day"],
  [/风暴|雷雨|暴雨/i, "storm"],
  [/晴|clear/i, "clear"],
];

function semanticSlug(value: string, fallback: string) {
  const normalized = cleanText(value, 120).toLowerCase();
  const aliased = slugAliases.find(([pattern]) => pattern.test(normalized))?.[1];
  const readable = normalized
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return aliased || readable || fallback;
}

export function buildGeneratedBackgroundFilename(input: {
  worldId: string;
  scene: BackgroundSceneDescriptor;
  createdAt: string;
  shortId: string;
}) {
  const world = semanticSlug(input.worldId.replace(/^world-/, ""), "world");
  const location = semanticSlug(input.scene.location, "scene");
  const time = semanticSlug(input.scene.timeOfDay || "day", "day");
  const weather = semanticSlug(input.scene.weather || "clear", "clear");
  const timestamp = input.createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortId = semanticSlug(input.shortId, "asset").slice(0, 12);
  return `bg_${world}_${location}_${time}_${weather}_${timestamp}_${shortId}.png`.slice(0, 180);
}

export function createBackgroundWorldIndex(worldId: string): BackgroundWorldIndex {
  return {
    schema: BACKGROUND_WORLD_INDEX_SCHEMA,
    worldId,
    activeAssetId: null,
    assetIds: [],
    sceneBindings: {},
    updatedAt: null,
  };
}

export function normalizeBackgroundWorldIndex(raw: Partial<BackgroundWorldIndex> | null | undefined, worldId: string): BackgroundWorldIndex {
  const assetIds = Array.isArray(raw?.assetIds)
    ? [...new Set(raw.assetIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 180))].slice(-80)
    : [];
  const sceneBindings = raw?.sceneBindings && typeof raw.sceneBindings === "object"
    ? Object.fromEntries(Object.entries(raw.sceneBindings).filter(([sceneId, assetId]) => sceneId.length <= 180 && typeof assetId === "string" && assetIds.includes(assetId)))
    : {};
  return {
    schema: BACKGROUND_WORLD_INDEX_SCHEMA,
    worldId,
    activeAssetId: typeof raw?.activeAssetId === "string" && assetIds.includes(raw.activeAssetId) ? raw.activeAssetId : null,
    assetIds,
    sceneBindings,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
  };
}

export function registerWorldBackground(
  current: BackgroundWorldIndex,
  asset: Pick<BackgroundAssetRecord, "id">,
  sceneId: string,
  updatedAt = new Date().toISOString(),
): BackgroundWorldIndex {
  const normalized = normalizeBackgroundWorldIndex(current, current.worldId);
  const assetIds = [...normalized.assetIds.filter((id) => id !== asset.id), asset.id].slice(-80);
  return {
    ...normalized,
    activeAssetId: asset.id,
    assetIds,
    sceneBindings: { ...normalized.sceneBindings, [cleanText(sceneId, 180) || "current-scene"]: asset.id },
    updatedAt,
  };
}
