import { t } from "../../i18n";
import { share } from "../icons";
import { Button } from "../Button";
import clsx from "clsx";
import "./LiveCollaborationTrigger.scss";
import { useUIAppState } from "../../context/ui-appState";
import { useAtom } from "../../editor-jotai";
import { isCollaboratingAtom } from "excalidraw-app/collab/Collab";
const LiveCollaborationTrigger = ({
  onSelect,
  ...rest
}: {
  onSelect: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const appState = useUIAppState();
  const [isCollaborating] = useAtom(isCollaboratingAtom);

  const showIconOnly = appState.width < 830;

  return (
    <Button
      {...rest}
      className={clsx("collab-button", { active: isCollaborating })}
      type="button"
      onSelect={onSelect}
      style={{ position: "relative", width: showIconOnly ? undefined : "auto" }}
      title={t("labels.liveCollaboration")}
    >
      {showIconOnly ? share : t("labels.share")}
      {appState.collaborators.size > 0 && (
        <div className="CollabButton-collaborators">
          {appState.collaborators.size}
        </div>
      )}
    </Button>
  );
};

export default LiveCollaborationTrigger;
LiveCollaborationTrigger.displayName = "LiveCollaborationTrigger";
