# Build 2.10b: Agent Architecture Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decorative 35-node neural network on Jarvis's welcome screen with a meaningful 4-node hub-and-spoke agent map where each node represents a real agent, is clickable to reveal system prompts/tools/config, and highlights in real-time when Jarvis routes to that agent.

**Architecture:** Create an agent registry as single source of truth. Extract system prompts from inline API routes to shared files importable by both API routes and the detail panel. Rewrite the 3D scene from 35 random instancedMesh nodes to 4 individual mesh nodes with click handlers, floating labels via drei `<Html>`, and agent-aware animation. Add a shadcn Sheet for agent details. Thread `routed_to` from the chat API response through to the brain state.

**Tech Stack:** React Three Fiber v9, drei v10 (`<Html>`, `<Line>`), shadcn Sheet + Badge, Three.js, Next.js App Router

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/jarvis/agent-registry.ts` | Single config for all agents — id, name, model, tools, status |
| `src/lib/jarvis/prompts/jarvis-core.ts` | Extracted static Jarvis Core system prompt + dynamic builder |
| `src/lib/jarvis/prompts/rnd.ts` | Extracted static R&D system prompt |

### Modified Files
| File | What Changes |
|------|-------------|
| `src/app/api/jarvis/chat/route.ts` | Import prompt from shared file, add `routed_to` field to response |
| `src/app/api/jarvis/rnd/route.ts` | Import prompt from shared file (delete inline const) |
| `src/lib/jarvis/system-prompt.ts` | Delete file — replaced by `prompts/jarvis-core.ts` |
| `src/components/jarvis/neural-network/useNetworkLayout.ts` | Complete rewrite — hub-and-spoke from registry |
| `src/components/jarvis/neural-network/useNetworkAnimation.ts` | Accept `BrainState` with `activeAgent` |
| `src/components/jarvis/neural-network/NetworkNodes.tsx` | Individual meshes, click handlers, `<Html>` labels |
| `src/components/jarvis/neural-network/NetworkConnections.tsx` | drei `<Line>` with active/planned opacity |
| `src/components/jarvis/neural-network/NetworkPulses.tsx` | Agent-targeted pulses, pool 15→6 |
| `src/components/jarvis/neural-network/NeuralNetworkScene.tsx` | Updated props + wiring for clicks and BrainState |
| `src/components/jarvis/NeuralNetwork3D.tsx` | Updated props — `BrainState`, `onNodeClick` |
| `src/components/jarvis/JarvisWelcome.tsx` | Sheet for agent details, prompt display, BrainState |
| `src/components/jarvis/JarvisChat.tsx` | Read `routed_to`, compute `BrainState`, pass to welcome |

---

## Task 1: Create Agent Registry

**Files:**
- Create: `src/lib/jarvis/agent-registry.ts`

- [ ] **Step 1: Create the registry file**

```typescript
// src/lib/jarvis/agent-registry.ts

export type AgentStatus = "active" | "planned";

export interface AgentConfig {
  id: string;
  name: string;
  shortName: string;
  role: string;
  model: string;
  status: AgentStatus;
  plannedBuild?: string;
  tools?: string[];
  endpoint?: string;
  accessMethod?: string;
  config?: Record<string, unknown>;
  knowledgeSources?: string[];
  promptImportPath?: string;
}

