// Used by tests/e2e/run.sh: the current core config plus inbounds, outbounds and routing rules made
// with the same helpers as the graphical editor, so the real panel and Xray must accept them.
//   node e2e-config.js CURRENT.json REALITY_PRIVATE_KEY > NEW.json
// New inbound ports: 20010-20015 over TCP, 20016 over UDP (kcp).
import { readFileSync } from "fs";
import {
  applyPreset,
  emptyInbound,
  emptyOutbound,
  emptyRule,
  formToInbound,
  formToOutbound,
  formToRule,
  linksToOutbounds,
  linkToInboundForm,
  validateInbound,
  validateOutbound,
  validateRule,
} from "../src/utils/xrayConfig.ts";
import type { XrayConfig } from "../src/utils/xrayConfig.ts";

const [currentFile, privateKey] = process.argv.slice(2);
let config: XrayConfig = JSON.parse(readFileSync(currentFile, "utf8"));
const inboundTags = () => (config.inbounds || []).map((i) => i.tag);
const outboundTags = () => (config.outbounds || []).map((o) => o.tag);
const UUID = "0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6";
const WG_KEY = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk="; // WireGuard takes standard base64
const REALITY_PUBLIC_KEY = "yAnz5TF-lXXJte14tji3zlMNq-hd2rYUIgJBgB3fBmk"; // REALITY takes raw URL base64

const addInbound = (form: ReturnType<typeof emptyInbound>) => {
  const error = validateInbound(form, inboundTags());
  if (error) throw new Error(`${form.tag}: ${error}`);
  config.inbounds!.push(formToInbound(form));
};

// copied from another server's share link; the REALITY key comes from the panel (/api/core/x25519)
const reality = linkToInboundForm(
  `vless://${UUID}@203.0.113.5:20010?type=tcp&security=reality&sni=www.example.com&fp=chrome&pbk=PUB&sid=a1b2#GUI VLESS REALITY`,
  inboundTags()
);
reality.privateKey = privateKey;
addInbound(reality);
addInbound({ ...emptyInbound(), tag: "GUI VMESS WS", protocol: "vmess", port: "20011", network: "ws", path: "/gui", host: "a.example.com" });
addInbound({ ...emptyInbound(), tag: "GUI TROJAN GRPC", protocol: "trojan", port: "20012", network: "grpc", serviceName: "gui" });
addInbound({ ...emptyInbound(), tag: "GUI SHADOWSOCKS", protocol: "shadowsocks", port: "20013" });
addInbound({ ...emptyInbound(), tag: "GUI VLESS XHTTP", port: "20014", network: "xhttp", path: "/xh", mode: "packet-up" });
addInbound({ ...emptyInbound(), tag: "GUI VLESS HTTPUPGRADE", port: "20015", network: "httpupgrade", path: "/hu", sniffing: false });
addInbound({ ...emptyInbound(), tag: "GUI VMESS KCP", protocol: "vmess", port: "20016", network: "kcp" });

config.outbounds!.push(
  ...linksToOutbounds(
    [
      `vless://${UUID}@203.0.113.6:443?type=tcp&security=reality&sni=www.example.com&fp=chrome&pbk=${REALITY_PUBLIC_KEY}&sid=a1b2&flow=xtls-rprx-vision#GUI OUT VLESS`,
      "vmess://" + Buffer.from(JSON.stringify({ v: "2", ps: "GUI OUT VMESS", add: "203.0.113.7", port: "80", id: UUID, aid: "0", net: "ws", path: "/v", host: "v.example.com", tls: "" })).toString("base64"),
      "trojan://secret@203.0.113.8:443?type=grpc&serviceName=t&sni=t.example.com#GUI OUT TROJAN",
      `ss://${Buffer.from("chacha20-ietf-poly1305:pw").toString("base64")}@203.0.113.9:8388#GUI OUT SS`,
    ].join("\n"),
    outboundTags()
  )
);
for (const form of [
  { ...emptyOutbound("wireguard"), tag: "GUI WARP", secretKey: WG_KEY, peerPublicKey: WG_KEY, endpoint: "203.0.113.10:2408", reserved: "1,2,3", mtu: "1280" },
  { ...emptyOutbound("socks"), tag: "GUI SOCKS", address: "127.0.0.1", port: "1080", user: "u", pass: "p" },
]) {
  const error = validateOutbound(form, outboundTags());
  if (error) throw new Error(`${form.tag}: ${error}`);
  config.outbounds!.push(formToOutbound(form));
}

for (const preset of ["blockAds", "blockBittorrent", "blockPrivate", "directIran"]) config = applyPreset(config, preset);
const rule = { ...emptyRule(), target: "outbound:GUI OUT VLESS", inboundTag: ["GUI VMESS WS"], domain: "domain:example.org\nkeyword:gui" };
const ruleError = validateRule(rule);
if (ruleError) throw new Error(`rule: ${ruleError}`);
config.routing!.rules!.push(formToRule(rule));
config.routing!.domainStrategy = "IPIfNonMatch";

process.stdout.write(JSON.stringify(config, null, 2));
