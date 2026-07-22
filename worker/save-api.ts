import {
  createCpDanceAssetsTable,
  createCpDanceBackgroundAssetsIndex,
  createCpDanceBackgroundAssetsTable,
  createCpDanceMemoryDocumentsIndex,
  createCpDanceMemoryDocumentsTable,
  createCpDanceMemoryRevisionsTable,
  createCpDanceSaveRevisionsIndex,
  createCpDanceSaveRevisionsTable,
  createCpDanceStoryPublicEventsIndex,
  createCpDanceStoryPublicEventsTable,
  createCpDanceStorySummaryRevisionsIndex,
  createCpDanceStorySummaryRevisionsTable,
  createCpDanceWorldEventsIndex,
  createCpDanceWorldEventsTable,
  createCpDanceWorldBackgroundAssetsIndex,
  createCpDanceWorldBackgroundAssetsTable,
  createPixelkinSavesIndex,
  createPixelkinSavesTable,
} from "../db/schema";
import type { D1DatabaseLike, R2BucketLike } from "./runtime-types";
import { createPortableAgentMemory } from "../lib/character-memory";

export interface SaveRuntimeEnv {
  DB?: D1DatabaseLike;
  SAVE_ASSETS?: R2BucketLike;
}

type SaveKind = "world" | "character";
type SaveRecord = { id: string; updatedAt?: string; [key: string]: unknown };
type SaveIndexRow = { kind: SaveKind; record_id: string; object_key: string };
type StoredAssetRow = { object_key: string; mime_type: string };

const COOKIE_NAME = "cp_dance_session";
const LEGACY_COOKIE_NAME = "pixelkin_session";
const SAVE_LIMITS: Record<SaveKind, number> = { world: 12, character: 30 };
const REVISION_LIMIT = 20;
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/;
const ASSET_PATH = /^\/api\/save-assets\/([a-f0-9]{64})\.(png|jpg|webp)$/;

