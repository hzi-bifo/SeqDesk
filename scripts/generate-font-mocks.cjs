#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const { validateGoogleFontFunctionCall } = require("next/dist/compiled/@next/font/dist/google/validate-google-font-function-call");
const { getFontAxes } = require("next/dist/compiled/@next/font/dist/google/get-font-axes");
const { getGoogleFontsUrl } = require("next/dist/compiled/@next/font/dist/google/get-google-fonts-url");

const fonts = [
  {
    functionName: "Geist",
    options: { subsets: ["latin"], variable: "--font-geist-sans" },
  },
  {
    functionName: "Geist_Mono",
    options: { subsets: ["latin"], variable: "--font-geist-mono" },
  },
  {
    functionName: "Caveat",
    options: { subsets: ["latin"], variable: "--font-caveat" },
  },
  {
    functionName: "Playfair_Display",
    options: { subsets: ["latin"], variable: "--font-playfair" },
  },
];

const outputPath =
  process.argv[2] ||
  path.join(process.cwd(), "scripts", "font-mocks.json");

function buildFallbackCss(fontFamily, display) {
  const safeFamily = String(fontFamily).replace(/'/g, "\\'");
  const fontDisplay = display || "swap";
  return [
    "@font-face {",
    `  font-family: '${safeFamily}';`,
    "  font-style: normal;",
    "  font-weight: 400;",
    `  font-display: ${fontDisplay};`,
    "  src: local('Arial'), local('Helvetica'), local('sans-serif');",
    "}",
    "",
  ].join("\n");
}

const responses = {};

for (const font of fonts) {
  const {
    fontFamily,
    weights,
    styles,
    display,
    selectedVariableAxes,
  } = validateGoogleFontFunctionCall(font.functionName, font.options);

  const axes = getFontAxes(fontFamily, weights, styles, selectedVariableAxes);
  const url = getGoogleFontsUrl(fontFamily, axes, display);
  responses[url] = buildFallbackCss(fontFamily, display);
}

fs.writeFileSync(outputPath, JSON.stringify(responses, null, 2));
console.log(`Wrote Google Fonts mock file: ${outputPath}`);
