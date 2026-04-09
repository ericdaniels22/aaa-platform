"use client";

import { useState } from "react";
import { MessageSquare, X, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import JarvisChat from "./JarvisChat";
import { Badge } from "@/components/ui/badge";

interface JarvisJobPanelProps {
  jobId: string;
  jobContext: {
    customerName: string;
    address: string;
    status: string;
    damageType: string;
  };
}

export default function JarvisJobPanel({ jobId, jobContext }: JarvisJobPanelProps) {
  const [open, setOpen] = useState(false);
  const badgeCount = 0; // Placeholder for future proactive messages

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-[#1B2434] hover:bg-[#F5F5F5] hover:border-gray-300 transition-colors relative"
      >
        <MessageSquare size={16} />
        <span className="hidden sm:inline">Ask Jarvis</span>
        {badgeCount > 0 && (
          <Badge className="absolute -top-1.5 -right-1.5 h-5 min-w-5 rounded-full bg-[#C41E2A] text-white text-[10px] font-bold flex items-center justify-center px-1">
            {badgeCount}
          </Badge>
        )}
      </button>

      {/* Sheet panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:w-[420px] sm:max-w-[420px] p-0 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={18} className="text-[#1B2434] flex-shrink-0" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#1A1A1A]">Jarvis</h2>
                <p className="text-xs text-[#999999] truncate">
                  {jobContext.customerName} — {jobContext.address}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors text-[#666666]"
            >
              <X size={18} />
            </button>
          </div>

          {/* Chat */}
          <div className="flex-1 min-h-0">
            <JarvisChat
              contextType="job"
              jobId={jobId}
              jobContext={jobContext}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
