"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond, RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { teinteNouvelAgent } from "@/lib/agents";
import { etapeEquipe, membresNouveaux, membresTouches, tacheProposee, type EtapeEquipe, type EtatEquipe } from "@/lib/atelier-equipe";
import { cn } from "@/lib/cn";
import { nomPropre } from "@/lib/noms-agents";
import { jouer } from "@/lib/sons/sons";
import { useRole } from "@/lib/workspace";
import type { MessagePart } from "@/types/domain";
import { ouvrirAtelierEquipe, useDansAtelierEquipe } from "./atelier-equipe/ouvrir";
import { CartesMembres, QuiSenCharge } from "./atelier-equipe/TableMembres";
import { nomAffiche, useEquipe, type Membre } from "./atelier-equipe/useEquipe";

/**
 * L'atelier d'une équipe dans le fil : un module compact (ses tâches ou ses agents, où en est
 * l'équipe, « Ouvrir l'atelier »), qui s'ouvre en grand (atelier-equipe/AtelierEquipe.tsx). Dans la
 * colonne de l'atelier en grand, et pour un appel plus ancien de la série, une ligne. Règles pures :
 * electron/atelier-equipe.ts et src/lib/atelier-equipe.ts.
 */

type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;

const NOM_ETAPE: Record<EtapeEquipe, string> = { taches: "Tes tâches", groupes: "Les regrouper", equipe: "Ton équipe" };

/* ─── Une ligne : un appel plus ancien, ou dans l'atelier en grand ── */

function LigneEquipe({ etat, chatId, dansAtelier }: { etat: EtatEquipe; chatId: string; dansAtelier: boolean }) {
  const nouveaux = membresNouveaux(etat);
  const touches = membresTouches(etat);
  const tachesAvant = new Set((etat.avant.taches ?? []).map((t) => t.id));
  const tachesNeuves = (etat.apres.taches ?? []).filter((t) => !tachesAvant.has(t.id));
  const groupesNeufs = (etat.apres.groupes ?? []).length - (etat.avant.groupes ?? []).length;
  const prenom = (cle: string) => {
    const m = etat.apres.membres.find((x) => x.cle === cle);
    return m ? nomPropre(m.agent.nom) || m.agent.role || cle : cle;
  };
  const texte = nouveaux.length
    ? `${etat.apres.nom ? `« ${etat.apres.nom} »` : "Ton équipe"} : ${nouveaux.map((m) => prenom(m.cle)).join(", ")} arrive${nouveaux.length > 1 ? "nt" : ""}`
    : touches.length
      ? `${touches.map(prenom).join(", ")} mis à jour`
      : groupesNeufs > 0
        ? `${groupesNeufs} groupe${groupesNeufs > 1 ? "s" : ""} proposé${groupesNeufs > 1 ? "s" : ""}`
        : tachesNeuves.length
          ? `${tachesNeuves.length} tâche${tachesNeuves.length > 1 ? "s" : ""} sur la table`
          : `${etat.apres.nom ? `« ${etat.apres.nom} »` : "L’équipe"} mise à jour`;
  const ronds = (nouveaux.length ? nouveaux : etat.apres.membres).slice(0, 4);
  const contenu = (
    <>
      {ronds.length > 0 && (
        <span aria-hidden="true" className="flex -space-x-1.5">
          {ronds.map((m) => (
            <RondApercu key={m.cle} agentId={m.cle} nom={prenom(m.cle)} teinte={etat.teintes[m.cle] ?? teinteNouvelAgent(m.cle)} taille={20} />
          ))}
        </span>
      )}
      {!ronds.length && <Icon name="layers-01" size={14} className="text-icone-secondaire" />}
      <span className="min-w-0 truncate">{texte}</span>
    </>
  );
  if (!dansAtelier) return <div className="flex min-w-0 items-center gap-2 text-ui-xs text-texte-tertiaire">{contenu}</div>;
  return (
    <button
      type="button"
      onClick={() => ouvrirAtelierEquipe(chatId, touches[0] ?? nouveaux[0]?.cle)}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-bordure-subtile bg-fond-surface px-2.5 py-1.5 text-left text-ui-xs text-texte-secondaire transition-colors duration-[220ms] ease-sortie hover:border-bordure-forte"
    >
      {contenu}
    </button>
  );
}

