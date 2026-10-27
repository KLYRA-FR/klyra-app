import {
  estEtape,
  liensBoucle,
  PORTS,
  type Branche,
  type EtapeWorkflow,
  type ExecutionWorkflow,
  type Lien,
  type Noeud,
  type Workflow,
} from "@/types/workflows";

/**
 * Le moteur d'un workflow : il part du déclencheur, lance chaque étape dès que
 * tout ce qui y entre est fini, et passe sa sortie aux suivantes. Une
 * condition ne suit qu'une branche ; une approbation attend ta décision ; une
 * boucle repasse au plus PASSES_MAX fois.
 */

export const PASSES_MAX = 5;

export type Resultat = { ok: true; texte: string; fichiers?: string[] } | { ok: false; erreur: string };

/** Ce que le moteur demande à l'app : faire travailler un agent, appeler un modèle, prévenir. */
export interface Outils {
  agent: (o: { roleId: string; consigne: string; fichiers: string[]; signal: AbortSignal }) => Promise<Resultat>;
  llm: (o: { prompt: string; systeme: string; modele: string | null; effort: string | null; signal: AbortSignal }) => Promise<Resultat>;
  notifier: (titre: string, texte: string) => void;
  conversation: (titre: string, texte: string) => Resultat;
  ecrireFichier: (chemin: string, texte: string) => Promise<Resultat>;
  /** Attend ta décision sur une approbation : vrai pour approuver. */
  approbation: (etapeId: string, signal: AbortSignal) => Promise<boolean>;
}

