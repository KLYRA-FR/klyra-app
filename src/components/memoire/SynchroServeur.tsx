"use client";
import { useCallback, useEffect, useState } from "react";
import { appelerCerveau } from "@/lib/cerveau-pont";

/** Ce que le PC dit de la synchronisation avec ce serveur (`vue` de electron/cerveau-synchro-pc.ts). */
interface VueSynchro {
  actif: boolean;
  enCours: boolean;
  notesAccordees: number;
  enAttente: number;
  dernier: { le: string; envoyees: number; recues: number; conflits: number; erreur: string | null } | null;
}

function quand(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Les notes écrites à la main, partagées entre ce PC et le serveur affiché, donc avec tout autre ordinateur
 * relié à ce serveur. Rien ne part avant que la personne l'allume ; le reste de la mémoire se recalcule sur
 * chaque machine depuis ses propres sources.
 */
export function SynchroServeur({ lieu, onActualiser }: { lieu: string; onActualiser: () => Promise<void> }) {
  const [vue, setVue] = useState<VueSynchro | null>(null), [erreur, setErreur] = useState(""), [attente, setAttente] = useState(false);
  const relire = useCallback(async () => {
    try { setVue(await appelerCerveau<VueSynchro>(lieu, "synchro-etat")); setErreur(""); }
    catch (e) { setErreur(e instanceof Error ? e.message : "État indisponible."); }
  }, [lieu]);
  useEffect(() => {
    let annule = false;
    void appelerCerveau<VueSynchro>(lieu, "synchro-etat").then((v) => { if (!annule) setVue(v); }).catch(() => undefined);
    return () => { annule = true; };
  }, [lieu]);
  async function agir(action: "synchro-activer" | "synchro-lancer", args: Record<string, unknown> = {}) {
    setAttente(true); setErreur("");
    try {
      setVue(await appelerCerveau<VueSynchro>(lieu, action, args));
      if (action === "synchro-lancer") await onActualiser();
    } catch (e) { setErreur(e instanceof Error ? e.message : "Synchronisation impossible."); }
    finally { setAttente(false); void relire(); }
  }
  const d = vue?.dernier;
  return <section className="cerveau-source-carte" aria-label="Synchronisation avec ce serveur">
    <div><span className="memoire-surtitre">Entre vos appareils</span><h2>Synchroniser mes notes</h2></div>
    <p>Les notes écrites à la main (« Garder en mémoire ») passent entre cet ordinateur et ce serveur, donc vers tout autre ordinateur relié à lui. Le reste de la mémoire (souvenirs des agents, DIGITAL-OS, fichiers, décisions) se lit sur chaque machine depuis ses propres fichiers. Rien ne passe par le compte d’équipe.</p>
    <p className="memoire-discret">Une note modifiée des deux côtés garde ses deux versions ; une note oubliée d’un côté et modifiée de l’autre est gardée. Toutes les 10 minutes une fois allumée, et à la demande.</p>
    <label className="memoire-discret"><input type="checkbox" checked={vue?.actif ?? false} disabled={!vue || attente} onChange={(e) => void agir("synchro-activer", { actif: e.target.checked })} /> Synchroniser mes notes avec ce serveur</label>
    {vue?.actif && <button className="memoire-bouton" disabled={attente || vue.enCours} onClick={() => void agir("synchro-lancer")}>{attente || vue.enCours ? "Synchronisation…" : "Synchroniser maintenant"}</button>}
    {d && <p className="memoire-discret" role="status">
      {d.erreur ? `Dernier essai le ${quand(d.le)} : ${d.erreur}` : `Dernière synchronisation le ${quand(d.le)} : ${d.envoyees} envoyée${d.envoyees > 1 ? "s" : ""}, ${d.recues} reçue${d.recues > 1 ? "s" : ""}${d.conflits ? `, ${d.conflits} gardée${d.conflits > 1 ? "s" : ""} en deux versions` : ""}.`}
      {vue && vue.enAttente > 0 ? ` ${vue.enAttente} note${vue.enAttente > 1 ? "s" : ""} repartira au prochain tour (changée sur le serveur entre-temps).` : ""}
    </p>}
    {erreur && <p className="memoire-erreur" role="alert">{erreur}</p>}
  </section>;
}
