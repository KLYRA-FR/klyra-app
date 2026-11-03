import { describe, expect, it } from "vitest";
import { getField, getListe, parseAgentFile, serializeAgentFile, setFields, setListe } from "./agent-file";

/** Une fiche telle que Claude Code les accepte : listes YAML, sous-clés, description repliée. */
const FICHE = `---
name: hugo
displayName: Hugo
description: >
  Dev frontend et backend.
  Appelle Hugo dès qu’il faut coder.
skills:
  - rangement
  - "deploi"
tools: Read, Grep
mcpServers:
  github:
    command: npx
model: opus
---

# Hugo — Dev

Consigne.
`;

describe("en-tête d'une fiche", () => {
  it("lit les listes, les sous-clés et les blocs repliés sans rien perdre", () => {
    const { frontmatter } = parseAgentFile(FICHE);
    expect(getField(frontmatter, "description")).toBe("Dev frontend et backend. Appelle Hugo dès qu’il faut coder.");
    expect(getListe(frontmatter, "skills")).toEqual(["rangement", "deploi"]);
    expect(getListe(frontmatter, "tools")).toEqual(["Read", "Grep"]);
    expect(frontmatter.blocs?.mcpServers).toBe("  github:\n    command: npx");
    expect(getField(frontmatter, "model")).toBe("opus");
  });

  it("réécrit une autre clé en gardant les blocs mot pour mot", () => {
    const fiche = parseAgentFile(FICHE);
    const texte = serializeAgentFile({ frontmatter: setFields(fiche.frontmatter, { model: "sonnet" }), body: fiche.body });
    expect(texte).toContain("skills:\n  - rangement\n  - \"deploi\"\n");
    expect(texte).toContain("mcpServers:\n  github:\n    command: npx\n");
    expect(texte).toContain("model: sonnet");
    const relu = parseAgentFile(texte).frontmatter;
    expect(getListe(relu, "skills")).toEqual(["rangement", "deploi"]);
    expect(getField(relu, "description")).toBe("Dev frontend et backend. Appelle Hugo dès qu’il faut coder.");
  });

  it("une clé réécrite par l'app remplace son bloc ; vidée, elle disparaît", () => {
    const { frontmatter, body } = parseAgentFile(FICHE);
    const enLigne = serializeAgentFile({ frontmatter: setFields(frontmatter, { skills: "rangement, deploi, notes" }), body });
    expect(enLigne).toContain('skills: "rangement, deploi, notes"\n');
    expect(enLigne).not.toContain("  - rangement");
    expect(getListe(parseAgentFile(enLigne).frontmatter, "skills")).toEqual(["rangement", "deploi", "notes"]);
    const sans = serializeAgentFile({ frontmatter: setFields(frontmatter, { skills: "" }), body });
    expect(sans).not.toContain("skills");
    expect(sans).toContain("mcpServers:\n  github:");
  });

  it("écrit une liste en lignes, à sa place, ou l'ajoute en fin d'en-tête", () => {
    const { frontmatter, body } = parseAgentFile(FICHE);
    const texte = serializeAgentFile({ frontmatter: setListe(frontmatter, "skills", ["rangement", "notes", "rangement", " "]), body });
    expect(texte).toContain("Appelle Hugo dès qu’il faut coder.\"\nskills:\n  - rangement\n  - notes\ntools: ");
    expect(texte).toContain("mcpServers:\n  github:\n    command: npx\n");
    const simple = parseAgentFile("---\nname: a\nmodel: opus\n---\n\nx\n");
    const ajoute = serializeAgentFile({ frontmatter: setListe(simple.frontmatter, "skills", ["mon outil"]), body: simple.body });
    expect(ajoute).toBe('---\nname: a\nmodel: opus\nskills:\n  - "mon outil"\n---\n\nx\n');
    expect(getListe(parseAgentFile(ajoute).frontmatter, "skills")).toEqual(["mon outil"]);
    const vide = serializeAgentFile({ frontmatter: setListe(frontmatter, "skills", []), body });
    expect(vide).not.toContain("skills");
  });

  it("un bloc littéral garde ses retours à la ligne", () => {
    const { frontmatter } = parseAgentFile("---\nname: a\ndescription: |\n  Ligne un.\n  Ligne deux.\n---\n\nx\n");
    expect(getField(frontmatter, "description")).toBe("Ligne un.\nLigne deux.");
  });

  it("une fiche simple reste identique", () => {
    const simple = "---\nname: a\ndisplayName: Alma\ndescription: \"Essai — Alma.\"\nmodel: opus\n---\n\n# Alma\n\nConsigne.\n";
    const fiche = parseAgentFile(simple);
    expect(fiche.frontmatter.blocs).toBeUndefined();
    expect(serializeAgentFile(fiche)).toBe(simple);
    expect(getListe(fiche.frontmatter, "skills")).toEqual([]);
  });
});
