"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { useUser, USER_KEY } from "@/hooks/useUser";
import { Spinner } from "@/components/ui/spinner";

export default function Home() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { isLoading, isLoggedIn } = useUser();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("login") === "ok") {
      url.searchParams.delete("login");
      window.history.replaceState({}, "", url.toString());
      mutate(USER_KEY);
    }
  }, [mutate]);

  useEffect(() => {
    if (isLoading) return;
    router.replace(isLoggedIn ? "/workflow" : "/connect");
  }, [isLoading, isLoggedIn, router]);

  return (
    <section className="flex min-h-screen items-center justify-center">
      <Spinner className="size-5" />
    </section>
  );
}
