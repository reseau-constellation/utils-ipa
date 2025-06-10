import { EventEmitter, once } from "events";
import PQueue from "p-queue";
import deepEqual from "deep-equal";
import type {
  schémaFonctionSuivi,
  schémaFonctionOublier,
  PasNondéfini,
  élémentsBd,
} from "@/types.js";
import { isNull } from "lodash-es";
import { AbortError } from "p-retry";
import { TypedEmitter } from "tiny-typed-emitter";

import type { Journal } from "./types.js";

export const obtenir = async <T>(
  f: (args: {
    si: (f: (x: T) => boolean) => (x: T) => void;
    siDéfini: () => (x: T | undefined) => void;
    siVide: () => (x: T) => void;
    siNul: () => (x: T) => void;
    siPasVide: () => (x: T) => void;
    siPasNul: () => (x: T) => void;
    tous: () => (x: T) => void;
  }) => Promise<schémaFonctionOublier>,
): Promise<T> => {
  const événements = new TypedEmitter<{ résolu: (x: T) => void }>();
  const si = (fTest: (x: T) => boolean): ((x: T) => void) => {
    return (x: T) => {
      const passe = fTest(x);
      if (passe) {
        événements.emit("résolu", x);
      }
    };
  };
  const siDéfini = (): ((x: T | undefined) => void) => {
    // @ts-expect-error Je ne sais pas pourquoi
    return si((x: T | undefined): x is T => x !== undefined);
  };
  const siVide = (): ((x: T) => void) => {
    return si((x) => {
      if (Array.isArray(x)) return x.length === 0;
      else if (typeof x === "object" && !isNull(x))
        return Object.keys(x).length === 0;
      else return false;
    });
  };
  const siNul = (): ((x: T) => void) => {
    return si((x: T) => isNull(x));
  };
  const siPasVide = (): ((x: T) => void) => {
    return si((x) => {
      if (Array.isArray(x)) return x.length > 0;
      else if (typeof x === "object" && !isNull(x))
        return Object.keys(x).length > 0;
      else return false;
    });
  };
  const siPasNul = (): ((x: T) => void) => {
    return si((x: T) => !isNull(x));
  };
  const tous = (): ((x: T) => void) => {
    return si(() => true);
  };

  const promesse = new Promise<T>((résoudre) =>
    événements.once("résolu", résoudre),
  );
  const fOublier = await f({
    si,
    siDéfini,
    siVide,
    siNul,
    siPasVide,
    siPasNul,
    tous,
  });
  after(async () => await fOublier());

  return promesse;
};

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

const ignorerErreurAvorté = <T, A>(
  f: (args: A) => Promise<T>,
): ((args: A) => Promise<T|undefined>) => {
  return async (args): Promise<T|undefined> => {
    try {
      return await f(args);
    } catch (e) {
      if (!(e instanceof AbortError)) {
        throw e;
      }
      return undefined;
    }
  };
};

const avecJournal = <T, A>(
  f: (args: A) => Promise<T>,
  journal: Journal
): ((args: A) => Promise<T|undefined>) => {
  return async (args): Promise<T|undefined> => {
    try {
      return await f(args);
    } catch (e) {
      journal(e);
      return undefined;
    }
  };
};

const dédoubler = <T, A>(
  f: (args: A) => Promise<T>,
): ((args: A) => Promise<T|undefined>) => {
  let valAntérieur: string | undefined = undefined;
  let premièreFois = true;

  return async (args): Promise<T|undefined> => {
    if (premièreFois || (valAntérieur !== JSON.stringify(args))) {
      premièreFois = false;
      valAntérieur = JSON.stringify(args)
      return await f(args)
    };
    return undefined
  };
};

const asynchronifier = <T, A>(
  f: (args: A) => T | Promise<T>,
): ((args: A) => Promise<T>) => {
  return async (x) => await f(x);
};

