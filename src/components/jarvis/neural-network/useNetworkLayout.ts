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
    const angle = (i / departments.length) * Math.PI * 2 - Math.PI / 2;
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
