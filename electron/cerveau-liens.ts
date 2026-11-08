import { cosinus, decoderEmpreinte, empreinte, extraireEntites, normaliserSens, wikiliens, type EntiteCerveau } from "./cerveau-sens";

/** Un lien proposé, avant les liens posés à la main et les liens refusés. */
export interface LienPropose { id: string; genre: "wiki" | "entite" | "sens"; pourquoi: string; score: number }
export interface AutreNote { id: string; titre: string; entites: EntiteCerveau[]; vecteur: Float32Array | null }

const LIBELLES: Record<string, string> = { client: "client", personne: "personne", projet: "projet", decision: "décision", sujet: "sujet" };

export function analyserNote(titre: string, contenu: string, origine = ""): { entites: EntiteCerveau[]; vecteur: Float32Array; wikis: string[] } {
  return { entites: extraireEntites(titre, contenu, origine), vecteur: empreinte(`${titre}\n${contenu}`), wikis: wikiliens(`${titre}\n${contenu}`) };
}

/**
 * Liens automatiques : un wiki, une entité partagée (client, personne, projet, décision, sujet net),
 * ou une empreinte très proche. Au plus huit. Les liens manuels et les refus sont appliqués par l’appelant.
 */
export function proposerLiens(titre: string, contenu: string, origine: string, autres: AutreNote[]): LienPropose[] {
  const sujet = analyserNote(titre, contenu, origine);
  const titreNorm = normaliserSens(titre);
  const parTitre = new Map<string, string[]>();
  for (const autre of autres) {
    const cle = normaliserSens(autre.titre);
    const liste = parTitre.get(cle) ?? [];
    liste.push(autre.id);
    parTitre.set(cle, liste);
  }
  const proposes = new Map<string, LienPropose>();
  const retenir = (lien: LienPropose) => {
    const deja = proposes.get(lien.id);
    if (!deja || lien.score > deja.score) proposes.set(lien.id, lien);
  };
  for (const wiki of sujet.wikis) for (const id of parTitre.get(wiki) ?? []) retenir({ id, genre: "wiki", pourquoi: `Lien [[${wiki}]]`, score: 1 });
  if (titreNorm.length >= 2) for (const autre of autres) {
    if (sujet.wikis.includes(normaliserSens(autre.titre)) || wikiliens(autre.titre).includes(titreNorm)) retenir({ id: autre.id, genre: "wiki", pourquoi: `Lien [[${autre.titre}]]`, score: 1 });
  }
  const index = new Map<string, string[]>();
  for (const autre of autres) for (const e of autre.entites) {
    const cle = `${e.genre}:${e.valeur}`;
    const liste = index.get(cle) ?? [];
    liste.push(autre.id);
    index.set(cle, liste);
  }
  for (const e of sujet.entites) {
    if (e.genre === "sujet" && e.valeur.length < 8) continue;
    for (const id of index.get(`${e.genre}:${e.valeur}`) ?? []) {
      const nom = e.valeur.length > 48 ? `${e.valeur.slice(0, 47)}…` : e.valeur;
      retenir({ id, genre: "entite", pourquoi: `Même ${LIBELLES[e.genre] ?? e.genre} : ${nom}`, score: e.genre === "sujet" ? 0.74 : 0.92 });
    }
  }
  const proches: LienPropose[] = [];
  for (const autre of autres) {
    if (!autre.vecteur) continue;
    const score = cosinus(sujet.vecteur, autre.vecteur);
    if (score >= 0.86) proches.push({ id: autre.id, genre: "sens", pourquoi: `Sens proche (${score.toFixed(2).replace(".", ",")})`, score });
  }
  proches.sort((a, b) => b.score - a.score);
  for (const lien of proches.slice(0, 3)) retenir(lien);
  return [...proposes.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

export function vecteurDe(brut: Uint8Array | null): Float32Array | null {
  if (!brut || brut.byteLength < 8) return null;
  try { return decoderEmpreinte(brut); } catch { return null; }
}

export { empreinte };
