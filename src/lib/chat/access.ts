import { getSession } from "auth/server";
import { chatRepository } from "lib/db/repository";

export async function requireAuthenticatedChatUserId() {
  const session = await getSession();
  const userId = session?.user?.id;

  if (!userId) {
    throw new Error("Unauthorized");
  }

  return userId;
}

export async function requireThreadAccess(threadId: string) {
  const userId = await requireAuthenticatedChatUserId();
  const hasAccess = await chatRepository.checkAccess(threadId, userId);

  if (!hasAccess) {
    throw new Error("Unauthorized");
  }

  return userId;
}

export async function requireMessageAccess(messageId: string) {
  const userId = await requireAuthenticatedChatUserId();
  const threadId = await chatRepository.selectThreadIdByMessageId(messageId);

  if (!threadId) {
    throw new Error("Message not found");
  }

  const hasAccess = await chatRepository.checkAccess(threadId, userId);
  if (!hasAccess) {
    throw new Error("Unauthorized");
  }

  return {
    threadId,
    userId,
  };
}
