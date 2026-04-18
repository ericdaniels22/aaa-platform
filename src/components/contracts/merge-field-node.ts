import { Node, mergeAttributes } from "@tiptap/core";

export interface MergeFieldOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mergeField: {
      insertMergeField: (fieldName: string) => ReturnType;
    };
  }
}

/**
 * Inline atomic node representing a merge-field token inside a contract
 * template. Renders as <span class="merge-field-pill" data-field-name="…">
 * so the resolver can match it later. Draggable so authors can reposition
 * tokens without retyping them; atomic so clicks and delete behave as a unit.
 */
export const MergeField = Node.create<MergeFieldOptions>({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      fieldName: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-field-name") ?? "",
        renderHTML: (attrs) => ({ "data-field-name": attrs.fieldName }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-merge-field]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const fieldName =
      (HTMLAttributes["data-field-name"] as string | undefined) ?? "";
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "merge-field-pill",
        "data-merge-field": "true",
      }),
      `{{${fieldName}}}`,
    ];
  },

  addCommands() {
    return {
      insertMergeField:
        (fieldName: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { fieldName },
          }),
    };
  },
});
