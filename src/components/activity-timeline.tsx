"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { JobActivity } from "@/lib/types";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Camera,
  Flag,
  Shield,
  Wrench,
  Plus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const activityTypeConfig: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; label: string }
> = {
  note: { icon: MessageSquare, color: "bg-[#2B5EA7]", label: "Note" },
  photo: { icon: Camera, color: "bg-[#0F6E56]", label: "Photo" },
  milestone: { icon: Flag, color: "bg-[#C41E2A]", label: "Milestone" },
  insurance: { icon: Shield, color: "bg-[#6C5CE7]", label: "Insurance" },
  equipment: { icon: Wrench, color: "bg-[#633806]", label: "Equipment" },
};

const activityTypes = [
  { value: "note", label: "Note" },
  { value: "milestone", label: "Milestone" },
  { value: "insurance", label: "Insurance" },
  { value: "equipment", label: "Equipment" },
  { value: "photo", label: "Photo" },
];

export default function ActivityTimeline({
  activities,
  jobId,
  onActivityAdded,
}: {
  activities: JobActivity[];
  jobId: string;
  onActivityAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activityType, setActivityType] = useState("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  async function handleAddActivity() {
    if (!title.trim()) {
      toast.error("Please enter a title.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error } = await supabase.from("job_activities").insert({
      job_id: jobId,
      activity_type: activityType,
      title: title.trim(),
      description: description.trim() || null,
      author: "Eric",
    });

    if (error) {
      toast.error("Failed to add activity.");
    } else {
      toast.success("Activity added.");
      setTitle("");
      setDescription("");
      setActivityType("note");
      setOpen(false);
      onActivityAdded();
    }
    setSubmitting(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-[#1A1A1A]">
          Activity Log
        </h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[#1B2434] hover:bg-[#2a3a52] text-white transition-colors"
          >
            <Plus size={16} className="mr-1" />
            Add Note
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Activity</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-[#666666] mb-1.5">
                  Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {activityTypes.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setActivityType(opt.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                        activityType === opt.value
                          ? "bg-[#1B2434] text-white border-[#1B2434]"
                          : "bg-white text-[#666666] border-gray-200 hover:border-gray-300"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#666666] mb-1.5">
                  Title
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief summary..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#666666] mb-1.5">
                  Details (optional)
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Full details..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleAddActivity}
                  disabled={submitting}
                  className="bg-[#C41E2A] hover:bg-[#A3171F] text-white"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {activities.length === 0 ? (
        <p className="text-sm text-[#999999] py-4 text-center">
          No activity yet.
        </p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gray-200" />

          <div className="space-y-4">
            {activities.map((activity) => {
              const config =
                activityTypeConfig[activity.activity_type] ||
                activityTypeConfig.note;
              const Icon = config.icon;

              return (
                <div key={activity.id} className="flex gap-3 relative">
                  <div
                    className={cn(
                      "w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10",
                      config.color
                    )}
                  >
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-[#1A1A1A]">
                        {activity.title}
                      </p>
                      <span className="text-xs text-[#999999] flex-shrink-0">
                        {format(
                          new Date(activity.created_at),
                          "MMM d, h:mm a"
                        )}
                      </span>
                    </div>
                    {activity.description && (
                      <p className="text-sm text-[#666666] mt-0.5 whitespace-pre-wrap">
                        {activity.description}
                      </p>
                    )}
                    <p className="text-xs text-[#999999] mt-1">
                      {activity.author}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
