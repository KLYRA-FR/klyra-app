"use client";

import { useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, type PreferencesNotifications } from "@/lib/bridge";
import { estMac } from "@/lib/raccourcis";
import { useReglages } from "@/lib/reglages";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau } from "../ui";

const EVENEMENTS: { cle: keyof PreferencesNotifications; libelle: string; description: string }[] = [
  { cle: "agentFini", libelle: "Un agent a fini", description: "Sa réponse t’attend dans une conversation que tu ne regardes pas." },
  { cle: "agentErreur", libelle: "Un agent s’est arrêté sur une erreur", description: "Il n’a pas pu finir : la conversation dit pourquoi." },
  { cle: "workflow", libelle: "Un workflow te prévient", description: "Les étapes « Notification » de tes workflows." },
  { cle: "majPrete", libelle: "Une mise à jour est prête", description: "Clique sur la notification pour l’installer tout de suite." },
];

export function Notifications() {
  const { reglages, erreur, changerNotification, systeme } = useReglages();
  const [essai, setEssai] = useState<string | null>(null);
  const n = reglages?.notifications;
  const pont = getBridge()?.reglages;

  const essayer = async () => {
    if (!pont) return;
    const r = await pont.essaiNotification();
    setEssai(r.ok ? "Envoyée. Si rien ne s’affiche, autorise KLYRA dans les notifications du système." : r.message);
  };

  return (
    <>
      <Groupe>
        <Ligne
          id="notifications-systeme"
          libelle="Notifications du système"
          description="Quand un agent finit pendant que tu regardes ailleurs. Le système peut aussi les couper : vérifie ses réglages si rien n’arrive."
        >
          <Interrupteur libelle="Notifications du système" actif={!!n?.actives} disabled={!n} onChange={(v) => void changerNotification("actives", v)} />
        </Ligne>
        <Ligne
          id="pastille"
          libelle={estMac() ? "Pastille sur l’icône du Dock" : "Icône qui clignote dans la barre des tâches"}
          description={
            estMac()
              ? "Le nombre de réponses arrivées depuis que tu as quitté l’app. Elle s’efface quand tu reviens."
              : "Une réponse arrive pendant que tu es ailleurs : l’icône clignote jusqu’à ton retour."
          }
        >
          <Interrupteur libelle="Pastille sur l’icône" actif={!!n?.pastille} disabled={!n} onChange={(v) => void changerNotification("pastille", v)} />
        </Ligne>
        <Ligne id="son" libelle="Son" description="Le son de notification du système.">
          <Interrupteur libelle="Son des notifications" actif={!!n?.son} disabled={!n || !n.actives} onChange={(v) => void changerNotification("son", v)} />
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe titre="Par événement" description={n && !n.actives ? "Les notifications du système sont coupées : rien ne s’affiche." : "Choisis ce qui mérite une notification."}>
        <div id="reglage-evenements" className="klyra-reglage -mx-4 scroll-mt-6 divide-y divide-bordure-subtile px-4">
          {EVENEMENTS.map((e) => (
            <Ligne key={e.cle} libelle={e.libelle} description={e.description}>
              <Interrupteur libelle={e.libelle} actif={!!n?.[e.cle]} disabled={!n || !n.actives} onChange={(v) => void changerNotification(e.cle, v)} />
            </Ligne>
          ))}
        </div>
      </Groupe>

      <Groupe>
        <Ligne id="essai-notification" libelle="Essayer" description={essai ?? "Envoie une notification d’essai, avec tes réglages."}>
          {systeme ? (
            <Bouton variant="blanc" taille="compact" disabled={!n?.actives} onClick={() => void essayer()}>
              Envoyer un essai
            </Bouton>
          ) : (
            <SeulementBureau />
          )}
        </Ligne>
      </Groupe>
    </>
  );
}
