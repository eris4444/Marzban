// Pure helpers behind the graphical core editor: Xray JSON <-> form values, share links
// (vless:// vmess:// trojan:// ss://) and routing presets. No React here, so it can be tested
// on its own (app/dashboard/tests/xrayConfig.test.ts).

export type Json = Record<string, any>;

export type XrayConfig = {
  inbounds?: Json[];
  outbounds?: Json[];
  routing?: { domainStrategy?: string; rules?: Json[]; balancers?: Json[]; [key: string]: any };
  [key: string]: any;
};

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Items separated by commas or new lines (server names, short IDs, ALPN, hosts). */
export const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

/** One item per line (routing domains and IPs, which may contain commas inside regexp:). */
export const splitLines = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

export const INBOUND_PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks"];
export const PROXY_PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks"];
export const OUTBOUND_PROTOCOLS = ["freedom", "blackhole", ...PROXY_PROTOCOLS, "socks", "http", "wireguard"];
export const TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade", "xhttp", "kcp"];
export const XHTTP_MODES = ["auto", "packet-up", "stream-up", "stream-one"];
export const KCP_HEADERS = ["none", "srtp", "utp", "wechat-video", "dtls", "wireguard"];
export const FINGERPRINTS = ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized"];
export const SS_METHODS = [
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
];
export const DOMAIN_STRATEGIES = ["AsIs", "IPIfNonMatch", "IPOnDemand"];
export const FREEDOM_STRATEGIES = ["AsIs", "UseIP", "UseIPv4", "UseIPv6"];
export const RULE_PROTOCOLS = ["http", "tls", "quic", "bittorrent"];
const TRANSPORT_KEYS = [
  "tcpSettings",
  "rawSettings",
  "wsSettings",
  "grpcSettings",
  "httpupgradeSettings",
  "xhttpSettings",
  "splithttpSettings",
  "kcpSettings",
  "httpSettings",
  "quicSettings",
];

/** A tag that isn't taken yet; commas are removed because Marzban rejects them. */
export const uniqueTag = (base: string, taken: string[]): string => {
  const clean = base.replace(/,/g, " ").replace(/\s+/g, " ").trim() || "TAG";
  if (!taken.includes(clean)) return clean;
  let n = 2;
  while (taken.includes(`${clean} ${n}`)) n++;
  return `${clean} ${n}`;
};

