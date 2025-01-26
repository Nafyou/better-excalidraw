import { PureComponent } from "react";
import { CRDTEngine } from "./crdt";
import type {
  ExcalidrawImperativeAPI,
  BinaryFiles,
  AppState,
  BinaryFileData,
  DataURL,
  CollaboratorPointer,
  UserIdleState,
} from "../../packages/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  FileId,
  ExcalidrawImageElement,
} from "../../packages/excalidraw/element/types";
import { StoreAction } from "../../packages/excalidraw";
import { atom } from "../app-jotai";
import type { SocketId } from "../../packages/excalidraw/types";
import { newElementWith } from "../../packages/excalidraw/element/mutateElement";
import { FILE_UPLOAD_TIMEOUT } from "../app_constants";
import throttle from "lodash.throttle";
import { isInitializedImageElement } from "../../packages/excalidraw/element/typeChecks";
import {
  type CollaboratorColor,
  type CRDTOperation,
  ShareDialogState,
} from "./types";

const SIGNALING_SERVER =
  process.env.NODE_ENV === "development"
    ? "ws://localhost:3001"
    : "wss://your-domain.com/collab";

interface FileManagerFile {
  dataURL: DataURL;
  created: number;
  mimeType: string;
  id: FileId;
}

class FileManager {
  private files: Map<FileId, BinaryFileData> = new Map();
  private pendingFiles: Set<FileId> = new Set();

  async saveFiles({
    elements,
    files,
  }: {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
  }) {
    // Store files in memory for this example
    Object.entries(files).forEach(([id, file]) => {
      this.files.set(id as FileId, file);
    });
    return { savedFiles: this.files, erroredFiles: new Map() };
  }

  shouldUpdateImageElementStatus(element: ExcalidrawElement): boolean {
    return (
      isInitializedImageElement(element) &&
      element.fileId != null &&
      !this.files.has(element.fileId) &&
      !this.pendingFiles.has(element.fileId)
    );
  }
}

interface CollaboratorData {
  pointer?: CollaboratorPointer;
  button?: "up" | "down";
  selectedElementIds?: Readonly<{ [id: string]: true }>;
  username?: string;
  userState?: UserIdleState;
  color?: CollaboratorColor;
  isFollowing?: boolean;
  followedBy?: boolean;
  isMuted?: boolean;
}

export interface CollabAPI {
  syncElements: (elements: readonly NonDeletedExcalidrawElement[]) => void;
  syncCursor: (pos: { x: number; y: number }) => void;
  startCollaboration: (
    data?: { roomId: string; roomKey: string } | null,
  ) => Promise<any>;
  stopCollaboration: (keepRemoteState?: boolean) => void;
  isCollaborating: () => boolean;
  setUsername: (username: string) => void;
  getSceneElementsIncludingDeleted: () => readonly ExcalidrawElement[];
  getFiles: () => BinaryFiles;
  setCollaborators: (clients: SocketId[]) => void;
  excalidrawAPI: ExcalidrawImperativeAPI;
  state: {
    username: string;
  };
  fileManager: FileManager;
  setCollabError: (error: string | null) => void;
  getUsername: () => string;
}

// Add Jotai atoms
export const collabAPIAtom = atom<CollabAPI | null>(null);
export const isCollaboratingAtom = atom<boolean>(false);
export const isOfflineAtom = atom<boolean>(false);
export const activeRoomLinkAtom = atom<string | null>(null);

interface CollabProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  onCollabChange: (collab: CollabAPI | null) => void;
}

interface CollabState {
  error: string | null;
  username: string;
}

// Export the class type for Portal.tsx to use
export type TCollabClass = Collab;

