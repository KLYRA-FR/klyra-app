"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { LigneRole } from "@/components/team/AgentCard";
import { couleurAgent, fondCarte } from "@/components/team/AgentVisuel";
import { Apparition } from "@/components/ui/Apparition";
import { Bouton } from "@/components/ui/Bouton";
import { Modale } from "@/components/ui/Modale";
import { splitDescription } from "@/lib/agent-file";
import { MODELES, useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque, type DefinitionResume } from "@/lib/bibliotheque";
import { dateCourte, raison, teinteDefinition } from "@/lib/bibliotheque-ui";
import { cn } from "@/lib/cn";
import { nomDejaPris } from "@/lib/noms-agents";
import { jouer } from "@/lib/sons/sons";
import type { RoleTeinte } from "@/types/domain";
import { agentDeDefinition, BlocEtat, MODALE_DEFILANTE } from "./commun";
import { useAjout } from "./ModaleAjouter";

/** Cascade des cartes, comme dans Mes agents. */
const DEBUT_CASCADE = 120;
const PAS_CASCADE = 60;

const BLOC = "flex shrink-0 flex-col rounded-lg border border-white bg-fond-surface px-4 py-3 shadow-ombre-sm";

/** Les compétences qui tiennent sur deux lignes, sans couper un mot. */
function competences(skills: string[], longueur = 80): string {
  const gardees: string[] = [];
  for (const s of skills) {
    if (gardees.length > 0 && [...gardees, s].join(" · ").length > longueur) break;
    gardees.push(s);
  }
  return gardees.join(" · ");
}

/**
 * Carte d'une définition, de la forme d'une carte de Mes agents. Un `article` : le nom est le seul lien,
 * étiré sur toute la carte ; les boutons passent au-dessus (`relative z-10`).
 */
function CarteDefinition({
  href,
  nom,
  tag,
  title,
  skills,
  teinte,
  auteur,
  etat,
  ordre,
}: {
  href: string;
  nom: string;
  tag: string;
  title: string;
  skills: string[];
  teinte: RoleTeinte;
  auteur: string;
  etat: ReactNode;
  ordre: number;
}) {
  return (
    <article
      style={{ backgroundImage: fondCarte(teinte), "--delai": `${DEBUT_CASCADE + ordre * PAS_CASCADE}ms` } as CSSProperties}
      className={cn(
        "klyra-entree group relative isolate flex flex-col gap-2 rounded-2xl p-2",
        "transition-[box-shadow,transform] duration-[300ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-ambiante",
      )}
    >
      <div className={cn(BLOC, "gap-2")}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 truncate text-h4 leading-[28px] font-semibold tracking-[-0.02em] text-texte-principal">
            <Link
              href={href}
              className={cn(
                "text-texte-principal no-underline focus-visible:outline-none",
                "after:absolute after:inset-0 after:rounded-2xl",
                "focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus",
              )}
            >
              {nom}
            </Link>
          </h3>
          <p className="m-0 flex min-w-0 items-center gap-1.5 text-ui-s leading-[1.35] text-texte-principal">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: couleurAgent(teinte) }} />
            <span className="truncate">
              <LigneRole tag={tag} title={title} />
            </span>
          </p>
        </div>
        <p className="m-0 line-clamp-2 min-h-[2lh] text-ui-xs leading-[1.35] text-texte-tertiaire">{competences(skills)}</p>
      </div>
      <div className={cn(BLOC, "min-h-12 flex-row items-center justify-between gap-2 py-2")}>
        <span className="min-w-0 truncate text-ui-xs text-texte-tertiaire">{auteur}</span>
        <span className="flex shrink-0 items-center gap-2">{etat}</span>
      </div>
    </article>
  );
}

function Texte({ children, icone }: { children: ReactNode; icone?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-ui-xs text-texte-secondaire">
      {icone && <Icon name="check-01" size={16} className="text-icone-secondaire" />}
      {children}
    </span>
  );
}

/** Un modèle KLYRA et ce qu'il deviendrait avec « Ajouter toute la collection ». */
type Plan = { modele: (typeof MODELES)[number]; nom: string; existant: AgentLocal | null; raison: string | null };

/**
 * L'onglet « Bibliothèque KLYRA » de `/equipe?vue=bibliotheque` (spec §10.1), sans les onglets :
 * les agents partagés par l'équipe (connecté seulement, jamais gardés sur le disque), puis les
 * modèles KLYRA embarqués, toujours disponibles. Aucun compteur.
 */
