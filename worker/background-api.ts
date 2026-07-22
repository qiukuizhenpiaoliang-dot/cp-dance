import {
  createCpDanceBackgroundAssetsIndex,
  createCpDanceBackgroundAssetsTable,
  createCpDanceWorldBackgroundAssetsIndex,
  createCpDanceWorldBackgroundAssetsTable,
} from "../db/schema";
import {
  BACKGROUND_CATALOG_SCHEMA,
  BACKGROUND_WORLD_INDEX_SCHEMA,
  buildGeneratedBackgroundFilename,
  bundledBackgroundCatalog,
  resolveBackgroundFromCatalog,
  type BackgroundAssetRecord,
  type BackgroundSceneDescriptor,
} from "../lib/background-assets";
import { createAgentRuntimeConfig, type AiRuntimeEnv } from "./agent-config";
import { ownerForRequest, type SaveRuntimeEnv } from "./save-api";

type BackgroundRuntimeEnv = AiRuntimeEnv & SaveRuntimeEnv;

type GeneratedBackgroundRow = {
  asset_id: string;
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  title: string;
  description: string;
  tags_json: string;
  license: string;
  model: string | null;
  created_at: string;
  object_key: string;
};

type WorldBackgroundRow = {
  asset_id: string;
  source_type: BackgroundAssetRecord["sourceType"];
  scene_id: string;
  last_used_at: string;
};

const BACKGROUND_RESULT_SCHEMA = "cp-dance/background-agent-result/v1" as const;
const GENERATED_ASSET_PATH = /^\/api\/background-assets\/(bg-generated-[a-f0-9]{20})$/;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/;

function jsonResponse(body: unknown, status = 200, sessionCookie?: string) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (sessionCookie) headers.set("set-cookie", sessionCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

async function parseJson(request: Request, maxBytes = 32_000) {
  const body = await request.text();
  if (body.length > maxBytes) throw new Error("背景 Agent 请求体过大");
  const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("背景 Agent 请求格式无效");
  return parsed;
}

function normalizeScene(raw: unknown): BackgroundSceneDescriptor {
  const scene = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const location = text(scene.location, 180);
  if (!location) throw new Error("背景 Agent 需要明确的场景地点");
  return {
    sceneId: text(scene.sceneId, 180) || undefined,
    location,
    timeOfDay: text(scene.timeOfDay, 80) || undefined,
    weather: text(scene.weather, 80) || undefined,
    atmosphere: text(scene.atmosphere, 240) || undefined,
    visualKeywords: Array.isArray(scene.visualKeywords)
      ? scene.visualKeywords.map((item) => text(item, 80)).filter(Boolean).slice(0, 12)
      : [],
  };
}

async function ensureBackgroundSchema(env: BackgroundRuntimeEnv) {
  if (!env.DB) return false;
  await env.DB.batch([
    env.DB.prepare(createCpDanceBackgroundAssetsTable),
    env.DB.prepare(createCpDanceBackgroundAssetsIndex),
    env.DB.prepare(createCpDanceWorldBackgroundAssetsTable),
    env.DB.prepare(createCpDanceWorldBackgroundAssetsIndex),
  ]);
  return true;
}

function safeTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 80)).filter(Boolean).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function generatedRowToAsset(row: GeneratedBackgroundRow): BackgroundAssetRecord {
  const mediaType = row.mime_type === "image/jpeg" || row.mime_type === "image/webp" ? row.mime_type : "image/png";
  return {
    id: row.asset_id,
    filename: row.filename,
    url: `/api/background-assets/${row.asset_id}`,
    sourceType: "generated",
    mediaType,
    width: Number(row.width) || 1536,
    height: Number(row.height) || 1024,
    title: row.title,
    description: row.description,
    tags: safeTags(row.tags_json),
    license: row.license,
    status: "ready",
    createdAt: row.created_at,
    generatedBy: "background-asset-agent",
    model: row.model || undefined,
  };
}