interface Contexte {
  wf: Workflow;
  outils: Outils;
  /** Chaque changement de l'exécution, pour l'enregistrer et l'afficher. */
  maj: (e: ExecutionWorkflow) => void;
  signal: AbortSignal;
  /** Ce qu'apporte le déclencheur (le corps d'un webhook). */
  charge?: string;
  /** Les dernières sorties connues de chaque nœud, pour lancer une étape seule. */
  sortiesConnues?: Record<string, { texte: string; fichiers?: string[] }>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Tout ce qu'on atteint depuis des nœuds en suivant les liens (hors boucles). */
function enAval(depart: string[], liens: Lien[], boucles: Set<string>): Set<string> {
  const vus = new Set(depart);
  const pile = [...depart];
  while (pile.length) {
    const id = pile.pop()!;
    for (const l of liens) if (l.de === id && !boucles.has(l.id) && !vus.has(l.vers)) {
      vus.add(l.vers);
      pile.push(l.vers);
    }
  }
  return vus;
}

/** Ce qui alimente ces nœuds en remontant les liens (les prompts et ressources en amont). */
function enAmont(cibles: Set<string>, liens: Lien[], boucles: Set<string>, exclus: Set<string>): Set<string> {
  const vus = new Set(cibles);
  const pile = [...cibles];
  while (pile.length) {
    const id = pile.pop()!;
    for (const l of liens) if (l.vers === id && !boucles.has(l.id) && !vus.has(l.de) && !exclus.has(l.de)) {
      vus.add(l.de);
      pile.push(l.de);
    }
  }
  return vus;
}

/** Fait tourner un nœud, avec ce qui lui arrive. */
async function executerNoeud(
  n: Noeud,
  entree: { texte: string; fichiers: string[] },
  ctx: Contexte,
  etapeId: string,
): Promise<Resultat & { branche?: Branche }> {
  const c = n.champs;
  const { outils, signal } = ctx;
  switch (n.type) {
    case "declencheur":
      return { ok: true, texte: ctx.charge ?? "" };
    case "prompt":
      return { ok: true, texte: str(c.texte) };
    case "ressource": {
      const fichiers = str(c.chemins).split("\n").map((s) => s.trim()).filter(Boolean);
      if (!fichiers.length) return { ok: false, erreur: "Choisis au moins un fichier." };
      return { ok: true, texte: fichiers.join("\n"), fichiers };
    }
    case "agent": {
      const roleId = str(c.agent);
      if (!roleId) return { ok: false, erreur: "Choisis un agent." };
      const consigne = [str(c.tache).trim(), entree.texte && `— Ce qui t’arrive :\n\n${entree.texte}`].filter(Boolean).join("\n\n");
      if (!consigne) return { ok: false, erreur: "Dis à l’agent quoi faire, ou relie-lui une entrée." };
      return outils.agent({ roleId, consigne, fichiers: entree.fichiers, signal });
    }
    case "llm": {
      const fichiers = entree.fichiers.length ? `\n\nFichiers : ${entree.fichiers.join(", ")}` : "";
      const prompt = [str(c.prompt).trim(), entree.texte].filter(Boolean).join("\n\n") + fichiers;
      if (!prompt.trim()) return { ok: false, erreur: "Écris un prompt, ou relie-lui une entrée." };
      return outils.llm({ prompt, systeme: str(c.systeme), modele: str(c.modele) || null, effort: str(c.effort) || null, signal });
    }
    case "image":
      return { ok: false, erreur: "Aucun modèle d’image n’est encore branché à l’app." };
    case "condition": {
      const regle = str(c.regle).trim();
      if (!regle) return { ok: false, erreur: "Écris la règle de la condition." };
      const r = await outils.llm({
        prompt: `Règle : ${regle}\n\nTexte à juger :\n${entree.texte || "(vide)"}\n\nLa règle est-elle vraie pour ce texte ? Réponds par un seul mot : OUI ou NON.`,
        systeme: "Tu juges une condition. Tu réponds uniquement OUI ou NON, sans rien d’autre.",
        modele: "haiku",
        effort: null,
        signal,
      });
      if (!r.ok) return r;
      const branche: Branche = /\bnon\b|\bno\b/i.test(r.texte) && !/\boui\b|\byes\b/i.test(r.texte) ? "non" : "oui";
      return { ok: true, texte: entree.texte, fichiers: entree.fichiers, branche };
    }
    case "approbation": {
      const ok = await outils.approbation(etapeId, signal);
      if (!ok) return { ok: false, erreur: "Refusé. L’exécution s’est arrêtée ici." };
      return { ok: true, texte: entree.texte, fichiers: entree.fichiers };
    }
    case "sortie": {
      const texte = entree.texte || entree.fichiers.join("\n");
      const cible = str(c.cible) || "notification";
      if (cible === "notification") {
        outils.notifier(str(c.titre) || ctx.wf.titre, texte.slice(0, 240));
        return { ok: true, texte: "Notification envoyée." };
      }
      if (cible === "conversation") return outils.conversation(str(c.titre) || ctx.wf.titre, texte);
      const chemin = str(c.chemin).trim();
      if (!chemin) return { ok: false, erreur: "Indique le chemin du fichier." };
      return outils.ecrireFichier(chemin, texte);
    }
    default:
      return { ok: true, texte: "" };
  }
}

/**
 * Fait tourner une exécution jusqu'au bout. `exec` arrive avec ses étapes vides ;
 * chaque changement repart par `ctx.maj`.
 */
export async function executer(exec: ExecutionWorkflow, ctx: Contexte): Promise<void> {
  const { noeuds, liens: tous } = ctx.wf.graphe;
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const etapes = noeuds.filter((n) => estEtape(n.type));
  const liens = tous.filter((l) => parId.has(l.de) && parId.has(l.vers) && estEtape(parId.get(l.de)!.type) && estEtape(parId.get(l.vers)!.type));
  const boucles = liensBoucle(etapes, liens);

  let courant: ExecutionWorkflow = exec;
  const pousser = (e: ExecutionWorkflow) => {
    courant = e;
    ctx.maj(e);
  };
  const majEtape = (id: string, patch: Partial<EtapeWorkflow>) =>
    pousser({ ...courant, etapes: courant.etapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  /* Les nœuds de cette exécution. */
  let utiles: Set<string>;
  if (exec.seule) utiles = new Set([exec.seule]);
  else {
    const declencheurs = etapes.filter((n) => n.type === "declencheur");
    const entres = new Set(liens.filter((l) => !boucles.has(l.id)).map((l) => l.vers));
    const departs = exec.declencheurId
      ? [exec.declencheurId]
      : etapes.filter((n) => !entres.has(n.id) && (n.type === "declencheur" || !declencheurs.length)).map((n) => n.id);
    const autresDeclencheurs = new Set(declencheurs.map((n) => n.id).filter((id) => !departs.includes(id)));
    const aval = enAval(departs, liens, boucles);
    utiles = enAmont(aval, liens, boucles, autresDeclencheurs);
  }
  if (!utiles.size) {
    pousser({ ...courant, statut: "erreur", erreur: "Rien à lancer : ajoute un déclencheur et relie-lui une étape.", fin: new Date().toISOString() });
    return;
  }

  /* L'état de chaque nœud : en attente, fini (sa sortie), ou ignoré (branche non suivie). */
  type Etat = { statut: "attente" | "en-cours" | "fini" | "ignore"; texte: string; fichiers: string[]; branche?: Branche; passe: number };
  const etat = new Map<string, Etat>();
  for (const id of utiles) etat.set(id, { statut: "attente", texte: "", fichiers: [], passe: 1 });
  const entrees = (id: string) => liens.filter((l) => l.vers === id && utiles.has(l.de) && !boucles.has(l.id));
  /* Un lien est actif quand sa source est finie et, pour une condition, sur la branche prise. */
  const actif = (l: Lien) => {
    const s = etat.get(l.de);
    return s?.statut === "fini" && (l.branche === undefined || l.branche === s.branche);
  };
  /* Entrée apportée par une boucle au tour suivant. */
  const deBoucle = new Map<string, { texte: string; fichiers: string[] }>();

  /* Une erreur arrête tout ; un refus d'approbation aussi. */
  const issue: { echec: string | null; arret: boolean } = { echec: null, arret: false };
  const enVol = new Map<string, Promise<void>>();

  const lancer = (n: Noeud) => {
    const e = etat.get(n.id)!;
    e.statut = "en-cours";
    const venues = exec.seule
      ? Object.entries(ctx.sortiesConnues ?? {})
          .filter(([de]) => liens.some((l) => l.de === de && l.vers === n.id))
          .map(([, s]) => ({ texte: s.texte, fichiers: s.fichiers ?? [] }))
      : entrees(n.id).filter(actif).map((l) => etat.get(l.de)!);
    const boucle = deBoucle.get(n.id);
    if (boucle) deBoucle.delete(n.id);
    const entree = {
      texte: [...venues.map((v) => v.texte), boucle?.texte ?? ""].filter(Boolean).join("\n\n"),
      fichiers: [...venues.flatMap((v) => v.fichiers), ...(boucle?.fichiers ?? [])],
    };
    const etape: EtapeWorkflow = {
      id: crypto.randomUUID(),
      noeudId: n.id,
      passe: e.passe,
      statut: n.type === "approbation" ? "approbation" : "en-cours",
      sortie: null,
      branche: null,
      erreur: null,
      debut: new Date().toISOString(),
      fin: null,
    };
    pousser({
      ...courant,
      statut: n.type === "approbation" ? "approbation" : courant.statut,
      etapes: [...courant.etapes, etape],
    });
    const p = executerNoeud(n, entree, ctx, etape.id).then((r) => {
      enVol.delete(n.id);
      if (ctx.signal.aborted) {
        majEtape(etape.id, { statut: "arrete", fin: new Date().toISOString() });
        return;
      }
      if (!r.ok) {
        majEtape(etape.id, { statut: n.type === "approbation" ? "arrete" : "erreur", erreur: r.erreur, fin: new Date().toISOString() });
        if (n.type === "approbation") issue.arret = true;
        else issue.echec = r.erreur;
        return;
      }
      Object.assign(e, { statut: "fini", texte: r.texte, fichiers: r.fichiers ?? [], branche: r.branche });
      majEtape(etape.id, { statut: "fait", sortie: r.texte, fichiers: r.fichiers, branche: r.branche ?? null, fin: new Date().toISOString() });
      if (courant.statut === "approbation" && ![...enVol.keys()].some((id) => parId.get(id)?.type === "approbation"))
        pousser({ ...courant, statut: "en-cours" });
      /* Une boucle : le nœud visé et tout ce qui suit repartent pour un tour. */
      for (const l of liens) {
        if (l.de !== n.id || !boucles.has(l.id) || !utiles.has(l.vers) || !actif(l)) continue;
        const cible = etat.get(l.vers)!;
        if (cible.passe >= PASSES_MAX) {
          issue.echec = `Boucle infinie : arrêtée après ${PASSES_MAX} tours.`;
          return;
        }
        deBoucle.set(l.vers, { texte: r.texte, fichiers: r.fichiers ?? [] });
        for (const id of enAval([l.vers], liens, boucles)) {
          const s = etat.get(id);
          if (s && s.statut !== "en-cours") Object.assign(s, { statut: "attente", passe: s.passe + 1 });
        }
      }
    });
    enVol.set(n.id, p);
  };

  /* La boucle principale : lancer tout ce qui est prêt, attendre qu'une étape finisse, recommencer. */
  for (;;) {
    if (ctx.signal.aborted || issue.echec || issue.arret) break;
    let bouge = false;
    for (const id of utiles) {
      const e = etat.get(id)!;
      if (e.statut !== "attente") continue;
      const venues = exec.seule ? [] : entrees(id);
      const attend = venues.some((l) => {
        const s = etat.get(l.de)!.statut;
        return s === "attente" || s === "en-cours";
      });
      if (attend && !deBoucle.has(id)) continue;
      /* Tout ce qui entre est ignoré ou sur l'autre branche : le nœud est ignoré aussi. */
      if (venues.length && !venues.some(actif) && !deBoucle.has(id)) {
        e.statut = "ignore";
        bouge = true;
        continue;
      }
      lancer(parId.get(id)!);
      bouge = true;
    }
    if (enVol.size) await Promise.race(enVol.values());
    else if (!bouge) break;
  }
  if (enVol.size) await Promise.allSettled(enVol.values());

  /* Ce qui n'a pas tourné, faute d'entrée suivie, est marqué ignoré. */
  const ignores: EtapeWorkflow[] = [...etat.entries()]
    .filter(([id, e]) => e.statut === "ignore" && !courant.etapes.some((s) => s.noeudId === id))
    .map(([noeudId, e]) => ({
      id: crypto.randomUUID(),
      noeudId,
      passe: e.passe,
      statut: "ignore",
      sortie: null,
      branche: null,
      erreur: null,
      debut: new Date().toISOString(),
      fin: new Date().toISOString(),
    }));
  pousser({
    ...courant,
    etapes: [...courant.etapes, ...ignores],
    statut: ctx.signal.aborted || issue.arret ? "arrete" : issue.echec ? "erreur" : "fait",
    erreur: issue.echec,
    fin: new Date().toISOString(),
  });
}

/** Une sortie de nœud prête à afficher : le texte, sinon la liste des fichiers. */
export function texteSortie(e: EtapeWorkflow): string {
  return e.sortie || (e.fichiers ?? []).join("\n");
}

/** Le type de port qu'envoie un nœud (celui de ses liens sortants). */
export function portDe(n: Noeud) {
  return PORTS[n.type].sortie[0] ?? "texte";
}
