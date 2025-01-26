import type { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import type { SocketId, Collaborator } from "../../packages/excalidraw/types";

export type CRDTOperation = 
  | { type: "element"; elements: ExcalidrawElement[]; version: number }
  | { type: "cursor"; x: number; y: number; userId: string; version: number };

type CursorState = {
  x: number;
  y: number;
  version: number;
};

export class CRDTEngine {
  private elements = new Map<string, ExcalidrawElement>();
  private cursors = new Map<string, CursorState>();
  private version = 0;

  applyOperation(op: CRDTOperation) {
    if (op.type === "element") {
      op.elements.forEach(element => {
        const existing = this.elements.get(element.id);
        if (!existing || op.version > (existing.version || 0)) {
          this.elements.set(element.id, { ...element, version: op.version });
        }
      });
    } else {
      const current = this.cursors.get(op.userId);
      if (!current || op.version > current.version) {
        this.cursors.set(op.userId, { x: op.x, y: op.y, version: op.version });
      }
    }
  }

  getElements(): ExcalidrawElement[] {
    return Array.from(this.elements.values()).map(element => ({
      ...element,
      version: this.version,
    }));
  }

  getCursors(): Map<SocketId, Collaborator> {
    const cursorsMap = new Map<SocketId, Collaborator>();
    this.cursors.forEach((cursor, userId) => {
      const socketId = userId as unknown as SocketId;
      cursorsMap.set(socketId, {
        pointer: {
          x: cursor.x,
          y: cursor.y,
          tool: "pointer",
        },
        socketId,
        button: "up",
      });
    });
    return cursorsMap;
  }

  getNextVersion(): number {
    return ++this.version;
  }
}