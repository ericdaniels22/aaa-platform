import { useMemo } from "react";

// --- Types ---

export interface NetworkLayout {
  positions: Float32Array;       // Flat [x,y,z, x,y,z, ...] for all 35 nodes
  connections: { from: number; to: number }[];
  nodeCount: number;
  layerIndices: number[][];      // Which node indices belong to each layer
}

// --- Seeded PRNG (mulberry32) ---

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Layout Generator ---

const SEED = 42;
const LAYER_SIZES = [5, 8, 10, 8, 4]; // 35 total nodes
const LAYER_SPACING = 2.5;
const JITTER = 0.15;

function generateLayout(): NetworkLayout {
  const rand = mulberry32(SEED);
  const nodeCount = LAYER_SIZES.reduce((sum, n) => sum + n, 0);
  const positions = new Float32Array(nodeCount * 3);
  const layerIndices: number[][] = [];
  const connections: { from: number; to: number }[] = [];

  // Center the layers on the X-axis
  const totalWidth = (LAYER_SIZES.length - 1) * LAYER_SPACING;
  const startX = -totalWidth / 2;

  let nodeIndex = 0;

  // Generate node positions
  for (let layerIdx = 0; layerIdx < LAYER_SIZES.length; layerIdx++) {
    const count = LAYER_SIZES[layerIdx];
    const layerX = startX + layerIdx * LAYER_SPACING;
    const radius = count * 0.25;
    const indices: number[] = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = layerX + (rand() - 0.5) * 2 * JITTER;
      const y = Math.cos(angle) * radius + (rand() - 0.5) * 2 * JITTER;
      const z = Math.sin(angle) * radius + (rand() - 0.5) * 2 * JITTER;

      positions[nodeIndex * 3] = x;
      positions[nodeIndex * 3 + 1] = y;
      positions[nodeIndex * 3 + 2] = z;

      indices.push(nodeIndex);
      nodeIndex++;
    }

    layerIndices.push(indices);
  }

  // Generate connections: each node connects to 2-4 nodes in the next layer
  for (let layerIdx = 0; layerIdx < LAYER_SIZES.length - 1; layerIdx++) {
    const currentLayer = layerIndices[layerIdx];
    const nextLayer = layerIndices[layerIdx + 1];

    for (const fromIdx of currentLayer) {
      const connectionCount = 2 + Math.floor(rand() * 3); // 2, 3, or 4
      const shuffled = [...nextLayer].sort(() => rand() - 0.5);
      const targets = shuffled.slice(0, Math.min(connectionCount, nextLayer.length));

      for (const toIdx of targets) {
        connections.push({ from: fromIdx, to: toIdx });
      }

      // ~10% chance of skip connection to layer N+2
      if (layerIdx < LAYER_SIZES.length - 2 && rand() < 0.1) {
        const skipLayer = layerIndices[layerIdx + 2];
        const skipTarget = skipLayer[Math.floor(rand() * skipLayer.length)];
        connections.push({ from: fromIdx, to: skipTarget });
      }
    }
  }

  return { positions, connections, nodeCount, layerIndices };
}

// --- Hook ---

export function useNetworkLayout(): NetworkLayout {
  return useMemo(() => generateLayout(), []);
}
