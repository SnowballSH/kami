import { startGame } from "./game";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) throw new Error("Missing #app root element");
startGame(root);
