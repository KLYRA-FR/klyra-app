"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent } from "react";
import { aretesMemoire, chercherMemoire, cleMemoire, decoderMemoire, enregistrerMemoire, EVENEMENT_MEMOIRE, exempleMemoire, placerMemoire, sansNote, type CaptureMemoire, type NoteMemoire, type SourceMemoire } from "@/lib/memoire";

type Projet = { id: string; name: string };
export interface ServiceMemoire {
  notes: NoteMemoire[]; total: number; erreur: string;
  lire: (id: string) => Promise<NoteMemoire>; garder: (note: NoteMemoire) => Promise<NoteMemoire>;
  oublier: (note: NoteMemoire) => Promise<void>; rechercher: (texte: string, projet: string) => void;
  explorer?: (id: string) => void;
}
type Props = { lieu: string | null; projets: Projet[]; capture?: CaptureMemoire | null; ouvrirSource: (source: SourceMemoire) => void; captureTerminee?: () => void; exempleInitial?: boolean; service?: ServiceMemoire };
function abonner(rappel: () => void) {
  window.addEventListener("storage", rappel); window.addEventListener(EVENEMENT_MEMOIRE, rappel);
  return () => { window.removeEventListener("storage", rappel); window.removeEventListener(EVENEMENT_MEMOIRE, rappel); };
}
const zoomBorne = (v: number) => Math.max(0.4, Math.min(3, v));