async function listGeneratedAssets(env: BackgroundRuntimeEnv, ownerId: string) {
  if (!env.DB) return [];
  const result = await env.DB.prepare(`
    SELECT asset_id, filename, mime_type, width, height, title, description, tags_json, license, model, created_at, object_key
    FROM cp_dance_background_assets
    WHERE owner_id = ?
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(ownerId).all<GeneratedBackgroundRow>();
  return (result.results || []).map(generatedRowToAsset);
}

async function readWorldIndex(env: BackgroundRuntimeEnv, ownerId: string, worldId: string) {
  if (!env.DB || !worldId) {
    return { schema: BACKGROUND_WORLD_INDEX_SCHEMA, worldId, activeAssetId: null, assetIds: [], sceneBindings: {}, updatedAt: null };
  }
  const result = await env.DB.prepare(`
    SELECT asset_id, source_type, scene_id, last_used_at
    FROM cp_dance_world_background_assets
    WHERE owner_id = ? AND world_id = ?
    ORDER BY last_used_at DESC
    LIMIT 80
  `).bind(ownerId, worldId).all<WorldBackgroundRow>();
  const rows = result.results || [];
  return {
    schema: BACKGROUND_WORLD_INDEX_SCHEMA,
    worldId,
    activeAssetId: rows[0]?.asset_id || null,
    assetIds: rows.map((row) => row.asset_id),
    sceneBindings: Object.fromEntries(rows.map((row) => [row.scene_id, row.asset_id])),
    updatedAt: rows[0]?.last_used_at || null,
  };
}

async function registerWorldUse(
  env: BackgroundRuntimeEnv,
  ownerId: string,
  worldId: string,
  sceneId: string,
  asset: BackgroundAssetRecord,
  usedAt: string,
) {
  if (!env.DB) return false;
  await env.DB.prepare(`
    INSERT INTO cp_dance_world_background_assets (owner_id, world_id, asset_id, source_type, scene_id, first_used_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, world_id, asset_id) DO UPDATE SET
      source_type = excluded.source_type,
      scene_id = excluded.scene_id,
      last_used_at = excluded.last_used_at
  `).bind(ownerId, worldId, asset.id, asset.sourceType, sceneId, usedAt, usedAt).run();
  return true;
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Bytes(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function imageCandidate(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const embedded = trimmed.match(/data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+/)?.[0];
    if (embedded) return embedded;
    if (trimmed.length > 256 && /^[a-zA-Z0-9+/=]+$/.test(trimmed)) return `data:image/png;base64,${trimmed}`;
    if (/^https?:\/\//.test(trimmed)) return trimmed;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = imageCandidate(item, depth + 1);
      if (candidate) return candidate;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["b64_json", "base64", "image_base64", "result", "image_url", "url", "data", "images", "output", "image"]) {
      const candidate = imageCandidate(record[key], depth + 1);
      if (candidate) return candidate;
    }
  }
  return "";
}

async function callBackgroundImageModel(env: BackgroundRuntimeEnv, scene: BackgroundSceneDescriptor) {
  const config = createAgentRuntimeConfig(env).image;
  if (!config.apiRoot || !config.apiKey) throw new Error("背景生成 Agent 尚未配置图像 API 地址与密钥");
  const prompt = [
    "Create one production-ready 16:9 environment background for a 2D pixel-character social simulation.",
    `Location: ${scene.location}. Time: ${scene.timeOfDay || "day"}. Weather: ${scene.weather || "clear"}. Atmosphere: ${scene.atmosphere || "natural"}.`,
    `Visual keywords: ${(scene.visualKeywords || []).join(", ") || "readable environment"}.`,
    "Background environment only: no people, characters, text, logos, UI, frames, sprite sheets, or watermarks.",
    "Use a fixed eye-level camera, preserve a clear walkable foreground and middle-stage area, and keep important landmarks away from the character standing zone.",
    "Output a cohesive 1536x1024 PNG-compatible image.",
  ].join("\n");
  const response = await fetchWithTimeout(`${config.apiRoot}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, prompt, size: "1536x1024", response_format: "b64_json" }),
  }, 180_000);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`背景生成 Agent 上游请求失败（${response.status}）`);
  const candidate = imageCandidate(payload);
  if (!candidate) throw new Error("背景生成 Agent 返回格式无法识别");
  if (candidate.startsWith("data:image/")) return { dataUrl: candidate, model: config.model };
  const imageResponse = await fetchWithTimeout(candidate, { method: "GET" }, 30_000);
  const mimeType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";
  if (!imageResponse.ok || !/^image\/(?:png|jpeg|webp)$/.test(mimeType)) throw new Error("背景生成 Agent 返回的资源不是可用图片");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { dataUrl: `data:${mimeType};base64,${btoa(binary)}`, model: config.model };
}

