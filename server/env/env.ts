export type Env = Readonly<Record<string, string | undefined>>;

export const OFF = "off";

export const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value.trim();

export const isOff = (value: string | undefined): boolean => nonEmpty(value)?.toLowerCase() === OFF;

export const portFrom = (value: string | undefined, fallback: number): number => {
  const port = Number(nonEmpty(value));
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

export const nonNegativeIntegerFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(nonEmpty(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const positiveNumberFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(nonEmpty(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
