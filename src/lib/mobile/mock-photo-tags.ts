// Path B note: Session A is scaffolding without scratch Supabase access.
// Real photo_tags fetch wires up in the next Mac/iPhone session against
// scratch credentials. This mock keeps the review screen renderable so the
// UX shape is reviewable on Windows.

import type { PhotoTag } from "@/lib/types";

export const MOCK_PHOTO_TAGS: PhotoTag[] = [
  {
    id: "mock-tag-before",
    name: "Before",
    color: "#dc2626",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-during",
    name: "During",
    color: "#f59e0b",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-after",
    name: "After",
    color: "#16a34a",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-damage",
    name: "Damage",
    color: "#7c3aed",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-equipment",
    name: "Equipment",
    color: "#0284c7",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
];
