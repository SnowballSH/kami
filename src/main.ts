import { startGame } from "./game";
import { enterGame } from "./ui/accessGate";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("Missing #app root element");
void enterGame(root, startGame);