/* ─── La carte ─────────────────────────────────────────────────── */

export function CarteEquipe({
  part,
  etat,
  messageId,
  chatId,
  enDirect,
  onEnvoyer,
}: {
  part: PartEquipe;
  etat: EtatEquipe | undefined;
  messageId: string;
  chatId: string;
  /** L'assistant est en train d'écrire ce message : les nouveaux agents arrivent sur la table. */
  enDirect: boolean;
  /** Un message de la personne à l'assistant (confier une première demande). */
  onEnvoyer: (texte: string) => void;
}) {
  const dansAtelier = useDansAtelierEquipe();
  if (!etat) return null;
  if (!etat.dernier || dansAtelier) return <LigneEquipe etat={etat} chatId={chatId} dansAtelier={dansAtelier} />;
  return <ModuleEquipe etapeId={part.etapeId} etat={etat} messageId={messageId} chatId={chatId} enDirect={enDirect} onEnvoyer={onEnvoyer} />;
}

function ModuleEquipe({ etapeId, etat, messageId, chatId, enDirect, onEnvoyer }: { etapeId: string; etat: EtatEquipe; messageId: string; chatId: string; enDirect: boolean; onEnvoyer: (texte: string) => void }) {
  const assistant = useRole("principal");
  const equipe = useEquipe(etat, messageId, etapeId);
  const { bilan, creation, aCreer, nes, remplacee } = equipe;
  const b = etat.apres;
  const etape = etapeEquipe(b);
  const taches = b.taches ?? [];

  /* Un agent qui arrive sur la table pendant que l'assistant écrit : un son, une fois par agent. */
  const entendus = useRef(enDirect ? etat.avant.membres.length : b.membres.length);
  useEffect(() => {
    if (b.membres.length > entendus.current) {
      if (enDirect) jouer("atelier-etoile");
      entendus.current = b.membres.length;
    }
  }, [b.membres.length, enDirect]);

  const etiquette = bilan.nee
    ? "Ton équipe est née"
    : etat.provisoire
      ? `${assistant.name} compose ton équipe…`
      : remplacee
        ? "Atelier · équipe remplacée"
        : `Atelier · nouvelle équipe · ${NOM_ETAPE[etape]}`;
  const propositions = taches.filter(tacheProposee).length;
  const bilanTexte =
    etape === "taches"
      ? `${taches.length} tâche${taches.length > 1 ? "s" : ""} sur la table${propositions ? ` · ${propositions} proposition${propositions > 1 ? "s" : ""} à trancher` : ""}`
      : etape === "groupes"
        ? `${b.groupes.length} groupe${b.groupes.length > 1 ? "s" : ""} proposé${b.groupes.length > 1 ? "s" : ""} · ${taches.length} tâche${taches.length > 1 ? "s" : ""}`
        : `${aCreer.length} agent${aCreer.length > 1 ? "s" : ""} à créer · ~${bilan.jetons.toLocaleString("fr-FR")} jetons de fiches`;
  const note = remplacee
    ? "Remplacée par une autre équipe, plus bas."
    : creation.type === "erreur"
      ? creation.message
      : bilan.nee
        ? `${nes.length} agent${nes.length > 1 ? "s" : ""} actif${nes.length > 1 ? "s" : ""} dans Mes agents, leurs fiches écrites sur ton poste.`
        : etape === "equipe" && bilan.manques.length
          ? `Il manque ${bilan.manques.join(" ; ")}.`
          : "Rien n’est écrit sur ton poste avant « Créer l’équipe ».";
  const ouvrir = (membre?: string) => ouvrirAtelierEquipe(chatId, membre);

  return (
    <div data-carte-equipe={etapeId} data-etape-equipe={etape} className="flex w-full max-w-[600px] flex-col gap-3">
      <span className={cn("text-ui-xs text-texte-tertiaire", etat.provisoire && "klyra-respire")}>{etiquette}</span>
      <section aria-label={`Équipe ${b.nom || "en préparation"}`} className={cn("flex flex-col overflow-hidden rounded-3xl border border-bordure-subtile bg-fond-surface shadow-ombre-levee", remplacee && "opacity-70")}>
        <header className="flex min-w-0 items-start justify-between gap-4 px-5 pt-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{b.nom || "Ton équipe"}</span>
            <p className={cn("m-0 text-ui-s leading-[1.45]", b.but ? "text-texte-secondaire" : "text-texte-tertiaire")}>{b.but || "On part de ce qui revient dans ta semaine : tes agents viendront de là."}</p>
          </div>
          <span className="klyra-mono shrink-0 pt-1 text-ui-2xs text-texte-tertiaire">
            {etape === "equipe" ? `${b.membres.length} agent${b.membres.length > 1 ? "s" : ""}` : `${taches.length} tâche${taches.length > 1 ? "s" : ""}`}
          </span>
        </header>

        <div className="klyra-tablee group/table relative mt-4 flex min-h-[184px] items-end justify-center border-y border-bordure-subtile px-5 pt-5 pb-6">
          {etape === "equipe" ? (
            <CartesMembres b={b} equipe={equipe} choisi={null} touches={new Set()} onChoisir={(cle) => ouvrir(cle)} petites />
          ) : (
            <ul aria-label="Tes tâches" className="m-0 flex w-full list-none flex-wrap content-center items-center justify-center gap-2 self-center p-0">
              {taches.slice(0, 7).map((t) => (
                <li
                  key={t.id}
                  className={cn(
                    "max-w-[220px] truncate rounded-md px-2.5 py-1.5 text-ui-xs",
                    t.pourElle ? "bg-fond-survol text-texte-secondaire" : tacheProposee(t) ? "klyra-ligne-proposee bg-white/70 text-texte-secondaire" : "bg-fond-surface text-texte-principal shadow-ombre-sm",
                  )}
                >
                  «&nbsp;{t.texte}&nbsp;»
                </li>
              ))}
              {taches.length > 7 && <li className="text-ui-xs text-texte-tertiaire">et {taches.length - 7} de plus</li>}
              {!taches.length && <li className="klyra-respire text-ui-s text-texte-tertiaire">Tes tâches arriveront ici.</li>}
            </ul>
          )}
          {!remplacee && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-fond-page/40 opacity-0 transition-opacity duration-[220ms] ease-sortie group-hover/table:pointer-events-auto group-hover/table:opacity-100">
              <Bouton variant="sombre" iconeGauche={<Icon name="expand" size={16} />} onClick={() => ouvrir()}>
                Ouvrir l’atelier en grand
              </Bouton>
            </div>
          )}
        </div>

        {bilan.nee && <QuiSenCharge etat={etat} equipe={equipe} choisi={null} confier={etat.courante ? onEnvoyer : null} />}

        {!remplacee && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-bordure-subtile bg-fond-surface-grise/60 px-5 py-4">
            {bilan.nee ? (
              <EtEnsuite nes={nes} />
            ) : (
              <>
                <span className="text-ui-xs text-texte-secondaire">{bilanTexte}</span>
                {etape === "equipe" ? (
                  <span className="flex items-center gap-2">
                    <Bouton variant="blanc" iconeGauche={<Icon name="expand" size={16} />} onClick={() => ouvrir()}>
                      Ouvrir l’atelier
                    </Bouton>
                    <BoutonPrincipal onClick={() => void equipe.creer()} disabled={!equipe.modifiable || !!bilan.manques.length || !aCreer.length}>
                      {creation.type === "creation" ? `Création… ${creation.faits}/${creation.total}` : nes.length ? `Créer les ${aCreer.length} autres` : aCreer.length > 1 ? "Créer l’équipe" : "Créer l’agent"}
                    </BoutonPrincipal>
                  </span>
                ) : (
                  <BoutonPrincipal onClick={() => ouvrir()}>Ouvrir l’atelier</BoutonPrincipal>
                )}
              </>
            )}
          </footer>
        )}
      </section>
      <p role={creation.type === "erreur" ? "alert" : undefined} className={cn("m-0 text-ui-xs [overflow-wrap:anywhere]", creation.type === "erreur" ? "text-texte-erreur" : "text-texte-tertiaire")}>
        {note}
      </p>
    </div>
  );
}

