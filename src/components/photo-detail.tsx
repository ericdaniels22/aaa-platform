"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Photo, PhotoTag } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Trash2, Save, Loader2, Check, Tag, Pencil, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function PhotoDetailModal({
  open,
  onOpenChange,
  photo,
  allTags,
  photoUrl,
  onUpdated,
  onAnnotate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: Photo | null;
  allTags: PhotoTag[];
  photoUrl: string;
  onUpdated: () => void;
  onAnnotate: (photo: Photo, url: string) => void;
}) {
  const [caption, setCaption] = useState("");
  const [beforeAfterRole, setBeforeAfterRole] = useState<"before" | "after" | null>(null);
  const [assignedTagIds, setAssignedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);

  useEffect(() => {
    if (photo) {
      setCaption(photo.caption || "");
      setBeforeAfterRole(photo.before_after_role);
      setConfirmDelete(false);
      // Fetch tag assignments for this photo
      fetchTags(photo.id);
      // Check if an original backup or annotations exist
      checkOriginalBackup(photo);
    }
  }, [photo]);

  async function checkOriginalBackup(p: Photo) {
    const supabase = createClient();
    // Check for crop backup
    const backupPath = p.storage_path.replace(/\.[^.]+$/, "-original$&");
    const { data: backupData } = await supabase.storage.from("photos").list(
      backupPath.substring(0, backupPath.lastIndexOf("/")),
      { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) }
    );
    const hasCropBackup = !!backupData && backupData.some((f) => backupPath.endsWith(f.name));
    setHasOriginalBackup(hasCropBackup || !!p.annotated_path);
  }

  async function handleRestoreOriginal() {
    if (!photo) return;
    setRestoring(true);
    const supabase = createClient();

    try {
      // Restore crop backup if it exists
      const backupPath = photo.storage_path.replace(/\.[^.]+$/, "-original$&");
      const { data: backupData } = await supabase.storage.from("photos").list(
        backupPath.substring(0, backupPath.lastIndexOf("/")),
        { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) }
      );
      const hasCropBackup = !!backupData && backupData.some((f) => backupPath.endsWith(f.name));

      if (hasCropBackup) {
        const { data: backupBlob } = await supabase.storage.from("photos").download(backupPath);
        if (backupBlob) {
          await supabase.storage.from("photos").upload(photo.storage_path, backupBlob, {
            upsert: true,
            contentType: backupBlob.type,
          });
          await supabase.storage.from("photos").remove([backupPath]);
        }
      }

      // Delete annotated image if it exists
      if (photo.annotated_path) {
        await supabase.storage.from("photos").remove([photo.annotated_path]);
        await supabase.from("photos").update({ annotated_path: null }).eq("id", photo.id);
      }

      // Delete annotation records
      await supabase.from("photo_annotations").delete().eq("photo_id", photo.id);

      toast.success("Photo restored to original.");
      setHasOriginalBackup(false);
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to restore original:", err);
      toast.error("Failed to restore original photo.");
    }
    setRestoring(false);
  }

  async function fetchTags(photoId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_tag_assignments")
      .select("tag_id")
      .eq("photo_id", photoId);
    if (data) {
      setAssignedTagIds(data.map((d) => d.tag_id));
    }
  }

  async function handleSave() {
    if (!photo) return;
    setSaving(true);
    const supabase = createClient();

    // Update photo record
    const { error } = await supabase
      .from("photos")
      .update({
        caption: caption || null,
        before_after_role: beforeAfterRole,
      })
      .eq("id", photo.id);

    if (error) {
      toast.error("Failed to update photo.");
      setSaving(false);
      return;
    }

    // Sync tags: delete all existing, re-insert current
    await supabase
      .from("photo_tag_assignments")
      .delete()
      .eq("photo_id", photo.id);

    if (assignedTagIds.length > 0) {
      const orgId = await getActiveOrganizationId(supabase);
      await supabase.from("photo_tag_assignments").insert(
        assignedTagIds.map((tagId) => ({
          organization_id: orgId,
          photo_id: photo.id,
          tag_id: tagId,
        }))
      );
    }

    toast.success("Photo updated.");
    setSaving(false);
    onUpdated();
  }

  async function handleDelete() {
    if (!photo) return;
    setDeleting(true);
    const supabase = createClient();

    // Delete from storage
    await supabase.storage.from("photos").remove([photo.storage_path]);

    // Delete record (cascades tags & annotations)
    const { error } = await supabase
      .from("photos")
      .delete()
      .eq("id", photo.id);

    if (error) {
      toast.error("Failed to delete photo.");
    } else {
      toast.success("Photo deleted.");
      onOpenChange(false);
      onUpdated();
    }
    setDeleting(false);
  }

  function toggleTag(tagId: string) {
    setAssignedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    );
  }

  if (!photo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Photo Details</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Image */}
          <div>
            <div className="bg-gray-100 rounded-lg overflow-hidden">
              <img
                src={photoUrl}
                alt={photo.caption || "Photo"}
                className="w-full h-auto max-h-[600px] object-contain"
              />
            </div>
            <button
              onClick={() => {
                onAnnotate(photo, photoUrl);
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#2B5EA7] hover:text-[#0C447C] transition-colors"
            >
              <Pencil size={14} />
              {photo.annotated_path ? "Edit Annotations" : "Annotate Photo"}
            </button>
            {photo.annotated_path && (
              <span className="ml-3 text-xs text-[#0F6E56]">
                Has annotations
              </span>
            )}
            {hasOriginalBackup && (
              <button
                onClick={handleRestoreOriginal}
                disabled={restoring}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#791F1F] hover:text-[#C41E2A] transition-colors disabled:opacity-50"
              >
                {restoring ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
                Restore Original Photo
              </button>
            )}
          </div>

          {/* Details */}
          <div className="space-y-4">
            {/* Caption */}
            <div>
              <label className="block text-sm font-medium text-[#666666] mb-1.5">
                Caption
              </label>
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe this photo..."
              />
            </div>

            {/* Before/After */}
            <div>
              <label className="block text-sm font-medium text-[#666666] mb-1.5">
                Before / After
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setBeforeAfterRole(
                      beforeAfterRole === "before" ? null : "before"
                    )
                  }
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                    beforeAfterRole === "before"
                      ? "bg-[#FCEBEB] text-[#791F1F] border-[#791F1F]/20"
                      : "bg-white text-[#666666] border-gray-200"
                  )}
                >
                  Before
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBeforeAfterRole(
                      beforeAfterRole === "after" ? null : "after"
                    )
                  }
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                    beforeAfterRole === "after"
                      ? "bg-[#E1F5EE] text-[#085041] border-[#085041]/20"
                      : "bg-white text-[#666666] border-gray-200"
                  )}
                >
                  After
                </button>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-[#666666] mb-1.5">
                <Tag size={14} className="inline mr-1 -mt-0.5" />
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const selected = assignedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1",
                        selected
                          ? "text-white border-transparent"
                          : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
                      )}
                      style={
                        selected
                          ? {
                              backgroundColor: tag.color,
                              borderColor: tag.color,
                            }
                          : undefined
                      }
                    >
                      {selected && <Check size={10} />}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Meta info */}
            <div className="text-xs text-[#999999] space-y-1 pt-2 border-t border-gray-100">
              <p>
                Uploaded:{" "}
                {format(new Date(photo.created_at), "MMM d, yyyy 'at' h:mm a")}
              </p>
              <p>By: {photo.taken_by}</p>
              {photo.file_size && (
                <p>
                  Size: {(photo.file_size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-sm text-[#999999] hover:text-[#C41E2A] transition-colors flex items-center gap-1"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-sm text-white bg-[#C41E2A] hover:bg-[#A3171F] px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
                  >
                    {deleting && <Loader2 size={12} className="animate-spin" />}
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-sm text-[#666666] hover:text-[#1A1A1A]"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center justify-center rounded-lg text-sm font-medium px-4 py-2 bg-[#C41E2A] hover:bg-[#A3171F] text-white transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin mr-1" />
                ) : (
                  <Save size={14} className="mr-1" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
