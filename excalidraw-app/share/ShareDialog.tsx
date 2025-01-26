import { useRef } from "react";
import { copyTextToSystemClipboard } from "../../packages/excalidraw/clipboard";
import { trackEvent } from "../../packages/excalidraw/analytics";
import { useI18n } from "../../packages/excalidraw/i18n";
import { Dialog } from "../../packages/excalidraw/components/Dialog";
import {
  copyIcon,
  playerStopFilledIcon,
} from "../../packages/excalidraw/components/icons";
import { TextField } from "../../packages/excalidraw/components/TextField";
import { FilledButton } from "../../packages/excalidraw/components/FilledButton";
import { atom, useAtom } from "../app-jotai";
import type { CollabAPI } from "../collab/Collab";
import { collabAPIAtom, isCollaboratingAtom } from "../collab/Collab";
import { useCopyStatus } from "../../packages/excalidraw/hooks/useCopiedIndicator";
import "./ShareDialog.scss";

export const shareDialogStateAtom = atom<{
  isOpen: boolean;
  type: "collaborationOnly" | "share" | null;
}>({
  isOpen: false,
  type: null,
});

interface ShareDialogProps {
  onClose: () => void;
  activeRoomLink: string;
}

const ShareDialog = ({ onClose, activeRoomLink }: ShareDialogProps) => {
  const { t } = useI18n();
  const { onCopy, copyStatus } = useCopyStatus();
  const ref = useRef<HTMLInputElement>(null);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtom(isCollaboratingAtom);
  const [dialogState] = useAtom(shareDialogStateAtom);

  if (!isCollaborating && dialogState.type === "collaborationOnly") {
    return (
      <Dialog
        onCloseRequest={onClose}
        title={t("labels.liveCollaboration")}
        size="small"
      >
        <div className="ShareDialog__start">
          <button
            className="ShareDialog__start-button"
            onClick={async () => {
              try {
                await collabAPI?.startCollaboration();
              } catch (error) {
                console.error(error);
              }
            }}
          >
            {"Start Collaboration"}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      onCloseRequest={onClose}
      title={t("labels.liveCollaboration")}
      size="small"
    >
      <div className="ShareDialog">
        <TextField
          ref={ref}
          label="Link"
          readonly
          fullWidth
          value={activeRoomLink}
        />
        <FilledButton
          size="large"
          label={t("labels.copy")}
          icon={copyIcon}
          status={copyStatus}
          onClick={() => {
            copyTextToSystemClipboard(activeRoomLink);
            onCopy();
          }}
        />
        {dialogState.type === "collaborationOnly" && (
          <FilledButton
            size="large"
            variant="outlined"
            color="danger"
            label={"Stop Collaboration"}
            icon={playerStopFilledIcon}
            onClick={() => {
              trackEvent("share", "room closed");
              collabAPI?.stopCollaboration();
              !collabAPI?.isCollaborating() && onClose();
            }}
          />
        )}
      </div>
    </Dialog>
  );
};

export default ShareDialog;
