import { Badge, Button, HStack, Menu, MenuButton, MenuItem, MenuList, Text, useToast, VStack } from "@chakra-ui/react";
import { ChevronDownIcon, PlusIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  applyPreset,
  clone,
  describeRule,
  DOMAIN_STRATEGIES,
  emptyRule,
  formToRule,
  Json,
  RULE_PRESETS,
  RULE_PROTOCOLS,
  RuleForm,
  ruleToForm,
  validateRule,
  XrayConfig,
} from "utils/xrayConfig";
import { ChecksField, EditModal, Field, Grid, ItemRow, RowActions, SelectField, SmallButton, TextField } from "./fields";

const icon = { width: 14, height: 14 };

type Editing = { index: number | null; form: RuleForm; original: Json };

export const RoutingEditor: FC<{ config: XrayConfig; onChange: (config: XrayConfig) => void }> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const rules = config.routing?.rules || [];
  const balancers = config.routing?.balancers || [];
  const [editing, setEditing] = useState<Editing | null>(null);

  const patch = (p: Partial<RuleForm>) => setEditing((e) => e && { ...e, form: { ...e.form, ...p } });
  const update = (change: (next: XrayConfig) => void) => {
    const next = clone(config);
    next.routing = next.routing || {};
    next.routing.rules = next.routing.rules || [];
    change(next);
    onChange(next);
  };

  const targets = [
    ...(config.outbounds || []).map((o) => ({ value: `outbound:${o.tag}`, label: `→ ${o.tag} (${o.protocol})` })),
    ...balancers.map((b) => ({ value: `balancer:${b.tag}`, label: `⇉ ${b.tag} (${t("coreEditor.balancer")})` })),
  ];
  const inboundTags = (config.inbounds || []).map((i) => i.tag).filter(Boolean);

  const open = (index: number | null, rule?: Json) =>
    setEditing({
      index,
      original: rule ? clone(rule) : {},
      form: rule ? ruleToForm(rule) : { ...emptyRule(), target: targets[0]?.value || "" },
    });

  const commit = (rule: Json) => {
    if (!editing) return;
    update((next) => {
      if (editing.index === null) next.routing!.rules!.push(rule);
      else next.routing!.rules![editing.index] = rule;
    });
    setEditing(null);
  };

  const save = (json: Json | null) => {
    if (!editing) return;
    if (json) return commit(json);
    const problem = validateRule(editing.form, editing.original);
    if (problem) return toast({ title: t(`coreEditor.errors.${problem}`), status: "error", position: "top", duration: 4000, isClosable: true });
    commit(formToRule(editing.form, editing.original));
  };

  const move = (index: number, to: number) =>
    update((next) => {
      const [rule] = next.routing!.rules!.splice(index, 1);
      next.routing!.rules!.splice(to, 0, rule);
    });

  const target = (rule: Json) => (rule.balancerTag ? `⇉ ${rule.balancerTag}` : `→ ${rule.outboundTag || "?"}`);
  const form = editing?.form;

  return (
    <VStack spacing={2} align="stretch">
      <Text fontSize="xs" opacity={0.8}>
        {t("coreEditor.routingHint")}
      </Text>
      <HStack alignItems="flex-end" flexWrap="wrap" gap={2}>
        <SelectField
          label={t("coreEditor.domainStrategy")}
          value={config.routing?.domainStrategy || "AsIs"}
          options={DOMAIN_STRATEGIES}
          onChange={(domainStrategy) => update((next) => (next.routing!.domainStrategy = domainStrategy))}
        />
      </HStack>
      <HStack flexWrap="wrap" gap={2}>
        <SmallButton leftIcon={<PlusIcon {...icon} />} onClick={() => open(null)}>
          {t("coreEditor.addRule")}
        </SmallButton>
        <Menu>
          <MenuButton as={Button} size="xs" variant="outline" leftIcon={<SparklesIcon {...icon} />} rightIcon={<ChevronDownIcon {...icon} />}>
            {t("coreEditor.presets")}
          </MenuButton>
          <MenuList zIndex={10} fontSize="sm">
            {RULE_PRESETS.map((preset) => (
              <MenuItem key={preset} onClick={() => onChange(applyPreset(config, preset))}>
                {t(`coreEditor.preset.${preset}`)}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
        {balancers.length > 0 && <Badge textTransform="none">{t("coreEditor.balancersInJson", { count: balancers.length })}</Badge>}
      </HStack>
      {rules.map((rule, index) => (
        <ItemRow
          key={`${index}-${JSON.stringify(rule)}`}
          title={`${index + 1}. ${target(rule)}`}
          subtitle={describeRule(rule)}
          actions={
            <RowActions
              onUp={index > 0 ? () => move(index, index - 1) : undefined}
              onDown={index < rules.length - 1 ? () => move(index, index + 1) : undefined}
              onEdit={() => open(index, rule)}
              onDuplicate={() => open(null, rule)}
              onDelete={() => update((next) => next.routing!.rules!.splice(index, 1))}
            />
          }
        />
      ))}
      {!rules.length && (
        <Text fontSize="sm" opacity={0.7}>
          {t("coreEditor.noRules")}
        </Text>
      )}

      {editing && form && (
        <EditModal
          isOpen
          onClose={() => setEditing(null)}
          title={t(editing.index === null ? "coreEditor.addRule" : "coreEditor.editRule")}
          toJson={() => formToRule(form, editing.original)}
          fromJson={(json) => {
            setEditing((e) => e && { ...e, original: json, form: ruleToForm(json) });
            return true;
          }}
          onSave={save}
        >
          <VStack spacing={3}>
            <Grid>
              <SelectField
                label={t("coreEditor.ruleTarget")}
                value={form.target}
                options={[{ value: "", label: "-" }, ...targets]}
                onChange={(target) => patch({ target })}
              />
              <SelectField
                label={t("coreEditor.network")}
                value={form.network}
                options={[{ value: "", label: t("coreEditor.any") }, "tcp", "udp", "tcp,udp"]}
                onChange={(network) => patch({ network })}
              />
            </Grid>
            {inboundTags.length > 0 && (
              <ChecksField
                label={t("coreEditor.ruleInbounds")}
                value={form.inboundTag}
                options={inboundTags}
                onChange={(inboundTag) => patch({ inboundTag })}
                helper={t("coreEditor.ruleInboundsHint")}
              />
            )}
            <Grid>
              <TextField
                label={t("coreEditor.ruleDomains")}
                value={form.domain}
                placeholder={"geosite:category-ir\ndomain:example.com\nkeyword:ads\nregexp:.*\\.ir$\nfull:www.example.com"}
                rows={5}
                onChange={(domain) => patch({ domain })}
                helper={t("coreEditor.ruleDomainsHint")}
              />
              <TextField
                label={t("coreEditor.ruleIps")}
                value={form.ip}
                placeholder={"geoip:ir\ngeoip:private\n1.1.1.1\n10.0.0.0/8"}
                rows={5}
                onChange={(ip) => patch({ ip })}
                helper={t("coreEditor.ruleIpsHint")}
              />
            </Grid>
            <Grid>
              <Field label={t("coreEditor.port")} value={form.port} placeholder="53,443,1000-2000" onChange={(port) => patch({ port })} />
              <Field label={t("coreEditor.sourcePort")} value={form.sourcePort} onChange={(sourcePort) => patch({ sourcePort })} />
            </Grid>
            <ChecksField
              label={t("coreEditor.ruleProtocols")}
              value={form.protocol}
              options={RULE_PROTOCOLS}
              onChange={(protocol) => patch({ protocol })}
              helper={t("coreEditor.ruleProtocolsHint")}
            />
            <Grid>
              <TextField
                label={t("coreEditor.ruleSource")}
                value={form.source}
                placeholder={"10.0.0.0/8"}
                rows={2}
                onChange={(source) => patch({ source })}
              />
              <TextField
                label={t("coreEditor.ruleUsers")}
                value={form.user}
                placeholder={"1.username"}
                rows={2}
                onChange={(user) => patch({ user })}
                helper={t("coreEditor.ruleUsersHint")}
              />
            </Grid>
          </VStack>
        </EditModal>
      )}
    </VStack>
  );
};
