import { EventEmitter, once } from "events";
import type {
  schémaFonctionSuivi,
  schémaFonctionOublier,
} from "@/types.js";

class ÉmetteurUneFois<T> extends EventEmitter {
  condition: (x: T) => boolean | Promise<boolean>;
  résultatPrêt: boolean;
  fOublier?: schémaFonctionOublier;
  résultat?: T;
  f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>;

  constructor(
    f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>,
    condition?: (x?: T) => boolean | Promise<boolean>
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

export const suivreBdDeFonction = async <T>({
  fRacine,
  f,
  fSuivre,
}: {
  fRacine: (args: {
    fSuivreRacine: (nouvelIdBdCible?: string) => Promise<void>;
  }) => Promise<schémaFonctionOublier>;
  f: schémaFonctionSuivi<T | undefined>;
  fSuivre: (args: {
    id: string;
    fSuivreBd: schémaFonctionSuivi<T | undefined>;
  }) => Promise<schémaFonctionOublier>;
}): Promise<schémaFonctionOublier> => {
  let oublierFSuivre: schémaFonctionOublier | undefined;
  let idBdCible: string | undefined;
  let premièreFois = true;

  const oublierRacine = await fRacine({
    fSuivreRacine: async (nouvelIdBdCible?: string) => {
      if (nouvelIdBdCible === undefined && premièreFois) {
        premièreFois = false;
        await f(undefined);
      }
      if (nouvelIdBdCible !== idBdCible) {
        idBdCible = nouvelIdBdCible;
        if (oublierFSuivre) await oublierFSuivre();

        if (idBdCible) {
          oublierFSuivre = await fSuivre({ id: idBdCible, fSuivreBd: f });
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
}


export const uneFois = async function <T>(
  f: (fSuivi: schémaFonctionSuivi<T>) => Promise<schémaFonctionOublier>,
  condition?: (x?: T) => boolean | Promise<boolean>
): Promise<T> {
  const émetteur = new ÉmetteurUneFois(f, condition);
  const résultat = (await once(émetteur, "fini")) as [T];
  return résultat[0];
};

export const faisRien = async (): Promise<void> => {
  // Rien à faire
};

export const ignorerNonDéfinis = <T>(
  f: schémaFonctionSuivi<T>
): schémaFonctionSuivi<T | undefined> => {
  return async (x: T | undefined) => {
    if (x !== undefined) {
      return await f(x);
    }
  };
};
