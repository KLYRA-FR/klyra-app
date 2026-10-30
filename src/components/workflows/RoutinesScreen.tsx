"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Onglets } from "@/components/ui/Onglets";
import { RoutinesVue } from "@/components/routines/RoutinesVue";
import { WorkflowsScreen } from "./WorkflowsScreen";

type Onglet = "routines" | "workflows";

/** L'affectation d'une routine à un agent n'est pas un workflow. */
export function RoutinesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const vue = useSearchParams().get("vue");
  const onglet: Onglet = vue === "workflows" ? "workflows" : "routines";
  const garde = useRef<null | (() => Promise<boolean>)>(null);
  const garderSortie = useCallback((fn: () => Promise<boolean>) => {
    garde.current = fn;
    return () => { if (garde.current === fn) garde.current = null; };
  }, []);
  useEffect(() => {
    if (vue === "calendrier") router.replace(`${pathname}?vue=routines`);
  }, [vue, pathname, router]);
  const onglets = <Onglets<Onglet>
    libelle="Automatisations"
    valeur={onglet}
    onChange={async (o) => {
      if (garde.current && !(await garde.current())) return;
      router.replace(`${pathname}?vue=${o}`);
    }}
    onglets={[
      { id: "routines", label: "Routines", icone: <Icon name="calendar-01" size={16} /> },
      { id: "workflows", label: "Workflows", icone: <Icon name="lightning-01" size={16} /> },
    ]}
  />;
  return onglet === "workflows" ? <WorkflowsScreen entete={onglets} /> : <RoutinesVue onglets={onglets} garderSortie={garderSortie} />;
}
