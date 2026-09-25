import type { Db } from "./mongo";

/** Collections earlier versions kept and nothing reads any more: `quickdraw` became a file. */
export const RETIRED_COLLECTIONS = ["quickdraw"] as const;

/** Drops whichever retired collections a database still holds; names what it dropped. */
export const dropRetiredCollections = async (db: Db): Promise<readonly string[]> => {
  const present = await db
    .listCollections({ name: { $in: [...RETIRED_COLLECTIONS] } }, { nameOnly: true })
    .toArray();
  for (const { name } of present) await db.collection(name).drop();
  return present.map(({ name }) => name);
};
