export interface AiRuntimeEnv {
  /** Legacy shared fallback. Prefer the explicit image/text channel URLs below. */
  NEWAPI_BASE_URL?: string;
  NEWAPI_IMAGE_BASE_URL?: string;
  NEWAPI_TEXT_BASE_URL?: string;
  NEWAPI_IMAGE_API_KEY?: string;
  NEWAPI_TEXT_API_KEY?: string;
  NEWAPI_IMAGE_MODEL?: string;
  NEWAPI_TEXT_MODEL?: string;
}

export type AgentChannelConfig = {
  id: "image" | "text";
  label: string;
  apiRoot: string;
  apiKey: string;
  model: string;
  protocol: "chat/completions" | "images/edits";
  fallbackProtocols: readonly string[];
};

export type AgentRuntimeConfig = {
  image: AgentChannelConfig;
  text: AgentChannelConfig;
};

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_TEXT_MODEL = "deepseek-v4-flash";

function value(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

function apiRoot(input: unknown) {
  const baseUrl = value(input, 300)
    .replace(/\/+$/, "")
    .replace(/\/images\/(?:edits|generations)$/i, "");
  return baseUrl ? (baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`) : "";
}

function resolveEnvironment(env?: AiRuntimeEnv): AiRuntimeEnv {
  const nodeEnv = (typeof process !== "undefined" ? process.env : {}) as AiRuntimeEnv;
  return {
    NEWAPI_BASE_URL: env?.NEWAPI_BASE_URL || nodeEnv.NEWAPI_BASE_URL,
    NEWAPI_IMAGE_BASE_URL: env?.NEWAPI_IMAGE_BASE_URL || nodeEnv.NEWAPI_IMAGE_BASE_URL,
    NEWAPI_TEXT_BASE_URL: env?.NEWAPI_TEXT_BASE_URL || nodeEnv.NEWAPI_TEXT_BASE_URL,
    NEWAPI_IMAGE_API_KEY: env?.NEWAPI_IMAGE_API_KEY || nodeEnv.NEWAPI_IMAGE_API_KEY,
    NEWAPI_TEXT_API_KEY: env?.NEWAPI_TEXT_API_KEY || nodeEnv.NEWAPI_TEXT_API_KEY,
    NEWAPI_IMAGE_MODEL: env?.NEWAPI_IMAGE_MODEL || nodeEnv.NEWAPI_IMAGE_MODEL,
    NEWAPI_TEXT_MODEL: env?.NEWAPI_TEXT_MODEL || nodeEnv.NEWAPI_TEXT_MODEL,
  };
}

/** Single source of truth for every model-backed Agent channel. */
export function createAgentRuntimeConfig(env?: AiRuntimeEnv): AgentRuntimeConfig {
  const resolved = resolveEnvironment(env);
  const sharedRoot = apiRoot(resolved.NEWAPI_BASE_URL);
  return {
    image: {
      id: "image",
      label: "Image Agent",
      apiRoot: apiRoot(resolved.NEWAPI_IMAGE_BASE_URL) || sharedRoot,
      apiKey: value(resolved.NEWAPI_IMAGE_API_KEY, 300),
      model: value(resolved.NEWAPI_IMAGE_MODEL, 100) || DEFAULT_IMAGE_MODEL,
      protocol: "images/edits",
      fallbackProtocols: [],
    },
    text: {
      id: "text",
      label: "Character Agents",
      apiRoot: apiRoot(resolved.NEWAPI_TEXT_BASE_URL) || sharedRoot,
      apiKey: value(resolved.NEWAPI_TEXT_API_KEY, 300),
      model: value(resolved.NEWAPI_TEXT_MODEL, 100) || DEFAULT_TEXT_MODEL,
      protocol: "chat/completions",
      fallbackProtocols: ["messages"],
    },
  };
}

export function publicAgentChannelStatus(channel: AgentChannelConfig) {
  return {
    configured: Boolean(channel.apiKey && channel.apiRoot),
    label: channel.label,
    model: channel.model,
    baseUrl: channel.apiRoot,
    protocol: channel.protocol,
    fallbackProtocols: channel.fallbackProtocols,
  };
}

/**
 * DeepSeek V4 enables thinking by default. These Agent calls require the
 * structured result in `message.content`, so letting reasoning consume the
 * bounded output budget can leave content empty and make a healthy channel
 * look unavailable. Keep this provider-specific option centralized so other
 * OpenAI-compatible channels do not receive an unsupported parameter.
 */
export function structuredChatCompletionOptions(channel: AgentChannelConfig, jsonMode = true) {
  if (!/^deepseek-v4-(?:flash|pro)$/i.test(channel.model)) return {};
  return {
    thinking: { type: "disabled" as const },
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  };
}
