import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(outputDir, "screenshots");

const screenshotFiles = {
  a: "panel-a-study-workflow.jpg",
  bChecklist: "panel-b-checklist-selected.jpg",
  bFields: "panel-b-field-search.jpg",
  c: "panel-c-mixs-table.jpg",
  dOrders: "panel-d-facility-orders.jpg",
  dPipeline: "panel-d-pipeline.jpg",
  dEna: "panel-d-ena.jpg",
};

const screenshots = Object.fromEntries(
  await Promise.all(
    Object.entries(screenshotFiles).map(async ([key, filename]) => {
      const bytes = await readFile(path.join(screenshotsDir, filename));
      return [key, `data:image/jpeg;base64,${bytes.toString("base64")}`];
    }),
  ),
);

const width = 4200;
const height = 3150;
const margin = 110;
const gutter = 90;
const panelWidth = 1945;
const panelHeight = 1420;

const colors = {
  canvas: "#FFFFFF",
  panel: "#F7F7F4",
  card: "#FFFFFF",
  foreground: "#171717",
  secondary: "#525252",
  muted: "#737373",
  border: "#D9D9D4",
  teal: "#006B57",
  tealSoft: "#E7F3EF",
};

let clipIndex = 0;
const definitions = [];

function screenshot({ href, x, y, w, h, viewBox }) {
  const clipId = `shot-clip-${++clipIndex}`;
  definitions.push(
    `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/></clipPath>`,
  );

  return `
    <g clip-path="url(#${clipId})">
      <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" overflow="hidden">
        <image href="${href}" x="0" y="0" width="1280" height="720" preserveAspectRatio="none"/>
      </svg>
    </g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="none" stroke="${colors.border}" stroke-width="3"/>`;
}

function panel({ x, y, letter, title, badge, content }) {
  const badgeWidth = Math.max(178, 28 * badge.length + 44);
  return `
    <g aria-label="Panel ${letter}: ${title}">
      <rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="28" fill="${colors.panel}" stroke="${colors.border}" stroke-width="3"/>
      <circle cx="${x + 54}" cy="${y + 56}" r="34" fill="${colors.foreground}"/>
      <text x="${x + 54}" y="${y + 69}" text-anchor="middle" class="panel-letter">${letter}</text>
      <text x="${x + 106}" y="${y + 69}" class="panel-title">${title}</text>
      <g transform="translate(${x + panelWidth - badgeWidth - 26} ${y + 28})">
        <rect width="${badgeWidth}" height="56" rx="28" fill="${colors.tealSoft}" stroke="#B6D9CF" stroke-width="2"/>
        <text x="${badgeWidth / 2}" y="38" text-anchor="middle" class="badge-text">${badge}</text>
      </g>
      ${content}
    </g>`;
}

function cropLabel(x, y, text) {
  const labelWidth = 54 + text.length * 23;
  return `
    <g transform="translate(${x} ${y})">
      <rect width="${labelWidth}" height="52" rx="26" fill="${colors.card}" fill-opacity="0.96" stroke="${colors.teal}" stroke-width="2"/>
      <text x="26" y="35" class="crop-label">${text}</text>
    </g>`;
}

const leftX = margin;
const rightX = margin + panelWidth + gutter;
const topY = margin;
const bottomY = margin + panelHeight + gutter;

const panelAContent = `
  ${screenshot({
    href: screenshots.a,
    x: leftX + 24,
    y: topY + 116,
    w: 1897,
    h: 1080,
    viewBox: "255 120 1015 575",
  })}
  ${cropLabel(leftX + 48, topY + 1234, "Select samples")}
  ${cropLabel(leftX + 496, topY + 1234, "Choose MIxS package")}
  ${cropLabel(leftX + 1088, topY + 1234, "Review completeness")}`;

const panelBContent = `
  ${screenshot({
    href: screenshots.bChecklist,
    x: rightX + 24,
    y: topY + 116,
    w: 1897,
    h: 620,
    viewBox: "250 86 1030 350",
  })}
  ${cropLabel(rightX + 48, topY + 138, "1  Choose checklist")}
  ${screenshot({
    href: screenshots.bFields,
    x: rightX + 24,
    y: topY + 766,
    w: 1897,
    h: 628,
    viewBox: "250 210 1030 335",
  })}
  ${cropLabel(rightX + 48, topY + 788, "2  Search metadata fields")}`;

const panelCContent = `
  ${screenshot({
    href: screenshots.c,
    x: leftX + 24,
    y: bottomY + 116,
    w: 1897,
    h: 1080,
    viewBox: "20 0 1260 720",
  })}
  ${cropLabel(leftX + 48, bottomY + 1234, "XLSX import/export")}
  ${cropLabel(leftX + 570, bottomY + 1234, "Keyboard cell editing")}
  ${cropLabel(leftX + 1160, bottomY + 1234, "Controlled MIxS terms")}`;

