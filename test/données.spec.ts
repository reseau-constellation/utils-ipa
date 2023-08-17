import fs from "fs";
import path from "path";

import { traduire, zipper } from "@/données.js";

import { dossiers, attente } from "@constl/utils-tests";
import JSZip from "jszip";
import { isElectronMain, isNode } from "wherearewe";

import { expect } from "aegir/chai";

describe("Utils : données", function () {
  describe("traduire", function () {
    it("premier choix", () => {
      const trad = traduire({ fr: "français", த: "தமிழ்" }, ["த", "fr"]);
      expect(trad).to.equal("தமிழ்");
    });
    it("deuxième choix", () => {
      const trad = traduire({ fr: "français" }, ["த", "fr"]);
      expect(trad).to.equal("français");
    });
    it("non disponible", () => {
      const trad = traduire({ fr: "français" }, ["kaq"]);
      expect(trad).to.be.undefined();
    });
  });
  if (isElectronMain || isNode) {
    describe("zipper", function () {
      let dossier: string;
      let fEffacer: () => void;
      let nomFichier: string;
      let zip: JSZip;

      let attendreFichier: attente.AttendreFichierExiste;

      before(async () => {
        ({ dossier, fEffacer } = await dossiers.dossierTempoTests());
        nomFichier = path.join(dossier, "testZip.zip");
        attendreFichier = new attente.AttendreFichierExiste(nomFichier);
        const fichiersDocs = [
          {
            nom: "fichier1.txt",
            octets: Buffer.from("Je ne suis que du texte."),
          },
        ];
        const fichiersSFIP = [
          {
            nom: "fichierSFIP1.txt",
            octets: Buffer.from("Je le fichier SFIP no. 1."),
          },
          {
            nom: "fichierSFIP2.txt",
            octets: Buffer.from("Je le fichier SFIP no. 2."),
          },
        ];

        await zipper(fichiersDocs, fichiersSFIP, nomFichier);
      });

      after(() => {
        if (attendreFichier) attendreFichier.annuler();
        if (fEffacer) fEffacer();
      });

      it("Le fichier zip est créé", async () => {
        await attendreFichier.attendre();

        zip = await JSZip.loadAsync(fs.readFileSync(nomFichier));
      });
      it("Les documents de base existent", async () => {
        const contenu = await zip.files["fichier1.txt"].async("string");
        expect(contenu).to.equal("Je ne suis que du texte.");
      });
      it("Les fichiers SFIP sont inclus", async () => {
        expect(zip.files["sfip/"].dir).to.be.true();
        const contenuFichierSFIP1 = await zip.files[
          path.join("sfip", "fichierSFIP1.txt")
        ].async("string");
        expect(contenuFichierSFIP1).to.equal("Je le fichier SFIP no. 1.");

        const contenuFichierSFIP2 = await zip.files[
          path.join("sfip", "fichierSFIP2.txt")
        ].async("string");
        expect(contenuFichierSFIP2).to.equal("Je le fichier SFIP no. 2.");
      });
    });
  }
});
