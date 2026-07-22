import type { GameState } from "@/lib/agent-engine";

declare global {
  interface Window {
    cpDanceDesktop?: {
      getInitialState(): Promise<GameState | null>;
      getBridgeState(): Promise<{ state: GameState | null; active: boolean; revision: number; sourceOrigin: string | null } | null>;
      dispatchAction(action: unknown): Promise<{ id: string }>;
      setMousePassthrough(passthrough: boolean): void;
      requestStop(): Promise<void>;
    };
  }
}

export {};
