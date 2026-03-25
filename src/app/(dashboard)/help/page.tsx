"use client";

import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";

export default function HelpPage() {
  return (
    <PageContainer>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        <p className="mt-2 text-muted-foreground">
          Quick reference for submitting orders, organizing studies, and preparing ENA-ready metadata.
        </p>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Quick Workflow</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The shortest path for most users:
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {[
            {
              step: "1",
              title: "Create Order",
              desc: "Add order details, sequencing settings, and your samples.",
              href: "/orders/new",
              cta: "New Order",
            },
            {
              step: "2",
              title: "Submit Order",
              desc: "Send the order to the facility and follow shipping instructions.",
              href: "/orders",
              cta: "Orders",
            },
            {
              step: "3",
              title: "Create Study",
              desc: "Select samples and define study context/checklist.",
              href: "/studies/new",
              cta: "New Study",
            },
            {
              step: "4",
              title: "Fill Metadata",
              desc: "Complete per-sample metadata in the study editor.",
              href: "/studies",
              cta: "Studies",
            },
            {
              step: "5",
              title: "Mark Ready",
              desc: "When complete, mark the study ready for facility review/submission.",
              href: "/studies",
              cta: "Track Status",
            },
          ].map((item) => (
            <div key={item.step} className="rounded-lg border bg-card p-4">
              <div className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold">
                {item.step}
              </div>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
              <Link href={item.href} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
                {item.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold">Order</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A sequencing request. Use it to define request-level fields and sample list.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              <li>- Order Details and Sequencing Information</li>
              <li>- Sample IDs and order-specific fields</li>
              <li>- Facility processing status (Draft/Submitted/Completed)</li>
            </ul>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="text-base font-semibold">Study</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A scientific grouping of samples for metadata completion and repository submission.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              <li>- Study title and context fields</li>
              <li>- Environment/checklist selection</li>
              <li>- Per-sample metadata completion and readiness</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Status Flow</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Orders</p>
              <p className="mt-1 text-sm text-muted-foreground">Draft → Submitted → Completed</p>
            </div>
            <div>
              <p className="text-sm font-medium">Studies</p>
              <p className="mt-1 text-sm text-muted-foreground">Draft → Ready → Submitted</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Where To Fill What</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Task</th>
                  <th className="px-3 py-2 text-left font-medium">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="px-3 py-2">Request sequencing and define sample list</td>
                  <td className="px-3 py-2">Orders</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Assign samples to scientific context/checklist</td>
                  <td className="px-3 py-2">Studies</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Complete per-sample metadata</td>
                  <td className="px-3 py-2">Study editor</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Mark package ready for submission</td>
                  <td className="px-3 py-2">Study detail page</td>
                </tr>
                <tr>
                  <td className="px-3 py-2">Final ENA submission</td>
                  <td className="px-3 py-2">Facility workflow</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Notes</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>- Order and Study fields are configured by your facility, so steps can differ between installations.</li>
            <li>- After order submission, sample rows are typically read-only, while order metadata may still be editable until completion.</li>
            <li>- A single order can feed one or multiple studies.</li>
            <li>- For ENA, required checks (title, samples, taxonomy, metadata) are shown in the study Publishing section.</li>
          </ul>
        </div>
      </section>

      <section>
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-base font-semibold">Need Help?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Contact your sequencing facility team for project-specific support and submission policy questions.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/orders/new" className="text-sm font-medium text-primary hover:underline">
              Start a New Order
            </Link>
            <Link href="/studies/new" className="text-sm font-medium text-primary hover:underline">
              Start a New Study
            </Link>
          </div>
        </div>
      </section>
    </PageContainer>
  );
}
