import { effacerPropriétésNonDéfinies } from "@/fonctions.js";

import { expect } from "aegir/chai";

describe("Fonctions", function () {
  describe("Effacer propriétés non définies", function () {
    it("N'efface rien d'un objet où tout est défini", () => {
      const original = { a: 1, b: 2 };
      const processé = effacerPropriétésNonDéfinies(original);
      expect(processé).to.deep.equal(original);
    });
    it("Efface des propriétés non valides", () => {
        const original = { a: 1, b: undefined };
        const processé = effacerPropriétésNonDéfinies(original);
        expect(processé).to.deep.equal({ a : 1 });
        expect(Object.keys(processé)).to.not.include("b");
    });
    it("Efface des propriétés imbriquées", () => {
        const original = { a: 1, b: { c: undefined } };
        const processé = effacerPropriétésNonDéfinies(original);
        expect(processé).to.deep.equal({ a : 1, b: {} });
        expect(Object.keys(processé.b)).to.not.include("c");
    })
  });
});

