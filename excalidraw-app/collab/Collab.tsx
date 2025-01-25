import throttle from "lodash.throttle";
import { PureComponent } from "react";
import * as Y from "yjs"; // 🔥 YJS CHANGE
import { WebrtcProvider } from "y-webrtc"; // 🔥 YJS CHANGE
import { IndexeddbPersistence } from "y-indexeddb"; // 🔥 YJS CHANGE
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "../../packages/excalidraw/types";
import { ErrorDialog } from "../../packages/excalidraw/components/ErrorDialog";
import { APP_NAME, ENV, EVENT } from "../../packages/excalidraw/constants";
import type { ImportedDataState } from "../../packages/excalidraw/data/types";
import type {
  ExcalidrawElement,
  FileId,
  InitializedExcalidrawImageElement,
} from "../../packages/excalidraw/element/types";
import {
  StoreAction,
  getSceneVersion,
  restoreElements,
} from "../../packages/excalidraw";
import type { Collaborator } from "../../packages/excalidraw/types";
import {
  assertNever,
  preventUnload,
  resolvablePromise,
  throttleRAF,
} from "../../packages/excalidraw/utils";
import {
  CURSOR_SYNC_TIMEOUT,
  FILE_UPLOAD_MAX_BYTES,
  INITIAL_SCENE_UPDATE_TIMEOUT,
  LOAD_IMAGES_TIMEOUT,
  WS_SUBTYPES,
  SYNC_FULL_SCENE_INTERVAL_MS,
} from "../app_constants";
import type { SocketUpdateDataSource } from "../data";
import { generateCollaborationLinkData, getCollaborationLink } from "../data";
import {
  importUsernameFromLocalStorage,
  saveUsernameToLocalStorage,
} from "../data/localStorage";
import { t } from "../../packages/excalidraw/i18n";
import { UserIdleState } from "../../packages/excalidraw/types";
import { IDLE_THRESHOLD } from "../../packages/excalidraw/constants";
import {
  encodeFilesForUpload,
  FileManager,
  updateStaleImageStatuses,
} from "../data/FileManager";
import { AbortError } from "../../packages/excalidraw/errors";
import {
  isImageElement,
  isInitializedImageElement,
} from "../../packages/excalidraw/element/typeChecks";
import { newElementWith } from "../../packages/excalidraw/element/mutateElement";
import { decryptData } from "../../packages/excalidraw/data/encryption";
import { resetBrowserStateVersions } from "../data/tabSync";
import { LocalData } from "../data/LocalData";
import { appJotaiStore, atom } from "../app-jotai";
import type { Mutable } from "../../packages/excalidraw/utility-types";
import { getVisibleSceneBounds } from "../../packages/excalidraw/element/bounds";
import { withBatchedUpdates } from "../../packages/excalidraw/reactUtils";
import { collabErrorIndicatorAtom } from "./CollabError";

export const collabAPIAtom = atom<CollabAPI | null>(null);
export const isCollaboratingAtom = atom(false);
export const isOfflineAtom = atom(false);

interface CollabState {
  errorMessage: string | null;
  dialogNotifiedErrors: Record<string, boolean>;
  username: string;
  activeRoomLink: string | null;
}

export const activeRoomLinkAtom = atom<string | null>(null);

type CollabInstance = InstanceType<typeof Collab>;

export interface CollabAPI {
  isCollaborating: () => boolean;
  onPointerUpdate: CollabInstance["onPointerUpdate"];
  startCollaboration: CollabInstance["startCollaboration"];
  stopCollaboration: CollabInstance["stopCollaboration"];
  syncElements: CollabInstance["syncElements"];
  fetchImageFilesFromFirebase: CollabInstance["fetchImageFilesFromFirebase"];
  setUsername: CollabInstance["setUsername"];
  getUsername: CollabInstance["getUsername"];
  getActiveRoomLink: CollabInstance["getActiveRoomLink"];
  setCollabError: CollabInstance["setErrorDialog"];
}

interface CollabProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
}

class Collab extends PureComponent<CollabProps, CollabState> {
  // 🔥 YJS CHANGE START
  ydoc: Y.Doc;
  provider: WebrtcProvider;
  persistence: IndexeddbPersistence;
  yElements: Y.Array<ExcalidrawElement>;
  awareness: Awareness;
  // 🔥 YJS CHANGE END

  excalidrawAPI: CollabProps["excalidrawAPI"];
  activeIntervalId: number | null;
  idleTimeoutId: number | null;

  private lastBroadcastedOrReceivedSceneVersion: number = -1;
  private collaborators = new Map<string, Collaborator>();

