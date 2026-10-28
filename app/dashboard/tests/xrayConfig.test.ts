// Tests for src/utils/xrayConfig.ts (the graphical core editor's logic).
//   node tests/xrayConfig.test.ts                       (Node >= 23 strips the types itself)
//   npx esbuild tests/xrayConfig.test.ts --bundle --platform=node --outfile=/tmp/t.js && node /tmp/t.js
import assert from "node:assert/strict";
import {
  applyPreset,
  describeRule,
  emptyInbound,
  emptyOutbound,
  emptyRule,
  formToInbound,
  formToOutbound,
  formToRule,
  inboundToForm,
  linksToOutbounds,
  linkToInboundForm,
  outboundToForm,
  parseShareLink,
  renameInRouting,
  ruleToForm,
  rulesUsingOutbound,
  uniqueTag,
  validateInbound,
  validateOutbound,
  validateRule,
} from "../src/utils/xrayConfig.ts";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    throw e;
  }
};
const throwsKey = (fn: () => unknown, key: string) => assert.throws(fn, (e: Error) => e.message === key);
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const UUID = "0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6";

test("vless reality link", () => {
  const p = parseShareLink(
    `vless://${UUID}@1.2.3.4:443?type=tcp&security=reality&sni=www.speedtest.net&fp=chrome&pbk=PUBKEY&sid=ab12&spx=%2F&flow=xtls-rprx-vision#My%20Server`
  );
  assert.equal(p.protocol, "vless");
  assert.equal(p.id, UUID);
  assert.equal(p.address, "1.2.3.4");
  assert.equal(p.port, "443");
  assert.equal(p.network, "tcp");
  assert.equal(p.security, "reality");
  assert.equal(p.sni, "www.speedtest.net");
  assert.equal(p.publicKey, "PUBKEY");
  assert.equal(p.shortId, "ab12");
  assert.equal(p.spiderX, "/");
  assert.equal(p.flow, "xtls-rprx-vision");
  assert.equal(p.remark, "My Server");
});

test("vless ws tls link becomes an outbound", () => {
  const p = parseShareLink(
    `vless://${UUID}@example.com:443?type=ws&security=tls&path=%2Fws%3Fed%3D2048&host=cdn.example.com&sni=cdn.example.com&alpn=h2%2Chttp%2F1.1&fp=firefox#WS`
  );
  const out = formToOutbound({ ...emptyOutbound("vless"), ...p, tag: "out" });
  assert.deepEqual(out.settings.vnext[0], {
    address: "example.com",
    port: 443,
    users: [{ id: UUID, encryption: "none" }],
  });
  assert.equal(out.streamSettings.network, "ws");
  assert.deepEqual(out.streamSettings.wsSettings, { path: "/ws?ed=2048", host: "cdn.example.com" });
  assert.deepEqual(out.streamSettings.tlsSettings, {
    serverName: "cdn.example.com",
    fingerprint: "firefox",
    alpn: ["h2", "http/1.1"],
  });
});

test("vmess link (base64 JSON, Persian remark)", () => {
  const link =
    "vmess://" +
    b64(JSON.stringify({ v: "2", ps: "سرور آلمان", add: "5.6.7.8", port: "8080", id: UUID, aid: "0", scy: "auto", net: "grpc", type: "multi", path: "svc", tls: "tls", sni: "g.example.com" }));
  const p = parseShareLink(link);
  assert.equal(p.protocol, "vmess");
  assert.equal(p.remark, "سرور آلمان");
  assert.equal(p.network, "grpc");
  assert.equal(p.serviceName, "svc");
  assert.equal(p.mode, "multi");
  assert.equal(p.security, "tls");
  const out = formToOutbound({ ...emptyOutbound("vmess"), ...p, tag: "vm" });
  assert.deepEqual(out.streamSettings.grpcSettings, { serviceName: "svc", multiMode: true });
  assert.equal(out.settings.vnext[0].users[0].security, "auto");
});

test("trojan link with IPv6 host and encoded password", () => {
  const p = parseShareLink("trojan://pass%40word@[2001:db8::1]:2083?type=grpc&serviceName=gsvc&sni=t.example.com#Tr");
  assert.equal(p.address, "2001:db8::1");
  assert.equal(p.password, "pass@word");
  assert.equal(p.security, "tls"); // no security= on a trojan link means TLS
  const out = formToOutbound({ ...emptyOutbound("trojan"), ...p, tag: "tr" });
  assert.deepEqual(out.settings.servers[0], { address: "2001:db8::1", port: 2083, password: "pass@word" });
});

