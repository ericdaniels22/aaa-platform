"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { Photo } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Circle,
  Square,
  Type,
  MousePointer,
  Undo2,
  Trash2,
  Loader2,
  ArrowUpRight,
  RotateCw,
  Crop,
  Sun,
  Contrast as ContrastIcon,
  Droplets,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  ImageOff,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

type Tool =
  | "select"
  | "freehand"
  | "circle"
  | "rectangle"
  | "text"
  | "arrow"
  | "crop";

const COLORS = [
  { value: "#F59E0B", label: "Yellow" },
  { value: "#C41E2A", label: "Red" },
  { value: "#2B5EA7", label: "Blue" },
  { value: "#0F6E56", label: "Green" },
  { value: "#FFFFFF", label: "White" },
  { value: "#1A1A1A", label: "Black" },
];

const TOOLS: {
  value: Tool;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { value: "freehand", label: "Draw", icon: Pencil },
  { value: "arrow", label: "Arrow", icon: ArrowUpRight },
  { value: "circle", label: "Circle", icon: Circle },
  { value: "rectangle", label: "Rectangle", icon: Square },
  { value: "text", label: "Text", icon: Type },
];

export default function PhotoAnnotator({
  open,
  onOpenChange,
  photo,
  photoUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: Photo | null;
  photoUrl: string;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any>(null);
  const fabricModuleRef = useRef<any>(null);
  const bgImageRef = useRef<any>(null);
  const [activeTool, setActiveTool] = useState<Tool>("arrow");
  const [activeColor, setActiveColor] = useState("#F59E0B");
  const [saving, setSaving] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const [hasOriginalBackup, setHasOriginalBackup] = useState(false);
  const [arrowToolbar, setArrowToolbar] = useState<{
    x: number;
    y: number;
    handle: any;
  } | null>(null);
  const isDrawingShape = useRef(false);
  const shapeStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentShape = useRef<any>(null);
  const activeToolRef = useRef<Tool>(activeTool);
  const activeColorRef = useRef(activeColor);
  const cropRectRef = useRef<any>(null);
  const cropRenderCallbackRef = useRef<any>(null);
  const hiddenObjectsRef = useRef<any[]>([]);
  const imgDimensionsRef = useRef<{
    width: number;
    height: number;
    scale: number;
  }>({ width: 800, height: 600, scale: 1 });

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);

  // Show/hide arrow handles and toolbar on selection
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !canvasReady) return;

    let activeArrowPath: any = null;

    function getArrowPath(target: any): any {
      if (target?._isArrow) return target;
      if (target?._arrowRole) return target._arrowPath;
      return null;
    }

    function showHandlesFor(ap: any) {
      if (ap._startHandle) { ap._startHandle.visible = true; ap._startHandle.setCoords(); }
      if (ap._endHandle) { ap._endHandle.visible = true; ap._endHandle.setCoords(); }
    }

    function hideHandlesFor(ap: any) {
      if (ap._startHandle) ap._startHandle.visible = false;
      if (ap._endHandle) ap._endHandle.visible = false;
    }

    function showToolbarForArrow(ap: any, handle?: any) {
      const canvasEl = canvas.getElement();
      const rect = canvasEl.getBoundingClientRect();
      const sh = ap._startHandle;
      const eh = ap._endHandle;
      if (!sh || !eh) return;
      const ref = handle && handle._arrowRole ? handle : sh;
      // Position at midpoint of arrow so it doesn't block either handle
      const midX = (sh.left + eh.left) / 2;
      const midY = Math.min(sh.top, eh.top);
      setArrowToolbar({
        x: rect.left + midX - 56,
        y: rect.top + midY,
        handle: ref,
      });
    }

    function onSelected(e: any) {
      const target = e.target;
      const ap = getArrowPath(target);

      if (ap) {
        // If selecting a handle of the already-active arrow, just let it be dragged
        if (target._arrowRole && ap === activeArrowPath) {
          return;
        }

        // Hide handles of previously active arrow
        if (activeArrowPath && activeArrowPath !== ap) {
          hideHandlesFor(activeArrowPath);
        }

        activeArrowPath = ap;
        showHandlesFor(ap);
        showToolbarForArrow(ap, target);

        // If user clicked the path line itself, deselect it so handles can be grabbed
        if (target._isArrow) {
          canvas.discardActiveObject();
        }
        canvas.renderAll();
      } else {
        // Non-arrow selected — hide active arrow handles
        if (activeArrowPath) {
          hideHandlesFor(activeArrowPath);
          activeArrowPath = null;
          canvas.renderAll();
        }
        setArrowToolbar(null);
      }
    }

    function onDeselected() {
      setTimeout(() => {
        const active = canvas.getActiveObject();
        if (!active || !getArrowPath(active)) {
          if (activeArrowPath) {
            hideHandlesFor(activeArrowPath);
            activeArrowPath = null;
            canvas.renderAll();
          }
          setArrowToolbar(null);
        }
      }, 100);
    }

    function onMoving() {
      setArrowToolbar(null);
    }

    canvas.on("selection:created", onSelected);
    canvas.on("selection:updated", onSelected);
    canvas.on("selection:cleared", onDeselected);
    canvas.on("object:moving", onMoving);

    return () => {
      canvas.off("selection:created", onSelected);
      canvas.off("selection:updated", onSelected);
      canvas.off("selection:cleared", onDeselected);
      canvas.off("object:moving", onMoving);
    };
  }, [canvasReady]);

  const initCanvas = useCallback(async () => {
    if (!canvasRef.current || !photo) return;

    const fabric = await import("fabric");
    fabricModuleRef.current = fabric;

    if (fabricRef.current) {
      fabricRef.current.dispose();
      fabricRef.current = null;
    }

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = document.createElement("img");
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = photoUrl;
      });

      const imgWidth = img.naturalWidth || 800;
      const imgHeight = img.naturalHeight || 600;

      // Use full viewport minus sidebar
      const maxWidth = window.innerWidth - 72;
      const maxHeight = window.innerHeight;
      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
      const canvasWidth = Math.round(imgWidth * scale);
      const canvasHeight = Math.round(imgHeight * scale);

      imgDimensionsRef.current = {
        width: imgWidth,
        height: imgHeight,
        scale,
      };

      const canvas = new fabric.Canvas(canvasRef.current!, {
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: "#1a1a1a",
      });

      const fabricImg = new fabric.FabricImage(img, {
        left: 0,
        top: 0,
        width: imgWidth,
        height: imgHeight,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        originX: "left",
        originY: "top",
      });

      bgImageRef.current = fabricImg;
      canvas.backgroundImage = fabricImg;
      canvas.renderAll();

      fabricRef.current = canvas;
      setCanvasReady(true);

      // Default to arrow tool
      canvas.isDrawingMode = false;
      canvas.selection = false;

      loadAnnotations(canvas, photo.id);

      // Check if an original backup exists
      const supabase = createClient();
      const backupPath = photo.storage_path.replace(/\.[^.]+$/, "-original$&");
      const { data: backupData } = await supabase.storage.from("photos").list(
        backupPath.substring(0, backupPath.lastIndexOf("/")),
        { search: backupPath.substring(backupPath.lastIndexOf("/") + 1) }
      );
      setHasOriginalBackup(
        !!backupData && backupData.some((f) => backupPath.endsWith(f.name))
      );
    } catch (err) {
      console.error("Failed to load image for annotation:", err);
      toast.error("Failed to load image.");
    }
  }, [photo, photoUrl]);

  async function loadAnnotations(canvas: any, photoId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("photo_annotations")
      .select("annotation_data")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data?.annotation_data && typeof data.annotation_data === "object") {
      const bg = canvas.backgroundImage;
      canvas.loadFromJSON(data.annotation_data).then(() => {
        canvas.backgroundImage = bg;
        canvas.renderAll();
      });
    }
  }

  useEffect(() => {
    if (open && photo) {
      setCanvasReady(false);
      setBrightness(0);
      setContrast(0);
      setSaturation(0);
      setShowAdjustments(false);
      setIsCropping(false);
      cropRectRef.current = null;
      cropRenderCallbackRef.current = null;
      hiddenObjectsRef.current = [];
      const timer = setTimeout(() => initCanvas(), 200);
      return () => clearTimeout(timer);
    }
    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
        setCanvasReady(false);
      }
    };
  }, [open, photo, initCanvas]);

  // Build arrow as line + arrowhead path + two draggable endpoint handles
  function createArrow(
    fabric: any,
    canvas: any,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string
  ) {
    const strokeW = 6;
    const headLen = 24;

    function buildArrowPath(ax1: number, ay1: number, ax2: number, ay2: number) {
      const ang = Math.atan2(ay2 - ay1, ax2 - ax1);
      const hx1 = ax2 - headLen * Math.cos(ang - Math.PI / 6);
      const hy1 = ay2 - headLen * Math.sin(ang - Math.PI / 6);
      const hx2 = ax2 - headLen * Math.cos(ang + Math.PI / 6);
      const hy2 = ay2 - headLen * Math.sin(ang + Math.PI / 6);
      return `M ${ax1} ${ay1} L ${ax2} ${ay2} M ${hx1} ${hy1} L ${ax2} ${ay2} L ${hx2} ${hy2}`;
    }

    // Arrow shaft + head as a path — selectable for dragging but no bounding box
    const arrowPath = new fabric.Path(buildArrowPath(x1, y1, x2, y2), {
      stroke: color,
      strokeWidth: strokeW,
      strokeLineCap: "round",
      strokeLineJoin: "round",
      fill: "transparent",
      selectable: true,
      evented: true,
      hasBorders: false,
      hasControls: false,
      perPixelTargetFind: true,
      lockRotation: true,
      objectCaching: false,
    });

    // Endpoint handles (draggable circles) — hidden by default
    const handleRadius = 8;
    const handleProps = {
      radius: handleRadius,
      fill: "#FFFFFF",
      stroke: color,
      strokeWidth: 2,
      originX: "center" as const,
      originY: "center" as const,
      hasBorders: false,
      hasControls: false,
      selectable: true,
      evented: true,
      visible: false,
    };

    const startHandle = new fabric.Circle({ ...handleProps, left: x1, top: y1 });
    const endHandle = new fabric.Circle({ ...handleProps, left: x2, top: y2 });

    // Cross-reference all three objects
    (arrowPath as any)._isArrow = true;
    (arrowPath as any)._startHandle = startHandle;
    (arrowPath as any)._endHandle = endHandle;
    (arrowPath as any)._arrowColor = color;
    (startHandle as any)._arrowRole = "start";
    (endHandle as any)._arrowRole = "end";
    (startHandle as any)._arrowPath = arrowPath;
    (startHandle as any)._otherHandle = endHandle;
    (startHandle as any)._arrowColor = color;
    (endHandle as any)._arrowPath = arrowPath;
    (endHandle as any)._otherHandle = startHandle;
    (endHandle as any)._arrowColor = color;

    // Cleanup function defined early so it can be referenced in onHandleMove
    const cleanup = () => {
      canvas.off("object:moving", onHandleMove);
      canvas.off("mouse:up", onDragEnd);
    };

    // Label position: centered below the start handle
    function getLabelPos() {
      const above = endHandle.top > startHandle.top;
      return {
        left: startHandle.left,
        top: above ? startHandle.top - 20 : startHandle.top + 20,
        originY: above ? "bottom" : "top",
      };
    }

    // Store cleanup on all parts
    (arrowPath as any)._arrowCleanup = cleanup;

    // Rebuild the arrow path from current handle positions
    function rebuildPath(sh: any, eh: any) {
      const path = sh._arrowPath;
      canvas.remove(path);
      const newPath = new fabric.Path(buildArrowPath(sh.left, sh.top, eh.left, eh.top), {
        stroke: color,
        strokeWidth: strokeW,
        strokeLineCap: "round",
        strokeLineJoin: "round",
        fill: "transparent",
        selectable: true,
        evented: true,
        hasBorders: false,
        hasControls: false,
        perPixelTargetFind: true,
        lockRotation: true,
        objectCaching: false,
      });
      (newPath as any)._isArrow = true;
      (newPath as any)._startHandle = sh;
      (newPath as any)._endHandle = eh;
      (newPath as any)._arrowColor = color;
      (newPath as any)._arrowCleanup = cleanup;

      const existingLabel = path._arrowLabel;
      (newPath as any)._arrowLabel = existingLabel;
      if (existingLabel) existingLabel._parentArrow = newPath;
      sh._arrowPath = newPath;
      eh._arrowPath = newPath;
      canvas.insertAt(canvas.getObjects().indexOf(sh), newPath);
      return newPath;
    }

    // Path drag state — tracks previous position per drag operation
    let pathDragActive = false;
    let prevPathLeft = 0;
    let prevPathTop = 0;

    // Get the current path for this arrow (may change via rebuildPath)
    function isMyObject(target: any): boolean {
      if (target === startHandle || target === endHandle) return true;
      // Check if target is the current path for this arrow
      if (target === startHandle._arrowPath) return true;
      return false;
    }

    // Update arrow when a handle or the path itself moves
    function onHandleMove(e: any) {
      const target = e.target;
      if (!target || !isMyObject(target)) return;

      // Handle endpoint drag — stretch the arrow
      if (target === startHandle || target === endHandle) {
        pathDragActive = false;
        const sh = startHandle;
        const eh = endHandle;
        rebuildPath(sh, eh);
        const label = sh._arrowPath?._arrowLabel;
        if (label) label.set(getLabelPos());
        canvas.renderAll();
        return;
      }

      // Arrow path drag — move everything together
      if (target._isArrow) {
        // First move of this drag — initialize tracking
        if (!pathDragActive) {
          pathDragActive = true;
          prevPathLeft = target.left;
          prevPathTop = target.top;
          return;
        }
        const dx = target.left - prevPathLeft;
        const dy = target.top - prevPathTop;
        prevPathLeft = target.left;
        prevPathTop = target.top;
        if (dx === 0 && dy === 0) return;
        startHandle.set({ left: startHandle.left + dx, top: startHandle.top + dy });
        startHandle.setCoords();
        endHandle.set({ left: endHandle.left + dx, top: endHandle.top + dy });
        endHandle.setCoords();
        const label = target._arrowLabel;
        if (label) label.set({ left: label.left + dx, top: label.top + dy });
        canvas.renderAll();
        return;
      }
    }

    // When drag ends, rebuild path to sync with final handle positions
    function onDragEnd(e: any) {
      const target = e.target;
      if (!target || !isMyObject(target)) return;
      if (target._isArrow && pathDragActive) {
        pathDragActive = false;
        rebuildPath(startHandle, endHandle);
        const label = startHandle._arrowPath?._arrowLabel;
        if (label) label.set(getLabelPos());
        canvas.renderAll();
      }
    }

    canvas.on("object:moving", onHandleMove);
    canvas.on("mouse:up", onDragEnd);

    // Store cleanup on handles too
    (startHandle as any)._arrowCleanup = cleanup;
    (endHandle as any)._arrowCleanup = cleanup;

    return { arrowPath, startHandle, endHandle, rebuildPath };
  }

  function handleArrowAddText(handle: any) {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric || !handle) return;

    // Place text centered above or below the tail depending on arrow direction
    const startH = handle._arrowRole === "start" ? handle : handle._otherHandle;
    const endH = handle._arrowRole === "end" ? handle : handle._otherHandle;
    const arrowPath = startH._arrowPath;
    const above = endH.top > startH.top;
    const label = new fabric.IText("Label", {
      left: startH.left,
      top: above ? startH.top - 20 : startH.top + 20,
      fontSize: 20,
      fill: handle._arrowColor || "#F59E0B",
      fontFamily: "Arial",
      fontWeight: "bold",
      stroke: "#000000",
      strokeWidth: 0.5,
      padding: 4,
      originX: "center",
      originY: above ? "bottom" : "top",
    });
    // Attach label to the arrow so it moves with the tail
    if (arrowPath) {
      (arrowPath as any)._arrowLabel = label;
      (label as any)._parentArrow = arrowPath;
    }
    canvas.add(label);
    canvas.setActiveObject(label);
    label.enterEditing();
    label.selectAll();
    canvas.renderAll();
    setArrowToolbar(null);
  }

  function handleArrowCopy(handle: any) {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric || !handle) return;

    const startH = handle._arrowRole === "start" ? handle : handle._otherHandle;
    const endH = handle._arrowRole === "end" ? handle : handle._otherHandle;
    const color = handle._arrowColor || "#F59E0B";

    // Create a duplicate arrow offset by 30px
    const { arrowPath, startHandle, endHandle } = createArrow(
      fabric, canvas,
      startH.left + 30, startH.top + 30,
      endH.left + 30, endH.top + 30,
      color
    );
    canvas.add(arrowPath);
    canvas.add(startHandle);
    canvas.add(endHandle);
    canvas.renderAll();
    setArrowToolbar(null);
  }

  function handleArrowDelete(handle: any) {
    const canvas = fabricRef.current;
    if (!canvas || !handle) return;

    const other = handle._otherHandle;
    const path = handle._arrowPath;

    // Cleanup listener
    if (handle._arrowCleanup) handle._arrowCleanup();

    // Remove all three objects
    if (path) canvas.remove(path);
    if (other) canvas.remove(other);
    canvas.remove(handle);
    canvas.renderAll();
    setArrowToolbar(null);
  }

  // Tool behavior
  useEffect(() => {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !canvasReady || !fabric) return;

    canvas.off("mouse:down");
    canvas.off("mouse:move");
    canvas.off("mouse:up");

    if (activeTool === "freehand") {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
      canvas.freeDrawingBrush.color = activeColor;
      canvas.freeDrawingBrush.width = 4;
      canvas.selection = false;
    } else if (activeTool === "select") {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.forEachObject((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
        // Arrow paths: no bounding box but still draggable
        if (obj._isArrow) {
          obj.hasBorders = false;
          obj.hasControls = false;
        }
      });
      // Detect arrow path clicks in select mode too
      canvas.on("mouse:down", (opt: any) => {
        const target = opt.target;
        if (target?._isArrow) {
          if (target._startHandle) { target._startHandle.visible = true; target._startHandle.setCoords(); }
          if (target._endHandle) { target._endHandle.visible = true; target._endHandle.setCoords(); }
          canvas.renderAll();
          const canvasEl = canvas.getElement();
          const rect = canvasEl.getBoundingClientRect();
          const sh = target._startHandle;
          const eh = target._endHandle;
          if (sh && eh) {
            const midX = (sh.left + eh.left) / 2;
            const midY = Math.min(sh.top, eh.top);
            setArrowToolbar({ x: rect.left + midX - 56, y: rect.top + midY, handle: sh });
          }
        } else if (!target?._arrowRole) {
          // Clicked something else or empty — hide arrow handles
          canvas.getObjects().forEach((obj: any) => {
            if (obj._arrowRole && obj.visible) obj.visible = false;
          });
          setArrowToolbar(null);
          canvas.renderAll();
        }
      });
    } else if (activeTool === "text") {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      canvas.on("mouse:down", (opt: any) => {
        if (opt.target) return;
        const pointer = canvas.getScenePoint(opt.e);
        const text = new fabric.IText("Text", {
          left: pointer.x,
          top: pointer.y,
          fontSize: 22,
          fill: activeColorRef.current,
          fontFamily: "Arial",
          fontWeight: "bold",
          stroke: "#000000",
          strokeWidth: 0.5,
          padding: 4,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        canvas.renderAll();
      });
    } else if (activeTool === "crop") {
      // Crop mode handled separately
      canvas.isDrawingMode = false;
      canvas.selection = false;
    } else {
      // Shape tools: circle, rectangle, arrow
      canvas.isDrawingMode = false;
      canvas.selection = false;

      canvas.on("mouse:down", (opt: any) => {
        const target = opt.target;
        // If clicking an arrow path or handle, activate it for editing
        if (target?._isArrow || target?._arrowRole) {
          if (target._arrowRole) return;
          // Clicked the arrow path — show handles and toolbar, keep selected for drag
          const ap = target;
          if (ap._startHandle) { ap._startHandle.visible = true; ap._startHandle.setCoords(); }
          if (ap._endHandle) { ap._endHandle.visible = true; ap._endHandle.setCoords(); }
          canvas.renderAll();
          const canvasEl = canvas.getElement();
          const rect = canvasEl.getBoundingClientRect();
          const sh = ap._startHandle;
          const eh = ap._endHandle;
          if (sh && eh) {
            const midX = (sh.left + eh.left) / 2;
            const midY = Math.min(sh.top, eh.top);
            setArrowToolbar({ x: rect.left + midX - 56, y: rect.top + midY, handle: sh });
          }
          return;
        }
        if (target) return;
        // Clicked empty space — hide any visible arrow handles
        canvas.getObjects().forEach((obj: any) => {
          if (obj._arrowRole && obj.visible) obj.visible = false;
        });
        setArrowToolbar(null);
        canvas.renderAll();
        const pointer = canvas.getScenePoint(opt.e);
        isDrawingShape.current = true;
        shapeStart.current = { x: pointer.x, y: pointer.y };
        currentShape.current = null;
      });

      canvas.on("mouse:move", (opt: any) => {
        if (!isDrawingShape.current) return;
        const pointer = canvas.getScenePoint(opt.e);
        const tool = activeToolRef.current;
        const color = activeColorRef.current;
        const { x: sx, y: sy } = shapeStart.current;
        const dx = pointer.x - sx;
        const dy = pointer.y - sy;

        if (currentShape.current) {
          canvas.remove(currentShape.current);
        }

        let shape: any;

        if (tool === "circle") {
          shape = new fabric.Ellipse({
            left: Math.min(sx, pointer.x),
            top: Math.min(sy, pointer.y),
            rx: Math.abs(dx) / 2,
            ry: Math.abs(dy) / 2,
            fill: "transparent",
            stroke: color,
            strokeWidth: 3,
            selectable: false,
          });
        } else if (tool === "rectangle") {
          shape = new fabric.Rect({
            left: Math.min(sx, pointer.x),
            top: Math.min(sy, pointer.y),
            width: Math.abs(dx),
            height: Math.abs(dy),
            fill: "transparent",
            stroke: color,
            strokeWidth: 3,
            selectable: false,
          });
        } else if (tool === "arrow") {
          // Preview arrow as a simple temporary path (no handles yet)
          const ang = Math.atan2(pointer.y - sy, pointer.x - sx);
          const hl = 24;
          const hx1 = pointer.x - hl * Math.cos(ang - Math.PI / 6);
          const hy1 = pointer.y - hl * Math.sin(ang - Math.PI / 6);
          const hx2 = pointer.x - hl * Math.cos(ang + Math.PI / 6);
          const hy2 = pointer.y - hl * Math.sin(ang + Math.PI / 6);
          shape = new fabric.Path(
            `M ${sx} ${sy} L ${pointer.x} ${pointer.y} M ${hx1} ${hy1} L ${pointer.x} ${pointer.y} L ${hx2} ${hy2}`,
            {
              stroke: color,
              strokeWidth: 6,
              strokeLineCap: "round",
              strokeLineJoin: "round",
              fill: "transparent",
              selectable: false,
              evented: false,
            }
          );
        }

        if (shape) {
          currentShape.current = shape;
          canvas.add(shape);
          canvas.renderAll();
        }
      });

      canvas.on("mouse:up", (opt: any) => {
        if (!isDrawingShape.current) return;
        isDrawingShape.current = false;

        // For arrows, remove the preview and create the real arrow with handles
        if (activeToolRef.current === "arrow" && currentShape.current) {
          canvas.remove(currentShape.current);
          const pointer = canvas.getScenePoint(opt.e);
          const { x: sx, y: sy } = shapeStart.current;

          // Only create if dragged a meaningful distance
          const dist = Math.sqrt((pointer.x - sx) ** 2 + (pointer.y - sy) ** 2);
          if (dist > 10) {
            const { arrowPath, startHandle, endHandle } = createArrow(
              fabric, canvas, sx, sy, pointer.x, pointer.y, activeColorRef.current
            );
            canvas.add(arrowPath);
            canvas.add(startHandle);
            canvas.add(endHandle);
            canvas.renderAll();
          }
        }

        currentShape.current = null;
      });
    }
  }, [activeTool, activeColor, canvasReady]);

  // Apply image adjustments (brightness, contrast, saturation)
  useEffect(() => {
    const fabric = fabricModuleRef.current;
    const bgImg = bgImageRef.current;
    const canvas = fabricRef.current;
    if (!fabric || !bgImg || !canvas || !canvasReady) return;

    const filters: any[] = [];
    if (brightness !== 0) {
      filters.push(new fabric.filters.Brightness({ brightness }));
    }
    if (contrast !== 0) {
      filters.push(new fabric.filters.Contrast({ contrast }));
    }
    if (saturation !== 0) {
      filters.push(new fabric.filters.Saturation({ saturation }));
    }

    bgImg.filters = filters;
    bgImg.applyFilters();
    canvas.renderAll();
  }, [brightness, contrast, saturation, canvasReady]);

  function handleRotate() {
    const canvas = fabricRef.current;
    const bgImg = bgImageRef.current;
    if (!canvas || !bgImg) return;

    const { width, height, scale } = imgDimensionsRef.current;

    // Swap dimensions
    const newImgWidth = height;
    const newImgHeight = width;

    const maxWidth = window.innerWidth - 72;
    const maxHeight = window.innerHeight;
    const newScale = Math.min(
      maxWidth / newImgWidth,
      maxHeight / newImgHeight,
      1
    );
    const canvasWidth = Math.round(newImgWidth * newScale);
    const canvasHeight = Math.round(newImgHeight * newScale);

    imgDimensionsRef.current = {
      width: newImgWidth,
      height: newImgHeight,
      scale: newScale,
    };

    // Rotate the background image by 90 degrees
    const currentAngle = bgImg.angle || 0;
    const newAngle = currentAngle + 90;

    bgImg.set({
      angle: newAngle,
      scaleX: newScale,
      scaleY: newScale,
      left: canvasWidth / 2,
      top: canvasHeight / 2,
      originX: "center",
      originY: "center",
    });

    canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
    canvas.renderAll();
  }

  function drawCropOverlay(canvas: any) {
    const cropRect = cropRectRef.current;
    if (!cropRect || !canvas.getObjects().includes(cropRect)) return;

    const ctx = canvas.getContext("2d");
    const cw = canvas.width!;
    const ch = canvas.height!;

    const left = cropRect.left!;
    const top = cropRect.top!;
    const w = cropRect.width! * (cropRect.scaleX || 1);
    const h = cropRect.height! * (cropRect.scaleY || 1);

    // Draw dark overlay with hole using evenodd fill rule
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + h);
    ctx.lineTo(left + w, top + h);
    ctx.lineTo(left + w, top);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fill("evenodd");

    // Draw rule-of-thirds grid lines
    const thirdW = w / 3;
    const thirdH = h / 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical lines
    ctx.moveTo(left + thirdW, top);
    ctx.lineTo(left + thirdW, top + h);
    ctx.moveTo(left + 2 * thirdW, top);
    ctx.lineTo(left + 2 * thirdW, top + h);
    // Horizontal lines
    ctx.moveTo(left, top + thirdH);
    ctx.lineTo(left + w, top + thirdH);
    ctx.moveTo(left, top + 2 * thirdH);
    ctx.lineTo(left + w, top + 2 * thirdH);
    ctx.stroke();

    ctx.restore();
  }

  function cleanupCropObjects(canvas: any) {
    // Remove after:render callback for overlay
    if (cropRenderCallbackRef.current) {
      canvas.off("after:render", cropRenderCallbackRef.current);
      cropRenderCallbackRef.current = null;
    }
    // Remove crop rect
    if (cropRectRef.current) {
      canvas.remove(cropRectRef.current);
      cropRectRef.current = null;
    }
    // Restore hidden annotation objects
    hiddenObjectsRef.current.forEach((obj) => {
      obj.visible = true;
    });
    hiddenObjectsRef.current = [];
    // Remove event listeners
    canvas.off("object:moving", handleCropObjMove);
    canvas.off("object:scaling", handleCropObjScale);
  }

  function handleCropObjMove(e: any) {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || e.target !== cropRect) return;

    const cw = canvas.width!;
    const ch = canvas.height!;
    const w = cropRect.width! * (cropRect.scaleX || 1);
    const h = cropRect.height! * (cropRect.scaleY || 1);

    // Clamp position within canvas
    cropRect.set({
      left: Math.max(0, Math.min(cropRect.left!, cw - w)),
      top: Math.max(0, Math.min(cropRect.top!, ch - h)),
    });

    canvas.renderAll();
  }

  function handleCropObjScale(e: any) {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect || e.target !== cropRect) return;

    const cw = canvas.width!;
    const ch = canvas.height!;

    let w = cropRect.width! * (cropRect.scaleX || 1);
    let h = cropRect.height! * (cropRect.scaleY || 1);
    let left = cropRect.left!;
    let top = cropRect.top!;

    // Enforce min size
    if (w < 50) { cropRect.set({ scaleX: 50 / cropRect.width! }); w = 50; }
    if (h < 50) { cropRect.set({ scaleY: 50 / cropRect.height! }); h = 50; }

    // Clamp to canvas bounds
    if (left < 0) cropRect.set({ left: 0 });
    if (top < 0) cropRect.set({ top: 0 });
    if (left + w > cw) cropRect.set({ scaleX: (cw - cropRect.left!) / cropRect.width! });
    if (top + h > ch) cropRect.set({ scaleY: (ch - cropRect.top!) / cropRect.height! });

    canvas.renderAll();
  }

  function handleStartCrop() {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    if (!canvas || !fabric) return;

    setIsCropping(true);
    setActiveTool("crop");

    // Hide existing annotation objects
    const existingObjects = canvas.getObjects().slice();
    existingObjects.forEach((obj: any) => {
      obj.visible = false;
    });
    hiddenObjectsRef.current = existingObjects;

    const cw = canvas.width!;
    const ch = canvas.height!;

    // Create crop rectangle — inset by strokeWidth so border is fully visible
    const sw = 2;
    const cropRect = new fabric.Rect({
      left: sw,
      top: sw,
      width: cw - sw * 2,
      height: ch - sw * 2,
      fill: "rgba(255,255,255,0.01)",
      stroke: "#FFFFFF",
      strokeWidth: sw,
      strokeUniform: true,
      originX: "left",
      originY: "top",
      cornerColor: "#FFFFFF",
      cornerStrokeColor: "#FFFFFF",
      cornerSize: 12,
      transparentCorners: false,
      cornerStyle: "rect",
      selectable: true,
      evented: true,
      lockRotation: true,
      hasRotatingPoint: false,
      perPixelTargetFind: false,
    });
    cropRectRef.current = cropRect;

    // Register after:render callback to draw overlay + grid natively
    const renderCallback = () => drawCropOverlay(canvas);
    cropRenderCallbackRef.current = renderCallback;
    canvas.on("after:render", renderCallback);

    // Add crop rect to canvas
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.renderAll();

    // Listen for crop rect movement/scaling
    canvas.on("object:moving", handleCropObjMove);
    canvas.on("object:scaling", handleCropObjScale);
  }

  function handleResetCrop() {
    const canvas = fabricRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !cropRect) return;

    const cw = canvas.width!;
    const ch = canvas.height!;
    const sw = 2;

    cropRect.set({
      left: sw,
      top: sw,
      width: cw - sw * 2,
      height: ch - sw * 2,
      scaleX: 1,
      scaleY: 1,
    });
    cropRect.setCoords();
    canvas.setActiveObject(cropRect);
    canvas.renderAll();
  }

  async function handleApplyCrop() {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    const cropRect = cropRectRef.current;
    const bgImg = bgImageRef.current;
    if (!canvas || !fabric || !cropRect || !bgImg || !photo) return;

    // Get crop rectangle bounds (in canvas/screen coordinates)
    const left = cropRect.left!;
    const top = cropRect.top!;
    const cWidth = cropRect.width! * (cropRect.scaleX || 1);
    const cHeight = cropRect.height! * (cropRect.scaleY || 1);

    // Remove all crop UI objects before rendering
    cleanupCropObjects(canvas);

    // Render the full canvas at original resolution (bakes in filters + rotation)
    const { scale } = imgDimensionsRef.current;
    const multiplier = 1 / scale;
    const fullResCanvas = canvas.toCanvasElement(multiplier);

    // Calculate crop region in full-res coordinates
    const srcLeft = Math.round(left * multiplier);
    const srcTop = Math.round(top * multiplier);
    const srcWidth = Math.round(cWidth * multiplier);
    const srcHeight = Math.round(cHeight * multiplier);

    // Extract the cropped region
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = srcWidth;
    tempCanvas.height = srcHeight;
    const ctx = tempCanvas.getContext("2d")!;
    ctx.drawImage(fullResCanvas, srcLeft, srcTop, srcWidth, srcHeight, 0, 0, srcWidth, srcHeight);

    // Save backup of original before first crop
    const supabase = createClient();
    const backupPath = photo.storage_path.replace(/\.[^.]+$/, "-original$&");
    if (!hasOriginalBackup) {
      try {
        await supabase.storage.from("photos").copy(photo.storage_path, backupPath);
        setHasOriginalBackup(true);
      } catch (err) {
        console.error("Failed to backup original:", err);
      }
    }

    // Upload cropped image to Supabase Storage, replacing the current
    try {
      const blob = await new Promise<Blob>((resolve) => {
        tempCanvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92);
      });
      await supabase.storage.from("photos").upload(photo.storage_path, blob, {
        upsert: true,
        contentType: "image/jpeg",
      });
    } catch (err) {
      console.error("Failed to upload cropped image:", err);
    }

    // Load the cropped image as new background in the editor
    const croppedDataUrl = tempCanvas.toDataURL("image/jpeg", 0.92);
    const croppedImg = await new Promise<HTMLImageElement>((resolve) => {
      const el = document.createElement("img");
      el.onload = () => resolve(el);
      el.src = croppedDataUrl;
    });

    // Recalculate scale for the new dimensions
    const maxWidth = window.innerWidth - 72;
    const maxHeight = window.innerHeight;
    const newScale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight, 1);
    const newCanvasWidth = Math.round(srcWidth * newScale);
    const newCanvasHeight = Math.round(srcHeight * newScale);

    const newFabricImg = new fabric.FabricImage(croppedImg, {
      left: 0,
      top: 0,
      width: srcWidth,
      height: srcHeight,
      scaleX: newScale,
      scaleY: newScale,
      angle: 0,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });

    // Clear all objects and set new background
    canvas.getObjects().forEach((obj: any) => canvas.remove(obj));
    canvas.setDimensions({ width: newCanvasWidth, height: newCanvasHeight });
    bgImageRef.current = newFabricImg;
    canvas.backgroundImage = newFabricImg;
    canvas.renderAll();

    imgDimensionsRef.current = { width: srcWidth, height: srcHeight, scale: newScale };

    // Reset adjustments since they're now baked into the cropped image
    setBrightness(0);
    setContrast(0);
    setSaturation(0);

    setIsCropping(false);
    setActiveTool("arrow");
    toast.success("Image cropped and saved.");
  }

  async function handleRestoreOriginal() {
    if (!photo || !hasOriginalBackup) return;

    const supabase = createClient();
    const backupPath = photo.storage_path.replace(/\.[^.]+$/, "-original$&");

    try {
      // Download the backup
      const { data: backupBlob } = await supabase.storage.from("photos").download(backupPath);
      if (!backupBlob) throw new Error("Backup not found");

      // Overwrite current with the original backup
      await supabase.storage.from("photos").upload(photo.storage_path, backupBlob, {
        upsert: true,
        contentType: backupBlob.type,
      });

      // Remove the backup file
      await supabase.storage.from("photos").remove([backupPath]);
      setHasOriginalBackup(false);

      // Reload the editor with the restored image
      toast.success("Original image restored.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("Failed to restore original:", err);
      toast.error("Failed to restore original image.");
    }
  }

  function handleCancelCrop() {
    const canvas = fabricRef.current;
    if (canvas) {
      cleanupCropObjects(canvas);
      canvas.renderAll();
    }
    setIsCropping(false);
    setActiveTool("arrow");
  }

  function handleUndo() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objects = canvas.getObjects();
    if (objects.length === 0) return;

    const last = objects[objects.length - 1];

    // If it's part of an arrow, remove all 3 parts (path + 2 handles)
    if (last._isArrow) {
      const sh = last._startHandle;
      const eh = last._endHandle;
      if (last._arrowCleanup) last._arrowCleanup();
      if (sh) canvas.remove(sh);
      if (eh) canvas.remove(eh);
      canvas.remove(last);
    } else if (last._arrowRole) {
      const path = last._arrowPath;
      const other = last._otherHandle;
      if (path?._arrowCleanup) path._arrowCleanup();
      if (path) canvas.remove(path);
      if (other) canvas.remove(other);
      canvas.remove(last);
    } else {
      canvas.remove(last);
    }

    setArrowToolbar(null);
    canvas.renderAll();
  }

  function handleClear() {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.getObjects().forEach((obj: any) => canvas.remove(obj));
    canvas.renderAll();
  }

  async function handleSave() {
    const canvas = fabricRef.current;
    if (!canvas || !photo) return;

    setSaving(true);
    const supabase = createClient();

    try {
      const annotationData = canvas.toJSON();

      const { data: existing } = await supabase
        .from("photo_annotations")
        .select("id")
        .eq("photo_id", photo.id)
        .limit(1)
        .single();

      if (existing) {
        await supabase
          .from("photo_annotations")
          .update({ annotation_data: annotationData })
          .eq("id", existing.id);
      } else {
        await supabase.from("photo_annotations").insert({
          photo_id: photo.id,
          annotation_data: annotationData,
          created_by: "Eric",
        });
      }

      try {
        const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const annotatedPath = photo.storage_path.replace(
          /\.[^.]+$/,
          "-annotated.png"
        );
        await supabase.storage.from("photos").upload(annotatedPath, blob, {
          upsert: true,
          contentType: "image/png",
        });
        await supabase
          .from("photos")
          .update({ annotated_path: annotatedPath })
          .eq("id", photo.id);
      } catch {
        console.log(
          "Could not export annotated image (cross-origin). JSON annotations saved."
        );
      }

      toast.success("Annotations saved.");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error("Save annotation error:", err);
      toast.error("Failed to save annotations.");
    }

    setSaving(false);
  }

  function handleDiscard() {
    onOpenChange(false);
  }

  if (!open || !photo) return null;

  return (
    <div className="fixed inset-0 z-[100] flex bg-[#1a1a1a]">
      {/* Left Sidebar */}
      <div className="w-[56px] bg-[#111111] border-r border-[#333] flex flex-col items-center py-3 gap-1 overflow-y-auto">
        {/* Select tool */}
        <button
          onClick={() => !isCropping && setActiveTool("select")}
          title="Select"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            activeTool === "select"
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <MousePointer size={18} />
        </button>

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Drawing tools */}
        {TOOLS.map((tool) => (
          <button
            key={tool.value}
            onClick={() => !isCropping && setActiveTool(tool.value)}
            title={tool.label}
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
              activeTool === tool.value
                ? "bg-[#2B5EA7] text-white"
                : "text-[#999] hover:text-white hover:bg-[#333]"
            )}
          >
            <tool.icon size={18} />
          </button>
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Colors */}
        {COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => setActiveColor(color.value)}
            title={color.label}
            className={cn(
              "w-6 h-6 rounded-full border-2 transition-all",
              activeColor === color.value
                ? "border-white scale-125"
                : "border-[#555] hover:border-[#888]"
            )}
            style={{ backgroundColor: color.value }}
          />
        ))}

        <div className="w-8 h-px bg-[#333] my-1" />

        {/* Rotate */}
        <button
          onClick={handleRotate}
          title="Rotate 90°"
          disabled={isCropping}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] transition-colors disabled:opacity-30"
        >
          <RotateCw size={18} />
        </button>

        {/* Crop */}
        <button
          onClick={isCropping ? undefined : handleStartCrop}
          title="Crop"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            isCropping
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <Crop size={18} />
        </button>

        {/* Adjustments toggle */}
        <button
          onClick={() => setShowAdjustments(!showAdjustments)}
          title="Adjustments"
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
            showAdjustments
              ? "bg-[#2B5EA7] text-white"
              : "text-[#999] hover:text-white hover:bg-[#333]"
          )}
        >
          <SlidersHorizontal size={18} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo / Clear */}
        <button
          onClick={handleUndo}
          title="Undo"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-white hover:bg-[#333] transition-colors"
        >
          <Undo2 size={18} />
        </button>
        <button
          onClick={handleClear}
          title="Clear All"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#999] hover:text-[#C41E2A] hover:bg-[#333] transition-colors"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {/* Main canvas area */}
      <div className="flex-1 flex flex-col relative">
        {/* Top bar - adjustments panel (if open) */}
        {showAdjustments && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-[#222] border border-[#444] rounded-xl px-5 py-3 flex items-center gap-6 shadow-xl">
            <div className="flex items-center gap-2">
              <Sun size={14} className="text-[#999]" />
              <span className="text-xs text-[#999] w-16">Brightness</span>
              <input
                type="range"
                min="-0.5"
                max="0.5"
                step="0.05"
                value={brightness}
                onChange={(e) => setBrightness(parseFloat(e.target.value))}
                className="w-28 accent-[#2B5EA7]"
              />
              <span className="text-xs text-[#ccc] w-8 text-right">
                {Math.round(brightness * 100)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ContrastIcon size={14} className="text-[#999]" />
              <span className="text-xs text-[#999] w-14">Contrast</span>
              <input
                type="range"
                min="-0.5"
                max="0.5"
                step="0.05"
                value={contrast}
                onChange={(e) => setContrast(parseFloat(e.target.value))}
                className="w-28 accent-[#2B5EA7]"
              />
              <span className="text-xs text-[#ccc] w-8 text-right">
                {Math.round(contrast * 100)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Droplets size={14} className="text-[#999]" />
              <span className="text-xs text-[#999] w-16">Saturation</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={saturation}
                onChange={(e) => setSaturation(parseFloat(e.target.value))}
                className="w-28 accent-[#2B5EA7]"
              />
              <span className="text-xs text-[#ccc] w-8 text-right">
                {Math.round(saturation * 100)}
              </span>
            </div>
            <button
              onClick={() => {
                setBrightness(0);
                setContrast(0);
                setSaturation(0);
              }}
              className="text-xs text-[#999] hover:text-white ml-2"
            >
              Reset
            </button>
          </div>
        )}

        {/* Crop floating panel */}
        {isCropping && (
          <div className="absolute top-4 left-2 z-10 bg-white rounded-xl shadow-2xl w-[170px] overflow-hidden">
            <div className="px-4 pt-3 pb-2">
              <h3 className="text-sm font-semibold text-[#1a1a1a]">Crop Image</h3>
            </div>
            <div className="h-px bg-[#e5e5e5]" />
            <div className="p-3 flex flex-col gap-2">
              <button
                onClick={handleResetCrop}
                className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#333] text-sm font-medium rounded-lg transition-colors"
              >
                Reset Crop
              </button>
              <button
                onClick={handleApplyCrop}
                className="w-full px-3 py-2 bg-[#0F6E56] hover:bg-[#0a5a46] text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <Check size={14} />
                Apply
              </button>
              <button
                onClick={handleCancelCrop}
                className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#e5e5e5] text-[#555] text-sm font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
              {hasOriginalBackup && (
                <>
                  <div className="h-px bg-[#e5e5e5] my-1" />
                  <button
                    onClick={handleRestoreOriginal}
                    className="w-full px-3 py-2 bg-[#f0f0f0] hover:bg-[#FCEBEB] text-[#791F1F] text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ImageOff size={12} />
                    Restore Original
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Arrow action toolbar — positioned above the midpoint of the arrow */}
        {arrowToolbar && (
          <div
            className="absolute z-20 flex items-center gap-0.5 bg-[#333] rounded-lg shadow-xl p-1"
            style={{
              left: arrowToolbar.x,
              top: Math.max(8, arrowToolbar.y - 52),
              transform: "translateX(-50%)",
            }}
          >
            <button
              onClick={() => handleArrowAddText(arrowToolbar.handle)}
              title="Add Text"
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
            >
              <Type size={18} />
            </button>
            <button
              onClick={() => handleArrowCopy(arrowToolbar.handle)}
              title="Duplicate"
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#555] transition-colors"
            >
              <Copy size={18} />
            </button>
            <button
              onClick={() => handleArrowDelete(arrowToolbar.handle)}
              title="Delete"
              className="w-9 h-9 rounded-md flex items-center justify-center text-white hover:bg-[#C41E2A] transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          {!canvasReady && (
            <div className="flex items-center gap-2">
              <Loader2 size={24} className="animate-spin text-[#999]" />
              <span className="text-sm text-[#999]">Loading editor...</span>
            </div>
          )}
          <div className={cn(!canvasReady && "hidden")}>
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Save / Discard - top right */}
        <div className="absolute top-3 right-4 flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save & Close"
            className="w-10 h-10 rounded-full bg-[#0F6E56] hover:bg-[#0a5a46] text-white flex items-center justify-center transition-colors disabled:opacity-50 shadow-lg"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={20} />
            )}
          </button>
          <button
            onClick={handleDiscard}
            title="Discard & Close"
            className="w-10 h-10 rounded-full bg-[#C41E2A] hover:bg-[#A3171F] text-white flex items-center justify-center transition-colors shadow-lg"
          >
            <X size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
