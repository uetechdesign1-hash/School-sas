export type TransportRole = "driver" | "parent";

export function transportDestination(role: unknown): string | null {
  return role === "driver" || role === "parent" ? `/${role}` : null;
}
