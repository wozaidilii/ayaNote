"use client";

import {
  ClassroomBoard,
  type ClassroomBoardState,
} from "@/components/classroom-board";
import { ClassroomVideo } from "@/components/classroom-video";

type VideoLabels = {
  title: string;
  join: string;
  leave: string;
  connecting: string;
  notConfigured: string;
  recording: string;
  ending: string;
  endAndTranscribe: string;
  leaveOnly: string;
  errorToken: string;
  errorTranscribe: string;
  okTranscribed: string;
  sttMissing: string;
  hint: string;
};

type BoardLabels = {
  planTitle: string;
  notesTitle: string;
  warmup: string;
  review: string;
  newFocus: string;
  practice: string;
  homework: string;
  notesHint: string;
  saving: string;
  saved: string;
  peerUpdated: string;
  saveError: string;
};

export function ClassroomWorkspace({
  lessonId,
  isPast,
  livekitReady,
  sttReady,
  board,
  videoLabels,
  boardLabels,
  pastBanner,
}: {
  lessonId: string;
  isPast: boolean;
  livekitReady: boolean;
  sttReady: boolean;
  board: ClassroomBoardState;
  videoLabels: VideoLabels;
  boardLabels: BoardLabels;
  pastBanner: string;
}) {
  return (
    <div className="classroom-layout">
      <section className="classroom-media">
        {isPast ? (
          <div className="panel">
            <p className="chip">{pastBanner}</p>
            <p className="muted" style={{ marginBottom: 0 }}>
              {boardLabels.planTitle}
            </p>
          </div>
        ) : (
          <ClassroomVideo
            lessonId={lessonId}
            livekitReady={livekitReady}
            sttReady={sttReady}
            labels={videoLabels}
            redirectBase={`/classroom/${lessonId}`}
          />
        )}
      </section>
      <section className="classroom-plan panel">
        <ClassroomBoard
          lessonId={lessonId}
          initial={board}
          labels={boardLabels}
        />
      </section>
    </div>
  );
}
