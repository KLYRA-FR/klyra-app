import type { Metadata } from "next";
import { Suspense } from "react";
import { TicketsScreen } from "@/components/tickets/TicketsScreen";

export const metadata: Metadata = { title: "Tickets — KLYRA" };

/** `/tickets` : les fils des agents en tableau, et tes rappels dans « À moi ». */
export default function TicketsPage() {
  return (
    <Suspense>
      <TicketsScreen />
    </Suspense>
  );
}
