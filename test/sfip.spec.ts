import { idcValide } from "@/index.js";
import { expect } from "aegir/chai";

describe("Utils", function () {
  describe("idcValide", function () {
    it("valide", () => {
      const valide = idcValide(
        "QmNR2n4zywCV61MeMLB6JwPueAPqheqpfiA4fLPMxouEmQ",
      );
      expect(valide).to.be.true();
    });
    it("non valide", () => {
      const valide = idcValide("Bonjour, je ne suis pas un IDC.");
      expect(valide).to.be.false();
    });
  });
});
