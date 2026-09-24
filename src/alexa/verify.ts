/**
 * Checks that a request really came from Alexa, following Amazon's steps for skills hosted as
 * a web service: https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
 *
 * Without this, anyone who learns the endpoint URL could send the app fake phrases.
 */
import { createVerify, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

export class AlexaVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlexaVerificationError";
  }
}

/** Amazon rejects requests older (or newer) than this. */
const MAX_CLOCK_SKEW_MS = 150_000;
const SIGNING_CERT_SAN = "echo-api.amazon.com";
const MAX_CERT_CHAIN_BYTES = 64 * 1024;

/** The certificate URL must be https://s3.amazonaws.com[:443]/echo.api/... after normalization. */
export const isValidCertUrl = (raw: string) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // URL lowercases the scheme and host and resolves "..", so "/echo.api/../x" can't sneak past.
  return (
    url.protocol === "https:" &&
    url.hostname === "s3.amazonaws.com" &&
    (url.port === "" || url.port === "443") &&
    url.pathname.startsWith("/echo.api/")
  );
};

const splitPemChain = (pem: string) =>
  (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((c) => new X509Certificate(c));

const isCurrent = (cert: X509Certificate, now: Date) => new Date(cert.validFrom) <= now && now <= new Date(cert.validTo);

const issuedBy = (cert: X509Certificate, issuer: X509Certificate) =>
  cert.checkIssued(issuer) && cert.verify(issuer.publicKey);

/** Returns the signing certificate if the chain is current, for echo-api.amazon.com, and leads to a trusted root. */
const checkChain = (chain: X509Certificate[], trustedRoots: X509Certificate[], now: Date) => {
  const [signing] = chain;
  if (!signing) throw new AlexaVerificationError("certificate chain is empty");
  if (!chain.every((cert) => isCurrent(cert, now))) throw new AlexaVerificationError("certificate is expired or not yet valid");
  if (!signing.subjectAltName?.split(", ").includes(`DNS:${SIGNING_CERT_SAN}`)) {
    throw new AlexaVerificationError(`signing certificate is not for ${SIGNING_CERT_SAN}`);
  }

  for (let i = 0; i < chain.length - 1; i++) {
    const issuer = chain[i + 1]!;
    if (!issuer.ca || !issuedBy(chain[i]!, issuer)) throw new AlexaVerificationError("certificate chain is broken");
  }
  const last = chain[chain.length - 1]!;
  if (!trustedRoots.some((root) => isCurrent(root, now) && (last.fingerprint256 === root.fingerprint256 || issuedBy(last, root)))) {
    throw new AlexaVerificationError("certificate chain does not lead to a trusted root");
  }
  return signing;
};

const fetchText = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new AlexaVerificationError(`certificate download responded ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CERT_CHAIN_BYTES) throw new AlexaVerificationError("certificate chain is too large");
  return text;
};

type AlexaVerifierOptions = {
  /** Downloads the PEM chain. Swapped out in tests. */
  fetchCertChain?: (url: string) => Promise<string>;
  /** PEM root certificates to trust. Defaults to Node's bundled Mozilla roots, which include Amazon's CA. */
  trustedRoots?: readonly string[];
  now?: () => Date;
};

export const createAlexaVerifier = ({
  fetchCertChain = fetchText,
  trustedRoots = rootCertificates,
  now = () => new Date(),
}: AlexaVerifierOptions = {}) => {
  const roots = trustedRoots.map((pem) => new X509Certificate(pem));
  // Amazon reuses the same chain across requests, so keep verified chains (expiry is rechecked every time).
  const chainCache = new Map<string, X509Certificate[]>();

  const loadChain = async (certUrl: string) => {
    const cached = chainCache.get(certUrl);
    if (cached) return cached;
    let chain: X509Certificate[];
    try {
      chain = splitPemChain(await fetchCertChain(certUrl));
    } catch (err) {
      if (err instanceof AlexaVerificationError) throw err;
      throw new AlexaVerificationError(`could not load certificate chain (${(err as Error).message})`);
    }
    return chain;
  };

  /** Throws AlexaVerificationError unless `rawBody` was signed by Alexa. Pass the body exactly as received. */
  const verifySignature = async ({
    certUrl,
    signature,
    rawBody,
  }: {
    certUrl: string | undefined;
    signature: string | undefined;
    rawBody: Buffer;
  }) => {
    if (!certUrl || !signature) throw new AlexaVerificationError("missing signature headers");
    if (!isValidCertUrl(certUrl)) throw new AlexaVerificationError("certificate URL is not Amazon's");

    const chain = await loadChain(certUrl);
    const signing = checkChain(chain, roots, now());
    chainCache.set(certUrl, chain);

    const valid = createVerify("RSA-SHA256").update(rawBody).verify(signing.publicKey, signature, "base64");
    if (!valid) throw new AlexaVerificationError("signature does not match the request body");
  };

  /** Throws AlexaVerificationError if the request's timestamp is more than 150 seconds from now. */
  const verifyTimestamp = (timestamp: unknown) => {
    const sent = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    if (Number.isNaN(sent) || Math.abs(now().getTime() - sent) > MAX_CLOCK_SKEW_MS) {
      throw new AlexaVerificationError("request timestamp is missing or too far from now");
    }
  };

  return { verifySignature, verifyTimestamp };
};

export type AlexaVerifier = ReturnType<typeof createAlexaVerifier>;