async function generateAndStoreBackground(
  env: BackgroundRuntimeEnv,
  ownerId: string,
  worldId: string,
  scene: BackgroundSceneDescriptor,
) {
  if (!env.DB || !env.SAVE_ASSETS) throw new Error("背景资产存储尚未配置 D1/R2");
  const generated = await callBackgroundImageModel(env, scene);
  const match = DATA_URL.exec(generated.dataUrl);
  if (!match) throw new Error("背景生成 Agent 没有返回 PNG、JPG 或 WebP");
  const bytes = decodeBase64(match[2]);
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("单个背景图片不能超过 12 MB");
  const fullHash = await sha256Bytes(bytes);
  const assetId = `bg-generated-${fullHash.slice(0, 20)}`;
  const createdAt = new Date().toISOString();
  const filename = buildGeneratedBackgroundFilename({ worldId, scene, createdAt, shortId: fullHash.slice(0, 10) });
  const objectKey = `cp-dance/${ownerId}/backgrounds/${assetId}/${filename}`;
  const tags = [scene.location, scene.timeOfDay, scene.weather, scene.atmosphere, ...(scene.visualKeywords || [])].map((item) => text(item, 80)).filter(Boolean);
  const asset: BackgroundAssetRecord = {
    id: assetId,
    filename,
    url: `/api/background-assets/${assetId}`,
    sourceType: "generated",
    mediaType: match[1] === "image/jpeg" || match[1] === "image/webp" ? match[1] : "image/png",
    width: 1536,
    height: 1024,
    title: `${scene.location} · ${scene.timeOfDay || "day"}`.slice(0, 180),
    description: [scene.atmosphere, scene.weather, ...(scene.visualKeywords || [])].filter(Boolean).join(" · ").slice(0, 500),
    tags,
    license: "generated-for-owner",
    status: "ready",
    createdAt,
    generatedBy: "background-asset-agent",
    model: generated.model,
  };
  await env.SAVE_ASSETS.put(objectKey, bytes, {
    httpMetadata: { contentType: asset.mediaType, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { ownerId, assetId, filename, worldId, generatedBy: "background-asset-agent", createdAt },
  });
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO cp_dance_background_assets (owner_id, asset_id, filename, object_key, mime_type, byte_size, width, height, title, description, tags_json, license, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, asset_id) DO UPDATE SET
        filename = excluded.filename,
        object_key = excluded.object_key,
        title = excluded.title,
        description = excluded.description,
        tags_json = excluded.tags_json,
        model = excluded.model
    `).bind(ownerId, asset.id, asset.filename, objectKey, asset.mediaType, bytes.byteLength, asset.width, asset.height, asset.title, asset.description, JSON.stringify(asset.tags), asset.license, asset.model, createdAt),
    env.DB.prepare(`
      INSERT INTO cp_dance_world_background_assets (owner_id, world_id, asset_id, source_type, scene_id, first_used_at, last_used_at)
      VALUES (?, ?, ?, 'generated', ?, ?, ?)
      ON CONFLICT(owner_id, world_id, asset_id) DO UPDATE SET
        scene_id = excluded.scene_id,
        last_used_at = excluded.last_used_at
    `).bind(ownerId, worldId, asset.id, scene.sceneId || "current-scene", createdAt, createdAt),
  ]);
  return asset;
}

export async function handleBackgroundApi(request: Request, env: BackgroundRuntimeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const generatedAssetMatch = GENERATED_ASSET_PATH.exec(url.pathname);
  const isCatalogRoute = url.pathname === "/api/background-assets";
  const isAgentRoute = url.pathname === "/api/ai/background" || url.pathname === "/api/ai/background/status";
  if (!generatedAssetMatch && !isCatalogRoute && !isAgentRoute) return null;

  const { ownerId, sessionCookie } = await ownerForRequest(request);
  try {
    const storageReady = await ensureBackgroundSchema(env);

    if (generatedAssetMatch && request.method === "GET") {
      if (!env.DB || !env.SAVE_ASSETS) return jsonResponse({ error: "背景资产存储尚未配置" }, 503, sessionCookie);
      const row = await env.DB.prepare(`
        SELECT object_key, mime_type FROM cp_dance_background_assets WHERE owner_id = ? AND asset_id = ?
      `).bind(ownerId, generatedAssetMatch[1]).first<{ object_key: string; mime_type: string }>();
      if (!row) return jsonResponse({ error: "背景资产不存在" }, 404, sessionCookie);
      const object = await env.SAVE_ASSETS.get(row.object_key);
      if (!object) return jsonResponse({ error: "背景资产文件不存在" }, 404, sessionCookie);
      return new Response(object.body, { status: 200, headers: { "content-type": row.mime_type, "cache-control": "private, max-age=31536000, immutable" } });
    }

    if ((url.pathname === "/api/ai/background/status" || (url.pathname === "/api/ai/background" && request.method === "GET"))) {
      const image = createAgentRuntimeConfig(env).image;
      return jsonResponse({
        agent: "Background Asset Agent",
        callable: true,
        imageGenerationConfigured: Boolean(image.apiRoot && image.apiKey),
        storageConfigured: storageReady && Boolean(env.SAVE_ASSETS),
        bundledAssetCount: bundledBackgroundCatalog.assets.length,
        catalogSchema: BACKGROUND_CATALOG_SCHEMA,
        autoGenerationOnMiss: true,
        manualGenerationRequiresExplicitConsent: true,
      }, 200, sessionCookie);
    }

    if (isCatalogRoute && request.method === "GET") {
      const worldId = text(url.searchParams.get("worldId"), 180);
      const generatedAssets = storageReady ? await listGeneratedAssets(env, ownerId) : [];
      return jsonResponse({
        masterIndex: {
          ...bundledBackgroundCatalog,
          revision: bundledBackgroundCatalog.revision + generatedAssets.length,
          updatedAt: generatedAssets[0]?.createdAt || bundledBackgroundCatalog.updatedAt,
          assets: [...bundledBackgroundCatalog.assets, ...generatedAssets],
        },
        worldIndex: await readWorldIndex(env, ownerId, worldId),
        storageConfigured: storageReady && Boolean(env.SAVE_ASSETS),
      }, 200, sessionCookie);
    }

    if (url.pathname === "/api/ai/background" && request.method === "POST") {
      const body = await parseJson(request);
      const worldId = text(body.worldId, 180);
      if (!worldId) return jsonResponse({ error: "背景 Agent 需要 worldId" }, 400, sessionCookie);
      const scene = normalizeScene(body.scene);
      const operation = body.operation === "generate" ? "generate" : "resolve";

      if (operation === "generate") {
        if (body.explicitGenerationConsent !== true || body.requestSource !== "owner-ui") {
          return jsonResponse({ error: "真实背景生成必须由项目所有者在界面中明确确认", code: "background_generation_consent_required" }, 403, sessionCookie);
        }
        const asset = await generateAndStoreBackground(env, ownerId, worldId, scene);
        return jsonResponse({
          schema: BACKGROUND_RESULT_SCHEMA,
          operation,
          status: "generated",
          asset,
          masterIndexUpdated: true,
          worldIndex: await readWorldIndex(env, ownerId, worldId),
        }, 200, sessionCookie);
      }

      const generatedAssets = storageReady ? await listGeneratedAssets(env, ownerId) : [];
      const match = resolveBackgroundFromCatalog([...bundledBackgroundCatalog.assets, ...generatedAssets], scene);
      if (!match) {
        const asset = await generateAndStoreBackground(env, ownerId, worldId, scene);
        return jsonResponse({
          schema: BACKGROUND_RESULT_SCHEMA,
          operation,
          status: "generated",
          asset,
          generationTriggered: true,
          masterIndexUpdated: true,
          worldIndex: await readWorldIndex(env, ownerId, worldId),
        }, 200, sessionCookie);
      }
      const usedAt = new Date().toISOString();
      const worldIndexUpdated = await registerWorldUse(env, ownerId, worldId, scene.sceneId || "current-scene", match.asset, usedAt);
      return jsonResponse({
        schema: BACKGROUND_RESULT_SCHEMA,
        operation,
        status: "reused",
        asset: match.asset,
        matchedTags: match.matchedTags,
        score: match.score,
        generationTriggered: false,
        worldIndexUpdated,
        worldIndex: await readWorldIndex(env, ownerId, worldId),
      }, 200, sessionCookie);
    }

    return jsonResponse({ error: "不支持的背景资产请求方式" }, 405, sessionCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : "背景资产服务暂不可用";
    return jsonResponse({ error: message, code: "background_agent_unavailable" }, 500, sessionCookie);
  }
}
