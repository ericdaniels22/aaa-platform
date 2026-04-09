"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { NetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";

interface NetworkConnectionsProps {
  layout: NetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
}

export default function NetworkConnections({
  layout,
  animState,
  reducedMotion,
}: NetworkConnectionsProps) {
  const materialRef = useRef<THREE.LineBasicMaterial>(null);

  // Build vertex positions from connections
  const linePositions = useMemo(() => {
    const arr = new Float32Array(layout.connections.length * 6); // 2 vertices × 3 coords per connection
    for (let i = 0; i < layout.connections.length; i++) {
      const { from, to } = layout.connections[i];
      arr[i * 6] = layout.positions[from * 3];
      arr[i * 6 + 1] = layout.positions[from * 3 + 1];
      arr[i * 6 + 2] = layout.positions[from * 3 + 2];
      arr[i * 6 + 3] = layout.positions[to * 3];
      arr[i * 6 + 4] = layout.positions[to * 3 + 1];
      arr[i * 6 + 5] = layout.positions[to * 3 + 2];
    }
    return arr;
  }, [layout]);

  // Animate opacity
  useFrame((state) => {
    if (reducedMotion || !materialRef.current) return;

    const t = state.clock.elapsedTime;

    if (animState.state === "firing" && animState.fireStartTime !== null) {
      const progress = Math.min((t - animState.fireStartTime) / 0.6, 1.0);
      materialRef.current.opacity = 0.4 - progress * 0.25; // 0.4 → 0.15
    } else if (animState.state === "thinking") {
      materialRef.current.opacity = 0.25;
    } else {
      materialRef.current.opacity = 0.15;
    }
  });

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[linePositions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial
        ref={materialRef}
        color="#0F6E56"
        transparent
        opacity={reducedMotion ? 0.2 : 0.15}
        depthWrite={false}
      />
    </lineSegments>
  );
}
