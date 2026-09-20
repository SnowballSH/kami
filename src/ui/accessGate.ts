import { ApiSession, type SessionStatus } from "../persistence/session";
import "./styles/access.css";

const selectScope = (status: SessionStatus): void => {
  if (status.mode !== "shared") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("board") && status.boards[0] !== undefined) {
    url.searchParams.set("board", status.boards[0]);
  }
  if (!url.searchParams.has("controller")) {
    url.searchParams.set("controller", status.controllers[0] ?? "off");
  }
  window.history.replaceState(null, "", url);
};

export const enterGame = async (
  root: HTMLElement,
  start: (root: HTMLElement) => void,
  session: ApiSession = new ApiSession(),
): Promise<void> => {
  const panel = document.createElement("form");
  panel.className = "access-gate";
  const heading = document.createElement("h1");
  heading.textContent = "Kami";
  const label = document.createElement("label");
  label.textContent = "Access token";
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "off";
  input.required = true;
  input.disabled = true;
  input.maxLength = 256;
  label.append(input);
  label.hidden = true;
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Retry";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const offline = document.createElement("button");
  offline.type = "button";
  offline.textContent = "Play without server";
  offline.hidden = true;
  offline.addEventListener("click", () => {
    panel.remove();
    start(root);
  });
  panel.append(heading, label, message, submit, offline);
  root.append(panel);

  const connect = async (): Promise<void> => {
    submit.disabled = true;
    offline.hidden = true;
    try {
      const status = await session.status();
      if (!status.authenticated) {
        label.hidden = false;
        input.disabled = false;
        submit.textContent = "Open Kami";
        message.textContent = "Ask the host for a token scoped to your board.";
        input.focus();
        return;
      }
      selectScope(status);
      panel.remove();
      start(root);
      if (status.mode === "shared") {
        const signOut = document.createElement("button");
        signOut.type = "button";
        signOut.className = "access-sign-out";
        signOut.textContent = "Sign out";
        signOut.addEventListener("click", () => {
          signOut.disabled = true;
          void session.signOut().then(
            () => window.location.reload(),
            () => {
              signOut.textContent = "Retry sign out";
              signOut.disabled = false;
            },
          );
        });
        root.append(signOut);
      }
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
    submit.disabled = true;
    const token = input.value.trim();
    input.value = "";
    void (label.hidden ? Promise.resolve() : session.signIn(token))
      .then(connect)
      .catch((error: unknown) => {
        message.textContent = error instanceof Error ? error.message : "Sign-in failed.";
        submit.disabled = false;
      });
  });
  await connect();
};
