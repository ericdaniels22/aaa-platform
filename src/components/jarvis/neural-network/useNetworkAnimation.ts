import { useState, useEffect, useRef, useCallback } from "react";

export interface AnimationState {
  state: "idle" | "thinking" | "firing";
  fireStartTime: number | null;
  thinkingStartTime: number | null;
}

export function useNetworkAnimation(
  externalState: "idle" | "thinking" | "firing"
): AnimationState {
  const [animState, setAnimState] = useState<AnimationState>({
    state: "idle",
    fireStartTime: null,
    thinkingStartTime: null,
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

    if (externalState === "firing") {
      const now = performance.now() / 1000;
      setAnimState({
        state: "firing",
        fireStartTime: now,
        thinkingStartTime: null,
      });

      // Auto-revert to idle after 600ms
      fireTimerRef.current = setTimeout(() => {
        setAnimState({
          state: "idle",
          fireStartTime: null,
          thinkingStartTime: null,
        });
      }, 600);
    } else if (externalState === "thinking") {
      const now = performance.now() / 1000;
      setAnimState({
        state: "thinking",
        fireStartTime: null,
        thinkingStartTime: now,
      });
    } else {
      setAnimState({
        state: "idle",
        fireStartTime: null,
        thinkingStartTime: null,
      });
    }

    return clearFireTimer;
  }, [externalState, clearFireTimer]);

  return animState;
}
