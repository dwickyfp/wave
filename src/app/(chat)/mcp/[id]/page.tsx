import { MCPPublishDetailPage } from "@/components/mcp-detail-page";
import { getSession } from "auth/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: Props) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;

  return <MCPPublishDetailPage id={id} user={session.user} />;
}
