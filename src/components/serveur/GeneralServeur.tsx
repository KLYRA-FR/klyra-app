"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DiagnosticDuPoste } from "@/components/reglages/ConfigurationKlyra";
import { Groupe, Ligne, Pastille, Valeur } from "@/components/reglages/ui";
import { fournisseur } from "@/lib/fournisseurs";
import { useSondes } from "@/lib/lieux";
import { useMaj } from "@/lib/maj";
import { useMoteurs } from "@/lib/moteurs";
import { libelleServeur, type ServeurConnu } from "@/lib/serveur-vps";
import { AvisMiseAJour } from "./AvisMiseAJour";

/** Les moteurs de la machine (Ce PC, ou le VPS `lieu`) et leur version. */
function Moteurs({ lieu }: { lieu: string | null }) {
  const { moteurs, erreur } = useMoteurs(lieu);
  return (
    <Groupe titre="Moteurs" description={`Les programmes qui font travailler les agents sur ${lieu ? "ce serveur" : "ce PC"}. Leurs comptes et leurs mises à jour sont dans Fournisseurs.`}>
      {erreur && <Ligne libelle="Illisible" description={erreur} />}
      {!moteurs && <Ligne libelle="Lecture…" />}
      {moteurs?.map((m) => (
        <Ligne key={m.moteur.id} id={m.moteur.id === "claude" ? "serveur-moteurs" : undefined} libelle={`${m.moteur.nom} · ${fournisseur(m.moteur.id).nom}`}>
          <Valeur>{m.moteur.chemin ? (m.compte?.version ?? "Installé") : "Non installé"}</Valeur>
        </Ligne>
      ))}
    </Groupe>
  );
}

/** Général : Ce PC, ou un VPS relié (nom, adresse, version, état). */
export function GeneralServeur({ serveur }: { serveur: ServeurConnu | null }) {
  const { etat } = useMaj();
  const liste = useMemo(() => (serveur ? [serveur] : []), [serveur]);
  const sondes = useSondes(liste);

  if (!serveur) {
    return (
      <>
        <Groupe>
          <Ligne id="serveur-nom" libelle="Ce PC" description="Les agents tournent sur cet ordinateur, tant que l’app est ouverte." />
          <Ligne id="serveur-version" libelle="Version de KLYRA">
            <Valeur>{etat ? `KLYRA ${etat.version}` : "Version de développement"}</Valeur>
          </Ligne>
        </Groupe>
        <Moteurs lieu={null} />
      </>
    );
  }
  const sonde = sondes[serveur.id];
  const repond = sonde?.sonde === "repond";
  return (
    <>
      {repond && sonde.retard && <AvisMiseAJour versionCode={sonde.versionCode} />}
      <Groupe>
        <Ligne id="serveur-nom" libelle={serveur.nom} description="Un VPS relié : ses agents tournent même quand ce PC est éteint." />
        <Ligne libelle="Adresse">
          <Valeur mono>{serveur.adresse}</Valeur>
        </Ligne>
        <Ligne id="serveur-version" libelle="Version du code de ce serveur">
          {repond ? (
            <span className="flex items-center gap-2">
              <Valeur>{sonde.versionCode ? `Version ${sonde.versionCode}` : "Non annoncée"}</Valeur>
              <Pastille ton={sonde.retard ? "attente" : "ok"} texte={sonde.retard ? "À mettre à jour" : "À jour"} />
            </span>
          ) : (
            <Valeur>—</Valeur>
          )}
        </Ligne>
        <Ligne libelle="État">
          <Valeur>{libelleServeur(serveur.etat, sonde?.sonde, sonde?.agents, sonde?.retard)}</Valeur>
        </Ligne>
        <Ligne libelle="Tous les serveurs" description="Ajouter, relier ou retirer un serveur.">
          <Link href="/serveurs" className="text-ui-s font-medium text-texte-principal underline underline-offset-2">
            Ouvrir
          </Link>
        </Ligne>
      </Groupe>
      <Moteurs lieu={serveur.adresse} />
      <Groupe titre="Configuration de Claude Code" description="Ce que ce serveur ajoute à chaque appel de tes agents, comme le diagnostic de ton poste dans Réglages › Agents.">
        <DiagnosticDuPoste lieu={serveur.adresse} />
      </Groupe>
    </>
  );
}
