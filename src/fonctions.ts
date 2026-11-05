import PQueue from "p-queue";
import deepEqual from "fast-deep-equal";
import type { Suivi, Oublier, PasNondéfini, ÉlémentsBd } from "@/types.js";
import { TypedEmitter } from "tiny-typed-emitter";

import type { Journal } from "./types.js";
import { AbortError } from "p-retry";

export const estUnePromesse = (x: unknown): x is Promise<unknown> => {
  return (
    !!x && !!(x as Promise<unknown>).then && !!(x as Promise<unknown>).finally
  );
};

const ignorerErreurAvorté = <T, A>(
  f: (args: A) => Promise<T>,
): ((args: A) => Promise<T | undefined>) => {
  return async (args): Promise<T | undefined> => {
    try {
      return await f(args);
    } catch (e) {
      if (!e.name.includes("AbortError")) {
        throw e;
      }
      return undefined;
    }
  };
};

const avecJournal = <T, A>(
  f: (args: A) => Promise<T>,
  journal: Journal,
): ((args: A) => Promise<T | undefined>) => {
  return async (args): Promise<T | undefined> => {
    try {
      return await f(args);
    } catch (e) {
      journal(e);
      return undefined;
    }
  };
};

const dédupliquer = <T, A>(
  f: (args: A) => Promise<T>,
): ((args: A) => Promise<T | undefined>) => {
  let valAntérieur: A | undefined = undefined;
  let premièreFois = true;

  return async (args): Promise<T | undefined> => {
    if (premièreFois || !deepEqual(valAntérieur, args)) {
      premièreFois = false;
      valAntérieur = args;
      return await f(args);
    }
    return undefined;
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
  // journal,
}: {
  fRacine: (args: {
    fSuivreRacine: (nouvelIdImbriqué?: string) => Promise<void>;
  }) => Promise<Oublier>;
  f: Suivi<T | undefined>;
  fSuivre: (args: {
    id: string;
    fSuivre: Suivi<T | undefined>;
  }) => Promise<Oublier>;
  journal?: Journal;
}): Promise<Oublier> => {
  let pOublier: Promise<Oublier | void> | undefined;
  let idImbriqué: string | undefined = undefined;
  let premièreFois = true;

  const fEnveloppée = ignorerErreurAvorté(asynchronifier(f));
  const fSuivreEnveloppée = ignorerErreurAvorté(fSuivre);
  const fRacineEnveloppée = ignorerErreurAvorté(fRacine);

  const queue = new PQueue({ concurrency: 1 });

  const créerTâche = (id?: string) => async () => {
    if (id === undefined && premièreFois) {
      pOublier = fEnveloppée(undefined);
      premièreFois = false;
      return;
    }
    if (id !== idImbriqué) {
      idImbriqué = id;
      if (pOublier) {
        const fOublier = await pOublier;
        if (fOublier) await ignorerErreurAvorté(fOublier)({});
      }

      if (idImbriqué) {
        const idImbriquéExiste = idImbriqué;
        pOublier = fSuivreEnveloppée({
          id: idImbriquéExiste,
          fSuivre: fEnveloppée,
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
  f: (fSuivi: Suivi<T>) => Promise<Oublier>,
  opts: {
    condition?: (x?: T) => boolean | Promise<boolean>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { condition, signal } = opts;

  let val: T;
  let évaluée = false;

  const événements = new TypedEmitter<{ fini: (val: T) => void }>();

  const fSuivi = async (x: T) => {
    if (!évaluée && (!condition || (await condition(x)))) {
      val = x;
      évaluée = true;
      événements.emit("fini", val);
    }
  };

  const oublier = await f(fSuivi);

  return new Promise(async (résoudre, rejeter) => {
    const avorter = async () => {
      signal?.removeEventListener("abort", avorter);
      await oublier();
      rejeter(new AbortError("Signal avorté"));
    };
    signal?.addEventListener("abort", avorter);
    if (signal?.aborted) await avorter();

    événements.on("fini", async (val) => {
      if (signal?.aborted) return;
      await oublier();
      signal?.removeEventListener("abort", avorter);
      résoudre(val);
    });
    if (évaluée) {
      await oublier();
      signal?.removeEventListener("abort", avorter);
      résoudre(val);
    }
  });
};

export const faisRien = async (): Promise<void> => {
  // Rien à faire
};

export const ignorerNonDéfinis = <T>(f: Suivi<T>): Suivi<T | undefined> => {
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
  let val: T | undefined = undefined;
  let annulerRebours: () => void = faisRien;

  return (v: T) =>
    new Promise<boolean>((résoudre) => {
      if (déjàAppellé && deepEqual(v, val)) {
        résoudre(false);
        return;
      }

      déjàAppellé = true;
      annulerRebours();
      val = v;
      dernierT = Date.now();

      const crono = setTimeout(() => résoudre(true), n);
      annulerRebours = () => {
        if (dernierT) {
          const dif = Date.now() - dernierT;
          n += dif * 0.5;
        }
        clearTimeout(crono);
        résoudre(false);
      };
    });
};

export const suivreDeFonctionListe = async <
  T,
  U extends PasNondéfini,
  V,
  W extends Oublier | ({ fOublier: Oublier } & { [key: string]: unknown }),
>({
  fListe,
  f,
  fBranche,
  fIdDeBranche = (b) => b as string,
  fRéduction = (branches: U[]) => [...new Set(branches.flat())] as V[],
  journal,
}: {
  fListe: (args: {
    fSuivreRacine: (éléments: T[]) => Promise<void>;
  }) => Promise<W>;
  f: Suivi<V[]>;
  fBranche: (args: {
    id: string;
    fSuivreBranche: Suivi<U>;
    branche: T;
  }) => Promise<Oublier | undefined>;
  fIdDeBranche?: (b: T) => string;
  fRéduction?: (branches: U[]) => V[];
  journal?: Journal;
}): Promise<W> => {
  journal = journal ?? console.log;
  const fEnveloppée = avecJournal(
    ignorerErreurAvorté(asynchronifier(f)),
    journal,
  );

  interface InterfaceBranches {
    données?: U;
    déjàÉvaluée: boolean;
    oublier: Oublier | Promise<void>;
  }
  const arbre: { [key: string]: InterfaceBranches } = {};
  const dictBranches: { [key: string]: T } = {};
  let pFinaleIntiale: Promise<void> | undefined = undefined;

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

  const oublierOuAttendreOublie = async (x: Oublier | Promise<void>) => {
    return await (estUnePromesse(x) ? x : x());
  };

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
        changés.map(
          async (c) => await oublierOuAttendreOublie(arbre[c].oublier),
        ),
      );

      await Promise.allSettled(
        disparus.map(
          async (d) => await oublierOuAttendreOublie(arbre[d].oublier),
        ),
      );

      await Promise.allSettled(
        nouveaux.map(async (n: string) => {
          arbre[n] = {
            déjàÉvaluée: false,
            oublier: async () => {
              const pOublier = new Promise<void>(résoudre => {
                pOublierBranche.then(oublier=>oublier?.()).then(()=>{
                  delete arbre[n]
                  résoudre()
                })
              })
              arbre[n].oublier = pOublier
              await pOublier
            }
          };

          dictBranches[n] = dictÉléments[n];

          const fSuivreBranche = async (données: U) => {
            arbre[n].données = données;
            arbre[n].déjàÉvaluée = true;
            await fFinale();
          };
          // Ignorer les erreurs d'avortement avant de passer au journal
          const pOublierBranche = avecJournal(
            ignorerErreurAvorté(fBranche),
            journal,
          )({
            id: n,
            fSuivreBranche,
            branche: dictÉléments[n],
          });
        }),
      );
      if (pFinaleIntiale) await pFinaleIntiale;
      pFinaleIntiale = fFinale();
    };
    queue.add(tâche);
  };

  const retourRacine = await fListe({
    fSuivreRacine: dédupliquer(fSuivreRacine),
  });

  let oublierRacine: Oublier;

  const fOublier = async () => {
    await oublierRacine();
    await queue.onIdle();
    await pFinaleIntiale;
    await Promise.allSettled([
      ...Object.values(arbre).map(
        async ({ oublier }) => await oublierOuAttendreOublie(oublier),
      ),
    ]);
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
  | Array<ÉlémentsBd>
  | undefined;

export const effacerPropriétésNonDéfinies = <
  T extends { [clef: string]: élémentsBdOuNonDéfini | undefined },
>(
  objet: T,
): NoUndefinedField<T> => {
  return Object.fromEntries(
    Object.entries(objet)
      .filter(([_clef, val]) => val !== undefined)
      .map(([clef, val]): [string, ÉlémentsBd] => {
        return [
          clef,
          // @ts-expect-error Bizarre d'erreur de récursion infinie
          typeof val === "object" && !Array.isArray(val)
            ? effacerPropriétésNonDéfinies(val)
            : val!,
        ] as [string, ÉlémentsBd];
      }),
  ) as NoUndefinedField<T>;
};
