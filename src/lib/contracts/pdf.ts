import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Contract, ContractSigner } from "./types";
import { recolorSignatureToDarkInk } from "./signature-ink";

export interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  license: string;
}

export interface SignedSignature {
  signer: ContractSigner;
  // Raw PNG bytes of the captured signature
  signaturePng: Uint8Array;
}

export interface GenerateSignedPdfArgs {
  contract: Pick<Contract, "id" | "title" | "filled_content_html" | "filled_content_hash" | "signed_at">;
  signatures: SignedSignature[];
  company: CompanyBrand;
}

// ---------- HTML → block tree ----------

type BlockType = "h1" | "h2" | "h3" | "p" | "li-bullet" | "li-numbered" | "hr";

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  placeholder?: boolean;
}

interface Block {
  type: BlockType;
  runs: Run[];
  listIndex?: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");
}

// Minimal HTML parser covering the subset that Tiptap produces for
// contract templates after merge-field resolution. Not a general parser.
function parseHtmlBlocks(html: string): Block[] {
  type Tok =
    | { type: "open"; name: string; attrs: string }
    | { type: "close"; name: string }
    | { type: "void"; name: string; attrs: string }
    | { type: "text"; text: string };

  const tokens: Tok[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) break;
      const raw = html.slice(i + 1, end);
      if (raw.startsWith("!--")) {
        // Comment — skip past -->
        const close = html.indexOf("-->", i);
        i = close === -1 ? html.length : close + 3;
        continue;
      }
      const isClose = raw[0] === "/";
      const selfClose = raw.endsWith("/");
      const body = (isClose ? raw.slice(1) : raw).replace(/\/$/, "").trim();
      const m = body.match(/^([a-zA-Z0-9]+)(\s[\s\S]*)?$/);
      if (!m) {
        i = end + 1;
        continue;
      }
      const name = m[1].toLowerCase();
      const attrs = (m[2] ?? "").trim();
      const isVoid =
        selfClose || name === "br" || name === "hr" || name === "img";
      if (isClose) tokens.push({ type: "close", name });
      else if (isVoid) tokens.push({ type: "void", name, attrs });
      else tokens.push({ type: "open", name, attrs });
      i = end + 1;
    } else {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      const text = html.slice(i, end);
      if (text) tokens.push({ type: "text", text });
      i = end;
    }
  }

  const blocks: Block[] = [];
  let current: Block | null = null;
  const formatStack: Array<"b" | "i" | "placeholder"> = [];
  const listStack: Array<{ kind: "ul" | "ol"; index: number }> = [];

  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  const isPlaceholderSpan = (attrs: string) =>
    /merge-field-unresolved/.test(attrs);

  for (const t of tokens) {
    if (t.type === "open") {
      if (t.name === "h1" || t.name === "h2" || t.name === "h3") {
        flush();
        current = { type: t.name, runs: [] };
      } else if (t.name === "p") {
        flush();
        current = { type: "p", runs: [] };
      } else if (t.name === "ul" || t.name === "ol") {
        flush();
        listStack.push({ kind: t.name, index: 0 });
      } else if (t.name === "li") {
        flush();
        const list = listStack[listStack.length - 1];
        if (list) list.index++;
        current = {
          type: list?.kind === "ol" ? "li-numbered" : "li-bullet",
          runs: [],
          listIndex: list?.index,
        };
      } else if (t.name === "strong" || t.name === "b") {
        formatStack.push("b");
      } else if (t.name === "em" || t.name === "i") {
        formatStack.push("i");
      } else if (t.name === "span" && isPlaceholderSpan(t.attrs)) {
        formatStack.push("placeholder");
      }
    } else if (t.type === "close") {
      if (["h1", "h2", "h3", "p", "li"].includes(t.name)) {
        flush();
      } else if (t.name === "ul" || t.name === "ol") {
        listStack.pop();
      } else if (t.name === "strong" || t.name === "b") {
        const idx = formatStack.lastIndexOf("b");
        if (idx >= 0) formatStack.splice(idx, 1);
      } else if (t.name === "em" || t.name === "i") {
        const idx = formatStack.lastIndexOf("i");
        if (idx >= 0) formatStack.splice(idx, 1);
      } else if (t.name === "span") {
        const idx = formatStack.lastIndexOf("placeholder");
        if (idx >= 0) formatStack.splice(idx, 1);
      }
    } else if (t.type === "void") {
      if (t.name === "hr") {
        flush();
        blocks.push({ type: "hr", runs: [] });
      } else if (t.name === "br") {
        if (current) current.runs.push({ text: "\n" });
      }
    } else if (t.type === "text") {
      const text = decodeEntities(t.text).replace(/\s+/g, " ");
      if (!text) continue;
      if (!current) current = { type: "p", runs: [] };
      current.runs.push({
        text,
        bold: formatStack.includes("b"),
        italic: formatStack.includes("i"),
        placeholder: formatStack.includes("placeholder"),
      });
    }
  }
  flush();
  return blocks;
}

