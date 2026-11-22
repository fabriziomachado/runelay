import {
  type CreateSourceInput,
  fail,
  type ImportedOAuthInput,
  type ImportSourceInput,
  type ImportSourcesInput,
  type ImportView,
  type OAuthClientInput,
  ok,
  type Result,
  type SourceView,
  type UpdateSourceInput,
} from "@runelay/shared";
import { parseClientConfig } from "@runelay/shared/importers";
import { ACCESS_MESSAGES } from "@/modules/access/constants/access.constants";
import { connectSource, disconnectSource } from "@/modules/connectors/services/connection.service";
import {
  deleteSource,
  findSource,
  findSourceView,
  insertSource,
  renameSource,
  updateEnabled,
  updateOAuth,
  upsertSource,
  upsertSources,
} from "@/modules/sources/repositories/source.repository";
import { checkSourcePolicy } from "@/modules/sources/services/source-policy.service";
import type { OAuthState, SourceKey } from "@/modules/sources/types/source.types";
import type { SourceActor } from "@/modules/sources/types/source-policy.types";

export { findSourceView, listSourceViews, summarizeSources } from "@/modules/sources/repositories/source.repository";

const CLEARED_LOGIN: Partial<OAuthState> = { client: undefined, tokens: undefined, verifier: undefined };

const OWN_CLIENT_KINDS = new Set(["mcp", "google"]);

const GOOGLE_SECRET_REQUIRED = "O Google exige o client secret do seu cliente OAuth.";

// Swapping the client invalidates the old tokens and, for Google, the scopes they carried.
const clearedLogin = (kind: string): Partial<OAuthState> =>
  kind === "google" ? { ...CLEARED_LOGIN, google: undefined } : CLEARED_LOGIN;

export const createSource = async (
  organizationId: string,
  input: CreateSourceInput,
  actor: SourceActor,
  { oauth, createOnly }: { oauth?: Partial<OAuthState>; createOnly?: boolean } = {},
): Promise<Result<SourceView>> => {
  const allowed = await checkSourcePolicy(input.config, actor);
  if (allowed.error) return allowed;
  if (input.config.kind === "google" && input.oauthClient && !input.oauthClient.clientSecret) {
    return fail("INVALID_INPUT", GOOGLE_SECRET_REQUIRED);
  }
  const saved = createOnly ? insertSource(organizationId, input) : upsertSource(organizationId, input);
  if (saved.error) return saved;
  if (oauth) updateOAuth({ organizationId, name: input.name }, oauth);
  if (input.oauthClient && OWN_CLIENT_KINDS.has(input.config.kind)) {
    updateOAuth(
      { organizationId, name: input.name },
      { ...clearedLogin(input.config.kind), customClient: input.oauthClient },
    );
  }
  await connectSource({ organizationId, name: input.name });
  return findSourceView({ organizationId, name: input.name });
};

export const addSourceAccount = async (
  key: SourceKey,
  name: string,
  actor: SourceActor,
): Promise<Result<SourceView>> => {
  const view = findSourceView(key);
  if (view.error) return view;
  const { config, auth, oauthClientId, status } = view.data;
  if (config.kind === "google") return createSource(key.organizationId, { name, config }, actor, { createOnly: true });
  if (
    config.kind !== "mcp" ||
    Object.keys(config.headers).length !== 0 ||
    (auth !== "oauth" && !oauthClientId && status !== "needs_auth")
  )
    return fail("OAUTH_UNSUPPORTED");

  const source = findSource(key);
  if (source.error) return source;
  const { broker, customClient } = source.data.oauth;
  return createSource(key.organizationId, { name, config, oauthClient: customClient }, actor, {
    createOnly: true,
    oauth: { broker },
  });
};

const keepStoredSecret = (next: OAuthClientInput | null, stored: OAuthClientInput | undefined) => {
  if (!next) return undefined;
  const sameClient = stored?.clientId === next.clientId;
  return !next.clientSecret && sameClient && stored.clientSecret
    ? { ...next, clientSecret: stored.clientSecret }
    : next;
};