export const suivreFonctionImbriquée = async <T>({
  fRacine,
  f,
  fSuivre,
  journal,
}: {
  fRacine: (args: {
    fSuivreRacine: (nouvelIdImbriqué?: string) => Promise<void>;
  }) => Promise<schémaFonctionOublier>;
  f: schémaFonctionSuivi<T | undefined>;
  fSuivre: (args: {
    id: string;
    fSuivreBd: schémaFonctionSuivi<T | undefined>;
  }) => Promise<schémaFonctionOublier>;
  journal?: Journal;
}): Promise<schémaFonctionOublier> => {
  let pOublier: Promise<schémaFonctionOublier | void> | undefined;
  let idImbriqué: string | undefined = undefined;
  let premièreFois = true;

  const fEnveloppée = ignorerErreurAvorté(asynchronifier(f))
  const fSuivreEnveloppée = ignorerErreurAvorté(fSuivre)
  const fRacineEnveloppée = ignorerErreurAvorté(fRacine)

  const queue = new PQueue({ concurrency: 1 });

  const créerTâche = (id?: string) => async () => {
    if (id === undefined && premièreFois) {
      pOublier = fEnveloppée(undefined);
      premièreFois = false;
      return
    }
    if (id !== idImbriqué) {
      idImbriqué = id;
      if (pOublier) {
        const fOublier = await pOublier;
        if (fOublier) await ignorerErreurAvorté(fOublier)({});
      };

      if (idImbriqué) {
        const idImbriquéExiste = idImbriqué;
        pOublier = fSuivreEnveloppée({
          id: idImbriquéExiste,
          fSuivreBd: fEnveloppée,
        });
      } else {
        pOublier = fEnveloppée(undefined);
      }
    }
  };

  const oublierRacine = await fRacineEnveloppée({
    fSuivreRacine: async (nouvelIdImbriqué?: string) => {
      await queue.add(créerTâche(nouvelIdImbriqué));
    },
  });
  return async () => {
    if (oublierRacine) await ignorerErreurAvorté(oublierRacine)({});
    await queue.onIdle();
    if (pOublier) {
      const fOublier = await pOublier;
      if (fOublier) await ignorerErreurAvorté(fOublier)({});
    }
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
  let dernierT = 0;
  let val: string | undefined = undefined;
  let annulerRebours: () => void = faisRien;

  return (v: T) =>
    new Promise<boolean>((résoudre) => {
      if (déjàAppellé && JSON.stringify(v) === val) {
        résoudre(false);
        return;
      }

      déjàAppellé = true;
      annulerRebours();
      val = JSON.stringify(v);
      dernierT = Date.now();

      const crono = setTimeout(() => résoudre(true), n);
      annulerRebours = () => {
        if (dernierT) {
          const dif = Date.now() - dernierT
          n += dif * 0.5
        }
        clearTimeout(crono);
        résoudre(false);
      };
    });
};

export const suivreDeFonctionListe = async <
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
  fIdDeBranche = (b) => b as string,
  fRéduction = (branches: U[]) =>
    [...new Set(branches.flat())] as V[],
  journal,
}: {
  fListe: (args: {
    fSuivreRacine: (éléments: T[]) => Promise<void>;
  }) => Promise<W>;
  f: schémaFonctionSuivi<V[]>;
  fBranche: (args: {
    id: string;
    fSuivreBranche: schémaFonctionSuivi<U>;
    branche: T;
  }) => Promise<schémaFonctionOublier | undefined>;
  fIdDeBranche?: (b: T) => string;
  fRéduction?: (branches: U[]) => V[];
  journal?: Journal;
}): Promise<W> => {
  journal = journal ?? console.log;
  const fEnveloppée = avecJournal(ignorerErreurAvorté(asynchronifier(f)), journal);

  interface InterfaceBranches {
    données?: U;
    déjàÉvaluée: boolean;
    fOublier?: schémaFonctionOublier;
  }
  const arbre: { [key: string]: InterfaceBranches } = {};
  const dictBranches: { [key: string]: T } = {};
  let pFinaleIntiale: Promise<void>|undefined = undefined;

  const fFinale = async () => {
    // Arrêter si aucune des branches n'a encore donné son premier résultat
    if (
      Object.values(arbre).length &&
      Object.values(arbre).every((x) => !x.déjàÉvaluée)
    )
    return;
    
    const listeDonnées = Object.values(arbre)
      .map((x) => x.données)
      .filter((d) => d !== undefined) as U[];
    const réduits = fRéduction(listeDonnées);
    await fEnveloppée(réduits);
  };
  const queue = new PQueue({ concurrency: 1 });

  const fSuivreRacine = async (éléments: Array<T>) => {
    const tâche = async () => {
      if (éléments.some((x) => typeof fIdDeBranche(x) !== "string")) {
        throw new Error(
          "Définir fIdDeBranche (qui doit rendre une chaîne) si les éléments ne sont pas en format texte (chaînes).",
        );
      }
      const dictÉléments = Object.fromEntries(
        éléments.map((é) => [fIdDeBranche(é), é]),
      );
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

      await Promise.allSettled(
        changés.map(async (c) => {
          if (arbre[c]) {
            await arbre[c].fOublier?.();
            delete arbre[c];
          }
        }),
      );

      await Promise.allSettled(
        disparus.map(async (d) => {
          await arbre[d].fOublier?.();
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

          const idBranche = fIdDeBranche(élément);
          const fSuivreBranche = async (données: U) => {
            arbre[n].données = données;
            arbre[n].déjàÉvaluée = true;
            await fFinale();
          };
          // Ignorer les erreurs d'avortement avant de passer au journal
          arbre[n].fOublier = await avecJournal(ignorerErreurAvorté(fBranche), journal)({
            id: idBranche,
            fSuivreBranche,
            branche: élément,
          });
        }),
      );
      if (pFinaleIntiale) await pFinaleIntiale
      pFinaleIntiale = fFinale();
    };
    await queue.add(tâche);
  };

  const retourRacine = await fListe({ fSuivreRacine: dédoubler(fSuivreRacine) });

  let oublierRacine: schémaFonctionOublier;

  const fOublier = async () => {
    await oublierRacine();
    await queue.onIdle();
    await Promise.allSettled(
      [pFinaleIntiale, ...Object.values(arbre).map(async (x) => await (x.fOublier)?.())],
    );
  };

  if (typeof retourRacine === "function") {
    oublierRacine = retourRacine;
    return fOublier as W;
  } else {
    oublierRacine = retourRacine.fOublier;
    return Object.assign({}, retourRacine, { fOublier });
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
          // @ts-expect-error Bizarre d'erreur récursion infinie
          typeof val === "object" && !Array.isArray(val)
            ? effacerPropriétésNonDéfinies(val)
            : val!,
        ] as [string, élémentsBd];
      }),
  ) as NoUndefinedField<T>;
};