// ---------- PDF layout ----------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const SIZES: Record<BlockType, number> = {
  h1: 20,
  h2: 16,
  h3: 13,
  p: 11,
  "li-bullet": 11,
  "li-numbered": 11,
  hr: 11,
};

const BLOCK_SPACING_BEFORE: Record<BlockType, number> = {
  h1: 14,
  h2: 12,
  h3: 10,
  p: 6,
  "li-bullet": 4,
  "li-numbered": 4,
  hr: 10,
};

const LINE_HEIGHT_MULT = 1.35;
const LIST_INDENT = 18;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

function pickFont(run: Run, fonts: Fonts): PDFFont {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

// Word-wrap helper. Given a block's runs, yields lines, where each line
// is an array of (text, font, size, placeholder) tokens in reading order.
interface Token {
  text: string;
  font: PDFFont;
  size: number;
  placeholder: boolean;
}

function wrapBlock(
  block: Block,
  fonts: Fonts,
  width: number,
): Token[][] {
  const size = SIZES[block.type];
  const lines: Token[][] = [[]];
  let currentWidth = 0;

  const pushWord = (word: string, font: PDFFont, placeholder: boolean) => {
    if (!word) return;
    const w = font.widthOfTextAtSize(word, size);
    const line = lines[lines.length - 1];
    const needsSpace = line.length > 0;
    const spaceW = needsSpace ? font.widthOfTextAtSize(" ", size) : 0;
    if (currentWidth + spaceW + w > width && line.length > 0) {
      lines.push([]);
      currentWidth = 0;
    }
    const curLine = lines[lines.length - 1];
    if (curLine.length > 0) {
      curLine.push({ text: " ", font, size, placeholder: false });
      currentWidth += spaceW;
    }
    curLine.push({ text: word, font, size, placeholder });
    currentWidth += w;
  };

  for (const run of block.runs) {
    const font = pickFont(run, fonts);
    const segments = run.text.split(/\n/);
    segments.forEach((seg, idx) => {
      if (idx > 0) {
        lines.push([]);
        currentWidth = 0;
      }
      const words = seg.split(/\s+/).filter(Boolean);
      for (const w of words) pushWord(w, font, !!run.placeholder);
    });
  }

  return lines;
}

interface PageCursor {
  page: PDFPage;
  y: number;
}

function newPage(doc: PDFDocument): PageCursor {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  return { page, y: PAGE_H - MARGIN };
}

function ensureSpace(doc: PDFDocument, cursor: PageCursor, needed: number): PageCursor {
  if (cursor.y - needed < MARGIN) {
    return newPage(doc);
  }
  return cursor;
}

function drawBlock(
  doc: PDFDocument,
  cursor: PageCursor,
  block: Block,
  fonts: Fonts,
): PageCursor {
  const size = SIZES[block.type];
  const lineH = size * LINE_HEIGHT_MULT;
  cursor.y -= BLOCK_SPACING_BEFORE[block.type];

  if (block.type === "hr") {
    cursor = ensureSpace(doc, cursor, 12);
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: MARGIN + CONTENT_W, y: cursor.y },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
    cursor.y -= 8;
    return cursor;
  }

  const indent = block.type === "li-bullet" || block.type === "li-numbered" ? LIST_INDENT : 0;
  const marker =
    block.type === "li-bullet"
      ? "• "
      : block.type === "li-numbered"
        ? `${block.listIndex ?? 1}. `
        : "";

  const lines = wrapBlock(block, fonts, CONTENT_W - indent);
  const isBoldBlock = block.type === "h1" || block.type === "h2" || block.type === "h3";
  const markerFont = isBoldBlock ? fonts.bold : fonts.regular;

  for (let li = 0; li < lines.length; li++) {
    cursor = ensureSpace(doc, cursor, lineH);
    cursor.y -= lineH * 0.8;

    let x = MARGIN + indent;
    if (li === 0 && marker) {
      cursor.page.drawText(marker, {
        x: MARGIN + indent - markerFont.widthOfTextAtSize(marker, size) - 2,
        y: cursor.y,
        size,
        font: markerFont,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    for (const tok of lines[li]) {
      // Draw a thin underline behind placeholder tokens for "________".
      if (tok.placeholder && tok.text.trim()) {
        const w = tok.font.widthOfTextAtSize(tok.text, tok.size);
        cursor.page.drawLine({
          start: { x, y: cursor.y - 1 },
          end: { x: x + w, y: cursor.y - 1 },
          thickness: 0.7,
          color: rgb(0.55, 0.55, 0.55),
        });
      }
      const font = isBoldBlock && tok.font === fonts.regular ? fonts.bold : tok.font;
      cursor.page.drawText(tok.text, {
        x,
        y: cursor.y,
        size: tok.size,
        font,
        color: tok.placeholder ? rgb(0.5, 0.5, 0.5) : rgb(0.08, 0.08, 0.08),
      });
      x += tok.font.widthOfTextAtSize(tok.text, tok.size);
    }

    cursor.y -= lineH * 0.2;
  }

  return cursor;
}

function drawSignatureSection(
  doc: PDFDocument,
  cursor: PageCursor,
  signatures: SignedSignature[],
  fonts: Fonts,
  embeds: Map<string, Uint8Array>,
): PageCursor {
  cursor.y -= 20;
  cursor = ensureSpace(doc, cursor, 40);
  cursor.page.drawText("Signatures", {
    x: MARGIN,
    y: cursor.y,
    size: 13,
    font: fonts.bold,
    color: rgb(0.1, 0.1, 0.1),
  });
  cursor.y -= 8;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: MARGIN + CONTENT_W, y: cursor.y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  cursor.y -= 20;

  for (const entry of signatures) {
    const signerBlockHeight = 110;
    cursor = ensureSpace(doc, cursor, signerBlockHeight);

    const key = entry.signer.id;
    const pngBytes = embeds.get(key);
    if (pngBytes) {
      // eslint-disable-next-line no-await-in-loop
      const embedded = sigEmbeds.get(key);
      if (embedded) {
        const maxW = 200;
        const maxH = 60;
        const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        cursor.page.drawImage(embedded.image, {
          x: MARGIN,
          y: cursor.y - h,
          width: w,
          height: h,
        });
        cursor.y -= h;
      }
    }

    cursor.y -= 6;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: MARGIN + 240, y: cursor.y },
      thickness: 0.4,
      color: rgb(0.4, 0.4, 0.4),
    });
    cursor.y -= 14;

    const nameLine = `${entry.signer.typed_name || entry.signer.name}`;
    cursor.page.drawText(nameLine, {
      x: MARGIN,
      y: cursor.y,
      size: 11,
      font: fonts.bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursor.y -= 13;

    const roleLine = [entry.signer.role_label || "Signer", entry.signer.signed_at ? formatDateTime(entry.signer.signed_at) : ""]
      .filter(Boolean)
      .join(" · ");
    cursor.page.drawText(roleLine, {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: fonts.italic,
      color: rgb(0.45, 0.45, 0.45),
    });
    cursor.y -= 20;
  }

  return cursor;
}

// Tiny holder so drawSignatureSection can reach embedded images with
// dimensions intact. Populated per-call before layout starts.
const sigEmbeds = new Map<
  string,
  { image: Awaited<ReturnType<PDFDocument["embedPng"]>>; width: number; height: number }
>();

function drawCertificatePage(
  doc: PDFDocument,
  args: GenerateSignedPdfArgs,
  fonts: Fonts,
): void {
  const { contract, signatures, company } = args;
  let cursor = newPage(doc);

  cursor.page.drawText("Signature Certificate", {
    x: MARGIN,
    y: cursor.y - 24,
    size: 20,
    font: fonts.bold,
    color: rgb(0.08, 0.08, 0.08),
  });
  cursor.y -= 50;

  cursor.page.drawText(company.name || "", {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: fonts.regular,
    color: rgb(0.35, 0.35, 0.35),
  });
  cursor.y -= 14;

  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: MARGIN + CONTENT_W, y: cursor.y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  cursor.y -= 22;

  const writeKV = (label: string, value: string) => {
    cursor.page.drawText(label, {
      x: MARGIN,
      y: cursor.y,
      size: 9,
      font: fonts.bold,
      color: rgb(0.4, 0.4, 0.4),
    });
    cursor.y -= 13;
    const words = value.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const test = line + w;
      if (fonts.regular.widthOfTextAtSize(test, 11) > CONTENT_W) {
        cursor.page.drawText(line, {
          x: MARGIN,
          y: cursor.y,
          size: 11,
          font: fonts.regular,
          color: rgb(0.12, 0.12, 0.12),
        });
        cursor.y -= 14;
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    if (line.trim()) {
      cursor.page.drawText(line, {
        x: MARGIN,
        y: cursor.y,
        size: 11,
        font: fonts.regular,
        color: rgb(0.12, 0.12, 0.12),
      });
      cursor.y -= 14;
    }
    cursor.y -= 6;
  };

  writeKV("Contract", contract.title);
  writeKV("Contract ID", contract.id);
  writeKV("Document hash (SHA-256)", contract.filled_content_hash);
  writeKV("Signed at", contract.signed_at ? formatDateTime(contract.signed_at) : "—");

  cursor.y -= 10;
  cursor.page.drawText("Signers", {
    x: MARGIN,
    y: cursor.y,
    size: 13,
    font: fonts.bold,
    color: rgb(0.1, 0.1, 0.1),
  });
  cursor.y -= 8;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: MARGIN + CONTENT_W, y: cursor.y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  cursor.y -= 20;

  for (const { signer } of signatures) {
    if (cursor.y < MARGIN + 140) cursor = newPage(doc);
    writeKV("Name", signer.typed_name || signer.name);
    writeKV("Email", signer.email);
    writeKV("Role", signer.role_label || "Signer");
    writeKV("IP address", signer.ip_address || "—");
    writeKV("User agent", signer.user_agent || "—");
    writeKV(
      "Timestamps",
      [
        signer.signed_at ? `Signed: ${formatDateTime(signer.signed_at)}` : "",
        signer.esign_consent_at
          ? `ESIGN consent: ${formatDateTime(signer.esign_consent_at)}`
          : "",
      ]
        .filter(Boolean)
        .join("  ·  ") || "—",
    );
    cursor.y -= 10;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: MARGIN + CONTENT_W, y: cursor.y },
      thickness: 0.25,
      color: rgb(0.85, 0.85, 0.85),
    });
    cursor.y -= 16;
  }
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

// ---------- Public entry ----------

export async function generateSignedPdf(args: GenerateSignedPdfArgs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  // Embed each signer's PNG once, stash dimensions for drawing.
  // We recolor every signature to dark ink before embedding so the
  // stroke prints strong on the PDF's white background regardless of
  // what pen color signature_pad captured with.
  sigEmbeds.clear();
  const embeds = new Map<string, Uint8Array>();
  for (const entry of args.signatures) {
    const darkened = await recolorSignatureToDarkInk(entry.signaturePng);
    const img = await doc.embedPng(darkened);
    sigEmbeds.set(entry.signer.id, {
      image: img,
      width: img.width,
      height: img.height,
    });
    embeds.set(entry.signer.id, darkened);
  }

  let cursor = newPage(doc);

  // Header block — company name, document title, date
  const { company, contract } = args;
  cursor.page.drawText(company.name || "Contract", {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: fonts.bold,
    color: rgb(0.35, 0.35, 0.35),
  });
  const headerMeta = [company.phone, company.email].filter(Boolean).join(" · ");
  if (headerMeta) {
    cursor.page.drawText(headerMeta, {
      x: MARGIN,
      y: cursor.y - 14,
      size: 9,
      font: fonts.regular,
      color: rgb(0.5, 0.5, 0.5),
    });
  }
  cursor.y -= 34;
  cursor.page.drawText(contract.title, {
    x: MARGIN,
    y: cursor.y,
    size: 22,
    font: fonts.bold,
    color: rgb(0.06, 0.06, 0.06),
  });
  cursor.y -= 28;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: MARGIN + CONTENT_W, y: cursor.y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
  cursor.y -= 12;

  // Body
  const blocks = parseHtmlBlocks(contract.filled_content_html);
  for (const block of blocks) {
    cursor = drawBlock(doc, cursor, block, fonts);
  }

  // Signatures
  cursor = drawSignatureSection(doc, cursor, args.signatures, fonts, embeds);

  // Certificate on its own page
  drawCertificatePage(doc, args, fonts);

  return doc.save();
}
