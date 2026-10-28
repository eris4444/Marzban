import {
  Badge,
  Box,
  Button,
  chakra,
  Checkbox,
  CheckboxGroup,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  SimpleGridProps,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  Tooltip,
  useToast,
} from "@chakra-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { FC, ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Json } from "utils/xrayConfig";
import { JsonEditor } from "../JsonEditor";

const iconProps = { width: 14, height: 14 };
export const EditIcon = chakra(PencilIcon);
export const CopyIcon = chakra(DocumentDuplicateIcon);

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: ReactNode;
  isRequired?: boolean;
  dir?: "ltr";
};

export const Field: FC<FieldProps> = ({ label, value, onChange, placeholder, helper, isRequired }) => (
  <FormControl isRequired={isRequired}>
    <FormLabel fontSize="sm" mb={1}>
      {label}
    </FormLabel>
    <Input size="sm" dir="ltr" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    {helper && <FormHelperText fontSize="xs">{helper}</FormHelperText>}
  </FormControl>
);

export const TextField: FC<FieldProps & { rows?: number }> = ({ label, value, onChange, placeholder, helper, rows = 3 }) => (
  <FormControl>
    <FormLabel fontSize="sm" mb={1}>
      {label}
    </FormLabel>
    <Textarea
      size="sm"
      dir="ltr"
      rows={rows}
      fontFamily="mono"
      fontSize="xs"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
    {helper && <FormHelperText fontSize="xs">{helper}</FormHelperText>}
  </FormControl>
);

type Option = string | { value: string; label: string };

export const SelectField: FC<{
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  helper?: ReactNode;
}> = ({ label, value, options, onChange, helper }) => (
  <FormControl>
    <FormLabel fontSize="sm" mb={1}>
      {label}
    </FormLabel>
    <Select size="sm" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => {
        const { value, label } = typeof option === "string" ? { value: option, label: option } : option;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </Select>
    {helper && <FormHelperText fontSize="xs">{helper}</FormHelperText>}
  </FormControl>
);

export const SwitchField: FC<{ label: string; isChecked: boolean; onChange: (value: boolean) => void; helper?: ReactNode }> = ({
  label,
  isChecked,
  onChange,
  helper,
}) => (
  <FormControl>
    <HStack>
      <Switch size="sm" colorScheme="primary" isChecked={isChecked} onChange={(e) => onChange(e.target.checked)} />
      <FormLabel fontSize="sm" m={0}>
        {label}
      </FormLabel>
    </HStack>
    {helper && <FormHelperText fontSize="xs">{helper}</FormHelperText>}
  </FormControl>
);

export const ChecksField: FC<{ label: string; value: string[]; options: string[]; onChange: (value: string[]) => void; helper?: ReactNode }> = ({
  label,
  value,
  options,
  onChange,
  helper,
}) => (
  <FormControl as="fieldset">
    <FormLabel as="legend" fontSize="sm" mb={1}>
      {label}
    </FormLabel>
    <CheckboxGroup value={value} onChange={(v) => onChange(v as string[])}>
      <Flex wrap="wrap" columnGap={4} rowGap={1}>
        {options.map((option) => (
          <Checkbox key={option} size="sm" value={option}>
            <Text fontSize="sm" dir="ltr">
              {option}
            </Text>
          </Checkbox>
        ))}
      </Flex>
    </CheckboxGroup>
    {helper && <FormHelperText fontSize="xs">{helper}</FormHelperText>}
  </FormControl>
);

export const Grid: FC<SimpleGridProps> = (props) => <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} w="full" {...props} />;

export const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <Box w="full" borderWidth="1px" borderRadius="md" p={3} _dark={{ borderColor: "gray.600" }}>
    <Text fontSize="sm" fontWeight="semibold" mb={2}>
      {title}
    </Text>
    {children}
  </Box>
);

/** Delete needs a second click within three seconds. */
export const DeleteButton: FC<{ onDelete: () => void }> = ({ onDelete }) => {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  const label = t(armed ? "coreEditor.confirmDelete" : "coreEditor.delete");
  return (
    <Tooltip label={label} placement="top">
      <IconButton
        size="xs"
        aria-label={label}
        variant={armed ? "solid" : "ghost"}
        colorScheme={armed ? "red" : undefined}
        icon={<TrashIcon {...iconProps} />}
        onClick={() => (armed ? onDelete() : setArmed(true))}
      />
    </Tooltip>
  );
};

export const RowActions: FC<{
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  onUp?: () => void;
  onDown?: () => void;
}> = ({ onEdit, onDuplicate, onDelete, onUp, onDown }) => {
  const { t } = useTranslation();
  const button = (label: string, icon: ReactNode, onClick?: () => void) => (
    <Tooltip label={t(label)} placement="top">
      <IconButton size="xs" variant="ghost" aria-label={t(label)} icon={icon as any} isDisabled={!onClick} onClick={onClick} />
    </Tooltip>
  );
  return (
    <HStack spacing={0} flexShrink={0}>
      {onUp !== undefined || onDown !== undefined ? (
        <>
          {button("coreEditor.moveUp", <ArrowUpIcon {...iconProps} />, onUp)}
          {button("coreEditor.moveDown", <ArrowDownIcon {...iconProps} />, onDown)}
        </>
      ) : null}
      {button("coreEditor.edit", <PencilIcon {...iconProps} />, onEdit)}
      {onDuplicate && button("coreEditor.duplicate", <DocumentDuplicateIcon {...iconProps} />, onDuplicate)}
      <DeleteButton onDelete={onDelete} />
    </HStack>
  );
};

