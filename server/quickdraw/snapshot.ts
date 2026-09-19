import { readConfig } from "../config";
import { connectDatabase } from "../db/connect";
import { QuickdrawSampleRepository } from "./sampleRepository";
import { exportSnapshot, importSnapshot } from "./snapshotFile";

const USAGE = "usage: bun server/quickdraw/snapshot.ts <export|import> <file.ndjson.gz>";

const [action, path] = process.argv.slice(2);
if ((action !== "export" && action !== "import") || path === undefined) {
  console.error(USAGE);
  process.exit(2);
}

const connection = await connectDatabase(readConfig().database);
try {
  const repository = new QuickdrawSampleRepository(connection.db);
  const count =
    action === "export"
      ? await exportSnapshot(repository, path)
      : await importSnapshot(repository, path);
  console.log(`${action}ed ${count} Quick, Draw! sketches (${connection.description})`);
} finally {
  await connection.close();
}
