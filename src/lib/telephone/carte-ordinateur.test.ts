import { describe, expect, test } from "vitest";
import { carteOrdinateur, depuisQuand, phrasePoste } from "./carte-ordinateur";

const maintenant = new Date(2026, 10, 5, 19, 0).getTime();
const avant = new Date(2026, 10, 5, 18, 42).getTime();
const mac = { cle: "p1", systeme: "mac" as const, nom: "Mac de Camille", ouvert: true, dernierSignal: avant };
const base = { horsLigne: false, derniereDonnee: null, maintenant };

describe("la carte de l'ordinateur (E8-01, E8-03 à E8-06)", () => {
  test("le compte n'a pas répondu : pas de faux état, un squelette", () => {
    expect(carteOrdinateur({ ...base, postes: undefined })).toEqual({ etat: "chargement" });
  });

  test("aucun poste : l'état « aucun », jamais « fermé »", () => {
    expect(carteOrdinateur({ ...base, postes: [] })).toEqual({ etat: "aucun" });
  });

  test("ouvert : son mot, le nom de la machine dessous, l'étiquette bleue", () => {
    expect(carteOrdinateur({ ...base, postes: [mac] })).toEqual({
      etat: "poste",
      titre: "Ton Mac",
      sous: "Mac de Camille",
      etiquette: { texte: "Ouvert", bleue: true },
      phrase: "KLYRA est ouverte sur ton Mac.",
      prevenir: null,
    });
  });

  test("fermé : depuis quand, et « Me prévenir » sous ce poste", () => {
    const carte = carteOrdinateur({ ...base, postes: [{ ...mac, ouvert: false }] });
    expect(carte).toMatchObject({ etiquette: { texte: "Fermé", bleue: false }, phrase: "KLYRA est fermée sur ton Mac depuis 18:42. Tes messages partiront à son ouverture.", prevenir: "p1" });
  });

  test("hors ligne : le dernier état connu daté, sans étiquette ni « Me prévenir »", () => {
    const carte = carteOrdinateur({ ...base, postes: [mac], horsLigne: true, derniereDonnee: avant });
    expect(carte).toMatchObject({ etiquette: null, phrase: "À 18:42, KLYRA était ouverte sur ton Mac. Son état revient avec le réseau.", prevenir: null });
  });

  test("hors ligne, sans date connue : aucune heure inventée", () => {
    const carte = carteOrdinateur({ ...base, postes: [mac], horsLigne: true, derniereDonnee: null });
    expect(carte).toMatchObject({ phrase: "Son état revient avec le réseau." });
  });

  test("plusieurs postes : le compte des ouverts, le nom de celui qui est ouvert", () => {
    const pc = { cle: "p2", systeme: "windows" as const, nom: "PC du bureau", ouvert: true, dernierSignal: avant };
    const carte = carteOrdinateur({ ...base, postes: [{ ...mac, ouvert: false }, pc] });
    expect(carte).toMatchObject({ titre: "Tes ordinateurs", sous: "2 ordinateurs · 1 ouvert", phrase: "KLYRA est ouverte sur PC du bureau.", prevenir: null });
  });
});

describe("les phrases courtes", () => {
  test("depuis quand : aujourd'hui, hier, plus tôt", () => {
    expect(depuisQuand(avant, maintenant)).toBe("depuis 18:42");
    expect(depuisQuand(new Date(2026, 10, 4, 18, 42).getTime(), maintenant)).toBe("depuis hier à 18:42");
    expect(depuisQuand(new Date(2026, 10, 2, 9, 5).getTime(), maintenant)).toBe("depuis le 2 nov. à 09:05");
  });

  test("le poste dans la feuille", () => {
    expect(phrasePoste(mac, maintenant)).toBe("KLYRA est ouverte.");
    expect(phrasePoste({ ...mac, ouvert: false }, maintenant)).toBe("KLYRA est fermée depuis 18:42. Tes messages partiront à son ouverture.");
  });
});