export const updateSource = async (
  key: SourceKey,
  input: UpdateSourceInput,
  actor: SourceActor,
): Promise<Result<SourceView>> => {
  const current = findSource(key);
  if (current.error) return current;
  if (input.config) {
    const allowed = await checkSourcePolicy(input.config, actor);
    if (allowed.error) return allowed;
  }
  const kind = (input.config ?? current.data.config).kind;
  const ownClient = input.oauthClient !== undefined && OWN_CLIENT_KINDS.has(kind);
  const customClient = ownClient
    ? keepStoredSecret(input.oauthClient ?? null, current.data.oauth.customClient)
    : undefined;
  if (kind === "google" && customClient && !customClient.clientSecret) {
    return fail("INVALID_INPUT", GOOGLE_SECRET_REQUIRED);
  }
  const renamed = await renameTo(key, input.name);
  if (renamed.error) return renamed;
  const target = renamed.data;
  if (input.config) {
    const saved = upsertSource(target.organizationId, { name: target.name, config: input.config });
    if (saved.error) return saved;
  }
  if (ownClient) {
    const stored = updateOAuth(target, { ...clearedLogin(kind), customClient });
    if (stored.error) return stored;
  }
  if (input.enabled !== undefined) {
    const toggled = updateEnabled(target, input.enabled);
    if (toggled.error) return toggled;
  }
  const renameOnly = input.config === undefined && input.enabled === undefined && input.oauthClient === undefined;
  if (input.enabled === false) await disconnectSource(target);
  else if (!renameOnly || current.data.enabled) await connectSource(target);
  return findSourceView(target);
};

const renameTo = async (key: SourceKey, name: string | undefined): Promise<Result<SourceKey>> => {
  if (name === undefined || name === key.name) return ok(key);
  const target = { organizationId: key.organizationId, name };
  const taken = findSource(target);
  if (!taken.error) return fail("ALREADY_EXISTS", `Já existe uma conexão chamada "${name}".`);
  if (taken.error.code !== "SOURCE_NOT_FOUND") return taken;
  await disconnectSource(key);
  const renamed = renameSource(key, name);
  return renamed.error ? renamed : ok(target);
};

export const testSource = async (key: SourceKey): Promise<Result<SourceView>> => {
  await connectSource(key);
  return findSourceView(key);
};

export const removeSource = async (key: SourceKey): Promise<Result<null>> => {
  const current = findSource(key);
  if (current.error) return current;
  await disconnectSource(key);
  return deleteSource(key);
};

const oauthStateFromImport = (oauth: ImportedOAuthInput, now = Date.now()): OAuthState => {
  const expiresIn = oauth.expiresAt ? Math.floor((oauth.expiresAt - now) / 1000) : undefined;
  return {
    client: { client_id: oauth.clientId, ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}) },
    tokens: {
      access_token: oauth.accessToken ?? "",
      token_type: oauth.tokenType ?? "Bearer",
      ...(oauth.refreshToken ? { refresh_token: oauth.refreshToken } : {}),
      ...(oauth.scope ? { scope: oauth.scope } : {}),
      ...(expiresIn !== undefined && expiresIn > 0 ? { expires_in: expiresIn } : {}),
    },
    verifier: undefined,
    imported: true,
  };
};

const importOne = async (organizationId: string, source: ImportSourceInput) => {
  const key = { organizationId, name: source.name };
  if (source.oauth && source.config.kind === "mcp") {
    const stored = updateOAuth(key, oauthStateFromImport(source.oauth));
    if (stored.error) return false;
  }
  const connected = await connectSource(key);
  return !connected.error;
};

export const importSources = async (
  organizationId: string,
  input: ImportSourcesInput,
  actor: SourceActor,
  blocked: ReadonlySet<string> = new Set(),
): Promise<Result<ImportView>> => {
  const parsed: Result<ImportSourceInput[]> =
    "config" in input ? parseClientConfig(input.config, {}) : ok(input.sources);
  if (parsed.error) return parsed;
  const checks = await Promise.all(
    parsed.data.map((source) =>
      blocked.has(source.name)
        ? fail("ACCESS_DENIED", ACCESS_MESSAGES.denied("source", source.name))
        : checkSourcePolicy(source.config, actor),
    ),
  );
  const permitted = parsed.data.filter((_, index) => !checks[index]?.error);
  const alreadyConnected = new Set(
    permitted
      .filter((source) => findSourceView({ organizationId, name: source.name }).data?.status === "ok")
      .map((source) => source.name),
  );
  const allowed = permitted.filter((source) => !alreadyConnected.has(source.name));
  const skipped = parsed.data.flatMap((source, index) => {
    const reason = checks[index]?.error?.message;
    return reason ? [{ name: source.name, reason }] : [];
  });
  const saved = upsertSources(
    organizationId,
    allowed.map(({ name, config }) => ({ name, config })),
  );
  if (saved.error) return saved;
  const results = await Promise.all(allowed.map((source) => importOne(organizationId, source)));
  return ok({
    imported: permitted.map((source) => source.name),
    connected: [...alreadyConnected, ...allowed.filter((_, index) => results[index]).map((source) => source.name)],
    skipped,
  });
};