export const randomShortId = (length = 8): string => {
  const bytes = new Uint8Array(length / 2);
  const crypto = (globalThis as any).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// ---------------------------------------------------------------- transport

export type TransportForm = {
  network: string; // tcp | ws | grpc | httpupgrade | xhttp | kcp
  headerType: string; // tcp: none | http, kcp: one of KCP_HEADERS
  path: string; // ws / httpupgrade / xhttp path, path of the tcp http header
  host: string; // comma separated for the tcp http header
  serviceName: string; // grpc
  mode: string; // xhttp mode, grpc: "gun" or "multi"
  seed: string; // kcp
};

export const emptyTransport = (): TransportForm => ({
  network: "tcp",
  headerType: "none",
  path: "",
  host: "",
  serviceName: "",
  mode: "",
  seed: "",
});

const transportSettings = (t: TransportForm): Json => {
  const host = t.host.trim();
  switch (t.network) {
    case "tcp":
      if (t.headerType !== "http") return {};
      return {
        header: {
          type: "http",
          request: { path: [t.path.trim() || "/"], headers: host ? { Host: splitList(host) } : {} },
        },
      };
    case "ws":
    case "httpupgrade":
      return { path: t.path.trim() || "/", ...(host ? { host } : {}) };
    case "xhttp":
      return { path: t.path.trim() || "/", ...(host ? { host } : {}), mode: t.mode || "auto" };
    case "grpc":
      return { serviceName: t.serviceName.trim(), ...(t.mode === "multi" ? { multiMode: true } : {}) };
    case "kcp":
      return { header: { type: t.headerType || "none" }, ...(t.seed ? { seed: t.seed } : {}) };
    default:
      return {};
  }
};

export const readTransport = (stream: Json = {}): TransportForm => {
  let network = stream.network || "tcp";
  if (network === "raw") network = "tcp";
  if (network === "splithttp") network = "xhttp";
  const s: Json =
    stream[`${stream.network || "tcp"}Settings`] ||
    stream[`${network}Settings`] ||
    (network === "tcp" ? stream.rawSettings : undefined) ||
    {};
  const form = emptyTransport();
  form.network = network;
  if (network === "tcp") {
    const header = s.header || {};
    form.headerType = header.type === "http" ? "http" : "none";
    const request = header.request || {};
    form.path = Array.isArray(request.path) ? request.path[0] || "" : request.path || "";
    const hosts = (request.headers || {}).Host;
    form.host = Array.isArray(hosts) ? hosts.join(",") : hosts || "";
  } else if (network === "ws" || network === "httpupgrade" || network === "xhttp") {
    form.path = s.path || "";
    form.host = s.host || (s.headers || {}).Host || "";
    if (network === "xhttp") form.mode = s.mode || "auto";
  } else if (network === "grpc") {
    form.serviceName = s.serviceName || "";
    form.mode = s.multiMode ? "multi" : "gun";
  } else if (network === "kcp") {
    form.headerType = (s.header || {}).type || "none";
    form.seed = s.seed || "";
  }
  return form;
};

/** Replace the transport part of streamSettings, keeping every other key. */
const writeTransport = (stream: Json, t: TransportForm) => {
  for (const key of TRANSPORT_KEYS) delete stream[key];
  stream.network = t.network;
  const settings = transportSettings(t);
  if (Object.keys(settings).length) stream[`${t.network}Settings`] = settings;
};

// ---------------------------------------------------------------- inbounds

export type InboundForm = TransportForm & {
  tag: string;
  protocol: string;
  listen: string;
  port: string;
  sniffing: boolean;
  security: string; // none | tls | reality
  serverName: string; // tls
  alpn: string; // tls, comma separated
  certFile: string; // tls
  keyFile: string; // tls
  dest: string; // reality
  serverNames: string; // reality, comma separated
  privateKey: string; // reality
  shortIds: string; // reality, comma separated
};

export const emptyInbound = (): InboundForm => ({
  ...emptyTransport(),
  tag: "",
  protocol: "vless",
  listen: "",
  port: "",
  sniffing: true,
  security: "none",
  serverName: "",
  alpn: "",
  certFile: "",
  keyFile: "",
  dest: "",
  serverNames: "",
  privateKey: "",
  shortIds: "",
});

export const inboundToForm = (inbound: Json): InboundForm => {
  const stream: Json = inbound.streamSettings || {};
  const tls: Json = stream.tlsSettings || {};
  const reality: Json = stream.realitySettings || {};
  const certificate: Json = (tls.certificates || [])[0] || {};
  return {
    ...emptyInbound(),
    ...readTransport(stream),
    tag: inbound.tag || "",
    protocol: inbound.protocol || "vless",
    listen: inbound.listen || "",
    port: inbound.port === undefined || inbound.port === null ? "" : String(inbound.port),
    sniffing: !!(inbound.sniffing || {}).enabled,
    security: stream.security === "tls" || stream.security === "reality" ? stream.security : "none",
    serverName: tls.serverName || "",
    alpn: (tls.alpn || []).join(","),
    certFile: certificate.certificateFile || "",
    keyFile: certificate.keyFile || "",
    dest: reality.dest || reality.target || "",
    serverNames: (reality.serverNames || []).join(","),
    privateKey: reality.privateKey || "",
    shortIds: (reality.shortIds || []).join(","),
  };
};

/** The inbound JSON for a form; fields the form doesn't know stay as they were in `original`. */
export const formToInbound = (form: InboundForm, original: Json = {}): Json => {
  const inbound = clone(original);
  const protocolChanged = !!original.protocol && original.protocol !== form.protocol;
  inbound.tag = form.tag.trim();
  inbound.protocol = form.protocol;
  if (form.listen.trim()) inbound.listen = form.listen.trim();
  else delete inbound.listen;
  const port = form.port.trim();
  if (port) inbound.port = /^\d+$/.test(port) ? Number(port) : port;
  else delete inbound.port;

  // Marzban fills in the clients from its users
  const settings: Json = protocolChanged ? {} : clone(inbound.settings || {});
  settings.clients = settings.clients || [];
  if (form.protocol === "vless") settings.decryption = settings.decryption || "none";
  else delete settings.decryption;
  if (form.protocol === "shadowsocks") settings.network = settings.network || "tcp,udp";
  else delete settings.network;
  inbound.settings = settings;

  const stream: Json = clone(inbound.streamSettings || {});
  writeTransport(stream, form);
  if (form.security === "tls") {
    const tls: Json = { ...(stream.tlsSettings || {}) };
    if (form.serverName.trim()) tls.serverName = form.serverName.trim();
    else delete tls.serverName;
    const alpn = splitList(form.alpn);
    if (alpn.length) tls.alpn = alpn;
    else delete tls.alpn;
    if (form.certFile.trim() || form.keyFile.trim())
      tls.certificates = [{ certificateFile: form.certFile.trim(), keyFile: form.keyFile.trim() }];
    stream.security = "tls";
    stream.tlsSettings = tls;
    delete stream.realitySettings;
  } else if (form.security === "reality") {
    const reality: Json = { show: false, xver: 0, ...(stream.realitySettings || {}) };
    // Marzban prefers a stored publicKey over the private key, so a new private key drops it
    if (reality.privateKey !== form.privateKey.trim()) delete reality.publicKey;
    delete reality.target;
    reality.dest = form.dest.trim();
    reality.serverNames = splitList(form.serverNames);
    reality.privateKey = form.privateKey.trim();
    reality.shortIds = splitList(form.shortIds);
    stream.security = "reality";
    stream.realitySettings = reality;
    delete stream.tlsSettings;
  } else {
    stream.security = "none";
    delete stream.tlsSettings;
    delete stream.realitySettings;
  }
  inbound.streamSettings = stream;

  if (form.sniffing)
    inbound.sniffing = { destOverride: ["http", "tls", "quic"], ...(inbound.sniffing || {}), enabled: true };
  else if (inbound.sniffing) inbound.sniffing = { ...inbound.sniffing, enabled: false };
  return inbound;
};

const validPort = (port: string) => {
  const parts = port.split("-").map((p) => Number(p));
  return (
    /^\d+(-\d+)?$/.test(port) &&
    parts.every((p) => p >= 1 && p <= 65535) &&
    (parts.length === 1 || parts[0] <= parts[1])
  );
};

/** An error key (coreEditor.errors.*) or null. */
export const validateInbound = (form: InboundForm, takenTags: string[], hasCertificates = false): string | null => {
  const tag = form.tag.trim();
  if (!tag) return "tagRequired";
  if (tag.includes(",")) return "tagComma";
  if (takenTags.includes(tag)) return "tagTaken";
  const unixSocket = form.listen.trim().startsWith("@") || form.listen.trim().startsWith("/");
  if (!unixSocket && !validPort(form.port.trim())) return "port";
  if (form.security === "tls" && !hasCertificates && !(form.certFile.trim() && form.keyFile.trim()))
    return "certificate";
  if (form.security === "reality") {
    if (!form.dest.trim()) return "realityDest";
    if (!splitList(form.serverNames).length) return "realityServerNames";
    if (!form.privateKey.trim()) return "realityPrivateKey";
    const ids = splitList(form.shortIds);
    if (!ids.length || ids.some((id) => !/^[0-9a-fA-F]{0,16}$/.test(id) || id.length % 2)) return "realityShortIds";
  }
  return null;
};

// ---------------------------------------------------------------- share links

export type ProxyForm = TransportForm & {
  protocol: string; // vless | vmess | trojan | shadowsocks
  address: string;
  port: string;
  id: string; // vless / vmess
  flow: string; // vless
  vmessSecurity: string; // vmess
  password: string; // trojan / shadowsocks
  method: string; // shadowsocks
  security: string; // none | tls | reality
  sni: string;
  fingerprint: string;
  alpn: string;
  allowInsecure: boolean;
  publicKey: string; // reality
  shortId: string; // reality
  spiderX: string; // reality
  remark: string;
};

export const emptyProxy = (): ProxyForm => ({
  ...emptyTransport(),
  protocol: "vless",
  address: "",
  port: "",
  id: "",
  flow: "",
  vmessSecurity: "auto",
  password: "",
  method: "chacha20-ietf-poly1305",
  security: "none",
  sni: "",
  fingerprint: "",
  alpn: "",
  allowInsecure: false,
  publicKey: "",
  shortId: "",
  spiderX: "",
  remark: "",
});

const base64Decode = (value: string): string => {
  let text = value.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  while (text.length % 4) text += "=";
  const binary = atob(text);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const fromNetwork = (form: ProxyForm, network: string, params: Record<string, string>) => {
  let net = (network || "tcp").toLowerCase();
  if (net === "raw") net = "tcp";
  if (net === "splithttp") net = "xhttp";
  if (net === "gun") net = "grpc";
  if (!TRANSPORTS.includes(net)) throw new Error("unsupportedTransport");
  form.network = net;
  form.headerType = params.headerType || (net === "kcp" ? "none" : "none");
  form.path = params.path || "";
  form.host = params.host || "";
  form.serviceName = params.serviceName || (net === "grpc" ? params.path || "" : "");
  if (net === "grpc") {
    form.mode = params.mode === "multi" ? "multi" : "gun";
    form.path = "";
  } else if (net === "xhttp") form.mode = params.mode || "auto";
  if (net === "kcp") {
    form.seed = params.seed || params.path || "";
    form.path = "";
  }
};

/** Parse a vless://, vmess://, trojan:// or ss:// link. Throws Error(errorKey). */
export const parseShareLink = (link: string): ProxyForm => {
  const text = link.trim();
  const scheme = text.split("://")[0].toLowerCase();
  const form = emptyProxy();

  if (scheme === "vmess") {
    let data: Json;
    try {
      data = JSON.parse(base64Decode(text.slice(8).split("#")[0]));
    } catch {
      throw new Error("badLink");
    }
    form.protocol = "vmess";
    form.address = String(data.add || "");
    form.port = String(data.port || "");
    form.id = String(data.id || "");
    form.vmessSecurity = data.scy || "auto";
    form.remark = data.ps || "";
    fromNetwork(form, data.net, {
      headerType: data.type && data.type !== "none" ? data.type : "none",
      path: data.path || "",
      host: data.host || "",
      serviceName: data.net === "grpc" ? data.path || "" : "",
      mode: data.net === "grpc" ? (data.type === "multi" ? "multi" : "gun") : data.mode || "",
    });
    if (form.network === "kcp") form.seed = data.path || "";
    form.security = data.tls === "tls" || data.tls === "reality" ? data.tls : "none";
    form.sni = data.sni || "";
    form.fingerprint = data.fp || "";
    form.alpn = data.alpn || "";
    form.allowInsecure = data.allowInsecure === true || data.allowInsecure === "1";
    form.publicKey = data.pbk || "";
    form.shortId = data.sid || "";
    form.spiderX = data.spx || "";
  } else if (scheme === "vless" || scheme === "trojan" || scheme === "ss") {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error("badLink");
    }
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => (params[key] = value));
    form.remark = decode(url.hash.replace(/^#/, ""));
    form.address = url.hostname.replace(/^\[|\]$/g, "");
    form.port = url.port;

    if (scheme === "ss") {
      form.protocol = "shadowsocks";
      let userInfo: string;
      try {
        if (url.username) {
          // SIP002: ss://base64(method:password)@host:port or ss://method:password@host:port
          userInfo = decode(url.username);
          if (url.password) userInfo += `:${decode(url.password)}`;
          if (!userInfo.includes(":")) userInfo = base64Decode(userInfo);
        } else {
          // legacy: ss://base64(method:password@host:port)
          const legacy = base64Decode(text.slice(5).split("#")[0].split("?")[0]);
          const at = legacy.lastIndexOf("@");
          const hostPort = legacy.slice(at + 1);
          const portColon = hostPort.lastIndexOf(":");
          userInfo = legacy.slice(0, at);
          form.address = hostPort.slice(0, portColon).replace(/^\[|\]$/g, "");
          form.port = hostPort.slice(portColon + 1);
        }
      } catch {
        throw new Error("badLink");
      }
      const colon = userInfo.indexOf(":");
      form.method = userInfo.slice(0, colon);
      form.password = userInfo.slice(colon + 1);
      fromNetwork(form, "tcp", {});
    } else {
      form.protocol = scheme;
      if (scheme === "vless") form.id = decode(url.username);
      else form.password = decode(url.username);
      form.flow = params.flow || "";
      fromNetwork(form, params.type, params);
      form.security = params.security === "tls" || params.security === "reality" ? params.security : "none";
      // trojan links without security= are TLS by convention
      if (scheme === "trojan" && params.security === undefined) form.security = "tls";
      form.sni = params.sni || params.peer || "";
      form.fingerprint = params.fp || "";
      form.alpn = params.alpn || "";
      form.allowInsecure = params.allowInsecure === "1" || params.allowInsecure === "true";
      form.publicKey = params.pbk || "";
      form.shortId = params.sid || "";
      form.spiderX = params.spx || "";
    }
  } else {
    throw new Error("unsupportedLink");
  }

  if (!form.address || !validPort(form.port)) throw new Error("badLink");
  if ((form.protocol === "vless" || form.protocol === "vmess") && !form.id) throw new Error("badLink");
  if ((form.protocol === "trojan" || form.protocol === "shadowsocks") && !form.password) throw new Error("badLink");
  if (form.security === "reality" && !form.publicKey) throw new Error("realityNeedsPublicKey");
  return form;
};

// ---------------------------------------------------------------- outbounds

export type OutboundForm = ProxyForm & {
  tag: string;
  domainStrategy: string; // freedom
  user: string; // socks / http
  pass: string; // socks / http
  secretKey: string; // wireguard
  wgAddress: string; // wireguard, comma separated
  peerPublicKey: string; // wireguard
  endpoint: string; // wireguard
  reserved: string; // wireguard, e.g. "1,2,3"
  mtu: string; // wireguard
};

export const emptyOutbound = (protocol = "freedom"): OutboundForm => ({
  ...emptyProxy(),
  protocol,
  tag: "",
  domainStrategy: "AsIs",
  user: "",
  pass: "",
  secretKey: "",
  wgAddress: "172.16.0.2/32",
  peerPublicKey: "",
  endpoint: "",
  reserved: "",
  mtu: "",
});

const proxyStream = (form: ProxyForm, original: Json = {}): Json => {
  const stream: Json = clone(original);
  writeTransport(stream, form);
  delete stream.tlsSettings;
  delete stream.realitySettings;
  stream.security = form.security;
  if (form.security === "tls") {
    const tls: Json = {};
    if (form.sni) tls.serverName = form.sni;
    if (form.fingerprint) tls.fingerprint = form.fingerprint;
    const alpn = splitList(form.alpn);
    if (alpn.length) tls.alpn = alpn;
    if (form.allowInsecure) tls.allowInsecure = true;
    stream.tlsSettings = tls;
  } else if (form.security === "reality") {
    stream.realitySettings = {
      serverName: form.sni,
      fingerprint: form.fingerprint || "chrome",
      publicKey: form.publicKey,
      shortId: form.shortId,
      ...(form.spiderX ? { spiderX: form.spiderX } : {}),
    };
  }
  return stream;
};

/** The outbound JSON for a form; top-level keys the form doesn't know (mux, proxySettings...) stay. */
export const formToOutbound = (form: OutboundForm, original: Json = {}): Json => {
  const protocolChanged = !!original.protocol && original.protocol !== form.protocol;
  const outbound: Json = clone(original);
  outbound.tag = form.tag.trim();
  outbound.protocol = form.protocol;
  if (protocolChanged) delete outbound.streamSettings;
  const address = form.address.trim();
  const port = Number(form.port);
  const users = form.user ? [{ user: form.user, pass: form.pass }] : undefined;

  switch (form.protocol) {
    case "freedom":
      outbound.settings = form.domainStrategy && form.domainStrategy !== "AsIs" ? { domainStrategy: form.domainStrategy } : {};
      delete outbound.streamSettings;
      break;
    case "blackhole":
      outbound.settings = protocolChanged ? {} : outbound.settings || {};
      delete outbound.streamSettings;
      break;
    case "socks":
    case "http":
      outbound.settings = { servers: [{ address, port, ...(users ? { users } : {}) }] };
      break;
    case "wireguard": {
      const reserved = splitList(form.reserved).map(Number);
      outbound.settings = {
        secretKey: form.secretKey.trim(),
        address: splitList(form.wgAddress),
        peers: [{ publicKey: form.peerPublicKey.trim(), endpoint: form.endpoint.trim() }],
        ...(reserved.length ? { reserved } : {}),
        ...(form.mtu ? { mtu: Number(form.mtu) } : {}),
      };
      delete outbound.streamSettings;
      break;
    }
    case "vless":
      outbound.settings = {
        vnext: [{ address, port, users: [{ id: form.id.trim(), encryption: "none", ...(form.flow ? { flow: form.flow } : {}) }] }],
      };
      outbound.streamSettings = proxyStream(form, outbound.streamSettings);
      break;
    case "vmess":
      outbound.settings = {
        vnext: [{ address, port, users: [{ id: form.id.trim(), alterId: 0, security: form.vmessSecurity || "auto" }] }],
      };
      outbound.streamSettings = proxyStream(form, outbound.streamSettings);
      break;
    case "trojan":
      outbound.settings = { servers: [{ address, port, password: form.password }] };
      outbound.streamSettings = proxyStream(form, outbound.streamSettings);
      break;
    case "shadowsocks":
      outbound.settings = { servers: [{ address, port, method: form.method, password: form.password }] };
      outbound.streamSettings = proxyStream(form, outbound.streamSettings);
      break;
  }
  return outbound;
};

/** Form values of an outbound, or null when only the JSON editor can handle it. */
export const outboundToForm = (outbound: Json): OutboundForm | null => {
  const protocol = outbound.protocol;
  if (!OUTBOUND_PROTOCOLS.includes(protocol)) return null;
  const form = emptyOutbound(protocol);
  form.tag = outbound.tag || "";
  const s: Json = outbound.settings || {};
  const stream: Json = outbound.streamSettings || {};
  const server: Json = (s.vnext || s.servers || [])[0] || {};
  form.address = server.address || "";
  form.port = server.port ? String(server.port) : "";

  if (protocol === "freedom") form.domainStrategy = s.domainStrategy || "AsIs";
  if (protocol === "socks" || protocol === "http") {
    const user: Json = (server.users || [])[0] || {};
    form.user = user.user || "";
    form.pass = user.pass || "";
  }
  if (protocol === "wireguard") {
    const peer: Json = (s.peers || [])[0] || {};
    form.secretKey = s.secretKey || "";
    form.wgAddress = (s.address || []).join(",");
    form.peerPublicKey = peer.publicKey || "";
    form.endpoint = peer.endpoint || "";
    form.reserved = (s.reserved || []).join(",");
    form.mtu = s.mtu ? String(s.mtu) : "";
  }
  if (PROXY_PROTOCOLS.includes(protocol)) {
    const user: Json = (server.users || [])[0] || {};
    form.id = user.id || "";
    form.flow = user.flow || "";
    form.vmessSecurity = user.security || "auto";
    form.password = server.password || "";
    form.method = server.method || form.method;
    Object.assign(form, readTransport(stream));
    form.security = stream.security === "tls" || stream.security === "reality" ? stream.security : "none";
    const tls: Json = stream.tlsSettings || {};
    const reality: Json = stream.realitySettings || {};
    form.sni = tls.serverName || reality.serverName || "";
    form.fingerprint = tls.fingerprint || reality.fingerprint || "";
    form.alpn = (tls.alpn || []).join(",");
    form.allowInsecure = !!tls.allowInsecure;
    form.publicKey = reality.publicKey || "";
    form.shortId = reality.shortId || "";
    form.spiderX = reality.spiderX || "";
  }
  return form;
};

export const validateOutbound = (form: OutboundForm, takenTags: string[]): string | null => {
  const tag = form.tag.trim();
  if (!tag) return "tagRequired";
  if (takenTags.includes(tag)) return "tagTaken";
  if (["socks", "http", ...PROXY_PROTOCOLS].includes(form.protocol)) {
    if (!form.address.trim()) return "address";
    if (!/^\d+$/.test(form.port) || Number(form.port) < 1 || Number(form.port) > 65535) return "port";
  }
  if ((form.protocol === "vless" || form.protocol === "vmess") && !form.id.trim()) return "id";
  if ((form.protocol === "trojan" || form.protocol === "shadowsocks") && !form.password) return "password";
  if (PROXY_PROTOCOLS.includes(form.protocol) && form.security === "reality" && !form.publicKey.trim())
    return "realityPublicKey";
  if (form.protocol === "wireguard") {
    if (!form.secretKey.trim() || !form.peerPublicKey.trim()) return "wireguardKeys";
    if (!form.endpoint.trim()) return "wireguardEndpoint";
    if (!splitList(form.wgAddress).length) return "wireguardAddress";
  }
  return null;
};

/** Outbounds for share links, one per non-empty line. Throws Error("line N: errorKey"). */
export const linksToOutbounds = (text: string, takenTags: string[]): Json[] => {
  const taken = [...takenTags];
  const outbounds: Json[] = [];
  text
    .split("\n")
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) return;
      let proxy: ProxyForm;
      try {
        proxy = parseShareLink(line);
      } catch (e) {
        throw new Error(`${index + 1}:${(e as Error).message}`);
      }
      const tag = uniqueTag(proxy.remark || `${proxy.protocol}-${proxy.address}`, taken);
      taken.push(tag);
      outbounds.push(formToOutbound({ ...emptyOutbound(proxy.protocol), ...proxy, tag }));
    });
  return outbounds;
};