/** Le même écran est monté dans klyra-app et dans l'aperçu autonome. */
export function MemoireVue({ lieu, projets, capture, ouvrirSource, captureTerminee, exempleInitial = false, service }: Props) {
  const [demo, setDemo] = useState(exempleInitial);
  const [notesDemo, setNotesDemo] = useState(exempleMemoire);
  const brut = useSyncExternalStore(abonner, () => { try { return localStorage.getItem(cleMemoire(lieu)); } catch { return "stockage-indisponible"; } }, () => null);
  const lecture = useMemo(() => { try { return { notes: decoderMemoire(brut), erreur: "" }; } catch (e) { return { notes: [] as NoteMemoire[], erreur: e instanceof Error ? e.message : "Stockage indisponible." }; } }, [brut]);
  const notes = demo ? notesDemo : service?.notes ?? lecture.notes;
  const [noteChargee, setNoteChargee] = useState<NoteMemoire | null>(null);
  const numeroLecture = useRef(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [mode, setMode] = useState<"lecture" | "creation" | "edition">(capture ? "creation" : "lecture");
  const [recherche, setRecherche] = useState("");
  const [projet, setProjet] = useState("");
  const [erreur, setErreur] = useState("");
  const [statut, setStatut] = useState("");
  const [suppression, setSuppression] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canevas = useRef<SVGSVGElement>(null);
  const [echelle, setEchelle] = useState(1);
  useEffect(() => {
    const el = canevas.current;
    if (!el) return;
    const observateur = new ResizeObserver(([entree]) => {
      setEchelle(Math.max(0.05, Math.min(entree.contentRect.width / 1100, entree.contentRect.height / 760)));
    });
    observateur.observe(el);
    return () => observateur.disconnect();
  }, []);
  const deplacement = useRef<{ x: number; y: number; depart: { x: number; y: number } } | null>(null);
  const visibles = useMemo(() => notes.filter((n) => !projet || (projet === "sans-projet" ? !n.projetId : n.projetId === projet)), [notes, projet]);
  const correspondances = useMemo(() => service && !demo ? new Set(visibles.map((n) => n.id)) : chercherMemoire(visibles, recherche), [visibles, recherche, service, demo]);
  const positions = useMemo(() => placerMemoire(visibles), [visibles]);
  const aretes = useMemo(() => aretesMemoire(visibles), [visibles]);
  const courante = noteChargee?.id === selection ? noteChargee : notes.find((n) => n.id === selection) ?? null;
  const voisins = new Set(aretes.filter(([a, b]) => a === selection || b === selection).flat());
  const erreurStockage = service?.erreur ?? lecture.erreur;
  const bloque = !demo && !!erreurStockage;

  async function choisir(id: string) {
    if (mode !== "lecture") return;
    const numero = ++numeroLecture.current;
    if (service && !demo) {
      try { setStatut("Chargement de la note…"); const note = await service.lire(id); if (numero !== numeroLecture.current) return; setNoteChargee(note); }
      catch (e) { if (numero === numeroLecture.current) setErreur(e instanceof Error ? e.message : "Note indisponible."); return; }
    }
    setSelection(id); setSuppression(false); setErreur(""); setStatut("");
  }
  function ecrire(suivantes: NoteMemoire[]) {
    if (demo) setNotesDemo(suivantes); else enregistrerMemoire(lieu, suivantes);
  }
  async function garder(note: NoteMemoire) {
    try {
      const doublon = !courante && note.source ? notes.find((n) => n.source?.chatId === note.source?.chatId && n.source?.messageId === note.source?.messageId && n.contenu === note.contenu && n.titre === note.titre) : undefined;
      const resultat = service && !demo ? await service.garder(note) : doublon ?? note;
      if (!doublon && !(service && !demo)) ecrire([...notes.filter((n) => n.id !== note.id).map((n) => ({ ...n, liens: n.liens.filter((l) => l !== note.id) })), note]);
      setNoteChargee(resultat);
      setSelection(resultat.id); setMode("lecture"); setErreur(""); setStatut(doublon ? "Ce passage est déjà en mémoire." : "Note enregistrée."); captureTerminee?.();
    } catch (e) { setErreur(`Impossible d’enregistrer la note. ${e instanceof Error ? e.message : "Stockage indisponible."} Ton texte reste dans le formulaire.`); }
  }
  async function supprimer() {
    if (!courante) return;
    try { if (service && !demo) await service.oublier(courante); else ecrire(sansNote(notes, courante.id)); setSelection(null); setNoteChargee(null); setSuppression(false); setStatut("Note et liens retirés."); setErreur(""); }
    catch { setErreur("Impossible de supprimer la note. Réessaie quand le stockage sera disponible."); }
  }
  function debutPan(e: PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest("[data-note]") || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    deplacement.current = { x: e.clientX, y: e.clientY, depart: pan };
  }
  function mouvement(e: PointerEvent<SVGSVGElement>) {
    if (!deplacement.current) return;
    const rect = e.currentTarget.getBoundingClientRect(), facteur = Math.max(1100 / rect.width, 760 / rect.height);
    setPan({ x: deplacement.current.depart.x + (e.clientX - deplacement.current.x) * facteur, y: deplacement.current.depart.y + (e.clientY - deplacement.current.y) * facteur });
  }
  function changerDemo(active: boolean) {
    service?.rechercher("", "");
    setDemo(active); setSelection(null); setMode("lecture"); setRecherche(""); setProjet(""); setErreur(""); setStatut(""); setPan({ x: 0, y: 0 }); setZoom(1);
  }

  return <main className="memoire-app" aria-label="Mémoire">
    <header className="memoire-entete">
      <div><div className="memoire-surtitre">Le contexte reste. Les idées se relient.</div><h1>Mémoire</h1></div>
      <button className="memoire-bouton memoire-principal" disabled={bloque || mode !== "lecture"} onClick={() => { setSelection(null); setMode("creation"); setErreur(""); }}>+ Nouvelle note</button>
    </header>
    <div className="memoire-outils">
      <label className="memoire-recherche"><span aria-hidden="true">⌕</span><input aria-label="Rechercher dans la mémoire" placeholder="Retrouver une idée, une décision…" value={recherche} onChange={(e) => { setRecherche(e.target.value); if (!demo) service?.rechercher(e.target.value, projet); }} /></label>
      <select aria-label="Filtrer par projet" value={projet} onChange={(e) => { setProjet(e.target.value); if (!demo) service?.rechercher(recherche, e.target.value); }}><option value="">Tous les projets</option><option value="sans-projet">Sans projet</option>{projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <span className="memoire-compteur">{visibles.length}{service && !demo ? ` sur ${service.total}` : ""} notes · {aretes.length} liens</span>
    </div>
    {demo && <div className="memoire-demo"><span>Graphe de démonstration · exemples fictifs, non enregistrés</span><button onClick={() => changerDemo(false)}>Revenir à ma mémoire ↗</button></div>}
    {bloque && <p role="alert" className="memoire-erreur">La mémoire ne peut pas être lue. {erreurStockage} Recharge l’écran pour réessayer.</p>}
    <div className="memoire-corps">
      <section className="memoire-graphe" aria-label="Graphe des notes">
        <div className="memoire-graphe-titre"><span className="memoire-point" />{demo ? "Les idées, en constellation" : "Votre constellation"}<span>Liens automatiques, et ceux que vous avez posés</span></div>
        <svg ref={canevas} className="memoire-canevas" viewBox="0 0 1100 760" onPointerDown={debutPan} onPointerMove={mouvement} onPointerUp={() => { deplacement.current = null; }} onPointerCancel={() => { deplacement.current = null; }} onWheel={(e) => setZoom((z) => zoomBorne(z * (e.deltaY < 0 ? 1.08 : 0.92)))} aria-label="Carte interactive : cliquer une note pour la lire, faire glisser le fond pour déplacer le graphe">
          <defs><radialGradient id="memoire-halo"><stop offset="0" stopColor="#3365e9" stopOpacity=".22"/><stop offset="1" stopColor="#3365e9" stopOpacity="0"/></radialGradient><filter id="memoire-lueur" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="4"/></filter></defs>
          <circle cx="550" cy="380" r="380" fill="url(#memoire-halo)" pointerEvents="none"/>
          <g transform={`translate(${pan.x + 550} ${pan.y + 380}) scale(${zoom}) translate(-550 -380)`}>
            {aretes.map(([a, b]) => {
              const na = visibles.find((n) => n.id === a);
              const auto = (na?.liensAuto?.includes(b) || visibles.find((n) => n.id === b)?.liensAuto?.includes(a)) && !na?.liensManuels?.includes(b) && !visibles.find((n) => n.id === b)?.liensManuels?.includes(a);
              return <line key={`${a}:${b}`} x1={positions[a].x} y1={positions[a].y} x2={positions[b].x} y2={positions[b].y} className={`memoire-lien ${auto ? "memoire-lien-auto" : ""} ${a === selection || b === selection ? "est-relie" : ""}`} />;
            })}
            {visibles.map((n) => {
              const point = positions[n.id], degre = aretes.filter(([a, b]) => a === n.id || b === n.id).length;
              const actif = n.id === selection, estVoisin = voisins.has(n.id), correspond = correspondances.has(n.id);
              const rayon = 6 + Math.min(degre, 8) * 1.4;
              return <g key={n.id} data-note={n.id} role="button" tabIndex={mode === "lecture" ? 0 : -1} aria-label={`Lire ${n.titre}`} aria-pressed={actif} aria-disabled={mode !== "lecture"} className={`memoire-noeud ${actif ? "est-actif" : ""} ${estVoisin ? "est-voisin" : ""} ${!correspond ? "est-estompe" : ""}`} transform={`translate(${point.x} ${point.y})`} onClick={() => choisir(n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choisir(n.id); } }}>
                <g transform={`scale(${1 / (echelle * zoom)})`}>
                <circle r={rayon} fill="transparent" stroke="transparent" strokeWidth={44} vectorEffect="non-scaling-stroke" />
                <circle className="memoire-noeud-flou" r={rayon + 7} fill="#668cef" filter="url(#memoire-lueur)" opacity={actif ? 0.8 : 0.22}/>
                <circle className="memoire-noeud-anneau" r={rayon + 7} fill="none" stroke="#99b2f4" strokeOpacity={actif ? 0.9 : 0.12}/>
                <circle className="memoire-noeud-coeur" r={rayon} fill={actif ? "#e5ecfc" : estVoisin ? "#99b2f4" : "#668cef"}/>
                <text y={rayon + 28} textAnchor="middle">{n.titre.length > 30 ? `${n.titre.slice(0, 29)}…` : n.titre}</text><title>{n.titre}</title>
                </g>
              </g>;
            })}
          </g>
        </svg>
        {!visibles.length && <div className="memoire-vide"><div className="memoire-vide-symbole" aria-hidden="true">✳</div><h2>{notes.length ? "Aucune note dans ce projet" : "Les idées prennent forme ici"}</h2><p>{notes.length ? "Choisissez un autre projet pour retrouver vos notes." : "Gardez un passage, reliez deux idées. Votre mémoire se dessine au fil des échanges."}</p>{notes.length ? <button className="memoire-bouton" onClick={() => setProjet("")}>Voir tous les projets</button> : <><button className="memoire-bouton memoire-principal" disabled={bloque || mode !== "lecture"} onClick={() => { setSelection(null); setMode("creation"); }}>Créer ma première note</button><button className="memoire-lien-texte" disabled={mode !== "lecture"} onClick={() => changerDemo(true)}>Explorer un exemple de graphe ↗</button></>}</div>}
        {!!recherche && <div className="memoire-resultat-graphe" role="status">{correspondances.size ? `${correspondances.size} note${correspondances.size > 1 ? "s" : ""} trouvée${correspondances.size > 1 ? "s" : ""}` : "Aucun résultat. Essayez un autre mot."}<button onClick={() => setRecherche("")}>Effacer</button></div>}
        <div className="memoire-legende"><span>●</span> Une note <span className="memoire-trait">—</span> Lien posé <span className="memoire-trait memoire-legende-auto">—</span> Lien automatique</div>
        <div className="memoire-zoom"><button aria-label="Réduire le graphe" onClick={() => setZoom((z) => zoomBorne(z / 1.2))}>−</button><button aria-label="Recentrer le graphe" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{Math.round(zoom * 100)} %</button><button aria-label="Agrandir le graphe" onClick={() => setZoom((z) => zoomBorne(z * 1.2))}>+</button></div>
      </section>
      <aside className="memoire-panneau" aria-label="Détail de la note">
        {erreur && <p className="memoire-erreur" role="alert">{erreur}</p>}
        {mode !== "lecture" ? <EditeurNote key={mode + (courante?.id ?? capture?.source.messageId ?? "nouvelle")} note={mode === "edition" ? courante : null} capture={mode === "creation" ? capture : null} notes={notes} projets={projets} projetInitial={projet !== "sans-projet" ? projet : ""} onGarder={garder} onAnnuler={() => { setMode("lecture"); setErreur(""); captureTerminee?.(); }} /> : courante ? <>
          <div className="memoire-panneau-entete"><span className="memoire-surtitre">Note sélectionnée</span><button aria-label="Fermer la note" className="memoire-fermer" onClick={() => setSelection(null)}>×</button></div>
          <h2>{courante.titre}</h2><span className="memoire-etiquette">{projets.find((p) => p.id === courante.projetId)?.name ?? (courante.projetId ? "Projet indisponible" : "Sans projet")}</span>
          <p className="memoire-contenu">{courante.contenu}</p>
          {courante.source ? <section className="memoire-source"><h3>À l’origine de cette note</h3><p>{courante.source.titre}</p><blockquote>{courante.source.extrait}</blockquote><button className="memoire-lien-texte" onClick={() => { try { ouvrirSource(courante.source!); } catch (e) { setErreur(e instanceof Error ? e.message : "Source indisponible."); } }}>Revenir au message ↗</button></section> : <p className="memoire-discret">{courante.origine ? courante.origine.startsWith("dossier:") ? "Fichier de DIGITAL-OS. Modifiez le fichier d’origine puis actualisez le dossier." : courante.agentId ? `Souvenir indexé de ${courante.agentId}. Modifiez sa source dans le panneau de l’agent, puis réindexez.` : "Document texte indexé. Réimportez le fichier pour actualiser cette copie." : `Note ${demo ? "de démonstration" : "créée manuellement"} · sans message source`}</p>}
          <h3>Connexions · {voisins.size ? voisins.size - 1 : 0}</h3>
          {service?.explorer && !demo && <button className="memoire-lien-texte" onClick={() => { setRecherche(""); setProjet(""); service.explorer?.(courante.id); }}>Explorer les liens de cette note ↗</button>}
          <div className="memoire-connexions">{notes.filter((n) => n.id !== courante.id && (courante.liens.includes(n.id) || n.liens.includes(courante.id))).map((n) => <button key={n.id} onClick={() => choisir(n.id)}>{n.titre}{courante.liensAuto?.includes(n.id) ? <em> automatique</em> : null}<span aria-hidden="true">↗</span></button>)}{!voisins.size && <p className="memoire-discret">Les liens automatiques apparaissent ici. Vous pouvez aussi en poser un.</p>}</div>
          <div className="memoire-actions-note"><button className="memoire-bouton" disabled={!!courante.origine} onClick={() => { setMode("edition"); setSuppression(false); setErreur(""); }}>Modifier la note</button><button className="memoire-lien-texte memoire-danger" onClick={() => setSuppression(true)}>Oublier</button></div>
          {suppression && <div className="memoire-confirmation"><p>Oublier cette note et ses liens ? Le message source reste conservé.</p><button className="memoire-bouton memoire-danger" onClick={supprimer}>Confirmer la suppression</button><button className="memoire-lien-texte" onClick={() => setSuppression(false)}>Annuler</button></div>}
        </> : <>
          <span className="memoire-surtitre">Explorer la mémoire</span><h2>Un lien en fait naître un autre.</h2><p className="memoire-discret">Cliquez sur un point pour lire la note et suivre ses connexions.</p>
          <h3>{recherche ? "Résultats" : "Toutes les notes"}<span className="memoire-liste-nombre">{correspondances.size}</span></h3>
          <div className="memoire-liste">{visibles.filter((n) => correspondances.has(n.id)).map((n) => <button key={n.id} onClick={() => choisir(n.id)}><span className="memoire-liste-point"/><span>{n.titre}</span><span aria-hidden="true">↗</span></button>)}{!correspondances.size && <p className="memoire-discret">{notes.length ? "Aucun résultat pour ces filtres." : "Vos notes apparaîtront ici."}</p>}</div>
          <div className="memoire-aide"><h3>Du chat au graphe</h3><p>Sur un message, ouvrez le menu puis choisissez « Garder en mémoire ». Vous relisez la note avant de la conserver.</p></div>
        </>}
      </aside>
    </div>
    <footer className="memoire-pied"><span>La mémoire relie d’elle-même. « Garder en mémoire » reste là pour un passage précis.</span><span>{demo ? "Exemples temporaires" : service ? "Stockage sur cet ordinateur · les fichiers d’origine ne bougent pas" : "Prototype local · sans synchronisation ni lecture par les agents"}</span></footer>
    <p className="memoire-sr" role="status">{statut}</p>
  </main>;
}

function EditeurNote({ note, capture, notes, projets, projetInitial, onGarder, onAnnuler }: { note: NoteMemoire | null; capture?: CaptureMemoire | null; notes: NoteMemoire[]; projets: Projet[]; projetInitial: string; onGarder: (note: NoteMemoire) => void; onAnnuler: () => void }) {
  const id = useId();
  const [titre, setTitre] = useState(note?.titre ?? capture?.contenu.split(/\n/)[0].slice(0, 100) ?? "");
  const [contenu, setContenu] = useState(note?.contenu ?? capture?.contenu ?? "");
  const [projet, setProjet] = useState(note?.projetId ?? capture?.projetId ?? projetInitial);
  const [liens, setLiens] = useState(note ? [...new Set([...note.liens, ...notes.filter((n) => n.liens.includes(note.id)).map((n) => n.id)])] : []);
  function valider(e: FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !contenu.trim()) return;
    const maintenant = new Date().toISOString();
    onGarder({ id: note?.id ?? crypto.randomUUID(), titre: titre.trim(), contenu: contenu.trim(), projetId: projet || null, liens, liensAuto: note?.liensAuto ?? [], source: note?.source ?? capture?.source ?? null, creeLe: note?.creeLe ?? maintenant, modifieLe: maintenant, revision: note?.revision });
  }
  return <form className="memoire-editeur" onSubmit={valider}>
    <span className="memoire-surtitre">{note ? "Faire évoluer une idée" : capture ? "Depuis la conversation" : "Une idée à conserver"}</span><h2>{note ? "Modifier la note" : "Garder en mémoire"}</h2>
    <label htmlFor={`${id}-titre`}>Titre</label><input id={`${id}-titre`} autoFocus required maxLength={120} value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Une idée, en quelques mots"/>
    <label htmlFor={`${id}-contenu`}>Ce que vous voulez retenir</label><textarea id={`${id}-contenu`} required maxLength={12000} rows={6} value={contenu} onChange={(e) => setContenu(e.target.value)} placeholder="Le contexte, le choix, ce qui compte…"/>
    <label htmlFor={`${id}-projet`}>Projet</label><select id={`${id}-projet`} value={projet} onChange={(e) => setProjet(e.target.value)}><option value="">Sans projet</option>{projet && !projets.some((p) => p.id === projet) && <option value={projet}>Projet indisponible</option>}{projets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    <fieldset><legend>Relier à une autre note</legend><p className="memoire-discret">Une case déjà cochée peut venir d’un lien automatique. La décocher l’empêche de revenir.</p>{notes.filter((n) => n.id !== note?.id).map((n) => <label className="memoire-case" key={n.id}><input type="checkbox" checked={liens.includes(n.id)} onChange={(e) => setLiens(e.target.checked ? [...liens, n.id] : liens.filter((l) => l !== n.id))}/>{n.titre}{note?.liensAuto?.includes(n.id) ? " · automatique" : ""}</label>)}{notes.filter((n) => n.id !== note?.id).length === 0 && <p className="memoire-discret">Vous pourrez relier cette note dès qu’une autre idée sera conservée.</p>}</fieldset>
    {(note?.source ?? capture?.source) && <p className="memoire-discret">Le message source reste attaché à cette note.</p>}
    <div className="memoire-actions-note"><button type="submit" className="memoire-bouton memoire-principal" disabled={!titre.trim() || !contenu.trim()}>Enregistrer la note</button><button type="button" className="memoire-lien-texte" onClick={onAnnuler}>Annuler</button></div>
  </form>;
}
