"use client";

import { useState } from "react";
import { Copy, Video } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { emitAppEvent } from "@/lib/app-events";
import { openComposer, type StudioSession } from "@/lib/studio/session-store";
import type { ScriptOutput } from "@/lib/studio/jobs";

export function ScriptVideoActions({
  session,
  script,
  disabled,
  onCopy,
}: {
  session: StudioSession;
  script: ScriptOutput;
  disabled: boolean;
  onCopy: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Your script is ready.{" "}
        {choosing
          ? "Choose how to bring it to life. Your script carries over."
          : "Turn it into a video, or copy it to use yourself."}
      </p>
      {choosing ? (
        <>
          <Button
            className="h-auto min-w-0 justify-start whitespace-normal py-3 text-left"
            disabled={disabled}
            onClick={() => {
              emitAppEvent("open:ugc-studio", {
                source: {
                  workspaceId: session.workspaceId,
                  script,
                  platforms: session.controls.platforms,
                },
              });
            }}
          >
            <Video />
            <span>
              <span className="block">Creator video · UGC</span>
              <span className="block text-xs font-normal opacity-80">
                A person presents your product using this script
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto min-w-0 justify-start whitespace-normal py-3 text-left"
            disabled={disabled}
            onClick={() =>
              openComposer({
                type: "video",
                brief: `Make a video from my reviewed script: ${script.title}. Follow the attached scenes, dialogue and call to action.`,
                sourceScript: script,
                platforms: session.controls.platforms,
                durationSec: script.durationSec,
                referenceAssetIds: session.controls.referenceAssetIds,
              })
            }
          >
            <Video />
            <span>
              <span className="block">Visual video</span>
              <span className="block text-xs font-normal opacity-80">
                Bring your scenes to life with voiceover
              </span>
            </span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>
            Back
          </Button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={onCopy}>
            <Copy />
            Copy script
          </Button>
          <Button disabled={disabled} onClick={() => setChoosing(true)}>
            <Video />
            Make video
          </Button>
        </div>
      )}
    </div>
  );
}
