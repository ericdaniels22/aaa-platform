import IntakeForm from "@/components/intake-form";

export default function IntakePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-foreground">
          New Customer Intake
        </h1>
        <p className="text-muted-foreground mt-1">
          Log a new customer call and create a job.
        </p>
      </div>
      <IntakeForm />
    </div>
  );
}
