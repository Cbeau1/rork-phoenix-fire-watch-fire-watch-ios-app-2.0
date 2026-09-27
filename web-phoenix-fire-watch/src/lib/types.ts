export type PatrolStatus = "clear" | "follow-up" | "incident";

/** Local-only marker for records saved on this device that haven't reached the server yet. */
export type SyncState = "pending" | "failed";

export interface Property {
  id: string;
  name: string;
  address: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  /** Minutes between required patrols; set by an org admin only. */
  patrolIntervalMinutes: number;
  createdAt: string;
  syncState?: SyncState;
}

/** Patrol interval used until an org admin sets one for the property. */
export const DEFAULT_PATROL_INTERVAL = 60;

export interface Patrol {
  id: string;
  propertyId: string;
  dateTime: string;
  officerName: string;
  areas: string[];
  status: PatrolStatus;
  notes: string;
  /** Storage object paths in the patrol-photos bucket. */
  photos: string[];
  loggedBy: string | null;
  createdAt: string;
  syncState?: SyncState;
}

export interface WatchNote {
  id: string;
  content: string;
  author: string;
  authorId: string | null;
  createdAt: string;
  syncState?: SyncState;
}

export type Role = "admin" | "officer";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string;
  orgName: string;
  /** Organization data-retention period in days; null keeps records until deleted. */
  retentionDays: number | null;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Org Admin",
  officer: "Fire Watch Officer",
};

export type PropertyInput = Omit<Property, "id" | "createdAt" | "syncState" | "patrolIntervalMinutes">;
/** Patrol payload from the form; `photos` are compressed JPEG data URLs to upload. */
export type PatrolInput = Omit<Patrol, "id" | "createdAt" | "loggedBy" | "syncState">;

export const STATUS_META: Record<PatrolStatus, { label: string; color: string; text: string; bg: string; ring: string }> = {
  clear: {
    label: "Clear",
    color: "#22C55E",
    text: "text-status-clear",
    bg: "bg-status-clear/10",
    ring: "ring-status-clear/30",
  },
  "follow-up": {
    label: "Follow-up",
    color: "#F5A524",
    text: "text-status-follow",
    bg: "bg-status-follow/10",
    ring: "ring-status-follow/30",
  },
  incident: {
    label: "Incident",
    color: "#EF4444",
    text: "text-status-incident",
    bg: "bg-status-incident/10",
    ring: "ring-status-incident/30",
  },
};
