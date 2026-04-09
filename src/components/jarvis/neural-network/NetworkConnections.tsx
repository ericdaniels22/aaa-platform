"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import type { AgentNetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";

interface NetworkConnectionsProps {
  layout: AgentNetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
}

export default function NetworkConnections({
  layout,
  animState,
  reducedMotion,
}: NetworkConnectionsProps) {
  return (
    <group>
      {layout.connections.map((conn, i) => (
        <ConnectionLine
          key={i}
          from={layout.nodes[conn.from].position}
          to={layout.nodes[conn.to].position}
          toAgentId={layout.nodes[conn.to].agent.id}
          toAgentStatus={layout.nodes[conn.to].agent.status}
          animState={animState}
          reducedMotion={reducedMotion}
        />
      ))}
    </group>
  );
}

function ConnectionLine({
  from,
  to,
  toAgentId,
  toAgentStatus,
  animState,
  reducedMotion,
}: {
  from: [number, number, number];
  to: [number, number, number];
  toAgentId: string;
  toAgentStatus: string;
  animState: AnimationState;
  reducedMotion: boolean;
}) {
  const lineRef = useRef<any>(null);
  const isActive = toAgentStatus === "active";
  const isRouted = animState.activeAgent === toAgentId;

  useFrame((state) => {
    if (reducedMotion || !lineRef.current?.material) return;
    const t = state.clock.elapsedTime;

    let opacity: number;
    if (animState.mode === "firing" && animState.fireStartTime !== null) {
      const progress = Math.min((t - animState.fireStartTime) / 0.6, 1.0);
      opacity = isRouted ? 0.6 - progress * 0.3 : isActive ? 0.3 : 0.08;
    } else if (animState.mode === "thinking" && isRouted) {
      opacity = 0.6;
    } else {
      opacity = isActive ? 0.3 : 0.08;
    }

    lineRef.current.material.opacity = opacity;
  });

  const staticOpacity = isActive ? 0.3 : 0.08;

  return (
    <Line
      ref={lineRef}
      points={[from, to]}
      color="#0F6E56"
      lineWidth={1}
      transparent
      opacity={reducedMotion ? staticOpacity : staticOpacity}
    />
  );
}