function jsonResponse(body: unknown, status = 200, sessionCookie?: string) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (sessionCookie) headers.set("set-cookie", sessionCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function parseCookies(request: Request) {
  return new Map((request.headers.get("cookie") || "").split(";").map((part) => {
    const [name, ...value] = part.trim().split("=");
    return [name, value.join("=")] as const;
  }).filter(([name]) => Boolean(name)));
}

async function sha256(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(bytes: Uint8Array) {
  const stableBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(stableBuffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ownerForRequest(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (email) return { ownerId: `user-${await sha256(email)}`, sessionCookie: undefined };

  const cookies = parseCookies(request);
  const current = cookies.get(COOKIE_NAME) || cookies.get(LEGACY_COOKIE_NAME);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  if (current && /^[a-f0-9-]{20,80}$/i.test(current)) {
    const migratedCookie = cookies.has(COOKIE_NAME) ? undefined : `${COOKIE_NAME}=${current}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
    return { ownerId: `guest-${current}`, sessionCookie: migratedCookie };
  }

  const sessionId = crypto.randomUUID();
  return {
    ownerId: `guest-${sessionId}`,
    sessionCookie: `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  };
}

async function ensureSchema(db: D1DatabaseLike) {
  await db.batch([
    db.prepare(createPixelkinSavesTable),
    db.prepare(createPixelkinSavesIndex),
    db.prepare(createCpDanceSaveRevisionsTable),
    db.prepare(createCpDanceSaveRevisionsIndex),
    db.prepare(createCpDanceAssetsTable),
    db.prepare(createCpDanceBackgroundAssetsTable),
    db.prepare(createCpDanceBackgroundAssetsIndex),
    db.prepare(createCpDanceWorldBackgroundAssetsTable),
    db.prepare(createCpDanceWorldBackgroundAssetsIndex),
    db.prepare(createCpDanceMemoryDocumentsTable),
    db.prepare(createCpDanceMemoryDocumentsIndex),
    db.prepare(createCpDanceMemoryRevisionsTable),
    db.prepare(createCpDanceWorldEventsTable),
    db.prepare(createCpDanceWorldEventsIndex),
    db.prepare(createCpDanceStoryPublicEventsTable),
    db.prepare(createCpDanceStoryPublicEventsIndex),
    db.prepare(createCpDanceStorySummaryRevisionsTable),
    db.prepare(createCpDanceStorySummaryRevisionsIndex),
  ]);
}

function isSaveRecord(value: unknown): value is SaveRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<SaveRecord>;
  return typeof record.id === "string" && record.id.length > 0 && record.id.length <= 180;
}

function stripStandaloneCharacterWorldMemory(record: SaveRecord): SaveRecord {
  const agent = objectRecord(record.agent);
  const agentId = typeof agent?.id === "string" ? agent.id : "";
  if (!agent || !agentId) return record;
  const memory = createPortableAgentMemory(agentId);
  const latest = memory.files[0]?.revisions.at(-1)?.summary || "尚无世界记忆";
  return {
    ...record,
    memoryIndex: {
      facts: 0,
      summaries: 0,
      recent: 0,
      unresolvedThreads: 0,
      roleplayCues: 0,
      documents: memory.files.length,
      revisions: memory.files.reduce((total, file) => total + file.revisions.length, 0),
      total: memory.files.reduce((total, file) => total + file.revisions.length, 0),
      latest,
    },
    agent: { ...agent, memory },
  };
}

function revisionObjectKey(ownerId: string, kind: SaveKind, recordId: string, revisionId: string) {
  return `cp-dance/${ownerId}/${kind}/${encodeURIComponent(recordId)}/revisions/${revisionId}.json`;
}

function assetObjectKey(ownerId: string, assetId: string, extension: string) {
  return `cp-dance/${ownerId}/assets/${assetId}.${extension}`;
}

function memoryRevisionObjectKey(ownerId: string, worldId: string, agentId: string, documentId: string, revisionId: string) {
  return `cp-dance/${ownerId}/memory/${encodeURIComponent(worldId)}/${encodeURIComponent(agentId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(revisionId)}.json`;
}

function eventObjectKey(ownerId: string, worldId: string, eventId: string) {
  return `cp-dance/${ownerId}/events/${encodeURIComponent(worldId)}/${encodeURIComponent(eventId)}.json`;
}

function storyPublicEventObjectKey(ownerId: string, worldId: string, eventId: string) {
  return `cp-dance/${ownerId}/story/${encodeURIComponent(worldId)}/public-events/${encodeURIComponent(eventId)}.json`;
}

function storySummaryRevisionObjectKey(ownerId: string, worldId: string, revisionId: string) {
  return `cp-dance/${ownerId}/story/${encodeURIComponent(worldId)}/summary-revisions/${encodeURIComponent(revisionId)}.json`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function putImmutableJson(
  bucket: R2BucketLike,
  key: string,
  value: unknown,
  customMetadata: Record<string, string>,
) {
  if (await bucket.get(key)) return;
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "private, max-age=31536000, immutable" },
    customMetadata,
  });
}

async function syncContextProjection(
  env: Required<Pick<SaveRuntimeEnv, "DB" | "SAVE_ASSETS">>,
  ownerId: string,
  kind: SaveKind,
  storedRecord: SaveRecord,
  updatedAt: string,
) {
  const state = objectRecord(storedRecord.state);
  const worldId = kind === "world"
    ? (typeof state?.worldId === "string" && state.worldId) || storedRecord.id
    : (typeof storedRecord.sourceWorldId === "string" && storedRecord.sourceWorldId) || `character-${storedRecord.id}`;
  // Memory revisions are world-owned. Standalone character archives carry
  // profile/visual data only and must never create a cross-world projection.
  const agents = kind === "world" && Array.isArray(state?.agents) ? state.agents : [];
  const statements = [];

  for (const rawAgent of agents) {
    const agent = objectRecord(rawAgent);
    const agentId = typeof agent?.id === "string" ? agent.id : "";
    const memory = objectRecord(agent?.memory);
    if (!agentId || !Array.isArray(memory?.files)) continue;
    for (const rawFile of memory.files) {
      const file = objectRecord(rawFile);
      const documentId = typeof file?.id === "string" ? file.id : "";
      const path = typeof file?.path === "string" ? file.path : "";
      const fileKind = file?.kind === "general" || file?.kind === "character" || file?.kind === "topic" ? file.kind : null;
      const latestRevisionId = typeof file?.latestRevisionId === "string" ? file.latestRevisionId : "";
      if (!documentId || !path || !fileKind || !latestRevisionId || !Array.isArray(file?.revisions)) continue;
      statements.push(env.DB.prepare(`
        INSERT INTO cp_dance_memory_documents (owner_id, world_id, agent_id, document_id, path, kind, subject_agent_id, latest_revision_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, world_id, agent_id, document_id) DO UPDATE SET
          path = excluded.path,
          kind = excluded.kind,
          subject_agent_id = excluded.subject_agent_id,
          latest_revision_id = excluded.latest_revision_id,
          updated_at = excluded.updated_at
      `).bind(ownerId, worldId, agentId, documentId, path, fileKind, typeof file.subjectAgentId === "string" ? file.subjectAgentId : null, latestRevisionId, updatedAt));
      for (const rawRevision of file.revisions) {
        const revision = objectRecord(rawRevision);
        const revisionId = typeof revision?.id === "string" ? revision.id : "";
        if (!revisionId) continue;
        const key = memoryRevisionObjectKey(ownerId, worldId, agentId, documentId, revisionId);
        await putImmutableJson(env.SAVE_ASSETS, key, {
          schema: "cp-dance/memory-revision-snapshot/v1",
          worldId,
          agentId,
          documentId,
          path,
          revision,
        }, { worldId, agentId, documentId, revisionId });
        statements.push(env.DB.prepare(`
          INSERT INTO cp_dance_memory_revisions (owner_id, world_id, agent_id, document_id, revision_id, base_revision_id, created_turn, epistemic_status, object_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, world_id, agent_id, document_id, revision_id) DO NOTHING
        `).bind(
          ownerId,
          worldId,
          agentId,
          documentId,
          revisionId,
          typeof revision?.baseRevisionId === "string" ? revision.baseRevisionId : null,
          Number.isFinite(revision?.createdTurn) ? Number(revision?.createdTurn) : 0,
          revision?.epistemicStatus === "observed" || revision?.epistemicStatus === "rumor" ? revision.epistemicStatus : "inferred",
          key,
          typeof revision?.createdAt === "string" ? revision.createdAt : updatedAt,
        ));
      }
    }
  }

  if (kind === "world" && Array.isArray(state?.events)) {
    for (const rawEvent of state.events) {
      const event = objectRecord(rawEvent);
      const eventId = typeof event?.id === "string" ? event.id : "";
      if (!eventId) continue;
      const key = eventObjectKey(ownerId, worldId, eventId);
      await putImmutableJson(env.SAVE_ASSETS, key, { schema: "cp-dance/world-event/v1", worldId, event }, { worldId, eventId });
      statements.push(env.DB.prepare(`
        INSERT INTO cp_dance_world_events (owner_id, world_id, event_id, turn, object_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, world_id, event_id) DO NOTHING
      `).bind(ownerId, worldId, eventId, Number.isFinite(event?.day) ? Number(event?.day) : 0, key, updatedAt));
    }
  }

  if (kind === "world" && Array.isArray(state?.storyPublicEvents)) {
    for (const rawEvent of state.storyPublicEvents) {
      const event = objectRecord(rawEvent);
      const eventId = typeof event?.eventId === "string" ? event.eventId : "";
      if (!eventId || event?.schema !== "cp-dance/story-public-event/v1") continue;
      const key = storyPublicEventObjectKey(ownerId, worldId, eventId);
      await putImmutableJson(env.SAVE_ASSETS, key, event, { worldId, eventId, schema: "cp-dance/story-public-event/v1" });
      const source = event.source === "player" || event.source === "character" || event.source === "runtime" ? event.source : "director";
      statements.push(env.DB.prepare(`
        INSERT INTO cp_dance_story_public_events (owner_id, world_id, event_id, turn, scene_id, beat_id, source, object_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, world_id, event_id) DO NOTHING
      `).bind(
        ownerId,
        worldId,
        eventId,
        Number.isFinite(event.turn) ? Number(event.turn) : 0,
        typeof event.sceneId === "string" ? event.sceneId : "",
        typeof event.beatId === "string" ? event.beatId : "",
        source,
        key,
        typeof event.createdAt === "string" ? event.createdAt : updatedAt,
      ));
    }
  }

  if (kind === "world" && Array.isArray(state?.storySummaryRevisions)) {
    for (const rawSummary of state.storySummaryRevisions) {
      const summary = objectRecord(rawSummary);
      const revisionId = typeof summary?.revisionId === "string" ? summary.revisionId : "";
      const summaryId = typeof summary?.summaryId === "string" ? summary.summaryId : "";
      const coveredThroughEventId = typeof summary?.coveredThroughEventId === "string" ? summary.coveredThroughEventId : "";
      if (!revisionId || !summaryId || !coveredThroughEventId || summary?.schema !== "cp-dance/story-context-summary/v1") continue;
      const key = storySummaryRevisionObjectKey(ownerId, worldId, revisionId);
      await putImmutableJson(env.SAVE_ASSETS, key, summary, { worldId, summaryId, revisionId, schema: "cp-dance/story-context-summary/v1" });
      const scope = summary.scope === "scene" || summary.scope === "beat" ? summary.scope : "story";
      statements.push(env.DB.prepare(`
        INSERT INTO cp_dance_story_summary_revisions (owner_id, world_id, summary_id, revision_id, base_revision_id, scope, covered_through_event_id, object_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, world_id, revision_id) DO NOTHING
      `).bind(
        ownerId,
        worldId,
        summaryId,
        revisionId,
        typeof summary.baseRevisionId === "string" ? summary.baseRevisionId : null,
        scope,
        coveredThroughEventId,
        key,
        typeof summary.createdAt === "string" ? summary.createdAt : updatedAt,
      ));
    }
  }

  if (kind === "world") {
    const backgroundIndex = objectRecord(state?.backgroundWorldIndex);
    const backgroundAssetIds = Array.isArray(backgroundIndex?.assetIds)
      ? backgroundIndex.assetIds.filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0 && assetId.length <= 180).slice(-80)
      : [];
    const sceneBindings = objectRecord(backgroundIndex?.sceneBindings) || {};
    const usedAt = typeof backgroundIndex?.updatedAt === "string" ? backgroundIndex.updatedAt : updatedAt;
    for (const assetId of backgroundAssetIds) {
      const sceneId = Object.entries(sceneBindings).find(([, boundAssetId]) => boundAssetId === assetId)?.[0] || "restored-scene";
      const sourceType = assetId.startsWith("bg-generated-") ? "generated" : "bundled";
      statements.push(env.DB.prepare(`
        INSERT INTO cp_dance_world_background_assets (owner_id, world_id, asset_id, source_type, scene_id, first_used_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, world_id, asset_id) DO UPDATE SET
          source_type = excluded.source_type,
          scene_id = excluded.scene_id,
          last_used_at = excluded.last_used_at
      `).bind(ownerId, worldId, assetId, sourceType, sceneId, usedAt, usedAt));
    }
  }

  if (statements.length) await env.DB.batch(statements);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function storeImageAsset(
  env: Required<Pick<SaveRuntimeEnv, "DB" | "SAVE_ASSETS">>,
  ownerId: string,
  dataUrl: string,
  createdAt: string,
  budget: { imageCount: number; byteCount: number },
) {
  const match = IMAGE_DATA_URL.exec(dataUrl);
  if (!match) return dataUrl;
  const mimeType = match[1];
  const bytes = decodeBase64(match[2]);
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error("单个角色图片不能超过 12 MB");
  budget.imageCount += 1;
  budget.byteCount += bytes.byteLength;
  if (budget.imageCount > 32 || budget.byteCount > 16 * 1024 * 1024) throw new Error("单次存档中的图片资源过多或过大");
  const assetId = await sha256Bytes(bytes);
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const key = assetObjectKey(ownerId, assetId, extension);
  await env.SAVE_ASSETS.put(key, bytes, {
    httpMetadata: { contentType: mimeType, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { ownerId, assetId, createdAt },
  });
  await env.DB.prepare(`
    INSERT INTO cp_dance_assets (owner_id, asset_id, object_key, mime_type, byte_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, asset_id) DO UPDATE SET
      object_key = excluded.object_key,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size
  `).bind(ownerId, assetId, key, mimeType, bytes.byteLength, createdAt).run();
  return `/api/save-assets/${assetId}.${extension}`;
}

async function externalizeImageAssets(
  value: unknown,
  env: Required<Pick<SaveRuntimeEnv, "DB" | "SAVE_ASSETS">>,
  ownerId: string,
  createdAt: string,
  budget: { imageCount: number; byteCount: number },
  depth = 0,
): Promise<unknown> {
  if (depth > 48) throw new Error("存档结构嵌套过深");
  if (typeof value === "string") return value.startsWith("data:image/") ? storeImageAsset(env, ownerId, value, createdAt, budget) : value;
  if (Array.isArray(value)) return Promise.all(value.map((item) => externalizeImageAssets(item, env, ownerId, createdAt, budget, depth + 1)));
  if (!value || typeof value !== "object") return value;
  const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await externalizeImageAssets(item, env, ownerId, createdAt, budget, depth + 1)] as const));
  return Object.fromEntries(entries);
}

