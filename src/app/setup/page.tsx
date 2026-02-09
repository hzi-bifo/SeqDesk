import { redirect } from "next/navigation";
import { checkDatabaseStatus } from "@/lib/db-status";
import { Database, Terminal, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SetupPage() {
  // Check if database is already configured
  const status = await checkDatabaseStatus();

  // If everything is set up, redirect to login
  if (status.exists && status.configured) {
    redirect("/login");
  }

  const steps = [
    {
      title: "Navigate to the v2 directory",
      command: "cd v2",
      description: "Make sure you're in the Next.js application directory",
    },
    {
      title: "Create the database and tables",
      command: "npx prisma db push",
      description: "This creates the SQLite database file and all required tables",
    },
    {
      title: "Seed initial data",
      command: "npx prisma db seed",
      description: "Creates default users, departments, and form configurations",
    },
    {
      title: "Start the application",
      command: "npm run dev",
      description: "Then refresh this page or go to /login",
    },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-4">
            <Database className="h-8 w-8 text-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Database Setup Required</h1>
          <p className="text-muted-foreground">
            Welcome to SeqDesk! The database needs to be initialized before you can use the application.
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Current Status
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <div className={`h-2 w-2 rounded-full ${status.exists ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Database file:</span>
              <span className={status.exists ? "text-emerald-600" : "text-red-600"}>
                {status.exists ? "Found" : "Not found"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className={`h-2 w-2 rounded-full ${status.configured ? "bg-emerald-500" : "bg-red-500"}`} />
              <span className="text-muted-foreground">Initial data:</span>
              <span className={status.configured ? "text-emerald-600" : "text-red-600"}>
                {status.configured ? "Configured" : "Not seeded"}
              </span>
            </div>
            {status.error && (
              <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {status.error}
              </div>
            )}
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Terminal className="h-5 w-5 text-foreground" />
            Setup Instructions
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Run the following commands in your terminal to set up the database:
          </p>

          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                {index < steps.length - 1 && (
                  <div className="absolute left-4 top-10 bottom-0 w-px bg-border" />
                )}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary text-foreground flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1 pb-4">
                    <h3 className="font-medium text-foreground mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground mb-2">{step.description}</p>
                    <div className="bg-foreground rounded-lg p-3 font-mono text-sm text-background flex items-center justify-between group">
                      <code>{step.command}</code>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-background text-xs"
                        title="Copy command"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Default Credentials */}
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Default Login Credentials
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            After seeding, you can log in with these accounts:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-secondary border border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Admin Account</div>
              <div className="space-y-1 text-sm">
                <div><span className="text-muted-foreground">Email:</span> <code className="text-foreground">admin@example.com</code></div>
                <div><span className="text-muted-foreground">Password:</span> <code className="text-foreground">admin</code></div>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-secondary border border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Researcher Account</div>
              <div className="space-y-1 text-sm">
                <div><span className="text-muted-foreground">Email:</span> <code className="text-foreground">user@example.com</code></div>
                <div><span className="text-muted-foreground">Password:</span> <code className="text-foreground">user</code></div>
              </div>
            </div>
          </div>
        </div>

        {/* Refresh Button */}
        <div className="text-center">
          <a
            href="/setup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
          >
            Check Again
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="text-sm text-muted-foreground mt-3">
            Click after running the setup commands to check if the database is ready.
          </p>
        </div>
      </div>
    </div>
  );
}
