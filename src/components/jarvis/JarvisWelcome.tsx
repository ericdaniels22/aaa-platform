"use client";

import { Sparkles } from "lucide-react";
import JarvisQuickActions from "./JarvisQuickActions";

interface JarvisWelcomeProps {
  contextType: "general" | "job";
  jobContext?: {
    customerName: string;
    address: string;
  };
  onQuickAction: (text: string) => void;
}

export default function JarvisWelcome({ contextType, jobContext, onQuickAction }: JarvisWelcomeProps) {
  if (contextType === "job" && jobContext) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#1B2434]/5 flex items-center justify-center mb-4">
          <Sparkles size={28} className="text-[#1B2434]" />
        </div>
        <h3 className="text-lg font-semibold text-[#1A1A1A] mb-1">Jarvis</h3>
        <p className="text-sm text-[#666666] max-w-xs mb-6">
          I&apos;m ready to help with the {jobContext.customerName} job. What do you need?
        </p>
        <JarvisQuickActions contextType="job" onSelect={onQuickAction} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#1B2434]/5 flex items-center justify-center mb-5">
        <Sparkles size={32} className="text-[#1B2434]" />
      </div>
      <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">Jarvis</h2>
      <p className="text-base text-[#666666] mb-1">Your AI partner for AAA Disaster Recovery</p>
      <p className="text-sm text-[#999999] max-w-md mb-8">
        Ask me about your jobs, business metrics, marketing ideas, or anything else. I&apos;m here to help.
      </p>
      <JarvisQuickActions contextType="general" onSelect={onQuickAction} />
    </div>
  );
}
