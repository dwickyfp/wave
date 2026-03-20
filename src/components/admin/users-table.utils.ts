export function filterSelectedUserIds(
  selectedUserIds: string[],
  availableUserIds: string[],
) {
  const availableUserIdSet = new Set(availableUserIds);

  return selectedUserIds.filter((userId) => availableUserIdSet.has(userId));
}

export function toggleSelectedUserId(
  selectedUserIds: string[],
  userId: string,
  checked: boolean,
) {
  const nextSelectedUserIds = new Set(selectedUserIds);

  if (checked) {
    nextSelectedUserIds.add(userId);
  } else {
    nextSelectedUserIds.delete(userId);
  }

  return Array.from(nextSelectedUserIds);
}

export function toggleAllSelectedUserIds(
  selectedUserIds: string[],
  userIds: string[],
  checked: boolean,
) {
  if (!checked) {
    const userIdSet = new Set(userIds);

    return selectedUserIds.filter((userId) => !userIdSet.has(userId));
  }

  const nextSelectedUserIds = new Set(selectedUserIds);

  for (const userId of userIds) {
    nextSelectedUserIds.add(userId);
  }

  return Array.from(nextSelectedUserIds);
}

export function serializeSelectedUserIds(selectedUserIds: string[]) {
  return JSON.stringify(selectedUserIds);
}
