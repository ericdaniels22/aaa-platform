import { PNG } from "pngjs";

// Re-colorizes a signature PNG to dark ink. signature_pad produces a
// transparent-background PNG where strokes are painted in a single pen
// color. Early Build 15c tablet builds captured white strokes — which
// are invisible on a white PDF background. Rather than rely on the pen
// color being correct at capture time, we bulk-recolor any non-
// transparent pixel to near-black here before embedding into the PDF,
// preserving the original alpha so anti-aliased stroke edges stay smooth.
//
// Input/output are raw PNG buffers.
export async function recolorSignatureToDarkInk(
  pngBytes: Uint8Array,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    png.parse(Buffer.from(pngBytes), (err, parsed) => {
      if (err) {
        reject(err);
        return;
      }
      const data = parsed.data; // RGBA, 4 bytes per pixel
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue; // fully transparent — leave alone
        // Rewrite RGB to near-black. Keep alpha so edge smoothing stays.
        data[i] = 17; // R (#111827)
        data[i + 1] = 24; // G
        data[i + 2] = 39; // B
      }
      const out = PNG.sync.write(parsed);
      resolve(new Uint8Array(out));
    });
  });
}
