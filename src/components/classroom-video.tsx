"use client";

import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Labels = {
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

type TokenPayload = {
  token: string;
  url: string;
  roomName: string;
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

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return null;
}

function Conference() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <GridLayout tracks={tracks} style={{ minHeight: 320 }}>
      <ParticipantTile />
    </GridLayout>
  );
}

export function ClassroomVideo({
  lessonId,
  livekitReady,
  sttReady,
  labels,
}: {
  lessonId: string;
  livekitReady: boolean;
  sttReady: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenPayload | null>(null);
  const [recordActive, setRecordActive] = useState(false);
  const pendingUploadRef = useRef(false);

  const join = async () => {
    if (!livekitReady) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }),
      });
      const data = (await res.json()) as TokenPayload & { error?: string };
      if (!res.ok) {
        setError(labels.errorToken + (data.error ? `: ${data.error}` : ""));
        return;
      }
      setTokenInfo({
        token: data.token,
        url: data.url,
        roomName: data.roomName,
      });
      setJoined(true);
      setRecordActive(true);
    } catch {
      setError(labels.errorToken);
    } finally {
      setLoading(false);
    }
  };

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
      router.push(`/lessons/${lessonId}?ok=livekit`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- upload closes over lessonId/labels via state
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

  const leaveOnly = () => {
    pendingUploadRef.current = false;
    setRecordActive(false);
    setJoined(false);
    setTokenInfo(null);
  };

  // After recording stops (active→false), leave the room once upload is kicked off.
  useEffect(() => {
    if (joined && !recordActive && pendingUploadRef.current && ending) {
      // Room stays up briefly so MixedAudioRecorder cleanup can flush the blob.
      const t = window.setTimeout(() => {
        setJoined(false);
        setTokenInfo(null);
      }, 400);
      return () => window.clearTimeout(t);
    }
  }, [joined, recordActive, ending]);

  return (
    <div className="panel classroom-panel">
      <h2 style={{ marginTop: 0 }}>{labels.title}</h2>
      <p className="muted">{labels.hint}</p>

      {!livekitReady && <p className="chip">{labels.notConfigured}</p>}
      {livekitReady && !sttReady && <p className="chip">{labels.sttMissing}</p>}
      {error && <p className="chip">{error}</p>}
      {ending && <p className="chip sky">{labels.ending}</p>}

      {!joined || !tokenInfo ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            className="btn"
            type="button"
            disabled={!livekitReady || loading || ending}
            onClick={() => void join()}
          >
            {loading ? labels.connecting : labels.join}
          </button>
        </div>
      ) : (
        <div className="classroom-video">
          {recordActive && <p className="chip sky">{labels.recording}</p>}
          <LiveKitRoom
            token={tokenInfo.token}
            serverUrl={tokenInfo.url}
            connect
            audio
            video
            data-lk-theme="default"
            style={{ width: "100%" }}
            onDisconnected={() => {
              if (!pendingUploadRef.current) {
                setJoined(false);
                setTokenInfo(null);
                setRecordActive(false);
              }
            }}
          >
            <MixedAudioRecorder active={recordActive} onChunk={onChunk} />
            <Conference />
            <RoomAudioRenderer />
            <ControlBar variation="minimal" controls={{ chat: false }} />
          </LiveKitRoom>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginTop: "0.75rem",
            }}
          >
            <button
              className="btn"
              type="button"
              disabled={ending || !sttReady}
              onClick={endAndTranscribe}
            >
              {ending ? labels.ending : labels.endAndTranscribe}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={ending}
              onClick={leaveOnly}
            >
              {labels.leaveOnly}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
