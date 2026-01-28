import { redirect } from "next/navigation";
import { checkDatabaseStatus } from "@/lib/db-status";
import { Database, Terminal, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";

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
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 mb-4">
            <Database className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2">Database Setup Required</h1>
          <p className="text-stone-600">
            Welcome to SeqDesk! The database needs to be initialized before you can use the application.
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Current Status
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <div className={`h-2 w-2 rounded-full ${status.exists ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-stone-600">Database file:</span>
              <span className={status.exists ? "text-green-600" : "text-red-600"}>
                {status.exists ? "Found" : "Not found"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className={`h-2 w-2 rounded-full ${status.configured ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-stone-600">Initial data:</span>
              <span className={status.configured ? "text-green-600" : "text-red-600"}>
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
        <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Terminal className="h-5 w-5 text-stone-700" />
            Setup Instructions
          </h2>
          <p className="text-sm text-stone-600 mb-4">
            Run the following commands in your terminal to set up the database:
          </p>

          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                {index < steps.length - 1 && (
                  <div className="absolute left-4 top-10 bottom-0 w-px bg-stone-200" />
                )}
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1 pb-4">
                    <h3 className="font-medium text-stone-900 mb-1">{step.title}</h3>
                    <p className="text-sm text-stone-500 mb-2">{step.description}</p>
                    <div className="bg-stone-900 rounded-lg p-3 font-mono text-sm text-stone-100 flex items-center justify-between group">
                      <code>{step.command}</code>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-white text-xs"
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
        <div className="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Default Login Credentials
          </h2>
          <p className="text-sm text-stone-600 mb-4">
            After seeding, you can log in with these accounts:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-stone-50 border border-stone-200">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Admin Account</div>
              <div className="space-y-1 text-sm">
                <div><span className="text-stone-500">Email:</span> <code className="text-stone-900">admin@example.com</code></div>
                <div><span className="text-stone-500">Password:</span> <code className="text-stone-900">admin</code></div>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-stone-50 border border-stone-200">
              <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Researcher Account</div>
              <div className="space-y-1 text-sm">
                <div><span className="text-stone-500">Email:</span> <code className="text-stone-900">user@example.com</code></div>
                <div><span className="text-stone-500">Password:</span> <code className="text-stone-900">user</code></div>
              </div>
            </div>
          </div>
        </div>

        {/* Refresh Button */}
        <div className="text-center">
          <a
            href="/setup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Check Again
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="text-sm text-stone-500 mt-3">
            Click after running the setup commands to check if the database is ready.
          </p>
        </div>
      </div>
    </div>
  );
}