export const AGENT_REGISTRY: AgentConfig[] = [
  {
    id: "jarvis-core",
    name: "Jarvis Core",
    shortName: "Jarvis",
    role: "Orchestrator — routes to specialized departments, handles general conversation",
    model: "Claude Sonnet",
    status: "active",
    tools: [
      "get_job_details",
      "search_jobs",
      "get_business_metrics",
      "log_activity",
      "create_alert",
      "consult_rnd",
    ],
    endpoint: "/api/jarvis/chat",
    promptImportPath: "src/lib/jarvis/prompts/jarvis-core.ts",
  },
  {
    id: "rnd",
    name: "R&D Department",
    shortName: "R&D",
    role: "Platform improvement, technology research, bug diagnosis, build spec generation",
    model: "Claude Opus",
    status: "active",
    tools: [
      "read_project_structure",
      "read_file",
      "check_system_health",
      "check_recent_errors",
      "query_database",
      "web_search",
    ],
    endpoint: "/api/jarvis/rnd",
    accessMethod: "@rnd command or R&D mode toggle",
    config: { max_tokens: 16384, timeout: "120s" },
    promptImportPath: "src/lib/jarvis/prompts/rnd.ts",
  },
  {
    id: "field-ops",
    name: "Field Operations",
    shortName: "Field Ops",
    role: "IICRC standards-backed restoration guidance — water, mold, fire/smoke",
    model: "Claude Sonnet (planned)",
    status: "planned",
    plannedBuild: "Build 2.4",
    knowledgeSources: [
      "S500 Quick Reference",
      "S520 Quick Reference",
      "S700 Reference",
      "Full standards via pgvector RAG",
    ],
  },
  {
    id: "marketing",
    name: "Marketing Department",
    shortName: "Marketing",
    role: "Content creation, SEO, social media, review responses, customer communication",
    model: "TBD",
    status: "planned",
    plannedBuild: "Build 2.6",
  },
];

