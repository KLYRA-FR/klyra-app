"use client";

import { useState, type ReactNode } from "react";
import { Input } from "klyra-ui";
import { CarteUtilisation } from "@/components/chat/CarteUtilisation";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { cn } from "@/lib/cn";
import { NIVEAUX_ACCES } from "@/lib/acces";
import { nomAbonnement, useCompteClaude } from "@/lib/compte-claude";
import { useWorkspace } from "@/lib/workspace";

const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function Section({ titre, sousTitre, children }: { titre: string; sousTitre?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3">
      <div className="flex flex-col gap-0.5 px-2 pt-1">
        <h2 className="m-0 text-ui font-semibold text-texte-principal">{titre}</h2>
        {sousTitre && <p className="m-0 text-ui-xs text-texte-tertiaire">{sousTitre}</p>}
      </div>
      {children}
    </section>
  );
}

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-ui-s">
      <span className="shrink-0 text-texte-secondaire">{libelle}</span>
      <span className="min-w-0 text-right text-texte-principal [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

/** Le compte Claude du poste : l'état, le compte, l'abonnement, et la connexion. */
function CompteClaudeCarte() {
  const { disponible, compte, action, erreur, verifier, connecter, deconnecter } = useCompteClaude();

  if (!disponible) {
    return (
      <div className="klyra-carte-flottante rounded-lg p-4 text-ui-s text-texte-secondaire">
        La connexion à Claude se lit dans l’app de bureau.
      </div>
    );
  }

  const connecte = !!compte?.connecte;
  const etat = !compte
    ? "Vérification…"
    : !compte.installe
      ? "Claude Code est introuvable sur ce poste"
      : connecte
        ? "Connecté"
        : "Pas connecté";

  return (
    <div className="klyra-carte-flottante flex flex-col gap-4 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            connecte ? "klyra-orbe" : "bg-fond-surface-grise text-icone-secondaire",
          )}
        >
          <Icon name={connecte ? "check-01" : "users-profiles-01"} size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-ui font-semibold", compte && !connecte ? "text-texte-erreur" : "text-texte-principal")}>
            Claude · {etat}
          </span>
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
          <Bouton
            variant="discret"
            taille="md"
            disabled={!!action}
            iconeGauche={<Icon name="refresh-01" size={20} />}
            onClick={() => void verifier()}
          >
            Vérifier
          </Bouton>
        </div>
      </div>

      {action === "connexion" && (
        <p className="m-0 rounded-md bg-fond-page p-3 text-ui-s leading-[1.45] text-texte-principal">
          Une page Anthropic s’est ouverte dans ton navigateur. Connecte-toi, valide, puis reviens ici : l’app se met à jour toute seule.
        </p>
      )}
      {erreur && (
        <p role="alert" className="m-0 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}

      {compte?.installe && (
        <div className="flex flex-col divide-y divide-bordure-subtile rounded-md border border-bordure-subtile px-3">
          {connecte && (
            <>
              <Ligne libelle="Compte">{compte.email ?? "—"}</Ligne>
              <Ligne libelle="Organisation">{compte.organisation ?? "—"}</Ligne>
              <Ligne libelle="Abonnement">{nomAbonnement(compte.abonnement) ?? "—"}</Ligne>
              <Ligne libelle="Facturation">
                {compte.methode === "claude.ai" ? "Comprise dans l’abonnement claude.ai" : compte.methode === "console" ? "À l’usage (Console Anthropic)" : (compte.methode ?? "—")}
              </Ligne>
            </>
          )}
          <Ligne libelle="Claude Code">{compte.version ? `Version ${compte.version}` : "—"}</Ligne>
          <Ligne libelle="Emplacement">
            <span className="klyra-mono text-ui-xs">{compte.chemin?.replace(/^\/Users\/[^/]+/, "~")}</span>
          </Ligne>
          <Ligne libelle="Vérifié">à {heure.format(compte.verifieLe)}</Ligne>
        </div>
      )}
    </div>
  );
}

/** Ton profil sur ce poste : il s'affiche en bas du menu et les agents savent à qui ils parlent. */
function Profil() {
  const { state, enregistrerProfil } = useWorkspace();
  const [name, setName] = useState(state.currentUser.name);
  const [title, setTitle] = useState(state.currentUser.title);
  const change = name.trim() !== state.currentUser.name || title.trim() !== state.currentUser.title;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        enregistrerProfil({ ...state.currentUser, name: name.trim(), title: title.trim(), initial: name.trim().charAt(0).toUpperCase() });
      }}
      className="klyra-carte-flottante @container flex flex-col gap-4 rounded-lg p-4"
    >
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <Champ label="Prénom">
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Rôle" aide="Par exemple « Design · KLYRA ».">
          <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} className={CHAMP} />
        </Champ>
      </div>
      <Bouton type="submit" variant="sombre" taille="compact" disabled={!change || !name.trim()} className="self-start">
        Enregistrer
      </Bouton>
    </form>
  );
}

function ChoixAcces() {
  const { state, choisirAcces } = useWorkspace();
  return (
    <div role="radiogroup" aria-label="Accès des agents" className="flex flex-col gap-2">
      {NIVEAUX_ACCES.map((n) => {
        const choisi = state.acces === n.id;
        return (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={choisi}
            onClick={() => choisirAcces(n.id)}
            className={cn(
              "klyra-carte-flottante flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left",
              choisi ? "border-bleu-k1-500" : "border-transparent",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte",
              )}
            >
              {choisi && <Icon name="check-01" size={12} />}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-ui-s font-semibold text-texte-principal">{n.nom}</span>
              <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{n.detail}</span>
            </span>
          </button>
        );
      })}
      <p className="m-0 px-1 text-ui-2xs text-texte-tertiaire">
        S’applique aux prochaines réponses. Les fichiers restent limités au dossier du projet (ou à ~/.klyra/atelier hors projet).
      </p>
    </div>
  );
}

/** Réglages de l'app : le compte Claude, son utilisation, l'accès des agents. */
export function ReglagesScreen() {
  const { state } = useWorkspace();
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto flex max-w-[880px] flex-col gap-5 px-5 pt-5 pb-6">
        <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
          <span className="font-semibold">Réglages</span> <span className="font-normal">de l’app</span>
        </h1>

        <Section titre="Toi" sousTitre="Ton profil sur ce poste. Chaque personne de l’équipe a le sien.">
          {/* Le profil peut arriver après coup (nom de la session Mac) : le formulaire repart de lui. */}
          <Profil key={`${state.currentUser.name}|${state.currentUser.title}`} />
        </Section>

        <Section titre="Claude" sousTitre="Le compte par lequel tes agents travaillent.">
          <CompteClaudeCarte />
        </Section>

        <Section titre="Utilisation" sousTitre="Ce qu’il reste sur la session de 5 h et sur la semaine. Survole pour le détail, clique pour mettre à jour.">
          <div className="klyra-carte-flottante rounded-lg p-2">
            <CarteUtilisation />
          </div>
        </Section>

        <Section titre="Accès des agents" sousTitre="Ce qu’un agent peut faire sans te demander. Le reste, il te le demande dans la conversation.">
          <ChoixAcces />
        </Section>
      </div>
    </div>
  );
}
