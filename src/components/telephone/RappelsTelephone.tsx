"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { ICONES, NOMS_ICONES, PastilleCategorie } from "@/components/planning/Rappels";
import { NOMS_TEINTES } from "@/components/roles/ChoixTeinte";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { libellePeriode } from "@/lib/dates";
import { reportsProposes } from "@/lib/report";
import { texteErreurPoste } from "@/lib/poste-texte";
import { NOMS_REPORT, NOMS_URGENCE, categorieDeRepli, cibleReport, type RappelTelephone, type SectionRappels } from "@/lib/telephone/planning";
import { ROLE_TEINTES, type Categorie, type RoleTeinte } from "@/types/domain";
import type { LecturePoste } from "@/lib/poste/client";
import type { ConfieA } from "@/lib/telephone/tickets";
import { RondAgent, useCartes } from "./AgentsChat";
import { useAnnonce } from "./Annonce";
import { useApres } from "./ChatsTelephone";
import { SectionPoste, usePlanningTelephone } from "./ContextePlanningTelephone";
import { CaseRonde } from "./Controles";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong, useFermerFeuille, type ActionMenu } from "./Feuille";
import { AucunPoste, BandeauVueGardee, EtatEcran, NotePoste, Squelette } from "./etats";
import { GroupeListe, LigneListe, TuileIcone } from "./Liste";

/**
 * T-06 Planning › Rappels : une section repliable par catégorie, puis « Ceux que j'ai assignés » et
 * « Assignés par l'équipe ». Une ligne : la case (44 × 44), le titre (ouvre la fiche), « ⋯ » (le menu).
 * D-8 (C-1b) : « Tout est fait » seulement si le compte et l'ordinateur ont été lus. Sinon, le compte
 * et l'ordinateur restent dans deux sections, et ce qui manque est dit à sa place.
 */
export function RappelsTelephone({
  sections,
  charge,
  poste,
  surPoste,
}: {
  sections: SectionRappels[];
  charge: boolean;
  poste: LecturePoste<unknown> & { relancer: () => void };
  /** Ordinateur fermé : ses rappels lus la dernière fois, à part et datés (S-22). */
  surPoste: { lu: number; rappels: RappelTelephone[] } | null;
}) {
  const { sur } = usePlanningTelephone();
  /* Une catégorie vide part repliée ; toucher son en-tête inverse cet état. */
  const [inverses, setInverses] = useState<ReadonlySet<string>>(() => new Set());
  const chargement = useApres(300, !charge);
  const basculer = (id: string) =>
    setInverses((avant) => {
      const apres = new Set(avant);
      if (!apres.delete(id)) apres.add(id);
      return apres;
    });

  if (!charge) {
    return chargement ? (
      <div className="mt-2" aria-busy="true">
        <Squelette lignes={4} />
      </div>
    ) : null;
  }
  const toutLu = poste.etat === "ok" || poste.etat === "aucun";
  const rien = sections.every((s) => s.rappels.length === 0);
  const separes = !toutLu;
  const fermePhrase = (surQui: string) => `les catégories et les rappels gardés sur ${surQui} s’afficheront ici quand KLYRA y est ouverte.`;
  return (
    <div className="flex flex-col">
      {rien && poste.etat === "ok" ? <EtatEcran forme="encadre" className="mt-2" icone="check-01" titre="Tout est fait" texte="Aucun rappel à faire." /> : null}
      {separes ? (
        <h2 className="flex min-h-11 items-center gap-1.5 px-1 text-ui font-semibold text-texte-principal">
          Dans ton compte
          <span className="font-normal text-texte-secondaire">{sections.reduce((n, s) => n + s.aFaire, 0)}</span>
        </h2>
      ) : null}
      {separes && rien ? <p className="px-1 py-2 text-ui text-texte-secondaire">Aucun rappel dans ton compte.</p> : null}
      {sections.map((section) => {
        if (section.rappels.length === 0 && (separes || rien || !section.categorie)) return null;
        const pliee = section.rappels.length === 0;
        return <SectionRappelsTelephone key={section.id} section={section} sansEnTete={separes && !section.categorie && section.groupe === "mes"} replie={inverses.has(section.id) ? !pliee : pliee} onBasculer={() => basculer(section.id)} />;
      })}
      {poste.etat === "aucun" ? (
        <div className="mt-4">
          <AucunPoste forme="encadre" className="px-0 pb-0" phrase={fermePhrase} />
        </div>
      ) : null}
      {separes ? (
        <section aria-label={`Sur ${sur}`} className="pt-5">
          <h2 className="flex min-h-11 items-center gap-1.5 px-1 text-ui font-semibold text-texte-principal">
            Sur {sur}
            {surPoste ? <span className="font-normal text-texte-secondaire">{surPoste.rappels.length}</span> : null}
          </h2>
          {surPoste ? (
            <>
              <BandeauVueGardee lu={surPoste.lu} mot="Vus" className="mb-2" />
              {surPoste.rappels.length > 0 ? (
                <GroupeListe>
                  {surPoste.rappels.map((rappel) => (
                    <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} avecCategorie />
                  ))}
                </GroupeListe>
              ) : (
                <p className="px-1 py-2 text-ui text-texte-secondaire">Aucun rappel la dernière fois.</p>
              )}
              <NotePoste className="mt-2 px-1 text-ui-xs text-texte-secondaire" />
            </>
          ) : (
            <SectionPoste lecture={poste} ferme={fermePhrase} />
          )}
        </section>
      ) : null}
    </div>
  );
}

