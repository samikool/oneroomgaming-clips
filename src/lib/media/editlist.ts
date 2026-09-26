import { open, type FileHandle } from "node:fs/promises";

/**
 * MP4/MOV edit lists (`moov/trak/edts/elst`), and the one shape of them we
 * act on: the hidden lead-in OBS writes into replay-buffer clips.
 *
 * A replay clip starts mid-GOP, so OBS keeps the frames back to the previous
 * keyframe (up to a full GOP, ~4s) and adds a single edit whose `media_time`
 * skips them. Players must still decode that lead-in before showing the first
 * frame, and software decoders on 1440p60 AV1 fall behind and visibly freeze
 * a few seconds in. Remuxing with `-ignore_editlist 1` turns the lead-in into
 * ordinary footage instead.
 */

export type EditListEntry = {
  /** In the track's media timescale; -1 marks an empty edit. */
  mediaTime: number;
  /** In the movie (mvhd) timescale, not the track's. */
  segmentDuration: number;
};

export type TrackEditList = {
  kind: "video" | "audio" | "other";
  /** Media timescale from mdhd: units of `mediaTime` per second. */
  timescale: number;
  /** Empty when the track has no edit list. */
  entries: EditListEntry[];
};

/**
 * How far apart the audio and video trims may be. Ignoring the edit list
 * drops both trims, so the tracks shift relative to each other by exactly
 * their difference; OBS's are ~10ms apart, well under what anyone can see.
 */
const SYNC_TOLERANCE_SECONDS = 0.05;

/**
 * Below this, the edit list is not a lead-in worth removing. Plain ffmpeg
 * x264 + AAC output carries single-entry edits for B-frame delay (67ms) and
 * AAC priming (21ms) that agree within the sync tolerance; stripping those
 * would add a gap and shift sync for no playback benefit. A lead-in this
 * short also costs a decoder next to nothing, so there's no freeze to fix.
 */
const MIN_LEAD_IN_SECONDS = 0.25;

function trimSeconds(track: TrackEditList): number | null {
  if (track.entries.length === 0) {
    return 0;
  }

  if (track.entries.length !== 1 || track.timescale <= 0) {
    return null;
  }

  const { mediaTime } = track.entries[0];
  return mediaTime < 0 ? null : mediaTime / track.timescale;
}

/**
 * Whether this is an OBS-style leading trim that's safe to remux away.
 *
 * Phones and editors use edit lists for other things (empty edits for a
 * delayed start, multi-segment cuts), and those files must come out exactly
 * as they went in — so anything but the simple shape answers false.
 *
 * A trimmed video with no audio track answers true: there is no sync to
 * keep, and the lead-in simply becomes visible.
 */
export function shouldStripLeadIn(tracks: TrackEditList[]): boolean {
  const videos = tracks.filter((t) => t.kind === "video");

  if (videos.length !== 1) {
    return false;
  }

  const [video] = videos;

  if (video.entries.length !== 1) {
    return false;
  }

  const videoTrim = trimSeconds(video);

  if (videoTrim === null || videoTrim < MIN_LEAD_IN_SECONDS) {
    return false;
  }

  // An audio track with no edit list starts at media time 0 while the video
  // starts at its trim, so it counts as a trim of 0 and fails the match.
  return tracks
    .filter((t) => t.kind === "audio")
    .every((audio) => {
      const audioTrim = trimSeconds(audio);
      return audioTrim !== null && Math.abs(audioTrim - videoTrim) <= SYNC_TOLERANCE_SECONDS;
    });
}

type Box = {
  type: string;
  /** Offset of the box payload (after the header). */
  start: number;
  /** Offset one past the end of the box. */
  end: number;
};

/** Box types are four printable ASCII bytes; anything else means "not MP4". */
function isBoxType(type: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(type);
}

