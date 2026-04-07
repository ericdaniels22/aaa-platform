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
  const isDrawingShape = useRef(false);
  const shapeStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentShape = useRef<any>(null);
  const activeToolRef = useRef<Tool>(activeTool);
  const activeColorRef = useRef(activeColor);
  const cropRectRef = useRef<any>(null);
  const cropOverlayRef = useRef<any>(null);
  const cropClipRef = useRef<any>(null);
  const cropGridLinesRef = useRef<any[]>([]);
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

  // Build arrow as a single Path (line + arrowhead) — no bounding box
  function createArrow(
    fabric: any,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string
  ) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 20;

    // Arrowhead points
    const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

    const pathData = `M ${x1} ${y1} L ${x2} ${y2} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`;

    const arrow = new fabric.Path(pathData, {
      stroke: color,
      strokeWidth: 4,
      strokeLineCap: "round",
      strokeLineJoin: "round",
      fill: "transparent",
      selectable: true,
      evented: true,
      hasBorders: false,
      perPixelTargetFind: true,
    });

    return arrow;
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
        if (opt.target) return;
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
          shape = createArrow(fabric, sx, sy, pointer.x, pointer.y, color);
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

        // For arrows, prompt for text label
        if (
          activeToolRef.current === "arrow" &&
          currentShape.current
        ) {
          const pointer = canvas.getScenePoint(opt.e);
          const { x: sx, y: sy } = shapeStart.current;
          const midX = (sx + pointer.x) / 2;
          const midY = (sy + pointer.y) / 2;
          const fabric = fabricModuleRef.current;

          // Add editable text near the arrow midpoint
          const label = new fabric.IText("", {
            left: midX,
            top: midY - 20,
            fontSize: 18,
            fill: activeColorRef.current,
            fontFamily: "Arial",
            fontWeight: "bold",
            stroke: "#000000",
            strokeWidth: 0.3,
            padding: 2,
            textAlign: "center",
          });
          canvas.add(label);
          canvas.setActiveObject(label);
          label.enterEditing();
          canvas.renderAll();
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

  function updateCropOverlay(canvas: any) {
    const cropRect = cropRectRef.current;
    const clipRect = cropClipRef.current;
    if (!cropRect || !clipRect) return;

    // Get the bounding box of the crop rect (accounts for scaling)
    const left = cropRect.left!;
    const top = cropRect.top!;
    const w = cropRect.width! * (cropRect.scaleX || 1);
    const h = cropRect.height! * (cropRect.scaleY || 1);

    // Update the inverted clip to match crop rect position
    clipRect.set({ left, top, width: w, height: h });
    // Force overlay to re-render with updated clip
    const overlay = cropOverlayRef.current;
    if (overlay) {
      overlay.dirty = true;
    }

    const gridLines = cropGridLinesRef.current;
    if (gridLines.length === 4) {
      const thirdW = w / 3;
      const thirdH = h / 3;
      // Vertical lines
      gridLines[0].set({ x1: left + thirdW, y1: top, x2: left + thirdW, y2: top + h });
      gridLines[1].set({ x1: left + 2 * thirdW, y1: top, x2: left + 2 * thirdW, y2: top + h });
      // Horizontal lines
      gridLines[2].set({ x1: left, y1: top + thirdH, x2: left + w, y2: top + thirdH });
      gridLines[3].set({ x1: left, y1: top + 2 * thirdH, x2: left + w, y2: top + 2 * thirdH });
    }

    canvas.renderAll();
  }

  function cleanupCropObjects(canvas: any) {
    // Remove overlay
    if (cropOverlayRef.current) {
      canvas.remove(cropOverlayRef.current);
      cropOverlayRef.current = null;
    }
    cropClipRef.current = null;
    // Remove grid lines
    cropGridLinesRef.current.forEach((l) => canvas.remove(l));
    cropGridLinesRef.current = [];
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

    updateCropOverlay(canvas);
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

    updateCropOverlay(canvas);
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

    // Create single dark overlay with inverted clip (hole for crop area)
    const clipRect = new fabric.Rect({
      left: sw,
      top: sw,
      width: cw - sw * 2,
      height: ch - sw * 2,
      absolutePositioned: true,
      inverted: true,
    });
    cropClipRef.current = clipRect;

    const overlay = new fabric.Rect({
      left: 0,
      top: 0,
      width: cw,
      height: ch,
      fill: "rgba(0, 0, 0, 0.5)",
      stroke: "",
      strokeWidth: 0,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
      clipPath: clipRect,
    });
    cropOverlayRef.current = overlay;

    // Create 4 grid lines (rule of thirds)
    const gridProps = {
      stroke: "rgba(255, 255, 255, 0.5)",
      strokeWidth: 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
    };
    const gridLines = [
      new fabric.Line([0, 0, 0, 0], gridProps), // vertical 1
      new fabric.Line([0, 0, 0, 0], gridProps), // vertical 2
      new fabric.Line([0, 0, 0, 0], gridProps), // horizontal 1
      new fabric.Line([0, 0, 0, 0], gridProps), // horizontal 2
    ];
    cropGridLinesRef.current = gridLines;

    // Add to canvas in order: overlay, grid, crop rect on top
    canvas.add(overlay);
    gridLines.forEach((l) => canvas.add(l));
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);

    // Position overlays and grid
    updateCropOverlay(canvas);

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
    updateCropOverlay(canvas);
  }

  async function handleApplyCrop() {
    const canvas = fabricRef.current;
    const fabric = fabricModuleRef.current;
    const cropRect = cropRectRef.current;
    const bgImg = bgImageRef.current;
    if (!canvas || !fabric || !cropRect || !bgImg) return;

    // Get crop rectangle bounds
    const left = cropRect.left!;
    const top = cropRect.top!;
    const cWidth = cropRect.width! * (cropRect.scaleX || 1);
    const cHeight = cropRect.height! * (cropRect.scaleY || 1);

    // Remove all crop UI objects
    cleanupCropObjects(canvas);

    // Create a temporary canvas to crop
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cWidth;
    tempCanvas.height = cHeight;
    const ctx = tempCanvas.getContext("2d")!;

    // Draw the current canvas content cropped
    ctx.drawImage(
      canvas.toCanvasElement(),
      left,
      top,
      cWidth,
      cHeight,
      0,
      0,
      cWidth,
      cHeight
    );

    // Load the cropped image as new background
    const croppedImg = await new Promise<HTMLImageElement>((resolve) => {
      const el = document.createElement("img");
      el.onload = () => resolve(el);
      el.src = tempCanvas.toDataURL("image/png");
    });

    const newFabricImg = new fabric.FabricImage(croppedImg, {
      left: 0,
      top: 0,
      width: cWidth,
      height: cHeight,
      scaleX: 1,
      scaleY: 1,
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });

    // Clear all objects and set new background
    canvas.getObjects().forEach((obj: any) => canvas.remove(obj));
    canvas.setDimensions({ width: cWidth, height: cHeight });
    bgImageRef.current = newFabricImg;
    canvas.backgroundImage = newFabricImg;
    canvas.renderAll();

    imgDimensionsRef.current = { width: cWidth, height: cHeight, scale: 1 };

    setIsCropping(false);
    setActiveTool("arrow");
    toast.success("Image cropped.");
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
    if (objects.length > 0) {
      canvas.remove(objects[objects.length - 1]);
      canvas.renderAll();
    }
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
            </div>
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
