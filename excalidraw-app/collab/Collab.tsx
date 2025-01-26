import { PureComponent } from "react";
import { CRDTEngine, type CRDTOperation } from "./crdt";
import { ExcalidrawImperativeAPI } from "../../packages/excalidraw/types";
import {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "../../packages/excalidraw/element/types";
import { StoreAction } from "../../packages/excalidraw";

const SIGNALING_SERVER =
  process.env.NODE_ENV === "development"
    ? "ws://localhost:3001"
    : "wss://your-domain.com/collab";

interface CollabProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
}

interface CollabState {
  error: string | null;
}

class Collab extends PureComponent<CollabProps, CollabState> {
  private crdt = new CRDTEngine();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private userId = crypto.randomUUID();
  private ws: WebSocket | null = null;
  private roomId: string;

  constructor(props: CollabProps) {
    super(props);
    this.roomId = window.location.pathname.split("/popout/").pop() || "default";
    this.state = { error: null };
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
          case "user-joined":
            if (msg.userId !== this.userId)
              this.createPeerConnection(msg.userId);
            break;
          case "user-left":
            this.peerConnections.get(msg.userId)?.close();
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

  render() {
    return null;
  }
}

export default Collab;