/** Inbound form values copied from a share link of another server (new keys are still needed). */
export const linkToInboundForm = (link: string, takenTags: string[]): InboundForm => {
  const proxy = parseShareLink(link);
  const form = emptyInbound();
  Object.assign(form, {
    network: proxy.network,
    headerType: proxy.headerType,
    path: proxy.path,
    host: proxy.host,
    serviceName: proxy.serviceName,
    mode: proxy.mode,
    seed: proxy.seed,
  });
  form.protocol = proxy.protocol;
  form.port = proxy.port;
  form.tag = uniqueTag(
    proxy.remark || `${proxy.protocol.toUpperCase()} ${proxy.network.toUpperCase()} ${proxy.security.toUpperCase()}`,
    takenTags
  );
  form.security = proxy.security;
  if (proxy.security === "tls") {
    form.serverName = proxy.sni;
    form.alpn = proxy.alpn;
  }
  if (proxy.security === "reality") {
    form.serverNames = proxy.sni;
    form.dest = proxy.sni ? `${proxy.sni}:443` : "";
    form.shortIds = proxy.shortId || randomShortId();
  }
  return form;
};

// ---------------------------------------------------------------- routing

export type RuleForm = {
  target: string; // "outbound:TAG" or "balancer:TAG"
  inboundTag: string[];
  domain: string; // one per line
  ip: string; // one per line
  port: string;
  sourcePort: string;
  network: string; // "", "tcp", "udp", "tcp,udp"
  protocol: string[];
  source: string; // one per line
  user: string; // one per line
};

