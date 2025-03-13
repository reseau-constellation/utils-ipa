import { EventEmitter, once } from "events";
import Semaphore from "@chriscdn/promise-semaphore";
import deepEqual from "deep-equal";
import type {
  schémaFonctionSuivi,
  schémaFonctionOublier,
  PasNondéfini,
  élémentsBd,
} from "@/types.js";
import { AbortError } from "@libp2p/interface";

class ÉmetteurUneFois<T> extends EventEmitter {
  condition: (x: T) => boolean | Promise<boolean>;
  résultatPrêt: boolean;
  fOublier?: schémaFonctionOublier;
  résultat?: T;
  f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>;

  constructor(
    f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>,
    condition?: (x?: T) => boolean | Promise<boolean>,
  ) {
    super();
    this.condition = condition || (() => true);
    this.résultatPrêt = false;
    this.f = f;
    this.initialiser();
  }

  async initialiser() {
    const fSuivre = async (résultat: T) => {
      if (await this.condition(résultat)) {
        this.résultat = résultat;
        this.résultatPrêt = true;
        if (this.fOublier) this.lorsquePrêt();
      }
    };

    this.fOublier = await this.f(fSuivre);
    this.lorsquePrêt();
  }

  lorsquePrêt() {
    if (this.résultatPrêt) {
      if (!this.fOublier) throw new Error("Fuite !!");
      if (this.fOublier) this.fOublier();
      this.emit("fini", this.résultat);
    }
  }
}

export const suivreBdDeFonction = <T>({
  fRacine,
  f,
  fSuivre,
}: {
  fRacine: (args: {
    fSuivreRacine: (nouvelIdBdCible?: string) => Promise<void>;
  }) => schémaFonctionOublier;
  f: schémaFonctionSuivi<T | undefined>;
  fSuivre: (args: {
    id: string;
    fSuivreBd: schémaFonctionSuivi<T | undefined>;
  }) => schémaFonctionOublier;
}): schémaFonctionOublier => {
  let oublierFSuivre: schémaFonctionOublier | undefined;
  let idBdCible: string | undefined;
  let premièreFois = true;

  const oublierRacine = fRacine({
    fSuivreRacine: async (nouvelIdBdCible?: string) => {
      if (nouvelIdBdCible === undefined && premièreFois) {
        premièreFois = false;
        await f(undefined);
      }
      if (nouvelIdBdCible !== idBdCible) {
        idBdCible = nouvelIdBdCible;
        if (oublierFSuivre) await oublierFSuivre();

        if (idBdCible) {
          oublierFSuivre = fSuivre({ id: idBdCible, fSuivreBd: f });
        } else {
          await f(undefined);
          oublierFSuivre = undefined;
        }
      }
    },
  });
  return async () => {
    await oublierRacine();
    if (oublierFSuivre) await oublierFSuivre();
  };
};

export const uneFois = async function <T>(
  f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>,
  condition?: (x?: T) => boolean | Promise<boolean>,
): Promise<T> {
  const émetteur = new ÉmetteurUneFois(f, condition);
  const résultat = (await once(émetteur, "fini")) as [T];
  return résultat[0];
};

export const faisRien = async (): Promise<void> => {
  // Rien à faire
};

export const ignorerNonDéfinis = <T>(
  f: schémaFonctionSuivi<T>,
): schémaFonctionSuivi<T | undefined> => {
  return async (x: T | undefined) => {
    if (x !== undefined) {
      return await f(x);
    }
  };
};

export const attendreStabilité = <T>(
  n: number,
): ((v: T) => Promise<boolean>) => {
  let déjàAppellé = false;
  let val: string | undefined = undefined;
  let annulerRebours: () => void = faisRien;

  return (v: T) =>
    new Promise<boolean>((résoudre) => {
      if (déjàAppellé && JSON.stringify(v) === val) return;

      déjàAppellé = true;
      annulerRebours();
      val = JSON.stringify(v);

      const crono = setTimeout(() => résoudre(true), n);
      annulerRebours = () => {
        clearTimeout(crono);
        résoudre(false);
      };
    });
};

export const suivreBdsDeFonctionListe = <
  T extends élémentsBd,
  U extends PasNondéfini,
  V,
  W extends
    | schémaFonctionOublier
    | ({ fOublier: schémaFonctionOublier } & { [key: string]: unknown }),
