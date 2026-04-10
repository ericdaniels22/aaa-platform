export interface Chunk {
  content: string;
  sectionNumber: string | null;
  sectionTitle: string | null;
  pageNumber: number | null;
  chunkIndex: number;
  tokenCount: number;
}

const MAX_CHUNK_TOKENS = 800;

// Rough token estimate: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Section header patterns for IICRC standards.
 * Matches patterns like:
 *   "12.3.10 Antimicrobial Application"
 *   "Section 13 — HVAC Restoration"
 *   "A.1 Appendix Title"
 *   "CHAPTER 5: Psychrometry"
 */
const SECTION_PATTERNS = [
  // Numbered sections: "12.3.10 Title" or "12.3.10. Title"
  /^(\d+(?:\.\d+)*\.?)\s+(.+)$/,
  // "Section N" style
  /^(Section\s+\d+(?:\.\d+)*)\s*[—–:\-]?\s*(.+)$/i,
  // Appendix: "A.1 Title"
  /^([A-Z]\.\d+(?:\.\d+)*)\s+(.+)$/,
  // "CHAPTER N" style
  /^(Chapter\s+\d+)\s*[—–:\-]?\s*(.+)$/i,
];

function parseSectionHeader(line: string): { number: string; title: string } | null {
  const trimmed = line.trim();
  for (const pattern of SECTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { number: match[1].replace(/\.$/, ""), title: match[2].trim() };
    }
  }
  return null;
}

function isLikelyHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // All caps line (common for IICRC standards)
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 120) return true;
  // Has a section pattern
  if (parseSectionHeader(trimmed)) return true;
  return false;
}

/**
 * Split text at paragraph boundaries, respecting a token limit.
 * Returns sub-chunks that each stay under MAX_CHUNK_TOKENS.
 */
function splitAtParagraphs(
  text: string,
  sectionNumber: string | null,
  sectionTitle: string | null,
  pageNumber: number | null,
  startIndex: number
): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const chunks: Chunk[] = [];
  let current = "";
  let idx = startIndex;

  for (const para of paragraphs) {
    const combined = current ? current + "\n\n" + para : para;
    if (estimateTokens(combined) > MAX_CHUNK_TOKENS && current) {
      chunks.push({
        content: current.trim(),
        sectionNumber,
        sectionTitle,
        pageNumber,
        chunkIndex: idx++,
        tokenCount: estimateTokens(current.trim()),
      });
      current = para;
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push({
      content: current.trim(),
      sectionNumber,
      sectionTitle,
      pageNumber,
      chunkIndex: idx++,
      tokenCount: estimateTokens(current.trim()),
    });
  }

  return chunks;
}

/**
 * Chunk extracted text by section structure.
 * Detects IICRC-style numbered sections and splits accordingly.
 * Sections exceeding ~800 tokens are split at paragraph boundaries.
 */
export function chunkBySection(text: string): Chunk[] {
  const lines = text.split("\n");
  const sections: { number: string | null; title: string | null; content: string; pageNumber: number | null }[] = [];
  let currentSection: { number: string | null; title: string | null; lines: string[]; pageNumber: number | null } = {
    number: null,
    title: null,
    lines: [],
    pageNumber: null,
  };

  // Track page numbers from form feed characters or "Page N" markers
  let currentPage: number | null = null;

  for (const line of lines) {
    // Detect page markers
    const pageMatch = line.match(/^\s*(?:Page\s+)?(\d+)\s*$/i);
    if (pageMatch && line.trim().length < 8) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }
    if (line.includes("\f")) {
      currentPage = (currentPage ?? 0) + 1;
      continue;
    }

    const header = parseSectionHeader(line);
    if (header || (isLikelyHeading(line) && currentSection.lines.length > 0)) {
      // Flush current section
      if (currentSection.lines.length > 0) {
        sections.push({
          number: currentSection.number,
          title: currentSection.title,
          content: currentSection.lines.join("\n"),
          pageNumber: currentSection.pageNumber,
        });
      }
      currentSection = {
        number: header?.number ?? null,
        title: header?.title ?? line.trim(),
        lines: [],
        pageNumber: currentPage,
      };
    } else {
      currentSection.lines.push(line);
    }
  }

  // Flush final section
  if (currentSection.lines.length > 0) {
    sections.push({
      number: currentSection.number,
      title: currentSection.title,
      content: currentSection.lines.join("\n"),
      pageNumber: currentSection.pageNumber,
    });
  }

  // Convert sections to chunks, splitting large ones
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const content = section.content.trim();
    if (!content) continue;

    if (estimateTokens(content) <= MAX_CHUNK_TOKENS) {
      chunks.push({
        content,
        sectionNumber: section.number,
        sectionTitle: section.title,
        pageNumber: section.pageNumber,
        chunkIndex,
        tokenCount: estimateTokens(content),
      });
      chunkIndex++;
    } else {
      const subChunks = splitAtParagraphs(content, section.number, section.title, section.pageNumber, chunkIndex);
      chunks.push(...subChunks);
      chunkIndex += subChunks.length;
    }
  }

  return chunks;
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { execFileSync } = await import("child_process");
  const { writeFileSync, unlinkSync } = await import("fs");
  const { join } = await import("path");
  const os = await import("os");

  // Write buffer to temp file, run extraction in a child process
  // to avoid Next.js Turbopack bundling issues with pdfjs
  const tmpPath = join(os.tmpdir(), `pdf-extract-${Date.now()}.pdf`);
  // Build path without path.join so Turbopack NFT won't trace it as a module
  const sep = (await import("path")).sep;
  const scriptPath = [process.cwd(), "src", "lib", "knowledge", "extract-pdf.cjs"].join(sep);

  try {
    writeFileSync(tmpPath, buffer);
    const result = execFileSync("node", [scriptPath, tmpPath], {
      maxBuffer: 50 * 1024 * 1024, // 50MB
      timeout: 120_000,
    });
    return result.toString("utf-8");
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Extract text from a DOCX buffer.
 * Simple XML-based extraction (no external dependency).
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {

  // Parse ZIP manually to find word/document.xml
  let offset = 0;
  const entries: { name: string; compMethod: number; compSize: number; dataOffset: number }[] = [];

  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) === 0x04034b50) {
      const compMethod = buffer.readUInt16LE(offset + 8);
      const compSize = buffer.readUInt32LE(offset + 18);
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
      const dataOffset = offset + 30 + nameLen + extraLen;
      entries.push({ name, compMethod, compSize, dataOffset });
      offset = dataOffset + compSize;
    } else {
      offset++;
    }
  }

  const docEntry = entries.find((e) => e.name === "word/document.xml");
  if (!docEntry) throw new Error("No word/document.xml found in DOCX");

  let xml: string;
  if (docEntry.compMethod === 8) {
    const { inflateRawSync } = await import("zlib");
    const inflated = inflateRawSync(buffer.subarray(docEntry.dataOffset, docEntry.dataOffset + docEntry.compSize));
    xml = inflated.toString("utf8");
  } else {
    xml = buffer.subarray(docEntry.dataOffset, docEntry.dataOffset + docEntry.compSize).toString("utf8");
  }

  // Extract text from <w:t> elements, add newlines at paragraph boundaries
  const paragraphs: string[] = [];
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tMatch;
    const texts: string[] = [];
    while ((tMatch = tRegex.exec(pMatch[0])) !== null) {
      texts.push(tMatch[1]);
    }
    if (texts.length > 0) {
      paragraphs.push(texts.join(""));
    }
  }

  return paragraphs.join("\n");
}