  constructor(props: CollabProps) {
    super(props);
    this.state = {
      errorMessage: null,
      dialogNotifiedErrors: {},
      username: importUsernameFromLocalStorage() || "",
      activeRoomLink: null,
    };

    // 🔥 YJS CHANGE START
    this.ydoc = new Y.Doc();
    this.yElements = this.ydoc.getArray<ExcalidrawElement>("elements");
    this.persistence = new IndexeddbPersistence("excalidraw", this.ydoc);
    this.provider = new WebrtcProvider("excalidraw-room", this.ydoc, {
      signaling: ["wss://y-webrtc-excalidraw.glitch.me"],
    });
    this.awareness = this.provider.awareness;
    // 🔥 YJS CHANGE END

    this.excalidrawAPI = props.excalidrawAPI;
    this.activeIntervalId = null;
    this.idleTimeoutId = null;
  }

  componentDidMount() {
    window.addEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
    window.addEventListener("online", this.onOfflineStatusToggle);
    window.addEventListener("offline", this.onOfflineStatusToggle);

    // 🔥 YJS CHANGE START
    this.yElements.observe((event) => {
      if (event.transaction.origin !== this) {
        this.excalidrawAPI.updateScene({
          elements: this.yElements.toArray(),
          storeAction: StoreAction.UPDATE,
        });
      }
    });

    this.awareness.on("change", () => {
      const collaborators = new Map(
        Array.from(this.awareness.getStates().entries()).map(
          ([clientId, state]) => [
            clientId.toString(),
            {
              pointer: state.cursor,
              username: state.user?.name,
              userState: state.user?.state,
              avatarUrl: state.user?.avatar,
            },
          ],
        ),
      );
      this.excalidrawAPI.updateScene({ collaborators });
    });
    // 🔥 YJS CHANGE END

    const collabAPI: CollabAPI = {
      isCollaborating: this.isCollaborating,
      onPointerUpdate: this.onPointerUpdate,
      startCollaboration: this.startCollaboration,
      syncElements: this.syncElements,
      fetchImageFilesFromFirebase: this.fetchImageFilesFromFirebase,
      stopCollaboration: this.stopCollaboration,
      setUsername: this.setUsername,
      getUsername: this.getUsername,
      getActiveRoomLink: this.getActiveRoomLink,
      setCollabError: this.setErrorDialog,
    };

    appJotaiStore.set(collabAPIAtom, collabAPI);
  }

  componentWillUnmount() {
    // 🔥 YJS CHANGE START
    this.ydoc.destroy();
    this.provider.destroy();
    this.persistence.destroy();
    // 🔥 YJS CHANGE END

    window.removeEventListener("online", this.onOfflineStatusToggle);
    window.removeEventListener("offline", this.onOfflineStatusToggle);
    window.removeEventListener(EVENT.BEFORE_UNLOAD, this.beforeUnload);
  }

  // 🔥 YJS CHANGE START - Simplified collaboration methods
  startCollaboration = async (
    existingRoomLinkData: null | { roomId: string; roomKey: string },
  ) => {
    if (!this.state.username) {
      const { getRandomUsername } = await import("@excalidraw/random-username");
      this.setUsername(getRandomUsername());
    }

    this.setIsCollaborating(true);
    LocalData.pauseSave("collaboration");
    this.setActiveRoomLink(window.location.href);
    return resolvablePromise().promise;
  };

  stopCollaboration = (keepRemoteState = true) => {
    this.setIsCollaborating(false);
    this.setActiveRoomLink(null);
    LocalData.resumeSave("collaboration");
  };
  // 🔥 YJS CHANGE END

  syncElements = (elements: readonly ExcalidrawElement[]) => {
    // 🔥 YJS CHANGE
    Y.transact(
      this.ydoc,
      () => {
        this.yElements.delete(0, this.yElements.length);
        this.yElements.push(elements);
      },
      this,
    );
  };

  onPointerUpdate = throttle(
    (payload: {
      pointer: { x: number; y: number };
      button: "up" | "down";
      pointersMap: Gesture["pointers"];
    }) => {
      this.awareness.setLocalState({
        cursor: payload.pointer,
        user: {
          name: this.state.username,
          color: "#FF0000",
          state: payload.button === "down" ? "active" : "idle",
        },
      });
    },
    CURSOR_SYNC_TIMEOUT,
  );

  // 🔥 YJS CHANGE - Removed Firebase file storage methods
  fetchImageFilesFromFirebase = async () => {
    return new Map<FileId, BinaryFileData>();
  };

  // 🔥 YJS CHANGE - Simplified remaining methods
  private setIsCollaborating = (isCollaborating: boolean) => {
    appJotaiStore.set(isCollaboratingAtom, isCollaborating);
  };

  setUsername = (username: string) => {
    this.setState({ username });
    saveUsernameToLocalStorage(username);
    this.awareness.setLocalState({ user: { name: username } });
  };

  getUsername = () => this.state.username;
  getActiveRoomLink = () => this.state.activeRoomLink;
  setActiveRoomLink = (link: string | null) =>
    this.setState({ activeRoomLink: link });

  render() {
    return this.state.errorMessage ? (
      <ErrorDialog onClose={() => this.setState({ errorMessage: null })}>
        {this.state.errorMessage}
      </ErrorDialog>
    ) : null;
  }
}

export default Collab;
