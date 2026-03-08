export const PILOT_SCROLLBAR_IDLE_MS = 900;

export function shouldKeepPilotScrollbarVisible(
  lastScrollAt: number | null,
  now = Date.now(),
  idleMs = PILOT_SCROLLBAR_IDLE_MS,
) {
  if (lastScrollAt === null) {
    return false;
  }

  return now - lastScrollAt < idleMs;
}
