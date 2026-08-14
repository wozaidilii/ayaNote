"use client";

import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useRoomContext,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { DisconnectReason, RoomEvent, Track } from "livekit-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  buildClassroomYDoc,
  ClassroomDocEditor,
  type ClassroomSaveStatus,
} from "@/components/classroom-doc-editor";
import type { TiptapDoc } from "@/lib/classroom-doc";
import type { VocabRecallItem } from "@/lib/prep-refs";

const CLASS_CONTROL_TOPIC = "ayanote-classroom-control";

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
  errorDuplicate: string;
  sttMissing: string;
  pastBanner: string;
  docPlaceholder: string;
  statusSaving: string;
  statusSaved: string;
  statusLive: string;
  statusError: string;
  screenShare: string;
  restoreBoard: string;
  focusHint: string;
  classEnded: string;
  copyLink: string;
  linkCopied: string;
  teacherPrepTitle: string;
  teacherPrepOnly: string;
  sectionWarmup: string;
  sectionReview: string;
  sectionNewFocus: string;
  sectionPractice: string;
  sectionHomework: string;
  teacherCloze: string;
  teacherClozeHint: string;
  teacherClozeNext: string;
  tabPlan: string;
  tabCloze: string;
  tabMaterials: string;
  materialsCourse: string;
  materialsGoals: string;
  materialsLastSummary: string;
  materialsLastFocus: string;
  materialsMistakes: string;
  materialsVocab: string;
  materialsEmpty: string;
  teacherPrepEmpty: string;
};

export type TeacherPrepPayload = {
  warmup: string;
  review: string;
  newFocus: string;
  practice: string;
  homeworkSeed: string;
  vocabRecall: VocabRecallItem[];
  nextVocabRecall: VocabRecallItem[];
  course: string;
  level: string;
  goals: string;
  lastTodaySummary: string;
  lastNextFocus: string;
  lastMistakes: string[];
  vocab: string[];
};

/** Rotate MediaRecorder every N ms so each WebM segment is independently STT-able. */
const AUDIO_SEGMENT_MS = 4 * 60 * 1000;
const AUDIO_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;

