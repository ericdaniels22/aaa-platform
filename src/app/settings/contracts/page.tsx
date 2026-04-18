"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Send, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import EmailTemplateField from "@/components/contracts/email-template-field";
import type { ContractEmailSettings, ContractEmailProvider } from "@/lib/contracts/types";

interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
}

export default function ContractEmailSettingsPage() {
  const [settings, setSettings] = useState<ContractEmailSettings | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [settingsRes, accountsRes] = await Promise.all([
      fetch("/api/settings/contract-email"),
      fetch("/api/email/accounts"),
    ]);
    if (settingsRes.ok) {
      setSettings((await settingsRes.json()) as ContractEmailSettings);
    } else {
      toast.error("Failed to load contract email settings");
    }
    if (accountsRes.ok) {
      const data = (await accountsRes.json()) as EmailAccount[];
      setAccounts(data);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function patch<K extends keyof ContractEmailSettings>(key: K, value: ContractEmailSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/contract-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      setDirty(false);
      toast.success("Contract email settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const setupIncomplete = !settings.send_from_email || !settings.send_from_name;
  const offsetsText = settings.reminder_day_offsets.join(", ");

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Send size={18} className="text-[var(--brand-primary)]" />
            Contract Email Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Controls how contract signing links and confirmation emails are delivered.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save
        </button>
      </div>

      {setupIncomplete && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Finish contract email setup before sending</div>
            <div className="text-xs text-amber-300/80 mt-0.5">
              A send-from email and display name are required. Sends will fail until both are filled in below.
            </div>
          </div>
        </div>
      )}

      {/* Provider + addresses */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Send from</h3>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground mb-1">Delivery provider</legend>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
            <input
              type="radio"
              name="provider"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={settings.provider === "resend"}
              onChange={() => patch("provider", "resend" as ContractEmailProvider)}
            />
            <div>
              <div className="text-sm text-foreground font-medium">Resend <span className="text-xs text-muted-foreground font-normal">(recommended)</span></div>
              <div className="text-xs text-muted-foreground">Dedicated transactional email. Requires RESEND_API_KEY and a verified sending domain.</div>
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
            <input
              type="radio"
              name="provider"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={settings.provider === "email_account"}
              onChange={() => patch("provider", "email_account" as ContractEmailProvider)}
            />
            <div className="flex-1">
              <div className="text-sm text-foreground font-medium">Use a connected email account</div>
              <div className="text-xs text-muted-foreground">Sends via SMTP through one of the Build 12 email accounts.</div>
              {settings.provider === "email_account" && (
                <select
                  value={settings.email_account_id ?? ""}
                  onChange={(e) => patch("email_account_id", e.target.value || null)}
                  className="mt-2 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                >
                  <option value="">— Select account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({a.email_address})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </label>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            label="Send-from email"
            value={settings.send_from_email}
            onChange={(v) => patch("send_from_email", v)}
            placeholder="contracts@yourcompany.com"
            required
          />
          <TextInput
            label="Display name"
            value={settings.send_from_name}
            onChange={(v) => patch("send_from_name", v)}
            placeholder="Your Company"
            required
          />
          <TextInput
            label="Reply-to email (optional)"
            value={settings.reply_to_email ?? ""}
            onChange={(v) => patch("reply_to_email", v || null)}
            placeholder="reply@yourcompany.com"
          />
          <NumberInput
            label="Default link expiry (days)"
            value={settings.default_link_expiry_days}
            onChange={(v) => patch("default_link_expiry_days", Math.max(1, Math.min(30, v)))}
            min={1}
            max={30}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Reminder day offsets</label>
          <input
            type="text"
            value={offsetsText}
            onChange={(e) => {
              const parts = e.target.value
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p) => Number(p))
                .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
              patch("reminder_day_offsets", parts);
            }}
            className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            placeholder="1, 3"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Days after send to automatically trigger reminders. Auto-scheduling ships in Build 15c.
          </p>
        </div>
      </div>

      {/* Email templates */}
      <EmailTemplateField
        label="Signing request"
        description="First email to the signer with the magic link."
        subject={settings.signing_request_subject_template}
        body={settings.signing_request_body_template}
        onSubjectChange={(v) => patch("signing_request_subject_template", v)}
        onBodyChange={(v) => patch("signing_request_body_template", v)}
      />
      <EmailTemplateField
        label="Signed confirmation — customer"
        description="Sent to the customer after they sign, with the signed PDF attached."
        subject={settings.signed_confirmation_subject_template}
        body={settings.signed_confirmation_body_template}
        onSubjectChange={(v) => patch("signed_confirmation_subject_template", v)}
        onBodyChange={(v) => patch("signed_confirmation_body_template", v)}
      />
      <EmailTemplateField
        label="Signed confirmation — internal"
        description="Sent to your team after a contract is signed, also with the PDF."
        subject={settings.signed_confirmation_internal_subject_template}
        body={settings.signed_confirmation_internal_body_template}
        onSubjectChange={(v) => patch("signed_confirmation_internal_subject_template", v)}
        onBodyChange={(v) => patch("signed_confirmation_internal_body_template", v)}
      />
      <EmailTemplateField
        label="Reminder"
        description="Auto-reminder for unsigned contracts (scheduling lands in Build 15c)."
        subject={settings.reminder_subject_template}
        body={settings.reminder_body_template}
        onSubjectChange={(v) => patch("reminder_subject_template", v)}
        onBodyChange={(v) => patch("reminder_body_template", v)}
      />
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-amber-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}
