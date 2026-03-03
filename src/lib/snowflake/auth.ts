import crypto from "node:crypto";

/**
 * Generates a Snowflake JWT token using RSA key-pair authentication.
 * Ported from the Python implementation in cortex_agent_a2a/auth.py
 *
 * @param accountLocator - Short account locator (e.g. ABC12345) — used as upper case
 * @param user - Snowflake username — used as upper case
 * @param privateKeyPem - RSA private key in PEM/PKCS8 format (encrypted or unencrypted)
 * @param passphrase - Optional passphrase if the key is encrypted (BEGIN ENCRYPTED PRIVATE KEY)
 * @returns Signed JWT token string
 */
export function generateSnowflakeJwt(
  accountLocator: string,
  user: string,
  privateKeyPem: string,
  passphrase?: string,
): string {
  // Load the private key — use the object form so an optional passphrase can be supplied
  // for keys that start with "-----BEGIN ENCRYPTED PRIVATE KEY-----"
  const privateKey = crypto.createPrivateKey(
    passphrase ? { key: privateKeyPem, passphrase } : privateKeyPem,
  );

  // Derive the public key from the private key to compute its fingerprint
  const publicKey = crypto.createPublicKey(privateKey);

  // Export public key in DER/SubjectPublicKeyInfo format to match Python's
  // public_key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });

  // Compute SHA-256 fingerprint of the public key DER and base64-encode it
  const fingerprint = crypto
    .createHash("sha256")
    .update(publicKeyDer)
    .digest("base64");

  // Build qualified name with uppercase (required by Snowflake to avoid 403 errors)
  const qualifiedName = `${accountLocator.toUpperCase()}.${user.toUpperCase()}`;

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: `${qualifiedName}.SHA256:${fingerprint}`,
    sub: qualifiedName,
    iat: now,
    exp: now + 3600, // 1 hour expiration
  };

  // Manually create the JWT (header.payload) and sign it
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .sign("sha256", Buffer.from(signingInput), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    })
    .toString("base64url");

  return `${signingInput}.${signature}`;
}
