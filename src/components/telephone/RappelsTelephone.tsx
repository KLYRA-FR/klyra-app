"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { ICONES, PastilleCategorie } from "@/components/planning/Rappels";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { libellePeriode } from "@/lib/dates";
import { reportsProposes } from "@/lib/report";
import { NOMS_REPORT, cibleReport, type RappelTelephone, type SectionRappels } from "@/lib/telephone/planning";
import { ROLE_TEINTES, type Categorie, type RoleTeinte } from "@/types/domain";
import { usePlanningTelephone } from "./ContextePlanningTelephone";
import { Feuille, MenuFeuille } from "./Feuille";
import { NotePoste } from "./etats";

/**
 * T-06 Planning › Rappels : une section repliable par catégorie au lieu des colonnes du bureau,
 * puis « Ceux que j'ai assignés » et « Assignés par l'équipe ». Une ligne : la coche (44 × 44),
 * le titre (ouvre T-07), l'échéance, « Reporter ».
 */
export function RappelsTelephone({ sections, charge }: { sections: SectionRappels[]; charge: boolean }) {
  const [replies, setReplies] = useState<ReadonlySet<string>>(() => new Set());
  const basculer = (id: string) =>
    setReplies((avant) => {
      const apres = new Set(avant);
      if (!apres.delete(id)) apres.add(id);
      return apres;
    });

  if (!charge) {
    return (
      <ul className="mt-2 flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="h-12 rounded-md bg-fond-surface-grise" />
        ))}
      </ul>
    );
  }
  const rien = sections.every((s) => s.rappels.length === 0);
  return (
    <div className="flex flex-col">
      {rien ? <p className="py-4 text-body-s text-texte-secondaire">Tout est fait</p> : null}
      {sections.map((section, i) => (
        <div key={section.id}>
          {section.categorie && sections[i - 1]?.groupe !== "mes" ? (
            <h2 className="pt-3 pb-1 text-ui font-medium text-texte-secondaire">Mes rappels</h2>
          ) : null}
          <SectionRappelsTelephone section={section} replie={replies.has(section.id)} onBasculer={() => basculer(section.id)} />
        </div>
      ))}
    </div>
  );
}

function SectionRappelsTelephone({ section, replie, onBasculer }: { section: SectionRappels; replie: boolean; onBasculer: () => void }) {
  const { posteOuvert, modifierCategorie } = usePlanningTelephone();
  const id = useId();
  const { categorie } = section;
  return (
    <section aria-label={section.titre}>
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-fond-page">
        <button
          type="button"
          aria-expanded={!replie}
          aria-controls={id}
          onClick={onBasculer}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left active:bg-fond-survol"
        >
          <Icon name="chevron-down" size={20} className={cn("text-icone-secondaire transition-transform duration-[120ms] motion-reduce:transition-none", replie && "-rotate-90")} />
          {categorie ? <PastilleCategorie categorie={categorie} taille={24} /> : null}
          <span
            className="min-w-0 truncate text-ui font-semibold text-texte-principal"
            style={categorie ? { color: AGENT_PASTELS[categorie.teinte]?.encre } : undefined}
          >
            {section.titre}
          </span>
          <span className="shrink-0 text-ui text-texte-secondaire">{section.aFaire}</span>
        </button>
        {categorie && posteOuvert ? (
          <BoutonIcone
            taille="md"
            libelle={`Modifier la catégorie ${categorie.nom}`}
            icone={<Icon name="dot-horizontal" size={20} />}
            onClick={() => modifierCategorie(categorie)}
          />
        ) : null}
      </div>
      {replie ? null : (
        <ul id={id} className="flex flex-col pb-2">
          {section.rappels.map((rappel) => (
            <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} />
          ))}
          {section.rappels.length === 0 ? <li className="py-2 text-ui text-texte-secondaire">Aucun rappel.</li> : null}
        </ul>
      )}
    </section>
  );
}

/**
 * Une ligne de rappel, ici et dans « À faire aujourd'hui » de l'agenda. Toute la ligne porte
 * `data-echeance` : elle s'éclaire après un report, une restauration ou un retour de T-07.
 */
export function LigneRappel({ rappel, avecCategorie = false }: { rappel: RappelTelephone; avecCategorie?: boolean }) {
  const { cocher, ouvrirRappel, noms, categories, occupes } = usePlanningTelephone();
  const [report, setReport] = useState(false);
  const categorie = avecCategorie ? categories?.find((c) => c.id === rappel.liste) : undefined;
  const nomAutre = rappel.autre ? (noms.get(rappel.autre) ?? "quelqu’un") : null;
  const personne = nomAutre ? (rappel.recu ? `Par ${nomAutre}` : `Assigné à ${nomAutre}`) : null;

  return (
    <li data-echeance={rappel.id} className="flex items-center gap-2 border-b border-bordure-subtile last:border-b-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={rappel.faite}
        aria-label={rappel.faite ? `Rouvrir ${rappel.titre}` : `Terminer ${rappel.titre}`}
        aria-busy={occupes.has(rappel.id) || undefined}
        disabled={occupes.has(rappel.id)}
        onClick={() => cocher(rappel)}
        className="flex size-11 shrink-0 items-center justify-center rounded-xs active:bg-fond-survol disabled:opacity-60"
      >
        {rappel.faite ? (
          <PixelCheck className="h-[13px] w-[18px]" />
        ) : (
          <span aria-hidden="true" className="size-5 rounded-xs border-[1.5px] border-bordure-forte" />
        )}
      </button>
      <button type="button" onClick={() => ouvrirRappel(rappel)} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 text-left">
        <span className={cn("text-body-s [overflow-wrap:anywhere]", rappel.faite ? "text-texte-secondaire line-through" : "text-texte-principal")}>
          {rappel.priorite > 0 ? <span className="mr-1 font-semibold text-texte-accent">{"!".repeat(rappel.priorite)}</span> : null}
          {rappel.titre}
        </span>
        {rappel.jour || personne ? (
          <span className="text-ui-xs text-texte-secondaire">
            {rappel.jour ? (
              <span className={cn(rappel.retard && !rappel.faite && "font-medium text-texte-erreur")}>{libellePeriode(rappel.jour, rappel.heure, rappel.fin)}</span>
            ) : null}
            {rappel.jour && personne ? " · " : null}
            {personne}
          </span>
        ) : null}
      </button>
      {categorie ? <PastilleCategorie categorie={categorie} taille={20} /> : null}
      {!rappel.faite && rappel.createur ? (
        <button type="button" onClick={() => setReport(true)} className="min-h-11 shrink-0 rounded-xs px-2 text-ui text-texte-secondaire active:bg-fond-survol">
          {rappel.jour ? "Reporter" : "Planifier"}
        </button>
      ) : null}
      {report ? <FeuilleReporter rappel={rappel} onFermer={() => setReport(false)} /> : null}
    </li>
  );
}

