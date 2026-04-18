"use client";

import dynamic from "next/dynamic";

const EmailInbox = dynamic(() => import("@/components/email-inbox"), {
  ssr: false,
});

export default function EmailPage() {
  return <EmailInbox />;
}
