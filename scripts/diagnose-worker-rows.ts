import { db } from "../src/lib/db";

async function main() {
  const rows = await db.backgroundWorkerProcess.findMany({
    where: { name: "stream-monitor" },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
