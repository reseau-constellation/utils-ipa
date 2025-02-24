import type { variables } from "@constl/ipa";

import { CID } from "multiformats/cid";
import { base58btc } from "multiformats/bases/base58";
import gjv from "geojson-validation";

import { idcValide } from "./sfip.js";
import { élémentsBd } from "./types.js";
import { cholqij } from "./cholqij.js";

export const adresseOrbiteValide = (address: string) => {
  // Code de @orbitdb/core
  address = address.toString();

  if (!address.startsWith("/orbitdb") && !address.startsWith("\\orbitdb")) {
    return false;
  }

  address = address.replaceAll("/orbitdb/", "");
  address = address.replaceAll("\\orbitdb\\", "");
  address = address.replaceAll("/", "");
  address = address.replaceAll("\\", "");

  let idc;
  try {
    idc = CID.parse(address, base58btc);
  } catch {
    return false;
  }

  return idc !== undefined;
};

export const formatsFichiers = {
  images: [
    "webp",
    "svg",
    "png",
    "jpg",
    "jpeg",
    "jfif",
    "pjpeg",
    "pjp",
    "gif",
    "avif",
    "apng",
  ],
  vidéo: ["mp4"],
  audio: ["mp3", "ogg", "m4a"],
};

export const idcEtExt = (val: string) => {
  try {
    const [id, fichier] = val.split("/");
    if (idcValide(id)) {
      const ext = fichier.split(".").pop();
      if (ext) {
        return {
          ext,
          fichier,
          id,
        };
      }
    }
  } catch {
    // Rien à faire
  }
  return undefined;
};

export const devinerCatégorie = (
  val: élémentsBd,
): variables.catégorieBaseVariables | undefined => {
  if (typeof val === "boolean") return "booléen";
  else if (typeof val === "string") {
    try {
      const [id, fichier] = val.split("/");
      if (idcValide(id)) {
        const ext = fichier.split(".").pop();
        if (ext && formatsFichiers.images.includes(ext)) return "image";
        else if (ext && formatsFichiers.vidéo.includes(ext)) return "vidéo";
        else if (ext && formatsFichiers.audio.includes(ext)) return "audio";
        else if (ext) return "fichier";
      }
    } catch {
      // Rien à faire
    }
    return adresseOrbiteValide(val) ? "chaîne" : "chaîneNonTraductible";
  } else if (typeof val === "number") {
    if (val > 100000000000) {
      return "horoDatage";
    } else {
      return "numérique";
    }
  } else if (Array.isArray(val)) {
    if (
      val.length === 2 &&
      val.every((x) => typeof x === "number" && x > 100000000000)
    ) {
      return "intervaleTemps";
    } else {
      return undefined;
    }
  } else if (gjv.valid(val)) {
    return "géojson";
  }
  return undefined;
};

export const estUnHoroDatage = (val: unknown): boolean => {
  if (["number", "string"].includes(typeof val)) {
    const date = new Date(val as string | number);
    return !isNaN(date.valueOf());
  } else {
    return cholqij.dateValide(val);
  }
};

export const validFichier = (val: unknown, exts?: string[]): boolean => {
  if (typeof val !== "string") return false;
  let id: string;
  let fichier: string;
  try {
    [id, fichier] = val.split("/");
  } catch {
    return false;
  }
  if (!fichier) return false;
  if (!idcValide(id)) return false;
  if (exts) {
    const ext = fichier.split(".").pop();
    return !!ext && exts.includes(ext);
  }
  return true;
};

export const validerCatégorieBase = ({
  catégorie,
  val,
}: {
  catégorie: variables.catégorieBaseVariables;
  val: unknown;
}) => {
  switch (catégorie) {
    case "numérique":
      return typeof val === "number";
    case "horoDatage": {
      return estUnHoroDatage(val);
    }
    case "intervaleTemps":
      if (!Array.isArray(val)) return false;
      if (val.length !== 2) return false;
      return val.every((d) => estUnHoroDatage(d));
    case "chaîne":
      return typeof val === "string" && adresseOrbiteValide(val);
    case "chaîneNonTraductible":
      return typeof val === "string";
    case "booléen":
      return typeof val === "boolean";
    case "géojson":
      if (!(typeof val === "object")) return false;
      return gjv.valid(val);
    case "vidéo":
      return validFichier(val, formatsFichiers.vidéo);
    case "audio":
      return validFichier(val, formatsFichiers.audio);
    case "image":
      return validFichier(val, formatsFichiers.images);
    case "fichier":
      return validFichier(val);
    default:
      return false;
  }
};

export function validerCatégorieVal({
  val,
  catégorie,
}: {
  val: unknown;
  catégorie: variables.catégorieVariables;
}): boolean {
  if (val === undefined) return true; // Permettre les valeurs manquantes

  if (catégorie.type === "simple") {
    return validerCatégorieBase({ catégorie: catégorie.catégorie, val });
  } else {
    if (Array.isArray(val)) {
      return val.every((v) =>
        validerCatégorieBase({ catégorie: catégorie.catégorie, val: v }),
      );
    } else {
      return false;
    }
  }
}
