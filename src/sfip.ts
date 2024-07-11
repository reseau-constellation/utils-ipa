import { CID } from "multiformats/cid";
import { concat } from "uint8arrays/concat";

export function idcValide(idc: unknown): boolean {
  if (typeof idc === "string") {
    try {
      CID.parse(idc);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Identique à it-to-buffer, mais avec option de maximum de taille
export async function toBuffer(
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  max?: number,
): Promise<Uint8Array | null> {
  let buffer = new Uint8Array(0);

  for await (const buf of stream) {
    buffer = concat([buffer, buf], buffer.length + buf.length);
    if (max !== undefined && buffer.length > max) return null;
  }

  return buffer;
}
