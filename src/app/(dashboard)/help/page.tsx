"use client";

import Link from "next/link";
import {
  BookOpen,
  DatabaseZap,
  FileText,
  FlaskConical,
  HelpCircle,
  MessageSquare,
  Send,
  Settings,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";

const primaryWorkflow = [
  {
    step: "1",
    title: "Create an order",
    desc: "Enter the sequencing request, project details, and sample list.",
    href: "/orders/new",
    cta: "New Order",
  },
  {
    step: "2",
    title: "Submit samples",
    desc: "Submit the order and follow your facility's sample delivery instructions.",
    href: "/orders",
    cta: "Orders",
  },
  {
    step: "3",
    title: "Track sequencing",
    desc: "Follow facility review and sequencing progress after samples are received.",
    href: "/orders",
    cta: "Order Status",
  },
  {
    step: "4",
    title: "Build studies",
    desc: "Group samples into studies and complete scientific metadata.",
    href: "/studies/new",
    cta: "New Study",
  },
  {
    step: "5",
    title: "Facility processing",
    desc: "Facility admins usually attach data, run workflows, review results, and publish.",
    href: "/analysis",
    cta: "Analysis",
  },
];

const workspaceCards = [
  {
    title: "Orders",
    icon: FileText,
    href: "/orders",
    desc: "Use orders for sequencing requests, sample intake, facility review, and sequencing data tracking.",
    items: [
      "Create or update request details",
      "Maintain the sample list and facility fields",
      "Attach read files and sequencing artifacts",
    ],
  },
  {
    title: "Studies",
    icon: BookOpen,
    href: "/studies",
    desc: "Use studies to organize samples for scientific metadata, analysis, and publishing.",
    items: [
      "Select samples from one or more orders",
      "Complete study and per-sample metadata",
      "Mark studies ready and manage publishing",
    ],
  },
  {
    title: "Analysis",
    icon: FlaskConical,
    href: "/analysis",
    desc: "Facility admins usually run and review pipelines across orders and studies.",
    items: [
      "Start enabled workflows when inputs are ready",
      "Follow queued, running, completed, and failed runs",
      "Inspect logs, outputs, reports, and generated files",
    ],
  },
  {
    title: "Publishing",
    icon: Send,
    href: "/studies",
    desc: "Facility admins usually prepare repository submissions after metadata and files are ready.",
    items: [
      "Check required ENA metadata",
      "Register studies and samples when configured",
      "Track facility-managed submissions",
    ],
  },
];

const taskRows = [
  ["Request sequencing", "Orders -> New Order"],
  ["Check order progress", "Orders -> Order overview"],
  ["Review or attach read files", "Order -> Sequencing Data"],
  ["Create a scientific sample grouping", "Studies -> New Study"],
  ["Complete metadata", "Study -> Overview and Sequencing Data"],
  ["Run order or study workflows", "Order/Study -> Analysis"],
  ["Prepare ENA submission", "Study -> Publishing"],
  ["Ask for help", "Support -> Support"],
];

const adminRows = [
  ["Customize order intake", "Settings -> Order Form"],
  ["Customize study metadata", "Settings -> Study Forms"],
  ["Configure sequencers and run fields", "Settings -> Sequencers"],
  ["Set storage and compute paths", "Settings -> Infrastructure"],
  ["Configure ENA credentials", "Settings -> Data Upload"],
  ["Install and enable workflows", "Settings -> Pipelines"],
];

const roleRows = [
  [
    "Researcher",
    "Create orders, provide sample details, build studies, complete scientific metadata, and respond to facility questions.",
  ],
  [
    "Facility admin",
    "Review submitted orders, manage facility-only fields, attach sequencing data, run pipelines, and handle publishing.",
  ],
  [
    "Shared",
    "Use Support messages and notes to clarify sample issues, metadata gaps, data readiness, and submission questions.",
  ],
];

export default function HelpPage() {
  return (
    <PageContainer>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Help & Guide</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            A quick orientation for ordering sequencing, tracking samples and read files,
            organizing studies, running facility workflows, and preparing publication.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/messages">
            <MessageSquare className="h-4 w-4" />
            Contact Support
          </Link>
        </Button>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Typical Workflow</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Most work starts with a researcher order. After submission, the facility team usually handles
          sequencing data, analysis, and publishing while researchers complete study metadata and answer questions.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {primaryWorkflow.map((item) => (
            <div key={item.step} className="rounded-lg border bg-card p-4">
              <div className="mb-3 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold">
                {item.step}
              </div>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 min-h-12 text-xs text-muted-foreground">{item.desc}</p>
              <Link href={item.href} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
                {item.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Main Areas</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The sidebar is organized around the main objects in the lab workflow. Some areas are visible to everyone,
          while facility-only actions appear for admin users.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workspaceCards.map((card) => (
            <div key={card.title} className="rounded-lg border bg-card p-5">
              <div className="flex items-center gap-2">
                <card.icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-base font-semibold">{card.title}</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{card.desc}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {card.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 rounded-full bg-muted-foreground/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Link href={card.href} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                Open {card.title}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Who Usually Does What</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            SeqDesk separates researcher-facing preparation from facility-managed processing. Exact permissions can
            differ by installation, but this is the expected split.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-left font-medium">Typical responsibility</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {roleRows.map(([role, responsibility]) => (
                  <tr key={role}>
                    <td className="px-3 py-2 font-medium">{role}</td>
                    <td className="px-3 py-2 text-muted-foreground">{responsibility}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2">
            <DatabaseZap className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Where To Do Common Tasks</h2>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Task</th>
                  <th className="px-3 py-2 text-left font-medium">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {taskRows.map(([task, where]) => (
                  <tr key={task}>
                    <td className="px-3 py-2">{task}</td>
                    <td className="px-3 py-2 text-muted-foreground">{where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Facility Admin Setup</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Facility administrators see extra setup areas for forms, infrastructure, data upload, and pipelines.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Setup</th>
                  <th className="px-3 py-2 text-left font-medium">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {adminRows.map(([task, where]) => (
                  <tr key={task}>
                    <td className="px-3 py-2">{task}</td>
                    <td className="px-3 py-2 text-muted-foreground">{where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Status Basics</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Orders</p>
              <p className="mt-1 text-sm text-muted-foreground">Draft to Submitted to Completed</p>
            </div>
            <div>
              <p className="text-sm font-medium">Studies</p>
              <p className="mt-1 text-sm text-muted-foreground">Draft to Ready to Submitted</p>
            </div>
            <div>
              <p className="text-sm font-medium">Pipelines</p>
              <p className="mt-1 text-sm text-muted-foreground">Queued to Running to Completed or Failed</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Notes</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Order and study forms are configured by your facility, so fields can differ between installations.</li>
            <li>Researchers usually create orders, build studies, and complete metadata. Facility admins usually manage sequencing data, analysis pipelines, ENA settings, and publication.</li>
            <li>Read files, pipeline outputs, and publishing actions depend on facility setup. If something is missing or unclear, use Support to contact the facility team.</li>
          </ul>
        </div>
      </section>
    </PageContainer>
  );
}
