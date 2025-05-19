import {
  effacerPropriétésNonDéfinies,
  ignorerNonDéfinis,
  suivreFonctionImbriquée,
} from "@/fonctions.js";
import { schémaFonctionOublier } from "@/types";

import { expect } from "aegir/chai";
import type {
  InterfaceFonction,
  InterfaceContrôlleurRacine,
  InterfaceSuivi,
  Espion,
} from "./utils.js";
import { générerEspion, générerFsTestImbriquées } from "./utils.js";

describe("Fonctions", function () {
  describe("Suivi imbriquées", function () {
    let fRacine: InterfaceContrôlleurRacine;
    let fSuivre: InterfaceSuivi;
    let f: InterfaceFonction;

    let fOublier: schémaFonctionOublier;

    beforeEach(async function () {
      ({ fRacine, fSuivre, f } = générerFsTestImbriquées());
      fOublier = await suivreFonctionImbriquée({
        fRacine: fRacine.fonction,
        f: f.fonction,
        fSuivre: fSuivre.fonction,
      });
    });
    afterEach(async function () {
      await fOublier();
    });

    it("Vide pour commencer", async () => {
      expect(fSuivre.appeléeAvec).to.deep.equal([]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal([]);
    });
    it("Suivi déclanché", async () => {
      await fRacine("a");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
    });
    it("Suivi f déclanché", async () => {
      const suiviA = await fRacine("a");
      suiviA("a1");
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1"]);
    });
    it("Non dupliqué si racine est identique", async () => {
      await fRacine("a");
      await fRacine("a");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
    });
    it("Changement d'id pour fonction imbriquée", async () => {
      await fRacine("a");
      await fRacine("b");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b"]);
    });
    it("Retour à valeur initial pour fonction imbriquée", async () => {
      await fRacine("a");
      await fRacine("b");
      await fRacine("a");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b", "a"]);
    });
    it("Changement de fonction suivi", async () => {
      const suiviA = await fRacine("a");
      suiviA("a1");
      const suiviB = await fRacine("b");
      await suiviB("b1");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "b1"]);
    });
    it("Id non défini fonction imbriquée", async () => {
      const suiviA = await fRacine("a");
      suiviA("a1");
      fRacine(undefined);
      await fOublier(); // On s'assure que tout a terminé
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", undefined]);
    });
    it("Attente conclusion fonction finale avant de rappeler fonction imbriquée", async () => {
      const suiviA = await fRacine("a");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
      const fA1 = await suiviA("a1");
      await fA1.bloquerRetour();
      const suiviB = await fRacine("b");
      suiviB("b1");
      fA1.conclureRetour();
      // À faire
      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "b1"]);
    });
    it("Id fonction imbriquée plus récent à priorité", async () => {
      const suiviA = await fRacine("a");
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
      suiviA("a1");
      const suiviB = await fRacine("b");
      await suiviB("b1");

      suiviA("a2"); // N'aura aucun impacte

      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "b1"]);
    });

    it("Attente conclusion f racine avant fermeture", async () => {
      const suiviA = await fRacine("a");
      suiviA("a1");
      await fRacine.bloquerOublier();
      const promesseOublier = fOublier();
      suiviA("a2");
      const suiviB = await fRacine("b");
      suiviB("b1");

      fRacine.conclureOublier();
      await promesseOublier;
      expect(fSuivre.appeléeAvec).to.deep.equal(["a", "b"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "a2", "b1"]);
    });
    it("Attente conclusion f suivi avant fermeture", async () => {
      const suiviA = await fRacine("a");
      suiviA("a1");
      await suiviA.bloquerOublier();
      const promesseOublier = fOublier();
      suiviA("a2");

      suiviA.conclureOublier();
      await promesseOublier;
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "a2"]);
    });
    it("Attente conclusion f finale avant fermeture", async () => {
      const suiviA = await fRacine("a");
      const fA1 = await suiviA("a1");
      await fA1.bloquerRetour();
      const promesseOublier = fOublier();
      suiviA("a2");

      fA1.conclureRetour();
      await promesseOublier;
      expect(fSuivre.appeléeAvec).to.deep.equal(["a"]);
      expect(f.appeléeAvec.appelléeAvec).to.deep.equal(["a1", "a2"]);
    });
  });

  describe.skip("Suivi fonction liste", function () {
    
  })

  describe("Effacer propriétés non définies", function () {
    it("N'efface rien d'un objet où tout est défini", () => {
      const original = { a: 1, b: 2 };
      const processé = effacerPropriétésNonDéfinies(original);
      expect(processé).to.deep.equal(original);
    });
    it("Efface des propriétés non valides", () => {
      const original = { a: 1, b: undefined };
      const processé = effacerPropriétésNonDéfinies(original);
      expect(processé).to.deep.equal({ a: 1 });
      expect(Object.keys(processé)).to.not.include("b");
    });
    it("Efface des propriétés imbriquées", () => {
      const original = { a: 1, b: { c: undefined } };
      const processé = effacerPropriétésNonDéfinies(original);
      expect(processé).to.deep.equal({ a: 1, b: {} });
      expect(Object.keys(processé.b)).to.not.include("c");
    });
  });

  describe("Ignorer non définis", function () {
    let f: Espion;
    beforeEach(function () {
      f = générerEspion()
    });

    it("Non défini ne passe pas", async () => {
      const fSansNonDéfinis = ignorerNonDéfinis(f);
      await fSansNonDéfinis(undefined);
      expect(f.appelléeAvec).to.deep.equal([]);
    })
    it("Nul passe", async () => {
      const fSansNonDéfinis = ignorerNonDéfinis(f);
      await fSansNonDéfinis(null);
      expect(f.appelléeAvec).to.deep.equal([null]);
    })
    it("false passe", async () => {
      const fSansNonDéfinis = ignorerNonDéfinis(f);
      await fSansNonDéfinis(false);
      expect(f.appelléeAvec).to.deep.equal([false]);
    })
    it("Autres valeurs valides passent", async () => {
      const fSansNonDéfinis = ignorerNonDéfinis(f);
      await fSansNonDéfinis(1);
      await fSansNonDéfinis(2);
      expect(f.appelléeAvec).to.deep.equal([1, 2]);
    })
  })
});
