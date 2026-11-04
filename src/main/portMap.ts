// Прямой TCP-порт на роутере. Игроки ходят на домашний адрес, минуя VPS-реле.

import * as dgram from 'dgram';
import * as http from 'http';
import { URL } from 'url';

const SSDP = '239.255.255.250';
const SEARCH = Buffer.from(
  [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP}:1900`,
    'MAN: "ssdp:discover"',
    'MX: 1',
    'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
    '',
    '',
  ].join('\r\n'),
);

interface Gateway {
  controlUrl: string;
  service: string;
  host: string;
}

interface ActiveMap {
  gateway: Gateway;
  port: number;
}

let active: ActiveMap | null = null;

function httpText(url: string, method: string, headers: Record<string, string>, body = ''): Promise<string> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        timeout: 4000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(text.replace(/\s+/g, ' ').slice(0, 180) || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Роутер не ответил')));
    req.on('error', reject);
    req.end(body);
  });
}

function discoverGateway(): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* сокет уже закрыт */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 2500);
    sock.on('error', () => finish(null));
    sock.on('message', (msg) => {
      const found = msg.toString('utf8').match(/^LOCATION:\s*(\S+)/im);
      if (found) finish(found[1].trim());
    });
    try {
      sock.bind({ port: 0, exclusive: false }, () => {
        try {
          sock.setBroadcast(true);
          sock.setMulticastTTL(2);
        } catch {
          /* на части систем эти флаги недоступны, поиск всё равно уходит */
        }
        try {
          sock.send(SEARCH, 1900, SSDP);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

function controlFromXml(xml: string, location: string): Gateway | null {
  const parts = xml.split(/<service>/i).slice(1);
  for (const block of parts) {
    const service = block.match(/<serviceType>\s*([^<]+)/i)?.[1]?.trim() || '';
    if (!/WANIPConnection|WANPPPConnection/i.test(service)) continue;
    const raw = block.match(/<controlURL>\s*([^<]+)/i)?.[1]?.trim();
    if (!raw) continue;
    const controlUrl = new URL(raw, location).toString();
    return { controlUrl, service, host: new URL(location).hostname };
  }
  return null;
}

function soap(gateway: Gateway, action: string, inner: string): Promise<string> {
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${gateway.service}">
      ${inner}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
  return httpText(gateway.controlUrl, 'POST', {
    'Content-Type': 'text/xml; charset="utf-8"',
    SOAPAction: `"${gateway.service}#${action}"`,
    'Content-Length': String(Buffer.byteLength(body)),
  }, body);
}

function localAddress(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const fail = (err: Error) => {
      try {
        sock.close();
      } catch {
        /* уже закрыт */
      }
      reject(err);
    };
    sock.once('error', fail);
    sock.connect(1900, host, () => {
      const address = sock.address().address;
      sock.close();
      resolve(address);
    });
  });
}

async function gateway(): Promise<Gateway | null> {
  const location = await discoverGateway();
  if (!location) return null;
  try {
    const xml = await httpText(location, 'GET', {});
    return controlFromXml(xml, location);
  } catch {
    return null;
  }
}

export async function unmapTcpPort(): Promise<void> {
  const current = active;
  active = null;
  if (!current) return;
  try {
    await soap(
      current.gateway,
      'DeletePortMapping',
      `<NewRemoteHost></NewRemoteHost><NewExternalPort>${current.port}</NewExternalPort><NewProtocol>TCP</NewProtocol>`,
    );
  } catch {
    /* роутер уже забыл правило или недоступен */
  }
}

/** Открывает внешний TCP-порт, равный локальному. null — роутер не умеет UPnP или отказал. */
export async function mapTcpPort(port: number): Promise<{ host: string; port: number } | null> {
  await unmapTcpPort();
  const found = await gateway();
  if (!found) return null;
  let client = '';
  try {
    client = await localAddress(found.host);
  } catch {
    return null;
  }
  try {
    await soap(
      found,
      'AddPortMapping',
      [
        '<NewRemoteHost></NewRemoteHost>',
        `<NewExternalPort>${port}</NewExternalPort>`,
        '<NewProtocol>TCP</NewProtocol>',
        `<NewInternalPort>${port}</NewInternalPort>`,
        `<NewInternalClient>${client}</NewInternalClient>`,
        '<NewEnabled>1</NewEnabled>',
        '<NewPortMappingDescription>UClient</NewPortMappingDescription>',
        '<NewLeaseDuration>0</NewLeaseDuration>',
      ].join(''),
    );
  } catch {
    return null;
  }
  active = { gateway: found, port };
  let external = '';
  try {
    const xml = await soap(found, 'GetExternalIPAddress', '');
    external = xml.match(/<NewExternalIPAddress>\s*([^<]+)/i)?.[1]?.trim() || '';
  } catch {
    external = '';
  }
  if (!external || external === '0.0.0.0') {
    await unmapTcpPort();
    return null;
  }
  return { host: external, port };
}
