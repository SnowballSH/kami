/** Somewhere Kami talks to over HTTP that may sit behind an authenticating proxy. */
export interface AuthenticatedEndpoint {
  readonly url: string;
  readonly apiKey?: string;
}

export const endpointHeaders = (
  { apiKey }: AuthenticatedEndpoint,
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> => ({
  ...headers,
  ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
});
