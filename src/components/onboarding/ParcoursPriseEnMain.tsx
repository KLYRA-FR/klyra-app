"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Icon } from "@/components/icons/Icon";
import { ChampNomAssistant, erreurVisible } from "@/components/team/PersonnaliserAssistant";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { useAgents } from "@/lib/agents";
import { getBridge, unwrap, type Acces } from "@/lib/bridge";
import { erreurNomAssistant, nomPropre } from "@/lib/noms-agents";
import { usePriseEnMain } from "@/lib/prise-en-main";
import { actualiserMoteurs } from "@/lib/moteurs";
import { useWorkspace } from "@/lib/workspace";
import { ETAPES_PRISE_EN_MAIN, type ChoixPriseEnMain, type FournisseurDepart, type PriseEnMain } from "../../../electron/prise-en-main-modele";
import { ChoixIa } from "./ChoixIa";
import { SceneAssistant } from "./SceneAssistant";

const ETAPES = ["Ton assistant", "Ton IA", "Tes accès", "Ta première demande", "La conversation"];
const TEXTES = {
  assistant: ["Fais connaissance avec ton assistant.", "Il t’aide à clarifier, préparer et faire avancer tes demandes. Commence par lui donner un nom."],
  ia: ["Branche l’IA de ton choix.", "KLYRA utilise ton compte auprès d’un fournisseur. On prépare la connexion ici, avant ta première demande."],
  acces: ["Tu gardes la main.", "Choisis comment ton assistant travaille. Les actions qui engagent une décision restent soumises à ton accord."],
  demande: ["Qu’est-ce qu’on fait en premier ?", "Une vraie demande, même toute simple. Elle ouvrira ta conversation avec ton assistant."],
} as const;
const DEPARTS = [
  { titre: "Faire le tri dans mes idées", icone: "stars" as const, texte: "Aide-moi à structurer ces idées :\n" },
  { titre: "Préparer un message", icone: "message-square" as const, texte: "Aide-moi à préparer un message. Voici son destinataire et ce que je veux lui dire :\n" },
  { titre: "Prioriser mes tâches", icone: "list" as const, texte: "Aide-moi à prioriser ces tâches :\n" },
];

export interface SimulationPriseEnMain {
  nom: string;
  nommer: (nom: string) => void;
  acces: Acces;
  choisirAcces: (acces: Acces) => void;
  changer: (choix: ChoixPriseEnMain) => Promise<PriseEnMain>;
  quitter: () => void;
}

