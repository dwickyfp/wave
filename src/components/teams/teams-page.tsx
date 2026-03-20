"use client";

import { TeamSummary } from "app-types/team";
import { canCreateTeam } from "lib/auth/client-permissions";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "lib/utils";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Badge } from "ui/badge";
import { TeamCreateDialog } from "./team-create-dialog";

interface TeamsPageProps {
  initialTeams: TeamSummary[];
  userRole?: string | null;
}

export function TeamsPage({ initialTeams, userRole }: TeamsPageProps) {
  const { data: teams = initialTeams, mutate } = useSWR<TeamSummary[]>(
    "/api/teams",
    fetcher,
    { fallbackData: initialTeams },
  );
  const canCreate = canCreateTeam(userRole);
  const [optimisticTeams, setOptimisticTeams] =
    useState<TeamSummary[]>(initialTeams);

  const currentTeams = teams ?? optimisticTeams;

  return (
    <div className="max-w-6xl mx-auto w-full p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold">Teams</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage team membership and shared resources.
          </p>
        </div>
        {canCreate ? (
          <TeamCreateDialog
            onCreated={(team) => {
              setOptimisticTeams((current) => [team, ...current]);
              mutate();
            }}
          />
        ) : null}
      </div>

      {!currentTeams.length ? (
        <Card>
          <CardHeader>
            <CardTitle>No teams yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {canCreate
              ? "Create your first team to start sharing resources."
              : "You have not joined any teams yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {currentTeams.map((team) => (
            <Link key={team.id} href={`/teams/${team.id}`}>
              <Card className="h-full hover:bg-input/40 transition-colors">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate">{team.name}</CardTitle>
                    <Badge variant="outline" className="capitalize shrink-0">
                      {team.role}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground line-clamp-3 min-h-10">
                    {team.description || "No description"}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {team.memberCount} members
                    </Badge>
                    <Badge variant="secondary">
                      {team.resourceCount} resources
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