function MixedAudioRecorder({
  active,
  finalizeOnStopRef,
  onSegment,
  onFinal,
}: {
  active: boolean;
  /** When true, stopping recorder (incl. unmount) delivers onFinal instead of discard. */
  finalizeOnStopRef: MutableRefObject<boolean>;
  /** Mid-class segment (keep recording). */
  onSegment: (blob: Blob) => void;
  /** Last segment when End & Transcribe stops recording. */
  onFinal: (blob: Blob) => void;
}) {
  const room = useRoomContext();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkBytesRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const rotatingRef = useRef(false);
  const mimeTypeRef = useRef("");
  const onSegmentRef = useRef(onSegment);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onSegmentRef.current = onSegment;
    onFinalRef.current = onFinal;
  }, [onFinal, onSegment]);

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

  const startRecorderRef = useRef<() => void>(() => {});

  const startRecorder = useCallback(() => {
    const dest = destRef.current;
    if (!dest) return;
    const mimeType = mimeTypeRef.current;
    const recorder = mimeType
      ? new MediaRecorder(dest.stream, { mimeType })
      : new MediaRecorder(dest.stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        chunksRef.current.push(ev.data);
        chunkBytesRef.current += ev.data.size;
        if (
          chunkBytesRef.current >= AUDIO_SEGMENT_MAX_BYTES &&
          recorder.state === "recording" &&
          !rotatingRef.current &&
          !finalizeOnStopRef.current
        ) {
          rotatingRef.current = true;
          try {
            recorder.stop();
          } catch {
            rotatingRef.current = false;
          }
        }
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      chunkBytesRef.current = 0;
      const wantFinal = finalizeOnStopRef.current;
      const wasRotate = rotatingRef.current;
      rotatingRef.current = false;
      if (wantFinal) {
        onFinalRef.current(
          blob.size > 0 ? blob : new Blob([], { type: "audio/webm" }),
        );
        return;
      }
      if (blob.size > 0) onSegmentRef.current(blob);
      if (wasRotate && ctxRef.current && !finalizeOnStopRef.current) {
        startRecorderRef.current();
      }
    };
    recorder.start(2000);
  }, [finalizeOnStopRef]);

  useEffect(() => {
    startRecorderRef.current = startRecorder;
  }, [startRecorder]);

  useEffect(() => {
    if (!active) return;

    rotatingRef.current = false;
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctxRef.current = ctx;
    destRef.current = dest;
    mimeTypeRef.current = MediaRecorder.isTypeSupported(
      "audio/webm;codecs=opus",
    )
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    startRecorder();

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

    const rotateTimer = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (
        !recorder ||
        recorder.state !== "recording" ||
        rotatingRef.current ||
        finalizeOnStopRef.current
      ) {
        return;
      }
      rotatingRef.current = true;
      try {
        recorder.stop();
      } catch {
        rotatingRef.current = false;
      }
    }, AUDIO_SEGMENT_MS);

    const sources = sourcesRef.current;

    return () => {
      window.clearInterval(rotateTimer);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      // Intentionally read latest finalize flag at teardown (End & Transcribe).
      // eslint-disable-next-line react-hooks/exhaustive-deps -- latest ref at cleanup
      const shouldFinal = finalizeOnStopRef.current;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      } else if (shouldFinal) {
        onFinalRef.current(new Blob([], { type: "audio/webm" }));
      }
      for (const id of [...sources.keys()]) detachTrack(id);
      void ctx.close();
      ctxRef.current = null;
      destRef.current = null;
      recorderRef.current = null;
    };
  }, [
    active,
    attachTrack,
    detachTrack,
    finalizeOnStopRef,
    room,
    startRecorder,
  ]);

  return null;
}

function trackKey(trackRef: TrackReferenceOrPlaceholder) {
  return `${trackRef.participant.identity}-${trackRef.source}`;
}

function VideoTiles({
  focusedKey,
  onSelect,
}: {
  focusedKey: string | null;
  onSelect: (trackRef: TrackReferenceOrPlaceholder) => void;
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="classroom-filmstrip-tiles">
      {tracks.map((trackRef) => {
        const key = trackKey(trackRef);
        return (
          <button
            key={key}
            type="button"
            className={`classroom-filmstrip-pick${focusedKey === key ? " is-focused" : ""}`}
            onClick={() => onSelect(trackRef)}
            aria-pressed={focusedKey === key}
            title={trackRef.participant.name || trackRef.participant.identity}
          >
            <ParticipantTile
              trackRef={trackRef}
              className="classroom-filmstrip-tile"
            />
          </button>
        );
      })}
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

function AutoPromoteScreenShare({
  onSelect,
  onClearIfGone,
  focusedKey,
}: {
  onSelect: (trackRef: TrackReferenceOrPlaceholder) => void;
  onClearIfGone: () => void;
  focusedKey: string | null;
}) {
  const shares = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const liveKeys = new Set(shares.map(trackKey));
    for (const trackRef of shares) {
      const key = trackKey(trackRef);
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        onSelect(trackRef);
      }
    }
    for (const key of [...seenRef.current]) {
      if (!liveKeys.has(key)) seenRef.current.delete(key);
    }
    if (focusedKey && !liveKeys.has(focusedKey)) {
      onClearIfGone();
    }
  }, [focusedKey, onClearIfGone, onSelect, shares]);

  return null;
}

