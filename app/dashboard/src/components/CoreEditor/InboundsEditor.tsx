import { Box, Code, HStack, Text, useToast, VStack } from "@chakra-ui/react";
import { KeyIcon, LinkIcon, PlusIcon } from "@heroicons/react/24/outline";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";
import {
  clone,
  emptyInbound,
  formToInbound,
  INBOUND_PROTOCOLS,
  InboundForm,
  inboundToForm,
  Json,
  linkToInboundForm,
  randomShortId,
  renameInRouting,
  splitList,
  uniqueTag,
  validateInbound,
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

type Editing = { index: number | null; form: InboundForm; original: Json; jsonOnly: boolean };

export const realityKeys = (privateKey?: string) =>
  fetch<{ private_key: string; public_key: string }>("/core/x25519", {
    query: privateKey ? { private_key: privateKey } : {},
  });

export const InboundsEditor: FC<{ config: XrayConfig; onChange: (config: XrayConfig) => void }> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const inbounds = config.inbounds || [];
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);

  const showError = (title: string) => toast({ title, status: "error", position: "top", duration: 4000, isClosable: true });
  const error = (key: string) => showError(t(`coreEditor.errors.${key}`));
  const tags = (except: number | null = null) => inbounds.filter((_, i) => i !== except).map((inbound) => inbound.tag);
  const patch = (p: Partial<InboundForm>) => setEditing((e) => e && { ...e, form: { ...e.form, ...p } });

  const open = (index: number | null, inbound?: Json) => {
    const supported = !inbound || INBOUND_PROTOCOLS.includes(inbound.protocol);
    setPublicKey("");
    setEditing({
      index,
      original: inbound ? clone(inbound) : {},
      form: inbound && supported ? inboundToForm(inbound) : { ...emptyInbound(), tag: uniqueTag("NEW INBOUND", tags()) },
      jsonOnly: !supported,
    });
  };

  const commit = (json: Json) => {
    if (!editing) return;
    const next = clone(config);
    next.inbounds = next.inbounds || [];
    if (editing.index === null) next.inbounds.push(json);
    else {
      renameInRouting(next, "inbound", next.inbounds[editing.index].tag, json.tag);
      next.inbounds[editing.index] = json;
    }
    onChange(next);
    setEditing(null);
  };

  const save = (json: Json | null) => {
    if (!editing) return;
    const taken = tags(editing.index);
    if (json) {
      if (typeof json.tag !== "string" || !json.tag.trim()) return error("tagRequired");
      if (json.tag.includes(",")) return error("tagComma");
      if (taken.includes(json.tag)) return error("tagTaken");
      return commit(json);
    }
    const hasCertificates = !!editing.original.streamSettings?.tlsSettings?.certificates?.length;
    const problem = validateInbound(editing.form, taken, hasCertificates);
    if (problem) return error(problem);
    commit(formToInbound(editing.form, editing.original));
  };

  const remove = (index: number) => {
    const next = clone(config);
    next.inbounds!.splice(index, 1);
    onChange(next);
  };

  const generateKeys = () => {
    setBusy(true);
    realityKeys()
      .then((keys) => {
        patch({ privateKey: keys.private_key });
        setPublicKey(keys.public_key);
      })
      .catch(() => error("keys"))
      .finally(() => setBusy(false));
  };

  const showPublicKey = () => {
    if (!editing?.form.privateKey.trim()) return error("realityPrivateKey");
    realityKeys(editing.form.privateKey.trim())
      .then((keys) => setPublicKey(keys.public_key))
      .catch(() => error("privateKey"));
  };

  const fromLink = async () => {
    let form: InboundForm;
    try {
      form = linkToInboundForm(link, tags());
    } catch (e) {
      return showError(linkErrorMessage(t, e));
    }
    setBusy(true);
    let key = "";
    if (form.security === "reality") {
      // the other server's private key is unknown: this server gets its own pair
      try {
        const keys = await realityKeys();
        form.privateKey = keys.private_key;
        key = keys.public_key;
      } catch {
        error("keys");
      }
    }
    setBusy(false);
    setPasting(false);
    setLink("");
    setEditing({ index: null, original: {}, form, jsonOnly: false });
    setPublicKey(key);
  };

  const form = editing?.form;

  return (
    <VStack spacing={2} align="stretch">
      <Text fontSize="xs" opacity={0.8}>
        {t("coreEditor.inboundsHint")}
      </Text>
      <HStack>
        <SmallButton leftIcon={<PlusIcon {...icon} />} onClick={() => open(null)}>
          {t("coreEditor.addInbound")}
        </SmallButton>
        <SmallButton leftIcon={<LinkIcon {...icon} />} onClick={() => setPasting(true)}>
          {t("coreEditor.inboundFromLink")}
        </SmallButton>
      </HStack>
      {inbounds.map((inbound, index) => {
        const stream: Json = inbound.streamSettings || {};
        const managed = INBOUND_PROTOCOLS.includes(inbound.protocol);
        return (
          <ItemRow
            key={`${index}-${inbound.tag}`}
            title={inbound.tag || "-"}
            badges={[
              inbound.protocol,
              inbound.port !== undefined ? `:${inbound.port}` : inbound.listen,
              managed && (stream.network || "tcp"),
              managed && stream.security && stream.security !== "none" && stream.security,
              !managed && t("coreEditor.notUserInbound"),
            ]}
            actions={
              <RowActions
                onEdit={() => open(index, inbound)}
                onDuplicate={() => open(null, { ...clone(inbound), tag: uniqueTag(`${inbound.tag} copy`, tags()) })}
                onDelete={() => remove(index)}
              />
            }
          />
        );
      })}
      {!inbounds.length && (
        <Text fontSize="sm" opacity={0.7}>
          {t("coreEditor.empty")}
        </Text>
      )}

      <PasteModal
        isOpen={pasting}
        onClose={() => setPasting(false)}
        title={t("coreEditor.inboundFromLink")}
        helper={t("coreEditor.inboundFromLinkHint")}
        value={link}
        onChange={setLink}
        onSubmit={fromLink}
        submitLabel={t("coreEditor.continue")}
        isLoading={busy}
      />

      {editing && form && (
        <EditModal
          isOpen
          onClose={() => setEditing(null)}
          title={t(editing.index === null ? "coreEditor.addInbound" : "coreEditor.editInbound")}
          jsonOnly={editing.jsonOnly}
          toJson={() => (editing.jsonOnly ? editing.original : formToInbound(form, editing.original))}
          fromJson={(json) => {
            if (!INBOUND_PROTOCOLS.includes(json.protocol)) return false;
            setEditing((e) => e && { ...e, original: json, form: inboundToForm(json) });
            return true;
          }}
          onSave={save}
        >
          <VStack spacing={3}>
            <Grid>
              <Field
                label={t("coreEditor.tag")}
                value={form.tag}
                isRequired
                onChange={(tag) => patch({ tag })}
                helper={editing.index !== null && form.tag !== editing.original.tag ? t("coreEditor.renameHint") : undefined}
              />
              <SelectField
                label={t("coreEditor.protocol")}
                value={form.protocol}
                options={INBOUND_PROTOCOLS}
                onChange={(protocol) => patch({ protocol, ...(protocol === "shadowsocks" ? { security: "none" } : {}) })}
              />
              <Field label={t("coreEditor.listen")} value={form.listen} placeholder="0.0.0.0" onChange={(listen) => patch({ listen })} />
              <Field label={t("coreEditor.port")} value={form.port} placeholder="443" isRequired onChange={(port) => patch({ port })} />
            </Grid>
            <SwitchField
              label={t("coreEditor.sniffing")}
              isChecked={form.sniffing}
              onChange={(sniffing) => patch({ sniffing })}
              helper={t("coreEditor.sniffingHint")}
            />
            <TransportFields value={form} onChange={patch} />
            {form.protocol !== "shadowsocks" && (
              <Section title={t("coreEditor.security")}>
                <VStack spacing={3}>
                  <Grid>
                    <SelectField
                      label={t("coreEditor.security")}
                      value={form.security}
                      options={["none", "tls", "reality"]}
                      onChange={(security) => patch({ security })}
                    />
                  </Grid>
                  {form.security === "tls" && (
                    <Grid>
                      <Field label={t("coreEditor.serverName")} value={form.serverName} onChange={(serverName) => patch({ serverName })} />
                      <Field label="ALPN" value={form.alpn} placeholder="h2,http/1.1" onChange={(alpn) => patch({ alpn })} />
                      <Field
                        label={t("coreEditor.certFile")}
                        value={form.certFile}
                        placeholder="/var/lib/marzban/certs/fullchain.pem"
                        onChange={(certFile) => patch({ certFile })}
                        helper={t("coreEditor.certHint")}
                      />
                      <Field
                        label={t("coreEditor.keyFile")}
                        value={form.keyFile}
                        placeholder="/var/lib/marzban/certs/key.pem"
                        onChange={(keyFile) => patch({ keyFile })}
                      />
                    </Grid>
                  )}
                  {form.security === "reality" && (
                    <Grid>
                      <Field
                        label={t("coreEditor.realityDest")}
                        value={form.dest}
                        placeholder="www.microsoft.com:443"
                        isRequired
                        onChange={(dest) => patch({ dest })}
                        helper={t("coreEditor.realityDestHint")}
                      />
                      <Field
                        label={t("coreEditor.serverNames")}
                        value={form.serverNames}
                        placeholder="www.microsoft.com"
                        isRequired
                        onChange={(serverNames) => patch({ serverNames })}
                        helper={t("coreEditor.commaHint")}
                      />
                      <Box>
                        <Field
                          label={t("coreEditor.privateKey")}
                          value={form.privateKey}
                          isRequired
                          onChange={(privateKey) => {
                            patch({ privateKey });
                            setPublicKey("");
                          }}
                        />
                        <HStack mt={1}>
                          <SmallButton leftIcon={<KeyIcon {...icon} />} onClick={generateKeys} isLoading={busy}>
                            {t("coreEditor.generateKeys")}
                          </SmallButton>
                          <SmallButton onClick={showPublicKey}>{t("coreEditor.showPublicKey")}</SmallButton>
                        </HStack>
                        {publicKey && (
                          <Text fontSize="xs" mt={1} wordBreak="break-all">
                            {t("coreEditor.publicKey")}: <Code fontSize="xs">{publicKey}</Code>
                          </Text>
                        )}
                      </Box>
                      <Box>
                        <Field
                          label={t("coreEditor.shortIds")}
                          value={form.shortIds}
                          isRequired
                          onChange={(shortIds) => patch({ shortIds })}
                          helper={t("coreEditor.shortIdsHint")}
                        />
                        <HStack mt={1}>
                          <SmallButton onClick={() => patch({ shortIds: [...splitList(form.shortIds), randomShortId()].join(",") })}>
                            {t("coreEditor.addShortId")}
                          </SmallButton>
                        </HStack>
                      </Box>
                    </Grid>
                  )}
                </VStack>
              </Section>
            )}
          </VStack>
        </EditModal>
      )}
    </VStack>
  );
};
