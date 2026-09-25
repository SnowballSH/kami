import { mkdir } from "node:fs/promises";
import { type Db, MongoClient } from "./mongo";

export const DATABASE_NAME = "kami";

/** WiredTiger's smallest allowed cache; mongod's own default would be half of the host's memory. */
export const MIN_EMBEDDED_CACHE_GB = 0.25;
export const DEFAULT_EMBEDDED_CACHE_GB = MIN_EMBEDDED_CACHE_GB;

const EMBEDDED_PORT = 27117;
const EMBEDDED_URI = `mongodb://127.0.0.1:${EMBEDDED_PORT}/?directConnection=true`;
const ADOPTION_TIMEOUT_MS = 500;

export interface DatabaseConnection {
  readonly db: Db;
  readonly description: string;
  /** Disconnects, and stops the embedded mongod if — and only if — this connection started it. */
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly uri: string | undefined;
  readonly embeddedDataDirectory: string;
  /** WiredTiger cache for the embedded mongod, in GB; a shared host wants it small. */
  readonly embeddedCacheGb?: number;
}

/**
 * Arguments that keep an embedded mongod a good neighbour on a small shared host: a capped cache
 * instead of half the machine's memory, and no full-time diagnostic data collection on disk.
 */
export const embeddedMongodArgs = (
  cacheGb: number = DEFAULT_EMBEDDED_CACHE_GB,
): readonly string[] => [
  "--wiredTigerCacheSizeGB",
  String(Math.max(MIN_EMBEDDED_CACHE_GB, cacheGb)),
  "--setParameter",
  "diagnosticDataCollectionEnabled=false",
];

const connectToUri = async (uri: string): Promise<DatabaseConnection> => {
  const client = await MongoClient.connect(uri);
  const close = (): Promise<void> => client.close();
  return {
    db: client.db(DATABASE_NAME),
    description: "the MongoDB at MONGODB_URI",
    close,
  };
};

const adoptRunningEmbedded = async (dataDirectory: string): Promise<DatabaseConnection | null> => {
  try {
    const client = await MongoClient.connect(EMBEDDED_URI, {
      serverSelectionTimeoutMS: ADOPTION_TIMEOUT_MS,
    });
    return {
      db: client.db(DATABASE_NAME),
      description: `embedded mongod (already running) with its data in ${dataDirectory}`,
      close: () => client.close(),
    };
  } catch {
    return null;
  }
};

const startEmbedded = async (
  dataDirectory: string,
  cacheGb: number | undefined,
): Promise<DatabaseConnection> => {
  await mkdir(dataDirectory, { recursive: true });
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create({
    instance: {
      port: EMBEDDED_PORT,
      dbPath: dataDirectory,
      storageEngine: "wiredTiger",
      args: [...embeddedMongodArgs(cacheGb)],
    },
  });
  const client = await MongoClient.connect(mongod.getUri());
  const close = async (): Promise<void> => {
    await client.close();
    await mongod.stop({ doCleanup: false });
  };
  return {
    db: client.db(DATABASE_NAME),
    description: `embedded mongod with its data in ${dataDirectory}`,
    close,
  };
};

/**
 * With no URI, runs a real mongod on a fixed local port with its data on disk. A mongod already
 * listening there is reused: `bun --watch` re-executes the server in place, so the mongod it
 * started earlier is still alive and still holds the data directory's lock.
 */
export const connectDatabase = async ({
  uri,
  embeddedDataDirectory,
  embeddedCacheGb,
}: DatabaseOptions): Promise<DatabaseConnection> => {
  if (uri !== undefined && uri !== "") return connectToUri(uri);
  return (
    (await adoptRunningEmbedded(embeddedDataDirectory)) ??
    startEmbedded(embeddedDataDirectory, embeddedCacheGb)
  );
};
