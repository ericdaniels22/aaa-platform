"use client";

interface JarvisQuickActionsProps {
  contextType: "general" | "job" | "rnd";
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

const rndActions = [
  "Check system health",
  "Show me the project structure",
  "Research a technology",
  "Write a build spec",
  "What needs improving?",
];

export default function JarvisQuickActions({ contextType, onSelect }: JarvisQuickActionsProps) {
  const actions =
    contextType === "rnd"
      ? rndActions
      : contextType === "job"
        ? jobActions
        : generalActions;

  return (
    <div className="flex flex-wrap justify-center gap-2 px-4 pb-2">
      {actions.map((action) => (
        <button
          key={action}
          onClick={() => onSelect(action)}
          className={`px-3.5 py-1.5 rounded-full border text-sm transition-colors ${
            contextType === "rnd"
              ? "border-violet-500/30 bg-violet-500/5 text-violet-300 hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-violet-200"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
          }`}
        >
          {action}
        </button>
      ))}
    </div>
  );
}
