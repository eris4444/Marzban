import {
  Badge,
  Box,
  Button,
  chakra,
  CircularProgress,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Tooltip,
  useToast,
  useColorMode
} from "@chakra-ui/react";
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { joinPaths } from "@remix-run/router";
import classNames from "classnames";
import { useCoreSettings } from "contexts/CoreSettingsContext";
import { useDashboard } from "contexts/DashboardContext";
import debounce from "lodash.debounce";
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "react-query";
import { ReadyState } from "react-use-websocket";
import { useWebSocket } from "react-use-websocket/dist/lib/use-websocket";
import { getAuthToken } from "utils/authStorage";
import { Icon } from "./Icon";
import { JsonEditor } from "./JsonEditor";
import "./JsonEditor/themes.js";
import { useNodesQuery } from "contexts/NodesContext";
import { clone, XrayConfig } from "utils/xrayConfig";
import { InboundsEditor } from "./CoreEditor/InboundsEditor";
import { OutboundsEditor } from "./CoreEditor/OutboundsEditor";
import { RoutingEditor } from "./CoreEditor/RoutingEditor";

export const MAX_NUMBER_OF_LOGS = 500;
const JSON_TAB = 3;

const UsageIcon = chakra(Cog6ToothIcon, {
  baseStyle: {
    w: 5,
    h: 5,
  },
});
export const ReloadIcon = chakra(ArrowPathIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

export const FullScreenIcon = chakra(ArrowsPointingOutIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});
export const ExitFullScreenIcon = chakra(ArrowsPointingInIcon, {
  baseStyle: {
    w: 3,
    h: 3,
  },
});

const getStatus = (status: string) => {
  return {
    [ReadyState.CONNECTING]: "connecting",
    [ReadyState.OPEN]: "connected",
    [ReadyState.CLOSING]: "closed",
    [ReadyState.CLOSED]: "closed",
    [ReadyState.UNINSTANTIATED]: "closed",
  }[status];
};

const getWebsocketUrl = (nodeID: string) => {
  try {
    let baseURL = new URL(
      import.meta.env.VITE_BASE_API.startsWith("/")
        ? window.location.origin + import.meta.env.VITE_BASE_API
        : import.meta.env.VITE_BASE_API
    );

    return (
      (baseURL.protocol === "https:" ? "wss://" : "ws://") +
      joinPaths([
        baseURL.host + baseURL.pathname,
        !nodeID ? "/core/logs" : `/node/${nodeID}/logs`,
      ]) +
      "?interval=1&token=" +
      getAuthToken()
    );
  } catch (e) {
    console.error("Unable to generate websocket url");
    console.error(e);
    return null;
  }
};

