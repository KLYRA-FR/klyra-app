"use client";
import { useEffect, useState } from "react";
import type { SourceDossier } from "../../../electron/cerveau-types";
import { appelerCerveau } from "@/lib/cerveau-pont";

type Entree = { nom: string; relatif: string; genre: string; etat: string; noteId: string | null; taille: number };
type Dossier = { relatif: string; entrees: Entree[]; total: number; suite: number | null };
const etiquettes: Record<string, string> = { indexe: "Texte indexé (PDF, image ou son : ce qui s’en lit)", "repere-seul": "Pièce repérée · contenu non extrait", "volume-non-indexe": "Repère · fichier trop volumineux (2 Mo pour un texte, 40 Mo pour un PDF, une image ou un son)", protege: "Contenu protégé · non indexé", technique: "Copie technique · non indexée", "lien-non-suivi": "Lien non suivi", "non-indexe": "Pas encore indexé", catalogue: "Dossier", erreur: "Lecture impossible" };
export function DigitalOsSource({ lieu, onActualiser, onExplorer }: { lieu: string | null; onActualiser: () => Promise<void>; onExplorer: (id: string) => void }) {
  const [source, setSource] = useState<SourceDossier | null>(null), [dossier, setDossier] = useState<Dossier | null>(null);
  const [erreur, setErreur] = useState(""), [attente, setAttente] = useState(false), [forcer, setForcer] = useState(false);
  useEffect(() => {
    let annule = false;
    const charger = async () => {
      try {
        const r = await appelerCerveau<SourceDossier | null>(lieu, "digital-os-etat");
        if (annule) return;
        setSource(r);
      } catch (e) { if (!annule) setErreur(e instanceof Error ? e.message : "Source indisponible."); }
    };
    void charger();
    return () => { annule = true; };
  }, [lieu]);
  async function parcourir(relatif = "", offset = 0) {
    try { setDossier(await appelerCerveau<Dossier>(lieu, "digital-os-parcourir", { relatif, offset })); setErreur(""); }
    catch (e) { setErreur(e instanceof Error ? e.message : "Dossier indisponible."); }
  }
  async function connecter() {
    setAttente(true); setErreur("");
    try { const r = await appelerCerveau<SourceDossier | null>(lieu, "digital-os-connecter"); setSource(r); if (r) await parcourir(); }
    catch (e) { setErreur(e instanceof Error ? e.message : "Connexion impossible."); } finally { setAttente(false); }
  }
  async function scanner() {
    setAttente(true); setErreur("");
    try { setSource(await appelerCerveau<SourceDossier>(lieu, "digital-os-demarrer", { forcer })); }
    catch (e) { setErreur(e instanceof Error ? e.message : "Indexation impossible."); } finally { setAttente(false); }
  }
  const enCours = source?.etat === "indexation";
  useEffect(() => {
    if (!enCours) return;
    let annule = false, timer: ReturnType<typeof setTimeout> | undefined;
    const suivre = async () => {
      try {
        const r = await appelerCerveau<SourceDossier | null>(lieu, "digital-os-etat");
        if (annule) return;
        setSource(r);
        if (r?.etat === "indexation") timer = setTimeout(suivre, 1000);
        else { await onActualiser(); setDossier(null); }
      } catch (e) { if (!annule) setErreur(e instanceof Error ? e.message : "Suivi interrompu."); }
    };
    timer = setTimeout(suivre, 500);
    return () => { annule = true; clearTimeout(timer); };
  }, [enCours, lieu, onActualiser]);

  return <section className="cerveau-source-carte digital-os-source" aria-label="Dossier source DIGITAL-OS">
    <div><span className="memoire-surtitre">Le fonds documentaire</span><h2>DIGITAL-OS</h2></div>
    <p>Tout votre dossier comme point d’entrée : Personnel, Entreprise, Clients, Knowledge, Agent OS et Archives. Les fichiers restent à leur place ; l’index sert à retrouver uniquement les passages utiles.</p>
    {!source ? <><p className="memoire-discret">{lieu ? "Connexion au dossier DIGITAL-OS déjà présent sur ce serveur." : "Choisissez votre dossier DIGITAL-OS sur cet ordinateur."} Aucun fichier original ne sera modifié.</p><button className="memoire-bouton memoire-principal" disabled={attente} onClick={connecter}>Connecter DIGITAL-OS</button></> : <>
      <code className="digital-os-chemin">{source.racine}</code><p className="memoire-discret">Extraits consultables par l’assistant principal. Les pièces jointes sont repérées sans inventer leur contenu. Caches, copies Git et fichiers de secrets connus ne sont pas indexés.</p>
      <div className="digital-os-compteurs"><span><strong>{source.fichiers.toLocaleString("fr")}</strong> fichiers parcourus</span><span><strong>{(source.indexes + source.inchanges).toLocaleString("fr")}</strong> textes disponibles</span><span><strong>{source.reperes.toLocaleString("fr")}</strong> repères sans extraction</span></div>
      <p className="memoire-discret">{source.proteges} entrées protégées · {source.techniques} entrées techniques · {source.erreurs} erreurs. Les dossiers techniques exclus ne sont pas parcourus.</p>
      <div className="digital-os-actions"><button className="memoire-bouton memoire-principal" disabled={attente || enCours} onClick={scanner}>{source.fin ? "Actualiser DIGITAL-OS" : "Indexer le dossier"}</button><button className="memoire-bouton" disabled={attente} onClick={() => parcourir()}>Explorer l’arborescence</button>{enCours && <button className="memoire-bouton memoire-danger" onClick={async () => { try { await appelerCerveau(lieu, "digital-os-arreter"); } catch (e) { setErreur(e instanceof Error ? e.message : "Arrêt impossible."); } }}>Arrêter l’indexation</button>}</div>
      <label className="memoire-case"><input type="checkbox" checked={forcer} disabled={enCours} onChange={(e) => setForcer(e.target.checked)}/>Vérifier aussi le contenu des fichiers dont la date n’a pas changé</label>
      <p role="status" className="digital-os-etat">{enCours ? "Indexation en cours par lots. Vous pouvez continuer à utiliser KLYRA." : source.message || "Dossier connecté. KLYRA le relit seule ; vous pouvez aussi lancer une indexation."}</p>
      {!!Object.keys(source.espaces).length && <div className="digital-os-espaces">{Object.entries(source.espaces).map(([nom, n]) => <button key={nom} className="memoire-bouton" onClick={() => parcourir(nom === "(racine)" ? "" : nom)}>{nom}<span>{n.toLocaleString("fr")}</span></button>)}</div>}
      {dossier && <div className="digital-os-arbre"><div className="digital-os-actions"><strong>DIGITAL-OS{dossier.relatif ? ` / ${dossier.relatif}` : ""}</strong>{dossier.relatif && <button className="memoire-lien-texte" onClick={() => parcourir(dossier.relatif.split("/").slice(0, -1).join("/"))}>Remonter</button>}</div>{!dossier.entrees.length && <p className="memoire-discret">Ce dossier est vide.</p>}{dossier.entrees.map((e) => <div key={e.relatif} className="digital-os-entree"><button className="memoire-lien-texte" disabled={e.genre !== "dossier" || ["technique", "protege"].includes(e.etat)} onClick={() => parcourir(e.relatif)}>{e.genre === "dossier" ? "▸ " : ""}{e.nom}</button><span>{etiquettes[e.etat] ?? e.etat}</span>{e.noteId && ["indexe", "repere-seul", "volume-non-indexe"].includes(e.etat) && <button className="memoire-lien-texte" onClick={() => onExplorer(e.noteId!)}>Voir dans le graphe ↗</button>}</div>)}{dossier.suite !== null && <button className="memoire-bouton" onClick={() => parcourir(dossier.relatif, dossier.suite!)}>Éléments suivants ({dossier.total})</button>}</div>}
    </>}
    {erreur && <p role="alert" className="memoire-erreur">{erreur}</p>}
  </section>;
}
