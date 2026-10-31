import Link from "next/link";
import { AgentRond } from "@/components/roles/AgentRond";
import { cn } from "@/lib/cn";
import type { AgentRoutine } from "./ColonneAgents";

export function CarteAgent({ agent }: { agent: AgentRoutine }) {
  return <section aria-label={`Agent ${agent.name}`} className={cn("relative flex w-[280px] flex-col rounded-lg border bg-fond-surface shadow-ombre-sm", agent.actif ? "border-bordure-subtile" : "border-bordure-forte bg-fond-surface-douce")}>
    <span aria-hidden="true" className="absolute top-[22px] -left-[7px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-fond-surface bg-texte-tertiaire" />
    <header className="flex h-11 items-center gap-2 px-3"><AgentRond roleId={agent.id} taille={22} className={agent.actif ? undefined : "opacity-60"} /><h2 className="m-0 min-w-0 flex-1 truncate text-ui-s font-semibold text-texte-principal">{agent.name}</h2><span className="rounded-sm bg-fond-surface-grise px-1.5 text-ui-2xs text-texte-secondaire">{agent.tag}</span></header>
    <div className="flex flex-col gap-2.5 px-3 pb-3 text-ui-xs text-texte-secondaire"><p className="m-0 line-clamp-2">{agent.title}</p><p className="m-0">{agent.actif ? "Actif" : agent.connu ? "Désactivé : ses routines ne partent pas." : "Absent de cet ordinateur : ses routines ne partent pas."}</p><Link className="text-texte-principal underline" href={`/chat?id=${encodeURIComponent(`dm-${agent.id}`)}`}>Ouvrir la conversation</Link>{!agent.actif && <Link className="text-texte-principal underline" href="/equipe">Ouvrir l’équipe</Link>}</div>
  </section>;
}
