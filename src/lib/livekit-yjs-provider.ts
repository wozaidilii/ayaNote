"use client";

import { ConnectionState, Room, RoomEvent } from "livekit-client";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const TOPIC = "ayanote-classroom-yjs";
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/**
 * Yjs provider over LiveKit reliable data messages.
 * Syncs document updates + awareness (remote carets) for everyone in the room.
 */
export class LiveKitYjsProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  room: Room;
  synced = false;

  private readonly handlers = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();
  private destroyed = false;

  constructor(doc: Y.Doc, room: Room, user: { name: string; color: string }) {
    this.doc = doc;
    this.room = room;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.awareness.setLocalStateField("user", user);

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    room.on(RoomEvent.DataReceived, this.onData);
    room.on(RoomEvent.ParticipantConnected, this.onPeerConnected);
    room.on(RoomEvent.ConnectionStateChanged, this.onConnectionStateChanged);

    if (room.state === ConnectionState.Connected) {
      queueMicrotask(() => this.bootstrapSync());
    } else {
      room.once(RoomEvent.Connected, () => this.bootstrapSync());
    }
  }

  on(event: string, cb: (...args: unknown[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }

  off(event: string, cb: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(cb);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room.off(RoomEvent.ParticipantConnected, this.onPeerConnected);
    this.room.off(
      RoomEvent.ConnectionStateChanged,
      this.onConnectionStateChanged,
    );
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "destroy",
    );
    this.handlers.clear();
  }

  private emit(event: string, args: unknown[]) {
    for (const cb of this.handlers.get(event) ?? []) {
      try {
        cb(...args);
      } catch {
        /* ignore */
      }
    }
  }

  private publish(bytes: Uint8Array) {
    if (this.destroyed) return;
    if (this.room.state !== ConnectionState.Connected) return;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    void this.room.localParticipant
      .publishData(copy, {
        reliable: true,
        topic: TOPIC,
      })
      .catch(() => {
        /* room may disconnect mid-publish */
      });
  }

  /** Request peer state + announce ours (safe to call repeatedly). */
  private bootstrapSync() {
    if (this.destroyed) return;
    this.broadcastSyncStep1();
    this.broadcastSyncStep2();
    this.broadcastAwareness();
    this.synced = true;
    this.emit("synced", [true]);
    this.emit("status", [{ status: "connected" }]);
  }

  private onConnectionStateChanged = (state: ConnectionState) => {
    if (state === ConnectionState.Connected) {
      this.bootstrapSync();
    }
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.publish(encoding.toUint8Array(encoder));
  };

  private onAwarenessUpdate = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
    );
    this.publish(encoding.toUint8Array(encoder));
  };

  private broadcastSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.publish(encoding.toUint8Array(encoder));
  }

  private broadcastSyncStep2() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder, this.doc);
    this.publish(encoding.toUint8Array(encoder));
  }

  private broadcastAwareness() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID,
      ]),
    );
    this.publish(encoding.toUint8Array(encoder));
  }

  private onPeerConnected = () => {
    this.broadcastSyncStep1();
    this.broadcastSyncStep2();
    this.broadcastAwareness();
  };

  private onData = (
    payload: Uint8Array,
    _participant?: unknown,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (topic && topic !== TOPIC) return;
    try {
      const decoder = decoding.createDecoder(payload);
      const msgType = decoding.readVarUint(decoder);
      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          this.doc,
          this,
        );
        if (encoding.length(encoder) > 1) {
          this.publish(encoding.toUint8Array(encoder));
        }
        if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
          this.synced = true;
          this.emit("synced", [true]);
        }
      } else if (msgType === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        );
      }
    } catch {
      /* ignore malformed */
    }
  };
}
