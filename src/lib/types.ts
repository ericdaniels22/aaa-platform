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
  status: string;
  urgency: "emergency" | "urgent" | "scheduled";
  damage_type: string;
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
  category: "general" | "promotions" | "social" | "purchases" | null;
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

export interface JobStatus {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DamageType {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormFieldOption {
  value: string;
  label: string;
  color?: string;
}

export interface FormField {
  id: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "pill" | "checkbox" | "phone" | "email";
  label: string;
  placeholder?: string;
  required?: boolean;
  is_default?: boolean;
  visible?: boolean;
  maps_to?: string;
  default_value?: string;
  help_text?: string;
  options?: FormFieldOption[];
  options_source?: string;
  show_when?: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  is_default?: boolean;
  visible?: boolean;
  fields: FormField[];
}

export interface FormConfig {
  sections: FormSection[];
}

export interface JobCustomField {
  id: string;
  job_id: string;
  field_key: string;
  field_value: string | null;
  created_at: string;
}

// Jarvis
export interface JarvisMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface JarvisConversation {
  id: string;
  job_id: string | null;
  user_id: string | null;
  title: string | null;
  context_type: "general" | "job" | "rnd" | "marketing" | "field-ops";
  messages: JarvisMessage[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JarvisAlert {
  id: string;
  job_id: string | null;
  user_id: string | null;
  message: string;
  priority: "low" | "medium" | "high";
  status: "active" | "resolved";
  due_date: string;
  created_at: string;
  resolved_at: string | null;
}

// Marketing
export interface MarketingAsset {
  id: string;
  file_name: string;
  storage_path: string;
  description: string | null;
  tags: string[];
  uploaded_by: string | null;
  created_at: string;
}

export interface MarketingDraft {
  id: string;
  platform: "instagram" | "facebook" | "linkedin" | "gbp";
  caption: string;
  hashtags: string | null;
  image_id: string | null;
  image_brief: string | null;
  status: "draft" | "ready" | "posted";
  conversation_id: string | null;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  image?: MarketingAsset;
}

// Knowledge Base (RAG)
export interface KnowledgeDocument {
  id: string;
  name: string;
  file_name: string;
  standard_id: string;
  description: string | null;
  chunk_count: number;
  status: "processing" | "ready" | "error";
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  content: string;
  section_number: string | null;
  section_title: string | null;
  page_number: number | null;
  chunk_index: number;
  token_count: number;
  created_at: string;
  // Joined / computed
  similarity?: number;
  document?: KnowledgeDocument;
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
