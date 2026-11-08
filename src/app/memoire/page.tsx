import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoireScreen } from "@/components/memoire/MemoireScreen";
import "@/styles/memoire.css";

export const metadata: Metadata = { title: "Mémoire — KLYRA" };
export default function MemoirePage() {
  return <Suspense fallback={<p role="status">Chargement de la mémoire…</p>}><MemoireScreen /></Suspense>;
}
