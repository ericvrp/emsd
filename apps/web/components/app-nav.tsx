import { Activity } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";

export function AppNav() {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Primary">
      <Button asChild variant="default">
        <Link href="/" prefetch scroll={false}>
          <Activity size={14} />
          Live
        </Link>
      </Button>
    </nav>
  );
}
