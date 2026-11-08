/** Prototype local : aucune requête réseau, aucun contexte envoyé à un agent. */
export type SourceMemoire = { chatId: string; messageId: string; titre: string; extrait: string };
export type NoteMemoire = {
  id: string; titre: string; contenu: string; projetId: string | null;
  liens: string[]; source: SourceMemoire | null; creeLe: string; modifieLe: string;
  revision?: number; agentId?: string | null; origine?: string | null;
};
export type CaptureMemoire = { contenu: string; projetId: string | null; source: SourceMemoire };
export const cleMemoire = (lieu: string | null) => `klyra:memoire:prototype:v1:${encodeURIComponent(lieu ?? "poste")}`;
export const cleCapture = (lieu: string | null) => `${cleMemoire(lieu)}:capture`;
export const EVENEMENT_MEMOIRE = "klyra:memoire:prototype";
const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const estTexte = (v: unknown): v is string => typeof v === "string";
function sourceValide(v: unknown): v is SourceMemoire {
  return estObjet(v) && [v.chatId, v.messageId, v.titre, v.extrait].every(estTexte);
}
export function decoderMemoire(brut: string | null): NoteMemoire[] {
  if (brut === null) return [];
  const v: unknown = JSON.parse(brut);
  if (!estObjet(v) || v.version !== 1 || !Array.isArray(v.notes)) throw new Error("Format de mémoire non reconnu. Les données conservées n’ont pas été modifiées.");
  const ids = new Set<string>();
  for (const n of v.notes) {
    if (!estObjet(n) || ![n.id, n.titre, n.contenu, n.creeLe, n.modifieLe].every(estTexte)
      || !n.id || ids.has(n.id as string) || !(n.projetId === null || estTexte(n.projetId))
      || !Array.isArray(n.liens) || !n.liens.every(estTexte) || !(n.source === null || sourceValide(n.source))) {
      throw new Error("Une note est illisible. Les données conservées n’ont pas été modifiées.");
    }
    ids.add(n.id as string);
  }
  return v.notes as NoteMemoire[];
}
export function enregistrerMemoire(lieu: string | null, notes: NoteMemoire[], stockage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  // Ne jamais écraser silencieusement un stockage corrompu ou d'une autre version.
  decoderMemoire(stockage.getItem(cleMemoire(lieu)));
  const brut = JSON.stringify({ version: 1, notes });
  decoderMemoire(brut);
  stockage.setItem(cleMemoire(lieu), brut);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENEMENT_MEMOIRE));
}
export function sansNote(notes: NoteMemoire[], id: string): NoteMemoire[] {
  return notes.filter((n) => n.id !== id).map((n) => ({ ...n, liens: n.liens.filter((l) => l !== id) }));
}
export function aretesMemoire(notes: NoteMemoire[]): [string, string][] {
  const ids = new Set(notes.map((n) => n.id)), vus = new Set<string>(), resultat: [string, string][] = [];
  for (const n of notes) for (const id of n.liens) {
    const paire = [n.id, id].sort() as [string, string];
    const cle = JSON.stringify(paire);
    if (id !== n.id && ids.has(id) && !vus.has(cle)) { vus.add(cle); resultat.push(paire); }
  }
  return resultat;
}
export function chercherMemoire(notes: NoteMemoire[], texte: string): Set<string> {
  const normaliser = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  const mots = normaliser(texte).trim().split(/\s+/).filter(Boolean);
  return new Set(notes.filter((n) => mots.every((mot) => normaliser(`${n.titre} ${n.contenu} ${n.source?.titre ?? ""}`).includes(mot))).map((n) => n.id));
}
/** Placement par forces, déterministe. Les arêtes viennent uniquement des liens explicites. */
export function placerMemoire(notes: NoteMemoire[]): Record<string, { x: number; y: number }> {
  if (!notes.length) return {};
  const points = notes.map((n, i) => ({ id: n.id, x: 550 + Math.cos(i * 2.39996) * (90 + Math.sqrt(i) * 42), y: 380 + Math.sin(i * 2.39996) * (90 + Math.sqrt(i) * 32) }));
  const index = new Map(points.map((p, i) => [p.id, i]));
  const aretes = aretesMemoire(notes).map(([a, b]) => [index.get(a)!, index.get(b)!]);
  for (let tour = 0; tour < 180; tour++) {
    const forces = points.map((p) => ({ x: (550 - p.x) * 0.006, y: (380 - p.y) * 0.008 }));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x || 0.1, dy = points[i].y - points[j].y || 0.1;
      const d2 = Math.max(120, dx * dx + dy * dy), force = 850 / d2;
      forces[i].x += dx * force; forces[i].y += dy * force;
      forces[j].x -= dx * force; forces[j].y -= dy * force;
    }
    for (const [a, b] of aretes) {
      const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y;
      const d = Math.hypot(dx, dy) || 1, force = (d - 140) * 0.018;
      forces[a].x += dx / d * force; forces[a].y += dy / d * force;
      forces[b].x -= dx / d * force; forces[b].y -= dy / d * force;
    }
    const temperature = 1 - tour / 220;
    points.forEach((p, i) => { p.x = Math.min(990, Math.max(110, p.x + forces[i].x * temperature)); p.y = Math.min(650, Math.max(90, p.y + forces[i].y * temperature)); });
  }
  return Object.fromEntries(points.map((p) => [p.id, { x: p.x, y: p.y }]));
}
export function exempleMemoire(): NoteMemoire[] {
  const concepts: [string, string, string[]][] = [
    ["KLYRA", "Exemple : un point d’entrée pour les idées et les projets.", ["memoire", "projets", "agents"]],
    ["Mémoire", "Exemple : conserver volontairement ce qui sera utile plus tard.", ["decisions", "sources", "idees"]],
    ["Projets", "Exemple : regrouper les notes par projet.", ["decisions", "idees"]],
    ["Agents", "Exemple : retrouver du contexte avant une tâche. La lecture automatique reste à développer.", ["sources", "contexte"]],
    ["Décisions", "Exemple : retenir le choix et les raisons qui le motivent.", ["sources"]],
    ["Sources", "Exemple : revenir à l’échange d’origine.", ["contexte"]],
    ["Idées", "Exemple : relier une piste à ce qu’elle peut faire évoluer.", ["contexte"]],
    ["Contexte", "Exemple : retrouver les liens entre les sujets.", []],
  ];
  const ids = ["klyra", "memoire", "projets", "agents", "decisions", "sources", "idees", "contexte"];
  return concepts.map(([titre, contenu, liens], i) => ({ id: ids[i], titre, contenu, liens, projetId: null, source: null, creeLe: new Date().toISOString(), modifieLe: new Date().toISOString() }));
}
