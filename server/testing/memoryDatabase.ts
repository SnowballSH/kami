import { MongoMemoryServer } from "mongodb-memory-server";
import { DATABASE_NAME, type DatabaseConnection } from "../db/connect";
import { MongoClient } from "../db/mongo";

export const startMemoryDatabase = async (): Promise<DatabaseConnection> => {
  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  const close = async (): Promise<void> => {
    await client.close();
    await mongod.stop();
  };
  return {
    db: client.db(DATABASE_NAME),
    description: "in-memory mongod for tests",
    close,
    shutDown: close,
  };
};