async function pruneOldSaves(env: Required<Pick<SaveRuntimeEnv, "DB" | "SAVE_ASSETS">>, ownerId: string, kind: SaveKind) {
  const stale = await env.DB.prepare(`
    SELECT record_id, object_key FROM pixelkin_saves
    WHERE owner_id = ? AND kind = ?
    ORDER BY updated_at DESC
    LIMIT -1 OFFSET ?
  `).bind(ownerId, kind, SAVE_LIMITS[kind]).all<{ record_id: string; object_key: string }>();
  const rows = stale.results || [];
  if (!rows.length) return;
  const revisions = await Promise.all(rows.map((row) => env.DB.prepare(`
    SELECT object_key FROM cp_dance_save_revisions
    WHERE owner_id = ? AND kind = ? AND record_id = ?
  `).bind(ownerId, kind, row.record_id).all<{ object_key: string }>()));
  const objectKeys = [...new Set([
    ...rows.map((row) => row.object_key),
    ...revisions.flatMap((result) => (result.results || []).map((row) => row.object_key)),
  ])];
  if (objectKeys.length) await env.SAVE_ASSETS.delete(objectKeys);
  await env.DB.batch(rows.flatMap((row) => [
    env.DB.prepare("DELETE FROM pixelkin_saves WHERE owner_id = ? AND kind = ? AND record_id = ?").bind(ownerId, kind, row.record_id),
    env.DB.prepare("DELETE FROM cp_dance_save_revisions WHERE owner_id = ? AND kind = ? AND record_id = ?").bind(ownerId, kind, row.record_id),
  ]));
}