export function BibliothequeVue() {
  const router = useRouter();
  const { tous, roles, canEdit } = useAgents();
  const biblio = useBibliotheque();
  const { ajouter, reactiver, enCours, fenetre } = useAjout();
  const [collection, setCollection] = useState(false);

  const partages = useMemo(() => [...biblio.definitions].sort((a, b) => b.majLe - a.majLe), [biblio.definitions]);
  const modeles = useMemo(() => [...MODELES].sort((a, b) => a.role.name.localeCompare(b.role.name, "fr")), []);

  const plan = useMemo<Plan[]>(
    () =>
      modeles.map((modele) => {
        const local = tous.find((a) => a.role.id === modele.name) ?? null;
        const nom = (local ?? modele).role.name;
        const raisonPlan =
          local?.statut === "actif"
            ? "déjà dans tes agents"
            : local?.statut === "desactive"
              ? "désactivé : réactive-le depuis sa carte"
              : nomDejaPris(nom, roles)
                ? "nom déjà pris : ajoute-le seul"
                : null;
        return { modele, nom, existant: local, raison: raisonPlan };
      }),
    [modeles, tous, roles],
  );
  const aAjouter = plan.filter((p) => p.raison === null);

  const boutonAjouter = (cle: string, nom: string, onClick: () => void) => (
    <>
      {!canEdit && <span className="text-ui-xs text-texte-tertiaire">Dans l’app de bureau</span>}
      <Bouton
        variant="sombre"
        taille="compact"
        className="relative z-10"
        disabled={!canEdit || enCours === cle}
        aria-label={`Ajouter ${nom} à tes agents`}
        iconeGauche={<Icon name="users-profiles-plus" size={16} />}
        onClick={onClick}
      >
        Ajouter
      </Bouton>
    </>
  );

  const etatLocal = (local: AgentLocal) =>
    local.statut === "actif" ? (
      <Texte icone>Dans tes agents</Texte>
    ) : (
      <>
        <Texte>Hors de tes agents</Texte>
        <Bouton variant="blanc" taille="compact" className="relative z-10" disabled={!canEdit} onClick={() => void reactiver(local)}>
          Réactiver
        </Bouton>
      </>
    );

  const etatPartage = (d: DefinitionResume) => {
    if (d.deMoi) return <Texte>De toi</Texte>;
    const local = agentDeDefinition(tous, d._id);
    if (local?.entree?.origine.type === "copie") return <Texte>Ta copie privée</Texte>;
    if (local) return etatLocal(local);
    return boutonAjouter(d._id, d.nom, () => void ajouter({ type: "partage", resume: d }));
  };

  const groupePartages = (() => {
    switch (biblio.etat) {
      case "indisponible":
        return <BlocEtat>Les agents partagés par l’équipe s’affichent dans l’app de bureau, connectée à ton compte d’équipe.</BlocEtat>;
      case "deconnecte":
        return (
          <BlocEtat
            action={
              <Bouton variant="blanc" taille="compact" onClick={() => router.push("/reglages?section=equipe")}>
                Se connecter
              </Bouton>
            }
          >
            Connecte-toi à ton compte d’équipe pour voir les agents que les membres partagent.
          </BlocEtat>
        );
      case "retire":
        return <BlocEtat>Ce compte ne fait plus partie de l’équipe.</BlocEtat>;
      case "chargement":
        return <BlocEtat>Chargement des agents partagés…</BlocEtat>;
      case "hors-ligne":
        return <BlocEtat>Tes agents marchent. La bibliothèque attend le réseau.</BlocEtat>;
      case "erreur":
        return (
          <BlocEtat
            action={
              <Bouton variant="blanc" taille="compact" onClick={biblio.reessayer}>
                Réessayer
              </Bouton>
            }
          >
            Impossible de charger les agents partagés pour l’instant. Tes agents marchent normalement.
          </BlocEtat>
        );
      case "pret":
        if (!partages.length) {
          return <BlocEtat>Rien n’est encore partagé. Ouvre la fiche d’un de tes agents, puis “…” › Partager avec l’équipe.</BlocEtat>;
        }
        return (
          <Apparition className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4" seuil={0.05}>
            {partages.map((d, i) => (
              <CarteDefinition
                key={d._id}
                href={`/equipe?definition=${encodeURIComponent(d._id)}`}
                nom={d.nom}
                tag={d.role}
                title={splitDescription(d.description).title}
                skills={d.capacites}
                teinte={teinteDefinition(d.slug, false)}
                auteur={`Par ${d.auteur.nom} · v${d.version} · ${dateCourte(d.majLe)}`}
                etat={etatPartage(d)}
                ordre={i}
              />
            ))}
          </Apparition>
        );
    }
  })();

  return (
    <div className="flex flex-col gap-8">
      <p className="m-0 text-ui text-texte-secondaire">
        Les agents que les membres de ton équipe ont choisi de partager, et les modèles de KLYRA.{" "}
        <Link
          href="/equipe?vue=membres"
          className="text-texte-accent underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          Membres de l’équipe
        </Link>
      </p>

      <section aria-labelledby="bibliotheque-equipe" className="flex flex-col gap-4">
        <h2 id="bibliotheque-equipe" className="m-0 text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">
          Partagés par l’équipe
        </h2>
        {groupePartages}
      </section>

      <section aria-labelledby="bibliotheque-modeles" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="bibliotheque-modeles" className="m-0 text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">
              Modèles KLYRA
            </h2>
            <p className="m-0 text-ui text-texte-secondaire">Les agents de départ de KLYRA. Ajoute seulement ceux qui te servent.</p>
          </div>
          {aAjouter.length >= 2 && (
            <Bouton variant="discret" taille="compact" disabled={!canEdit} title={canEdit ? undefined : "Dans l’app de bureau"} onClick={() => setCollection(true)}>
              Ajouter toute la collection
            </Bouton>
          )}
        </div>
        <Apparition className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4" seuil={0.05}>
          {modeles.map((m, i) => {
            const local = tous.find((a) => a.role.id === m.name);
            return (
              <CarteDefinition
                key={m.name}
                href={`/equipe?definition=${encodeURIComponent(`klyra:${m.name}`)}`}
                nom={m.role.name}
                tag={m.role.tag}
                title={m.role.title}
                skills={m.role.skills}
                teinte={m.role.teinte}
                auteur="KLYRA"
                etat={
                  local && local.statut !== "disponible"
                    ? etatLocal(local)
                    : boutonAjouter(`klyra:${m.name}`, m.role.name, () => void ajouter({ type: "modele", nom: m.name }))
                }
                ordre={i}
              />
            );
          })}
        </Apparition>
      </section>

      {fenetre}
      {collection && <ModaleCollection plan={plan} onFermer={() => setCollection(false)} />}
    </div>
  );
}

