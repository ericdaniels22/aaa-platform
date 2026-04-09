"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { NetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";

interface NetworkNodesProps {
  layout: NetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
  isDarkMode: boolean;
}

export default function NetworkNodes({
  layout,
  animState,
  reducedMotion,
  isDarkMode,
}: NetworkNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Build a lookup: nodeIndex → layerIndex
  const layerLookup = useMemo(() => {
    const lookup = new Uint8Array(layout.nodeCount);
    for (let li = 0; li < layout.layerIndices.length; li++) {
      for (const ni of layout.layerIndices[li]) {
        lookup[ni] = li;
      }
    }
    return lookup;
  }, [layout]);

  // Set initial positions on mount
  useEffect(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < layout.nodeCount; i++) {
      dummy.position.set(
        layout.positions[i * 3],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2]
      );
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [layout, dummy]);

  // Per-frame animation
  useFrame((state) => {
    if (reducedMotion || !meshRef.current) return;

    const t = state.clock.elapsedTime;
    const material = meshRef.current.material as THREE.MeshStandardMaterial;

    for (let i = 0; i < layout.nodeCount; i++) {
      const li = layerLookup[i];
      let emissiveIntensity: number;
      let scale: number;

      if (animState.state === "firing" && animState.fireStartTime !== null) {
        const progress = Math.min((t - animState.fireStartTime) / 0.6, 1.0);
        emissiveIntensity = 2.0 - progress * 1.5;
        scale = 1.2 - progress * 0.2;
      } else if (animState.state === "thinking") {
        const layerOffset = li * 0.2;
        emissiveIntensity =
          Math.sin(t * 2.0 + i * 0.2 - layerOffset) * 0.4 + 0.8;
        scale = 1 + Math.sin(t * 1.5 + i * 0.3) * 0.1;
      } else {
        // Idle
        emissiveIntensity = Math.sin(t * 0.5 + i * 0.3) * 0.3 + 0.5;
        scale = 1 + Math.sin(t * 0.3 + i * 0.5) * 0.05;
      }

      // Light mode boost
      if (!isDarkMode) {
        emissiveIntensity += 0.2;
      }

      dummy.position.set(
        layout.positions[i * 3],
        layout.positions[i * 3 + 1],
        layout.positions[i * 3 + 2]
      );
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Set emissive intensity on last iteration (applies globally)
      if (i === layout.nodeCount - 1) {
        material.emissiveIntensity = emissiveIntensity;
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  const color = isDarkMode ? "#0F6E56" : "#0A5A46";

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, layout.nodeCount]}>
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={reducedMotion ? 0.5 : 0.5}
        transparent
        opacity={0.85}
        roughness={0.3}
        metalness={0.7}
      />
    </instancedMesh>
  );
}