const panelDContent = `
  ${screenshot({
    href: screenshots.dOrders,
    x: rightX + 24,
    y: bottomY + 116,
    w: 1897,
    h: 660,
    viewBox: "250 112 1030 380",
  })}
  <path d="M ${rightX + 997} ${bottomY + 782} C ${rightX + 997} ${bottomY + 824}, ${rightX + 500} ${bottomY + 820}, ${rightX + 500} ${bottomY + 862}" fill="none" stroke="${colors.teal}" stroke-width="5" marker-end="url(#arrow)"/>
  <path d="M ${rightX + 997} ${bottomY + 782} C ${rightX + 997} ${bottomY + 824}, ${rightX + 1480} ${bottomY + 820}, ${rightX + 1480} ${bottomY + 862}" fill="none" stroke="${colors.teal}" stroke-width="5" marker-end="url(#arrow)"/>
  ${screenshot({
    href: screenshots.dPipeline,
    x: rightX + 24,
    y: bottomY + 872,
    w: 920,
    h: 522,
    viewBox: "280 170 840 475",
  })}
  ${cropLabel(rightX + 48, bottomY + 894, "Nextflow analysis")}
  ${screenshot({
    href: screenshots.dEna,
    x: rightX + 1001,
    y: bottomY + 872,
    w: 920,
    h: 522,
    viewBox: "280 205 840 477",
  })}
  ${cropLabel(rightX + 1025, bottomY + 894, "ENA registration")}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="figure-title figure-description">
  <title id="figure-title">SeqDesk platform overview and key interfaces</title>
  <desc id="figure-description">Four-panel overview of SeqDesk showing the five-step study workflow, selection of a MIxS environmental checklist and metadata fields, spreadsheet-style cohort metadata editing, and the facility workspace for order tracking, Nextflow analysis, and ENA registration.</desc>
  <defs>
    <style>
      text { font-family: Arial, Helvetica, sans-serif; fill: ${colors.foreground}; }
      .panel-letter { font-size: 42px; font-weight: 700; fill: #FFFFFF; }
      .panel-title { font-size: 40px; font-weight: 700; }
      .badge-text { font-size: 28px; font-weight: 700; fill: ${colors.teal}; }
      .crop-label { font-size: 27px; font-weight: 700; fill: ${colors.teal}; }
    </style>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${colors.teal}"/>
    </marker>
    ${definitions.join("\n")}
  </defs>
  <rect width="${width}" height="${height}" fill="${colors.canvas}"/>
  ${panel({ x: leftX, y: topY, letter: "A", title: "Guided study creation", badge: "5 steps", content: panelAContent })}
  ${panel({ x: rightX, y: topY, letter: "B", title: "MIxS checklist &amp; field selection", badge: "8 required · 74 optional", content: panelBContent })}
  ${panel({ x: leftX, y: bottomY, letter: "C", title: "Spreadsheet-like metadata table", badge: "120 samples", content: panelCContent })}
  ${panel({ x: rightX, y: bottomY, letter: "D", title: "Facility operations", badge: "Facility view", content: panelDContent })}
</svg>`.replace(/[ \t]+$/gm, "");

const svgPath = path.join(outputDir, "seqdesk-figure-1.svg");
const pngPath = path.join(outputDir, "seqdesk-figure-1.png");
const previewPath = path.join(outputDir, "seqdesk-figure-1-preview.png");
const tiffPath = path.join(outputDir, "seqdesk-figure-1.tiff");

await writeFile(svgPath, svg);

const svgBuffer = Buffer.from(svg);
await sharp(svgBuffer, { density: 72, limitInputPixels: false })
  .resize(width, height)
  .flatten({ background: colors.canvas })
  .withMetadata({ density: 600 })
  .png({ compressionLevel: 9, palette: false })
  .toFile(pngPath);

await sharp(svgBuffer, { density: 72, limitInputPixels: false })
  .resize(1600, 1200)
  .flatten({ background: colors.canvas })
  .png({ compressionLevel: 9, palette: false })
  .toFile(previewPath);

await sharp(svgBuffer, { density: 72, limitInputPixels: false })
  .resize(width, height)
  .flatten({ background: colors.canvas })
  .withMetadata({ density: 600 })
  .tiff({ compression: "lzw", predictor: "horizontal" })
  .toFile(tiffPath);

const finalFigure = sharp(pngPath);
const panelExports = [
  ["a", leftX, topY],
  ["b", rightX, topY],
  ["c", leftX, bottomY],
  ["d", rightX, bottomY],
];

await Promise.all(
  panelExports.map(([letter, x, y]) =>
    finalFigure
      .clone()
      .extract({ left: x, top: y, width: panelWidth, height: panelHeight })
      .png({ compressionLevel: 9 })
      .toFile(path.join(outputDir, `seqdesk-figure-1-panel-${letter}.png`)),
  ),
);

console.log(`Created ${svgPath}`);
console.log(`Created ${pngPath}`);
console.log(`Created ${tiffPath}`);