export const ItemRow: FC<{ title: ReactNode; badges?: (string | false | undefined)[]; subtitle?: ReactNode; actions: ReactNode }> = ({
  title,
  badges = [],
  subtitle,
  actions,
}) => (
  <HStack
    w="full"
    justifyContent="space-between"
    borderWidth="1px"
    borderRadius="md"
    px={3}
    py={2}
    _dark={{ borderColor: "gray.600" }}
    spacing={2}
  >
    <Box minW={0}>
      <HStack spacing={2} flexWrap="wrap">
        <Text fontSize="sm" fontWeight="semibold" dir="ltr" wordBreak="break-all">
          {title}
        </Text>
        {badges.filter(Boolean).map((badge) => (
          <Badge key={badge as string} fontSize="2xs" textTransform="none" dir="ltr">
            {badge}
          </Badge>
        ))}
      </HStack>
      {subtitle && (
        <Text fontSize="xs" opacity={0.75} dir="ltr" wordBreak="break-all" mt={0.5}>
          {subtitle}
        </Text>
      )}
    </Box>
    {actions}
  </HStack>
);

/**
 * Add/edit dialog with a form tab and a JSON tab. `toJson` turns the form into JSON for the
 * JSON tab, `fromJson` loads JSON back into the form (false when the form can't show it), and
 * `onSave` gets the JSON from the JSON tab, or null to save the form.
 */
export const EditModal: FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  toJson: () => Json;
  fromJson?: (json: Json) => boolean;
  onSave: (json: Json | null) => void;
  jsonOnly?: boolean;
}> = ({ isOpen, onClose, title, children, toJson, fromJson, onSave, jsonOnly }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState(0);
  const [json, setJson] = useState<Json>({});
  const text = useRef<string | null>(null);
  const showJson = jsonOnly || tab === 1;

  useEffect(() => {
    if (!isOpen) return;
    setTab(jsonOnly ? 1 : 0);
    text.current = null;
    if (jsonOnly) setJson(toJson());
  }, [isOpen]);

  const parsed = (): Json | null => {
    if (text.current === null) return json;
    try {
      const value = JSON.parse(text.current);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      toast({ title: t("coreEditor.errors.json"), status: "error", position: "top", duration: 3000, isClosable: true });
      return null;
    }
  };

  const switchTab = (index: number) => {
    if (index === 1) {
      setJson(toJson());
      text.current = null;
    } else {
      const value = parsed();
      if (!value) return;
      if (fromJson && !fromJson(value)) {
        toast({ title: t("coreEditor.errors.formCantShow"), status: "warning", position: "top", duration: 4000, isClosable: true });
        return;
      }
    }
    setTab(index);
  };

  const save = () => {
    if (!showJson) return onSave(null);
    const value = parsed();
    if (value) onSave(value);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3">
        <ModalHeader fontSize="md">{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {jsonOnly ? (
            <Box h="380px">
              <JsonEditor json={json} onChange={(value) => (text.current = value)} />
            </Box>
          ) : (
            <Tabs size="sm" variant="enclosed" index={tab} onChange={switchTab} isLazy>
              <TabList>
                <Tab>{t("coreEditor.form")}</Tab>
                <Tab>JSON</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0}>{children}</TabPanel>
                <TabPanel px={0}>
                  <Box h="380px">
                    <JsonEditor json={json} onChange={(value) => (text.current = value)} />
                  </Box>
                </TabPanel>
              </TabPanels>
            </Tabs>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button size="sm" colorScheme="primary" onClick={save}>
              {t("coreEditor.apply")}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

/** A dialog to paste share links into. */
export const PasteModal: FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  helper: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  isLoading?: boolean;
}> = ({ isOpen, onClose, title, helper, value, onChange, onSubmit, submitLabel, isLoading }) => {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3">
        <ModalHeader fontSize="md">{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <TextField label={t("coreEditor.links")} value={value} onChange={onChange} rows={6} placeholder="vless://... vmess://... trojan://... ss://..." helper={helper} />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button size="sm" colorScheme="primary" onClick={onSubmit} isDisabled={!value.trim()} isLoading={isLoading}>
              {submitLabel}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

/** The translated message of an error thrown by the share-link helpers ("key" or "line:key"). */
export const linkErrorMessage = (t: (...args: any[]) => any, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const [line, key] = message.includes(":") ? message.split(":") : ["", message];
  const text = String(t(`coreEditor.errors.${key}`));
  return line ? String(t("coreEditor.errors.line", { line, error: text })) : text;
};

export const SmallButton: FC<{ onClick: () => void; children: ReactNode; leftIcon?: any; isLoading?: boolean }> = ({
  onClick,
  children,
  leftIcon,
  isLoading,
}) => (
  <Button size="xs" variant="outline" onClick={onClick} leftIcon={leftIcon} isLoading={isLoading}>
    {children}
  </Button>
);
