"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AgentNetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";

interface NetworkPulsesProps {
  layout: AgentNetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
}

interface Pulse {
  connectionIndex: number;
  progress: number;
  speed: number;
  active: boolean;
}

const MAX_PULSES = 6;

export default function NetworkPulses({
  layout,
  animState,
  reducedMotion,
}: NetworkPulsesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastSpawnRef = useRef(0);
  const hasFiredRef = useRef(false);

  const activeConnectionIndices = useMemo(() => {
    return layout.connections
      .map((c, i) => ({ index: i, agent: layout.nodes[c.to].agent }))
      .filter((c) => c.agent.status === "active")
      .map((c) => c.index);
  }, [layout]);

  const pulsesRef = useRef<Pulse[]>(
    Array.from({ length: MAX_PULSES }, () => ({
      connectionIndex: 0,
      progress: 0,
      speed: 2.0,
      active: false,
    }))
  );

  if (reducedMotion || activeConnectionIndices.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PULSES]}>
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshBasicMaterial color="#4AE3C0" transparent opacity={0.9} />
      <PulseAnimator
        meshRef={meshRef}
        dummy={dummy}
        pulsesRef={pulsesRef}
        lastSpawnRef={lastSpawnRef}
        hasFiredRef={hasFiredRef}
        layout={layout}
        animState={animState}
        activeConnectionIndices={activeConnectionIndices}
      />
    </instancedMesh>
  );
}

function PulseAnimator({
  meshRef,
  dummy,
  pulsesRef,
  lastSpawnRef,
  hasFiredRef,
  layout,
  animState,
  activeConnectionIndices,
}: {
  meshRef: React.RefObject<THREE.InstancedMesh | null>;
  dummy: THREE.Object3D;
  pulsesRef: React.RefObject<Pulse[]>;
  lastSpawnRef: React.RefObject<number>;
  hasFiredRef: React.RefObject<boolean>;
  layout: AgentNetworkLayout;
  animState: AnimationState;
  activeConnectionIndices: number[];
}) {
  useFrame((state, delta) => {
    if (!meshRef.current || !pulsesRef.current) return;
    const t = state.clock.elapsedTime;
    const pulses = pulsesRef.current;
    const conns = layout.connections;

    function pickConnection(): number {
      if (animState.activeAgent && Math.random() < 0.8) {
        const routedIdx = activeConnectionIndices.find(
          (ci) => layout.nodes[conns[ci].to].agent.id === animState.activeAgent
        );
        if (routedIdx !== undefined) return routedIdx;
      }
      return activeConnectionIndices[
        Math.floor(Math.random() * activeConnectionIndices.length)
      ];
    }

    if (animState.mode === "firing" && !hasFiredRef.current) {
      hasFiredRef.current = true;
      let spawned = 0;
      for (let i = 0; i < pulses.length && spawned < 4; i++) {
        if (!pulses[i].active) {
          pulses[i].active = true;
          pulses[i].connectionIndex = pickConnection();
          pulses[i].progress = 0;
          pulses[i].speed = 2.0 + Math.random() * 1.5;
          spawned++;
        }
      }
      lastSpawnRef.current = t;
    }
    if (animState.mode !== "firing") hasFiredRef.current = false;

    const spawnInterval =
      animState.mode === "thinking" ? 0.4 : animState.mode === "firing" ? 0.1 : 3.0;

    if (t - lastSpawnRef.current > spawnInterval) {
      for (let i = 0; i < pulses.length; i++) {
        if (!pulses[i].active) {
          pulses[i].active = true;
          pulses[i].connectionIndex = pickConnection();
          pulses[i].progress = 0;
          pulses[i].speed = 1.5 + Math.random() * 1.5;
          lastSpawnRef.current = t;
          break;
        }
      }
    }

    for (let i = 0; i < pulses.length; i++) {
      const pulse = pulses[i];
      if (pulse.active) {
        pulse.progress += pulse.speed * delta;
        if (pulse.progress >= 1.0) {
          pulse.active = false;
          dummy.scale.setScalar(0);
          dummy.position.set(0, 0, 0);
          dummy.updateMatrix();
          meshRef.current.setMatrixAt(i, dummy.matrix);
          continue;
        }
        const conn = conns[pulse.connectionIndex];
        if (!conn) { pulse.active = false; continue; }
        const [fx, fy, fz] = layout.nodes[conn.from].position;
        const [tx, ty, tz] = layout.nodes[conn.to].position;
        const p = pulse.progress;
        dummy.position.set(fx + (tx - fx) * p, fy + (ty - fy) * p, fz + (tz - fz) * p);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.scale.setScalar(0);
        dummy.position.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return null;
}