class Collab
  extends PureComponent<CollabProps, CollabState>
  implements CollabAPI
{
  private crdt = new CRDTEngine();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private userId = crypto.randomUUID();
  private ws: WebSocket | null = null;
  private roomId: string;
  private collaborators: Map<SocketId, Readonly<CollaboratorData>> = new Map();
  public fileManager: FileManager;

  constructor(props: CollabProps) {
    super(props);
    this.roomId = window.location.pathname.split("/popout/").pop() || "default";
    this.state = { error: null, username: "" };
    this.fileManager = new FileManager();
  }

  componentDidMount() {
    this.initializeCollaboration();
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  private initializeCollaboration = () => {
    try {
      this.ws = new WebSocket(SIGNALING_SERVER);

      this.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "room-state":
            this.setCollaborators(msg.state.collaborators);
            if (msg.state.elements) {
              this.props.excalidrawAPI.updateScene({
                elements: msg.state.elements,
                collaborators: this.collaborators,
                storeAction: StoreAction.UPDATE,
              });
            }
            break;
          case "user-joined":
            if (msg.userId !== this.userId) {
              await this.createPeerConnection(msg.userId);
              this.updateCollaboratorsCount();
            }
            break;
          case "user-left":
            this.peerConnections.get(msg.userId)?.close();
            this.collaborators.delete(msg.userId);
            this.updateCollaboratorsCount();
            break;
          case "signal":
            this.handleSignal(msg);
            break;
        }
      };

      this.ws.onopen = () => {
        this.ws?.send(
          JSON.stringify({
            type: "join",
            roomId: this.roomId,
            userId: this.userId,
          }),
        );
      };
    } catch (error) {
      this.setState({ error: "Failed to initialize collaboration" });
    }
  };

  private createPeerConnection = async (targetId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.ws?.send(
          JSON.stringify({
            type: "signal",
            target: targetId,
            candidate: e.candidate,
          }),
        );
      }
    };

    const dc = pc.createDataChannel("crdt");
    dc.onmessage = (e) => this.handleCRDTOperation(JSON.parse(e.data));
    this.dataChannels.set(targetId, dc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.ws?.send(
        JSON.stringify({
          type: "signal",
          target: targetId,
          description: pc.localDescription,
        }),
      );

      this.peerConnections.set(targetId, pc);
    } catch (error) {
      console.error("Peer connection failed:", error);
    }
  };

  private handleSignal = async (msg: any) => {
    try {
      const pc =
        this.peerConnections.get(msg.sender) ||
        new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

      if (msg.description) {
        await pc.setRemoteDescription(msg.description);
        if (msg.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.ws?.send(
            JSON.stringify({
              type: "signal",
              target: msg.sender,
              description: answer,
            }),
          );
        }
      }

      if (msg.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    } catch (error) {
      console.error("Signal handling failed:", error);
    }
  };

  private handleCRDTOperation = (op: CRDTOperation) => {
    this.crdt.applyOperation(op);
    this.props.excalidrawAPI.updateScene({
      elements:
        this.crdt.getElements() as readonly NonDeletedExcalidrawElement[],
      collaborators: this.crdt.getCursors(),
      storeAction: "update",
    });
  };

  syncElements = (elements: readonly NonDeletedExcalidrawElement[]) => {
    const op: CRDTOperation = {
      type: "element",
      elements: elements as ExcalidrawElement[],
      version: this.crdt.getNextVersion(),
    };

    this.dataChannels.forEach((dc) => {
      if (dc.readyState === "open") {
        dc.send(JSON.stringify(op));
      }
    });
  };

  syncCursor = (pos: { x: number; y: number }) => {
    const op: CRDTOperation = {
      type: "cursor",
      x: pos.x,
      y: pos.y,
      userId: this.userId,
      version: this.crdt.getNextVersion(),
    };

    this.dataChannels.forEach((dc) => {
      if (dc.readyState === "open") {
        dc.send(JSON.stringify(op));
      }
    });
  };

  componentWillUnmount() {
    this.ws?.close();
    this.peerConnections.forEach((pc) => pc.close());
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
  }

  private handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.dataChannels.size > 0) {
      e.preventDefault();
      this.syncElements(this.props.excalidrawAPI.getSceneElements());
    }
  };

  setUsername = (username: string) => {
    this.setState({ username });
  };

  isCollaborating = () => {
    return this.dataChannels.size > 0;
  };

  startCollaboration = async (
    data?: { roomId: string; roomKey: string } | null,
  ) => {
    if (data) {
      this.roomId = data.roomId;
    } else if (!this.roomId) {
      throw new Error("Room ID is required for collaboration");
    }

    await this.initializeCollaboration();
    return { elements: this.crdt.getElements(), appState: {} };
  };

  stopCollaboration = (keepRemoteState = false) => {
    this.ws?.close();
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.dataChannels.clear();

    if (!keepRemoteState) {
      // Reset to empty state if needed
      this.crdt = new CRDTEngine();
    }
  };

  getSceneElementsIncludingDeleted = () => {
    return this.props.excalidrawAPI.getSceneElementsIncludingDeleted();
  };

  getFiles = () => {
    return this.props.excalidrawAPI.getFiles();
  };

  setCollaborators = (clients: SocketId[]) => {
    const collaboratorsMap = new Map<SocketId, Readonly<CollaboratorData>>();
    clients.forEach((clientId) => {
      const color: CollaboratorColor = {
        background: "#" + Math.floor(Math.random() * 16777215).toString(16),
        stroke: "#000000",
      };

      collaboratorsMap.set(
        clientId,
        Object.freeze({
          username: "",
          userState: "idle" as UserIdleState,
          color,
        }),
      );
    });

    this.collaborators = collaboratorsMap;
    this.props.excalidrawAPI.updateScene({
      collaborators: this.collaborators,
    });
  };

  get excalidrawAPI() {
    return this.props.excalidrawAPI;
  }

  queueFileUpload = throttle(async () => {
    try {
      await this.fileManager.saveFiles({
        elements: this.getSceneElementsIncludingDeleted(),
        files: this.getFiles(),
      });

      let isChanged = false;
      const newElements = this.getSceneElementsIncludingDeleted().map(
        (element) => {
          if (this.fileManager.shouldUpdateImageElementStatus(element)) {
            isChanged = true;
            return {
              ...element,
              updated: Date.now(),
              version: element.version + 1,
            };
          }
          return element;
        },
      );

      if (isChanged) {
        this.props.excalidrawAPI.updateScene({
          elements: newElements,
          storeAction: StoreAction.UPDATE,
        });
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        this.props.excalidrawAPI.updateScene({
          appState: {
            errorMessage: error.message,
          },
        });
      }
    }
  }, FILE_UPLOAD_TIMEOUT);

  setCollabError = (error: string | null) => {
    this.setState({ error });
  };

  getUsername = () => {
    return this.state.username;
  };

  private updateCollaboratorsCount = () => {
    const isCollaborating = this.dataChannels.size > 0;
    this.props.onCollabChange?.(isCollaborating ? this : null);
    this.props.excalidrawAPI.updateScene({
      collaborators: this.collaborators,
    });
  };

  render() {
    return null;
  }
}

export default Collab;
