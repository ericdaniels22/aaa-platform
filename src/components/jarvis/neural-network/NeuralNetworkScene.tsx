"use client";

import { useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useNetworkLayout } from "./useNetworkLayout";
import { useNetworkAnimation } from "./useNetworkAnimation";
import NetworkNodes from "./NetworkNodes";
import NetworkConnections from "./NetworkConnections";
import NetworkPulses from "./NetworkPulses";

// GPU cleanup component — disposes WebGL context on unmount
function Cleanup() {
  const { gl } = useThree();
  useEffect(() => {
    return () => {
      gl.dispose();
      gl.forceContextLoss();
    };
  }, [gl]);
  return null;
}

interface NeuralNetworkSceneProps {
  state: "idle" | "thinking" | "firing";
  reducedMotion: boolean;
  onCreated?: (gl: THREE.WebGLRenderer) => void;
}

export default function NeuralNetworkScene({
  state,
  reducedMotion,
  onCreated,
}: NeuralNetworkSceneProps) {
  const layout = useNetworkLayout();
  const animState = useNetworkAnimation(state);

  // Detect dark mode from Tailwind class
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const checkDark = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
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
      <group>
        <NetworkNodes
          layout={layout}
          animState={animState}
          reducedMotion={reducedMotion}
          isDarkMode={isDarkMode}
        />
        <NetworkConnections
          layout={layout}
          animState={animState}
          reducedMotion={reducedMotion}
        />
        {!reducedMotion && (
          <NetworkPulses
            layout={layout}
            animState={animState}
            reducedMotion={reducedMotion}
          />
        )}
      </group>
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.5}
        maxPolarAngle={Math.PI / 1.5}
        minPolarAngle={Math.PI / 3}
      />
      <Cleanup />
    </Canvas>
  );
}
