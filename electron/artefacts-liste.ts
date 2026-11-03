/**
 * La liste des artefacts claude.ai de la personne, lue dans sa galerie (`claude.ai/code/artifacts`) par la
 * session claude.ai de l'app : les liens d'artefacts de la page, et les réponses JSON que la page reçoit
 * de claude.ai. Lu sans Electron pour être testé (`artefacts-liste.test.mts`).
 * Claude Code ne peut pas la lire : l'outil Artifact n'existe pas dans le Claude Code installé sur un poste.
 */

export const LIEN_ARTEFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;

export interface ArtefactClaude {
  titre: string;
  url: string;
  misAJour: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_COURT = /^[A-Za-z0-9]{16,40}$/;

/** L'identifiant d'un lien d'artefact (le dernier segment), pour rapprocher liens et réponses JSON. */
export function idDuLien(url: string): string {
  return url.replace(/\/$/, "").split("/").pop() ?? url;
}

const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);

/**
 * Les artefacts trouvés dans une réponse JSON de claude.ai dont l'adresse parle d'artefacts : tout objet
 * qui a un identifiant d'artefact (uuid → claude.ai/code/artifact/…, id court → claude.ai/artifact/…)
 * et un titre. Le reste de la réponse est ignoré.
 */
export function artefactsDuJson(adresse: string, json: unknown): ArtefactClaude[] {
  if (!/artifact/i.test(adresse)) return [];
  const trouves: ArtefactClaude[] = [];
  const visiter = (v: unknown, profondeur: number) => {
    if (profondeur > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.slice(0, 1000).forEach((x) => visiter(x, profondeur + 1));
    const o = v as Record<string, unknown>;
    const id = [o.artifact_id, o.uuid, o.id].map(texte).find((x) => x && (UUID.test(x) || ID_COURT.test(x)));
    const titre = texte(o.title) ?? texte(o.name);
    if (id && titre) {
      trouves.push({
        titre: titre.slice(0, 200),
        url: UUID.test(id) ? `https://claude.ai/code/artifact/${id}` : `https://claude.ai/artifact/${id}`,
        misAJour: texte(o.updated_at) ?? texte(o.updatedAt) ?? texte(o.created_at) ?? null,
      });
      return;
    }
    for (const x of Object.values(o)) visiter(x, profondeur + 1);
  };
  visiter(json, 0);
  return trouves;
}

/**
 * La liste finale : les liens de la page font foi pour les adresses ; les réponses JSON donnent les titres
 * et les dates qui manquent, et suffisent si la page n'a pas de liens lisibles. Un artefact par identifiant.
 */
export function fusionnerGalerie(liens: { url: string; titre: string }[], depuisJson: ArtefactClaude[]): ArtefactClaude[] {
  const parId = new Map<string, ArtefactClaude>();
  for (const a of depuisJson) if (LIEN_ARTEFACT.test(a.url)) parId.set(idDuLien(a.url), a);
  const resultat = new Map<string, ArtefactClaude>();
  for (const l of liens) {
    const url = l.url.split(/[?#]/)[0].replace(/\/$/, "");
    if (!LIEN_ARTEFACT.test(url)) continue;
    const id = idDuLien(url);
    if (resultat.has(id)) continue;
    const json = parId.get(id);
    resultat.set(id, { url, titre: json?.titre ?? (texte(l.titre)?.slice(0, 200) || "Sans titre"), misAJour: json?.misAJour ?? null });
  }
  if (!resultat.size) for (const [id, a] of parId) resultat.set(id, a);
  return [...resultat.values()];
}
