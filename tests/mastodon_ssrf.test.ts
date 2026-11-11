import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import './setup';
import {
  AdapterError,
  MastodonClient,
  isPublicAddress,
  resolvePublicAddresses,
  type FetchLike,
  type LookupFn,
} from '../src/posting/adapters/index';
import {
  createPinnedLookup,
  pinnedHttpsRequest,
  pinnedRequestOptions,
} from '../src/posting/adapters/ssrf';

const code = (err: unknown) => (err instanceof AdapterError ? err.code : 'unexpected');
const family = (address: string) => (address.includes(':') ? (6 as const) : (4 as const));

const lookupOf = (...addresses: string[]): LookupFn => {
  return async () => addresses.map((address) => ({ address, family: family(address) }));
};

const PUBLIC = lookupOf('93.184.216.34');
const INSTANCE = 'https://mastodon.test';

function fakeFetch(reply: () => Response) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return reply();
  };
  return { fetchImpl, calls };
}

test('SSRF address classification only allows public internet addresses', async (t) => {
  await t.test('public IPv4 and IPv6 are allowed', () => {
    for (const address of [
      '93.184.216.34',
      '8.8.8.8',
      '1.1.1.1',
      '100.63.255.255',
      '172.32.0.1',
      '2606:4700:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '::ffff:0808:0808',
    ]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  await t.test('loopback, private and reserved IPv4 are rejected', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '127.255.255.254',
      '100.64.0.1',
      '100.127.255.255',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.0.0.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  await t.test('non-global IPv6 and IPv4-mapped private addresses are rejected', () => {
    for (const address of [
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2001:2::1',
      '2001:10::1',
      '2001:20::1',
      '2002::1',
      '3fff::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  await t.test('non-address values are rejected', () => {
    assert.equal(isPublicAddress(''), false);
    assert.equal(isPublicAddress('mastodon.test'), false);
    assert.equal(isPublicAddress('1.2.3'), false);
    assert.equal(isPublicAddress('999.1.1.1'), false);
  });
});

test('DNS answers are validated as a set before any request', async (t) => {
  await t.test('a public answer set is accepted', async () => {
    const records = await resolvePublicAddresses('mastodon.test', PUBLIC);
    assert.deepEqual(records, [{ address: '93.184.216.34', family: 4 }]);
  });

  await t.test('private IPv4 or IPv6 answers fail closed', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', 'fd00::1', 'fe80::1']) {
      await assert.rejects(
        () => resolvePublicAddresses('mastodon.test', lookupOf(address)),
        (err) => code(err) === 'invalid_input',
        address
      );
    }
  });

  await t.test('a mixed public and private answer set is rejected', async () => {
    await assert.rejects(
      () => resolvePublicAddresses('mastodon.test', lookupOf('93.184.216.34', '10.0.0.5')),
      (err) => code(err) === 'invalid_input'
    );
    await assert.rejects(
      () =>
        resolvePublicAddresses(
          'mastodon.test',
          lookupOf('2606:4700:4700::1111', '::ffff:192.168.1.4')
        ),
      (err) => code(err) === 'invalid_input'
    );
  });

  await t.test('a failed or empty lookup is a transport error', async () => {
    await assert.rejects(
      () =>
        resolvePublicAddresses('mastodon.test', async () => {
          throw new Error('NXDOMAIN');
        }),
      (err) => code(err) === 'transport_error'
    );
    await assert.rejects(
      () => resolvePublicAddresses('mastodon.test', async () => []),
      (err) => code(err) === 'transport_error'
    );
  });
});

test('Mastodon calls never reach a private destination', async (t) => {
  await t.test('a private IPv4 answer stops app registration before the transport', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}'));
    const client = new MastodonClient({ fetchImpl, lookup: lookupOf('10.0.0.7') });
    await assert.rejects(
      () => client.registerApp(INSTANCE, 'https://crewlink.test/callback'),
      (err) => code(err) === 'invalid_input'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a private IPv6 answer stops verification before the transport', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}'));
    const client = new MastodonClient({ fetchImpl, lookup: lookupOf('fd12::5') });
    await assert.rejects(
      () => client.verifyAccount(INSTANCE, 'access-token'),
      (err) => code(err) === 'invalid_input'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('the metadata endpoint is rejected', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}'));
    const client = new MastodonClient({
      fetchImpl,
      lookup: lookupOf('169.254.169.254'),
    });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'invalid_input'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a hostname that fails DNS is a transport error', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}'));
    const client = new MastodonClient({
      fetchImpl,
      lookup: async () => {
        throw new Error('NXDOMAIN');
      },
    });
    await assert.rejects(
      () => client.registerApp(INSTANCE, 'https://crewlink.test/callback'),
      (err) => code(err) === 'transport_error'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a rebinding answer set cannot reuse the first public result', async () => {
    let call = 0;
    const lookup: LookupFn = async () => {
      call += 1;
      return call === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    };
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ client_id: 'id', client_secret: 'secret' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    const client = new MastodonClient({ fetchImpl, lookup });

    await client.registerApp(INSTANCE, 'https://crewlink.test/callback');
    assert.equal(calls.length, 1);

    // Every request re-resolves; the second answer is private and must fail.
    await assert.rejects(
      () => client.registerApp(INSTANCE, 'https://crewlink.test/callback'),
      (err) => code(err) === 'invalid_input'
    );
    assert.equal(calls.length, 1);
  });
});

test('The pinned transport keeps TLS and the socket bound to the validated answer', async (t) => {
  const pinned = { address: '93.184.216.34', family: 4 as const };

  await t.test('SNI and hostname verification use the Mastodon host, not the IP', () => {
    const options = pinnedRequestOptions(
      new URL('https://mastodon.test/api/v1/apps'),
      { method: 'POST', headers: { accept: 'application/json' }, timeoutMs: 5_000 },
      pinned
    );
    assert.equal(options.protocol, 'https:');
    assert.equal(options.hostname, 'mastodon.test');
    assert.equal(options.servername, 'mastodon.test');
    // Verification is never disabled; Node's default stays in force.
    assert.equal(options.rejectUnauthorized, undefined);
    assert.equal(options.port, 443);
  });

  await t.test('the lookup satisfies both single-address and family-autodetect callers', () => {
    type PinnedLookup = (
      hostname: string,
      options: unknown,
      callback: (...args: unknown[]) => void
    ) => void;
    const lookup = createPinnedLookup(pinned) as unknown as PinnedLookup;

    let single: unknown[] = [];
    lookup('mastodon.test', { family: 0 }, (...args) => {
      single = args;
    });
    assert.deepEqual(single, [null, '93.184.216.34', 4]);

    // Node 20+ calls this shape for family autodetection; a non-array return
    // throws ERR_INVALID_IP_ADDRESS before any socket opens.
    let all: unknown[] = [];
    lookup('mastodon.test', { all: true }, (...args) => {
      all = args;
    });
    assert.deepEqual(all, [null, [{ address: '93.184.216.34', family: 4 }]]);
  });

  await t.test('the socket connects to the pinned address with the hostname intact', async () => {
    const server = net.createServer();
    const accepted = new Promise<string>((resolve) => {
      server.once('connection', (socket) => {
        resolve(socket.remoteAddress || '');
        socket.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    try {
      const request = https.request({
        hostname: 'mastodon.test',
        port,
        method: 'GET',
        servername: 'mastodon.test',
        lookup: createPinnedLookup({ address: '127.0.0.1', family: 4 }),
      });
      request.on('error', () => {});
      request.end();

      const remote = await Promise.race([
        accepted,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('socket was not opened')), 3_000)
        ),
      ]);
      // The certificate handshake fails (plain TCP), but the TCP destination is
      // the validated address, never a fresh DNS answer.
      assert.equal(remote, '127.0.0.1');
      request.destroy();
    } finally {
      server.close();
    }
  });
});

test('Mastodon redirects are refused instead of followed', async (t) => {
  await t.test('a redirect to a loopback URL is an instance error', async () => {
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response('', {
          status: 302,
          headers: { location: 'http://127.0.0.1:8080/admin' },
        })
    );
    const client = new MastodonClient({ fetchImpl, lookup: PUBLIC });
    await assert.rejects(
      () => client.registerApp(INSTANCE, 'https://crewlink.test/callback'),
      (err) => code(err) === 'instance_error'
    );
    assert.equal(calls.length, 1);
  });

  await t.test('a redirect to a private hostname is an instance error', async () => {
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response('', {
          status: 307,
          headers: { location: 'https://metadata.google.internal/computeMetadata/v1/' },
        })
    );
    const client = new MastodonClient({ fetchImpl, lookup: PUBLIC });
    await assert.rejects(
      () => client.verifyAccount(INSTANCE, 'access-token'),
      (err) => code(err) === 'instance_error'
    );
    assert.equal(calls.length, 1);
  });

  await t.test('the production transport validates before opening a socket', async () => {
    await assert.rejects(
      () =>
        pinnedHttpsRequest('http://mastodon.test/api/v1/apps', {
          method: 'GET',
          headers: {},
          lookup: PUBLIC,
        }),
      (err) => code(err) === 'invalid_input'
    );

    await assert.rejects(
      () =>
        pinnedHttpsRequest('https://mastodon.test/api/v1/apps', {
          method: 'GET',
          headers: {},
          lookup: lookupOf('192.168.0.10'),
        }),
      (err) => code(err) === 'invalid_input'
    );

    await assert.rejects(
      () =>
        pinnedHttpsRequest('https://mastodon.test/api/v1/apps', {
          method: 'GET',
          headers: {},
          lookup: async () => {
            throw new Error('NXDOMAIN');
          },
        }),
      (err) => code(err) === 'transport_error'
    );
  });
});
