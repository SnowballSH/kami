import { startGame } from "./game";
import { isScreen, startScreen } from "./stage";
import { enterGame } from "./ui/accessGate";
import { chooseMode } from "./ui/startScreen";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("Missing #app root element");
void enterGame(root, (host, connection) =>
  isScreen(window.location.search)
    ? startScreen(host)
    : chooseMode(host, (page) => startGame(page, connection)),
);
