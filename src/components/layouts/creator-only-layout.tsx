import { getSession } from "auth/server";
import { isCreatorRole } from "lib/auth/types";
import { redirect } from "next/navigation";

export async function CreatorOnlyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/sign-in");
  }

  if (!isCreatorRole(session.user.role)) {
    redirect("/");
  }

  return children;
}
