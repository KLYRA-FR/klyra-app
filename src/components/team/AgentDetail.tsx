"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BlocAConfigurer } from "@/components/bibliotheque/BlocAConfigurer";
import { ModalePartager } from "@/components/bibliotheque/ModalePartager";
import { useRetirerDeBibliotheque } from "@/components/bibliotheque/useRetirerDeBibliotheque";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Markdown } from "@/components/ui/Markdown";
import { useConfirmation } from "@/components/ui/Modale";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque } from "@/lib/bibliotheque";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { lienDe, type Lien } from "@/lib/lien-bibliotheque";
import { poste } from "@/lib/plateforme";
import { useWorkspace } from "@/lib/workspace";
import type { Role, RoleSection } from "@/types/domain";
import { LigneRole } from "./AgentCard";
import { AgentVisuel, couleurAgent } from "./AgentVisuel";
import { dateCourte } from "./etats-agents";
import { QuandAppeler, SectionFiche } from "./FicheSections";
import { MenuLignes, type LigneMenu } from "./MenuLignes";
import { ModalePersonnaliserAssistant } from "./PersonnaliserAssistant";

const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Bloc de la fiche : titre court, puis son contenu, en carte blanche. */
export function Bloc({ titre, children, className }: { titre: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-5", className)}>
      <h3 className="m-0 text-ui font-semibold text-texte-principal">{titre}</h3>
      {children}
    </section>
  );
}

/** Étiquette grise de métadonnée (k-label--gris). */
function Meta({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xs bg-fond-surface-grise px-2.5 py-1 text-ui-xs font-medium text-texte-principal"
    >
      {children}
    </span>
  );
}

/** Le bloc commun à toute l'équipe, replié par défaut. */
function ParlerEnEquipe({ section }: { section: RoleSection }) {
  return (
    <details className="group rounded-3xl border border-bordure-subtile bg-fond-page p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ui font-semibold text-texte-principal">
        <Icon
          name="chevron-right"
          size={16}
          className="text-icone-secondaire transition-transform duration-[220ms] group-open:rotate-90"
        />
        {section.title}
        <span className="font-normal text-texte-tertiaire">· bloc commun à toute l’équipe</span>
      </summary>
      <Markdown source={section.body} className="mt-4" />
    </details>
  );
}

/** Ordre d'affichage : « Critères de sortie » à côté de « Quand l'appeler »,
 *  le bloc commun tout en bas ; le reste dans l'ordre du fichier. */
function rang(section: RoleSection): number {
  if (/^Critères de sortie/i.test(section.title)) return 0;
  if (/^Parler en équipe/i.test(section.title)) return 3;
  if (/^Ce que je ne fais pas/i.test(section.title)) return 2;
  return 1;
}

const BANDEAU = "flex flex-wrap items-center gap-3 rounded-md border px-4 py-3";

/** Ce que la fiche dit de l'origine de l'agent (spec §4, §8.2). Rien de ce qui suit un autre compte. */
function texteOrigine(lien: Lien, nom: string): string | null {
  switch (lien.type) {
    case "modele":
      return lien.aJour ? "Modèle KLYRA" : "Modèle KLYRA · ta version diffère du modèle";
    case "recu":
      if (lien.retiree) return `Copie privée de « ${nom} » (${lien.auteur}), plus partagé`;
      return `De ${lien.auteur} · v${lien.version}${lien.modifie ? ` · modifié sur ${poste.ce}` : ""}`;
    case "suspendu":
      return "Reçu de la bibliothèque · lien suspendu";
    case "copie":
      return lien.auteur ? `Copie privée de « ${nom} » (${lien.auteur})${lien.retiree ? ", plus partagé" : ""}` : "Copie privée";
    case "publie":
      return `Partagé avec l’équipe · v${lien.version}`;
    default:
      return null;
  }
}