/** Broadcast class end + kick room; listeners leave to summary. */
function ClassEndController({
  lessonId,
  role,
  ending,
  onRemoteClassEnded,
}: {
  lessonId: string;
  role: "teacher" | "student" | "guest";
  ending: boolean;
  onRemoteClassEnded: () => void;
}) {
  const room = useRoomContext();
  const publishedRef = useRef(false);

  useEffect(() => {
    if (!ending || role !== "teacher" || publishedRef.current) return;
    publishedRef.current = true;
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "class_ended", lessonId }),
    );
    void room.localParticipant
      .publishData(payload, {
        reliable: true,
        topic: CLASS_CONTROL_TOPIC,
      })
      .catch(() => {
        /* ignore */
      });
    window.setTimeout(() => {
      void fetch(`/api/lessons/${lessonId}/end-call`, { method: "POST" });
    }, 250);
  }, [ending, lessonId, role, room]);

  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic !== CLASS_CONTROL_TOPIC) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
          lessonId?: string;
        };
        if (msg.type === "class_ended" && msg.lessonId === lessonId) {
          onRemoteClassEnded();
        }
      } catch {
        /* ignore */
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [lessonId, onRemoteClassEnded, room]);

  return null;
}

type TeacherPrepTab = "plan" | "cloze" | "materials";

function ClozeList({ items }: { items: VocabRecallItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="classroom-teacher-cloze">
      {items.map((item, i) => (
        <li key={`${item.answer}-${i}`}>
          <span>
            {item.blanked}（{item.hint}）
          </span>
          <span className="classroom-teacher-cloze-answer">{item.answer}</span>
        </li>
      ))}
    </ol>
  );
}

