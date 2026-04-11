"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { JobFile } from "@/lib/types";
import { Download, Loader2, FileWarning } from "lucide-react";

export default function JobFilePreview({
  jobId,
  file,
  open,
  onOpenChange,
}: {
  jobId: string;
  file: JobFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPdf = file?.mime_type === "application/pdf";

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/${jobId}/files/${file.id}/url`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setUrl(data.url);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file, jobId]);

  function handleDownload() {
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="truncate pr-8">
            {file?.filename || "File"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/30">
          {loading && (
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
          )}
          {!loading && error && (
            <div className="text-center p-8">
              <FileWarning
                className="mx-auto text-muted-foreground/50 mb-2"
                size={40}
              />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}
          {!loading && !error && url && isPdf && (
            <iframe
              src={url}
              title={file?.filename || "PDF preview"}
              className="w-full h-full"
            />
          )}
          {!loading && !error && url && !isPdf && (
            <div className="text-center p-8">
              <FileWarning
                className="mx-auto text-muted-foreground/50 mb-2"
                size={40}
              />
              <p className="text-sm text-muted-foreground mb-4">
                Preview not available for this file type.
              </p>
              <Button onClick={handleDownload}>
                <Download size={14} className="mr-2" />
                Download
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
