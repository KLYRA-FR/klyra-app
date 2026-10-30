// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AGENT_TEMPLATES, AGENT_TEMPLATES_PRECEDENTS } from "@/data/agent-templates.generated";
import { getField, parseAgentFile } from "@/lib/agent-file";
import { consigne } from "@/lib/lien-bibliotheque";
import { comparerAuModele, fusionnerAvecModele, remplacerParModele } from "@/lib/maj-modele";

const v1 = (nom: string) => AGENT_TEMPLATES_PRECEDENTS[nom][0].content;
const actuel = (nom: string) => AGENT_TEMPLATES.find((t) => t.name === nom)!.content;
const NOMS = AGENT_TEMPLATES.map((t) => t.name);
/** Les préférences qu'une personne a pu poser dans l'en-tête : modèle d'IA, prénom, outils. */
const personnaliserEnTete = (contenu: string) =>
  contenu.replace(/^model: .*$/m, "model: haiku").replace(/^displayName: .*$/m, "displayName: Bob").replace(/^memory: .*$/m, "memory: project\ntools: Read, Grep");
const enTete = (contenu: string) => contenu.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/)![1];

describe("versions des modèles", () => {
  it("chaque modèle a sa version actuelle et sa version 1", () => {
    expect(NOMS).toHaveLength(11);
    for (const nom of NOMS) {
      expect(AGENT_TEMPLATES.find((t) => t.name === nom)!.version).toBe(2);
      expect(comparerAuModele(nom, actuel(nom))).toEqual({ version: 2, identiqueA: 2, base: 2 });
      expect(comparerAuModele(nom, v1(nom))).toEqual({ version: 2, identiqueA: 1, base: 1 });
    }
  });

  it("une fiche enregistrée sous Windows (fins de ligne CRLF) est reconnue", () => {
    for (const nom of NOMS) expect(comparerAuModele(nom, v1(nom).replace(/\n/g, "\r\n"))?.identiqueA).toBe(1);
  });

  it("un modèle disparu ne propose rien", () => {
    expect(comparerAuModele("inconnu", actuel("dev"))).toBeNull();
    expect(fusionnerAvecModele("inconnu", "dev", actuel("dev"))).toBeNull();
  });
});