function SectionRappelsTelephone({ section, replie, sansEnTete, onBasculer }: { section: SectionRappels; replie: boolean; sansEnTete: boolean; onBasculer: () => void }) {
  const { posteOuvert, horsLigne, modifierCategorie } = usePlanningTelephone();
  const id = useId();
  const { categorie } = section;
  return (
    <section aria-label={section.titre} className="pb-1">
      {sansEnTete ? null : (
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-fond-page">
          <button type="button" aria-expanded={!replie} aria-controls={id} onClick={onBasculer} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left active:bg-fond-survol">
            <Icon name="chevron-down" size={18} className={cn("shrink-0 text-icone-secondaire transition-transform duration-[220ms] ease-sortie motion-reduce:transition-none", replie && "-rotate-90")} />
            {categorie ? <PastilleCategorie categorie={categorie} taille={24} /> : null}
            <span className="min-w-0 truncate text-ui font-semibold text-texte-principal">{section.titre}</span>
            <span className="shrink-0 text-ui text-texte-secondaire" aria-label={`${section.aFaire} à faire`}>
              {section.aFaire}
            </span>
          </button>
          {categorie && posteOuvert && !horsLigne ? (
            <BoutonIcone variant="discret" className="size-11" libelle={`Modifier la catégorie ${categorie.nom}`} aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => modifierCategorie(categorie)} />
          ) : null}
        </div>
      )}
      {replie && !sansEnTete ? null : (
        <div id={id}>
          <GroupeListe>
            {section.rappels.map((rappel) => (
              <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} />
            ))}
          </GroupeListe>
        </div>
      )}
    </section>
  );
}

/**
 * Une ligne de rappel, ici et dans « À faire » de l'agenda : la case et le titre sont deux contrôles
 * distincts, « ⋯ » ouvre le menu (appui long aussi). Toute la ligne porte `data-echeance` : elle
 * s'éclaire après un report, une restauration ou un retour de la fiche. Lue dans une vue gardée :
 * la case est inactive, le menu dit pourquoi.
 */
