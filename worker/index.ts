/** Cloudflare Worker entry point for CP 跳动 / Couple DANCE. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAiApi } from "./ai-api";
import { handleBackgroundApi } from "./background-api";
import type { AiRuntimeEnv } from "./agent-config";
import { handleDirectorApi } from "./director-api";
import { handleResearchApi } from "./research-api";
import { handleSaveApi, type SaveRuntimeEnv } from "./save-api";
import type { RuntimeFetcher } from "./runtime-types";

interface Env extends AiRuntimeEnv, SaveRuntimeEnv {
  ASSETS: RuntimeFetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const runtimeEnv = env || {} as Env;

    const backgroundResponse = await handleBackgroundApi(request, runtimeEnv);
    if (backgroundResponse) return backgroundResponse;

    const directorResponse = await handleDirectorApi(request, runtimeEnv);
    if (directorResponse) return directorResponse;

    const aiResponse = await handleAiApi(request, runtimeEnv);
    if (aiResponse) return aiResponse;

    const researchResponse = await handleResearchApi(request, runtimeEnv);
    if (researchResponse) return researchResponse;

    const saveResponse = await handleSaveApi(request, runtimeEnv);
    if (saveResponse) return saveResponse;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => runtimeEnv.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await runtimeEnv.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, runtimeEnv, ctx);
  },
};

export default worker;
