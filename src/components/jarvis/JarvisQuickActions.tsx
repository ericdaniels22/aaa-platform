"use client";

interface JarvisQuickActionsProps {
  contextType: "general" | "job";
  onSelect: (text: string) => void;
}

const generalActions = [
  "How's the business doing?",
  "What needs my attention today?",
  "Any overdue follow-ups?",
  "Draft a marketing post",
  "Show me active jobs",
];

const jobActions = [
  "Classify this water damage",
  "How many air movers do I need?",
  "Draft adjuster email",
  "What's the job status?",
  "Log a note",
];

export default function JarvisQuickActions({ contextType, onSelect }: JarvisQuickActionsProps) {
  const actions = contextType === "general" ? generalActions : jobActions;

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-2 scrollbar-none">
      {actions.map((action) => (
        <button
          key={action}
          onClick={() => onSelect(action)}
          className="flex-shrink-0 px-3.5 py-1.5 rounded-full border border-gray-200 bg-white text-sm text-[#666666] hover:bg-[#F5F5F5] hover:text-[#1A1A1A] hover:border-gray-300 transition-colors"
        >
          {action}
        </button>
      ))}
    </div>
  );
}