/** `MenuReporter` en feuille : « Dans 1 h », « Demain matin », « Lundi » avec leur cible écrite, puis « Planifier… » (T-07). */
function FeuilleReporter({ rappel, onFermer }: { rappel: RappelTelephone; onFermer: () => void }) {
  const { reporter, ouvrirRappel } = usePlanningTelephone();
  const [maintenant] = useState(() => new Date());
  const verbe = rappel.jour ? "Reporter" : "Planifier";
  const ligne = "flex min-h-12 w-full items-center gap-3 text-left text-body-s text-texte-principal active:bg-fond-survol";
  return (
    <Feuille titre={`${verbe} « ${rappel.titre} »`} onFermer={onFermer}>
      <ul className="flex flex-col">
        {reportsProposes(maintenant).map((choix) => {
          const cible = cibleReport(choix, maintenant);
          return (
            <li key={choix} className="border-b border-bordure-subtile">
              <button
                type="button"
                aria-label={`${NOMS_REPORT[choix]}, ${cible}`}
                className={ligne}
                onClick={() => {
                  onFermer();
                  reporter(rappel, choix);
                }}
              >
                {NOMS_REPORT[choix]}
                <span className="ml-auto text-ui text-texte-secondaire">{cible}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className={ligne}
            onClick={() => {
              onFermer();
              ouvrirRappel(rappel, "jour");
            }}
          >
            Planifier…
          </button>
        </li>
      </ul>
    </Feuille>
  );
}

/** Le « ⋯ » des rappels : une catégorie de plus (sur l'ordinateur), et les terminés. */
export function MenuRappels({
  voirFaits,
  faits,
  onVoirFaits,
  onFermer,
}: {
  voirFaits: boolean;
  faits: number;
  onVoirFaits: (voir: boolean) => void;
  onFermer: () => void;
}) {
  const { posteOuvert, modifierCategorie } = usePlanningTelephone();
  return (
    <MenuFeuille
      titre="Rappels"
      onFermer={onFermer}
      actions={[
        {
          libelle: "Nouvelle catégorie",
          onChoisir: () => modifierCategorie(null),
          desactivee: !posteOuvert,
          note: posteOuvert ? undefined : <NotePoste />,
        },
        voirFaits
          ? { libelle: "Masquer les terminés", onChoisir: () => onVoirFaits(false) }
          : { libelle: `Afficher les terminés (${faits})`, onChoisir: () => onVoirFaits(true) },
      ]}
    />
  );
}

/**
 * Nom, couleur et icône d'une catégorie, en feuille. Les catégories sont sur l'ordinateur : le
 * geste part au poste, désactivé quand il est fermé (P-7). Comme au bureau, supprimer une
 * catégorie range ses rappels dans la première qui reste.
 */
export function FeuilleCategorie({ categorie, nombre, onFermer }: { categorie: Categorie | null; nombre: number; onFermer: () => void }) {
  const { posteOuvert, surPoste } = usePlanningTelephone();
  const [nom, setNom] = useState(categorie?.nom ?? "");
  const [teinte, setTeinte] = useState<RoleTeinte>(categorie?.teinte ?? ROLE_TEINTES[nombre % ROLE_TEINTES.length]);
  const [icone, setIcone] = useState(categorie?.icone ?? "list");
  const [erreurNom, setErreurNom] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const idNom = useId();

  const agir = async (type: string, args: unknown) => {
    setOccupe(true);
    setErreur(null);
    const resultat = await surPoste(type, args);
    setOccupe(false);
    if (resultat.ok) onFermer();
    else setErreur(resultat.code === "delai" ? "Pas de réponse de l’ordinateur. Réessaie." : resultat.message || "Le geste a échoué sur l’ordinateur.");
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
          <Bouton variant="sombre" taille="md" className="w-full" disabled={!posteOuvert || occupe} onClick={enregistrer}>
            {categorie ? "Enregistrer" : "Créer la catégorie"}
          </Bouton>
          {!posteOuvert ? <NotePoste /> : null}
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
                aria-label={t}
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
                aria-label={i}
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
            disabled={!posteOuvert || occupe}
            iconeGauche={<Icon name="trash-01" size={20} />}
            onClick={() => void agir("planning.supprimerCategorie", { id: categorie.id })}
          >
            Supprimer la catégorie
          </Bouton>
        ) : null}
      </div>
    </Feuille>
  );
}
