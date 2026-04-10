// Standalone PDF extraction script — runs outside Next.js bundler
// Usage: node extract-pdf.cjs <filepath>
// Outputs extracted text to stdout

const { PDFExtract } = require("pdf.js-extract");
const fs = require("fs");

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write("Usage: node extract-pdf.cjs <filepath>\n");
  process.exit(1);
}

const pdf = new PDFExtract();
const buffer = fs.readFileSync(filePath);

pdf.extractBuffer(buffer).then((data) => {
  const text = data.pages
    .map((p) => p.content.map((c) => c.str).join(" "))
    .join("\n");
  process.stdout.write(text);
}).catch((err) => {
  process.stderr.write(`PDF extraction failed: ${err.message}\n`);
  process.exit(1);
});
