// Neighborhood Pods — matches harvesthub-backend/app/pods/schemas.py.

export type PodStatus = 'draft' | 'pending' | 'active' | 'paused' | 'expired' | 'dissolved';
export type DropKind = 'home' | 'neutral';
export type InviteStatus = 'sent' | 'accepted' | 'declined' | 'expired' | 'revoked';

export interface DropPointInput {
  drop_kind: DropKind;
  // A neutral location only: a home is always the host's saved address.
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  permission_attested?: boolean;
  access_notes?: string | null;
  shelter_note?: string | null;
}

export interface PodFarm {
  farmer_id: string;
  farm_name: string;
  pod_delivery_fee: number; // for the whole stop, split evenly across households
  share: number; // each household's share if every household orders
  savings: number; // that share against this farm's home delivery fee
}

export interface DropOptions {
  address_line: string;
  days: { weekday: number; label: string; farms: PodFarm[] }[];
}

export interface PodMember {
  id: string;
  first_name: string;
  is_host: boolean;
  is_me: boolean;
  leaving: boolean;
  needs_reapproval: boolean;
}

export interface PodInvite {
  id: string;
  code: string;
  label: string | null;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
}

export interface PodSummary {
  id: string;
  name: string;
  status: PodStatus;
  is_host: boolean;
  delivery_day: string;
  address_line: string | null;
  member_count: number;
  needs_reapproval: boolean;
  needs_drop_point: boolean;
}

export interface Pod extends PodSummary {
  delivery_weekday: number;
  drop_kind: DropKind | null;
  shelter_note: string | null;
  access_notes: string | null; // the host only
  min_members: number;
  size_cap: number;
  radius_miles: number;
  expires_at: string | null;
  grace_ends_at: string | null;
  reapprove_by: string | null;
  drop_locked_date: string | null; // everyone has ordered for this date, so it can't change
  drop_on_its_way: boolean; // a farm has set off for it, so it can't change now
  home_address_changed: boolean; // the host only: their saved address no longer matches a home drop point
  my_leave_at: string | null;
  my_leave_reason: string | null;
  members: PodMember[];
  invites: PodInvite[]; // the host only
  farms: PodFarm[];
}

export interface InvitePreview {
  status: InviteStatus;
  host_first_name: string;
  pod_name: string;
  pod_status: PodStatus;
  delivery_day: string;
  drop_line: string;
  shelter_note: string | null;
  member_count: number;
  size_cap: number;
  farms: PodFarm[];
  can_accept: boolean;
  blocker: string | null;
  needs_harvest_pass: boolean;
}

export const POD_STATUS_LABELS: Record<PodStatus, string> = {
  draft: 'Not started',
  pending: 'Waiting for neighbors',
  active: 'Active',
  paused: 'Paused',
  expired: 'Ended',
  dissolved: 'Ended',
};
