import JobDetail from "@/components/job-detail";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <JobDetail jobId={id} />;
}
