"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

interface JarvisInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function JarvisInput({ onSend, disabled, placeholder }: JarvisInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 6 * 24; // ~6 lines
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + "px";
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    adjustHeight();
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isEmpty = value.trim().length === 0;

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Jarvis is thinking..." : placeholder || "Message Jarvis..."}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 py-1"
        />
        <button
          onClick={handleSend}
          disabled={isEmpty || disabled}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
