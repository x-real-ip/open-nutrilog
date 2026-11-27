// Barcode reading in WebAssembly (ZXing), for browsers without BarcodeDetector (Firefox, Safari).
// Loaded only when needed. The .wasm file is served by the app itself, not from a CDN, so scanning also works
// without internet once the app is cached and no third party sees that you scan.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

/** The first valid EAN/UPC code in an image, or null. */
export async function readCode(image: ImageData): Promise<string | null> {
  const results = await readBarcodes(image, { formats: ['EANUPC'], maxNumberOfSymbols: 1, tryHarder: true });
  return results.find((r) => r.isValid && r.text)?.text ?? null;
}
