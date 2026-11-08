import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { GithubProjets, type ConnexionGithubProjet } from "./github-projets";

export function creerGithubProjets(d: { donnees: string; racine: string; base?: string; gh: string; chiffrer: (v: string) => string; dechiffrer: (v: string) => string }) {
  const fichier = path.join(d.donnees, "github-projets.json");
  let file: Promise<void> = Promise.resolve();
  return new GithubProjets({
    racine: d.racine, base: d.base, gh: d.gh,
    verifier: () => { d.chiffrer("verification"); },
    lire: async () => {
      let brut: string;
      try { brut = await readFile(fichier, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("La connexion GitHub ne peut plus être lue."); }
      try {
        const v = JSON.parse(d.dechiffrer(JSON.parse(brut).contenu)) as ConnexionGithubProjet;
        if (typeof v.jeton !== "string" || !v.jeton || typeof v.compte !== "string") throw new Error();
        return v;
      } catch { throw new Error("La connexion GitHub ne peut plus être déchiffrée. Reconnecte GitHub."); }
    },
    ecrire: (v) => {
      const operation = file.then(async () => {
      // Toujours vérifier que le coffre est utilisable, y compris avant une première connexion.
      if (!v) { await rm(fichier, { force: true }); return; }
      const contenu = d.chiffrer(JSON.stringify(v));
      await mkdir(d.donnees, { recursive: true, mode: 0o700 });
      const tmp = `${fichier}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, contenu }), { mode: 0o600 });
      await rename(tmp, fichier);
      });
      file = operation.catch(() => {});
      return operation;
    },
  });
}
