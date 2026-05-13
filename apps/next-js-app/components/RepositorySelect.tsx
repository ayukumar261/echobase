"use client";

import { useRepositories, type Repository } from "@/hooks/useRepositories";
import { useSelectedRepository } from "@/hooks/useSelectedRepository";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

export function RepositorySelect() {
  const { repositories, isLoading, error } = useRepositories();
  const { selectedRepository, setSelectedRepository } = useSelectedRepository();

  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger
          aria-label="Repository"
          className="text-muted-foreground"
        >
          <span className="flex items-center gap-2">
            <Spinner className="size-4 text-muted-foreground" />
            <span>Loading</span>
          </span>
        </SelectTrigger>
      </Select>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load repositories.
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No repositories found.
      </div>
    );
  }

  return (
    <Select
      value={
        selectedRepository?.id != null
          ? String(selectedRepository.id)
          : undefined
      }
      onValueChange={(value) => {
        const next = repositories.find((r) => String(r.id) === value) ?? null;
        setSelectedRepository(next);
      }}
    >
      <SelectTrigger aria-label="Repository">
        <SelectValue placeholder="Select a repository…" />
      </SelectTrigger>
      <SelectContent>
        {repositories.map((repository: Repository) => (
          <SelectItem key={repository.id} value={String(repository.id)}>
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={repository.owner.avatar_url}
                alt=""
                className="size-4 rounded-full ring-1 ring-foreground/10"
              />
              <span className="truncate">{repository.full_name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
