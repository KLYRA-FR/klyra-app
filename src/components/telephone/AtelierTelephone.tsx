"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Etoiles, Jauge } from "@/components/chat/EtoilesAtelier";
import { RondApercu } from "@/components/roles/AgentRond";
import { ChoixTeinte } from "@/components/roles/ChoixTeinte";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { optionsRetenues, PILIERS, texteDuChoix, type Pilier } from "@/lib/atelier-agent";
import { cn } from "@/lib/cn";
import type { CarteAtelierCompte, LigneAtelierCompte, PartieCompte } from "@/lib/copie-compte";
import { jouer } from "@/lib/sons/sons";
import { idDirect } from "@/lib/telephone/chats";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { ecrireBrouillon, lireBrouillon, nouvelleRoutine } from "@/lib/telephone/routines-telephone";
import type { RoleTeinte } from "@/types/domain";
import { LIBELLES_CAS, type TypeCas } from "../../../electron/epreuve";
import { ConfirmationFeuille, Feuille } from "./Feuille";
import { NotePoste } from "./etats";
import { useCartes } from "./AgentsChat";
import { useSupport } from "./poste";

/**
 * L'atelier d'un agent sur le téléphone : la carte calculée par l'ordinateur (copie du compte,
 * src/lib/atelier-compte.ts), les gestes qu'il fait pour le téléphone (`atelier.*` : couleur,
 * épreuve, correction, création), et les réponses toutes prêtes sous les questions de l'assistant.
 * Ordinateur fermé, les gestes sont désactivés (P-7), jamais mis en attente (M-6) ; répondre à une
 * question reste un message comme un autre.
 */

const ensemble = (piliers: Pilier[]) => new Set(piliers);

/* ─── Un appel plus ancien : une ligne ─────────────────────────── */

export function LigneAtelierTelephone({ ligne }: { ligne: LigneAtelierCompte }) {
  const nom = ligne.nom || "l’agent";
  const titres = ligne.nouveaux.map((p) => PILIERS.find((x) => x.cle === p)?.titre.toLowerCase()).filter(Boolean);
  return (
    <div className="flex min-h-8 w-full min-w-0 items-center gap-2 px-1 text-ui-xs text-texte-secondaire">
      <span aria-hidden="true" className="flex">
        <RondApercu agentId={ligne.id} nom={nom} teinte={ligne.teinte} taille={20} />
      </span>
      <span className="min-w-0 flex-1 truncate">{titres.length ? `Carte de ${nom} : ${titres.join(", ")}` : `Carte de ${nom} mise à jour`}</span>
      <Etoiles remplis={ensemble(ligne.remplis)} taille={12} />
    </div>
  );
}

/* ─── La carte entière ─────────────────────────────────────────── */

