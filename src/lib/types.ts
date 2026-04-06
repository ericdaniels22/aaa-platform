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

export interface JobEmail {
  id: string;
  job_id: string;
  gmail_id: string;
  thread_id: string | null;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  snippet: string | null;
  direction: "inbound" | "outbound";
  has_attachments: boolean;
  matched_by: "contact" | "claim_number" | "address" | "job_id" | "manual";
  received_at: string;
  created_at: string;
}