export const emptyRule = (): RuleForm => ({
  target: "",
  inboundTag: [],
  domain: "",
  ip: "",
  port: "",
  sourcePort: "",
  network: "",
  protocol: [],
  source: "",
  user: "",
});

const asList = (value: any): string[] => (Array.isArray(value) ? value : value ? [String(value)] : []);

export const ruleToForm = (rule: Json): RuleForm => ({
  target: rule.balancerTag ? `balancer:${rule.balancerTag}` : rule.outboundTag ? `outbound:${rule.outboundTag}` : "",
  inboundTag: asList(rule.inboundTag),
  domain: asList(rule.domain).join("\n"),
  ip: asList(rule.ip).join("\n"),
  port: rule.port === undefined ? "" : String(rule.port),
  sourcePort: rule.sourcePort === undefined ? "" : String(rule.sourcePort),
  network: rule.network || "",
  protocol: asList(rule.protocol),
  source: asList(rule.source).join("\n"),
  user: asList(rule.user).join("\n"),
});

export const formToRule = (form: RuleForm, original: Json = {}): Json => {
  const rule: Json = { ...clone(original), type: "field" };
  const set = (key: string, value: any, keep: boolean) => {
    if (keep) rule[key] = value;
    else delete rule[key];
  };
  const [kind, ...rest] = form.target.split(":");
  const targetTag = rest.join(":");
  set("outboundTag", targetTag, kind === "outbound");
  set("balancerTag", targetTag, kind === "balancer");
  set("inboundTag", form.inboundTag, form.inboundTag.length > 0);
  set("domain", splitLines(form.domain), splitLines(form.domain).length > 0);
  set("ip", splitLines(form.ip), splitLines(form.ip).length > 0);
  set("port", form.port.trim(), !!form.port.trim());
  set("sourcePort", form.sourcePort.trim(), !!form.sourcePort.trim());
  set("network", form.network, !!form.network);
  set("protocol", form.protocol, form.protocol.length > 0);
  set("source", splitLines(form.source), splitLines(form.source).length > 0);
  set("user", splitLines(form.user), splitLines(form.user).length > 0);
  return rule;
};

