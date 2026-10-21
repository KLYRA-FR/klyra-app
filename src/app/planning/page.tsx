import type { Metadata } from "next";
import { PlanningScreen } from "@/components/planning/PlanningScreen";

export const metadata: Metadata = { title: "Planning — KLYRA" };

export default function PlanningPage() {
  return <PlanningScreen />;
}