/** Child boxes of `buf[from, to)`. Stops at the first malformed header. */
function childBoxes(buf: Buffer, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let pos = from;

  while (pos + 8 <= to) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;

    if (size === 1) {
      if (pos + 16 > to) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }

    if (!isBoxType(type) || size < header || pos + size > to) {
      break;
    }

    boxes.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }

  return boxes;
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return childBoxes(buf, parent.start, parent.end).find((b) => b.type === type);
}

function readTimescale(buf: Buffer, mdhd: Box): number {
  // version(1) flags(3), then creation + modification times: 32-bit each in
  // version 0, 64-bit in version 1. The timescale follows.
  if (mdhd.start >= mdhd.end) {
    return 0;
  }

  const version = buf.readUInt8(mdhd.start);
  const offset = mdhd.start + 4 + (version === 1 ? 16 : 8);
  return offset + 4 <= mdhd.end ? buf.readUInt32BE(offset) : 0;
}

function readKind(buf: Buffer, hdlr: Box | undefined): TrackEditList["kind"] {
  // version/flags(4), pre_defined(4), handler_type(4).
  if (!hdlr || hdlr.start + 12 > hdlr.end) {
    return "other";
  }

  const handler = buf.toString("latin1", hdlr.start + 8, hdlr.start + 12);
  return handler === "vide" ? "video" : handler === "soun" ? "audio" : "other";
}

function readEntries(buf: Buffer, elst: Box): EditListEntry[] {
  if (elst.start + 8 > elst.end) {
    return [];
  }

  const version = buf.readUInt8(elst.start);
  const count = buf.readUInt32BE(elst.start + 4);
  // segment_duration + media_time, 32-bit each in version 0 and 64-bit in
  // version 1, then a 4-byte media rate.
  const entrySize = version === 1 ? 20 : 12;
  const entries: EditListEntry[] = [];
  let pos = elst.start + 8;

  for (let i = 0; i < count && pos + entrySize <= elst.end; i++, pos += entrySize) {
    entries.push(
      version === 1
        ? {
          segmentDuration: Number(buf.readBigUInt64BE(pos)),
          mediaTime: Number(buf.readBigInt64BE(pos + 8)),
        }
        : {
          segmentDuration: buf.readUInt32BE(pos),
          mediaTime: buf.readInt32BE(pos + 4),
        },
    );
  }

  return entries;
}

function parseMoov(buf: Buffer): TrackEditList[] {
  const moov: Box = { type: "moov", start: 0, end: buf.length };

  return childBoxes(buf, moov.start, moov.end)
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const mdia = child(buf, trak, "mdia");
      const mdhd = mdia && child(buf, mdia, "mdhd");
      const edts = child(buf, trak, "edts");
      const elst = edts && child(buf, edts, "elst");

      return {
        kind: readKind(buf, mdia && child(buf, mdia, "hdlr")),
        timescale: mdhd ? readTimescale(buf, mdhd) : 0,
        entries: elst ? readEntries(buf, elst) : [],
      };
    });
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await file.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/**
 * Per-track edit lists of an MP4/MOV file; empty for anything else.
 *
 * Uploads can be gigabytes and, without faststart, keep moov at the end — so
 * this hops between top-level box headers with positional reads and loads
 * only moov itself, never the media data.
 */
export async function readEditLists(path: string): Promise<TrackEditList[]> {
  const file = await open(path, "r");

  try {
    const fileSize = (await file.stat()).size;
    let pos = 0;

    while (pos + 8 <= fileSize) {
      const header = await readAt(file, pos, 16);
      if (header.length < 8) break;

      let size = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      let headerSize = 8;

      if (size === 1) {
        if (header.length < 16) break;
        size = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - pos;
      }

      if (!isBoxType(type) || size < headerSize || pos + size > fileSize) {
        break;
      }

      if (type === "moov") {
        return parseMoov(await readAt(file, pos + headerSize, size - headerSize));
      }

      pos += size;
    }

    return [];
  } finally {
    await file.close();
  }
}

export async function hasObsLeadIn(path: string): Promise<boolean> {
  return shouldStripLeadIn(await readEditLists(path));
}