function TeacherPrepPanel({
  prep,
  labels,
}: {
  prep: TeacherPrepPayload;
  labels: Labels;
}) {
  const [tab, setTab] = useState<TeacherPrepTab>("plan");
  const blocks: Array<{ title: string; body: string }> = [
    { title: labels.sectionWarmup, body: prep.warmup },
    { title: labels.sectionReview, body: prep.review },
    { title: labels.sectionNewFocus, body: prep.newFocus },
    { title: labels.sectionPractice, body: prep.practice },
    { title: labels.sectionHomework, body: prep.homeworkSeed },
  ];
  const planBlocks = blocks.filter((block) => block.body.trim());
  const tabs: Array<{ id: TeacherPrepTab; label: string }> = [
    { id: "plan", label: labels.tabPlan },
    { id: "cloze", label: labels.tabCloze },
    { id: "materials", label: labels.tabMaterials },
  ];

  return (
    <aside
      className="classroom-teacher-prep"
      aria-label={labels.teacherPrepTitle}
    >
      <div className="classroom-teacher-prep-title">
        {labels.teacherPrepTitle}
      </div>
      <p className="muted classroom-teacher-prep-hint">
        {labels.teacherPrepOnly}
      </p>
      <div className="classroom-teacher-prep-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`classroom-teacher-prep-tab${tab === item.id ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "plan" ? (
        planBlocks.length === 0 ? (
          <p className="muted classroom-teacher-prep-hint">
            {labels.teacherPrepEmpty}
          </p>
        ) : (
          planBlocks.map((block) => (
            <section key={block.title} className="classroom-teacher-prep-block">
              <h3>{block.title}</h3>
              <p>{block.body}</p>
            </section>
          ))
        )
      ) : null}

      {tab === "cloze" ? (
        <>
          <section className="classroom-teacher-prep-block">
            <h3>{labels.teacherCloze}</h3>
            <p className="muted classroom-teacher-prep-hint">
              {labels.teacherClozeHint}
            </p>
            {prep.vocabRecall.length > 0 ? (
              <ClozeList items={prep.vocabRecall} />
            ) : (
              <p className="muted">{labels.teacherPrepEmpty}</p>
            )}
          </section>
          {prep.nextVocabRecall.length > 0 ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.teacherClozeNext}</h3>
              <ClozeList items={prep.nextVocabRecall} />
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "materials" ? (
        <>
          <section className="classroom-teacher-prep-block">
            <h3>{labels.materialsCourse}</h3>
            <p>
              {prep.course}
              {prep.level ? ` · ${prep.level}` : ""}
            </p>
          </section>
          {prep.goals.trim() ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.materialsGoals}</h3>
              <p>{prep.goals}</p>
            </section>
          ) : null}
          {prep.lastTodaySummary.trim() ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.materialsLastSummary}</h3>
              <p>{prep.lastTodaySummary}</p>
            </section>
          ) : null}
          {prep.lastNextFocus.trim() ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.materialsLastFocus}</h3>
              <p>{prep.lastNextFocus}</p>
            </section>
          ) : null}
          {prep.lastMistakes.length > 0 ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.materialsMistakes}</h3>
              <ul className="classroom-teacher-prep-list">
                {prep.lastMistakes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {prep.vocab.length > 0 ? (
            <section className="classroom-teacher-prep-block">
              <h3>{labels.materialsVocab}</h3>
              <p>{prep.vocab.join(" · ")}</p>
            </section>
          ) : null}
          {!prep.goals.trim() &&
          !prep.lastTodaySummary.trim() &&
          !prep.lastNextFocus.trim() &&
          prep.lastMistakes.length === 0 &&
          prep.vocab.length === 0 ? (
            <p className="muted classroom-teacher-prep-hint">
              {labels.materialsEmpty}
            </p>
          ) : null}
        </>
      ) : null}
    </aside>
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
  board,
  error,
  recording,
  focusedTrack,
  onSelectTrack,
  onClearFocus,
  restoreBoardLabel,
  focusHint,
}: {
  board: ReactNode;
  error: string | null;
  recording: boolean;
  focusedTrack: TrackReferenceOrPlaceholder | null;
  onSelectTrack: (trackRef: TrackReferenceOrPlaceholder) => void;
  onClearFocus: () => void;
  restoreBoardLabel: string;
  focusHint: string;
}) {
  const focusedKey = focusedTrack ? trackKey(focusedTrack) : null;
  const hasFocus = Boolean(focusedTrack);

  return (
    <div
      className={`classroom-meet-body is-call${hasFocus ? " is-focus-stage" : ""}`}
    >
      <aside
        className="classroom-float-dock"
        role="complementary"
        data-recording={recording ? "true" : undefined}
      >
        <VideoTiles focusedKey={focusedKey} onSelect={onSelectTrack} />
        <p className="classroom-dock-hint muted">{focusHint}</p>
        <HoverAvControls />
        {error && <p className="chip">{error}</p>}
      </aside>

      <section className="classroom-stage panel">
        <div className={`classroom-stage-board${hasFocus ? " is-parked" : ""}`}>
          {board}
        </div>
        {hasFocus && focusedTrack ? (
          <div className="classroom-focus-stage">
            <ParticipantTile
              trackRef={focusedTrack}
              className="classroom-focus-tile"
            />
            <button
              className="btn secondary sm classroom-restore-board"
              type="button"
              onClick={onClearFocus}
            >
              {restoreBoardLabel}
            </button>
          </div>
        ) : null}
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
  teacherPrep = null,
}: {
  lessonId: string;
  isPast: boolean;
  livekitReady: boolean;
  sttReady: boolean;
  initialDoc: TiptapDoc;
  userName: string;
  role: "teacher" | "student" | "guest";
  titleLine: string;
  metaLine: string;
  backHref: string;
  lessonRoomHref: string | null;
  labels: Labels;
  teacherPrep?: TeacherPrepPayload | null;
}) {
  const router = useRouter();
  const userColor =
    role === "teacher" ? "#5b6cff" : role === "guest" ? "#23a559" : "#059669";
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
  const [linkCopied, setLinkCopied] = useState(false);
  const [focusedTrack, setFocusedTrack] =
    useState<TrackReferenceOrPlaceholder | null>(null);
  const [classEndedRemote, setClassEndedRemote] = useState(false);
  const pendingUploadRef = useRef(false);
  const finalizeOnStopRef = useRef(false);
  const canEndAndTranscribe = role === "teacher";

  const leaveToSummary = useCallback(() => {
    setUserLeftCall(true);
    setRecordActive(false);
    setTokenInfo(null);
    setFocusedTrack(null);
    if (role === "teacher") {
      router.replace(`/lessons/${lessonId}?ok=summarizing`);
      return;
    }
    if (role === "student") {
      router.replace(`/student/lessons/${lessonId}?ok=summarizing`);
      return;
    }
    router.replace("/?ended=1");
  }, [lessonId, role, router]);

  const onRemoteClassEnded = useCallback(() => {
    if (role === "teacher") return;
    setClassEndedRemote(true);
    leaveToSummary();
  }, [leaveToSummary, role]);

  // Stable Y.Doc for this page mount — survives solo ↔ LiveKitRoom remounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from first SSR doc only
  const ydoc = useMemo(() => buildClassroomYDoc(initialDoc), [lessonId]);

  const join = useCallback(async () => {
    if (!livekitReady || isPast || ending) return;
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
      // Only the teacher records for End & transcribe.
      setRecordActive(role === "teacher");
    } catch {
      setError(labels.errorToken);
    } finally {
      setLoading(false);
    }
  }, [ending, isPast, labels.errorToken, lessonId, livekitReady, role]);

  useEffect(() => {
    if (!isPast && livekitReady && !tokenInfo && !userLeftCall && !ending) {
      // Auto-join when classroom mounts; join() owns loading/error state.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional mount join
      void join();
    }
  }, [ending, isPast, join, livekitReady, tokenInfo, userLeftCall]);

  const uploadAndSummarize = (blob: Blob) => {
    if (role !== "teacher") return;
    const form = new FormData();
    if (blob.size >= 256) {
      form.append("audio", blob, "classroom-final.webm");
    }
    form.append("finalize", "1");
    void fetch(`/api/lessons/${lessonId}/transcribe`, {
      method: "POST",
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        console.error("transcribe failed", data);
      }
    });
    pendingUploadRef.current = false;
    finalizeOnStopRef.current = false;
    setTokenInfo(null);
    setRecordActive(false);
    router.replace(`/lessons/${lessonId}?ok=summarizing`);
  };

  const uploadSegment = useCallback(
    (blob: Blob) => {
      if (role !== "teacher" || blob.size < 256) return;
      const form = new FormData();
      form.append("audio", blob, `classroom-part-${Date.now()}.webm`);
      void fetch(`/api/lessons/${lessonId}/audio-parts`, {
        method: "POST",
        body: form,
      }).then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          console.error("audio-part failed", data);
        }
      });
    },
    [lessonId, role],
  );

  const onSegment = useCallback(
    (blob: Blob) => {
      uploadSegment(blob);
    },
    [uploadSegment],
  );

  const onFinal = useCallback(
    (blob: Blob) => {
      if (!pendingUploadRef.current) return;
      uploadAndSummarize(blob);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessonId, role],
  );

  const endAndTranscribe = () => {
    if (!canEndAndTranscribe) return;
    if (!sttReady) {
      setError(labels.sttMissing);
      return;
    }
    pendingUploadRef.current = true;
    finalizeOnStopRef.current = true;
    setUserLeftCall(true);
    setEnding(true);
    setRecordActive(false);
  };

  useEffect(() => {
    if (!ending) return;
    const timer = window.setTimeout(() => {
      if (!pendingUploadRef.current) return;
      pendingUploadRef.current = false;
      finalizeOnStopRef.current = false;
      setEnding(false);
      setTokenInfo(null);
      setRecordActive(false);
      setError(labels.errorTranscribe);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [ending, labels.errorTranscribe]);

  const leaveCall = () => {
    pendingUploadRef.current = false;
    finalizeOnStopRef.current = false;
    setUserLeftCall(true);
    setRecordActive(false);
    setTokenInfo(null);
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/classroom/${lessonId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const board = (
    <div
      className={
        teacherPrep ? "classroom-stage-split" : "classroom-board-stack"
      }
    >
      <div className="classroom-board-wrap">
        {isPast && (
          <p className="classroom-past-banner muted">{labels.pastBanner}</p>
        )}
        <ClassroomDocEditor
          lessonId={lessonId}
          ydoc={ydoc}
          userName={userName}
          userColor={userColor}
          placeholder={labels.docPlaceholder}
          onStatus={setSaveStatus}
          autofocus
          enableLivekitSync={Boolean(tokenInfo)}
          syncAuthority={role === "teacher"}
        />
      </div>
      {teacherPrep ? (
        <TeacherPrepPanel prep={teacherPrep} labels={labels} />
      ) : null}
    </div>
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
            {canEndAndTranscribe && (
              <button
                className="btn sm"
                type="button"
                disabled={ending || !sttReady}
                onClick={endAndTranscribe}
              >
                {ending ? labels.ending : labels.endAndTranscribe}
              </button>
            )}
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
        <button
          className="btn secondary sm"
          type="button"
          onClick={() => void copyShareLink()}
        >
          {linkCopied ? labels.linkCopied : labels.copyLink}
        </button>
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
        {role !== "guest" && (
          <a className="btn ghost sm" href={backHref}>
            ←
          </a>
        )}
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
        onDisconnected={(reason) => {
          if (pendingUploadRef.current || ending) return;
          setTokenInfo(null);
          setRecordActive(false);
          setFocusedTrack(null);
          // Same teacher/student identity on another device kicks this one.
          // Stop auto-rejoin or both sides fight forever.
          if (
            reason === DisconnectReason.DUPLICATE_IDENTITY ||
            reason === DisconnectReason.PARTICIPANT_REMOVED ||
            reason === DisconnectReason.ROOM_DELETED ||
            reason === DisconnectReason.ROOM_CLOSED
          ) {
            setUserLeftCall(true);
            if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
              setError(labels.errorDuplicate);
              return;
            }
            if (
              role !== "teacher" &&
              (reason === DisconnectReason.ROOM_DELETED ||
                reason === DisconnectReason.ROOM_CLOSED ||
                reason === DisconnectReason.PARTICIPANT_REMOVED)
            ) {
              leaveToSummary();
            }
          }
        }}
      >
        <ClassEndController
          lessonId={lessonId}
          role={role}
          ending={ending}
          onRemoteClassEnded={onRemoteClassEnded}
        />
        <AutoPromoteScreenShare
          focusedKey={focusedTrack ? trackKey(focusedTrack) : null}
          onSelect={setFocusedTrack}
          onClearIfGone={() => setFocusedTrack(null)}
        />
        <MixedAudioRecorder
          active={recordActive}
          finalizeOnStopRef={finalizeOnStopRef}
          onSegment={onSegment}
          onFinal={onFinal}
        />
        <RoomAudioRenderer />
        {topBar(true)}
        {classEndedRemote && (
          <p className="chip soon" style={{ margin: 0 }}>
            {labels.classEnded}
          </p>
        )}
        <CallLayout
          board={board}
          error={error}
          recording={recordActive}
          focusedTrack={focusedTrack}
          onSelectTrack={setFocusedTrack}
          onClearFocus={() => setFocusedTrack(null)}
          restoreBoardLabel={labels.restoreBoard}
          focusHint={labels.focusHint}
        />
      </LiveKitRoom>
    );
  }

  return (
    <div className="classroom-meet">
      {error && !tokenInfo && !ending && <p className="chip">{error}</p>}
      {body}
      {ending && (
        <div
          className="classroom-ending-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="classroom-ending-card panel">
            <p className="classroom-ending-title">{labels.ending}</p>
            {error && <p className="chip">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
