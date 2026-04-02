export function buildRealtimeResponseKey(input: {
  responseId: string;
  itemId: string;
}) {
  return `${input.responseId}:${input.itemId}`;
}

export function shouldHandleRealtimeTtsCompletion(input: {
  eventKey: string;
  activeKey: string | null;
  lastHandledKey: string | null;
}) {
  if (input.lastHandledKey === input.eventKey) {
    return false;
  }

  if (input.activeKey && input.activeKey !== input.eventKey) {
    return false;
  }

  return true;
}
