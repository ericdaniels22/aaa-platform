"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import TiptapEditor from "@/components/tiptap-editor";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function isEmptyHtml(s: string | null): boolean {
  if (s === null || s === "") return true;
  const stripped = s.replace(/<[^>]*>/g, "").trim();
  return stripped === "";
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function buildPlaceholder(defaultText: string): string {
  if (!defaultText) return "Type your statement…";
  const stripped = stripHtmlTags(defaultText).trim();
  if (!stripped) return "Type your statement…";
  if (stripped.length > 120) return stripped.slice(0, 120) + "…";
  return stripped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface StatementEditorProps {
  label: "Opening statement" | "Closing statement";
  value: string | null;
  onChange: (next: string | null) => void;
  defaultText: string; // resolved from company_settings by parent
  readOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// StatementEditor
// ─────────────────────────────────────────────────────────────────────────────

export function StatementEditor({
  label,
  value,
  onChange,
  defaultText,
  readOnly = false,
}: StatementEditorProps) {
  // resetCounter forces TiptapEditor to unmount/remount when the user clicks
  // "Reset to default", so the editor re-initializes with the new content prop.
  const [resetCounter, setResetCounter] = useState(0);

  const showResetButton =
    !readOnly && defaultText !== "" && value !== defaultText;

  function handleChange(html: string) {
    onChange(isEmptyHtml(html) ? null : html);
  }

  function handleReset() {
    onChange(defaultText);
    // Bump the key so TiptapEditor re-mounts with the default content.
    setResetCounter((c) => c + 1);
  }

  const placeholder = buildPlaceholder(defaultText);

  // When value is empty, pass empty string as content so TiptapEditor shows
  // the placeholder; otherwise pass the actual HTML.
  const editorContent = isEmptyHtml(value) ? "" : (value as string);

  // ── readOnly path ──────────────────────────────────────────────────────────

  if (readOnly) {
    const displayHtml = isEmptyHtml(value)
      ? isEmptyHtml(defaultText)
        ? ""
        : defaultText
      : (value as string);

    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </Label>
        {displayHtml ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1"
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No {label.toLowerCase()} set.
          </p>
        )}
      </div>
    );
  }

  // ── editable path ──────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      {/* Header row: label + reset button */}
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </Label>
        {showResetButton && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={handleReset}
          >
            <RotateCcw size={12} />
            Reset to default
          </Button>
        )}
      </div>

      {/* Editor */}
      <TiptapEditor
        key={resetCounter}
        content={editorContent}
        onChange={handleChange}
        placeholder={placeholder}
      />
    </div>
  );
}
