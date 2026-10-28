import { Button, HStack, Input, Menu, MenuButton, MenuItem, MenuList, Text, useToast, VStack } from "@chakra-ui/react";
import { ChevronDownIcon, LinkIcon, PlusIcon } from "@heroicons/react/24/outline";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clone,
  emptyOutbound,
  FINGERPRINTS,
  formToOutbound,
  FREEDOM_STRATEGIES,
  Json,
  linksToOutbounds,
  OUTBOUND_PROTOCOLS,
  OutboundForm,
  outboundToForm,
  parseShareLink,
  PROXY_PROTOCOLS,
  renameInRouting,
  rulesUsingOutbound,
  SS_METHODS,
  uniqueTag,
  validateOutbound,
  XrayConfig,
} from "utils/xrayConfig";
import {
  EditModal,
  Field,
  Grid,
  ItemRow,
  linkErrorMessage,
  PasteModal,
  RowActions,
  Section,
  SelectField,
  SmallButton,
  SwitchField,
} from "./fields";
import { TransportFields } from "./TransportFields";

const icon = { width: 14, height: 14 };

type Editing = { index: number | null; form: OutboundForm; original: Json; jsonOnly: boolean };

const DEFAULT_TAGS: Record<string, string> = {
  freedom: "DIRECT",
  blackhole: "BLOCK",
  wireguard: "WARP",
};

const summary = (outbound: Json): string => {
  const s: Json = outbound.settings || {};
  const server: Json = (s.vnext || s.servers || [])[0];
  if (server?.address) return `${server.address}:${server.port}`;
  if (outbound.protocol === "wireguard") return (s.peers || [])[0]?.endpoint || "";
  return "";
};