>({
  fListe,
  f,
  fBranche,
  fIdBdDeBranche = (b) => b as string,
  fRéduction = (branches: U[]) =>
    [...new Set(branches.flat())] as unknown as V[],
  fCode = (é) => é as string,
}: {
  fListe: (fSuivreRacine: (éléments: T[]) => Promise<void>) => W;
  f: schémaFonctionSuivi<V[]>;
  fBranche: (
    id: string,
    fSuivreBranche: schémaFonctionSuivi<U>,
    branche: T,
  ) => schémaFonctionOublier | undefined;
  fIdBdDeBranche?: (b: T) => string;
  fRéduction?: (branches: U[]) => V[];
  fCode?: (é: T) => string;
}): W => {
  interface InterfaceBranches {
    données?: U;
    déjàÉvaluée: boolean;
    fOublier?: schémaFonctionOublier;
  }
  const arbre: { [key: string]: InterfaceBranches } = {};
  const dictBranches: { [key: string]: T } = {};

  let prêt = false; // Afin d'éviter d'appeler fFinale() avant que toutes les branches aient été évaluées 1 fois

  const fFinale = async () => {
    if (!prêt) return;

    // Arrêter si aucune des branches n'a encore donnée son premier résultat
    if (
      Object.values(arbre).length &&
      Object.values(arbre).every((x) => !x.déjàÉvaluée)
    )
      return;

    const listeDonnées = Object.values(arbre)
      .map((x) => x.données)
      .filter((d) => d !== undefined) as U[];
    const réduits = fRéduction(listeDonnées);
    await f(réduits);
  };
  const verrou = new Semaphore();

  const fSuivreRacine = async (éléments: Array<T>) => {
    await verrou.acquire("racine");
    if (éléments.some((x) => typeof fCode(x) !== "string")) {
      console.error(
        "Définir fCode si les éléments ne sont pas en format texte (chaînes).",
      );
      throw new Error(
        "Définir fCode si les éléments ne sont pas en format texte (chaînes).",
      );
    }
    const dictÉléments = Object.fromEntries(éléments.map((é) => [fCode(é), é]));
    const existants = Object.keys(arbre);
    let nouveaux = Object.keys(dictÉléments).filter(
      (é) => !existants.includes(é),
    );
    const disparus = existants.filter(
      (é) => !Object.keys(dictÉléments).includes(é),
    );
    const changés = Object.entries(dictÉléments)
      .filter((é) => {
        return !deepEqual(dictBranches[é[0]], é[1]);
      })
      .map((é) => é[0]);
    nouveaux.push(...changés);
    nouveaux = [...new Set(nouveaux)];

    await Promise.all(
      changés.map(async (c) => {
        if (arbre[c]) {
          const fOublier = arbre[c].fOublier;
          if (fOublier) await fOublier();
          delete arbre[c];
        }
      }),
    );

    await Promise.all(
      disparus.map(async (d) => {
        const fOublier = arbre[d].fOublier;
        if (fOublier) await fOublier();
        delete arbre[d];
      }),
    );

    await Promise.all(
      nouveaux.map(async (n: string) => {
        arbre[n] = {
          déjàÉvaluée: false,
        };
        const élément = dictÉléments[n];
        dictBranches[n] = élément;

        const idBdBranche = fIdBdDeBranche(élément);
        const fSuivreBranche = async (données: U) => {
          arbre[n].données = données;
          arbre[n].déjàÉvaluée = true;
          await fFinale();
        };
        const fOublier = await fBranche(idBdBranche, fSuivreBranche, élément);
        arbre[n].fOublier = fOublier;
      }),
    );

    prêt = true;
    await fFinale();

    verrou.release("racine");
  };

  const retourRacine = fListe(fSuivreRacine);

  let oublierBdRacine: schémaFonctionOublier;

  const fOublier = async () => {
    await oublierBdRacine();
    await Promise.all(
      Object.values(arbre).map((x) => x.fOublier && x.fOublier()),
    );
  };
  if (typeof retourRacine === "function") {
    oublierBdRacine = retourRacine;
    return fOublier as W;
  } else {
    oublierBdRacine = retourRacine.fOublier;
    return Object.assign({}, retourRacine, { fOublier });
  }
};

export const réessayer = async <T>({
  f,
  signal,
}: {
  f: () => Promise<T>;
  signal: AbortSignal;
}): Promise<T> => {
  let n = 0
  let avant = Date.now();
  try {
    avant = Date.now();
    return await f();
  } catch {
    if (signal.aborted) throw new AbortError();
    n++
    const maintenant = Date.now();
    const tempsÀAttendre = n * 1000 - (maintenant - avant) 
    if (tempsÀAttendre > 0)
      await new Promise(résoudre => {
      const chrono = setTimeout(résoudre, tempsÀAttendre)
      signal.addEventListener("abort", () => clearInterval(chrono))
    })
    return await réessayer({ f, signal });
  }
};

type NoUndefinedField<T> = {
  [P in keyof T]-?: NoUndefinedField<NonNullable<T[P]>>;
};

type élémentsBdOuNonDéfini =
  | number
  | boolean
  | string
  | { [clef: string]: élémentsBdOuNonDéfini }
  | Array<élémentsBd>
  | undefined;

export const effacerPropriétésNonDéfinies = <
  T extends { [clef: string]: élémentsBdOuNonDéfini | undefined },
>(
  objet: T,
): NoUndefinedField<T> => {
  return Object.fromEntries(
    Object.entries(objet)
      .filter(([_clef, val]) => val !== undefined)
      .map(([clef, val]): [string, élémentsBd] => {
        return [
          clef,
          // @ts-expect-error C'est compliqué
          (typeof val === "object" && !Array.isArray(val)) ? effacerPropriétésNonDéfinies(val) : val!,
        ] as [string, élémentsBd];
      }),
  ) as NoUndefinedField<T>;
};
