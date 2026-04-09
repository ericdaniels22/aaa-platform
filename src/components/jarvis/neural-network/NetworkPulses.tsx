"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { NetworkLayout } from "./useNetworkLayout";
import type { AnimationState } from "./useNetworkAnimation";

interface NetworkPulsesProps {
  layout: NetworkLayout;
  animState: AnimationState;
  reducedMotion: boolean;
}

interface Pulse {
  connectionIndex: number;
  progress: number;
  speed: number;
  active: boolean;
}

const MAX_PULSES = 15;

// Simple seeded random for pulse initialization
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function NetworkPulses({
  layout,
  animState,
  reducedMotion,
}: NetworkPulsesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lastSpawnRef = useRef(0);
  const hasFiredRef = useRef(false);

  // Pulse pool — initialize eagerly with seeded random
  const pulsesRef = useRef<Pulse[]>(
    (() => {
      const rand = mulberry32(99);
      return Array.from({ length: MAX_PULSES }, () => ({
        connectionIndex: Math.floor(rand() * Math.max(1, layout.connections.length)),
        progress: rand(),
        speed: 1.5 + rand() * 1.5,
        active: false,
      }));
    })()
  );

  // Don't render at all for reduced motion
  if (reducedMotion) return null;

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
      />
    </instancedMesh>
  );
}

// Separate component for useFrame (must be inside Canvas tree)
function PulseAnimator({
  meshRef,
  dummy,
  pulsesRef,
  lastSpawnRef,
  hasFiredRef,
  layout,
  animState,
}: {
  meshRef: React.RefObject<THREE.InstancedMesh | null>;
  dummy: THREE.Object3D;
  pulsesRef: React.RefObject<Pulse[]>;
  lastSpawnRef: React.RefObject<number>;
  hasFiredRef: React.RefObject<boolean>;
  layout: NetworkLayout;
  animState: AnimationState;
}) {
  useFrame((state, delta) => {
    if (!meshRef.current || !pulsesRef.current) return;

    const t = state.clock.elapsedTime;
    const pulses = pulsesRef.current;
    const conns = layout.connections;
    if (conns.length === 0) return;

    // Spawn logic
    const spawnInterval =
      animState.state === "thinking" ? 0.3 : animState.state === "firing" ? 0.05 : 2.0;

    // Firing burst: spawn 8-10 pulses immediately
    if (animState.state === "firing" && !hasFiredRef.current) {
      hasFiredRef.current = true;
      let spawned = 0;
      for (let i = 0; i < pulses.length && spawned < 10; i++) {
        if (!pulses[i].active) {
          pulses[i].active = true;
          pulses[i].connectionIndex = Math.floor(Math.random() * conns.length);
          pulses[i].progress = 0;
          pulses[i].speed = 1.5 + Math.random() * 1.5;
          spawned++;
        }
      }
      lastSpawnRef.current = t;
    }

    if (animState.state !== "firing") {
      hasFiredRef.current = false;
    }

    // Regular spawning
    if (t - lastSpawnRef.current > spawnInterval) {
      for (let i = 0; i < pulses.length; i++) {
        if (!pulses[i].active) {
          pulses[i].active = true;
          pulses[i].connectionIndex = Math.floor(Math.random() * conns.length);
          pulses[i].progress = 0;
          pulses[i].speed = 1.5 + Math.random() * 1.5;
          lastSpawnRef.current = t;
          break;
        }
      }
    }

    // Move and position pulses
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
        if (!conn) {
          pulse.active = false;
          continue;
        }

        // Lerp position
        const fx = layout.positions[conn.from * 3];
        const fy = layout.positions[conn.from * 3 + 1];
        const fz = layout.positions[conn.from * 3 + 2];
        const tx = layout.positions[conn.to * 3];
        const ty = layout.positions[conn.to * 3 + 1];
        const tz = layout.positions[conn.to * 3 + 2];
        const p = pulse.progress;

        dummy.position.set(
          fx + (tx - fx) * p,
          fy + (ty - fy) * p,
          fz + (tz - fz) * p
        );
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      } else {
        // Hide inactive pulses
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
