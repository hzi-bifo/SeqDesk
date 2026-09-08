import { expect, it } from "vitest";
import { importCollectionSchema } from "./import-collection";
import { camiInputSchema } from "./importers/cami-benchmark";
import { enaFastqAccessionInputSchema } from "./importers/ena-fastq-accession";
const key = "00e55dcb-9697-4b89-af56-af51bd557a17";
it.each(["", "  ", "x".repeat(501)])("rejects an empty or overlong name (%s)", name => {
  expect(importCollectionSchema.safeParse({ key, name }).success).toBe(false);
});
it("requires a valid collection key and strips surrounding name whitespace", () => {
  expect(importCollectionSchema.parse({ key, name: " Controls " })).toEqual({ key, name: "Controls" });
  expect(importCollectionSchema.safeParse({ key: "../../other-owner", name: "Controls" }).success).toBe(false);
  expect(importCollectionSchema.safeParse({ key, name: "Controls", userId: "other-owner" }).success).toBe(false);
});
it("both raw-read modules preserve the same destination contract", () => {
  const collection = { key, name: "Controls" };
  expect(camiInputSchema.parse({ technology: "short", sample: 0, collection }).collection).toEqual(collection);
  expect(enaFastqAccessionInputSchema.parse({ accession: "ERR164407", collection }).collection).toEqual(collection);
});
