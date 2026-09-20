import { startGame } from "./game";
import { enterGame } from "./ui/accessGate";
import { chooseMode } from "./ui/startScreen";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("Missing #app root element");
void enterGame(root, (host) => chooseMode(host, startGame));
