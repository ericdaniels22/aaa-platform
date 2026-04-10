"use client";

interface QuickAction {
  label: string;
  prompt: string;
}

interface JarvisQuickActionsProps {
  contextType: "general" | "job" | "rnd" | "marketing";
  onSelect: (text: string) => void;
  fillMode?: boolean;
  onFill?: (text: string) => void;
}

const generalActions: string[] = [
  "How's the business doing?",
  "What needs my attention today?",
  "Any overdue follow-ups?",
  "Draft a marketing post",
  "Show me active jobs",
];

const jobActions: string[] = [
  "Classify this water damage",
  "How many air movers do I need?",
  "Draft adjuster email",
  "What's the job status?",
  "Log a note",
];

const rndActions: string[] = [
  "Check system health",
  "Show me the project structure",
  "Research a technology",
  "Write a build spec",
  "What needs improving?",
];

const marketingActions: QuickAction[] = [
  { label: "Instagram Post", prompt: "Draft an Instagram post about " },
  { label: "Facebook Post", prompt: "Draft a Facebook post about " },
  { label: "Google Ad Copy", prompt: "Write Google Ads for our " },
  { label: "SEO Blog Post", prompt: "Write a local SEO blog post targeting " },
  { label: "GBP Post", prompt: "Write a Google Business Profile post about " },
  { label: "Review Response", prompt: "Draft a professional response to this review: " },
  { label: "Website Copy", prompt: "Write copy for our website page about " },
  { label: "LLM Optimization", prompt: "Analyze and suggest improvements for our AI search visibility. Focus on " },
  { label: "Content Calendar", prompt: "Create a 4-week content calendar for " },
];

export default function JarvisQuickActions({ contextType, onSelect, fillMode, onFill }: JarvisQuickActionsProps) {
  if (contextType === "marketing") {
    return (
      <div className="flex flex-wrap justify-center gap-2 px-4 pb-2">
        {marketingActions.map((action) => (
          <button
            key={action.label}
            onClick={() => (fillMode && onFill ? onFill(action.prompt) : onSelect(action.prompt))}
            className="px-3.5 py-1.5 rounded-full border text-sm transition-colors border-teal-500/30 bg-teal-500/5 text-teal-300 hover:border-teal-400/50 hover:bg-teal-500/10 hover:text-teal-200"
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

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
