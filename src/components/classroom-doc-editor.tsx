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
import {
  collectImagesFromDataTransfer,
  dataTransferLooksLikeImage,
  type ClipboardImage,
} from "@/lib/clipboard-images";
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
  const insertImageRef = useRef<
    (image: ClipboardImage, pos?: number) => Promise<void>
  >(async () => {});
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
        handleDOMEvents: {
          dragenter: (_view, event) => {
            if (!dataTransferLooksLikeImage(event.dataTransfer)) return false;
            event.preventDefault();
            return true;
          },
          dragover: (_view, event) => {
            if (!dataTransferLooksLikeImage(event.dataTransfer)) return false;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            return true;
          },
        },
        handlePaste: (_view, event) => {
          if (!dataTransferLooksLikeImage(event.clipboardData)) return false;
          event.preventDefault();
          void collectImagesFromDataTransfer(event.clipboardData).then(
            async (images) => {
              for (const image of images) {
                await insertImageRef.current(image);
              }
            },
          );
          return true;
        },
        handleDrop: (view, event) => {
          if (!dataTransferLooksLikeImage(event.dataTransfer)) return false;
          event.preventDefault();
          const coords = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          let pos = coords?.pos;
          void collectImagesFromDataTransfer(event.dataTransfer).then(
            async (images) => {
              for (const image of images) {
                await insertImageRef.current(image, pos);
                pos = undefined;
              }
            },
          );
          return true;
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
    async (image: ClipboardImage, pos?: number) => {
      if (!editor) return;
      const mark = `⏳ Uploading image…`;
      const chain = editor.chain().focus();
      if (typeof pos === "number") chain.setTextSelection(pos);
      chain.insertContent(mark).run();

      const removeMark = () => {
        editor.commands.command(({ tr, dispatch }) => {
          let found = false;
          tr.doc.descendants((node, nodePos) => {
            if (found || !node.isText || !node.text) return;
            const idx = node.text.indexOf(mark);
            if (idx < 0) return;
            tr.delete(nodePos + idx, nodePos + idx + mark.length);
            found = true;
          });
          if (found && dispatch) dispatch(tr);
          return found;
        });
      };

      const form = new FormData();
      if (image.kind === "file") {
        form.append("file", image.file);
      } else {
        form.append("sourceUrl", image.url);
      }
      const res = await fetch(`/api/lessons/${lessonId}/assets`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        removeMark();
        onStatus("error");
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        removeMark();
        onStatus("error");
        return;
      }
      const surface = document.querySelector(".classroom-doc-surface");
      const scrollTop =
        surface instanceof HTMLElement ? surface.scrollTop : null;
      removeMark();
      editor.chain().focus().setImage({ src: data.url }).run();
      if (surface instanceof HTMLElement && scrollTop !== null) {
        const restore = () => {
          surface.scrollTop = scrollTop;
        };
        restore();
        surface.addEventListener("load", restore, true);
        window.setTimeout(() => {
          surface.removeEventListener("load", restore, true);
          restore();
        }, 800);
      }
      void persist();
    },
    [editor, lessonId, onStatus, persist],
  );

  useEffect(() => {
    insertImageRef.current = insertImage;
  }, [insertImage]);

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
  // Students/guests must not seed-then-delete the shared Y.Doc: that CRDT
  // delete wipes the teacher's board (and then persists over this lesson's prep).
  const syncDoc = useMemo(
    () => (syncAuthority ? ydoc : new Y.Doc()),
    [syncAuthority, ydoc],
  );

  useEffect(() => {
    let cancelled = false;
    let p: LiveKitYjsProvider | null = null;

    const attach = () => {
      if (cancelled) return;
      p = new LiveKitYjsProvider(syncDoc, room, user);
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
  }, [onStatus, room, syncDoc, user]);

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
      ydoc={syncDoc}
      provider={provider}
      user={user}
      placeholder={placeholder}
      onStatus={onStatus}
      autofocus={autofocus}
    />
  );
}

export type { SaveStatus as ClassroomSaveStatus };
