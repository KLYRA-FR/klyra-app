import { describe, expect, test } from "vitest";
import { situationConsignes } from "@/lib/consignes-projet";

const proposition = { nom: "AGENTS.md" as const, action: "creer" as const, contenu: "" };

describe("situationConsignes", () => {
  test("ni AGENTS.md ni CLAUDE.md : pas encore de consignes", () => {
    const s = situationConsignes({ agentsMd: false, claudeMd: "absent", propositions: [proposition] });
    expect(s.cas).toBe("vierge");
    expect(s.texte).toMatch(/Pas encore de consignes/);
    expect(s.fichier).toBeNull();
  });
  test("les deux fichiers sans import : des consignes existent, on propose seulement de les relier", () => {
    const s = situationConsignes({ agentsMd: true, claudeMd: "sans-import", propositions: [{ nom: "CLAUDE.md", action: "ajouter-import", contenu: "@AGENTS.md\n\n" }] });
    expect(s.cas).toBe("sans-lien");
    expect(s.texte).not.toMatch(/Pas encore/);
    expect(s.fichier).toBe("AGENTS.md");
    expect(s.completer).toBe("Relier AGENTS.md");
  });
  test("un CLAUDE.md seul : ce sont les consignes, AGENTS.md en plus pour les autres IA", () => {
    const s = situationConsignes({ agentsMd: false, claudeMd: "sans-import", propositions: [proposition] });
    expect(s.cas).toBe("claude-seul");
    expect(s.texte).not.toMatch(/Pas encore/);
    expect(s.fichier).toBe("CLAUDE.md");
  });
  test("un AGENTS.md seul, puis tout en place", () => {
    expect(situationConsignes({ agentsMd: true, claudeMd: "absent", propositions: [{ nom: "CLAUDE.md", action: "creer", contenu: "@AGENTS.md\n" }] }).cas).toBe("agents-seul");
    const s = situationConsignes({ agentsMd: true, claudeMd: "importe", propositions: [] });
    expect(s.cas).toBe("en-place");
    expect(s.completer).toBeNull();
  });
});
