"use client";

import Form from "next/form";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminUserListItem } from "app-types/admin";

import { deleteUsersAction } from "@/app/api/user/actions";
import { DeleteUsersActionState } from "@/app/api/user/validations";
import { Button } from "ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/alert-dialog";

import { serializeSelectedUserIds } from "./users-table.utils";

interface UsersBulkDeleteDialogProps {
  selectedUsers: Pick<AdminUserListItem, "id" | "name">[];
  onDeleted: () => Promise<void> | void;
}

export function UsersBulkDeleteDialog({
  selectedUsers,
  onDeleted,
}: UsersBulkDeleteDialogProps) {
  const t = useTranslations("Admin.Users");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [_, deleteFormAction, isPending] = useActionState<
    DeleteUsersActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await deleteUsersAction({}, formData);

    if (result?.success) {
      await onDeleted();
      toast.success(
        result.message ||
          t("usersDeletedSuccessfully", { count: selectedUsers.length }),
      );
      setOpen(false);
      return result;
    }

    if ((result?.deletedCount || 0) > 0) {
      await onDeleted();
      setOpen(false);
    }

    toast.error(result?.message || t("failedToDeleteSelectedUsers"));
    return result;
  }, {});

  if (selectedUsers.length === 0) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          data-testid="users-bulk-delete-button"
        >
          <Trash2 className="h-4 w-4" />
          {t("deleteSelected", { count: selectedUsers.length })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            {t("deleteSelectedTitle", { count: selectedUsers.length })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                {t("deleteSelectedDescription", {
                  count: selectedUsers.length,
                })}
              </p>

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="mb-2 text-sm font-medium text-destructive">
                  {t("selectedUsers")}
                </p>
                <ul className="space-y-1 text-sm text-destructive/90">
                  {selectedUsers.slice(0, 5).map((user) => (
                    <li key={user.id}>• {user.name}</li>
                  ))}
                  {selectedUsers.length > 5 && (
                    <li>
                      •{" "}
                      {t("moreSelectedUsers", {
                        count: selectedUsers.length - 5,
                      })}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <Form action={deleteFormAction}>
            <input
              type="hidden"
              name="userIds"
              value={serializeSelectedUserIds(
                selectedUsers.map((user) => user.id),
              )}
            />
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isPending
                ? tCommon("deleting")
                : t("confirmDeleteSelected", { count: selectedUsers.length })}
            </Button>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