const CONDITION_KEYS = ["inboundTag", "domain", "ip", "port", "sourcePort", "network", "protocol", "source", "user", "attrs"];

export const validateRule = (form: RuleForm, original: Json = {}): string | null => {
  if (!form.target) return "ruleTarget";
  const rule = formToRule(form, original);
  if (!CONDITION_KEYS.some((key) => rule[key] !== undefined)) return "ruleCondition";
  const ports = [form.port, form.sourcePort].map((p) => p.trim()).filter(Boolean);
  if (ports.some((p) => !/^\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*$/.test(p))) return "rulePort";
  return null;
};

/** A one-line description of a rule for the list. */
export const describeRule = (rule: Json): string => {
  const parts: string[] = [];
  const add = (label: string, value: any) => {
    const list = asList(value);
    if (!list.length) return;
    parts.push(`${label}: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` (+${list.length - 3})` : ""}`);
  };
  add("inbound", rule.inboundTag);
  add("domain", rule.domain);
  add("ip", rule.ip);
  add("port", rule.port);
  add("network", rule.network);
  add("protocol", rule.protocol);
  add("source", rule.source);
  add("user", rule.user);
  return parts.join(" · ") || "-";
};

/** The tag of the first outbound with this protocol, adding one (tag `fallbackTag`) when missing. */
export const ensureOutbound = (config: XrayConfig, protocol: string, fallbackTag: string): string => {
  config.outbounds = config.outbounds || [];
  const found = config.outbounds.find((o) => o.protocol === protocol);
  if (found) return found.tag;
  const tag = uniqueTag(fallbackTag, config.outbounds.map((o) => o.tag));
  config.outbounds.push({ protocol, tag, settings: {} });
  return tag;
};

