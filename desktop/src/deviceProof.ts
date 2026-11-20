// WebCrypto ECDSA uses P1363 (r||s); the backend accepts ASN.1 DER.
export function signatureDer(raw: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(raw);
  if (bytes.length !== 64) throw new Error('Invalid P-256 signature');
  const integer = (part: Uint8Array) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    const value = part.slice(start);
    return value[0] & 128 ? new Uint8Array([0, ...value]) : value;
  };
  const r = integer(bytes.slice(0, 32)),
    s = integer(bytes.slice(32));
  return new Uint8Array([
    48,
    r.length + s.length + 4,
    2,
    r.length,
    ...r,
    2,
    s.length,
    ...s,
  ]);
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
