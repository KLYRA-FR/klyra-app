"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Agenda } from "./Agenda";
import { Rappels } from "./Rappels";

/** Planning des agents : leurs routines dans le calendrier, et juste en dessous les rappels. Les routines se règlent sur leur page. */
export function PlanningScreen() {
  const router = useRouter();
  const vue = useSearchParams().get("vue");
  // Les anciens liens vers les routines (« automatisations ») mènent à leur page.
  useEffect(() => {
    if (vue === "routines" || vue === "automatisations") router.replace("/routines?vue=routines");
  }, [vue, router]);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="@container flex min-w-0 flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Planning</span> <span className="font-normal">des agents</span>
          </h1>
        </header>
        <Agenda />
        <Rappels />
      </div>
    </div>
  );
}
