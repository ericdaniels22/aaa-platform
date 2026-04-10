"use client";

import { useState, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { AgentNetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";

interface NetworkNodesProps {
  layout: AgentNetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
  isDarkMode: boolean;
  onNodeClick: (agent: AgentConfig) => void;
}

export default function NetworkNodes({
  layout,
  animState,
  reducedMotion,
  isDarkMode,
  onNodeClick,
}: NetworkNodesProps) {
  return (
    <group>
      {layout.nodes.map((node, i) => (
        <AgentNode
          key={node.agent.id}
          node={node}
          index={i}
          animState={animState}
          reducedMotion={reducedMotion}
          isDarkMode={isDarkMode}
          onClick={() => onNodeClick(node.agent)}
        />
      ))}
    </group>
  );
}

function AgentNode({
  node,
  index,
  animState,
  reducedMotion,
  isDarkMode,
  onClick,
}: {
  node: AgentNetworkLayout["nodes"][number];
  index: number;
  animState: AnimationState;
  reducedMotion: boolean;
  isDarkMode: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const isActive = node.agent.status === "active";
  const isHub = index === 0;
  const isRnd = node.agent.id === "rnd";
  const isMarketing = node.agent.id === "marketing";
  const isFieldOps = node.agent.id === "field-ops";
  const isRouted = animState.activeAgent === node.agent.id;
  const baseColor = isRnd
    ? isDarkMode ? "#7C3AED" : "#6D28D9"
    : isMarketing
      ? isDarkMode ? "#0D9488" : "#0F766E"
      : isFieldOps
        ? isDarkMode ? "#EA580C" : "#C2410C"
        : isActive
          ? isDarkMode ? "#0F6E56" : "#0A5A46"
          : isDarkMode ? "#2A4A40" : "#3A5A50";

  useFrame((state) => {
    if (reducedMotion || !materialRef.current || !meshRef.current) return;
    const t = state.clock.elapsedTime;

    let emissive: number;
    let scale: number;

    if (animState.mode === "firing" && animState.fireStartTime !== null) {
      const progress = Math.min((t - animState.fireStartTime) / 0.6, 1.0);
      emissive = isRouted || isHub ? 2.0 - progress * 1.5 : 0.5;
      scale = isRouted || isHub ? 1.2 - progress * 0.2 : 1.0;
    } else if (animState.mode === "thinking" && isRouted) {
      emissive = Math.sin(t * 2.5) * 0.4 + 1.2;
      scale = 1 + Math.sin(t * 1.5) * 0.08;
    } else if (isActive) {
      const speed = isHub ? 0.6 : 0.5;
      emissive = Math.sin(t * speed + index * 0.5) * 0.3 + (isHub ? 0.7 : 0.5);
      scale = 1 + Math.sin(t * 0.3 + index * 0.5) * 0.04;
    } else {
      emissive = Math.sin(t * 0.2 + index) * 0.1 + 0.15;
      scale = 1.0;
    }

    if (hovered) {
      emissive += 0.3;
      scale *= 1.15;
    }
    if (!isDarkMode) emissive += 0.2;

    materialRef.current.emissiveIntensity = emissive;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <group position={node.position}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[node.radius, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          color={baseColor}
          emissive={baseColor}
          emissiveIntensity={reducedMotion ? (isActive ? 0.5 : 0.15) : 0.5}
          transparent
          opacity={isActive ? 0.9 : 0.4}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
      <Html position={[0, node.radius + 0.3, 0]} center distanceFactor={8}>
        <span className={`text-xs font-medium pointer-events-none select-none whitespace-nowrap ${
          isRnd ? "text-violet-400" : isMarketing ? "text-teal-400" : isFieldOps ? "text-orange-400" : isActive ? "text-emerald-400" : "text-teal-700"
        }`}>
          {node.agent.shortName}
        </span>
      </Html>
    </group>
  );
}
