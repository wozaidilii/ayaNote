"use client";

import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { RoomEvent, Track } from "livekit-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ClassroomDocEditor,
  type ClassroomSaveStatus,
} from "@/components/classroom-doc-editor";
import type { TiptapDoc } from "@/lib/classroom-doc";

type Labels = {
  connecting: string;
  notConfigured: string;
  recording: string;
  ending: string;
  endAndTranscribe: string;
  leaveOnly: string;
  rejoin: string;
  leftCall: string;
  errorToken: string;
  errorTranscribe: string;
  sttMissing: string;
  pastBanner: string;
  docPlaceholder: string;
  statusSaving: string;
  statusSaved: string;
  statusLive: string;
  statusError: string;
  screenShare: string;
  enlargeVideo: string;
  restoreBoard: string;
  clickBoardReturn: string;
};

function MixedAudioRecorder({
  active,
  onChunk,
}: {
  active: boolean;
  onChunk: (blob: Blob) => void;
}) {
  const room = useRoomContext();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());

  const attachTrack = useCallback(
    (id: string, mediaStreamTrack: MediaStreamTrack) => {
      const ctx = ctxRef.current;
      const dest = destRef.current;
      if (!ctx || !dest) return;
      if (sourcesRef.current.has(id)) return;
      const stream = new MediaStream([mediaStreamTrack]);
      const source = ctx.createMediaStreamSource(stream);
      source.connect(dest);
      sourcesRef.current.set(id, source);
    },
    [],
  );

  const detachTrack = useCallback((id: string) => {
    const source = sourcesRef.current.get(id);
    if (!source) return;
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    sourcesRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!active) return;

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctxRef.current = ctx;
    destRef.current = dest;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = mimeType
      ? new MediaRecorder(dest.stream, { mimeType })
      : new MediaRecorder(dest.stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size > 0) onChunk(blob);
    };
    recorder.start(2000);

    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      const track = pub.track?.mediaStreamTrack;
      if (track) attachTrack(`local:${pub.trackSid}`, track);
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.audioTrackPublications.values()) {
        const track = pub.track?.mediaStreamTrack;
        if (track)
          attachTrack(`${participant.identity}:${pub.trackSid}`, track);
      }
    }

    const onSubscribed = (
      track: Track,
      publication: { trackSid: string },
      participant: { identity: string },
    ) => {
      if (track.kind !== Track.Kind.Audio) return;
      const mst = track.mediaStreamTrack;
      if (mst)
        attachTrack(`${participant.identity}:${publication.trackSid}`, mst);
    };
    const onUnsubscribed = (
      _track: Track,
      publication: { trackSid: string },
      participant: { identity: string },
    ) => {
      detachTrack(`${participant.identity}:${publication.trackSid}`);
    };

    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.LocalTrackPublished, (pub) => {
      const track = pub.track?.mediaStreamTrack;
      if (pub.kind === Track.Kind.Audio && track) {
        attachTrack(`local:${pub.trackSid}`, track);
      }
    });

    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      for (const id of [...sourcesRef.current.keys()]) detachTrack(id);
      void ctx.close();
      ctxRef.current = null;
      destRef.current = null;
      recorderRef.current = null;
    };
  }, [active, attachTrack, detachTrack, onChunk, room]);

  return null;
}

function VideoTiles() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="classroom-filmstrip-tiles">
      {tracks.map((trackRef) => (
        <ParticipantTile
          key={`${trackRef.participant.identity}-${trackRef.source}`}
          trackRef={trackRef}
          className="classroom-filmstrip-tile"
        />
      ))}
    </div>
  );
}

function HoverAvControls() {
  return (
    <div className="classroom-av-tray" aria-label="Camera and microphone">
      <TrackToggle
        source={Track.Source.Microphone}
        className="classroom-av-toggle"
      />
      <TrackToggle
        source={Track.Source.Camera}
        className="classroom-av-toggle"
      />
    </div>
  );
}

function ScreenShareButton({ label }: { label: string }) {
  return (
    <TrackToggle
      source={Track.Source.ScreenShare}
      className="btn secondary sm classroom-screenshare-btn"
      showIcon
    >
      {label}
    </TrackToggle>
  );
}

function statusLabel(status: ClassroomSaveStatus, labels: Labels) {
  if (status === "saving") return labels.statusSaving;
  if (status === "saved") return labels.statusSaved;
  if (status === "live") return labels.statusLive;
  if (status === "error") return labels.statusError;
  return "";
}

