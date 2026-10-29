"use client";

import type { ReactNode } from "react";
import { CarteUtilisation } from "@/components/chat/CarteUtilisation";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { nomAbonnement, useCompteClaude } from "@/lib/compte-claude";
import { Erreur, Groupe, Ligne, Valeur } from "../ui";

const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function Detail({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <Ligne libelle={libelle}>
      <Valeur>{children}</Valeur>
    </Ligne>
  );
}

/** Le compte Claude du poste : l'état, le compte, l'abonnement, et la connexion. */
function CompteClaude() {
  const { disponible, compte, action, erreur, verifier, connecter, deconnecter } = useCompteClaude();

  if (!disponible) {
    return (
      <Groupe>
        <Ligne id="compte-claude" libelle="Compte Claude" description="La connexion à Claude se lit dans l’app de bureau." />
      </Groupe>
    );
  }

  const connecte = !!compte?.connecte;
  const etat = !compte ? "Vérification…" : !compte.installe ? "Claude Code est introuvable sur ce poste" : connecte ? "Connecté" : "Pas connecté";

  return (
    <Groupe titre="Compte">
      <div id="reglage-compte-claude" className="klyra-reglage -mx-4 flex scroll-mt-6 flex-wrap items-center gap-3 px-4 py-4">
        <span
          aria-hidden="true"
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", connecte ? "klyra-orbe" : "bg-fond-surface-grise text-icone-secondaire")}
        >
          <Icon name={connecte ? "check-01" : "users-profiles-01"} size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-ui font-semibold", compte && !connecte ? "text-texte-erreur" : "text-texte-principal")}>Claude · {etat}</span>
          <span className="truncate text-ui-xs text-texte-tertiaire">
            {connecte
              ? `${compte?.email ?? ""}${compte?.abonnement ? ` · abonnement ${nomAbonnement(compte.abonnement)}` : ""}`
              : "Tes agents passent par ton compte Claude : connecte-le pour qu’ils puissent répondre."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connecte ? (
            <Bouton variant="blanc" taille="md" disabled={!!action} onClick={() => void deconnecter()}>
              {action === "deconnexion" ? "Déconnexion…" : "Se déconnecter"}
            </Bouton>
          ) : (
            compte?.installe && (
              <BoutonPrincipal disabled={!!action} onClick={() => void connecter()}>
                {action === "connexion" ? "En attente du navigateur…" : "Se connecter à Claude"}
              </BoutonPrincipal>
            )
          )}
          <Bouton variant="discret" taille="md" disabled={!!action} iconeGauche={<Icon name="refresh-01" size={20} />} onClick={() => void verifier()}>
            Vérifier
          </Bouton>
        </div>
        {action === "connexion" && (
          <p className="m-0 w-full rounded-md bg-fond-page p-3 text-ui-s leading-[1.45] text-texte-principal">
            Une page Anthropic s’est ouverte dans ton navigateur. Connecte-toi, valide, puis reviens ici : l’app se met à jour toute seule.
          </p>
        )}
        {erreur && <Erreur>{erreur}</Erreur>}
      </div>
      {compte?.installe && connecte && (
        <>
          <Detail libelle="Compte">{compte.email ?? "—"}</Detail>
          <Detail libelle="Organisation">{compte.organisation ?? "—"}</Detail>
          <Detail libelle="Abonnement">{nomAbonnement(compte.abonnement) ?? "—"}</Detail>
          <Detail libelle="Facturation">
            {compte.methode === "claude.ai" ? "Comprise dans l’abonnement claude.ai" : compte.methode === "console" ? "À l’usage (Console Anthropic)" : (compte.methode ?? "—")}
          </Detail>
        </>
      )}
      {compte?.installe && (
        <>
          <Detail libelle="Claude Code">{compte.version ? `Version ${compte.version}` : "—"}</Detail>
          <Ligne libelle="Emplacement">
            <Valeur mono>{compte.chemin?.replace(/^\/Users\/[^/]+/, "~")}</Valeur>
          </Ligne>
          <Detail libelle="Vérifié">à {heure.format(compte.verifieLe)}</Detail>
        </>
      )}
    </Groupe>
  );
}

export function Claude() {
  return (
    <>
      <CompteClaude />
      <Groupe titre="Utilisation" description="Ce qu’il reste sur la session de 5 h et sur la semaine. Survole pour le détail, clique pour mettre à jour.">
        <div id="reglage-utilisation" className="klyra-reglage -mx-4 scroll-mt-6 px-2 py-2">
          <CarteUtilisation />
        </div>
      </Groupe>
    </>
  );
}
