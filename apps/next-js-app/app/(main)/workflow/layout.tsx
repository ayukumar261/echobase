"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { LogOut } from "lucide-react";
import { useUser, USER_KEY } from "@/hooks/useUser";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { RepositorySelect } from "./components/RepositorySelect";

export default function WorkflowLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { isLoading, isLoggedIn } = useUser();
  const [signingOut, setSigningOut] = useState(false);

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
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-white"
        style={{
          backgroundImage:
            "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <nav className="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-foreground/5 bg-white px-4 py-3">
        <RepositorySelect />
        <Button variant="outline" disabled={signingOut} onClick={handleSignOut}>
          <LogOut />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </nav>
      <main className="flex min-h-screen items-center justify-center px-4">
        {children}
      </main>
    </>
  );
}