function CallLayout({
  videoExpanded,
  setVideoExpanded,
  board,
  labels,
  error,
}: {
  videoExpanded: boolean;
  setVideoExpanded: (v: boolean) => void;
  board: ReactNode;
  labels: Labels;
  error: string | null;
}) {
  return (
    <div
      className={
        videoExpanded
          ? "classroom-meet-body is-call is-video-expanded"
          : "classroom-meet-body is-call"
      }
    >
      <aside className="classroom-float-dock" role="complementary">
        <VideoTiles />
        <HoverAvControls />
        {error && <p className="chip">{error}</p>}
      </aside>

      <section
        className="classroom-stage panel"
        onClick={
          videoExpanded
            ? () => {
                setVideoExpanded(false);
              }
            : undefined
        }
        role={videoExpanded ? "button" : undefined}
        tabIndex={videoExpanded ? 0 : undefined}
        onKeyDown={
          videoExpanded
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setVideoExpanded(false);
                }
              }
            : undefined
        }
        aria-label={videoExpanded ? labels.clickBoardReturn : undefined}
      >
        {videoExpanded && (
          <p className="classroom-dock-hint muted">{labels.clickBoardReturn}</p>
        )}
        <div
          className={
            videoExpanded
              ? "classroom-board-wrap is-compact-preview"
              : "classroom-board-wrap"
          }
        >
          {board}
        </div>
      </section>
    </div>
  );
}

