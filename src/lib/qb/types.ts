// DB row shapes + QB payload types shared across the sync lib.

export type QbMappingType = "damage_type" | "payment_method" | "expense_category";

export type QbSyncEntityType = "customer" | "sub_customer" | "invoice" | "payment";
export type QbSyncAction = "create" | "update" | "delete";
export type QbSyncStatus = "queued" | "synced" | "failed" | "skipped_dry_run";

export interface QbConnectionRow {
  id: string;
  realm_id: string;
  company_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  sync_start_date: string | null;
  dry_run_mode: boolean;
  is_active: boolean;
  setup_completed_at: string | null;
  last_sync_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QbMappingRow {
  id: string;
  type: QbMappingType;
  platform_value: string;
  qb_entity_id: string;
  qb_entity_name: string;
  created_at: string;
  updated_at: string;
}

export interface QbSyncLogRow {
  id: string;
  entity_type: QbSyncEntityType;
  entity_id: string;
  action: QbSyncAction;
  status: QbSyncStatus;
  payload: unknown;
  qb_entity_id: string | null;
  error_message: string | null;
  error_code: string | null;
  retry_count: number;
  next_retry_at: string | null;
  synced_at: string | null;
  depends_on_log_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- QB payload shapes (subset we actually send) ----------

export interface QbAddress {
  Line1?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
}

export interface QbCustomerPayload {
  Id?: string;
  SyncToken?: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
  BillAddr?: QbAddress;
  Notes?: string;
  ParentRef?: { value: string };
  Job?: boolean;
  ClassRef?: { value: string; name?: string };
}

export interface QbClass {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  Active?: boolean;
}

export interface QbAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  Active?: boolean;
}
