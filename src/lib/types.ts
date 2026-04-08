export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  role: "homeowner" | "tenant" | "property_manager" | "adjuster" | "insurance";
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  job_number: string;
  contact_id: string;
  status: "new" | "in_progress" | "pending_invoice" | "completed" | "cancelled";
  urgency: "emergency" | "urgent" | "scheduled";
  damage_type: "water" | "fire" | "mold" | "storm" | "biohazard" | "contents" | "rebuild" | "other";
  damage_source: string | null;
  property_address: string;
  property_type: "single_family" | "multi_family" | "commercial" | "condo";
  property_sqft: number | null;
  property_stories: number | null;
  affected_areas: string | null;
  insurance_company: string | null;
  claim_number: string | null;
  adjuster_contact_id: string | null;
  access_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  contact?: Contact;
  adjuster?: Contact;
}

export interface JobActivity {
  id: string;
  job_id: string;
  activity_type: "note" | "photo" | "milestone" | "insurance" | "equipment";
  title: string;
  description: string | null;
  author: string;
  created_at: string;
}

export interface Invoice {
  id: string;
  job_id: string;
  invoice_number: string;
  total_amount: number;
  status: "draft" | "sent" | "partial" | "paid";
  issued_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  line_items?: LineItem[];
}

export interface LineItem {
  id: string;
  invoice_id: string;
  description: string;
  xactimate_code: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
}

export interface Payment {
  id: string;
  job_id: string;
  invoice_id: string | null;
  source: "insurance" | "homeowner" | "other";
  method: "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";
  amount: number;
  reference_number: string | null;
  payer_name: string | null;
  status: "received" | "pending" | "due";
  notes: string | null;
  received_date: string | null;
  created_at: string;
}

export interface Photo {
  id: string;
  job_id: string;
  storage_path: string;
  annotated_path: string | null;
  thumbnail_path: string | null;
  caption: string | null;
  taken_at: string | null;
  taken_by: string;
  media_type: "photo" | "video";
  file_size: number | null;
  width: number | null;
  height: number | null;
  before_after_pair_id: string | null;
  before_after_role: "before" | "after" | null;
  created_at: string;
  // Joined fields
  job?: Job;
  tags?: PhotoTag[];
}

export interface PhotoTag {
  id: string;
  name: string;
  color: string;
  created_by: string;
  created_at: string;
}

export interface PhotoTagAssignment {
  id: string;
  photo_id: string;
  tag_id: string;
  created_at: string;
  tag?: PhotoTag;
}

export interface PhotoAnnotation {
  id: string;
  photo_id: string;
  annotation_data: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PhotoReportTemplate {
  id: string;
  name: string;
  audience: "adjuster" | "customer" | "internal" | "general";
  sections: unknown[];
  cover_page: Record<string, unknown>;
  photos_per_page: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PhotoReport {
  id: string;
  job_id: string;
  template_id: string | null;
  title: string;
  report_date: string;
  sections: unknown[];
  pdf_path: string | null;
  status: "draft" | "generated";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface Email {
  id: string;
  account_id: string;
  job_id: string | null;
  message_id: string;
  thread_id: string | null;
  folder: "inbox" | "sent" | "drafts" | "trash" | "archive" | "spam" | "other";
  from_address: string;
  from_name: string | null;
  to_addresses: EmailAddress[];
  cc_addresses: EmailAddress[];
  bcc_addresses: EmailAddress[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  matched_by: "contact" | "claim_number" | "address" | "job_id" | "manual" | null;
  uid: number | null;
  received_at: string;
  created_at: string;
  // Joined fields
  job?: Job;
  account?: EmailAccount;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  id: string;
  email_id: string;
  filename: string;
  content_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  created_at: string;
}

export interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
  display_name: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  encrypted_password: string;
  signature: string | null;
  is_active: boolean;
  is_default: boolean;
  last_synced_at: string | null;
  last_synced_uid: number | null;
  created_at: string;
  updated_at: string;
}

export interface CompanySettings {
  company_name?: string;
  logo_path?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  license_number?: string;
}

export const EMAIL_PROVIDERS: Record<string, { label: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number }> = {
  hostinger: { label: "Hostinger", imap_host: "imap.hostinger.com", imap_port: 993, smtp_host: "smtp.hostinger.com", smtp_port: 465 },
  network_solutions: { label: "Network Solutions", imap_host: "mail.aaacontracting.com", imap_port: 993, smtp_host: "smtp.aaacontracting.com", smtp_port: 587 },
  gmail: { label: "Gmail", imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587 },
  outlook: { label: "Outlook / Microsoft 365", imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587 },
  custom: { label: "Custom", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465 },
};
