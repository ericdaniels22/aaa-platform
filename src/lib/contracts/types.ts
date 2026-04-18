export type MergeFieldCategory =
  | "Customer"
  | "Property"
  | "Job"
  | "Insurance"
  | "Company";

export interface MergeFieldDefinition {
  name: string;
  label: string;
  category: MergeFieldCategory;
  description?: string;
}

export interface ContractTemplate {
  id: string;
  name: string;
  description: string | null;
  content: unknown;
  content_html: string;
  default_signer_count: 1 | 2;
  signer_role_label: string;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  default_signer_count: 1 | 2;
  is_active: boolean;
  updated_at: string;
}

export interface ResolvedPreviewResponse {
  html: string;
  unresolvedFields: string[];
}