test("shadowsocks links: SIP002 base64, plain 2022 cipher, legacy", () => {
  const sip = parseShareLink(`ss://${b64("chacha20-ietf-poly1305:secret")}@5.6.7.8:8388#SS`);
  assert.deepEqual([sip.method, sip.password, sip.address, sip.port], ["chacha20-ietf-poly1305", "secret", "5.6.7.8", "8388"]);
  const plain = parseShareLink("ss://2022-blake3-aes-128-gcm:YWJjZGVmZ2hpamtsbW5vcA%3D%3D@5.6.7.8:8443#SS2022");
  assert.deepEqual([plain.method, plain.password], ["2022-blake3-aes-128-gcm", "YWJjZGVmZ2hpamtsbW5vcA=="]);
  const legacy = parseShareLink(`ss://${b64("aes-256-gcm:pw@9.9.9.9:1234")}#Legacy`);
  assert.deepEqual([legacy.method, legacy.password, legacy.address, legacy.port], ["aes-256-gcm", "pw", "9.9.9.9", "1234"]);
  const out = formToOutbound({ ...emptyOutbound("shadowsocks"), ...legacy, tag: "ss" });
  assert.deepEqual(out.settings.servers[0], { address: "9.9.9.9", port: 1234, method: "aes-256-gcm", password: "pw" });
});

test("bad links are refused with a reason", () => {
  throwsKey(() => parseShareLink("http://example.com"), "unsupportedLink");
  throwsKey(() => parseShareLink("vless://@1.2.3.4:443?type=tcp"), "badLink");
  throwsKey(() => parseShareLink(`vless://${UUID}@1.2.3.4?type=tcp`), "badLink");
  throwsKey(() => parseShareLink("vmess://not-base64-json"), "badLink");
  throwsKey(() => parseShareLink(`vless://${UUID}@1.2.3.4:443?type=tcp&security=reality&sni=a.com`), "realityNeedsPublicKey");
  throwsKey(() => parseShareLink(`vless://${UUID}@1.2.3.4:443?type=quic`), "unsupportedTransport");
});

test("several links become outbounds with unique tags; errors name the line", () => {
  const link = `vless://${UUID}@1.2.3.4:443?type=tcp#Same`;
  const outbounds = linksToOutbounds(`${link}\n\n${link}\n`, ["Same"]);
  assert.deepEqual(outbounds.map((o) => o.tag), ["Same 2", "Same 3"]);
  throwsKey(() => linksToOutbounds(`${link}\nfoo://bar`, []), "2:unsupportedLink");
});

test("outbound forms round-trip for every protocol", () => {
  const forms = [
    { ...emptyOutbound("freedom"), tag: "DIRECT", domainStrategy: "UseIPv4" },
    { ...emptyOutbound("blackhole"), tag: "BLOCK" },
    { ...emptyOutbound("socks"), tag: "S", address: "127.0.0.1", port: "1080", user: "u", pass: "p" },
    { ...emptyOutbound("http"), tag: "H", address: "10.0.0.1", port: "8080" },
    { ...emptyOutbound("wireguard"), tag: "WARP", secretKey: "sk", peerPublicKey: "pk", endpoint: "engage.cloudflareclient.com:2408", reserved: "1,2,3", mtu: "1280" },
    { ...emptyOutbound("vless"), tag: "V", address: "a.com", port: "443", id: UUID, flow: "xtls-rprx-vision", security: "reality", sni: "a.com", publicKey: "pk", shortId: "ab" },
    { ...emptyOutbound("trojan"), tag: "T", address: "t.com", port: "443", password: "x", security: "tls", sni: "t.com", network: "ws", path: "/t" },
    { ...emptyOutbound("shadowsocks"), tag: "SS", address: "s.com", port: "8388", password: "pw", method: "aes-128-gcm" },
  ];
  for (const form of forms) {
    const json = formToOutbound(form);
    const back = outboundToForm(json)!;
    const again = formToOutbound(back);
    assert.deepEqual(again, json, form.tag);
    assert.equal(validateOutbound(back, []), null, form.tag);
  }
  assert.equal(outboundToForm({ tag: "dns-out", protocol: "dns" }), null);
});

test("outbound edit keeps keys the form doesn't know", () => {
  const original = { tag: "V", protocol: "vless", mux: { enabled: true }, settings: {}, streamSettings: { sockopt: { mark: 255 } } };
  const out = formToOutbound({ ...emptyOutbound("vless"), tag: "V", address: "a.com", port: "443", id: UUID }, original);
  assert.deepEqual(out.mux, { enabled: true });
  assert.deepEqual(out.streamSettings.sockopt, { mark: 255 });
});

