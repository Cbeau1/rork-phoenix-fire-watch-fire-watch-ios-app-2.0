import { THEME } from "@/lib/theme";

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
  /** Area officers must be inside to log a patrol; set by an org admin only. */
  geofence: Geofence;
  /** Storage path of the site photo in the patrol-photos bucket, if one was added. */
  imagePath: string | null;
  /** Assigned fire inspector from the directory. */
  inspectorId?: string | null;
  /** Fire marshal / inspector contact used on agreements and reports. */
  fireMarshalName?: string;
  fireMarshalPhone?: string;
  fireMarshalEmail?: string;
  createdAt: string;
  syncState?: SyncState;
}

/** Circular geofence around a property. Patrols outside it are rejected when enabled. */
export interface Geofence {
  enabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
}

export const NO_GEOFENCE: Geofence = { enabled: false, lat: null, lng: null, radiusM: null };
export const GEOFENCE_MIN_M = 25;
export const GEOFENCE_MAX_M = 5000;
export const GEOFENCE_DEFAULT_M = 150;

/** Where the device was when a patrol was logged. */
export interface PatrolLocation {
  lat: number;
  lng: number;
  accuracyM: number;
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
  /** Device location when logged (null for older logs or when no geofence applied). */
  location?: PatrolLocation | null;
  /** Distance from the geofence center in meters, computed by the server. */
  geofenceDistanceM?: number | null;
  /** Set when an admin corrected the report after submission. */
  editedAt?: string | null;
  editedByName?: string;
  syncState?: SyncState;
}

/** Fields an admin may correct on a submitted patrol report. */
export interface PatrolEditInput {
  id: string;
  dateTime: string;
  officerName: string;
  areas: string[];
  status: PatrolStatus;
  notes: string;
  reason: string;
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
  /** When the New Employee Field Guide was acknowledged (ISO string); null/undefined = not yet. */
  guideAcknowledgedAt?: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Org Admin",
  officer: "Fire Watch Officer",
};

export type PropertyInput = Omit<Property, "id" | "createdAt" | "syncState" | "patrolIntervalMinutes" | "geofence" | "imagePath">;
/** Patrol payload from the form; `photos` are compressed JPEG data URLs to upload. */
export type PatrolInput = Omit<Patrol, "id" | "createdAt" | "loggedBy" | "syncState" | "geofenceDistanceM">;

export const STATUS_META: Record<PatrolStatus, { label: string; color: string; text: string; bg: string; ring: string }> = {
  clear: {
    label: "Clear",
    color: THEME.success,
    text: "text-status-clear",
    bg: "bg-status-clear/10",
    ring: "ring-status-clear/30",
  },
  "follow-up": {
    label: "Follow-up",
    color: THEME.warning,
    text: "text-status-follow",
    bg: "bg-status-follow/10",
    ring: "ring-status-follow/30",
  },
  incident: {
    label: "Incident",
    color: THEME.danger,
    text: "text-status-incident-ink",
    bg: "bg-status-incident/10",
    ring: "ring-status-incident/30",
  },
};