/* ─── Et ensuite ───────────────────────────────────────────────── */

function EtEnsuite({ nes }: { nes: Membre[] }) {
  const router = useRouter();
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 text-ui-xs text-texte-secondaire">
        <span aria-hidden="true" className="flex -space-x-1.5">
          {nes.slice(0, 5).map((x) => (
            <AgentRond key={x.idCree} roleId={x.idCree!} taille={22} />
          ))}
        </span>
        Dans ton équipe : {nes.map(nomAffiche).join(", ")}
      </span>
      <Bouton variant="blanc" iconeGauche={<Icon name="users-profiles-01" size={16} />} onClick={() => router.push("/equipe")}>
        Voir Mes agents
      </Bouton>
    </>
  );
}

/* ─── La barre en haut du fil, quand le module sort de l'écran ─── */

export function BarreEquipe({ zone, equipes, chatId }: { zone: RefObject<HTMLDivElement | null>; equipes: Map<string, EtatEquipe>; chatId: string }) {
  const courante = [...equipes.entries()].find(([, e]) => e.dernier && e.courante && !Object.keys(e.crees).length) ?? null;
  const etapeId = courante?.[0] ?? null;
  // Le module observé hors de l'écran (par son étape : un nouvel appel repart visible).
  const [horsVue, setHorsVue] = useState<string | null>(null);

  useEffect(() => {
    const racine = zone.current;
    if (!racine || !etapeId) return;
    const carte = racine.querySelector(`[data-carte-equipe="${CSS.escape(etapeId)}"]`);
    if (!carte) return;
    const observateur = new IntersectionObserver(([e]) => setHorsVue(e.isIntersecting ? null : etapeId), { root: racine, threshold: 0.12 });
    observateur.observe(carte);
    return () => observateur.disconnect();
  }, [zone, etapeId]);

  if (!courante || horsVue !== etapeId) return null;
  const [, etat] = courante;
  const b = etat.apres;
  const etape = etapeEquipe(b);
  const touches = membresTouches(etat);
  const nom = (cle: string) => {
    const m = b.membres.find((x) => x.cle === cle);
    return m ? nomPropre(m.agent.nom) || m.agent.role || cle : cle;
  };
  return (
    <div data-barre-equipe className="klyra-arrivee absolute inset-x-0 top-0 z-10 border-b border-bordure-subtile bg-fond-surface/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[880px] min-w-0 items-center gap-3 px-7 py-2">
        <span aria-hidden="true" className="flex -space-x-1.5">
          {b.membres.slice(0, 4).map((m) => (
            <RondApercu key={m.cle} agentId={m.cle} nom={nom(m.cle)} teinte={etat.teintes[m.cle] ?? teinteNouvelAgent(m.cle)} taille={24} />
          ))}
          {!b.membres.length && <Icon name="layers-01" size={18} className="text-icone-secondaire" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui-s font-semibold text-texte-principal">
            {b.nom || "Ton équipe"} <span className="text-ui-2xs font-normal text-texte-tertiaire">{NOM_ETAPE[etape]}</span>
          </span>
          <span className="truncate text-ui-xs text-texte-secondaire">
            {etape === "equipe"
              ? `${b.membres.length} agent${b.membres.length > 1 ? "s" : ""}${touches.length && etat.avant.membres.length ? ` · ${touches.map(nom).join(", ")} vient d’être mis à jour` : ""}`
              : `${(b.taches ?? []).length} tâche${(b.taches ?? []).length > 1 ? "s" : ""} sur la table`}
          </span>
        </span>
        <Bouton variant="sombre" taille="mini" iconeGauche={<Icon name="expand" size={14} />} onClick={() => ouvrirAtelierEquipe(chatId)}>
          Ouvrir l’atelier
        </Bouton>
      </div>
    </div>
  );
}