test("outbound validation", () => {
  assert.equal(validateOutbound({ ...emptyOutbound("vless"), tag: "" }, []), "tagRequired");
  assert.equal(validateOutbound({ ...emptyOutbound("vless"), tag: "A" }, ["A"]), "tagTaken");
  assert.equal(validateOutbound({ ...emptyOutbound("vless"), tag: "A", address: "x", port: "0" }, []), "port");
  assert.equal(validateOutbound({ ...emptyOutbound("vless"), tag: "A", address: "x", port: "1" }, []), "id");
  assert.equal(validateOutbound({ ...emptyOutbound("wireguard"), tag: "W" }, []), "wireguardKeys");
});

test("inbound form round-trip: reality, tls, ws, tcp http header, grpc, xhttp, kcp", () => {
  const forms = [
    { ...emptyInbound(), tag: "VLESS TCP REALITY", port: "443", security: "reality", dest: "www.microsoft.com:443", serverNames: "www.microsoft.com,microsoft.com", privateKey: "PRIV", shortIds: "ab12,cd" },
    { ...emptyInbound(), tag: "VLESS WS TLS", port: "2083", network: "ws", path: "/ws", host: "a.com", security: "tls", serverName: "a.com", alpn: "h2,http/1.1", certFile: "/c.pem", keyFile: "/k.pem" },
    { ...emptyInbound(), tag: "VMESS TCP HTTP", protocol: "vmess", port: "8080", headerType: "http", path: "/", host: "a.com,b.com", sniffing: false },
    { ...emptyInbound(), tag: "TROJAN GRPC", protocol: "trojan", port: "2096", network: "grpc", serviceName: "svc", mode: "gun" },
    { ...emptyInbound(), tag: "VLESS XHTTP", port: "2053", network: "xhttp", path: "/x", mode: "packet-up" },
    { ...emptyInbound(), tag: "SS KCP", protocol: "shadowsocks", port: "1000-1010", network: "kcp", headerType: "wechat-video", seed: "s" },
  ];
  for (const form of forms) {
    const json = formToInbound(form);
    assert.deepEqual(formToInbound(inboundToForm(json)), json, form.tag);
    assert.equal(validateInbound(form, []), null, form.tag);
  }
  const reality = formToInbound(forms[0]);
  assert.deepEqual(reality.settings, { clients: [], decryption: "none" });
  assert.deepEqual(reality.streamSettings.realitySettings, {
    show: false,
    xver: 0,
    dest: "www.microsoft.com:443",
    serverNames: ["www.microsoft.com", "microsoft.com"],
    privateKey: "PRIV",
    shortIds: ["ab12", "cd"],
  });
  const tcpHttp = formToInbound(forms[2]);
  assert.deepEqual(tcpHttp.streamSettings.tcpSettings.header.request, { path: ["/"], headers: { Host: ["a.com", "b.com"] } });
  assert.equal(tcpHttp.sniffing, undefined);
  assert.equal(formToInbound(forms[5]).port, "1000-1010");
  assert.deepEqual(formToInbound(forms[5]).settings, { clients: [], network: "tcp,udp" });
});

test("inbound edit keeps unknown keys and drops a stale publicKey", () => {
  const original = {
    tag: "R",
    protocol: "vless",
    port: 443,
    settings: { clients: [], decryption: "none", fallbacks: [{ dest: 80 }] },
    streamSettings: {
      network: "tcp",
      security: "reality",
      sockopt: { tcpFastOpen: true },
      realitySettings: { privateKey: "OLD", publicKey: "OLDPUB", serverNames: ["a.com"], shortIds: ["ab"], dest: "a.com:443", SpiderX: "/x" },
    },
  };
  const form = inboundToForm(original);
  const same = formToInbound(form, original);
  assert.equal(same.streamSettings.realitySettings.publicKey, "OLDPUB");
  assert.deepEqual(same.settings.fallbacks, [{ dest: 80 }]);
  assert.deepEqual(same.streamSettings.sockopt, { tcpFastOpen: true });
  const rekeyed = formToInbound({ ...form, privateKey: "NEW" }, original);
  assert.equal(rekeyed.streamSettings.realitySettings.publicKey, undefined);
  assert.equal(rekeyed.streamSettings.realitySettings.SpiderX, "/x");
  const vmess = formToInbound({ ...form, protocol: "vmess" }, original);
  assert.deepEqual(vmess.settings, { clients: [] });
});