export function ClassroomWorkspace({
  lessonId,
  isPast,
  livekitReady,
  sttReady,
  initialDoc,
  userName,
  role,
  titleLine,
  metaLine,
  backHref,
  lessonRoomHref,
  labels,
}: {
  lessonId: string;
  isPast: boolean;
  livekitReady: boolean;
  sttReady: boolean;
  initialDoc: TiptapDoc;
  userName: string;
  role: "teacher" | "student";
  titleLine: string;
  metaLine: string;
  backHref: string;
  lessonRoomHref: string | null;
  labels: Labels;
}) {
  const router = useRouter();
  const userColor = role === "teacher" ? "#2563eb" : "#059669";
  const [saveStatus, setSaveStatus] = useState<ClassroomSaveStatus>("idle");
  const [tokenInfo, setTokenInfo] = useState<{
    token: string;
    url: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordActive, setRecordActive] = useState(false);
  const [userLeftCall, setUserLeftCall] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const pendingUploadRef = useRef(false);

  const docKey = useMemo(() => JSON.stringify(initialDoc), [initialDoc]);

  const join = useCallback(async () => {
    if (!livekitReady || isPast) return;
    setLoading(true);
    setError(null);
    setUserLeftCall(false);
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }),
      });
      const data = (await res.json()) as {
        token?: string;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.token || !data.url) {
        setError(labels.errorToken + (data.error ? `: ${data.error}` : ""));
        return;
      }
      setTokenInfo({ token: data.token, url: data.url });
      setRecordActive(true);
      setVideoExpanded(false);
    } catch {
      setError(labels.errorToken);
    } finally {
      setLoading(false);
    }
  }, [isPast, labels.errorToken, lessonId, livekitReady]);

  useEffect(() => {
    if (!isPast && livekitReady && !tokenInfo && !userLeftCall) {
      void join();
    }
  }, [isPast, join, livekitReady, tokenInfo, userLeftCall]);

  const uploadAndSummarize = async (blob: Blob) => {
    setEnding(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "classroom.webm");
      const res = await fetch(`/api/lessons/${lessonId}/transcribe`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setError(
          labels.errorTranscribe +
            (data.detail || data.error ? `: ${data.detail || data.error}` : ""),
        );
        return;
      }
      setTokenInfo(null);
      setRecordActive(false);
      setVideoExpanded(false);
      if (role === "teacher") {
        router.push(`/lessons/${lessonId}?ok=summary`);
      } else {
        router.push(`/student/history`);
      }
      router.refresh();
    } catch {
      setError(labels.errorTranscribe);
    } finally {
      setEnding(false);
      pendingUploadRef.current = false;
    }
  };

  const onChunk = useCallback(
    (blob: Blob) => {
      if (!pendingUploadRef.current) return;
      void uploadAndSummarize(blob);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessonId],
  );

  const endAndTranscribe = () => {
    if (!sttReady) {
      setError(labels.sttMissing);
      return;
    }
    pendingUploadRef.current = true;
    setEnding(true);
    setRecordActive(false);
  };

  const leaveCall = () => {
    pendingUploadRef.current = false;
    setUserLeftCall(true);
    setRecordActive(false);
    setVideoExpanded(false);
    setTokenInfo(null);
  };

  useEffect(() => {
    if (tokenInfo && !recordActive && pendingUploadRef.current && ending) {
      const t = window.setTimeout(() => setTokenInfo(null), 400);
      return () => window.clearTimeout(t);
    }
  }, [ending, recordActive, tokenInfo]);

  const board = (
    <>
      {isPast && (
        <p className="classroom-past-banner muted">{labels.pastBanner}</p>
      )}
      <ClassroomDocEditor
        key={docKey + (tokenInfo ? "-live" : "-solo")}
        lessonId={lessonId}
        initialDoc={initialDoc}
        userName={userName}
        userColor={userColor}
        placeholder={labels.docPlaceholder}
        onStatus={setSaveStatus}
        autofocus
        enableLivekitSync={Boolean(tokenInfo)}
      />
    </>
  );

  const topBar = (inCall: boolean) => (
    <header className="classroom-meet-top panel">
      <div className="classroom-meet-top-text">
        <div className="classroom-meet-title">{titleLine}</div>
        <div className="classroom-meet-meta muted">{metaLine}</div>
      </div>
      <div className="classroom-meet-top-actions">
        <span className="classroom-meet-status muted">
          {statusLabel(saveStatus, labels)}
          {loading ? ` · ${labels.connecting}` : ""}
          {ending ? ` · ${labels.ending}` : ""}
          {recordActive && tokenInfo ? ` · ${labels.recording}` : ""}
        </span>
        {inCall && (
          <>
            <ScreenShareButton label={labels.screenShare} />
            <button
              className="btn secondary sm"
              type="button"
              disabled={ending}
              onClick={() => setVideoExpanded(!videoExpanded)}
            >
              {videoExpanded ? labels.restoreBoard : labels.enlargeVideo}
            </button>
            <button
              className="btn sm"
              type="button"
              disabled={ending || !sttReady}
              onClick={endAndTranscribe}
            >
              {ending ? labels.ending : labels.endAndTranscribe}
            </button>
            <button
              className="btn secondary sm"
              type="button"
              disabled={ending}
              onClick={leaveCall}
            >
              {labels.leaveOnly}
            </button>
          </>
        )}
        {!isPast && livekitReady && userLeftCall && !tokenInfo && (
          <button
            className="btn sm"
            type="button"
            disabled={loading}
            onClick={() => void join()}
          >
            {loading ? labels.connecting : labels.rejoin}
          </button>
        )}
        {lessonRoomHref && (
          <a className="btn ghost sm" href={lessonRoomHref}>
            Room
          </a>
        )}
        <a className="btn ghost sm" href={backHref}>
          ←
        </a>
      </div>
    </header>
  );

  let body: ReactNode;

  if (isPast || !livekitReady) {
    body = (
      <>
        {topBar(false)}
        <div className="classroom-meet-body is-solo">
          <section className="classroom-stage panel">{board}</section>
          {!isPast && !livekitReady && (
            <aside className="classroom-float-dock" role="complementary">
              <p className="muted" style={{ margin: 0 }}>
                {labels.notConfigured}
              </p>
            </aside>
          )}
        </div>
      </>
    );
  } else if (!tokenInfo) {
    body = (
      <>
        {topBar(false)}
        <div className="classroom-meet-body is-solo">
          <section className="classroom-stage panel">{board}</section>
          <aside className="classroom-float-dock" role="complementary">
            <p className="muted" style={{ margin: 0 }}>
              {userLeftCall ? labels.leftCall : labels.connecting}
            </p>
            {error && <p className="chip">{error}</p>}
          </aside>
        </div>
      </>
    );
  } else {
    body = (
      <LiveKitRoom
        token={tokenInfo.token}
        serverUrl={tokenInfo.url}
        connect
        audio
        video
        data-lk-theme="default"
        className="classroom-livekit-root"
        onDisconnected={() => {
          if (!pendingUploadRef.current) {
            setTokenInfo(null);
            setRecordActive(false);
            setVideoExpanded(false);
          }
        }}
      >
        <MixedAudioRecorder active={recordActive} onChunk={onChunk} />
        <RoomAudioRenderer />
        {topBar(true)}
        <CallLayout
          videoExpanded={videoExpanded}
          setVideoExpanded={setVideoExpanded}
          board={board}
          labels={labels}
          error={error}
        />
      </LiveKitRoom>
    );
  }

  return (
    <div className="classroom-meet">
      {error && !tokenInfo && <p className="chip">{error}</p>}
      {body}
    </div>
  );
}