export const OutboundsEditor: FC<{ config: XrayConfig; onChange: (config: XrayConfig) => void }> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const outbounds = config.outbounds || [];
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);
  const [links, setLinks] = useState("");
  const [fillLink, setFillLink] = useState("");

  const showError = (title: string) => toast({ title, status: "error", position: "top", duration: 4000, isClosable: true });
  const error = (key: string) => showError(t(`coreEditor.errors.${key}`));
  const tags = (except: number | null = null) => outbounds.filter((_, i) => i !== except).map((outbound) => outbound.tag);
  const patch = (p: Partial<OutboundForm>) => setEditing((e) => e && { ...e, form: { ...e.form, ...p } });

  const open = (index: number | null, outbound?: Json, protocol = "freedom") => {
    const form = outbound ? outboundToForm(outbound) : null;
    setFillLink("");
    setEditing({
      index,
      original: outbound ? clone(outbound) : {},
      form: form || { ...emptyOutbound(protocol), tag: uniqueTag(DEFAULT_TAGS[protocol] || protocol.toUpperCase(), tags()) },
      jsonOnly: !!outbound && !form,
    });
  };

  const commit = (json: Json) => {
    if (!editing) return;
    const next = clone(config);
    next.outbounds = next.outbounds || [];
    if (editing.index === null) next.outbounds.push(json);
    else {
      renameInRouting(next, "outbound", next.outbounds[editing.index].tag, json.tag);
      next.outbounds[editing.index] = json;
    }
    onChange(next);
    setEditing(null);
  };

  const save = (json: Json | null) => {
    if (!editing) return;
    const taken = tags(editing.index);
    if (json) {
      if (typeof json.tag !== "string" || !json.tag.trim()) return error("tagRequired");
      if (taken.includes(json.tag)) return error("tagTaken");
      return commit(json);
    }
    const problem = validateOutbound(editing.form, taken);
    if (problem) return error(problem);
    commit(formToOutbound(editing.form, editing.original));
  };

  const remove = (index: number) => {
    const used = rulesUsingOutbound(config, outbounds[index].tag);
    if (used) return showError(String(t("coreEditor.errors.outboundInUse", { count: used })));
    if (outbounds.length === 1) return error("lastOutbound");
    const next = clone(config);
    next.outbounds!.splice(index, 1);
    onChange(next);
  };

  const move = (index: number, to: number) => {
    const next = clone(config);
    const [item] = next.outbounds!.splice(index, 1);
    next.outbounds!.splice(to, 0, item);
    onChange(next);
  };

  const importLinks = () => {
    try {
      const added = linksToOutbounds(links, tags());
      const next = clone(config);
      next.outbounds = [...(next.outbounds || []), ...added];
      onChange(next);
      setImporting(false);
      setLinks("");
      toast({ title: t("coreEditor.outboundsAdded", { count: added.length }), status: "success", position: "top", duration: 3000 });
    } catch (e) {
      showError(linkErrorMessage(t, e));
    }
  };

  const fillFromLink = () => {
    try {
      const proxy = parseShareLink(fillLink);
      setEditing((e) => e && { ...e, form: { ...e.form, ...proxy, tag: e.form.tag } });
      setFillLink("");
    } catch (e) {
      showError(linkErrorMessage(t, e));
    }
  };

  const form = editing?.form;
  const proxy = !!form && PROXY_PROTOCOLS.includes(form.protocol);

  return (
    <VStack spacing={2} align="stretch">
      <Text fontSize="xs" opacity={0.8}>
        {t("coreEditor.outboundsHint")}
      </Text>
      <HStack>
        <Menu>
          <MenuButton as={Button} size="xs" variant="outline" leftIcon={<PlusIcon {...icon} />} rightIcon={<ChevronDownIcon {...icon} />}>
            {t("coreEditor.addOutbound")}
          </MenuButton>
          <MenuList zIndex={10} fontSize="sm">
            {OUTBOUND_PROTOCOLS.map((protocol) => (
              <MenuItem key={protocol} onClick={() => open(null, undefined, protocol)}>
                {t(`coreEditor.outbound.${protocol}`)}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
        <SmallButton leftIcon={<LinkIcon {...icon} />} onClick={() => setImporting(true)}>
          {t("coreEditor.importLinks")}
        </SmallButton>
      </HStack>
      {outbounds.map((outbound, index) => (
        <ItemRow
          key={`${index}-${outbound.tag}`}
          title={outbound.tag || "-"}
          badges={[outbound.protocol, outbound.streamSettings?.security !== "none" && outbound.streamSettings?.security, index === 0 && t("coreEditor.defaultOutbound")]}
          subtitle={summary(outbound)}
          actions={
            <RowActions
              onUp={index > 0 ? () => move(index, index - 1) : undefined}
              onDown={index < outbounds.length - 1 ? () => move(index, index + 1) : undefined}
              onEdit={() => open(index, outbound)}
              onDuplicate={() => open(null, { ...clone(outbound), tag: uniqueTag(`${outbound.tag} copy`, tags()) })}
              onDelete={() => remove(index)}
            />
          }
        />
      ))}

      <PasteModal
        isOpen={importing}
        onClose={() => setImporting(false)}
        title={t("coreEditor.importLinks")}
        helper={t("coreEditor.importLinksHint")}
        value={links}
        onChange={setLinks}
        onSubmit={importLinks}
        submitLabel={t("coreEditor.import")}
      />

      {editing && form && (
        <EditModal
          isOpen
          onClose={() => setEditing(null)}
          title={t(editing.index === null ? "coreEditor.addOutbound" : "coreEditor.editOutbound")}
          jsonOnly={editing.jsonOnly}
          toJson={() => (editing.jsonOnly ? editing.original : formToOutbound(form, editing.original))}
          fromJson={(json) => {
            const next = outboundToForm(json);
            if (!next) return false;
            setEditing((e) => e && { ...e, original: json, form: next });
            return true;
          }}
          onSave={save}
        >
          <VStack spacing={3}>
            <Grid>
              <Field label={t("coreEditor.tag")} value={form.tag} isRequired onChange={(tag) => patch({ tag })} />
              <SelectField
                label={t("coreEditor.protocol")}
                value={form.protocol}
                options={OUTBOUND_PROTOCOLS.map((p) => ({ value: p, label: t(`coreEditor.outbound.${p}`) }))}
                onChange={(protocol) => patch({ protocol, ...(protocol === "shadowsocks" ? { security: "none", network: "tcp" } : {}) })}
              />
            </Grid>

            {proxy && (
              <HStack w="full" alignItems="flex-end">
                <Input
                  size="sm"
                  dir="ltr"
                  value={fillLink}
                  placeholder={t("coreEditor.fillFromLink")}
                  onChange={(e) => setFillLink(e.target.value)}
                />
                <Button size="sm" onClick={fillFromLink} isDisabled={!fillLink.trim()}>
                  {t("coreEditor.fill")}
                </Button>
              </HStack>
            )}

            {form.protocol === "freedom" && (
              <Grid>
                <SelectField
                  label={t("coreEditor.domainStrategy")}
                  value={form.domainStrategy}
                  options={FREEDOM_STRATEGIES}
                  onChange={(domainStrategy) => patch({ domainStrategy })}
                />
              </Grid>
            )}

            {form.protocol === "blackhole" && (
              <Text fontSize="sm" opacity={0.8} w="full">
                {t("coreEditor.blackholeHint")}
              </Text>
            )}

            {(form.protocol === "socks" || form.protocol === "http" || proxy) && (
              <Grid>
                <Field label={t("coreEditor.address")} value={form.address} isRequired onChange={(address) => patch({ address })} />
                <Field label={t("coreEditor.port")} value={form.port} isRequired onChange={(port) => patch({ port })} />
                {(form.protocol === "socks" || form.protocol === "http") && (
                  <>
                    <Field label={t("coreEditor.username")} value={form.user} onChange={(user) => patch({ user })} />
                    <Field label={t("coreEditor.password")} value={form.pass} onChange={(pass) => patch({ pass })} />
                  </>
                )}
                {(form.protocol === "vless" || form.protocol === "vmess") && (
                  <Field label="UUID" value={form.id} isRequired onChange={(id) => patch({ id })} />
                )}
                {form.protocol === "vless" && (
                  <SelectField
                    label="Flow"
                    value={form.flow}
                    options={[
                      { value: "", label: "none" },
                      { value: "xtls-rprx-vision", label: "xtls-rprx-vision" },
                    ]}
                    onChange={(flow) => patch({ flow })}
                  />
                )}
                {form.protocol === "vmess" && (
                  <SelectField
                    label={t("coreEditor.encryption")}
                    value={form.vmessSecurity}
                    options={["auto", "aes-128-gcm", "chacha20-poly1305", "none", "zero"]}
                    onChange={(vmessSecurity) => patch({ vmessSecurity })}
                  />
                )}
                {(form.protocol === "trojan" || form.protocol === "shadowsocks") && (
                  <Field label={t("coreEditor.password")} value={form.password} isRequired onChange={(password) => patch({ password })} />
                )}
                {form.protocol === "shadowsocks" && (
                  <SelectField label={t("coreEditor.method")} value={form.method} options={SS_METHODS} onChange={(method) => patch({ method })} />
                )}
              </Grid>
            )}

            {proxy && form.protocol !== "shadowsocks" && (
              <>
                <TransportFields value={form} onChange={patch} />
                <Section title={t("coreEditor.security")}>
                  <Grid>
                    <SelectField
                      label={t("coreEditor.security")}
                      value={form.security}
                      options={["none", "tls", "reality"]}
                      onChange={(security) => patch({ security })}
                    />
                    {form.security !== "none" && (
                      <>
                        <Field label="SNI" value={form.sni} onChange={(sni) => patch({ sni })} />
                        <SelectField
                          label={t("coreEditor.fingerprint")}
                          value={form.fingerprint}
                          options={[{ value: "", label: "-" }, ...FINGERPRINTS]}
                          onChange={(fingerprint) => patch({ fingerprint })}
                        />
                      </>
                    )}
                    {form.security === "tls" && (
                      <>
                        <Field label="ALPN" value={form.alpn} placeholder="h2,http/1.1" onChange={(alpn) => patch({ alpn })} />
                        <SwitchField
                          label={t("coreEditor.allowInsecure")}
                          isChecked={form.allowInsecure}
                          onChange={(allowInsecure) => patch({ allowInsecure })}
                        />
                      </>
                    )}
                    {form.security === "reality" && (
                      <>
                        <Field label={t("coreEditor.publicKey")} value={form.publicKey} isRequired onChange={(publicKey) => patch({ publicKey })} />
                        <Field label="Short ID" value={form.shortId} onChange={(shortId) => patch({ shortId })} />
                        <Field label="SpiderX" value={form.spiderX} onChange={(spiderX) => patch({ spiderX })} />
                      </>
                    )}
                  </Grid>
                </Section>
              </>
            )}

            {form.protocol === "wireguard" && (
              <Grid>
                <Field label={t("coreEditor.secretKey")} value={form.secretKey} isRequired onChange={(secretKey) => patch({ secretKey })} />
                <Field
                  label={t("coreEditor.wgAddress")}
                  value={form.wgAddress}
                  isRequired
                  onChange={(wgAddress) => patch({ wgAddress })}
                  helper={t("coreEditor.commaHint")}
                />
                <Field
                  label={t("coreEditor.peerPublicKey")}
                  value={form.peerPublicKey}
                  isRequired
                  onChange={(peerPublicKey) => patch({ peerPublicKey })}
                />
                <Field
                  label={t("coreEditor.endpoint")}
                  value={form.endpoint}
                  placeholder="engage.cloudflareclient.com:2408"
                  isRequired
                  onChange={(endpoint) => patch({ endpoint })}
                />
                <Field label="Reserved" value={form.reserved} placeholder="0,0,0" onChange={(reserved) => patch({ reserved })} />
                <Field label="MTU" value={form.mtu} placeholder="1280" onChange={(mtu) => patch({ mtu })} />
              </Grid>
            )}
          </VStack>
        </EditModal>
      )}
    </VStack>
  );
};
