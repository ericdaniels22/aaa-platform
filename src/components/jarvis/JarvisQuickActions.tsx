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
    <div className="flex flex-wrap justify-center gap-2 px-4 pb-2">
      {actions.map((action) => (
        <button
          key={action}
          onClick={() => onSelect(action)}
          className="px-3.5 py-1.5 rounded-full border border-border bg-card text-sm text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition-colors"
        >
          {action}
        </button>
      ))}
    </div>
  );
}
