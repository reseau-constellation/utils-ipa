import { CID } from "multiformats/cid";
import { concat } from "uint8arrays/concat";

export function cidValide(cid: unknown): boolean {
  if (typeof cid === "string") {
    try {
      CID.parse(cid);
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
  max?: number
): Promise<Uint8Array | null> {
  let buffer = new Uint8Array(0);

  for await (const buf of stream) {
    buffer = concat([buffer, buf], buffer.length + buf.length);
    if (max !== undefined && buffer.length > max) return null;
  }

  return buffer;
}

// Copié d'orbit-db pour éviter d'avoir à importer orbit-db. Licence MIT
const orbitdb_isValidAdresse = (address: any) => {
  const notEmpty = (e: string) => e !== '' && e !== ' '

  address = address.toString().replace(/\\/g, '/')

  const containsProtocolPrefix = (e: string, i: number) => !((i === 0 || i === 1) && address.toString().indexOf('/orbit') === 0 && e === 'orbitdb')

  const parts = address.toString()
    .split('/')
    .filter(containsProtocolPrefix)
    .filter(notEmpty)

  let accessControllerHash

  const validateHash = (hash: string) => {
    const prefixes = ['zd', 'Qm', 'ba', 'k5']
    for (const p of prefixes) {
      if (hash.indexOf(p) > -1) {
        return true
      }
    }
    return false
  }

  try {
    accessControllerHash = validateHash(parts[0])
      ? CID.parse(parts[0]).toString()
      : null
  } catch (e) {
    return false
  }

  return accessControllerHash !== null
}

export function adresseOrbiteValide(adresse: unknown): boolean {
  return (
    typeof adresse === "string" &&
    adresse.startsWith("/orbitdb/") &&
    orbitdb_isValidAdresse(adresse)
  );
}
