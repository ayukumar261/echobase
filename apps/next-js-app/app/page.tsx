"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { LogOut } from "lucide-react";
import { useUser, USER_KEY } from "@/hooks/useUser";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { RepositorySelect } from "@/components/RepositorySelect";

export default function Home() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { isLoading, isLoggedIn } = useUser();
  const [signingOut, setSigningOut] = useState(false);

  // The OAuth callback redirects to `/?login=ok` — refresh the cached user
  // and strip the query param so a back-nav doesn't re-trigger this.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("login") === "ok") {
      url.searchParams.delete("login");
      window.history.replaceState({}, "", url.toString());
      mutate(USER_KEY);
    }
  }, [mutate]);

  // Redirect logged-out visitors to /connect.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/connect");
    }
  }, [isLoading, isLoggedIn, router]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await api.post("/api/user/logout");
    } finally {
      await mutate(USER_KEY);
      setSigningOut(false);
    }
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <nav className="flex items-center justify-between border-b border-foreground/5 px-4 py-3">
      <RepositorySelect />
      <Button
        variant="outline"
        disabled={signingOut}
        onClick={handleSignOut}
      >
        <LogOut />
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </nav>
  );
}
