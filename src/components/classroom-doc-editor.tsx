"use client";

import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { getSchema } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { useRoomContext } from "@livekit/components-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TiptapDoc } from "@/lib/classroom-doc";
import { LiveKitYjsProvider } from "@/lib/livekit-yjs-provider";
import * as Y from "yjs";

type SaveStatus = "idle" | "saving" | "saved" | "error" | "live";

const starter = StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  // History conflicts with Yjs collaboration undo
  undoRedo: false,
});

function buildYDoc(initial: TiptapDoc): Y.Doc {
  const schema = getSchema([starter]);
  return prosemirrorJSONToYDoc(schema, initial, "default");
}

function DocEditorInner({
  lessonId,
  ydoc,
  provider,
  user,
  placeholder,
  onStatus,
  autofocus,
}: {
  lessonId: string;
  ydoc: Y.Doc;
  provider: LiveKitYjsProvider | null;
  user: { name: string; color: string };
  placeholder: string;
  onStatus: (s: SaveStatus) => void;
  autofocus: boolean;
}) {
  const saveTimer = useRef<number | null>(null);
  const persist = useCallback(async () => {
    onStatus("saving");
    try {
      const json = yDocToProsemirrorJSON(ydoc, "default") as TiptapDoc;
      const res = await fetch(`/api/lessons/${lessonId}/board`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: json }),
      });
      if (!res.ok) {
        onStatus("error");
        return;
      }
      onStatus(provider ? "live" : "saved");
    } catch {
      onStatus("error");
    }
  }, [lessonId, onStatus, provider, ydoc]);

  const extensions = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = [
      starter,
      Placeholder.configure({ placeholder }),
      Collaboration.configure({ document: ydoc }),
    ];
    if (provider) {
      list.push(
        CollaborationCaret.configure({
          provider,
          user,
          render: (u) => {
            const cursor = document.createElement("span");
            cursor.classList.add("classroom-caret");
            cursor.style.borderColor = String(u.color ?? "#2563eb");
            const label = document.createElement("span");
            label.classList.add("classroom-caret-label");
            label.style.backgroundColor = String(u.color ?? "#2563eb");
            label.textContent = String(u.name ?? "");
            cursor.appendChild(label);
            return cursor;
          },
        }),
      );
    }
    return list;
  }, [placeholder, provider, user, ydoc]);

  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      autofocus: autofocus ? "end" : false,
      editorProps: {
        attributes: {
          class: "classroom-tiptap",
        },
      },
      onUpdate: () => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void persist();
        }, 1200);
      },
    },
    [extensions],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void persist();
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <EditorContent editor={editor} className="classroom-doc-surface" />;
}

/** Offline / past: Y.Doc local only */
export function ClassroomDocEditor({
  lessonId,
  initialDoc,
  userName,
  userColor,
  placeholder,
  onStatus,
  autofocus = true,
  enableLivekitSync = false,
}: {
  lessonId: string;
  initialDoc: TiptapDoc;
  userName: string;
  userColor: string;
  placeholder: string;
  onStatus: (s: SaveStatus) => void;
  autofocus?: boolean;
  enableLivekitSync?: boolean;
}) {
  const ydoc = useMemo(() => buildYDoc(initialDoc), [initialDoc]);
  const user = useMemo(
    () => ({ name: userName, color: userColor }),
    [userName, userColor],
  );

  if (enableLivekitSync) {
    return (
      <LiveSyncedDoc
        lessonId={lessonId}
        ydoc={ydoc}
        user={user}
        placeholder={placeholder}
        onStatus={onStatus}
        autofocus={autofocus}
      />
    );
  }

  return (
    <DocEditorInner
      lessonId={lessonId}
      ydoc={ydoc}
      provider={null}
      user={user}
      placeholder={placeholder}
      onStatus={onStatus}
      autofocus={autofocus}
    />
  );
}

function LiveSyncedDoc({
  lessonId,
  ydoc,
  user,
  placeholder,
  onStatus,
  autofocus,
}: {
  lessonId: string;
  ydoc: Y.Doc;
  user: { name: string; color: string };
  placeholder: string;
  onStatus: (s: SaveStatus) => void;
  autofocus: boolean;
}) {
  const room = useRoomContext();
  const [provider, setProvider] = useState<LiveKitYjsProvider | null>(null);

  useEffect(() => {
    const p = new LiveKitYjsProvider(ydoc, room, user);
    setProvider(p);
    onStatus("live");
    return () => {
      p.destroy();
      setProvider(null);
    };
  }, [onStatus, room, user, ydoc]);

  if (!provider) {
    return (
      <DocEditorInner
        lessonId={lessonId}
        ydoc={ydoc}
        provider={null}
        user={user}
        placeholder={placeholder}
        onStatus={onStatus}
        autofocus={autofocus}
      />
    );
  }

  return (
    <DocEditorInner
      lessonId={lessonId}
      ydoc={ydoc}
      provider={provider}
      user={user}
      placeholder={placeholder}
      onStatus={onStatus}
      autofocus={autofocus}
    />
  );
}

export type { SaveStatus as ClassroomSaveStatus };
