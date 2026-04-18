"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Plus,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MergeField } from "./merge-field-node";
import { MERGE_FIELD_CATEGORIES, mergeFieldsByCategory } from "@/lib/contracts/merge-fields";
import { cn } from "@/lib/utils";

export interface TemplateEditorHandle {
  getHTML: () => string;
  getJSON: () => unknown;
  insertMergeField: (fieldName: string) => void;
  focus: () => void;
}

interface TemplateEditorProps {
  initialContent: unknown;
  onReady?: (handle: TemplateEditorHandle) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function TemplateEditor({
  initialContent,
  onReady,
  onDirtyChange,
}: TemplateEditorProps) {
  const [mergeOpen, setMergeOpen] = useState(false);
  const mergeBtnRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        horizontalRule: {},
      }),
      Placeholder.configure({
        placeholder: "Write your contract template here…",
      }),
      MergeField,
    ],
    content: initialContent ?? { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "contract-template-prose prose prose-sm dark:prose-invert max-w-none min-h-[520px] px-5 py-4 focus:outline-none text-foreground",
      },
    },
    onUpdate: () => {
      onDirtyChange?.(true);
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReady?.({
      getHTML: () => editor.getHTML(),
      getJSON: () => editor.getJSON(),
      insertMergeField: (fieldName: string) => {
        editor.chain().focus().insertMergeField(fieldName).run();
      },
      focus: () => editor.commands.focus(),
    });
  }, [editor, onReady]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!mergeBtnRef.current) return;
      if (!mergeBtnRef.current.contains(e.target as Element)) {
        setMergeOpen(false);
      }
    }
    if (mergeOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [mergeOpen]);

  if (!editor) {
    return (
      <div className="h-[560px] rounded-xl border border-border bg-card animate-pulse" />
    );
  }

  const grouped = mergeFieldsByCategory();

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[560px]">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/40 flex-wrap">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          <Heading1 size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          <Heading2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
        >
          <Heading3 size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListOrdered size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
        >
          <Minus size={15} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Merge field dropdown */}
        <div ref={mergeBtnRef} className="relative">
          <button
            type="button"
            onClick={() => setMergeOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 transition-colors"
            title="Insert merge field"
          >
            <Plus size={14} /> Merge Field <ChevronDown size={12} />
          </button>
          {mergeOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 max-h-96 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl z-30 p-2">
              {MERGE_FIELD_CATEGORIES.map((cat) => (
                <div key={cat} className="mb-2 last:mb-0">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {grouped[cat].map((f) => (
                      <button
                        key={f.name}
                        type="button"
                        onClick={() => {
                          editor.chain().focus().insertMergeField(f.name).run();
                          setMergeOpen(false);
                        }}
                        className="merge-field-pill cursor-pointer hover:brightness-110"
                      >
                        {`{{${f.name}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Editor body */}
      <div className="flex-1 bg-background/30">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded transition-colors",
        active
          ? "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
