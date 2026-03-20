"use client";

import { TeamSchema, TeamSummary } from "app-types/team";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Input } from "ui/input";
import { Textarea } from "ui/textarea";

interface TeamCreateDialogProps {
  onCreated?: (team: TeamSummary) => void;
  triggerLabel?: string;
}

export function TeamCreateDialog({
  onCreated,
  triggerLabel = "Create Team",
}: TeamCreateDialogProps) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const parsed = TeamSchema.safeParse({
      name,
      description: description || undefined,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Invalid team data");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create team");
      }

      onCreated?.(payload);
      await mutate("/api/teams");
      setName("");
      setDescription("");
      setOpen(false);
      toast.success("Team created");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create team",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>
            Teams let you share agents, MCP servers, and skills without changing
            built-in roles.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Team name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Creating..." : "Create Team"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