export function getAgent(id: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getActiveAgents(): AgentConfig[] {
  return AGENT_REGISTRY.filter((a) => a.status === "active");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: No output (clean compile)

- [ ] **Step 3: Commit**

```bash
git add src/lib/jarvis/agent-registry.ts
git commit -m "feat: add agent registry — single source of truth for all Jarvis agents"
```

---

## Task 2: Extract System Prompts to Shared Files

**Files:**
- Create: `src/lib/jarvis/prompts/jarvis-core.ts`
- Create: `src/lib/jarvis/prompts/rnd.ts`
- Modify: `src/app/api/jarvis/chat/route.ts` (import change)
- Modify: `src/app/api/jarvis/rnd/route.ts` (import change, delete inline const)
- Delete: `src/lib/jarvis/system-prompt.ts` (moved to prompts/jarvis-core.ts)

### Step-by-step:

- [ ] **Step 1: Create `src/lib/jarvis/prompts/jarvis-core.ts`**

Copy the entire `buildSystemPrompt` function and its supporting interfaces from `src/lib/jarvis/system-prompt.ts` into this new file. Also export the static template portion as a named constant `JARVIS_CORE_STATIC_PROMPT` for the detail panel.

The static prompt is everything in `buildSystemPrompt` that doesn't depend on the function parameters — the identity, personality, values, tool descriptions, department descriptions, rules. Extract this by reading `src/lib/jarvis/system-prompt.ts` and splitting the prompt string at the first dynamic injection point.

Specifically, the static template is: lines 34-48 (WHO YOU ARE, YOUR ROLE, CURRENT USER placeholder) plus lines 100-123 (TOOLS, DEPARTMENTS, RULES). The dynamic parts are: the user-specific greeting (lines 50-60), the business snapshot (lines 64-78), and the job context (lines 81-97).

The new file must:
1. Export `JARVIS_CORE_STATIC_PROMPT` — the full static template string (for the detail panel to display)
2. Export `buildSystemPrompt()` — the same function signature as before, identical behavior
3. Both read from the same string — DRY

```typescript
// src/lib/jarvis/prompts/jarvis-core.ts

// ... copy the two interface definitions (JobContextData, BusinessSnapshot) from system-prompt.ts ...

export const JARVIS_CORE_STATIC_PROMPT = `You are Jarvis, the AI soul of AAA Disaster Recovery...
// ... the full static identity/personality/tools/departments/rules text ...
`;

export function buildSystemPrompt(params: {
  userName: string;
  userRole: string;
  contextType: "general" | "job";
  jobData?: JobContextData | null;
  businessSnapshot?: BusinessSnapshot | null;
}): string {
  // ... identical logic to current system-prompt.ts, but the static parts reference JARVIS_CORE_STATIC_PROMPT ...
}
```

**CRITICAL:** The `buildSystemPrompt` function must produce byte-for-byte identical output to the current implementation for any given input. Copy the logic exactly. The only change is where the file lives and the addition of the `JARVIS_CORE_STATIC_PROMPT` export.

- [ ] **Step 2: Create `src/lib/jarvis/prompts/rnd.ts`**

Move the `RND_SYSTEM_PROMPT` constant from `src/app/api/jarvis/rnd/route.ts` (lines 13-34) to this new file.

```typescript
// src/lib/jarvis/prompts/rnd.ts

export const RND_SYSTEM_PROMPT = `You are the Research & Development department for AAA Disaster Recovery's business platform.
// ... exact copy of the full prompt from rnd/route.ts lines 13-34 ...
`;
```

- [ ] **Step 3: Update `src/app/api/jarvis/chat/route.ts`**

Change the import from:
```typescript
import { buildSystemPrompt } from "@/lib/jarvis/system-prompt";
```
To:
```typescript
import { buildSystemPrompt } from "@/lib/jarvis/prompts/jarvis-core";
```

No other changes to this file in this task.

- [ ] **Step 4: Update `src/app/api/jarvis/rnd/route.ts`**

Delete the inline `RND_SYSTEM_PROMPT` constant (lines 13-34). Add an import:
```typescript
import { RND_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/rnd";
```

All references to `RND_SYSTEM_PROMPT` in the file stay the same — just the source changes.

- [ ] **Step 5: Delete `src/lib/jarvis/system-prompt.ts`**

This file is now replaced by `src/lib/jarvis/prompts/jarvis-core.ts`.

```bash
git rm src/lib/jarvis/system-prompt.ts
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit && npx next build 2>&1 | tail -5`
Expected: Clean compile and successful build. This is a pure refactor — zero behavior change.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jarvis/prompts/ src/app/api/jarvis/chat/route.ts src/app/api/jarvis/rnd/route.ts
git commit -m "refactor: extract system prompts to shared files for reuse by detail panel"
```

---

## Task 3: Rewrite useNetworkLayout for Hub-and-Spoke

**Files:**
- Modify: `src/components/jarvis/neural-network/useNetworkLayout.ts` (complete rewrite)

- [ ] **Step 1: Rewrite the layout hook**

Replace the entire file. The new layout reads from `AGENT_REGISTRY` and creates a hub-and-spoke topology.

```typescript
// src/components/jarvis/neural-network/useNetworkLayout.ts
import { useMemo } from "react";
import { AGENT_REGISTRY, type AgentConfig } from "@/lib/jarvis/agent-registry";

export interface AgentNode {
  agent: AgentConfig;
  position: [number, number, number];
  radius: number;
}

export interface AgentNetworkLayout {
  nodes: AgentNode[];
  connections: { from: number; to: number }[];
}

const HUB_RADIUS = 0.25;
const SPOKE_RADIUS = 0.15;
const RING_DISTANCE = 3;

function generateLayout(): AgentNetworkLayout {
  const hub = AGENT_REGISTRY.find((a) => a.id === "jarvis-core")!;
  const departments = AGENT_REGISTRY.filter((a) => a.id !== "jarvis-core");

  const nodes: AgentNode[] = [
    { agent: hub, position: [0, 0, 0], radius: HUB_RADIUS },
  ];

  const connections: { from: number; to: number }[] = [];

  departments.forEach((dept, i) => {
    const angle = (i / departments.length) * Math.PI * 2 - Math.PI / 2; // start from top
    const x = Math.cos(angle) * RING_DISTANCE;
    const y = Math.sin(angle) * RING_DISTANCE;
    nodes.push({ agent: dept, position: [x, y, 0], radius: SPOKE_RADIUS });
    connections.push({ from: 0, to: nodes.length - 1 });
  });

  return { nodes, connections };
}

export function useNetworkLayout(): AgentNetworkLayout {
  return useMemo(() => generateLayout(), []);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: Errors in downstream files (NetworkNodes, NetworkConnections, NetworkPulses) that still reference the old `NetworkLayout` type. This is expected — we fix those in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/components/jarvis/neural-network/useNetworkLayout.ts
git commit -m "feat: rewrite network layout to hub-and-spoke agent map from registry"
```

---

## Task 4: Update useNetworkAnimation for BrainState

**Files:**
- Modify: `src/components/jarvis/neural-network/useNetworkAnimation.ts`

- [ ] **Step 1: Rewrite the animation hook**

```typescript
// src/components/jarvis/neural-network/useNetworkAnimation.ts
import { useState, useEffect, useRef, useCallback } from "react";

export interface BrainState {
  mode: "idle" | "thinking" | "firing";
  activeAgent?: string;
}

export interface AnimationState {
  mode: "idle" | "thinking" | "firing";
  activeAgent?: string;
  fireStartTime: number | null;
}

export function useNetworkAnimation(brainState: BrainState): AnimationState {
  const [animState, setAnimState] = useState<AnimationState>({
    mode: "idle",
    activeAgent: undefined,
    fireStartTime: null,
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

    if (brainState.mode === "firing") {
      const now = performance.now() / 1000;
      setAnimState({
        mode: "firing",
        activeAgent: brainState.activeAgent,
        fireStartTime: now,
      });
      fireTimerRef.current = setTimeout(() => {
        setAnimState((prev) => ({
          ...prev,
          mode: "idle",
          fireStartTime: null,
        }));
      }, 600);
    } else if (brainState.mode === "thinking") {
      setAnimState({
        mode: "thinking",
        activeAgent: brainState.activeAgent,
        fireStartTime: null,
      });
    } else {
      setAnimState({
        mode: "idle",
        activeAgent: undefined,
        fireStartTime: null,
      });
    }

    return clearFireTimer;
  }, [brainState.mode, brainState.activeAgent, clearFireTimer]);

  return animState;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jarvis/neural-network/useNetworkAnimation.ts
git commit -m "feat: update animation hook for BrainState with activeAgent tracking"
```

---

## Task 5: Rewrite NetworkNodes with Click Handlers and Labels

**Files:**
- Modify: `src/components/jarvis/neural-network/NetworkNodes.tsx` (complete rewrite)

- [ ] **Step 1: Rewrite NetworkNodes**

Replace the entire file. Individual `<mesh>` elements per node (not instancedMesh). Each gets click handler, hover state, and floating `<Html>` label from drei.

```typescript
// src/components/jarvis/neural-network/NetworkNodes.tsx
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
  const isRouted = animState.activeAgent === node.agent.id;
  const baseColor = isActive
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
          isActive ? "text-teal-400" : "text-teal-700"
        }`}>
          {node.agent.shortName}
        </span>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jarvis/neural-network/NetworkNodes.tsx
git commit -m "feat: rewrite NetworkNodes with individual meshes, click handlers, Html labels"
```

---

## Task 6: Update NetworkConnections for Hub-and-Spoke

**Files:**
- Modify: `src/components/jarvis/neural-network/NetworkConnections.tsx`

- [ ] **Step 1: Rewrite NetworkConnections**

Replace the entire file. Use drei `<Line>` for each connection (only 3 lines, no need for raw bufferGeometry).

```typescript
// src/components/jarvis/neural-network/NetworkConnections.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jarvis/neural-network/NetworkConnections.tsx
git commit -m "feat: update connections to hub-and-spoke with active/planned opacity"
```

---

## Task 7: Update NetworkPulses for Agent-Targeted Pulses

**Files:**
- Modify: `src/components/jarvis/neural-network/NetworkPulses.tsx`

- [ ] **Step 1: Rewrite NetworkPulses**

Replace the entire file. Pool reduced from 15 to 6. Pulses target active connections only, biased toward the routed agent.

```typescript
// src/components/jarvis/neural-network/NetworkPulses.tsx
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

  // Only pulse on connections to active agents
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

    // Pick a connection index biased toward the routed agent
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

    // Firing burst
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

    // Regular spawning
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

    // Move and position
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jarvis/neural-network/NetworkPulses.tsx
git commit -m "feat: agent-targeted pulses biased toward routed agent, pool 15→6"
```

---

## Task 8: Update Scene, Wrapper, Welcome, and Chat

**Files:**
- Modify: `src/components/jarvis/neural-network/NeuralNetworkScene.tsx`
- Modify: `src/components/jarvis/NeuralNetwork3D.tsx`
- Modify: `src/components/jarvis/JarvisWelcome.tsx`
- Modify: `src/components/jarvis/JarvisChat.tsx`

- [ ] **Step 1: Update NeuralNetworkScene.tsx**

Replace the entire file:

```typescript
// src/components/jarvis/neural-network/NeuralNetworkScene.tsx
"use client";

import { useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useNetworkLayout } from "./useNetworkLayout";
import { useNetworkAnimation, type BrainState } from "./useNetworkAnimation";
import NetworkNodes from "./NetworkNodes";
import NetworkConnections from "./NetworkConnections";
import NetworkPulses from "./NetworkPulses";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";

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
      <group>
        <NetworkNodes layout={layout} animState={animState} reducedMotion={reducedMotion} isDarkMode={isDarkMode} onNodeClick={onNodeClick} />
        <NetworkConnections layout={layout} animState={animState} reducedMotion={reducedMotion} />
        {!reducedMotion && <NetworkPulses layout={layout} animState={animState} reducedMotion={reducedMotion} />}
      </group>
      <OrbitControls enableZoom={false} enablePan={false} autoRotate={!reducedMotion} autoRotateSpeed={0.5} maxPolarAngle={Math.PI / 1.5} minPolarAngle={Math.PI / 3} />
      <Cleanup />
    </Canvas>
  );
}
```

- [ ] **Step 2: Update NeuralNetwork3D.tsx**

Update the props interface and pass through `brainState` and `onNodeClick`:

In `src/components/jarvis/NeuralNetwork3D.tsx`:

Change the props interface from:
```typescript
interface NeuralNetwork3DProps {
  state: "idle" | "thinking" | "firing";
  className?: string;
}
```
To:
```typescript
import type { AgentConfig } from "@/lib/jarvis/agent-registry";
import type { BrainState } from "./neural-network/useNetworkAnimation";

interface NeuralNetwork3DProps {
  brainState: BrainState;
  onNodeClick: (agent: AgentConfig) => void;
  className?: string;
}
```

Update the component to destructure `brainState` and `onNodeClick` instead of `state`. Pass them to `NeuralNetworkScene`:
```typescript
<NeuralNetworkScene
  brainState={brainState}
  reducedMotion={reducedMotion}
  onNodeClick={onNodeClick}
  onCreated={handleCreated}
/>
```

- [ ] **Step 3: Update JarvisWelcome.tsx**

Replace the entire file. Adds Sheet for agent details with system prompt display.

```typescript
// src/components/jarvis/JarvisWelcome.tsx
"use client";

import { useState } from "react";
import { Sparkles, FlaskConical } from "lucide-react";
import JarvisQuickActions from "./JarvisQuickActions";
import NeuralNetwork3D from "./NeuralNetwork3D";
import type { AgentConfig } from "@/lib/jarvis/agent-registry";
import type { BrainState } from "./neural-network/useNetworkAnimation";
import { JARVIS_CORE_STATIC_PROMPT } from "@/lib/jarvis/prompts/jarvis-core";
import { RND_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/rnd";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

const PROMPT_MAP: Record<string, string> = {
  "jarvis-core": JARVIS_CORE_STATIC_PROMPT,
  "rnd": RND_SYSTEM_PROMPT,
};

interface JarvisWelcomeProps {
  contextType: "general" | "job" | "rnd";
  jobContext?: { customerName: string; address: string };
  onQuickAction: (text: string) => void;
  brainState?: BrainState;
}

export default function JarvisWelcome({ contextType, jobContext, onQuickAction, brainState }: JarvisWelcomeProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleNodeClick = (agent: AgentConfig) => {
    setSelectedAgent(agent);
    setSheetOpen(true);
  };

  if (contextType === "rnd") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center mb-5">
          <FlaskConical size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-purple-400 mb-2">R&D Department</h2>
        <p className="text-base text-muted-foreground mb-1">Platform research, diagnostics & build specs</p>
        <p className="text-sm text-muted-foreground/60 max-w-md mb-8">
          I can read the codebase, query the database, search the web, and diagnose issues. Ask me anything about the platform.
        </p>
        <JarvisQuickActions contextType="rnd" onSelect={onQuickAction} />
      </div>
    );
  }

  if (contextType === "job" && jobContext) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[image:var(--gradient-primary)] flex items-center justify-center mb-4">
          <Sparkles size={28} className="text-white" />
        </div>
        <h3 className="text-lg font-semibold gradient-text mb-1">Jarvis</h3>
        <p className="text-sm text-muted-foreground max-w-xs mb-6">
          I&apos;m ready to help with the {jobContext.customerName} job. What do you need?
        </p>
        <JarvisQuickActions contextType="job" onSelect={onQuickAction} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="mb-3">
        <NeuralNetwork3D
          brainState={brainState ?? { mode: "idle" }}
          onNodeClick={handleNodeClick}
        />
      </div>
      <h2 className="text-2xl font-bold gradient-text mb-2">Jarvis</h2>
      <p className="text-base text-muted-foreground mb-1">Your AI partner for AAA Disaster Recovery</p>
      <p className="text-sm text-muted-foreground/60 max-w-md">
        Ask me about your jobs, business metrics, marketing ideas, or anything else. I&apos;m here to help.
      </p>

      {/* Agent Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-lg">
          {selectedAgent && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedAgent.name}</SheetTitle>
                <SheetDescription>{selectedAgent.role}</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 mt-6">
                {selectedAgent.status === "active" ? (
                  <ActiveAgentDetails agent={selectedAgent} />
                ) : (
                  <PlannedAgentDetails agent={selectedAgent} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActiveAgentDetails({ agent }: { agent: AgentConfig }) {
  const systemPrompt = PROMPT_MAP[agent.id];
  return (
    <>
      <div><Badge variant="default">Active</Badge></div>
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">Model</h4>
        <p className="text-sm">{agent.model}</p>
      </div>
      {agent.endpoint && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Endpoint</h4>
          <code className="text-sm bg-muted px-2 py-0.5 rounded">{agent.endpoint}</code>
        </div>
      )}
      {agent.accessMethod && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Access</h4>
          <p className="text-sm">{agent.accessMethod}</p>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Tools</h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <Badge key={tool} variant="secondary" className="text-xs">{tool}</Badge>
            ))}
          </div>
        </div>
      )}
      {agent.config && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Config</h4>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
            {JSON.stringify(agent.config, null, 2)}
          </pre>
        </div>
      )}
      {systemPrompt && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">System Prompt (Static Template)</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Dynamic context (job details, business snapshot) is injected at runtime.
          </p>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap max-h-[500px] overflow-y-auto">
            {systemPrompt}
          </pre>
        </div>
      )}
    </>
  );
}

function PlannedAgentDetails({ agent }: { agent: AgentConfig }) {
  return (
    <>
      <Badge variant="outline">Planned — {agent.plannedBuild}</Badge>
      <p className="text-sm text-muted-foreground">
        This department hasn&apos;t been built yet. It&apos;s coming in {agent.plannedBuild}.
      </p>
      {agent.knowledgeSources && agent.knowledgeSources.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Planned Knowledge Sources</h4>
          <ul className="text-sm text-muted-foreground list-disc list-inside">
            {agent.knowledgeSources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Update JarvisChat.tsx**

In `src/components/jarvis/JarvisChat.tsx`, change the `networkState` prop to `brainState`:

Replace:
```typescript
networkState={isTyping ? "thinking" : "idle"}
```
With:
```typescript
brainState={isTyping ? { mode: "thinking" } : { mode: "idle" }}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean (no errors). If the prompts/jarvis-core.ts or prompts/rnd.ts don't exist yet (if Task 2 hasn't been done), there will be import errors — Task 2 must complete first.

- [ ] **Step 6: Commit**

```bash
git add src/components/jarvis/neural-network/NeuralNetworkScene.tsx src/components/jarvis/NeuralNetwork3D.tsx src/components/jarvis/JarvisWelcome.tsx src/components/jarvis/JarvisChat.tsx
git commit -m "feat: wire agent map through scene/wrapper/welcome/chat with detail Sheet"
```

---

## Task 9: Add `routed_to` to Chat API Response

**Files:**
- Modify: `src/app/api/jarvis/chat/route.ts`

- [ ] **Step 1: Track tool routing in normal Jarvis flow**

In the normal Jarvis flow (the `else` branch starting around line 238), after the tool loop completes, check if `consult_rnd` was called. Add a variable before the tool loop:

```typescript
let routedTo: string | null = null;
```

Inside the tool loop, when processing tool results, check:
```typescript
if (toolUse.name === "consult_rnd") {
  routedTo = "rnd";
}
```

- [ ] **Step 2: Track routing in the direct R&D path**

In the `isRndDirect` branch (around line 193), set:
```typescript
const routedTo = "rnd";
```

- [ ] **Step 3: Include `routed_to` in the response JSON**

Change the final response from:
```typescript
return NextResponse.json({
  content: assistantContent,
  conversation_id: conversation_id || null,
});
```
To:
```typescript
return NextResponse.json({
  content: assistantContent,
  conversation_id: conversation_id || null,
  routed_to: routedTo ?? null,
});
```

Make sure `routedTo` is accessible in both the `isRndDirect` and normal branches. Move the declaration to before the `if (isRndDirect)` check.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jarvis/chat/route.ts
git commit -m "feat: add routed_to field to chat API response for brain highlighting"
```

---

## Task 10: Wire `routed_to` into BrainState in JarvisChat

**Files:**
- Modify: `src/components/jarvis/JarvisChat.tsx`

- [ ] **Step 1: Read `routed_to` from API response and set brainState**

In `JarvisChat.tsx`, add a state for brainState:

```typescript
const [brainState, setBrainState] = useState<{ mode: "idle" | "thinking" | "firing"; activeAgent?: string }>({ mode: "idle" });
```

In the `handleSend` function:

After `setIsTyping(true)` (around line 162), add:
```typescript
setBrainState({ mode: "firing" });
setTimeout(() => setBrainState({ mode: "thinking" }), 300);
```

After parsing the API response (around line 200), read `routed_to`:
```typescript
if (data.routed_to) {
  setBrainState({ mode: "thinking", activeAgent: data.routed_to });
}
```

In the `finally` block (around line 240), reset:
```typescript
setBrainState({ mode: "idle" });
```

Update the JarvisWelcome render to use this state:
```typescript
brainState={brainState}
```

Import the `BrainState` type:
```typescript
import type { BrainState } from "./neural-network/useNetworkAnimation";
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit && npx next build 2>&1 | tail -5`
Expected: Clean compile and build.

- [ ] **Step 3: Commit**

```bash
git add src/components/jarvis/JarvisChat.tsx
git commit -m "feat: wire routed_to from API into brainState for live agent highlighting"
```

---

## Task 11: Visual Verification

- [ ] **Step 1: Start dev server and test**

Run: `npm run dev`

Navigate to `/jarvis` and verify:
1. 4 nodes visible — large center hub (Jarvis) with 3 spokes (R&D, Field Ops, Marketing)
2. Each node has a floating text label
3. R&D is bright teal, Field Ops and Marketing are dim
4. Hover a node — it brightens, cursor becomes pointer
5. Click R&D → Sheet opens with name, role, model, tools, endpoint, system prompt
6. Click Jarvis Core → Sheet shows Jarvis details and full prompt
7. Click Field Ops → Sheet shows "Planned — Build 2.4"
8. Click Marketing → Sheet shows "Planned — Build 2.6"
9. Close Sheet — brain resumes normal behavior
10. Switch to R&D mode — FlaskConical icon (no 3D)
11. Auto-rotate works, scroll works, mobile sizing works

- [ ] **Step 2: Test API responses**

Send a message in Jarvis chat. Verify response JSON includes `routed_to: null` for normal messages.
Send `@rnd check health` — verify `routed_to: "rnd"` in response.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: build 2.10b complete — agent architecture map with detail sheets"
```
