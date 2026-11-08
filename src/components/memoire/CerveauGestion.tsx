"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import type { PageCerveau, ResultatCerveau, NoteCerveau } from "../../../electron/cerveau-types";
import { useRoles, useWorkspace } from "@/lib/workspace";
import { cleMemoire, decoderMemoire, type NoteMemoire } from "@/lib/memoire";
import { MemoireVue, type ServiceMemoire } from "./MemoireVue";
import { DigitalOsSource } from "./DigitalOsSource";
import { SynchroServeur } from "./SynchroServeur";
import { appelerCerveau as appeler } from "@/lib/cerveau-pont";

type Props = ComponentProps<typeof MemoireVue>;
const vide: PageCerveau = { notes: [], total: 0, limite: 80, suite: null, etat: { notes: 0, passages: 0, octetsSources: 0, dernierChangement: null } };
const volume = (n: number) => n < 1000 ? `${n} octets` : n < 1_000_000 ? `${(n / 1000).toFixed(1)} Ko` : `${(n / 1_000_000).toFixed(1)} Mo`;

/** La page monte le graphe sur une fenêtre de métadonnées, pas sur le corpus complet. */
export function CerveauGestion(props: Props) {
  const { lieu, projets } = props, roles = useRoles(), { state } = useWorkspace();
  const [onglet, setOnglet] = useState<"graphe" | "contexte" | "sources">("graphe");
  const [page, setPage] = useState(vide), [erreur, setErreur] = useState("");
  const [filtre, setFiltre] = useState({ recherche: "", projetId: "", offset: 0, centreId: "" });
  const generation = useRef(0);
  const charger = useCallback(async () => {
    const n = ++generation.current;
    try { const r = await appeler<PageCerveau>(lieu, "lister", { ...filtre, limite: 80 }); if (n === generation.current) { setPage(r); setErreur(""); } }
    catch (e) { if (n === generation.current) setErreur(e instanceof Error ? e.message : "Mémoire indisponible."); }
  }, [lieu, filtre]);
  useEffect(() => { const compteur = generation; const timer = setTimeout(() => { void charger(); }, 180); return () => { clearTimeout(timer); compteur.current++; }; }, [charger]);
  useEffect(() => {
    if (onglet !== "graphe") return;
    const timer = setInterval(() => { void charger(); }, 20_000);
    return () => clearInterval(timer);
  }, [onglet, charger]);
  const service: ServiceMemoire = {
    notes: page.notes, total: page.total, erreur,
    lire: (id) => appeler<NoteCerveau>(lieu, "note", { id }),
    garder: async (note) => { const r = await appeler<NoteCerveau>(lieu, "garder", { note }); await charger(); return r; },
    oublier: async (note) => { await appeler(lieu, "oublier", { id: note.id, revision: note.revision }); await charger(); },
    rechercher: (recherche, projetId) => setFiltre({ recherche, projetId, offset: 0, centreId: "" }),
    explorer: (id) => setFiltre({ recherche: "", projetId: "", offset: 0, centreId: id }),
  };
  const [requete, setRequete] = useState(""), [budgetOctets, setBudget] = useState(4096);
  const [acteur, setActeur] = useState("principal"), [projetContexte, setProjetContexte] = useState("");
  const [resultats, setResultats] = useState<ResultatCerveau | null>(null), [lecture, setLecture] = useState<ResultatCerveau | null>(null);
  const [choisis, setChoisis] = useState<string[]>([]), [enCours, setEnCours] = useState(false), [retour, setRetour] = useState("");
  const portee = { apercuAgent: acteur || null, projetId: projetContexte || null };
  async function chercher(e: FormEvent) {
    e.preventDefault(); setEnCours(true); setRetour(""); setLecture(null);
    try { const r = await appeler<ResultatCerveau>(lieu, "chercher", { requete, budgetOctets, ...portee }); setResultats(r); setChoisis(r.elements.slice(0, 2).map((p) => p.id)); }
    catch (e) { setRetour(e instanceof Error ? e.message : "Recherche impossible."); } finally { setEnCours(false); }
  }
  async function lire() {
    setEnCours(true); setRetour("");
    try { setLecture(await appeler<ResultatCerveau>(lieu, "lire", { ids: choisis, budgetOctets, ...portee })); }
    catch (e) { setRetour(e instanceof Error ? e.message : "Lecture impossible."); } finally { setEnCours(false); }
  }
  const [agentSource, setAgentSource] = useState("principal"), [projetSource, setProjetSource] = useState(""), [chatSource, setChatSource] = useState("");
  async function indexer() {
    setEnCours(true); setRetour("");
    const p = state.projects.find((p) => p.id === projetSource && (p.lieu ?? null) === lieu);
    const conversation = state.chats.find((c) => c.id === chatSource && (c.lieu ?? null) === lieu);
    const projetChat = conversation ? state.projects.find((p) => p.id === (conversation.projectId ?? conversation.fil?.projetId)) : null;
    try {
      const r = await appeler<{ indexes: number; inchanges: number; coupee: boolean; avertissements: string[] }>(lieu, "indexer-souvenirs", { agent: agentSource, projetId: p?.id ?? projetChat?.id ?? null, contexte: { dossier: p?.folder ?? projetChat?.folder ?? null, sessionId: conversation?.sessions[agentSource] ?? null } });
      setRetour(`${r.indexes} souvenirs indexés, ${r.inchanges} inchangés.${r.coupee ? " Inventaire incomplet : limite d’import atteinte." : ""}${r.avertissements.length ? ` ${r.avertissements.length} avertissement(s) : ${r.avertissements.slice(0, 3).join(" ")}` : " Les fichiers d’origine sont conservés."}`);
      await charger();
    } catch (e) { setRetour(e instanceof Error ? e.message : "Indexation impossible."); } finally { setEnCours(false); }
  }
  async function importerTextes() {
    setEnCours(true); setRetour("");
    try {
      const r = await appeler<{ indexes: number; inchanges: number; avertissements: string[]; annule?: boolean }>(lieu, "choisir-documents", { projetId: projetSource || null });
      setRetour(r.annule ? "Import annulé." : `${r.indexes} documents indexés, ${r.inchanges} inchangés. ${r.avertissements.slice(0, 3).join(" ")}`); await charger();
    } catch (e) { setRetour(e instanceof Error ? e.message : "Import impossible."); } finally { setEnCours(false); }
  }
  async function migrer() {
    setEnCours(true); setRetour("");
    try {
      const notes = decoderMemoire(localStorage.getItem(cleMemoire(lieu)));
      let ajoutees = 0, presentes = 0;
      const correspondances = new Map<string, string>();
      for (const note of notes) {
        let existe: NoteMemoire | null = null;
        try { existe = await appeler<NoteCerveau>(lieu, "note", { id: note.id }); } catch { /* note non migrée */ }
        if (existe) { presentes++; correspondances.set(note.id, existe.id); continue; }
        // Les liens sont rétablis après les notes, pour ne créer aucune référence orpheline.
        const r = await appeler<NoteCerveau>(lieu, "garder", { note: { ...note, liens: [] } }); correspondances.set(note.id, r.id); ajoutees++;
      }
      for (const note of notes) {
        if (!note.liens.length) continue;
        const actuelle = await appeler<NoteCerveau>(lieu, "note", { id: correspondances.get(note.id) ?? note.id });
        await appeler(lieu, "garder", { note: { ...actuelle, liens: [...new Set([...actuelle.liens, ...note.liens.map((id) => correspondances.get(id) ?? id)])] } });
      }
      setRetour(`${ajoutees} notes importées, ${presentes} déjà présentes. La sauvegarde du premier prototype reste conservée.`); await charger();
    } catch (e) { setRetour(e instanceof Error ? e.message : "Import interrompu ; les notes déjà conservées restent disponibles."); } finally { setEnCours(false); }
  }
  async function sauvegarder() {
    setEnCours(true); setRetour("");
    try {
      const r = await appeler<{ fichier: string } | null>(lieu, "sauvegarder", {});
      setRetour(r?.fichier ? `Sauvegarde écrite : ${r.fichier}` : "Sauvegarde annulée.");
    } catch (e) { setRetour(e instanceof Error ? e.message : "Sauvegarde impossible."); } finally { setEnCours(false); }
  }
  function changerOnglet(v: typeof onglet) { setOnglet(v); setRetour(""); if (v === "graphe") void charger(); }
  return <div className="cerveau-scene">
    <nav className="cerveau-navigation" aria-label="Vues de la mémoire"><button aria-pressed={onglet === "graphe"} onClick={() => changerOnglet("graphe")}>Graphe des notes</button><button aria-pressed={onglet === "contexte"} onClick={() => changerOnglet("contexte")}>Retrouver du contexte</button><button aria-pressed={onglet === "sources"} onClick={() => changerOnglet("sources")}>Sources</button><span>{page.etat.notes} notes · {page.etat.passages} passages · {volume(page.etat.octetsSources)}</span></nav>
    {onglet === "graphe" ? <>{filtre.centreId && <div className="cerveau-pagination"><span>Graphe local : cette note et ses connexions directes.</span><button className="memoire-bouton" onClick={() => setFiltre({ recherche: "", projetId: "", offset: 0, centreId: "" })}>Vue d’ensemble</button></div>}<MemoireVue {...props} service={service}/>{(filtre.offset > 0 || page.suite !== null) && <div className="cerveau-pagination"><span>Le graphe affiche une fenêtre de {page.notes.length} notes. La recherche parcourt tout l’index.</span><button className="memoire-bouton" disabled={filtre.offset === 0} onClick={() => setFiltre({ ...filtre, offset: Math.max(0, filtre.offset - 80) })}>Précédentes</button><button className="memoire-bouton" disabled={page.suite === null} onClick={() => setFiltre({ ...filtre, offset: page.suite ?? 0 })}>Suivantes</button></div>}</> : <section className="cerveau-panneau">
      {onglet === "contexte" ? <>
        <span className="memoire-surtitre">Stocker largement. Lire précisément.</span><h1>Le bon contexte, au bon moment.</h1><p>La recherche renvoie des repères courts. Choisissez ensuite les passages à lire, avec leurs sources et leur version. Aucun appel à un modèle pour ces deux étapes.</p>
        <form className="cerveau-recherche" onSubmit={chercher}><label htmlFor="cerveau-question">Ce que vous cherchez</label><input id="cerveau-question" required maxLength={1000} value={requete} onChange={(e) => setRequete(e.target.value)} placeholder="Une décision, un sujet, un nom de projet…"/>
          <div className="cerveau-filtres"><label>Lire comme<select aria-label="Périmètre de l’agent" value={acteur} onChange={(e) => { setActeur(e.target.value); setResultats(null); setLecture(null); }}><option value="">Toutes mes notes (propriétaire)</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Projet<select aria-label="Projet du contexte" value={projetContexte} onChange={(e) => { setProjetContexte(e.target.value); setResultats(null); setLecture(null); }}><option value="">{acteur ? "Notes globales" : "Tous les projets"}</option>{projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Plafond par lecture<select aria-label="Budget de contexte" value={budgetOctets} onChange={(e) => { setBudget(Number(e.target.value)); setResultats(null); setLecture(null); }}>{[2048, 4096, 8192, 16384].map((n) => <option key={n} value={n}>{Math.ceil(n / 3).toLocaleString("fr")} tokens estimés · {n / 1024} Kio max</option>)}</select></label></div>
          <p className="memoire-discret">Les tokens sont une estimation indicative, variable selon le modèle. Le plafond exact s’applique à la sortie JSON en octets UTF-8, pas au total d’une conversation.</p><button className="memoire-bouton memoire-principal" disabled={enCours || !requete.trim()}>1. Chercher les sources</button>
        </form>
        {resultats && <section className="cerveau-resultats" aria-label="Sources trouvées"><h2>{resultats.elements.length} passages proposés</h2><p className="memoire-discret">{resultats.octets} octets renvoyés · environ {resultats.jetonsEstimes} tokens{resultats.tronque ? " · résultats limités" : ""}</p>{!resultats.elements.length && <p>{resultats.tronque ? "Le budget ne suffit pas à présenter ces sources. Augmentez le plafond." : "Aucun passage ne correspond, ni par les mots ni par le sens, dans ce périmètre."}</p>}{resultats.elements.map((p) => <label key={p.id} className="cerveau-resultat"><input type="checkbox" checked={choisis.includes(p.id)} onChange={(e) => setChoisis(e.target.checked ? [...choisis, p.id].slice(0, 8) : choisis.filter((id) => id !== p.id))}/><span><strong>{p.titre}</strong><small>{p.historique ? "Archive · " : ""}Version {p.revision} · lignes {p.lignes.join("–")} · {p.agentId ?? "note partagée"}</small><span>{p.extrait}</span></span></label>)}<button className="memoire-bouton" disabled={enCours || !choisis.length} onClick={lire}>2. Lire les passages choisis</button></section>}
        {lecture && <section className="cerveau-lecture" aria-label="Contexte sélectionné"><h2>Contexte prêt à consulter</h2><p>{lecture.octets} octets · environ {lecture.jetonsEstimes} tokens. {lecture.tronque ? "Certains passages ne tenaient pas dans ce budget." : "Sources incluses dans ce budget."}</p>{lecture.elements.map((p) => <article key={p.id}><h3>{p.titre}</h3><code>{p.id}</code><small>{p.historique ? "Archive · " : ""}Lignes {p.lignes.join("–")} · version {p.revision}</small><p>{p.extrait}</p></article>)}{!lecture.elements.length && <p>Passages indisponibles ou budget insuffisant. Si une note a changé, relancez la recherche.</p>}</section>}
      </> : <>
        <span className="memoire-surtitre">S’appuyer sur ce que KLYRA sait déjà</span><h1>Les sources du second cerveau.</h1><p>KLYRA range toute seule les souvenirs des agents, les fichiers qu’ils produisent et les décisions des conversations. Les originaux restent à leur place. Vous pouvez encore indexer ou importer à la main.</p>
        <section className="cerveau-source-carte"><h2>Sauvegarde</h2><p>Une copie complète de la mémoire, à garder où vous voulez. La mémoire en cours n’est pas modifiée, et rien n’est envoyé ailleurs.</p><button className="memoire-bouton" disabled={enCours} onClick={() => void sauvegarder()}>Sauvegarder la mémoire</button></section>
        {lieu && <SynchroServeur lieu={lieu} onActualiser={charger} />}
        <DigitalOsSource lieu={lieu} onActualiser={charger} onExplorer={(id) => { setFiltre({ recherche: "", projetId: "", offset: 0, centreId: id }); setOnglet("graphe"); }}/>
        <section className="cerveau-source-carte"><h2>Indexer une mémoire d’agent</h2><div className="cerveau-filtres"><label>Agent<select aria-label="Agent à indexer" value={agentSource} onChange={(e) => setAgentSource(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Projet<select aria-label="Projet à indexer" value={projetSource} onChange={(e) => setProjetSource(e.target.value)}><option value="">Hors projet</option>{projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Conversation de référence<select aria-label="Conversation à indexer" value={chatSource} onChange={(e) => setChatSource(e.target.value)}><option value="">Atelier de l’agent</option>{state.chats.filter((c) => (c.lieu ?? null) === lieu && c.roleIds.includes(agentSource)).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label></div><p className="memoire-discret">Le dossier est calculé par le système de mémoire actuel, selon la fiche et le contexte choisis. Seuls les contenus modifiés sont réindexés. Une indexation complète écarte des recherches les fichiers qui ont disparu de cette source.</p><button className="memoire-bouton memoire-principal" disabled={enCours} onClick={indexer}>Indexer ces souvenirs</button></section>
        <section className="cerveau-source-carte"><h2>Documents, PDF et médias</h2><p>Choisissez des fichiers Markdown, texte, CSV, JSON, journaux, PDF, images ou sons. D’un PDF, l’app garde le texte des pages (pas celui d’un document scanné ou protégé) ; d’une image ou d’un son, ce que le fichier dit de lui (titre, description, étiquettes), jamais une description inventée ni une transcription. Le fichier d’origine reste intact. Les agents pourront chercher dans la copie indexée selon son projet.</p><label>Projet des documents<select aria-label="Projet des documents" value={projetSource} onChange={(e) => setProjetSource(e.target.value)}><option value="">Notes globales</option>{projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="memoire-discret">2 Mo par fichier texte, 40 Mo par PDF, image ou son, vingt fichiers par sélection. Le texte est lu sur cet ordinateur : sur un serveur sélectionné, seul ce texte y est envoyé, à votre demande. Réimportez un fichier modifié pour actualiser son index.</p><button className="memoire-bouton" disabled={enCours} onClick={importerTextes}>Importer des documents</button></section>
        <section className="cerveau-source-carte"><h2>Notes du premier prototype</h2><p>Importez les notes de ce lieu vers le stockage durable. Les anciennes notes restent conservées comme sauvegarde ; les notes déjà présentes ne sont pas écrasées.</p><button className="memoire-bouton" disabled={enCours} onClick={migrer}>Importer les notes du premier prototype</button></section>
        <p className="memoire-discret">Le texte est indexé sur place. Les PDF, les médias et les apps externes ne sont pas encore lus. Une recherche trouve les mots et le sens proche, avec la source du passage.</p>
      </>}
      {erreur && <p role="alert" className="memoire-erreur">{erreur}</p>}{retour && <p role="status" className="cerveau-retour">{retour}</p>}{enCours && <p role="status">Traitement en cours…</p>}
    </section>}
  </div>;
}