export function ParcoursPriseEnMain({ etat, simulation }: { etat: PriseEnMain; simulation?: SimulationPriseEnMain }) {
  const router = useRouter();
  const { changer: changerReel } = usePriseEnMain();
  const changer = simulation?.changer ?? changerReel;
  const { mes, roles, nommerAssistant, changerFournisseur } = useAgents();
  const { state, choisirAcces, choisirFournisseur, sendMessage } = useWorkspace();
  const nomAssistant = simulation?.nom ?? mes?.assistant.nom ?? "";
  const [nom, setNom] = useState(nomAssistant);
  const [brouillon, setBrouillon] = useState(etat.brouillon);
  const [acces, setAcces] = useState<Acces>(simulation?.acces ?? (state.acces === "tout" ? "projet" : state.acces));
  const [essai, setEssai] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  const demande = useRef<HTMLTextAreaElement>(null);
  const envoi = useRef(false);
  const nomRef = useRef<HTMLInputElement>(null);
  const etape = etat.etape === "conversation" || etat.etape === "termine" ? "demande" : etat.etape;
  const numero = ETAPES_PRISE_EN_MAIN.indexOf(etape);
  const erreurNom = erreurNomAssistant(nom, simulation ? [] : roles);
  useEffect(() => {
    if (etape === "assistant") nomRef.current?.focus();
    else titre.current?.focus({ preventScroll: true });
  }, [etape]);
  useEffect(() => {
    if (etape !== "demande" || brouillon === etat.brouillon) return;
    const timer = setTimeout(() => { void changer({ brouillon }).catch(() => setErreur("Ton brouillon n’a pas pu être gardé. Réessaie avant de quitter.")); }, 350);
    return () => clearTimeout(timer);
  }, [etape, brouillon, etat.brouillon, changer]);

  const faire = async (action: () => Promise<void>) => {
    if (envoi.current) return;
    envoi.current = true; setOccupe(true); setErreur(null);
    try { await action(); }
    catch (e) { setErreur(e instanceof Error ? e.message : "Le choix n’a pas pu être enregistré. Réessaie."); }
    finally { envoi.current = false; setOccupe(false); }
  };
  const nommer = (parDefaut = false) => {
    setEssai(true);
    if (!parDefaut && erreurNom) return;
    void faire(async () => {
      const choisi = parDefaut ? "Assistant" : nomPropre(nom);
      if (simulation) simulation.nommer(choisi); else await nommerAssistant(choisi);
      await changer({ etape: "ia", mode: "guide" });
    });
  };
  const explorer = (serveur = false) => void faire(async () => {
    if (simulation) { simulation.quitter(); return; }
    if (!mes?.assistant.nom) await nommerAssistant("Assistant");
    await changer({ mode: "exploration", brouillon });
    if (serveur) router.push("/serveurs");
  });
  const continuerIa = async (id: FournisseurDepart) => {
    setErreur(null);
    if (!simulation) await changerFournisseur("principal", id);
    await changer({ fournisseur: id, etape: "acces", mode: "guide" });
  };
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    if (!brouillon.trim()) { setErreur("Écris ce que tu aimerais faire, même en une phrase."); demande.current?.focus(); return; }
    void faire(async () => {
      if (simulation) {
        // Même contrat que le guide réel, conservé uniquement dans l’état local du test.
        await changer({ etape: "conversation", brouillon, conversation: { id: "dm-principal", debut: new Date().toISOString() } });
        return;
      }
      const id = etat.fournisseur;
      const pont = getBridge()?.moteurs;
      if (!id || !pont) throw new Error("Choisis et connecte ton IA avant d’envoyer.");
      const compte = unwrap(await pont.compte(id, null));
      if (!compte.installe || !compte.connecte) {
        await actualiserMoteurs(null);
        await changer({ etape: "ia", brouillon });
        throw new Error("La connexion à ton IA doit être reprise. Ta demande est gardée.");
      }
      // L'id direct local est stable. Le lieu affiché n'est pas utilisé par ce parcours de poste.
      const chatId = "dm-principal";
      choisirFournisseur(chatId, id, null, null);
      await changer({ etape: "conversation", brouillon, conversation: { id: chatId, debut: new Date().toISOString() } });
      sendMessage(chatId, brouillon.trim(), null);
      router.push(`/chat?id=${chatId}`);
    });
  };
  return (
    <main className="prise-page" data-prise-etape={etape}>
      <header className="prise-entete"><Image unoptimized src="/brand/logotype-generic.svg" alt="KLYRA" width={125} height={32} /><span className="prise-entete-note">Un bon départ, à ton rythme.</span><Bouton variant="discret" taille="md" disabled={occupe} onClick={() => explorer()}>{simulation ? "Revenir aux réglages" : "Explorer l’app"}</Bouton></header>
      <div className="prise-cadre">
        <SceneAssistant nom={nom || nomAssistant} etape={etape} fournisseur={etat.fournisseur} />
        <section className="prise-formulaire" aria-labelledby="prise-titre">
          <div className="prise-progression"><span>PRISE EN MAIN <b>{numero + 1} / 5</b></span><ol aria-label="Étapes de la prise en main">{ETAPES.map((label, i) => <li key={label} aria-current={i === numero ? "step" : undefined} data-fait={i < numero}><span className="sr-only">{label}{i < numero ? " : terminée" : ""}</span></li>)}</ol></div>
          <div key={etape} className="prise-contenu">
            <h1 id="prise-titre" ref={titre} tabIndex={-1}>{TEXTES[etape][0]}</h1>
            <p className="prise-description">{TEXTES[etape][1]}</p>
            {etape === "assistant" && <form onSubmit={(e) => { e.preventDefault(); nommer(); }} className="prise-nommage"><ChampNomAssistant libelle="Comment s’appelle ton assistant ?" valeur={nom} onChange={setNom} erreur={erreurVisible(nom, erreurNom, essai)} aide="Un nom qui te parle. Tu pourras le changer." champRef={nomRef} onEntree={() => nommer()} /><div className="prise-apercu"><span>Un aperçu de ton espace</span><strong>Écris à {nomPropre(nom) || "ton assistant"}…</strong><small>Une idée, une question ou un premier projet.</small></div><div className="prise-actions"><BoutonPrincipal type="submit" disabled={occupe || !!erreurNom}>{occupe ? "Enregistrement…" : "Créer mon assistant"}</BoutonPrincipal><Bouton variant="discret" taille="md" disabled={occupe} onClick={() => nommer(true)}>Garder « Assistant »</Bouton></div></form>}
            {etape === "ia" && <ChoixIa choix={etat.fournisseur} choisir={async (id) => { await changer({ fournisseur: id }); }} continuer={continuerIa} erreurExterne={erreur} simulation={!!simulation} />}
            {etape === "acces" && <><div className="prise-acces" role="group" aria-label="Accès de ton assistant">{([{ id: "projet", titre: "Le projet en autonomie", detail: "Il avance dans son dossier et te sollicite quand une autorisation est nécessaire.", recommande: true }, { id: "demander", titre: "Me demander avant d’agir", detail: "Les outils qui nécessitent une autorisation attendent ta réponse.", recommande: false }] as const).map((a) => <button type="button" className="prise-acces-choix" key={a.id} aria-pressed={acces === a.id} onClick={() => setAcces(a.id)}><span className="prise-radio" aria-hidden="true">{acces === a.id && <span />}</span><span><strong>{a.titre}</strong>{a.recommande && <small className="prise-recommande">Pour commencer</small>}<p>{a.detail}</p></span></button>)}</div><div className="prise-engagement"><Icon name="shield-check" size={20} /><p>Les envois, paiements et publications demandent ton accord. Le pilotage de ton ordinateur est facultatif et se règle séparément.</p></div><p className="prise-aide">Ces règles d’exécution ne constituent pas une isolation absolue des fichiers. Elles restent modifiables dans les réglages.</p><div className="prise-actions"><BoutonPrincipal disabled={occupe} onClick={() => void faire(async () => { if (simulation) simulation.choisirAcces(acces); else choisirAcces(acces, null); await changer({ etape: "demande" }); })}>Continuer</BoutonPrincipal></div></>}
            {etape === "demande" && <form onSubmit={envoyer}><div className="prise-departs" role="group" aria-label="Idées pour commencer">{DEPARTS.map((d) => <button type="button" key={d.titre} onClick={() => { setBrouillon(d.texte); requestAnimationFrame(() => { demande.current?.focus(); demande.current?.setSelectionRange(d.texte.length, d.texte.length); }); }}><Icon name={d.icone} size={18} /><span>{d.titre}</span></button>)}</div><label className="prise-demande"><span>Ta demande à {nomAssistant || "ton assistant"}</span><textarea ref={demande} value={brouillon} onChange={(e) => setBrouillon(e.target.value)} maxLength={20000} placeholder="J’aimerais avancer sur…" rows={5} disabled={occupe} /><small>Les suggestions remplissent le champ. Tu relis et tu envoies.</small></label><div className="prise-actions"><BoutonPrincipal type="submit" disabled={occupe || !brouillon.trim()}>{occupe ? "Ouverture de la conversation…" : "Commencer la conversation"}</BoutonPrincipal></div></form>}
            {erreur && etape !== "ia" && <p className="prise-erreur" role="alert">{erreur}</p>}
          </div>
          <footer className="prise-pied">{numero > 0 ? <Bouton variant="discret" taille="md" disabled={occupe} onClick={() => void faire(async () => { await changer({ etape: ETAPES_PRISE_EN_MAIN[numero - 1], brouillon }); })}>Retour</Bouton> : <span>Tu pourras tout ajuster ensuite.</span>}<button type="button" className="prise-lien" disabled={occupe || !!simulation} title={simulation ? "La connexion à un serveur n’est pas simulée." : undefined} onClick={() => explorer(true)}>J’ai déjà un serveur KLYRA <span aria-hidden="true">↗</span></button></footer>
        </section>
      </div>
    </main>
  );
}