export const RULE_PRESETS = ["blockAds", "blockBittorrent", "blockPrivate", "blockIran", "directIran"];

const IRAN_DOMAINS = ["geosite:category-ir", "regexp:.*\\.ir$"];

/** A copy of the config with the preset's rules appended (rules it already has are skipped). */
export const applyPreset = (source: XrayConfig, preset: string): XrayConfig => {
  const config = clone(source);
  const block = () => ensureOutbound(config, "blackhole", "BLOCK");
  const direct = () => ensureOutbound(config, "freedom", "DIRECT");
  const presets: Record<string, () => Json[]> = {
    blockAds: () => [{ type: "field", domain: ["geosite:category-ads-all"], outboundTag: block() }],
    blockBittorrent: () => [{ type: "field", protocol: ["bittorrent"], outboundTag: block() }],
    blockPrivate: () => [{ type: "field", ip: ["geoip:private"], outboundTag: block() }],
    blockIran: () => [
      { type: "field", domain: IRAN_DOMAINS, outboundTag: block() },
      { type: "field", ip: ["geoip:ir"], outboundTag: block() },
    ],
    directIran: () => [
      { type: "field", domain: IRAN_DOMAINS, outboundTag: direct() },
      { type: "field", ip: ["geoip:ir"], outboundTag: direct() },
    ],
  };
  const rules = presets[preset]?.() || [];
  config.routing = config.routing || {};
  config.routing.rules = config.routing.rules || [];
  for (const rule of rules) {
    const json = JSON.stringify(rule);
    if (!config.routing.rules.some((r) => JSON.stringify(r) === json)) config.routing.rules.push(rule);
  }
  return config;
};

/** Rename a tag everywhere routing refers to it. */
export const renameInRouting = (config: XrayConfig, kind: "inbound" | "outbound", from: string, to: string) => {
  if (from === to) return;
  for (const rule of config.routing?.rules || []) {
    if (kind === "outbound" && rule.outboundTag === from) rule.outboundTag = to;
    if (kind === "inbound" && Array.isArray(rule.inboundTag))
      rule.inboundTag = rule.inboundTag.map((tag: string) => (tag === from ? to : tag));
    if (kind === "inbound" && rule.inboundTag === from) rule.inboundTag = to;
  }
  if (kind === "outbound")
    for (const balancer of config.routing?.balancers || [])
      if (Array.isArray(balancer.selector))
        balancer.selector = balancer.selector.map((tag: string) => (tag === from ? to : tag));
};

/** Routing rules that point at an outbound tag. */
export const rulesUsingOutbound = (config: XrayConfig, tag: string) =>
  (config.routing?.rules || []).filter((rule) => rule.outboundTag === tag).length;
