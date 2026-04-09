import { useState, useEffect, useRef, useCallback } from "react";

export interface BrainState {
  mode: "idle" | "thinking" | "firing";
  activeAgent?: string;
}

export interface AnimationState {
  mode: "idle" | "thinking" | "firing";
  activeAgent?: string;
  fireStartTime: number | null;
}

export function useNetworkAnimation(brainState: BrainState): AnimationState {
  const [animState, setAnimState] = useState<AnimationState>({
    mode: "idle",
    activeAgent: undefined,
    fireStartTime: null,
  });

  const fireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFireTimer = useCallback(() => {
    if (fireTimerRef.current) {
      clearTimeout(fireTimerRef.current);
      fireTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearFireTimer();

    if (brainState.mode === "firing") {
      const now = performance.now() / 1000;
      setAnimState({
        mode: "firing",
        activeAgent: brainState.activeAgent,
        fireStartTime: now,
      });
      fireTimerRef.current = setTimeout(() => {
        setAnimState((prev) => ({
          ...prev,
          mode: "idle",
          fireStartTime: null,
        }));
      }, 600);
    } else if (brainState.mode === "thinking") {
      setAnimState({
        mode: "thinking",
        activeAgent: brainState.activeAgent,
        fireStartTime: null,
      });
    } else {
      setAnimState({
        mode: "idle",
        activeAgent: undefined,
        fireStartTime: null,
      });
    }

    return clearFireTimer;
  }, [brainState.mode, brainState.activeAgent, clearFireTimer]);

  return animState;
}
