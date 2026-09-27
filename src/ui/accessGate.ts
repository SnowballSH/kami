import {
  ApiSession,
  type Connection,
  OFFLINE,
  type ParsedSessionStatus,
  type SecretKind,
} from "../persistence/session";
import { el } from "./dom";
import "./styles/access.css";

interface SecretWording {
  readonly label: string;
  readonly prompt: string;
  readonly autocomplete: AutoFill;
}

const WORDING: Readonly<Record<SecretKind, SecretWording>> = {
  password: {
    label: "Password",
    prompt: "This Kami is private. Enter the password the host gave you.",
    autocomplete: "current-password",
  },
  token: {
    label: "Access token",
    prompt: "Ask the host for a token scoped to your board.",
    autocomplete: "off",
  },
};

/** Password managers file a saved password under a username, so the gate offers a fixed one. */
const MANAGER_USERNAME = "kami";

const selectScope = (status: ParsedSessionStatus): void => {
  if (status.mode !== "shared" || status.unrestricted) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("board") && status.boards[0] !== undefined) {
    url.searchParams.set("board", status.boards[0]);
  }
  if (!url.searchParams.has("controller")) {
    url.searchParams.set("controller", status.controllers[0] ?? "off");
  }
  window.history.replaceState(null, "", url);
};

const secretInput = (): HTMLInputElement => {
  const input = el("input", {
    attrs: {
      type: "password",
      id: "kami-secret",
      maxlength: "1024",
      spellcheck: "false",
      autocapitalize: "off",
      enterkeyhint: "go",
    },
  });
  input.required = true;
  input.disabled = true;
  return input;
};

const usernameInput = (): HTMLInputElement => {
  const input = el("input", {
    attrs: { type: "text", name: "username", autocomplete: "username", tabindex: "-1" },
  });
  input.value = MANAGER_USERNAME;
  input.readOnly = true;
  input.hidden = true;
  return input;
};

export const enterGame = async (
  root: HTMLElement,
  start: (root: HTMLElement, connection: Connection) => void,
  session: ApiSession = new ApiSession(),
): Promise<void> => {
  let kind: SecretKind = "token";
  const username = usernameInput();
  const caption = el("span");
  const input = secretInput();
  const label = el("label", { attrs: { for: input.id } }, [caption, input]);
  label.hidden = true;
  const submit = el("button", { text: "Retry", attrs: { type: "submit" } });
  const message = el("p", { attrs: { role: "status", "aria-live": "polite" } });
  const offline = el("button", { text: "Play without server", attrs: { type: "button" } });
  offline.hidden = true;
  const panel = el("form", { className: "access-gate", attrs: { novalidate: "" } }, [
    el("h1", { text: "Kami" }),
    label,
    message,
    submit,
    offline,
  ]);
  offline.addEventListener("click", () => {
    panel.remove();
    start(root, OFFLINE);
  });
  root.append(panel);

  const ask = (secret: SecretKind): void => {
    kind = secret;
    const wording = WORDING[secret];
    caption.textContent = wording.label;
    input.name = secret;
    input.autocomplete = wording.autocomplete;
    if (secret === "password" && !username.isConnected) panel.prepend(username);
    label.hidden = false;
    input.disabled = false;
    submit.textContent = "Open Kami";
    message.textContent = wording.prompt;
    input.focus();
  };

  const refuse = (reason: string): void => {
    input.value = "";
    input.setAttribute("aria-invalid", "true");
    message.textContent = reason;
    submit.disabled = false;
    input.focus();
  };

  const connect = async (): Promise<void> => {
    submit.disabled = true;
    offline.hidden = true;
    try {
      const status = await session.status();
      if (!status.authenticated) {
        ask(status.secret ?? "token");
        return;
      }
      selectScope(status);
      panel.remove();
      start(
        root,
        status.mode === "shared"
          ? { online: true, signOut: () => session.signOut() }
          : { online: true },
      );
    } catch {
      message.textContent =
        "Cannot reach the Kami server. Please retry, or play without saved boards.";
      offline.hidden = false;
    } finally {
      submit.disabled = false;
    }
  };

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    if (label.hidden) {
      void connect();
      return;
    }
    const secret = kind === "password" ? input.value : input.value.trim();
    if (secret.trim() === "") {
      refuse(`Enter the ${WORDING[kind].label.toLowerCase()} first.`);
      return;
    }
    submit.disabled = true;
    input.removeAttribute("aria-invalid");
    message.textContent = "Checking…";
    session
      .signIn(secret, kind)
      .then(() => {
        input.value = "";
        return connect();
      })
      .catch((error: unknown) =>
        refuse(error instanceof Error ? error.message : "Sign-in failed."),
      );
  });
  await connect();
};
