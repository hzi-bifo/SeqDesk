"use client";

import { PageContainer } from "@/components/layout/PageContainer";

export default function HelpPage() {
  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-10">
        <h1
          className="text-2xl font-semibold mb-2"
          style={{ color: '#171717', letterSpacing: '-0.02em' }}
        >
          Help & Guide
        </h1>
        <p style={{ color: '#525252' }}>
          Learn how to use the sequencing portal to submit orders and manage your data
        </p>
      </div>

      {/* Workflow Overview */}
      <section className="mb-10">
        <h2
          className="text-lg font-semibold mb-3"
          style={{ color: '#171717' }}
        >
          How It Works
        </h2>
        <p className="mb-6" style={{ color: '#525252' }}>
          The sequencing portal helps you submit samples for sequencing and collect the metadata
          needed for publication and data repository submission (like ENA).
        </p>

        {/* Visual Flow */}
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { step: 1, title: "Create Order", desc: "Submit your sequencing request with samples" },
            { step: 2, title: "Create Study", desc: "Group samples and select environment type" },
            { step: 3, title: "Fill Metadata", desc: "Complete MIxS fields for each sample" },
            { step: 4, title: "Submit to ENA", desc: "Facility submits data to the repository" },
          ].map((item) => (
            <div
              key={item.step}
              className="p-4 rounded-xl"
              style={{ background: '#F7F7F4', border: '1px solid #e5e5e0' }}
            >
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-sm font-semibold mb-3"
                style={{ background: '#171717', color: '#ffffff' }}
              >
                {item.step}
              </div>
              <h3 className="font-medium mb-1" style={{ color: '#171717' }}>
                {item.title}
              </h3>
              <p className="text-sm" style={{ color: '#525252' }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Orders vs Studies */}
      <section className="mb-10">
        <div className="grid md:grid-cols-2 gap-6">
          <div
            className="p-6 rounded-xl"
            style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
          >
            <h2 className="text-lg font-semibold mb-3" style={{ color: '#171717' }}>
              What is an Order?
            </h2>
            <p className="mb-4" style={{ color: '#525252' }}>
              An Order is your <strong>sequencing request</strong>. It contains the information
              needed to process your samples at the sequencing facility.
            </p>
            <ul className="space-y-2">
              {[
                "List of samples to sequence",
                "Sequencing parameters (if configured)",
                "Order status tracking",
                "Additional fields as configured by the facility",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#525252' }}>
                  <span style={{ color: '#a3a3a3' }}>-</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="p-6 rounded-xl"
            style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
          >
            <h2 className="text-lg font-semibold mb-3" style={{ color: '#171717' }}>
              What is a Study?
            </h2>
            <p className="mb-4" style={{ color: '#525252' }}>
              A Study groups samples that share the same <strong>scientific context</strong> and
              metadata requirements for publication and repository submission.
            </p>
            <ul className="space-y-2">
              {[
                "Environment type (gut, soil, water, etc.)",
                "MIxS metadata collection per sample",
                "Samples from one or more orders",
                "ENA/repository submission by facility",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: '#525252' }}>
                  <span style={{ color: '#a3a3a3' }}>-</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Why Both? */}
      <section className="mb-10">
        <div
          className="p-6 rounded-xl"
          style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
        >
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#171717' }}>
            Why are Orders and Studies separate?
          </h2>
          <p className="mb-4" style={{ color: '#525252' }}>
            A single Order can contain samples from <strong>different environments</strong>.
            For example, you might submit gut samples and water samples in the same sequencing batch,
            but they need different MIxS metadata checklists.
          </p>
          <div
            className="p-4 rounded-lg"
            style={{ background: '#F7F7F4' }}
          >
            <p className="text-sm" style={{ color: '#525252' }}>
              <strong>Example:</strong> You submit an order with 20 samples. 15 are from human gut
              (needing gut-specific metadata like diet, host age) and 5 are from water sources
              (needing water-specific metadata like depth, temperature). You create two Studies:
              one for gut samples, one for water samples.
            </p>
          </div>
        </div>
      </section>

      {/* MIxS Info */}
      <section className="mb-10">
        <div
          className="p-6 rounded-xl"
          style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
        >
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#171717' }}>
            What is MIxS?
          </h2>
          <p className="mb-4" style={{ color: '#525252' }}>
            <strong>MIxS</strong> (Minimum Information about any Sequence) is an international standard
            for describing sequencing samples. It ensures your data is well-documented and can be
            understood by other researchers.
          </p>
          <p className="mb-4" style={{ color: '#525252' }}>
            Different environment types have different required and optional fields. For example:
          </p>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              { title: "Human Gut", fields: "Host age, diet, disease status, medication..." },
              { title: "Soil", fields: "pH, temperature, depth, land use, crop rotation..." },
              { title: "Water", fields: "Depth, salinity, temperature, dissolved oxygen..." },
            ].map((env, i) => (
              <div
                key={i}
                className="p-3 rounded-lg"
                style={{ background: '#F7F7F4', border: '1px solid #e5e5e0' }}
              >
                <h4 className="font-medium text-sm mb-1" style={{ color: '#171717' }}>
                  {env.title}
                </h4>
                <p className="text-xs" style={{ color: '#a3a3a3' }}>
                  {env.fields}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Step by Step */}
      <section className="mb-10">
        <div
          className="p-6 rounded-xl"
          style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
        >
          <h2 className="text-lg font-semibold mb-6" style={{ color: '#171717' }}>
            Step-by-Step Guide
          </h2>

          <div className="space-y-6">
            {[
              {
                step: 1,
                title: "Create a new Order",
                desc: "Go to Orders → New Order. Follow the wizard to fill in the required information and add your samples. The fields shown depend on your facility's configuration.",
              },
              {
                step: 2,
                title: "Submit the Order",
                desc: "Review your order and submit it. The facility will process your request and begin sequencing. You can track the status on the order detail page.",
              },
              {
                step: 3,
                title: "Create a Study",
                desc: "Go to Studies → New Study. Enter a title, select the environment type (e.g., Human Gut, Soil), and choose which samples to include from your orders.",
              },
              {
                step: 4,
                title: "Fill in sample metadata",
                desc: "During study creation (or by clicking Edit on the study page), fill in the MIxS metadata for each sample using the spreadsheet interface. Required fields are marked with an asterisk.",
              },
              {
                step: 5,
                title: "Ready for ENA submission",
                desc: "Once all metadata is complete, your study is ready for submission to ENA or other data repositories. The sequencing facility will handle the final submission on your behalf.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <div
                  className="flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{ border: '2px solid #e5e5e0', color: '#525252' }}
                >
                  {item.step}
                </div>
                <div>
                  <h3 className="font-medium" style={{ color: '#171717' }}>
                    {item.title}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: '#525252' }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <div
          className="p-6 rounded-xl"
          style={{ background: '#F7F7F4', border: '1px solid #e5e5e0' }}
        >
          <h2 className="text-lg font-semibold mb-2" style={{ color: '#171717' }}>
            Need Help?
          </h2>
          <p style={{ color: '#525252' }}>
            If you have questions or need assistance, please contact the sequencing facility team.
            We are happy to help you with your submission.
          </p>
        </div>
      </section>
    </PageContainer>
  );
}
