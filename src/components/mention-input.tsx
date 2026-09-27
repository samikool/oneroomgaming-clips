"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { useDirectory } from "./profiles-provider";
import { matchMentionCandidates } from "@/lib/social/mentions";

const MAX_ROWS = 6;
/** An @ at the start or after a non-word character, then the name typed so far, up to the caret. */
const TYPING = /(^|[^\w@])@([\w.-]*)$/;

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange(value: string): void;
};

/**
 * A text input that offers people after an `@`. Arrow keys move, Enter or
 * Tab picks, Escape closes; picking writes `@username ` into the text.
 */
export function MentionInput({ value, onChange, onKeyDown, className, ...rest }: Props) {
  const directory = useDirectory();
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState<{ start: number; prefix: string } | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo(
    () => (query ? matchMentionCandidates(query.prefix, directory).slice(0, MAX_ROWS) : []),
    [query, directory],
  );
  const open = options.length > 0;

  function track(text: string, caret: number | null): void {
    const match = TYPING.exec(text.slice(0, caret ?? text.length));
    if (!match) {
      setQuery(null);
      return;
    }
    setQuery({ start: match.index + match[1].length, prefix: match[2] });
    setActive(0);
  }

  function pick(username: string): void {
    if (!query) return;
    const el = input.current;
    const caret = el?.selectionStart ?? value.length;
    const insert = `@${username} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onChange(next);
    setQuery(null);
    const at = query.start + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at, at);
    });
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[active].username);
        return;
      }
      if (event.key === "Escape") {
        // Closes the picker only; a second Escape does whatever the input's owner wants.
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <span className="mention-input">
      <input
        {...rest}
        ref={input}
        className={className}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onSelect={(event) => track(event.currentTarget.value, event.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)}
        onKeyDown={keyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="mention-list">
          {options.map((person, i) => (
            <li
              key={person.username}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`mention-option${i === active ? " mention-option-active" : ""}`}
              // mousedown, not click: a click would blur the input and close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person.username);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Avatar username={person.username} size={20} />
              <span className="truncate">{person.name}</span>
              <span className="user-name-handle">@{person.username}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
