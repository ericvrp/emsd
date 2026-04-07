"use client";

import { signOut } from "next-auth/react";
import { Button } from "./ui/button";

export function SignOutButton() {
  return (
    <Button
      onClick={() => signOut({ callbackUrl: "/login" })}
      type="button"
      variant="ghost"
    >
      Sign out
    </Button>
  );
}
