// Just enough ZIP to read the NEVO download (a .zip with a CSV inside) without a dependency: the central directory,
// and entries that are stored or deflated. No encryption, no ZIP64. The download also holds large detail tables, so
// an entry can be peeked at (`head`) without unpacking all of it.
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** Unpacked size in bytes. */
  size: number;
  read(): Buffer;
  /** The first bytes of the unpacked entry (at least `bytes` when the entry is that long), cheap for any size. */
  head(bytes?: number): Buffer;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === LOCAL;
}

export function readZip(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record is in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const raw = () => {
      if (buf.readUInt32LE(local) !== LOCAL) throw new Error('broken zip entry');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression (${method})`);
      return buf.subarray(start, start + compressed);
    };
    entries.push({
      name,
      size,
      read() {
        const data = raw();
        return method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
      },
      head(bytes = 16 * 1024) {
        const data = raw();
        if (method === 0) return Buffer.from(data.subarray(0, bytes));
        // Inflate only the start: a cut-off deflate stream gives what it can with a sync flush instead of an error.
        // `bytes` compressed bytes unpack to at least as many, and (deflate tops out near 1:1000) never to much.
        return Buffer.from(zlib.inflateRawSync(data.subarray(0, bytes), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, bytes));
      },
    });
  }
  return entries;
}
