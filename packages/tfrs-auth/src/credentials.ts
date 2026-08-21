import {
  robotAudience,
  scopesToString,
  SubjectTokenType,
  type TokenProfile,
} from "./contract.js";
import {
  buildClientCredentialsForm,
  buildTokenExchangeForm,
} from "./exchange.js";

export type Credential = {
  requestForm(): Record<string, string>;
};

export class ClientCredentials implements Credential {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly scope: string | undefined;

  constructor(options: {
    clientId: string;
    clientSecret: string;
    audience: string;
    scope?: string;
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.audience = options.audience;
    this.scope = options.scope === "" ? undefined : options.scope;
  }

  static forRobot(options: {
    clientId: string;
    clientSecret: string;
    calleeOrgSlug: string;
    calleeEmployeeNo: string;
    scope?: Iterable<string> | string;
  }): ClientCredentials {
    const scope =
      typeof options.scope === "string"
        ? options.scope
        : options.scope === undefined
          ? undefined
          : scopesToString(options.scope);
    return new ClientCredentials({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      audience: robotAudience(
        options.calleeOrgSlug,
        options.calleeEmployeeNo,
      ),
      ...(scope ? { scope } : {}),
    });
  }

  requestForm(): Record<string, string> {
    return buildClientCredentialsForm({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      audience: this.audience,
      scope: this.scope,
    });
  }
}

export class PatCredential implements Credential {
  readonly pat: string;
  readonly audience: string;
  readonly scope: string | undefined;

  constructor(options: { pat: string; audience: string; scope?: string }) {
    this.pat = options.pat;
    this.audience = options.audience;
    this.scope = options.scope === "" ? undefined : options.scope;
  }

  requestForm(): Record<string, string> {
    return buildTokenExchangeForm({
      subjectToken: this.pat,
      subjectTokenType: SubjectTokenType.AccessToken,
      audience: this.audience,
      scope: this.scope,
    });
  }
}

export class UserJwtCredential implements Credential {
  readonly userJwt: string;
  readonly audience: string;
  readonly scope: string | undefined;
  readonly tokenProfile: TokenProfile | undefined;

  constructor(options: {
    userJwt: string;
    audience: string;
    scope?: string;
    tokenProfile?: TokenProfile;
  }) {
    this.userJwt = options.userJwt;
    this.audience = options.audience;
    this.scope = options.scope === "" ? undefined : options.scope;
    this.tokenProfile = options.tokenProfile;
  }

  requestForm(): Record<string, string> {
    return buildTokenExchangeForm({
      subjectToken: this.userJwt,
      subjectTokenType: SubjectTokenType.Jwt,
      audience: this.audience,
      scope: this.scope,
      tokenProfile: this.tokenProfile,
    });
  }
}
