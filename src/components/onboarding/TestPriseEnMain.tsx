"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Acces } from "@/lib/bridge";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { appliquerChoixPriseEnMain, debutPriseEnMain, type ChoixPriseEnMain } from "../../../electron/prise-en-main-modele";
import { ParcoursPriseEnMain } from "./ParcoursPriseEnMain";
import { SceneAssistant } from "./SceneAssistant";

/** État uniquement en mémoire : aucun pont système, fournisseur ou historique. */
export function TestPriseEnMain({ quitter }: { quitter: () => void }) {
  const [etat, setEtat] = useState(() => debutPriseEnMain(true));
  const courant = useRef(etat);
  const [nom, nommer] = useState("");
  const [acces, choisirAcces] = useState<Acces>("projet");
  const titre = useRef<HTMLHeadingElement>(null);
  const changer = useCallback(async (choix: ChoixPriseEnMain) => {
    const suivant = appliquerChoixPriseEnMain(courant.current, choix);
    courant.current = suivant;
    setEtat(suivant);
    return suivant;
  }, []);
  const recommencer = () => {
    const debut = debutPriseEnMain(true);
    courant.current = debut;
    setEtat(debut); nommer(""); choisirAcces("projet");
  };
  useEffect(() => {
    const fermer = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); quitter(); }
    };
    window.addEventListener("keydown", fermer);
    return () => window.removeEventListener("keydown", fermer);
  }, [quitter]);
  useEffect(() => {
    if (etat.etape === "conversation") titre.current?.focus();
  }, [etat.etape]);

  return <div className="prise-test" data-prise-test>
    <aside className="prise-test-bandeau" aria-label="Mode test de l’onboarding">
      <div><strong>Mode test</strong><span>Installation, connexion et réponse simulées. Tes données restent intactes.</span></div>
      <Bouton variant="blanc" taille="md" onClick={quitter}>Quitter le mode test</Bouton>
    </aside>
    {etat.etape !== "conversation" ? <ParcoursPriseEnMain etat={etat} simulation={{ nom, nommer, acces, choisirAcces, changer, quitter }} /> :
      <main className="prise-page" data-prise-etape="conversation">
        <div className="prise-cadre">
          <SceneAssistant nom={nom} etape="conversation" fournisseur={etat.fournisseur} />
          <section className="prise-formulaire" aria-labelledby="prise-test-fin">
            <div className="prise-progression"><span>PRISE EN MAIN <b>5 / 5</b></span></div>
            <div className="prise-contenu">
              <h1 id="prise-test-fin" ref={titre} tabIndex={-1}>Ta conversation est prête.</h1>
              <p className="prise-description">Dans le vrai parcours, ton IA répond ici. Cet aperçu ne crée aucune conversation et n’envoie rien.</p>
              <div className="prise-test-messages" aria-label="Conversation simulée">
                <div><strong>Ta demande de test</strong><p>{etat.brouillon}</p></div>
                <div><strong>{nom} · Réponse simulée</strong><p>Le parcours est terminé. Dans ton espace habituel, tu pourras continuer l’échange, créer un projet et retrouver tes livrables dans les artefacts.</p></div>
              </div>
              <div className="prise-actions"><BoutonPrincipal onClick={quitter}>Revenir à mon espace</BoutonPrincipal><Bouton variant="discret" taille="md" onClick={recommencer}>Recommencer le test</Bouton></div>
            </div>
          </section>
        </div>
      </main>}
  </div>;
}
