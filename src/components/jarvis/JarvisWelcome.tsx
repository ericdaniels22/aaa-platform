"use client";

import { Sparkles, FlaskConical } from "lucide-react";
import JarvisQuickActions from "./JarvisQuickActions";
import NeuralNetwork3D from "./NeuralNetwork3D";

interface JarvisWelcomeProps {
  contextType: "general" | "job" | "rnd";
  jobContext?: {
    customerName: string;
    address: string;
  };
  onQuickAction: (text: string) => void;
  networkState?: "idle" | "thinking" | "firing";
}

export default function JarvisWelcome({ contextType, jobContext, onQuickAction, networkState }: JarvisWelcomeProps) {
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
        <NeuralNetwork3D state={networkState ?? "idle"} />
      </div>
      <h2 className="text-2xl font-bold gradient-text mb-2">Jarvis</h2>
      <p className="text-base text-muted-foreground mb-1">Your AI partner for AAA Disaster Recovery</p>
      <p className="text-sm text-muted-foreground/60 max-w-md mb-8">
        Ask me about your jobs, business metrics, marketing ideas, or anything else. I&apos;m here to help.
      </p>
      <JarvisQuickActions contextType="general" onSelect={onQuickAction} />
    </div>
  );
}