export function CarteAtelierTelephone({ etapeId, carte, conversation }: { etapeId: string; carte: CarteAtelierCompte; conversation: string }) {
  const router = useRouter();
  const sur = useSupport();
  const { carte: carteAgent } = useCartes();
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const [fiche, setFiche] = useState(false);
  /* La couleur choisie ici, montrée tout de suite, jusqu'à ce que la copie suivante de l'ordinateur la porte. */
  const [voulue, setVoulue] = useState<{ teinte: RoleTeinte; depuis: RoleTeinte } | null>(null);
  const [enCreation, setEnCreation] = useState(false);
  const [remplacer, setRemplacer] = useState(false);
  const cree = carte.cree;
  const teinte = !cree && voulue?.depuis === carte.teinte ? voulue.teinte : carte.teinte;
  const nom = carte.nom || "Nouvel agent";
  const args = { conversation, etapeId };
  const libre = ouvert && !occupe && !carte.provisoire;

  const choisirTeinte = async (t: RoleTeinte) => {
    setVoulue({ teinte: t, depuis: carte.teinte });
    if (!(await agir("atelier.teinte", { ...args, teinte: t }))) setVoulue(null);
  };
  const creer = async () => {
    setEnCreation(true);
    const r = await agir<{ id: string }>("atelier.creer", args, `Agent créé : ${nom}. Il rejoint ton équipe.`);
    setEnCreation(false);
    if (r) jouer("agent-ne");
  };

  /* « Lui confier » : la routine proposée ouvre le formulaire des routines, à relire (rien n'est planifié avant). */
  const routine = carte.routine;
  const ouvrirRoutine = () => {
    if (!cree || !routine) return;
    const base = nouvelleRoutine(cree, Intl.DateTimeFormat().resolvedOptions().timeZone, null);
    ecrireBrouillon({ initiale: null, base, valeurs: { ...base, name: routine.nom, instruction: routine.consigne, schedule: routine.schedule }, champAgent: false });
    router.push(`/routines?vue=routines&agent=${encodeURIComponent(cree)}&formulaire=1`);
  };
  const confier = () => {
    if (lireBrouillon()) setRemplacer(true);
    else ouvrirRoutine();
  };

  const note = carte.remplacee
    ? "Remplacée par une autre carte, plus bas."
    : cree
      ? carteAgent(cree)
        ? "Actif dans Mes agents."
        : "Créé : il apparaît dans ton équipe dès la prochaine copie."
      : carte.pris
        ? `Tu as déjà un agent qui s’appelle ${carte.pris} : demande un autre prénom.`
        : carte.manques.length
          ? `Il lui manque ${carte.manques.join(", ")}.`
          : `Rien n’est écrit sur ${sur} avant ce geste.`;

  return (
    <div data-carte-atelier={etapeId} className="flex w-full flex-col gap-3">
      {bandeau}
      <span className={cn("text-ui-xs text-texte-secondaire", carte.provisoire && "klyra-respire")}>
        {cree ? "Dans ton équipe" : carte.provisoire ? "L’assistant écrit sa carte…" : "Atelier · nouvel agent"}
      </span>
      {!cree && !carte.remplacee ? <Voisins voisins={carte.voisins} /> : null}

      <div className="flex flex-col overflow-hidden rounded-3xl shadow-ombre-levee" style={{ backgroundImage: fondCarte(teinte) }}>
        <div className="relative h-[168px] shrink-0 overflow-hidden">
          <AgentFormes key={carte.id} agentId={carte.id} className="klyra-formes-entree absolute top-1/2 left-1/2 aspect-square h-[86%] w-auto -translate-x-1/2 -translate-y-1/2" />
          {cree ? (
            <span className="absolute top-4 left-4 flex items-center gap-1.5 rounded-sm bg-white/85 px-2 py-1 text-ui-2xs font-semibold text-texte-principal">
              <Icon name="check-01" size={12} className="text-icone-accent" />
              Dans ton équipe
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 px-5 pb-5">
          <span className="truncate text-ui-xs" style={{ color: AGENT_PASTELS[teinte].encre }}>
            {carte.role || "Son rôle viendra"}
          </span>
          <span className="truncate text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{nom}</span>
          <p className={cn("line-clamp-3 text-ui leading-[1.45]", carte.mission ? "text-texte-secondaire" : "text-texte-tertiaire")}>
            {carte.mission || "Sa mission s’écrira ici, au fil de la conversation."}
          </p>
          <div className="mt-1 flex items-end justify-between gap-2 border-t border-white/60 pt-3">
            <Etoiles remplis={ensemble(carte.remplis)} alerte={ensemble(carte.alerte)} />
            <Jauge jetons={carte.jetons} />
          </div>
        </div>
      </div>

      {!cree && !carte.remplacee ? (
        <div className="flex flex-col gap-1.5">
          <span id={`couleur-${etapeId}`} className="text-ui-xs text-texte-secondaire">
            Couleur de {nom}
          </span>
          <ChoixTeinte valeur={teinte} onChange={(t) => void choisirTeinte(t)} libelleId={`couleur-${etapeId}`} desactive={!libre} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {cree ? (
          <>
            <Link href={`/chat?id=${encodeURIComponent(idDirect(cree))}`} className="flex h-11 items-center gap-2 rounded-xs px-4 text-ui font-medium text-texte-inverse no-underline klyra-surface-sombre">
              <Icon name="message-square" size={16} />
              Lui écrire
            </Link>
            <Link href={`/equipe?agent=${encodeURIComponent(cree)}`} className="flex h-11 items-center rounded-xs border border-bordure-subtile bg-fond-surface px-4 text-ui font-medium text-texte-principal no-underline">
              Voir sa fiche
            </Link>
          </>
        ) : carte.remplacee ? null : (
          <Bouton variant="blanc" className="h-11 text-ui" iconeGauche={<Icon name="align-left" size={16} />} aria-haspopup="dialog" onClick={() => setFiche(true)}>
            Voir sa fiche
          </Bouton>
        )}
      </div>

      {!carte.remplacee && !carte.provisoire && carte.epreuve ? (
        <Epreuve carte={carte} args={args} libre={libre} ouvert={ouvert} lectureSeule={!!cree} agir={agir} />
      ) : null}

      {!cree && !carte.remplacee ? (
        <div className="flex flex-col items-start gap-1">
          <BoutonPrincipal onClick={() => void creer()} disabled={!libre || !!carte.manques.length || !!carte.pris}>
            {enCreation ? "Création…" : "Créer l’agent"}
          </BoutonPrincipal>
          {!ouvert ? <NotePoste /> : null}
        </div>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-ui-xs text-texte-erreur [overflow-wrap:anywhere]">
          {erreur.message}
        </p>
      ) : null}
      <p className={cn("text-ui-xs [overflow-wrap:anywhere]", carte.pris && !cree ? "text-texte-erreur" : "text-texte-secondaire")}>{note}</p>

      {cree && routine ? (
        <div className="flex flex-col gap-2 border-t border-bordure-subtile pt-3">
          <span className="text-ui-xs text-texte-secondaire">Et ensuite</span>
          <Bouton variant="blanc" className="h-auto min-h-11 py-2 text-left text-ui whitespace-normal" iconeGauche={<Icon name="clock-01" size={16} />} onClick={confier}>
            <span>
              Lui confier : {routine.nom} <span className="text-texte-secondaire">· {routine.planning}</span>
            </span>
          </Bouton>
          <p className="text-ui-xs text-texte-secondaire">La routine s’ouvre pour que tu la relises : rien n’est planifié avant que tu l’enregistres.</p>
        </div>
      ) : null}

      {fiche ? (
        <Feuille titre={`Sa fiche · ${carte.id}.md`} onFermer={() => setFiche(false)} haute>
          <p className="klyra-mono mb-2 text-ui-xs text-texte-secondaire">~{carte.jetons.toLocaleString("fr-FR")} jetons, relus à chaque appel</p>
          <pre className="m-0 font-sans text-ui-xs leading-[1.55] break-words whitespace-pre-wrap text-texte-secondaire">{carte.fiche}</pre>
        </Feuille>
      ) : null}
      {remplacer ? (
        <ConfirmationFeuille
          titre="Remplacer le brouillon de routine ?"
          texte="Une routine non enregistrée attend. Celle-ci prendra sa place."
          confirmer="Remplacer"
          onConfirmer={ouvrirRoutine}
          onFermer={() => setRemplacer(false)}
        />
      ) : null}
    </div>
  );
}

function Voisins({ voisins }: { voisins: CarteAtelierCompte["voisins"] }) {
  const { nom } = useCartes();
  if (!voisins.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {voisins.map((v) => (
        <li key={v.id} className="flex items-start gap-2 text-ui-xs leading-[1.45] text-texte-secondaire">
          <span aria-hidden="true" className="flex pt-0.5">
            <RondApercuCarte id={v.id} />
          </span>
          <span>
            <strong className="font-semibold text-texte-principal">{nom(v.id)}</strong> fait déjà une partie de ce travail : {v.raison}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RondApercuCarte({ id }: { id: string }) {
  const { nom, teinte } = useCartes();
  return <RondApercu agentId={id} nom={nom(id)} teinte={teinte(id)} taille={20} />;
}

/* ─── L'épreuve ────────────────────────────────────────────────── */

function Epreuve({
  carte,
  args,
  libre,
  ouvert,
  lectureSeule,
  agir,
}: {
  carte: CarteAtelierCompte;
  args: { conversation: string; etapeId: string };
  /** Un geste est possible : ordinateur ouvert, rien en cours. */
  libre: boolean;
  ouvert: boolean;
  lectureSeule: boolean;
  agir: ReturnType<typeof useGesteTelephone>["agir"];
}) {
  const [lues, setLues] = useState<TypeCas[]>([]);
  const epreuve = carte.epreuve!;
  const enCours = epreuve.essais;
  const joues = epreuve.resultats;
  const reussis = joues.filter((r) => r.verdict === "ok").length;
  const anciens = joues.filter((r) => r.ancien).length;
  const nom = carte.nom || "l’agent";
  if (lectureSeule && !joues.length) return null;

  const lancer = () => void agir("atelier.essayer", args, "Épreuve lancée : les réponses arrivent sur la carte.");
  const corriger = (type: TypeCas) => void agir("atelier.corriger", { ...args, type }, "Ajouté à sa fiche : l’essai est rejoué.");

  return (
    <section aria-label={`Épreuve de ${nom}`} className="flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-3">
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-ui font-semibold text-texte-principal">L’épreuve</span>
        <span aria-live="polite" className="klyra-mono text-ui-xs text-texte-secondaire">
          {enCours.length ? `${3 - enCours.length} / 3 joués` : joues.length ? `${reussis} / 3 réussi${reussis > 1 ? "s" : ""}` : `avec ${carte.modele}`}
        </span>
      </header>
      <ol className="flex flex-col gap-2">
        {epreuve.cas.map((c) => {
          const r = joues.find((x) => x.type === c.type);
          const joue = enCours.includes(c.type);
          const longue = (r?.reponse.length ?? 0) > 280;
          const lue = lues.includes(c.type);
          return (
            <li
              key={c.type}
              data-cas={c.type}
              data-verdict={joue ? "en-cours" : (r?.verdict ?? (r ? "aucun" : "attente"))}
              className={cn("flex flex-col gap-1.5 rounded-lg border p-2.5", r?.verdict === "ko" && !joue ? "border-orange-k1-500/40" : "border-bordure-subtile")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui-xs text-texte-secondaire">{LIBELLES_CAS[c.type]}</span>
                {!joue && r?.verdict === "ok" ? (
                  <span className="flex items-center gap-1 rounded-sm bg-fond-teinte-bleue px-1.5 py-0.5 text-ui-2xs font-medium text-texte-accent">
                    <Icon name="check-01" size={12} />
                    Réussi
                  </span>
                ) : null}
                {!joue && r?.verdict === "ko" ? (
                  <span className="rounded-sm bg-fond-tag-orange px-1.5 py-0.5 text-ui-2xs font-medium text-texte-accent-orange">{r.ajoutee ? "Corrigé, à rejouer" : "À corriger"}</span>
                ) : null}
              </div>
              <p className="text-ui leading-[1.4] text-texte-principal">« {c.demande} »</p>
              {joue ? (
                <span aria-label={`${nom} répond…`} className="klyra-chargement mt-1 h-2.5 w-3/4 rounded-xs" />
              ) : r?.erreur ? (
                <p className="text-ui-xs text-texte-erreur [overflow-wrap:anywhere]">{r.erreur}</p>
              ) : r ? (
                <div className="flex flex-col items-start gap-1">
                  <p className={cn("text-ui leading-[1.45] whitespace-pre-wrap text-texte-secondaire [overflow-wrap:anywhere]", longue && !lue && "line-clamp-5")}>{r.reponse}</p>
                  {longue ? (
                    <Bouton variant="discret" className="h-11 text-ui" onClick={() => setLues((l) => (lue ? l.filter((x) => x !== c.type) : [...l, c.type]))}>
                      {lue ? "Replier" : "Lire toute la réponse"}
                    </Bouton>
                  ) : null}
                </div>
              ) : null}
              {!joue && r?.raison ? <p className="text-ui-xs leading-[1.45] text-texte-secondaire">{r.raison}</p> : null}
              {!joue && r?.ancien ? <p className="text-ui-xs text-texte-secondaire">Joué sur une version précédente de la fiche.</p> : null}
              {!joue && !lectureSeule && r?.verdict === "ko" && r.correction && !r.ajoutee ? (
                <div className="flex flex-col gap-2 rounded-md bg-fond-teinte-bleue px-2.5 py-2">
                  <span className="text-ui-xs leading-[1.45] text-texte-accent">
                    <span aria-hidden="true" className="mr-1 font-semibold">
                      +
                    </span>
                    {r.correction.texte}
                  </span>
                  <Bouton variant="sombre" className="h-11 self-start text-ui" disabled={!libre} onClick={() => corriger(c.type)}>
                    Ajouter à sa fiche et rejouer
                  </Bouton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!lectureSeule ? (
        <div className="flex flex-col items-start gap-1">
          {!joues.length ? (
            <Bouton variant="sombre" className="h-11 text-ui" iconeGauche={<Icon name="shield-check" size={16} />} disabled={!libre || !!enCours.length || !!carte.manques.length} onClick={lancer}>
              {enCours.length ? "Épreuve en cours…" : "Lancer l’épreuve"}
            </Bouton>
          ) : anciens > 0 || reussis < 3 ? (
            <Bouton variant="blanc" className="h-11 text-ui" disabled={!libre || !!enCours.length} onClick={lancer}>
              Rejouer l’épreuve
            </Bouton>
          ) : null}
          {!ouvert ? <NotePoste /> : null}
        </div>
      ) : null}
      <p className="text-ui-xs leading-[1.45] text-texte-secondaire">
        {joues.length
          ? `${joues.length} essai${joues.length > 1 ? "s" : ""} et leur avis : ${epreuve.jetons.toLocaleString("fr-FR")} jetons, ${carte.vps ? "sur le compte Claude du VPS" : "sur le compte Claude de ton ordinateur"}.`
          : `Trois vrais essais de ${nom} avec ${carte.modele}${carte.vps ? " sur le VPS" : ""}, sans outil et sans rien écrire, puis un avis rapide sur chacun.`}
      </p>
    </section>
  );
}

/* ─── Les réponses toutes prêtes ───────────────────────────────── */

export function ChoixTelephone({
  partie,
  actif,
  repondu,
  onRepondre,
}: {
  partie: Extract<PartieCompte, { type: "choix" }>;
  /** La dernière réponse du fil, rien n'y a encore répondu. */
  actif: boolean;
  /** Ce que la personne a répondu ensuite, s'il y a une réponse. */
  repondu: string | null;
  onRepondre: (texte: string) => void;
}) {
  const [coches, setCoches] = useState<string[]>([]);
  const retenues = repondu !== null ? optionsRetenues(partie.options, repondu) : null;
  const figees = !actif || retenues !== null;
  const repondre = (choisies: string[]) => {
    if (figees || !choisies.length) return;
    onRepondre(texteDuChoix(partie.options.filter((o) => choisies.includes(o))));
  };
  return (
    <div role="group" aria-label={partie.question || "Réponses proposées"} className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {partie.options.map((option) => {
          const choisie = retenues ? retenues.has(option) : coches.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={partie.multiple || retenues ? choisie : undefined}
              disabled={figees}
              onClick={() => (partie.multiple ? setCoches((c) => (c.includes(option) ? c.filter((x) => x !== option) : [...c, option])) : repondre([option]))}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-sm border px-3 py-2 text-left text-ui leading-[1.35]",
                choisie ? "border-bleu-k1-500 bg-fond-teinte-bleue text-texte-accent" : "border-bordure-defaut bg-fond-surface text-texte-principal",
                figees && !choisie && "opacity-45",
              )}
            >
              {partie.multiple ? (
                <span
                  aria-hidden="true"
                  className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]", choisie ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte")}
                >
                  {choisie ? <Icon name="check-01" size={14} /> : null}
                </span>
              ) : null}
              {option}
            </button>
          );
        })}
      </div>
      {partie.multiple && !figees ? (
        <div className="flex flex-col items-start gap-1">
          <Bouton variant="sombre" className="h-11 text-ui" disabled={!coches.length} onClick={() => repondre(coches)}>
            Envoyer
          </Bouton>
          <span className="text-ui-xs text-texte-secondaire">Coche ce qui va ensemble, ou écris ta réponse.</span>
        </div>
      ) : null}
    </div>
  );
}
