import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import "../../server/db/bsonSnapshotShim";

const { MongoBinary } = await import("mongodb-memory-server");

const USAGE =
  "usage: MONGOMS_VERSION=<x.y.z> [MONGOMS_DISTRO=debian-12] bun scripts/container/fetchMongod.ts <destination>";

/**
 * The image build downloads mongod once, with the same resolver the server uses at runtime, so
 * the running container needs neither the network nor a writable cache: MONGOMS_SYSTEM_BINARY
 * then points at the copy made here.
 */
const fetchMongod = async (destination: string): Promise<string> => {
  const downloaded = await MongoBinary.getPath();
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(downloaded, destination);
  await chmod(destination, 0o755);
  return downloaded;
};

const [destination] = process.argv.slice(2);
if (destination === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const source = await fetchMongod(destination);
console.log(
  `mongod ${process.env.MONGOMS_VERSION ?? "(default version)"}: ${source} -> ${destination}`,
);