test("inbound validation", () => {
  const ok = { ...emptyInbound(), tag: "A", port: "443" };
  assert.equal(validateInbound({ ...ok, tag: " " }, []), "tagRequired");
  assert.equal(validateInbound({ ...ok, tag: "A,B" }, []), "tagComma");
  assert.equal(validateInbound(ok, ["A"]), "tagTaken");
  assert.equal(validateInbound({ ...ok, port: "70000" }, []), "port");
  assert.equal(validateInbound({ ...ok, port: "", listen: "@vless-ws" }, []), null);
  assert.equal(validateInbound({ ...ok, security: "tls" }, []), "certificate");
  assert.equal(validateInbound({ ...ok, security: "tls" }, [], true), null);
  const reality = { ...ok, security: "reality", dest: "a.com:443", serverNames: "a.com", privateKey: "K", shortIds: "abc" };
  assert.equal(validateInbound(reality, []), "realityShortIds");
  assert.equal(validateInbound({ ...reality, shortIds: "abcd" }, []), null);
  assert.equal(validateInbound({ ...reality, privateKey: "" }, []), "realityPrivateKey");
});

test("inbound copied from another server's link", () => {
  const form = linkToInboundForm(
    `vless://${UUID}@203.0.113.5:8443?type=xhttp&path=%2Fx&mode=stream-one&security=reality&sni=www.example.com&pbk=PUB&sid=a1b2#Copied`,
    ["Copied"]
  );
  assert.equal(form.tag, "Copied 2");
  assert.equal(form.port, "8443");
  assert.equal(form.network, "xhttp");
  assert.equal(form.mode, "stream-one");
  assert.equal(form.dest, "www.example.com:443");
  assert.equal(form.serverNames, "www.example.com");
  assert.equal(form.shortIds, "a1b2");
  assert.equal(validateInbound(form, []), "realityPrivateKey"); // keys of the other server can't be reused
});

test("routing rules round-trip and validation", () => {
  const rule = {
    type: "field",
    inboundTag: ["A"],
    domain: ["geosite:category-ir", "regexp:^a{1,3}\\.ir$"],
    ip: ["geoip:ir"],
    port: "53,443,1000-2000",
    network: "tcp,udp",
    protocol: ["bittorrent"],
    outboundTag: "BLOCK",
    ruleTag: "keep-me",
  };
  const form = ruleToForm(rule);
  assert.equal(form.target, "outbound:BLOCK");
  assert.deepEqual(formToRule(form, rule), rule);
  assert.equal(validateRule(form, rule), null);
  assert.equal(validateRule({ ...emptyRule(), domain: "a.com" }), "ruleTarget");
  assert.equal(validateRule({ ...emptyRule(), target: "outbound:X" }), "ruleCondition");
  assert.equal(validateRule({ ...emptyRule(), target: "outbound:X", port: "abc" }), "rulePort");
  const balanced = formToRule({ ...emptyRule(), target: "balancer:B", ip: "1.1.1.1" });
  assert.deepEqual(balanced, { type: "field", balancerTag: "B", ip: ["1.1.1.1"] });
  assert.equal(describeRule(rule), "inbound: A · domain: geosite:category-ir, regexp:^a{1,3}\\.ir$ · ip: geoip:ir · port: 53,443,1000-2000 · network: tcp,udp · protocol: bittorrent");
});

test("presets add DIRECT/BLOCK when missing and never duplicate rules", () => {
  const base = { inbounds: [], outbounds: [{ tag: "out", protocol: "vless" }], routing: { rules: [] } };
  const once = applyPreset(base, "blockIran");
  assert.deepEqual(once.outbounds!.map((o) => [o.tag, o.protocol]), [["out", "vless"], ["BLOCK", "blackhole"]]);
  assert.equal(once.routing!.rules!.length, 2);
  const twice = applyPreset(applyPreset(once, "blockIran"), "directIran");
  assert.equal(twice.routing!.rules!.length, 4);
  assert.equal(twice.outbounds!.find((o) => o.protocol === "freedom")!.tag, "DIRECT");
  assert.equal(base.routing.rules.length, 0); // the source config is never changed
  assert.equal(rulesUsingOutbound(twice, "BLOCK"), 2);
});

test("renaming keeps routing pointing at the right tags", () => {
  const config = {
    routing: {
      rules: [{ inboundTag: ["A", "B"], outboundTag: "X" }, { inboundTag: "A", outboundTag: "Y" }],
      balancers: [{ tag: "bal", selector: ["X", "Z"] }],
    },
  };
  renameInRouting(config, "outbound", "X", "X2");
  renameInRouting(config, "inbound", "A", "A2");
  assert.deepEqual(config.routing.rules, [{ inboundTag: ["A2", "B"], outboundTag: "X2" }, { inboundTag: "A2", outboundTag: "Y" }]);
  assert.deepEqual(config.routing.balancers[0].selector, ["X2", "Z"]);
});

test("unique tags", () => {
  assert.equal(uniqueTag("A, B", []), "A B");
  assert.equal(uniqueTag("A", ["A", "A 2"]), "A 3");
});

console.log(`${passed} passed`);