async function pruneOldRevisions(
  env: Required<Pick<SaveRuntimeEnv, "DB" | "SAVE_ASSETS">>,
  ownerId: string,
  kind: SaveKind,
  recordId: string,
) {
  const stale = await env.DB.prepare(`
    SELECT revision_id, object_key FROM cp_dance_save_revisions
    WHERE owner_id = ? AND kind = ? AND record_id = ?
    ORDER BY updated_at DESC
    LIMIT -1 OFFSET ?
  `).bind(ownerId, kind, recordId, REVISION_LIMIT).all<{ revision_id: string; object_key: string }>();
  const rows = stale.results || [];
  if (!rows.length) return;
  await env.SAVE_ASSETS.delete(rows.map((row) => row.object_key));
  await env.DB.batch(rows.map((row) => env.DB.prepare(`
    DELETE FROM cp_dance_save_revisions
    WHERE owner_id = ? AND kind = ? AND record_id = ? AND revision_id = ?
  `).bind(ownerId, kind, recordId, row.revision_id)));
}

export async function handleSaveApi(request: Request, env: SaveRuntimeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const assetMatch = ASSET_PATH.exec(url.pathname);
  if (url.pathname !== "/api/saves" && !assetMatch) return null;
  if (!env.DB || !env.SAVE_ASSETS) return jsonResponse({ error: "后端存档服务尚未配置" }, 503);

  const storage = { DB: env.DB, SAVE_ASSETS: env.SAVE_ASSETS };
  const { ownerId, sessionCookie } = await ownerForRequest(request);

  try {
    await ensureSchema(storage.DB);

    if (assetMatch) {
      if (request.method !== "GET") return jsonResponse({ error: "不支持的请求方式" }, 405, sessionCookie);
      const row = await storage.DB.prepare(`
        SELECT object_key, mime_type FROM cp_dance_assets
        WHERE owner_id = ? AND asset_id = ?
      `).bind(ownerId, assetMatch[1]).first<StoredAssetRow>();
      if (!row) return jsonResponse({ error: "角色资源不存在" }, 404, sessionCookie);
      const object = await storage.SAVE_ASSETS.get(row.object_key);
      if (!object) return jsonResponse({ error: "角色资源暂时不可用" }, 404, sessionCookie);
      const headers = new Headers({
        "content-type": row.mime_type,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      if (sessionCookie) headers.set("set-cookie", sessionCookie);
      return new Response(object.body, { status: 200, headers });
    }

    if (request.method === "GET") {
      const index = await storage.DB.prepare(`
        SELECT kind, record_id, object_key FROM pixelkin_saves
        WHERE owner_id = ?
        ORDER BY updated_at DESC
      `).bind(ownerId).all<SaveIndexRow>();
      const records = await Promise.all((index.results || []).map(async (row) => {
        const object = await storage.SAVE_ASSETS.get(row.object_key);
        if (!object) return null;
        const record = await object.json().catch(() => null);
        return record ? { kind: row.kind, record } : null;
      }));
      return jsonResponse({
        worlds: records.filter((item) => item?.kind === "world").map((item) => item?.record),
        characters: records.filter((item) => item?.kind === "character").map((item) => item?.record),
      }, 200, sessionCookie);
    }

    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 16 * 1024 * 1024) return jsonResponse({ error: "存档内容过大" }, 413, sessionCookie);
      const body = await request.json().catch(() => null) as { kind?: SaveKind; record?: unknown } | null;
      if (!body || !["world", "character"].includes(body.kind || "") || !isSaveRecord(body.record)) {
        return jsonResponse({ error: "存档格式无效" }, 400, sessionCookie);
      }
      const kind = body.kind as SaveKind;
      const updatedAt = typeof body.record.updatedAt === "string" ? body.record.updatedAt : new Date().toISOString();
      const scopedRecord = kind === "character" ? stripStandaloneCharacterWorldMemory(body.record) : body.record;
      const storedRecord = await externalizeImageAssets(scopedRecord, storage, ownerId, updatedAt, { imageCount: 0, byteCount: 0 }) as SaveRecord;
      const revisionId = `${updatedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${crypto.randomUUID()}`;
      const key = revisionObjectKey(ownerId, kind, body.record.id, revisionId);
      await storage.SAVE_ASSETS.put(key, JSON.stringify(storedRecord), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { kind, updatedAt, revisionId, recordId: body.record.id },
      });
      await storage.DB.batch([
        storage.DB.prepare(`
          INSERT INTO pixelkin_saves (owner_id, kind, record_id, updated_at, object_key)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner_id, kind, record_id) DO UPDATE SET
            updated_at = excluded.updated_at,
            object_key = excluded.object_key
        `).bind(ownerId, kind, body.record.id, updatedAt, key),
        storage.DB.prepare(`
          INSERT INTO cp_dance_save_revisions (owner_id, kind, record_id, revision_id, updated_at, object_key)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(ownerId, kind, body.record.id, revisionId, updatedAt, key),
      ]);
      await syncContextProjection(storage, ownerId, kind, storedRecord, updatedAt);
      await pruneOldRevisions(storage, ownerId, kind, body.record.id);
      await pruneOldSaves(storage, ownerId, kind);
      return jsonResponse({ saved: true, id: body.record.id, revisionId }, 200, sessionCookie);
    }

    return jsonResponse({ error: "不支持的请求方式" }, 405, sessionCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : "后端存档服务暂不可用";
    return jsonResponse({ error: message }, 500, sessionCookie);
  }
}
