import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.ts';
import { Sheet } from './ui.tsx';

// BarcodeDetector is in Chromium (Android Chrome, Vanadium on GrapheneOS) but not yet in the TypeScript DOM types.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/** The native detector when it reads EAN codes; otherwise null (then the WASM reader is used). */
async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (!BD) return null;
  try {
    const supported = await BD.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new BD({ formats }) : null;
  } catch {
    return null;
  }
}

const valid = (code: string) => /^\d{8,14}$/.test(code);

/**
 * Scans a product barcode with the camera. BarcodeDetector where the browser has it, a WebAssembly reader
 * otherwise, and typing the number as the last resort (also when there is no camera or no permission).
 */
export function BarcodeScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'no-camera'>('starting');
  const [manual, setManual] = useState('');
  // Through a ref, so a new callback from the parent doesn't restart the camera.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    setStatus('starting');
    setManual('');
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;

    const finish = (code: string) => {
      stopped = true;
      navigator.vibrate?.(60);
      onCodeRef.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setStatus('no-camera');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch {
        return setStatus('no-camera');
      }
      if (stopped || !videoRef.current) return;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStatus('scanning');

      const native = await nativeDetector();
      // Lazily loaded: most phones never need it.
      const wasm = native ? null : await import('../barcodeWasm.ts').catch(() => null);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            let code: string | null = null;
            if (native) {
              code = (await native.detect(video)).map((b) => b.rawValue).find(valid) ?? null;
            } else if (wasm && ctx) {
              // A centred crop at most 960 px wide is enough for a barcode and keeps the reader fast.
              const w = Math.min(video.videoWidth, 960);
              const h = Math.round((video.videoHeight / video.videoWidth) * w);
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const found = await wasm.readCode(ctx.getImageData(0, 0, w, h));
              code = found && valid(found) ? found : null;
            }
            if (code) return finish(code);
          }
        } catch {
          // A frame that can't be read; try the next one.
        }
        timer = window.setTimeout(() => void tick(), native ? 150 : 250);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [open]);

  const submitManual = () => {
    const code = manual.replace(/\D/g, '');
    if (valid(code)) onCode(code);
  };

  return (
    <Sheet open={open} onClose={onClose} label={t('Scan a barcode', 'Barcode scannen')}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{t('Scan a barcode', 'Barcode scannen')}</h2>
        {status !== 'no-camera' ? (
          <div className="scanner">
            <video ref={videoRef} playsInline muted aria-label={t('Camera', 'Camera')} />
            <div className="scanner-aim" aria-hidden="true" />
            {status === 'starting' && <p className="scanner-note">{t('Starting the camera…', 'Camera starten…')}</p>}
          </div>
        ) : (
          <p className="notice" style={{ margin: 0 }}>
            {t(
              'The camera is not available (no permission, or no camera). Type the number under the barcode instead.',
              'De camera is niet beschikbaar (geen toestemming of geen camera). Typ in plaats daarvan het nummer onder de barcode.',
            )}
          </p>
        )}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            submitManual();
          }}
        >
          <input
            className="input num"
            inputMode="numeric"
            placeholder={t('Barcode number', 'Barcodenummer')}
            aria-label={t('Barcode number', 'Barcodenummer')}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoFocus={status === 'no-camera'}
          />
          <button className="btn" disabled={!valid(manual.replace(/\D/g, ''))}>
            {t('Look up', 'Opzoeken')}
          </button>
        </form>
      </div>
    </Sheet>
  );
}