/** « Ajouter toute la collection » : ce qui sera ajouté, ce qui ne le sera pas et pourquoi. */
function ModaleCollection({ plan, onFermer }: { plan: Plan[]; onFermer: () => void }) {
  const { installer, ajouter, changerOrigine } = useAgents();
  /* Figé à l'ouverture : la liste ne bouge pas pendant qu'on ajoute. */
  const [fige] = useState(plan);
  const retenus = fige.filter((p) => p.raison === null);
  const ecartes = fige.filter((p) => p.raison !== null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /* Arrêté en cours de route : la liste n'est plus exacte, il ne reste qu'à fermer. */
  const [arrete, setArrete] = useState(false);

  const confirmer = async () => {
    setOccupe(true);
    setMessage(null);
    let faits = 0;
    for (const p of retenus) {
      try {
        if (p.existant) {
          await ajouter(p.modele.name);
          await changerOrigine(p.modele.name, { type: "modele", modele: p.modele.name });
        } else {
          await installer(
            { _id: `klyra:${p.modele.name}`, slug: p.modele.name, contenu: p.modele.content, version: 1, auteur: { nom: "KLYRA" } },
            { id: p.modele.name, origine: { type: "modele", modele: p.modele.name } },
          );
        }
        faits++;
      } catch (e) {
        setOccupe(false);
        setArrete(true);
        if (faits) annoncer(`${faits} ${faits > 1 ? "modèles ajoutés" : "modèle ajouté"} à tes agents.`);
        setMessage(`L’ajout s’est arrêté à ${p.nom} : ${raison(e)}. ${faits ? `${faits} ${faits > 1 ? "modèles ont été ajoutés" : "modèle a été ajouté"} avant.` : "Rien n’a été ajouté."}`);
        return;
      }
    }
    annoncer(`${faits} modèles ajoutés à tes agents.`);
    jouer("validation");
    onFermer();
  };

  return (
    <Modale
      titre="Ajouter toute la collection ?"
      onFermer={onFermer}
      className={cn("w-[min(520px,calc(100%-48px))]", MODALE_DEFILANTE)}
      actions={
        arrete ? (
          <Bouton variant="sombre" taille="md" onClick={onFermer}>
            Fermer
          </Bouton>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" data-autofocus onClick={onFermer}>
              Annuler
            </Bouton>
            <Bouton variant="sombre" taille="md" disabled={occupe || !retenus.length} onClick={() => void confirmer()}>
              {occupe ? "Ajout…" : `Ajouter les ${retenus.length}`}
            </Bouton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4 pt-2">
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-ui-s font-medium text-texte-principal">Seront ajoutés</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-s text-texte-principal">
            {retenus.map((p) => (
              <li key={p.modele.name} className="flex items-center gap-2">
                <Icon name="check-01" size={16} className="text-icone-defaut" />
                {p.nom} <span className="text-texte-tertiaire">· {p.modele.role.tag}</span>
              </li>
            ))}
          </ul>
        </section>
        {ecartes.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="m-0 text-ui-s font-medium text-texte-principal">Ne seront pas ajoutés</h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-s text-texte-secondaire">
              {ecartes.map((p) => (
                <li key={p.modele.name} className="flex items-center gap-2">
                  <span aria-hidden="true" className="w-4 text-center text-texte-tertiaire">
                    —
                  </span>
                  {p.nom} · {p.raison}
                </li>
              ))}
            </ul>
          </section>
        )}
        {message && (
          <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
            {message}
          </p>
        )}
      </div>
    </Modale>
  );
}
