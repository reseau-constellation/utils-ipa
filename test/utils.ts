import { schémaFonctionOublier, schémaFonctionSuivi } from "@/types";
import { TypedEmitter } from "tiny-typed-emitter";
import { Semaphore } from "@chriscdn/promise-semaphore";

interface Statut {
  attendreRésolue: (args: { id?: string }) => Promise<void>;
  résoudre: (args: { id?: string }) => void;
}

const générerStatut = (): Statut => {
  let résolue: string | undefined = undefined;
  const événementsStatut = new TypedEmitter<{ résolue: () => void }>();
  return {
    attendreRésolue: async ({ id }: { id?: string }) => {
      if (résolue === id) return;
      await new Promise<void>((résoudre) => {
        const fFinale = () => {
          if (résolue === id) {
            événementsStatut.off("résolue", fFinale);
            résoudre();
          }
        };
        événementsStatut.on("résolue", fFinale);
      });
    },
    résoudre: ({ id }: { id?: string }) => {
      résolue = id;
      événementsStatut.emit("résolue");
    },
  };
};

export interface Espion {
  (args: unknown): void;
  résolue: (args: { val?: string | undefined }) => Promise<void>;
  appelerAvec: (args: { val?: string | undefined }) => void;
  appelléeAvec: unknown[];
}

export const générerEspion = (): Espion => {
  const appelléeAvec: unknown[] = [];
  const événementsStatut = new TypedEmitter<{ résolue: () => void }>();

  return Object.assign(
    (args: unknown) => {
      appelléeAvec.push(args);
    },
    {
      appelléeAvec,
      appelerAvec: ({ val }: { val?: string }) => {
        appelléeAvec.push(val);
        événementsStatut.emit("résolue");
      },
      résolue: async ({ val }: { val?: string }) => {
        if (
          appelléeAvec.length &&
          appelléeAvec[appelléeAvec.length - 1] === val
        )
          return;
        await new Promise<void>((résoudre) => {
          const fFinale = () => {
            if (
              appelléeAvec.length &&
              appelléeAvec[appelléeAvec.length - 1] === val
            ) {
              événementsStatut.off("résolue", fFinale);
              résoudre();
            }
          };
          événementsStatut.on("résolue", fFinale);
        });
      },
    },
  );
};

export interface InterfaceContrôlleurRacine {
  (id: string | undefined): Promise<InterfaceContrôlleurSuivi>;
  fonction: (args: {
    fSuivreRacine: (id?: string | undefined) => Promise<void>;
  }) => Promise<schémaFonctionOublier>;
  bloquerOublier: () => Promise<void>;
  conclureOublier: () => void;
}

export interface InterfaceContrôlleurSuivi {
  (val: string): Promise<InterfaceContrôlleurFonction>;
  bloquerOublier: () => Promise<void>;
  conclureOublier: () => void;
}

export interface InterfaceSuivi {
  fonction: (args: {
    id: string;
    fSuivreBd: schémaFonctionSuivi<string | undefined>;
  }) => Promise<schémaFonctionOublier>;
  appeléeAvec: string[];
}

export interface InterfaceContrôlleurFonction {
  bloquerRetour: () => Promise<void>;
  conclureRetour: () => void;
}

export interface InterfaceFonction {
  fonction: (val: string | undefined) => Promise<void>;
  appeléeAvec: Espion;
}

type ÉvénementsRacine = { val: (val?: string) => void };
type ÉvénementsSuivi = { [clef: string]: (val?: string) => void };

const générerContrôlleurSuivi = async ({
  id,
  événements,
  sémaphore,
  sémaphoreF,
  statut,
}: {
  id?: string;
  événements: TypedEmitter<ÉvénementsSuivi>;
  sémaphore: Semaphore;
  sémaphoreF: Semaphore;
  statut: Statut;
}): Promise<InterfaceContrôlleurSuivi> => {
  await statut.attendreRésolue({ id });
  return Object.assign(
    (val: string) => {
      if (id) événements.emit(id, val);
      return générerContrôlleurFonction({ id, sémaphore: sémaphoreF });
    },
    {
      bloquerOublier: async () => {
        await sémaphore.acquire(id);
      },
      conclureOublier: () => {
        sémaphore.release(id);
      },
    },
  );
};

const générerContrôlleurFonction = async ({
  id,
  sémaphore,
}: {
  id?: string;
  sémaphore: Semaphore;
}): Promise<InterfaceContrôlleurFonction> => {
  return {
    bloquerRetour: async () => {
      await sémaphore.acquire(id);
    },
    conclureRetour: () => {
      sémaphore.release(id);
    },
  };
};

export const générerFsTestImbriquées = (): {
  fRacine: InterfaceContrôlleurRacine;
  fSuivre: InterfaceSuivi;
  f: InterfaceFonction;
} => {
  // Fonction racine
  const sémaphoreRacine = new Semaphore();
  const événementsRacine = new TypedEmitter<ÉvénementsRacine>();
  const événementsSuivi = new TypedEmitter<ÉvénementsSuivi>();
  const statutSuivi = générerStatut();

  const fRacine: InterfaceContrôlleurRacine = Object.assign(
    (id?: string): Promise<InterfaceContrôlleurSuivi> => {
      événementsRacine.emit("val", id);

      return générerContrôlleurSuivi({
        id,
        événements: événementsSuivi,
        sémaphore: sémaphoreSuivi,
        sémaphoreF,
        statut: statutSuivi,
      });
    },
    {
      fonction: async ({
        fSuivreRacine,
      }: {
        fSuivreRacine: (id?: string | undefined) => Promise<void>;
      }): Promise<schémaFonctionOublier> => {
        événementsRacine.on("val", fSuivreRacine);
        const fOublier = async () => {
          await sémaphoreRacine.acquire();
          événementsRacine.off("val", fSuivreRacine);
          sémaphoreRacine.release();
        };
        return fOublier;
      },
      bloquerOublier: async () => {
        await sémaphoreRacine.acquire();
      },
      conclureOublier: () => {
        sémaphoreRacine.release();
      },
    },
  );

  // Fonction suivi
  const fSuivreAppeléeAvec: string[] = [];
  const sémaphoreSuivi = new Semaphore();

  const fSuivre: InterfaceSuivi = {
    fonction: async ({
      id,
      fSuivreBd,
    }: {
      id: string;
      fSuivreBd: schémaFonctionSuivi<string | undefined>;
    }): Promise<schémaFonctionOublier> => {
      fSuivreAppeléeAvec.push(id);
      statutSuivi.résoudre({ id });
      événementsSuivi.on(id, fSuivreBd);
      return async () => {
        await sémaphoreSuivi.acquire(id);
        événementsSuivi.off(id, fSuivreBd);
        sémaphoreSuivi.release(id);
      };
    },
    appeléeAvec: fSuivreAppeléeAvec,
  };

  // Fonction finale
  const fAppeléeAvec = générerEspion();
  const sémaphoreF = new Semaphore();
  const statutF = générerStatut();

  const f: InterfaceFonction = {
    fonction: async (val: string | undefined): Promise<void> => {
      fAppeléeAvec(val);
      statutF.résoudre({ id: val });
      await sémaphoreF.acquire(val);
      sémaphoreF.release(val);
    },
    appeléeAvec: fAppeléeAvec,
  };

  return {
    fRacine,
    fSuivre,
    f,
  };
};