/** La fiche de l'assistant (spec §8.1) : pas de fichier, un nom et une couleur à soi. */
function FicheAssistant({ role }: { role: Role }) {
  const [personnaliser, setPersonnaliser] = useState(false);
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="grid grid-cols-[200px_minmax(0,1fr)] items-stretch gap-6 @3xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-[180px] overflow-hidden rounded-xl border border-white/60 shadow-ombre-xs">
            <AgentVisuel agentId={role.id} teinte={role.teinte} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <p className="m-0 text-ui-s text-texte-tertiaire">{role.skills.join(" · ")}</p>
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="block font-semibold">{role.name}</span>
              <span className="mt-1 flex items-center gap-2 text-h4 leading-[1.1] font-normal tracking-[-0.03em]">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: couleurAgent(role.teinte) }} />
                <span>
                  <LigneRole tag={role.tag} title={role.title} />
                </span>
              </span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <BoutonPrincipal href="/chat?id=dm-principal">Écrire à {role.name}</BoutonPrincipal>
              <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="pencil-01" size={20} />} onClick={() => setPersonnaliser(true)}>
                Personnaliser
              </Bouton>
            </div>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3">
          <QuandAppeler role={role} />
        </div>
      </div>
      <ModalePersonnaliserAssistant ouvert={personnaliser} onFermer={() => setPersonnaliser(false)} />
    </div>
  );
}

/** Fiche d'un agent : son fichier, section par section. L'assistant a la sienne. */
export function AgentDetail({ role }: { role: Role }) {
  if (role.id === "principal") return <FicheAssistant role={role} />;
  return <FicheAgent role={role} />;
}

