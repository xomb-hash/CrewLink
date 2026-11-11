import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { AdapterError } from './types';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface GuardedResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

// Resolves every A/AAAA answer. Validation below rejects the host if any answer
// is non-public, so a mixed or rebinding record set cannot slip through.
export const defaultLookup: LookupFn = async (hostname) => {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family === 6 ? 6 : 4,
  }));
};

function ipv4Parts(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

// Rejects loopback, private, carrier-grade NAT, link-local, documentation,
// benchmarking, multicast, reserved and broadcast ranges.
function isPublicIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved and the broadcast address.
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const host = address.toLowerCase().split('%')[0];
  if (!net.isIPv6(host)) return false;
  if (host === '::' || host === '::1') return false;

  // IPv4-mapped (::ffff:a.b.c.d and ::ffff:hhhh:hhhh) must use the IPv4 rules.
  const mappedDotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (mappedDotted) {
    const parts = ipv4Parts(mappedDotted[1]);
    return Boolean(parts && isPublicIpv4(parts));
  }
  const mappedHex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPublicIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  // Only global unicast (2000::/3) is allowed. Everything else (unique-local
  // fc00::/7, link-local fe80::/10, multicast ff00::/8, NAT64, 6to4, discard)
  // is outside that range or explicitly denied below.
  const first = parseInt(host.split(':')[0] || '0', 16);
  if (first < 0x2000 || first > 0x3fff) return false;
  if (host.startsWith('2001:db8:')) return false;
  if (host.startsWith('2001:2:')) return false;
  if (host.startsWith('2001:10:') || host.startsWith('2001:20:')) return false;
  if (host.startsWith('2002:')) return false;
  if (host.startsWith('3fff:')) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(String(address || '').trim());
  if (family === 4) {
    const parts = ipv4Parts(address);
    return Boolean(parts && isPublicIpv4(parts));
  }
  if (family === 6) return isPublicIpv6(address);
  return false;
}

// Resolves a hostname and fails closed unless every answer is a public address.
// The returned address is the one the socket must be pinned to.
export async function resolvePublicAddresses(
  hostname: string,
  lookup: LookupFn = defaultLookup
): Promise<ResolvedAddress[]> {
  let records: ResolvedAddress[];
  try {
    records = await lookup(hostname);
  } catch {
    throw new AdapterError('The instance address could not be resolved.', 'transport_error');
  }
  if (!records.length) {
    throw new AdapterError('The instance address could not be resolved.', 'transport_error');
  }
  if (records.some((record) => !isPublicAddress(record.address))) {
    throw new AdapterError(
      'The instance must resolve to a public internet address.',
      'invalid_input'
    );
  }
  return records;
}

// HTTPS request that connects to the already-validated address. The custom
// `lookup` makes the socket ignore any later DNS answer for the hostname, which
// is what stops a rebinding record from redirecting the connection internally.
// Redirects are never followed; callers treat a 3xx as an instance error.
export function createPinnedLookup(pinned: ResolvedAddress) {
  // Node 20+ enables family autodetection, which calls `lookup` with `all: true`
  // and iterates the result as an array. Returning a single address there makes
  // Node throw ERR_INVALID_IP_ADDRESS before any socket opens, so both callback
  // shapes are supported.
  return (
    _hostname: string,
    options: dns.LookupOptions | number,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number
    ) => void
  ): void => {
    if (typeof options === 'object' && options !== null && options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

// TLS is verified against the original hostname: `hostname`/`servername` carry
// the Mastodon domain while only the socket address comes from the pinned DNS
// answer. `rejectUnauthorized` is never overridden, so verification stays on.
export function pinnedRequestOptions(
  target: URL,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; timeoutMs: number },
  pinned: ResolvedAddress
): https.RequestOptions {
  return {
    protocol: 'https:',
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    method: init.method,
    headers: init.headers,
    servername: target.hostname,
    timeout: init.timeoutMs,
    lookup: createPinnedLookup(pinned),
  };
}

export async function pinnedHttpsRequest(
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    lookup?: LookupFn;
  }
): Promise<GuardedResponse> {
  const target = new URL(url);
  if (target.protocol !== 'https:') {
    throw new AdapterError('The instance URL must use HTTPS.', 'invalid_input');
  }

  const addresses = await resolvePublicAddresses(target.hostname, init.lookup);
  const pinned = addresses[0];
  const timeoutMs = init.timeoutMs ?? 10_000;
  const maxBytes = init.maxResponseBytes ?? 1_000_000;

  return new Promise<GuardedResponse>((resolve, reject) => {
    let settled = false;
    let guard: NodeJS.Timeout | undefined;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof AdapterError
          ? error
          : new AdapterError('The instance could not be reached.', 'transport_error')
      );
    };

    const request = https.request(
      pinnedRequestOptions(target, { method: init.method, headers: init.headers, timeoutMs }, pinned),
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', fail);
        response.on('end', () => {
          if (settled) return;
          settled = true;
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item);
            } else if (value !== undefined) {
              headers.set(key, String(value));
            }
          }
          resolve({
            status: response.statusCode || 0,
            ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
            headers,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', fail);
    request.on('close', () => {
      if (guard) clearTimeout(guard);
    });
    // Hard cap even if the socket never emits its own timeout (slow drip).
    guard = setTimeout(() => request.destroy(new Error('request timed out')), timeoutMs);
    guard.unref?.();

    if (init.body) request.write(init.body);
    request.end();
  });
}
