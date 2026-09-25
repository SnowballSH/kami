import type { MongoClient as DriverMongoClient } from "mongodb";
import "./bsonSnapshotShim";

const driver = await import("mongodb");

export type { Collection, Db, Document, Sort } from "mongodb";

export type MongoClient = DriverMongoClient;
export const MongoClient = driver.MongoClient;
