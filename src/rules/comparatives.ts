/** Halfway from the plain value to the one a quality asks for: "slightly heavier" is 1.5x. */
export const weakened = (value: number, plain: number): number => plain + (value - plain) / 2;
