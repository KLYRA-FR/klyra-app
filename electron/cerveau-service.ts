import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { Cerveau, ouvrirCerveau } from "./cerveau";
import { cheminSouvenir, lireMemoire, type PorteeMemoire } from "./connaissances-agent";
import type { NoteCerveau, PorteeCerveau } from "./cerveau-types";
import { actionDossier } from "./cerveau-dossiers";

export const PROPRIETAIRE: PorteeCerveau = { agentId: null, projetId: null, proprietaire: true };
/** Textes expressément choisis dans la boîte de fichiers du poste. Aucune ouverture d'un chemin reçu par HTTP. */
export function importerDocuments(cerveau: Cerveau, documents: unknown, projetId: string | null) {
  if (!Array.isArray(documents) || documents.length > 20) throw new Error("Importez au plus vingt documents à la fois.");
  let indexes = 0, inchanges = 0;
  for (const d of documents) {
    if (!d || typeof d.titre !== "string" || !/\.(md|markdown|txt|csv|json|log)$/i.test(d.titre) || typeof d.contenu !== "string" || d.contenu.includes("\0") || typeof d.reference !== "string" || d.reference.length > 1024) throw new Error("Un import doit être un document texte identifié (Markdown, texte, CSV, JSON ou journal).");
    const origine = `document:${createHash("sha256").update(JSON.stringify([d.reference, projetId])).digest("hex")}`;
    const avant = cerveau.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
    const liens = avant ? cerveau.note(String(avant.id), PROPRIETAIRE).liens : [];
    const r = cerveau.garder({ id: `doc-${origine.slice(9)}`, titre: d.titre.slice(0, 180), contenu: d.contenu, projetId, liens, source: null, creeLe: "", modifieLe: "" }, { origine, agentId: null });
    if (r.inchange) inchanges++; else indexes++;
  }
  return { indexes, inchanges };
}
type SouvenirsResolus = { dossier: string; portee: PorteeMemoire };
/** Lecture ciblée du dossier déjà résolu par la mémoire existante ; aucun chemin fourni par le renderer. */
export async function indexerSouvenirs(cerveau: Cerveau, agent: string, memoire: SouvenirsResolus | null, projetId: string | null) {
  if (!memoire || !existsSync(memoire.dossier)) return { indexes: 0, inchanges: 0, coupee: false, avertissements: ["Cette mémoire est vide ou n’existe pas encore."] };
  const base = realpathSync(memoire.dossier), inventaire = lireMemoire(memoire.portee, base, { limite: 20_000 });
  const prefixe = `souvenir:${createHash("sha256").update(JSON.stringify([base, agent, projetId])).digest("hex")}:`;
  let indexes = 0, inchanges = 0;
  const conserves: string[] = [], avertissements: string[] = [];
  for (const s of inventaire.souvenirs) {
    if ((indexes + inchanges) % 25 === 0) await new Promise<void>((r) => setImmediate(r));
    if (s.toujours) continue; // L'index MEMORY.md est un sommaire, pas une copie de tout le corpus.
    try {
      const fichier = realpathSync(cheminSouvenir(base, s.id));
      if (!fichier.startsWith(base + path.sep) || statSync(fichier).size > 2_000_000) throw new Error("Source hors du dossier résolu ou supérieure à 2 Mo.");
      const origine = prefixe + s.id, contenu = readFileSync(fichier, "utf8");
      if (!contenu.trim()) continue;
      const avant = cerveau.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(origine);
      let liens: string[] = [];
      if (avant) liens = cerveau.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(avant.id, avant.id).map((r) => String(r.id));
      const note: NoteCerveau = { id: `souvenir-${createHash("sha256").update(origine).digest("hex")}`, titre: s.titre.slice(0, 180), contenu, projetId, liens, source: null, creeLe: "", modifieLe: "" };
      const r = cerveau.garder(note, { origine, agentId: agent });
      conserves.push(r.note.id); if (r.inchange) inchanges++; else indexes++;
    } catch { avertissements.push(`${s.id} : non indexé (source inaccessible, invalide ou trop volumineuse).`); }
  }
  cerveau.actualiserSources(prefixe, conserves, !inventaire.coupee && avertissements.length === 0);
  return { indexes, inchanges, coupee: inventaire.coupee, avertissements };
}
export function actionCerveau(donnees: string, action: string, args: Record<string, unknown>) {
  const c = ouvrirCerveau(donnees);
  if (["digital-os-etat", "digital-os-demarrer", "digital-os-arreter", "digital-os-parcourir"].includes(action)) return actionDossier(c, action, args);
  const projetId = typeof args.projetId === "string" ? args.projetId : null;
  const portee = typeof args.apercuAgent === "string" && args.apercuAgent ? { agentId: args.apercuAgent, projetId } : { ...PROPRIETAIRE, projetId };
  switch (action) {
    case "importer-documents": return importerDocuments(c, args.documents, typeof args.projetId === "string" ? args.projetId : null);
    case "lister": return c.lister(PROPRIETAIRE, args);
    case "note": return c.note(args.id, PROPRIETAIRE);
    case "garder": return c.garder(args.note as NoteCerveau).note;
    case "oublier": c.oublier(args.id, args.revision); return { oublie: true };
    case "chercher": return c.chercher(args.requete, portee, args.budgetOctets);
    case "lire": return c.lire(args.ids, portee, args.budgetOctets);
    default: throw new Error("Action de mémoire inconnue.");
  }
}
