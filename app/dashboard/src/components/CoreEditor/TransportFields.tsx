import { VStack } from "@chakra-ui/react";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { KCP_HEADERS, TRANSPORTS, TransportForm, XHTTP_MODES } from "utils/xrayConfig";
import { Field, Grid, Section, SelectField } from "./fields";

export const TransportFields: FC<{
  value: TransportForm;
  onChange: (patch: Partial<TransportForm>) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const net = value.network;
  const path = <Field label={t("coreEditor.path")} value={value.path} placeholder="/" onChange={(path) => onChange({ path })} />;
  const host = <Field label={t("coreEditor.host")} value={value.host} onChange={(host) => onChange({ host })} />;

  return (
    <Section title={t("coreEditor.transport")}>
      <VStack spacing={3}>
        <Grid>
          <SelectField
            label={t("coreEditor.network")}
            value={net}
            options={TRANSPORTS.map((n) => ({ value: n, label: n === "tcp" ? "tcp (raw)" : n }))}
            onChange={(network) =>
              onChange({
                network,
                headerType: "none",
                mode: network === "xhttp" ? "auto" : network === "grpc" ? "gun" : "",
              })
            }
          />
          {net === "tcp" && (
            <SelectField
              label={t("coreEditor.headerType")}
              value={value.headerType}
              options={["none", "http"]}
              onChange={(headerType) => onChange({ headerType })}
            />
          )}
          {net === "kcp" && (
            <SelectField
              label={t("coreEditor.headerType")}
              value={value.headerType}
              options={KCP_HEADERS}
              onChange={(headerType) => onChange({ headerType })}
            />
          )}
          {net === "xhttp" && (
            <SelectField label={t("coreEditor.mode")} value={value.mode || "auto"} options={XHTTP_MODES} onChange={(mode) => onChange({ mode })} />
          )}
          {net === "grpc" && (
            <SelectField
              label={t("coreEditor.mode")}
              value={value.mode || "gun"}
              options={["gun", "multi"]}
              onChange={(mode) => onChange({ mode })}
            />
          )}
        </Grid>
        <Grid>
          {(net === "ws" || net === "httpupgrade" || net === "xhttp" || (net === "tcp" && value.headerType === "http")) && (
            <>
              {path}
              {host}
            </>
          )}
          {net === "grpc" && (
            <Field label={t("coreEditor.serviceName")} value={value.serviceName} onChange={(serviceName) => onChange({ serviceName })} />
          )}
          {net === "kcp" && <Field label={t("coreEditor.seed")} value={value.seed} onChange={(seed) => onChange({ seed })} />}
        </Grid>
      </VStack>
    </Section>
  );
};
