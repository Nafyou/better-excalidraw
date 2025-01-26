import type { ExcalidrawElement } from "../../packages/excalidraw/element/types";

export type ShareDialogType = "share" | "collaborationOnly";

export type CollaboratorPointer = {
  x: number;
  y: number;
  tool: "pointer" | "hand" | "laser";
};

export type UserIdleState = "idle" | "active";

export type OnExportToBackend = () => Promise<void>;

export interface ShareDialogState {
  isOpen: boolean;
  type: ShareDialogType;
  activeRoomLink?: string | undefined;
}

export interface CollaboratorData {
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

export type CollaboratorColor = {
  readonly background: string;
  readonly stroke: string;
};

export type CRDTOperation = 
  | ElementOperation
  | CursorOperation;

export interface ElementOperation {
  readonly type: "element";
  readonly elements: readonly ExcalidrawElement[];
  readonly version: number;
}

export interface CursorOperation {
  readonly type: "cursor";
  readonly x: number;
  readonly y: number;
  readonly userId: string;
  readonly version: number;
  readonly color?: CollaboratorColor;
}

export function isValidColor(color: unknown): color is CollaboratorColor {
  return (
    typeof color === "object" &&
    color !== null &&
    "background" in color &&
    "stroke" in color &&
    typeof color.background === "string" &&
    typeof color.stroke === "string"
  );
}

export function isElementOperation(op: unknown): op is ElementOperation {
  return (
    typeof op === "object" &&
    op !== null &&
    "type" in op &&
    op.type === "element" &&
    "elements" in op &&
    Array.isArray(op.elements) &&
    "version" in op &&
    typeof op.version === "number" &&
    op.elements.every(element => 
      typeof element === "object" &&
      element !== null &&
      "id" in element
    )
  );
}

export function isCursorOperation(op: unknown): op is CursorOperation {
  const basicCheck = (
    typeof op === "object" &&
    op !== null &&
    "type" in op &&
    op.type === "cursor" &&
    "x" in op &&
    typeof op.x === "number" &&
    "y" in op &&
    typeof op.y === "number" &&
    "userId" in op &&
    typeof op.userId === "string" &&
    "version" in op &&
    typeof op.version === "number"
  );

  if (!basicCheck) return false;

  const cursorOp = op as CursorOperation;
  return cursorOp.color === undefined || isValidColor(cursorOp.color);
}

export function isValidCRDTOperation(op: unknown): op is CRDTOperation {
  return isElementOperation(op) || isCursorOperation(op);
}