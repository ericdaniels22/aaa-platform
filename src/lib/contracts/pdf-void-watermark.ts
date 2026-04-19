import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

// Stamps a large, semi-transparent "VOIDED" diagonally across every page
// of an existing signed PDF. Used when retroactively voiding a contract
// whose customer has already signed — the original pages, signatures,
// and Signature Certificate remain intact; the watermark just makes the
// voided state unambiguous when the file is reopened later.
export async function stampVoidWatermark(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const text = "VOIDED";
    const size = Math.min(width, height) * 0.28;
    const textWidth = font.widthOfTextAtSize(text, size);
    // Rotate 45° around the page center so the stamp reads diagonally.
    const angleRad = (45 * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const halfW = textWidth / 2;
    const halfH = size / 2;
    const x = cx - halfW * Math.cos(angleRad) + halfH * Math.sin(angleRad);
    const y = cy - halfW * Math.sin(angleRad) - halfH * Math.cos(angleRad);

    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: rgb(0.8, 0.15, 0.15),
      opacity: 0.22,
      rotate: degrees(45),
    });
  }

  return doc.save();
}