function FicheAgent({ role }: { role: Role }) {
  const router = useRouter();
  const { canEdit, reveal, tous, roles, activer, ajouter } = useAgents();
  const { state, arreter } = useWorkspace();
  const compte = useCompte();
  const bibliotheque = useBibliotheque();
  const retirerDeBibliotheque = useRetirerDeBibliotheque();
  const [demander, fenetre] = useConfirmation();
  const [partage, setPartage] = useState<"partager" | "mettre-a-jour" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const local = tous.find((a) => a.role.id === role.id) ?? null;
  const statut = local?.statut ?? "actif";
  const lien: Lien = local ? lienDe(local, { etat: bibliotheque.etat, moiId: bibliotheque.moiId, etats: bibliotheque.etats }) : { type: "aucun" };
  const sections = [...role.sections].sort((a, b) => rang(a) - rang(b));
  const editable = canEdit && role.file !== null;
  const pourquoiPas = "Ouvre l’app de bureau pour modifier les fiches.";
  const origine = texteOrigine(lien, role.name);

  /* Partager : une fiche à soi (ou une copie privée), pas un modèle ni un agent reçu encore lié. */
  const partageable = local !== null && (lien.type === "aucun" || lien.type === "copie") && local.entree?.origine.type !== "modele";
  const raisonPartage =
    compte.etat === "indisponible" || compte.etat === "deconnecte" || compte.etat === "chargement"
      ? "Connecte-toi à ton compte d’équipe pour partager."
      : compte.etat === "retire"
        ? "Ce compte ne fait plus partie de l’équipe."
        : bibliotheque.etat === "hors-ligne"
          ? "Hors ligne."
          : null;

  const agir = async (geste: () => Promise<void>) => {
    setErreur(null);
    try {
      await geste();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const desactiver = async () => {
    const enCours = Object.entries(state.travail).filter(([, t]) => t.roleId === role.id).map(([chatId]) => chatId);
    const routines = state.routines.filter((r) => r.roleId === role.id).length;
    const oui = await demander({
      titre: `Désactiver ${role.name} ?`,
      texte: (
        <div className="flex flex-col gap-2">
          <p className="m-0">
            {role.name} ne pourra plus être appelé dans KLYRA : ni par toi, ni par {roles[0].name}, ni par tes autres agents. Ses conversations et sa fiche
            sont gardées, et tu pourras le réactiver. Cela ne vaut que pour KLYRA : sa fiche reste dans ~/.claude/agents, et Claude Code dans le terminal ou
            tes autres outils l’utilisent comme avant.
          </p>
          {enCours.length > 0 && <p className="m-0">Il travaille en ce moment : sa réponse en cours sera arrêtée.</p>}
          {routines > 0 && <p className="m-0">Il fait partie de {routines > 1 ? `${routines} routines : elles s’arrêteront` : "1 routine : elle s’arrêtera"} à son étape.</p>}
        </div>
      ),
      confirmer: "Désactiver",
    });
    if (!oui) return;
    await agir(async () => {
      enCours.forEach((chatId) => arreter(chatId));
      await activer(role.id, false);
      annoncer(`${role.name} désactivé.`);
    });
  };

  const reactiver = () =>
    agir(async () => {
      await activer(role.id, true);
      annoncer(`${role.name} réactivé.`);
    });

  const lignes: LigneMenu[] = [];
  if (statut === "actif" && local) {
    if (partageable) {
      lignes.push({
        id: "partager",
        icone: "send-01",
        titre: "Partager avec l’équipe",
        detail: raisonPartage ?? undefined,
        desactivee: raisonPartage !== null,
        onChoisir: () => setPartage("partager"),
      });
    }
    if (lien.type === "publie") {
      lignes.push({ id: "publier", icone: "upload-01", titre: "Publier une mise à jour", onChoisir: () => setPartage("mettre-a-jour") });
      lignes.push({ id: "retirer", icone: "x-01", titre: "Retirer de la bibliothèque", onChoisir: () => void agir(() => retirerDeBibliotheque(local)) });
    }
    lignes.push({ id: "desactiver", icone: "stop-01", titre: "Désactiver", separee: lignes.length > 0, onChoisir: () => void desactiver() });
  } else if (statut === "desactive") {
    lignes.push({ id: "reactiver", icone: "play-01", titre: "Réactiver", onChoisir: () => void reactiver() });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">

        {/* En-tête : l'illustration à gauche, l'identité à droite. */}
        {/* L'illustration prend la hauteur de la colonne d'identité, des compétences aux boutons. */}
        <header className="grid grid-cols-[200px_minmax(0,1fr)] items-stretch gap-6 @3xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-[180px] overflow-hidden rounded-xl border border-white/60 shadow-ombre-xs">
            <AgentVisuel agentId={role.id} teinte={role.teinte} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {role.skills.length > 0 && <p className="m-0 text-ui-s text-texte-tertiaire">{role.skills.join(" · ")}</p>}
            {/* Titre KLYRA : prénom en semi-gras, rôle en regular dessous, même couleur. */}
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="block font-semibold">{role.name}</span>
              {/* Sous le prénom : le point de couleur de l'agent et son rôle, comme sur sa carte (sans le répéter plus bas). */}
              <span className="mt-1 flex items-center gap-2 text-h4 leading-[1.1] font-normal tracking-[-0.03em]">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: couleurAgent(role.teinte) }} />
                <span>
                  <LigneRole tag={role.tag} title={role.title} />
                </span>
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {origine && <Meta>{origine}</Meta>}
              {role.file && (
                <Meta title="Identifiant du sous-agent">
                  <Icon name="code-01" size={16} className="text-icone-secondaire" />
                  {role.id}
                </Meta>
              )}
              {role.model && <Meta>Modèle {role.model}</Meta>}
              {role.memory && <Meta>Mémoire {role.memory}</Meta>}
            </div>
            {role.file && (
              <p className="m-0 flex flex-wrap items-center gap-x-2 text-ui-xs text-texte-tertiaire">
                <button
                  type="button"
                  onClick={() => void reveal(role.id)}
                  title={`Afficher ${poste.dansExplorateur}`}
                  className="klyra-mono cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent"
                >
                  {role.file.path}
                </button>
                <span>· modifiée le {dateLongue.format(role.file.modifiedAt)}</span>
              </p>
            )}
            {/* Actions, sous l'identité : la place est là, à côté de l'illustration. */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {statut === "actif" ? (
                <BoutonPrincipal href={`/chat?id=dm-${role.id}`}>Écrire à {role.name}</BoutonPrincipal>
              ) : statut === "desactive" && state.chats.some((c) => c.id === `dm-${role.id}`) ? (
                <BoutonPrincipal href={`/chat?id=dm-${role.id}`}>Voir ses conversations</BoutonPrincipal>
              ) : null}
              <Bouton
                variant="blanc"
                taille="md"
                disabled={!editable}
                title={editable ? undefined : pourquoiPas}
                iconeGauche={<Icon name="file-code" size={20} />}
                onClick={() => router.push(`/equipe?agent=${role.id}&mode=modifier`)}
              >
                Modifier la fiche
              </Bouton>
              {/* Pourquoi le bouton est grisé, juste à côté de lui. */}
              {!editable && <span className="text-ui-xs text-texte-tertiaire">{pourquoiPas}</span>}
              {role.file && (
                <Bouton
                  variant="discret"
                  taille="md"
                  iconeGauche={<Icon name="refresh-01" size={20} />}
                  onClick={() => router.push(`/equipe?agent=${role.id}&mode=historique`)}
                >
                  Historique
                </Bouton>
              )}
              {lignes.length > 0 && (
                <MenuLignes
                  libelle={`Options de ${role.name}`}
                  alignement="gauche"
                  lignes={lignes}
                  declencheur={({ ref, ouvert, basculer, attributs }) => (
                    <BoutonIcone
                      ref={ref}
                      taille="md"
                      actif={ouvert}
                      icone={<Icon name="dot-horizontal" size={20} />}
                      libelle="Plus d’options"
                      onClick={basculer}
                      {...attributs}
                    />
                  )}
                />
              )}
            </div>
            {erreur && (
              <p role="alert" className="m-0 text-ui-s text-texte-erreur">
                {erreur}
              </p>
            )}
          </div>
        </header>

        {/* Ce qui attend un choix : une mise à jour, un écart avec le modèle, un agent hors de Mes agents. */}
        {statut === "desactive" && (
          <div role="status" className={cn(BANDEAU, "border-bordure-subtile bg-fond-page")}>
            <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-secondaire">
              {role.name} n’est plus dans Mes agents{local?.entree?.desactiveLe ? ` depuis le ${dateCourte(local.entree.desactiveLe)}` : ""}. Désactivé dans KLYRA
              seulement : ni toi, ni {roles[0].name}, ni tes autres agents ne peuvent l’appeler dans l’app. Sa fiche reste dans ~/.claude/agents, où Claude
              Code et tes autres outils la voient toujours.
            </p>
            <Bouton variant="sombre" taille="compact" onClick={() => void reactiver()}>
              Réactiver
            </Bouton>
          </div>
        )}
        {statut === "disponible" && (
          <div role="status" className={cn(BANDEAU, "border-bordure-subtile bg-fond-page")}>
            <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-secondaire">
              Cette fiche est sur {poste.ce}, mais pas dans Mes agents : KLYRA ne l’appelle pas. Tes autres outils la gardent telle quelle.
            </p>
            <Bouton
              variant="sombre"
              taille="compact"
              onClick={() =>
                void agir(async () => {
                  await ajouter(role.id);
                  annoncer(`${role.name} ajouté à tes agents.`);
                })
              }
            >
              Ajouter à mes agents
            </Bouton>
          </div>
        )}
        {statut === "actif" && lien.type === "recu" && lien.proposition && (
          <div role="status" className={cn(BANDEAU, "border-bordure-accent-survol bg-fond-teinte-bleue")}>
            <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-principal">
              {lien.auteur} a publié la version {lien.proposition.version} de {role.name} (tu as la {lien.version}). Rien ne change tant que tu ne choisis pas.
            </p>
            <Bouton variant="sombre" taille="compact" onClick={() => router.push(`/equipe?agent=${role.id}&mode=maj`)}>
              Voir les changements
            </Bouton>
          </div>
        )}
        {statut === "actif" && ((lien.type === "modele" && !lien.aJour) || (lien.type === "copie" && lien.versionPlusRecente !== null)) && (
          <div role="status" className={cn(BANDEAU, "border-bordure-subtile bg-fond-page")}>
            <p className="m-0 min-w-[240px] flex-1 text-ui-s text-texte-secondaire">
              {lien.type === "modele" ? "Ta version diffère du modèle KLYRA." : `${lien.auteur} a publié la version ${lien.versionPlusRecente}.`}
            </p>
            <Bouton variant="blanc" taille="compact" onClick={() => router.push(`/equipe?agent=${role.id}&mode=maj`)}>
              Comparer
            </Bouton>
          </div>
        )}
        {local && <BlocAConfigurer agent={local} />}


        {/* Le contenu de la fiche : « Quand l'appeler » en tête, puis une carte par section. */}
        <div className="grid grid-flow-row-dense grid-cols-1 gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3 @4xl:grid-cols-2">
          <QuandAppeler role={role} />
          {sections
            .filter((section) => rang(section) < 3)
            .map((section) => (
              <SectionFiche key={section.title} section={section} teinte={role.teinte} />
            ))}
        </div>

        {sections
          .filter((section) => rang(section) === 3)
          .map((section) => (
            <ParlerEnEquipe key={section.title} section={section} />
          ))}
      </div>
      {fenetre}
      {local && partage && <ModalePartager agent={local} mode={partage} ouvert onFermer={() => setPartage(null)} />}
    </div>
  );
}
