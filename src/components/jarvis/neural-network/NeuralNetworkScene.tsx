"use client";

import { useState, useEffect, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import * as THREE from "three";
import { useNetworkLayout } from "./useNetworkLayout";
import { useNetworkAnimation, type BrainState } from "./useNetworkAnimation";
import NetworkNodes from "./NetworkNodes";
import NetworkConnections from "./NetworkConnections";
import NetworkPulses from "./NetworkPulses";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";

function AutoRotateGroup({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (enabled && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.15;
    }
  });
  return <group ref={groupRef}>{children}</group>;
}

function Cleanup() {
  const { gl } = useThree();
  useEffect(() => {
    return () => { gl.dispose(); gl.forceContextLoss(); };
  }, [gl]);
  return null;
}

interface NeuralNetworkSceneProps {
  brainState: BrainState;
  reducedMotion: boolean;
  onNodeClick: (agent: AgentConfig) => void;
  onCreated?: (gl: THREE.WebGLRenderer) => void;
}

export default function NeuralNetworkScene({
  brainState,
  reducedMotion,
  onNodeClick,
  onCreated,
}: NeuralNetworkSceneProps) {
  const layout = useNetworkLayout();
  const animState = useNetworkAnimation(brainState);

  const [isDarkMode, setIsDarkMode] = useState(true);
  useEffect(() => {
    const checkDark = () => setIsDarkMode(document.documentElement.classList.contains("dark"));
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 50 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
      onCreated={({ gl }) => onCreated?.(gl)}
    >
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.5} />
      <pointLight position={[-5, -5, 5]} intensity={0.3} />
      <AutoRotateGroup enabled={!reducedMotion}>
        <NetworkNodes layout={layout} animState={animState} reducedMotion={reducedMotion} isDarkMode={isDarkMode} onNodeClick={onNodeClick} />
        <NetworkConnections layout={layout} animState={animState} reducedMotion={reducedMotion} />
        {!reducedMotion && <NetworkPulses layout={layout} animState={animState} reducedMotion={reducedMotion} />}
      </AutoRotateGroup>
      <TrackballControls noZoom noPan rotateSpeed={1.5} dynamicDampingFactor={0.15} />
      <Cleanup />
    </Canvas>
  );
}
