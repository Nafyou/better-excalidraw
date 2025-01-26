import type { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import type { SocketId, Collaborator } from "../../packages/excalidraw/types";
import { 
  CRDTOperation, 
  type CollaboratorColor,
  isElementOperation,
  isCursorOperation,
  isValidCRDTOperation 
} from "./types";

interface CursorState {
  readonly x: number;
  readonly y: number;
  readonly version: number;
  readonly color?: CollaboratorColor;
}

const DEFAULT_COLOR: CollaboratorColor = {
  background: "#ffffff",
  stroke: "#000000"
} as const;

export class CRDTEngine {
  private readonly elements = new Map<string, ExcalidrawElement>();
  private readonly cursors = new Map<string, CursorState>();
  private version = 0;

  applyOperation(op: unknown): boolean {
    if (!isValidCRDTOperation(op)) {
      console.warn("Invalid CRDT operation received:", op);
      return false;
    }

    if (isElementOperation(op)) {
      op.elements.forEach(element => {
        const existing = this.elements.get(element.id);
        if (!existing || op.version > (existing.version || 0)) {
          this.elements.set(element.id, { ...element, version: op.version });
        }
      });
      return true;
    }

    if (isCursorOperation(op)) {
      const current = this.cursors.get(op.userId);
      if (!current || op.version > current.version) {
        this.cursors.set(op.userId, { 
          x: op.x, 
          y: op.y, 
          version: op.version,
          color: op.color 
        });
      }
      return true;
    }

    return false;
  }

  getElements(): readonly ExcalidrawElement[] {
    return Array.from(this.elements.values()).map(element => ({
      ...element,
      version: this.version,
    }));
  }

  getCursors(): Map<SocketId, Collaborator> {
    const cursorsMap = new Map<SocketId, Collaborator>();
    this.cursors.forEach((cursor, userId) => {
      const socketId = userId as SocketId;
      cursorsMap.set(socketId, {
        pointer: {
          x: cursor.x,
          y: cursor.y,
          tool: "pointer",
        },
        socketId,
        button: "up",
        selectedElementIds: {},
        username: "",
        color: cursor.color || DEFAULT_COLOR,
      });
    });
    return cursorsMap;
  }

  getNextVersion(): number {
    return ++this.version;
  }
}