export function LigneRappel({ rappel, avecCategorie = false }: { rappel: RappelTelephone; avecCategorie?: boolean }) {
  const { cocher, ouvrirRappel, noms, categories, occupes, posteOuvert, horsLigne, confieDe, sur } = usePlanningTelephone();
  const { nom } = useCartes();
  const confie = confieDe(rappel);
  const mention = confie ? texteConfie(confie, nom(confie.roleId), sur, posteOuvert) : null;
  const enAttente = rappel.source === "poste" && !posteOuvert;
  const [menu, setMenu] = useState(false);
  const appui = useAppuiLong(() => setMenu(true));
  const categorie = rappel.liste ? categories?.find((c) => c.id === rappel.liste) : undefined;
  const nomAutre = rappel.autre ? (noms.get(rappel.autre) ?? "quelqu’un") : null;
  const personne = nomAutre ? (rappel.recu ? `Par ${nomAutre}` : `Assigné à ${nomAutre}`) : null;
  const inactive = occupes.has(rappel.id) || enAttente || horsLigne;

  return (
    <li data-echeance={rappel.id} className="flex items-center border-b border-bordure-subtile pl-1 last:border-b-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={rappel.faite}
        aria-label={rappel.faite ? `Rouvrir ${rappel.titre}` : `Terminer ${rappel.titre}`}
        aria-busy={occupes.has(rappel.id) || undefined}
        disabled={inactive}
        onClick={() => cocher(rappel)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-fond-survol disabled:opacity-60"
      >
        <CaseRonde faite={rappel.faite} />
      </button>
      <button type="button" {...appui} onClick={() => ouvrirRappel(rappel)} className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-1 text-left">
        <span className={cn("text-body-s [overflow-wrap:anywhere]", rappel.faite ? "text-texte-secondaire line-through" : "text-texte-principal")}>
          {rappel.priorite > 0 ? (
            <>
              <span aria-hidden="true" className="mr-1 font-semibold text-texte-accent">
                {"!".repeat(rappel.priorite)}
              </span>
              <span className="sr-only">{NOMS_URGENCE[rappel.priorite]} : </span>
            </>
          ) : null}
          {rappel.titre}
        </span>
        {rappel.jour || personne || mention || (avecCategorie && categorie) ? (
          <span className="text-ui-xs text-texte-secondaire">
            {rappel.jour ? <span className={cn(rappel.retard && !rappel.faite && "font-medium text-texte-erreur")}>{libellePeriode(rappel.jour, rappel.heure, rappel.fin)}</span> : null}
            {[rappel.jour ? "" : null, personne, avecCategorie ? categorie?.nom : null].filter((x) => x !== null && x !== undefined).join(" · ")}
            {mention ? (
              <>
                {rappel.jour || personne || (avecCategorie && categorie) ? " · " : null}
                <span className={cn("font-medium", mention.erreur ? "text-texte-erreur" : "text-texte-accent")}>{mention.texte}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </button>
      <BoutonIcone variant="discret" className="size-11 shrink-0" libelle={`Actions pour ${rappel.titre}`} aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(true)} />
      {menu ? <MenuRappel rappel={rappel} categorie={categorie} onFermer={() => setMenu(false)} /> : null}
    </li>
  );
}

/** Ce qui se dit d'un rappel confié : l'attribution faite, celle qui attend, ou celle à reprendre. */
export function texteConfie(confie: ConfieA, nom: string, sur: string, posteOuvert: boolean): { texte: string; erreur?: boolean } {
  switch (confie.etat) {
    case "confie":
      return { texte: `Confié à ${nom}` };
    case "fait":
      return { texte: `Fait par ${nom}` };
    case "a-reessayer":
      return { texte: "Attribution à réessayer", erreur: true };
    default:
      return { texte: posteOuvert ? "Attribution demandée…" : `${nom} s’y mettra à l’ouverture de ${sur}` };
  }
}

/** Les agents actifs, l'assistant d'abord (E3-19) : le choix demande l'attribution, le rappel reste à sa place. */
function ChoixAgent({ rappel }: { rappel: RappelTelephone }) {
  const { confier, posteOuvert, sur, auTravail } = usePlanningTelephone();
  const { cartes, nom, carte } = useCartes();
  const annoncer = useAnnonce();
  const fermer = useFermerFeuille();
  const actifs = (cartes ?? []).filter((c) => c.actif).sort((a, b) => Number(b.origine === "principal") - Number(a.origine === "principal"));
  const choisir = async (roleId: string) => {
    fermer();
    const erreur = await confier(rappel, roleId);
    if (erreur) annoncer({ texte: erreur, erreur: true });
    else if (!posteOuvert) annoncer({ texte: `${nom(roleId)} s’y mettra à l’ouverture de ${sur}`, icone: "clock-backward" });
  };
  return (
    <>
      {cartes === undefined ? (
        <Squelette lignes={3} />
      ) : actifs.length === 0 ? (
        <EtatEcran forme="encadre" className="px-0" icone="users-profiles-01" titre="Aucun agent actif" texte={`Tes agents viennent de ${sur}.`} />
      ) : (
        <GroupeListe>
          {actifs.map((a) => (
            <LigneListe
              key={a.origine}
              retrait="avatar"
              debut={<RondAgent id={a.origine} taille={44} />}
              nom={a.nom}
              ligne2={[carte(a.origine)?.roleCourt, auTravail.has(a.origine) ? "travaille en ce moment" : null].filter(Boolean).join(" · ") || undefined}
              onClick={() => void choisir(a.origine)}
            />
          ))}
        </GroupeListe>
      )}
      <p className="mt-2 px-1 text-ui-xs text-texte-secondaire">Le rappel reste ici, marqué « Confié à … ». Il se coche quand tu valides son ticket.</p>
    </>
  );
}

/** Rendu sans composant autour : passer du menu à sa sous-page garde la même feuille, et son entrée d'historique. */
export const feuilleConfier = (rappel: RappelTelephone, onFermer: () => void, onRetour?: () => void) => (
  <MenuFeuille titre="Confier à un agent" sousTitre={`« ${rappel.titre} »`} retour={onRetour} entete={<ChoixAgent rappel={rappel} />} actions={[]} onFermer={onFermer} />
);

/**
 * Le menu d'un rappel (E3-18, E3-21) : les reports que le moteur propose aujourd'hui, avec leur date
 * écrite ; « Planifier… » ; confier ; modifier ; supprimer. Un rappel de l'ordinateur lu dans la vue
 * gardée se lit seulement, et le menu dit pourquoi. Déjà confié à un fil ouvert : « Voir le ticket »,
 * pas de seconde attribution.
 */
function MenuRappel({ rappel, categorie, onFermer }: { rappel: RappelTelephone; categorie: Categorie | undefined; onFermer: () => void }) {
  const { reporter, supprimer, ouvrirRappel, posteOuvert, horsLigne, sur, aUnPoste, confieDe } = usePlanningTelephone();
  const { nom } = useCartes();
  const router = useRouter();
  const [maintenant] = useState(() => new Date());
  const [agents, setAgents] = useState(false);
  const confie = confieDe(rappel);
  const garde = rappel.source === "poste" && !posteOuvert;
  const raison = garde ? `Ce rappel est sur ${sur}. Reporter, confier et supprimer : possible quand il est ouvert.` : horsLigne ? "Possible quand ce téléphone est en ligne" : undefined;
  const bloque = garde || horsLigne;
  const sous = [rappel.jour ? libellePeriode(rappel.jour, rappel.heure, rappel.fin) : null, categorie?.nom].filter(Boolean).join(" · ");
  const reportable = !rappel.faite && rappel.createur;
  const fil = confie?.fil;
  const ligneConfier: ActionMenu[] = rappel.faite
    ? []
    : confie?.etat === "confie" && fil
      ? [{ libelle: "Voir le ticket", icone: "list", separateurAvant: reportable, onChoisir: () => router.push(`/tickets?id=${encodeURIComponent(fil)}`) }]
      : confie?.etat === "attente"
        ? [{ libelle: `Confié à ${nom(confie.roleId)}`, icone: "users-profiles-01", separateurAvant: reportable, desactivee: true, note: texteConfie(confie, nom(confie.roleId), sur, posteOuvert).texte, onChoisir: () => undefined }]
        : [
            {
              libelle: confie?.etat === "a-reessayer" ? "Réessayer de confier" : "Confier à un agent",
              icone: "users-profiles-01",
              sousPage: true,
              separateurAvant: reportable,
              desactivee: bloque || !aUnPoste,
              note: !aUnPoste ? "Possible quand un ordinateur est relié à ton compte" : bloque && !rappel.createur ? raison : undefined,
              onChoisir: () => setAgents(true),
            },
          ];
  if (agents) return feuilleConfier(rappel, onFermer, () => setAgents(false));
  const actions: ActionMenu[] = [
    ...(reportable
      ? [
          ...reportsProposes(maintenant).map(
            (choix): ActionMenu => ({
              libelle: NOMS_REPORT[choix],
              icone: choix === "une-heure" ? "clock-01" : "calendar-01",
              valeur: cibleReport(choix, maintenant),
              desactivee: bloque,
              onChoisir: () => reporter(rappel, choix),
            }),
          ),
          { libelle: "Planifier…", icone: "calendar-01" as const, desactivee: bloque, onChoisir: () => ouvrirRappel(rappel, "jour") },
        ]
      : []),
    ...ligneConfier,
    { libelle: garde ? "Voir le rappel" : "Modifier le rappel", icone: garde ? ("expand" as const) : ("pencil-01" as const), separateurAvant: reportable && ligneConfier.length === 0, onChoisir: () => ouvrirRappel(rappel) },
    ...(rappel.createur ? [{ libelle: "Supprimer", icone: "trash-01" as const, danger: !bloque, desactivee: bloque, separateurAvant: true, note: raison, onChoisir: () => supprimer(rappel) }] : []),
  ];
  return (
    <MenuFeuille
      titre={rappel.titre}
      objet={{ visuel: categorie ? <PastilleCategorie categorie={categorie} taille={36} /> : <TuileIcone icone="list" />, sous: sous || undefined }}
      entete={reportable ? <p className="px-1 pb-1 text-ui-xs font-medium text-texte-secondaire">{rappel.jour ? "Reporter" : "Planifier"}</p> : undefined}
      onFermer={onFermer}
      actions={actions}
    />
  );
}

/** Le « ⋯ » du Planning (E3-25) : une catégorie de plus (sur l'ordinateur), les terminés, relire. */
export function MenuRappels({
  voirFaits,
  faits,
  onVoirFaits,
  onRelire,
  onFermer,
}: {
  voirFaits: boolean;
  faits: number;
  onVoirFaits: (voir: boolean) => void;
  onRelire: () => void;
  onFermer: () => void;
}) {
  const { posteOuvert, horsLigne, modifierCategorie, sur } = usePlanningTelephone();
  return (
    <MenuFeuille
      titre="Rappels"
      onFermer={onFermer}
      actions={[
        {
          libelle: "Nouvelle catégorie",
          icone: "plus-01",
          onChoisir: () => modifierCategorie(null),
          desactivee: !posteOuvert || horsLigne,
          note: horsLigne ? "Possible quand ce téléphone est en ligne" : posteOuvert ? undefined : `Possible quand ${sur} est ouvert`,
        },
        voirFaits
          ? { libelle: "Masquer les terminés", icone: "check-01", onChoisir: () => onVoirFaits(false) }
          : { libelle: `Afficher les terminés (${faits})`, icone: "check-01", onChoisir: () => onVoirFaits(true) },
        { libelle: "Relire", icone: "refresh-01", onChoisir: onRelire },
      ]}
    />
  );
}

/**
 * Nom, couleur et icône d'une catégorie, en feuille. Les catégories sont sur l'ordinateur : le
 * geste part au poste, désactivé quand il est fermé (P-7). Comme au bureau, supprimer une
 * catégorie range ses rappels dans la première qui reste.
 */
export function FeuilleCategorie({ categorie, categories, onFermer }: { categorie: Categorie | null; categories: Categorie[]; onFermer: () => void }) {
  const { posteOuvert, horsLigne, surPoste, sur } = usePlanningTelephone();
  const nombre = categories.length;
  const repli = categorie ? categorieDeRepli(categories, categorie.id) : null;
  const [aSupprimer, setASupprimer] = useState(false);
  const [nom, setNom] = useState(categorie?.nom ?? "");
  const [teinte, setTeinte] = useState<RoleTeinte>(categorie?.teinte ?? ROLE_TEINTES[nombre % ROLE_TEINTES.length]);
  const [icone, setIcone] = useState(categorie?.icone ?? "list");
  const [erreurNom, setErreurNom] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const idNom = useId();
  const change = !categorie || nom.trim() !== categorie.nom || teinte !== categorie.teinte || icone !== categorie.icone;
  const bloque = !posteOuvert || horsLigne;

  const agir = async (type: string, args: unknown) => {
    setOccupe(true);
    setErreur(null);
    const resultat = await surPoste(type, args);
    setOccupe(false);
    if (resultat.ok) onFermer();
    else setErreur(texteErreurPoste(resultat, sur));
  };

  const enregistrer = () => {
    if (!nom.trim()) {
      setErreurNom("Donne un nom à la catégorie.");
      return;
    }
    setErreurNom(null);
    void agir("planning.enregistrerCategorie", { id: categorie?.id ?? null, nom, teinte, icone });
  };

  return (
    <Feuille
      titre={categorie ? "Catégorie" : "Nouvelle catégorie"}
      onFermer={onFermer}
      pied={
        <div className="flex flex-col gap-1">
          <Bouton variant="sombre" taille="md" className="w-full" disabled={bloque || occupe || !change} onClick={enregistrer}>
            {categorie ? "Enregistrer" : "Créer la catégorie"}
          </Bouton>
          {horsLigne ? <p className="mt-1 text-ui-xs text-texte-secondaire">Possible quand ce téléphone est en ligne</p> : !posteOuvert ? <NotePoste /> : null}
          {erreur ? (
            <p role="alert" className="text-ui text-texte-erreur">
              {erreur}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4 pt-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={idNom} className="text-ui font-medium text-texte-principal">
            Nom
          </label>
          <input
            id={idNom}
            data-autofocus
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            aria-invalid={erreurNom ? true : undefined}
            className="h-12 rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal"
          />
          {erreurNom ? <p className="text-ui-xs text-texte-erreur">{erreurNom}</p> : null}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-ui font-medium text-texte-principal">Couleur</legend>
          <div className="grid grid-cols-6 gap-2">
            {ROLE_TEINTES.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={NOMS_TEINTES[t]}
                aria-pressed={teinte === t}
                onClick={() => setTeinte(t)}
                className="flex size-11 items-center justify-center rounded-full"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-8 rounded-full border-2", teinte === t ? "border-texte-principal" : "border-transparent")}
                  style={{ background: AGENT_PASTELS[t].accent }}
                />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-ui font-medium text-texte-principal">Icône</legend>
          <div className="grid grid-cols-6 gap-2">
            {ICONES.map((i) => (
              <button
                key={i}
                type="button"
                aria-label={NOMS_ICONES[i] ?? "Icône"}
                aria-pressed={icone === i}
                onClick={() => setIcone(i)}
                className={cn(
                  "flex size-11 items-center justify-center rounded-xs text-icone-secondaire",
                  icone === i ? "bg-fond-surface-grise text-texte-principal" : "active:bg-fond-survol",
                )}
              >
                <Icon name={i} size={20} />
              </button>
            ))}
          </div>
        </fieldset>
        {categorie && nombre > 1 ? (
          <Bouton
            variant="discret"
            taille="md"
            className="self-start text-texte-erreur"
            disabled={bloque || occupe}
            iconeGauche={<Icon name="trash-01" size={20} />}
            onClick={() => setASupprimer(true)}
          >
            Supprimer la catégorie
          </Bouton>
        ) : null}
        {aSupprimer && categorie ? (
          <ConfirmationFeuille
            titre={`Supprimer la catégorie ${categorie.nom} ?`}
            texte={`Ses rappels passent dans ${repli?.nom ?? "la catégorie suivante"}. Rien d’autre n’est effacé.`}
            confirmer="Supprimer"
            onConfirmer={() => void agir("planning.supprimerCategorie", { id: categorie.id })}
            onFermer={() => setASupprimer(false)}
          />
        ) : null}
      </div>
    </Feuille>
  );
}
