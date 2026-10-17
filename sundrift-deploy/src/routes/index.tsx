import { createFileRoute } from "@tanstack/react-router";
import { DriveGame } from "@/components/DriveGame";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <DriveGame />;
}
