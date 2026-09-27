/**
 * Collection name and description rules, shared by the db module and the
 * server actions. Pure, so the same messages reach the form.
 */

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 280;

// Control characters, except that a description may keep its line breaks.
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

type Field = "name" | "description";

export class CollectionValidationError extends Error {
  constructor(readonly fields: Partial<Record<Field, string>>) {
    super(Object.values(fields).join(" "));
    this.name = "CollectionValidationError";
  }
}

/** Code points, so an emoji counts once rather than as two UTF-16 units. */
function length(text: string): number {
  return [...text].length;
}

/**
 * Validates whichever fields are present. The name is trimmed and must be
 * 1–60 characters; an empty description becomes null.
 */
export function validateCollection(input: { name?: string; description?: string | null }): {
  name?: string;
  description?: string | null;
} {
  const errors: Partial<Record<Field, string>> = {};
  const out: { name?: string; description?: string | null } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();

    if (name.length === 0) {
      errors.name = "Give the collection a name.";
    } else if (CONTROL.test(name)) {
      errors.name = "Names can't contain control characters.";
    } else if (length(name) > NAME_MAX) {
      errors.name = `Names are at most ${NAME_MAX} characters.`;
    } else {
      out.name = name;
    }
  }

  if (input.description !== undefined) {
    const description = (input.description ?? "").trim();

    if (CONTROL_EXCEPT_NEWLINE.test(description)) {
      errors.description = "Descriptions can't contain control characters.";
    } else if (length(description) > DESCRIPTION_MAX) {
      errors.description = `Descriptions are at most ${DESCRIPTION_MAX} characters.`;
    } else {
      out.description = description.length === 0 ? null : description;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new CollectionValidationError(errors);
  }

  return out;
}
