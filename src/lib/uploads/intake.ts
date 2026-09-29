/**
 * Files from a drop or a picker, with each one's path relative to what was
 * chosen — the folder names are what the review list groups and guesses by.
 * Non-video files are kept here; the batch rules count and skip them.
 */
export type Picked = { file: File; path: string };

export type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (ok: (file: File) => void, fail?: (err: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: EntryLike[]) => void, fail?: (err: unknown) => void) => void };
};

const relative = (fullPath: string) => fullPath.replace(/^\/+/, "");

async function readAll(entry: EntryLike): Promise<EntryLike[]> {
  const reader = entry.createReader!();
  const all: EntryLike[] = [];
  // readEntries hands back at most ~100 at a time; an empty batch is the end.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

export async function walkEntries(entries: EntryLike[]): Promise<Picked[]> {
  const out: Picked[] = [];
  for (const entry of entries) {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
      out.push({ file, path: relative(entry.fullPath) });
    } else if (entry.isDirectory && entry.createReader) {
      out.push(...(await walkEntries(await readAll(entry))));
    }
  }
  return out;
}

export async function fromDataTransfer(items: DataTransferItemList): Promise<Picked[]> {
  const entries: EntryLike[] = [];
  const loose: Picked[] = [];
  // Entries must be taken synchronously, before any await: the list is
  // emptied once the drop handler yields.
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() as unknown as EntryLike | null;
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push({ file, path: file.name });
    }
  }
  return [...(await walkEntries(entries)), ...loose];
}

export function fromInput(files: FileList | File[]): Picked[] {
  return Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}
