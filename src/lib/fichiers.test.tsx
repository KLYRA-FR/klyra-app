// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Pieces } from "@/components/chat/Composer";
import { FichiersJoints } from "@/components/chat/MessageParts";
import { PastilleExtension } from "@/components/chat/PastilleExtension";
import { libelleEtape } from "./etapes";
import { nomFichier } from "./fichiers";

const { montrer } = vi.hoisted(() => ({ montrer: vi.fn() }));
vi.mock("@/lib/bridge", () => ({ getBridge: () => ({ fichiers: { montrer } }) }));

const CAS = [
  [String.raw`C:\Users\Pélin\Mes documents\résumé final.pdf`, "résumé final.pdf"],
  [String.raw`\\serveur\équipe\rapport.v2.final.pdf`, "rapport.v2.final.pdf"],
  ["/Users/Pélin/Mes documents/résumé final.pdf", "résumé final.pdf"],
  [String.raw`documents\rapport.v2.final.pdf`, "rapport.v2.final.pdf"],
  ["documents/rapport.v2.final.pdf", "rapport.v2.final.pdf"],
  [String.raw`C:\dossier.v2\README`, "README"],
  ["/dossier.v2/README", "README"],
  ["README", "README"],
  ["rapport.v2.final.pdf", "rapport.v2.final.pdf"],
  [String.raw`C:\projet/src\fichier.tsx`, "fichier.tsx"],
  ["/projet/src/", "src"],
  ["C:\\projet\\src\\", "src"],
] as const;

describe("nom d'un chemin disque", () => {
  test.each(CAS)("%s → %s", (chemin, nom) => {
    expect(nomFichier(chemin)).toBe(nom);
  });

  test("une chaîne vide reste vide", () => {
    expect(nomFichier("")).toBe("");
  });
});

describe("pièces jointes avant et après l'envoi", () => {
  test.each(CAS.slice(0, 10))("affiche %s avec son nom seul", (chemin, nom) => {
    const pieces = renderToStaticMarkup(<Pieces fichiers={[chemin]} onRetirer={() => {}} />);
    expect(pieces).toContain(`>${nom}</span>`);
    expect(pieces).toContain(`aria-label="Retirer ${nom}"`);
    // Le chemin complet reste disponible au survol et n'est pas réécrit.
    expect(pieces).toContain(`title="${chemin}"`);
    expect(renderToStaticMarkup(<FichiersJoints chemins={[chemin]} />)).toContain(`>${nom}</span>`);
  });

  test("montrer/retirer conserve exactement le chemin Windows", () => {
    const chemin = CAS[0][0];
    montrer.mockClear();
    const retirer = vi.fn();
    const pieces = Pieces({ fichiers: [chemin], onRetirer: retirer });
    pieces!.props.children[0].props.children[2].props.onClick();
    expect(retirer).toHaveBeenCalledExactlyOnceWith(chemin);
    const joints = FichiersJoints({ chemins: [chemin] });
    joints.props.children[0].props.onClick();
    expect(montrer).toHaveBeenCalledExactlyOnceWith(chemin);
  });
});

describe("extensions affichées", () => {
  test.each([
    [CAS[0][0], "PDF"],
    [CAS[1][0], "PDF"],
    ["/projet/rapport.v2.final.pdf", "PDF"],
    [String.raw`C:\dossier.v2\README`, "—"],
    ["/dossier.v2/README", "—"],
    ["README", "—"],
    [String.raw`dossier\capture.PNG`, "PNG"],
  ])("%s → %s", (chemin, extension) => {
    expect(renderToStaticMarkup(<PastilleExtension chemin={chemin} />)).toContain(`>${extension}</span>`);
  });
});

describe("libellés des outils", () => {
  test.each([
    ["Read", "file_path", "Lit"],
    ["Write", "file_path", "Crée"],
    ["Edit", "file_path", "Modifie"],
    ["MultiEdit", "file_path", "Modifie"],
    ["NotebookEdit", "notebook_path", "Modifie"],
  ])("%s utilise le nom Windows", (outil, champ, verbe) => {
    expect(libelleEtape(outil, { [champ]: CAS[0][0] }, [])).toBe(`${verbe} ${CAS[0][1]}`);
  });

  test("un fichier absent et une URL gardent leur traitement dédié", () => {
    expect(libelleEtape("Read", {}, [])).toBe("Lit un fichier");
    expect(libelleEtape("WebFetch", { url: "https://exemple.fr/doc.v2/page?fichier=autre.pdf" }, [])).toBe(
      "Lit une page web (exemple.fr)",
    );
  });
});
