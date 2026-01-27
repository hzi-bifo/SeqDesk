"use client";

import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import {
  HelpCircle,
  FileText,
  BookOpen,
  ClipboardList,
  ArrowRight,
  Check,
  Package,
  Upload,
  Mail,
} from "lucide-react";

export default function HelpPage() {
  return (
    <PageContainer>
      <div className="mb-8">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
            <HelpCircle className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Help & Guide</h1>
            <p className="text-muted-foreground mt-1">
              Learn how to use the sequencing portal to submit orders and manage your data
            </p>
          </div>
        </div>
      </div>

      {/* Workflow Overview */}
      <GlassCard className="p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">How It Works</h2>
        <p className="text-muted-foreground mb-6">
          The sequencing portal helps you submit samples for sequencing and collect the metadata
          needed for publication and data repository submission (like ENA).
        </p>

        {/* Visual Flow */}
        <div className="grid md:grid-cols-4 gap-4">
          <div className="relative p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                1
              </div>
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">Create Order</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Submit your sequencing request with samples
            </p>
            <ArrowRight className="hidden md:block absolute -right-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/40 z-10" />
          </div>

          <div className="relative p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                2
              </div>
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">Create Study</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Group samples and select environment type
            </p>
            <ArrowRight className="hidden md:block absolute -right-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/40 z-10" />
          </div>

          <div className="relative p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                3
              </div>
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">Fill Metadata</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Complete MIxS fields for each sample
            </p>
            <ArrowRight className="hidden md:block absolute -right-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/40 z-10" />
          </div>

          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                4
              </div>
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">Submit to ENA</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Facility submits data to the repository
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Orders vs Studies */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">What is an Order?</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            An Order is your <strong>sequencing request</strong>. It contains the information
            needed to process your samples at the sequencing facility.
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">List of samples to sequence</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">Sequencing parameters (if configured)</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">Order status tracking</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">Additional fields as configured by the facility</span>
            </li>
          </ul>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">What is a Study?</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            A Study groups samples that share the same <strong>scientific context</strong> and
            metadata requirements for publication and repository submission.
          </p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">Environment type (gut, soil, water, etc.)</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">MIxS metadata collection per sample</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">Samples from one or more orders</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="text-sm">ENA/repository submission by facility</span>
            </li>
          </ul>
        </GlassCard>
      </div>

      {/* Why Both? */}
      <GlassCard className="p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Why are Orders and Studies separate?</h2>
        <p className="text-muted-foreground mb-4">
          A single Order can contain samples from <strong>different environments</strong>.
          For example, you might submit gut samples and water samples in the same sequencing batch,
          but they need different MIxS metadata checklists.
        </p>
        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Example:</strong> You submit an order with 20 samples. 15 are from human gut
            (needing gut-specific metadata like diet, host age) and 5 are from water sources
            (needing water-specific metadata like depth, temperature). You create two Studies:
            one for gut samples, one for water samples.
          </p>
        </div>
      </GlassCard>

      {/* MIxS Info */}
      <GlassCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">What is MIxS?</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          <strong>MIxS</strong> (Minimum Information about any Sequence) is an international standard
          for describing sequencing samples. It ensures your data is well-documented and can be
          understood by other researchers.
        </p>
        <p className="text-muted-foreground mb-4">
          Different environment types have different required and optional fields. For example:
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-sm mb-1">Human Gut</h4>
            <p className="text-xs text-muted-foreground">Host age, diet, disease status, medication...</p>
          </div>
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-sm mb-1">Soil</h4>
            <p className="text-xs text-muted-foreground">pH, temperature, depth, land use, crop rotation...</p>
          </div>
          <div className="border rounded-lg p-3">
            <h4 className="font-medium text-sm mb-1">Water</h4>
            <p className="text-xs text-muted-foreground">Depth, salinity, temperature, dissolved oxygen...</p>
          </div>
        </div>
      </GlassCard>

      {/* Step by Step */}
      <GlassCard className="p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Step-by-Step Guide</h2>

        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-shrink-0 h-8 w-8 rounded-full border-2 border-primary/30 flex items-center justify-center text-primary font-semibold text-sm">
              1
            </div>
            <div>
              <h3 className="font-medium">Create a new Order</h3>
              <p className="text-sm text-muted-foreground">
                Go to Orders &rarr; New Order. Follow the wizard to fill in the required information
                and add your samples. The fields shown depend on your facility&apos;s configuration.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 h-8 w-8 rounded-full border-2 border-primary/30 flex items-center justify-center text-primary font-semibold text-sm">
              2
            </div>
            <div>
              <h3 className="font-medium">Submit the Order</h3>
              <p className="text-sm text-muted-foreground">
                Review your order and submit it. The facility will process your request and begin sequencing.
                You can track the status on the order detail page.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 h-8 w-8 rounded-full border-2 border-primary/30 flex items-center justify-center text-primary font-semibold text-sm">
              3
            </div>
            <div>
              <h3 className="font-medium">Create a Study</h3>
              <p className="text-sm text-muted-foreground">
                Go to Studies &rarr; New Study. Enter a title, select the environment type (e.g., Human Gut, Soil),
                and choose which samples to include from your orders.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 h-8 w-8 rounded-full border-2 border-primary/30 flex items-center justify-center text-primary font-semibold text-sm">
              4
            </div>
            <div>
              <h3 className="font-medium">Fill in sample metadata</h3>
              <p className="text-sm text-muted-foreground">
                During study creation (or by clicking Edit on the study page), fill in the MIxS metadata
                for each sample using the spreadsheet interface. Required fields are marked with an asterisk.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 h-8 w-8 rounded-full border-2 border-primary/30 flex items-center justify-center text-primary font-semibold text-sm">
              5
            </div>
            <div>
              <h3 className="font-medium">Ready for ENA submission</h3>
              <p className="text-sm text-muted-foreground">
                Once all metadata is complete, your study is ready for submission to ENA or other
                data repositories. The sequencing facility will handle the final submission on your behalf.
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Contact */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-3">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Need Help?</h2>
        </div>
        <p className="text-muted-foreground">
          If you have questions or need assistance, please contact the sequencing facility team.
          We are happy to help you with your submission.
        </p>
      </GlassCard>
    </PageContainer>
  );
}