describe("mise à jour d’une fiche installée", () => {
  it("version 1 non modifiée : consigne actuelle, sans conflit, en-tête et réglages gardés", () => {
    for (const nom of NOMS) {
      const local = personnaliserEnTete(v1(nom));
      expect(comparerAuModele(nom, local)?.identiqueA).toBe(1);
      const fusion = fusionnerAvecModele(nom, nom, local)!;
      expect(fusion.conflits).toEqual([]);
      expect(fusion.gardees).toEqual([]);
      expect(consigne(fusion.contenu)).toBe(consigne(actuel(nom)));
      const fm = parseAgentFile(fusion.contenu).frontmatter;
      expect(getField(fm, "name")).toBe(nom);
      expect(getField(fm, "model")).toBe("haiku");
      expect(getField(fm, "displayName")).toBe("Bob");
      expect(getField(fm, "tools")).toBe("Read, Grep");
      // L'en-tête reste ligne pour ligne, sauf la description quand le modèle l'a changée.
      const autres = (t: string) => enTete(t).split("\n").filter((l) => !l.startsWith("description:"));
      expect(autres(fusion.contenu)).toEqual(autres(local));
      // Le résultat est à jour : plus rien à proposer.
      expect(comparerAuModele(nom, fusion.contenu)?.identiqueA).toBe(2);
    }
  });

  it("version 1 modifiée : ses ajouts gardés, les corrections reprises là où rien n’a été touché", () => {
    const description = "Dev maison — mon code. Appelle Hugo pour mon code.";
    const local = `${v1("dev").replace(/^description: .*$/m, `description: "${description}"`)}\n## Ajout local\n\nUne règle à moi.\n`;
    expect(comparerAuModele("dev", local)).toEqual({ version: 2, identiqueA: null, base: 1 });
    const fusion = fusionnerAvecModele("dev", "dev", local)!;
    expect(fusion.conflits).toEqual([]);
    expect(fusion.gardees).toEqual([
      { titre: "Quand l’appeler", etat: "modifiee" },
      { titre: "Ajout local", etat: "ajoutee" },
    ]);
    expect(fusion.reprises).toContainEqual({ titre: "Passer la main à la QA", etat: "retiree" });
    expect(fusion.reprises).toContainEqual({ titre: "Vérifier avant de livrer", etat: "ajoutee" });
    expect(fusion.contenu).toContain("## Vérifier avant de livrer");
    expect(fusion.contenu).toContain("## Travailler à plusieurs");
    expect(fusion.contenu).not.toContain("Passer la main à la QA");
    expect(fusion.contenu).not.toContain("SendMessage");
    expect(getField(parseAgentFile(fusion.contenu).frontmatter, "description")).toBe(description);
    // La section à soi reste après celle qui la précédait (ici, en fin de fiche).
    expect(fusion.contenu.trimEnd().endsWith("## Ajout local\n\nUne règle à moi.")).toBe(true);
  });

  it("modifiée des deux côtés : la sienne par défaut, celle du modèle sur choix", () => {
    const local = v1("dev").replace("- Quand on t’écrit, réponds toujours à l’expéditeur, même d’une ligne.", "- Quand on t’écrit, réponds toujours à l’expéditeur, même d’une ligne.\n- Ma règle d’équipe.");
    expect(local).not.toBe(v1("dev"));
    const parDefaut = fusionnerAvecModele("dev", "dev", local)!;
    expect(parDefaut.conflits.map((c) => c.cle)).toEqual(["section:Parler en équipe"]);
    expect(parDefaut.contenu).toContain("- Ma règle d’équipe.");
    const choixModele = fusionnerAvecModele("dev", "dev", local, { "section:Parler en équipe": "modele" })!;
    expect(choixModele.contenu).not.toContain("- Ma règle d’équipe.");
    expect(choixModele.contenu).not.toContain("SendMessage");
    expect(consigne(choixModele.contenu)).toBe(consigne(actuel("dev")));
  });

  it("une section retirée chez soi, changée par le modèle : elle reste retirée sauf choix contraire", () => {
    const local = v1("dev").replace(/## Critères de sortie\n[\s\S]*?(?=## Parler en équipe)/, "");
    const fusion = fusionnerAvecModele("dev", "dev", local)!;
    const conflit = fusion.conflits.find((c) => c.cle === "section:Critères de sortie")!;
    expect(conflit.mienne).toBeNull();
    expect(fusion.contenu).not.toContain("## Critères de sortie");
    expect(fusionnerAvecModele("dev", "dev", local, { "section:Critères de sortie": "modele" })!.contenu).toContain("## Critères de sortie");
  });

  it("une section changée chez soi, retirée par le modèle : gardée sauf choix contraire", () => {
    const local = v1("dev").replace("Je ne pousse plus rien sur ce commit avant son OK.", "Je préviens aussi mon chef.");
    const fusion = fusionnerAvecModele("dev", "dev", local)!;
    const conflit = fusion.conflits.find((c) => c.cle === "section:Passer la main à la QA")!;
    expect(conflit.modele).toBeNull();
    expect(fusion.contenu).toContain("Je préviens aussi mon chef.");
    expect(fusionnerAvecModele("dev", "dev", local, { "section:Passer la main à la QA": "modele" })!.contenu).not.toContain("Passer la main à la QA");
  });

  it("aucune modification perdue sans choix : chaque partie changée chez soi reste dans le résultat", () => {
    for (const nom of NOMS) {
      // Une ligne ajoutée à chaque section : tout est modifié chez soi.
      const local = v1(nom).replace(/^(## .+)$/gm, "$1\n\nNote perso.");
      const fusion = fusionnerAvecModele(nom, nom, local)!;
      const sections = local.match(/^## .+$/gm)!;
      for (const s of sections) expect(fusion.contenu).toContain(`${s}\n\nNote perso.`);
    }
  });

  it("une fiche sans rapport avec le modèle : rien de perdu, chaque écart est un choix", () => {
    const local = "---\nname: dev\ndisplayName: Hugo\ndescription: \"Mon dev — tout. Appelle Hugo.\"\nmodel: sonnet\n---\n\n# Hugo — Mon dev\n\nÀ moi.\n\n## Mes règles\n\nLes miennes.\n";
    const fusion = fusionnerAvecModele("dev", "dev", local)!;
    for (const texte of ["Mon dev — tout. Appelle Hugo.", "# Hugo — Mon dev", "À moi.", "## Mes règles", "Les miennes."]) expect(fusion.contenu).toContain(texte);
    expect(getField(parseAgentFile(fusion.contenu).frontmatter, "model")).toBe("sonnet");
  });

  it("« Remplacer par le modèle » : la consigne actuelle, l’en-tête de la fiche gardé", () => {
    const local = personnaliserEnTete(`${v1("val")}\n## À moi\n\nTexte.\n`);
    const remplace = remplacerParModele("val", "val", local)!;
    expect(consigne(remplace)).toBe(consigne(actuel("val")));
    const fm = parseAgentFile(remplace).frontmatter;
    expect([getField(fm, "model"), getField(fm, "displayName"), getField(fm, "tools")]).toEqual(["haiku", "Bob", "Read, Grep"]);
  });

  it("un agent installé sous un autre identifiant garde le sien", () => {
    const local = v1("dev").replace(/^name: dev$/m, "name: dev-2");
    const fusion = fusionnerAvecModele("dev", "dev-2", local)!;
    expect(getField(parseAgentFile(fusion.contenu).frontmatter, "name")).toBe("dev-2");
  });
});
