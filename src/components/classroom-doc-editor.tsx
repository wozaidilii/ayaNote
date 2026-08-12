"use client";

import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { getSchema } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TiptapDoc } from "@/lib/classroom-doc";
import { LiveKitYjsProvider } from "@/lib/livekit-yjs-provider";
import * as Y from "yjs";

type SaveStatus = "idle" | "saving" | "saved" | "error" | "live";

const imageExt = Image.configure({
  inline: false,
  allowBase64: false,
  HTMLAttributes: { class: "classroom-doc-image" },
});

const starter = StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  // History conflicts with Yjs collaboration undo
  undoRedo: false,
});

const schemaExtensions = [starter, imageExt];

/** Build a Y.Doc seeded from TipTap JSON (call once per lesson mount). */
export function buildClassroomYDoc(initial: TiptapDoc): Y.Doc {
  const schema = getSchema(schemaExtensions);
  return prosemirrorJSONToYDoc(schema, initial, "default");
}

/** Drop local fragment so peer state becomes authoritative (avoids duplicate seed). */
function clearYDocFragment(ydoc: Y.Doc) {
  const fragment = ydoc.getXmlFragment("default");
  if (fragment.length > 0) {
    fragment.delete(0, fragment.length);
  }
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      imageExt,
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

  const insertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/lessons/${lessonId}/assets`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        onStatus("error");
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) return;
      editor.chain().focus().setImage({ src: data.url }).run();
      void persist();
    },
    [editor, lessonId, onStatus, persist],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void persist();
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="classroom-doc-editor-wrap">
      <div className="classroom-doc-toolbar">
        <button
          type="button"
          className="btn secondary sm classroom-insert-image"
          onClick={() => fileInputRef.current?.click()}
        >
          Image
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            const root = document.querySelector(".classroom-tiptap");
            const heading = root?.querySelector("h1, h2, h3");
            heading?.scrollIntoView({ behavior: "smooth", block: "start" });
            editor?.commands.focus();
          }}
        >
          Prep
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void insertImage(file);
          }}
        />
      </div>
      <EditorContent editor={editor} className="classroom-doc-surface" />
    </div>
  );
}

/**
 * Shared classroom board. Pass a stable `ydoc` from the parent so remounting
 * into LiveKitRoom does not wipe in-progress edits.
 */
export function ClassroomDocEditor({
  lessonId,
  ydoc,
  userName,
  userColor,
  placeholder,
  onStatus,
  autofocus = true,
  enableLivekitSync = false,
  /** Teacher keeps seeded/local content; others clear and pull from peers. */
  syncAuthority = false,
}: {
  lessonId: string;
  ydoc: Y.Doc;
  userName: string;
  userColor: string;
  placeholder: string;
  onStatus: (s: SaveStatus) => void;
  autofocus?: boolean;
  enableLivekitSync?: boolean;
  syncAuthority?: boolean;
}) {
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
        syncAuthority={syncAuthority}
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
  syncAuthority,
}: {
  lessonId: string;
  ydoc: Y.Doc;
  user: { name: string; color: string };
  placeholder: string;
  onStatus: (s: SaveStatus) => void;
  autofocus: boolean;
  syncAuthority: boolean;
}) {
  const room = useRoomContext();
  const [provider, setProvider] = useState<LiveKitYjsProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    let p: LiveKitYjsProvider | null = null;

    const attach = () => {
      if (cancelled) return;
      // Non-authority clients drop local TipTap seed so Yjs merge won't duplicate.
      if (!syncAuthority) {
        clearYDocFragment(ydoc);
      }
      p = new LiveKitYjsProvider(ydoc, room, user);
      setProvider(p);
      onStatus("live");
    };

    if (room.state === ConnectionState.Connected) {
      const t = window.setTimeout(attach, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
        p?.destroy();
        setProvider(null);
      };
    }

    const onConnected = () => attach();
    room.once(RoomEvent.Connected, onConnected);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, onConnected);
      p?.destroy();
      setProvider(null);
    };
  }, [onStatus, room, syncAuthority, user, ydoc]);

  if (!provider) {
    return (
      <div className="classroom-doc-surface classroom-doc-syncing" aria-busy>
        <p className="muted" style={{ margin: "1rem" }}>
          …
        </p>
      </div>
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
