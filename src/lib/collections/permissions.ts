export type CollectionAction = "view" | "add" | "remove" | "reorder" | "edit" | "delete";

export type CollectionContext = {
  isOwner: boolean;
  open: boolean;
  /** For "remove": whether the actor is the one who added this clip. */
  addedByMe?: boolean;
};

/**
 * Who may do what to a collection. Pure: the server actions call it with the
 * actor from the request identity, and the UI calls it only to hide buttons.
 */
export function canCollection(action: CollectionAction, ctx: CollectionContext): boolean {
  switch (action) {
    case "view":
      return true;
    case "add":
      return ctx.isOwner || ctx.open;
    case "remove":
      return ctx.isOwner || (ctx.open && ctx.addedByMe === true);
    case "reorder":
    case "edit":
    case "delete":
      return ctx.isOwner;
  }
}
