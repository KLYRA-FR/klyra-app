import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeScreen } from "@/components/home/HomeScreen";

export const metadata: Metadata = { title: "Accueil — KLYRA" };

/** `/?a=dev` présélectionne un agent dans le composeur. */
export default function HomePage() {
  return (
    <Suspense>
      <HomeScreen />
    </Suspense>
  );
}