let logsTmp: string[] = [];
const CoreSettingModalContent: FC = () => {

  const { colorMode } = useColorMode();

  const { data: nodes } = useNodesQuery();
  const disabled = false;
  const [selectedNode, setNode] = useState<string>("");

  const handleLog = (id: string, title: string) => {
    if (id === selectedNode) return;
    else if (id === "host") {
      setNode("");
      setLogs([]);
    } else {
      setNode(id);
      setLogs([]);
    }
  };

  const { isEditingCore } = useDashboard();
  const {
    fetchCoreSettings,
    updateConfig,
    isLoading,
    config,
    isPostLoading,
    version,
    restartCore,
  } = useCoreSettings();
  const logsDiv = useRef<HTMLDivElement | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const { t } = useTranslation();
  const toast = useToast();
  // the config being edited; the graphical tabs change it directly, the JSON tab on leaving it
  const [draft, setDraft] = useState<XrayConfig | null>(null);
  const [tab, setTab] = useState(0);
  const jsonText = useRef<string | null>(null);

  useEffect(() => {
    if (config && typeof config === "object") {
      setDraft(clone(config as XrayConfig));
      jsonText.current = null;
    }
  }, [config]);

  const parsedJson = (): XrayConfig | null => {
    if (jsonText.current === null) return draft;
    try {
      const value = JSON.parse(jsonText.current);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      toast({
        title: t("coreEditor.errors.json"),
        status: "error",
        isClosable: true,
        position: "top",
        duration: 3000,
      });
      return null;
    }
  };

  const changeTab = (index: number) => {
    if (tab === JSON_TAB && index !== JSON_TAB) {
      const value = parsedJson();
      if (!value) return;
      setDraft(value);
      jsonText.current = null;
    }
    setTab(index);
  };

  useEffect(() => {
    if (isEditingCore) fetchCoreSettings();
  }, [isEditingCore]);
  "".startsWith;
  const scrollShouldStayOnEnd = useRef(true);
  const updateLogs = useCallback(
    debounce((logs: string[]) => {
      const isScrollOnEnd =
        Math.abs(
          (logsDiv.current?.scrollTop || 0) -
            (logsDiv.current?.scrollHeight || 0) +
            (logsDiv.current?.offsetHeight || 0)
        ) < 10;
      if (logsDiv.current && isScrollOnEnd)
        scrollShouldStayOnEnd.current = true;
      else scrollShouldStayOnEnd.current = false;
      if (logs.length < 40) setLogs(logs);
    }, 300),
    []
  );

  const { readyState } = useWebSocket(getWebsocketUrl(selectedNode), {
    onMessage: (e: any) => {
      logsTmp.push(e.data);
      if (logsTmp.length > MAX_NUMBER_OF_LOGS)
        logsTmp = logsTmp.splice(0, logsTmp.length - MAX_NUMBER_OF_LOGS);
      updateLogs([...logsTmp]);
    },
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 1000,
  });

  useEffect(() => {
    if (logsDiv.current && scrollShouldStayOnEnd.current)
      logsDiv.current.scrollTop = logsDiv.current?.scrollHeight;
  }, [logs]);

  useEffect(() => {
    return () => {
      logsTmp = [];
    };
  }, []);

  const status = getStatus(readyState.toString());

  const { mutate: handleRestartCore, isLoading: isRestarting } =
    useMutation(restartCore);

  const handleOnSave = () => {
    const config = tab === JSON_TAB ? parsedJson() : draft;
    if (!config) return;
    updateConfig(config as any)
      .then(() => {
        useCoreSettings.setState({ config: config as any });
        toast({
          title: t("core.successMessage"),
          status: "success",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      })
      .catch((e) => {
        let message = t("core.generalErrorMessage");
        if (typeof e.response._data.detail === "object")
          message =
            e.response._data.detail[Object.keys(e.response._data.detail)[0]];
        if (typeof e.response._data.detail === "string")
          message = e.response._data.detail;

        toast({
          title: message,
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      });
  };
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setFullScreen] = useState(false);
  const handleFullScreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setFullScreen(false);
    } else {
      editorRef.current?.requestFullscreen();
      setFullScreen(true);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleOnSave();
      }}
    >
      <ModalBody>
        <FormControl>
          <HStack justifyContent="space-between" alignItems="flex-start">
            <FormLabel>
              {t("core.configuration")}{" "}
              {isLoading && <CircularProgress isIndeterminate size="15px" />}
            </FormLabel>
            <HStack gap={0}>
              <Tooltip label="Xray Version" placement="top">
                <Badge height="100%" textTransform="lowercase">
                  {version && `v${version}`}
                </Badge>
              </Tooltip>
            </HStack>
          </HStack>
          {draft && (
            <Tabs size="sm" variant="enclosed" index={tab} onChange={changeTab} isLazy>
              <TabList flexWrap="wrap">
                <Tab>
                  {t("coreEditor.inbounds")} ({draft.inbounds?.length || 0})
                </Tab>
                <Tab>
                  {t("coreEditor.outbounds")} ({draft.outbounds?.length || 0})
                </Tab>
                <Tab>
                  {t("coreEditor.routing")} ({draft.routing?.rules?.length || 0})
                </Tab>
                <Tab>JSON</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={1} maxH="460px" overflowY="auto">
                  <InboundsEditor config={draft} onChange={setDraft} />
                </TabPanel>
                <TabPanel px={1} maxH="460px" overflowY="auto">
                  <OutboundsEditor config={draft} onChange={setDraft} />
                </TabPanel>
                <TabPanel px={1} maxH="460px" overflowY="auto">
                  <RoutingEditor config={draft} onChange={setDraft} />
                </TabPanel>
                <TabPanel px={0}>
                  <Box position="relative" ref={editorRef} minHeight="300px">
                    <JsonEditor
                      json={draft}
                      onChange={(value) => (jsonText.current = value)}
                    />
                    <IconButton
                      size="xs"
                      aria-label="full screen"
                      variant="ghost"
                      position="absolute"
                      top="2"
                      right="4"
                      onClick={handleFullScreen}
                    >
                      {!isFullScreen ? <FullScreenIcon /> : <ExitFullScreenIcon />}
                    </IconButton>
                  </Box>
                </TabPanel>
              </TabPanels>
            </Tabs>
          )}
          <Text fontSize="xs" opacity={0.7} mt={2} dir="auto">
            {t("coreEditor.saveHint")}
          </Text>
        </FormControl>
        <FormControl mt="4">
          <HStack
            justifyContent="space-between"
            style={{ paddingBottom: "1rem" }}
          >
            <HStack>
              {nodes?.[0] && (
                <Select
                  size="sm"
                  style={{ width: "auto" }}
                  disabled={disabled}
                  bg={disabled ? "gray.100" : "transparent"}
                  _dark={{
                    bg: disabled ? "gray.600" : "transparent",
                  }}
                  sx={{
                    option: {
                      backgroundColor: colorMode === "dark" ? "#222C3B" : "white"
                    }
                  }}
                  onChange={(v) =>
                    handleLog(
                      v.currentTarget.value,
                      v.currentTarget.selectedOptions[0].text
                    )
                  }
                >
                  <option key={"host"} value={"host"} defaultChecked>
                    Master
                  </option>
                  {nodes &&
                    nodes.map((s) => {
                      return (
                        <option key={s.address} value={String(s.id)}>
                          {t(s.name)}
                        </option>
                      );
                    })}
                </Select>
              )}
              <FormLabel className="w-au">{t("core.logs")}</FormLabel>
            </HStack>
            <Text as={FormLabel}>{t(`core.socket.${status}`)}</Text>
          </HStack>
          <Box
            border="1px solid"
            borderColor="gray.300"
            bg="#F9F9F9"
            _dark={{
              borderColor: "gray.500",
              bg: "#2e3440",
            }}
            borderRadius={5}
            minHeight="200px"
            maxHeight={"250px"}
            p={2}
            overflowY="auto"
            ref={logsDiv}
          >
            {logs.map((message, i) => (
              <Text fontSize="xs" opacity={0.8} key={i} whiteSpace="pre-line">
                {message}
              </Text>
            ))}
          </Box>
        </FormControl>
      </ModalBody>
      <ModalFooter>
        <HStack w="full" justifyContent="space-between">
          <HStack>
            <Box>
              <Button
                size="sm"
                leftIcon={
                  <ReloadIcon
                    className={classNames({
                      "animate-spin": isRestarting,
                    })}
                  />
                }
                onClick={() => handleRestartCore()}
              >
                {t(isRestarting ? "core.restarting" : "core.restartCore")}
              </Button>
            </Box>
          </HStack>

          <HStack>
            <Button
              size="sm"
              variant="solid"
              colorScheme="primary"
              px="5"
              type="submit"
              isDisabled={isLoading || isPostLoading}
              isLoading={isPostLoading}
            >
              {t("core.save")}
            </Button>
          </HStack>
        </HStack>
      </ModalFooter>
    </form>
  );
};
export const CoreSettingsModal: FC = () => {
  const { isEditingCore } = useDashboard();
  const onClose = useDashboard.setState.bind(null, { isEditingCore: false });
  const { t } = useTranslation();

  return (
    <Modal isOpen={isEditingCore} onClose={onClose} size="4xl">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3" w="full">
        <ModalHeader pt={6}>
          <HStack gap={2}>
            <Icon color="primary">
              <UsageIcon color="white" />
            </Icon>
            <Text fontWeight="semibold" fontSize="lg">
              {t("core.title")}
            </Text>
          </HStack>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <CoreSettingModalContent />
      </ModalContent>
    </Modal>
  );
};
