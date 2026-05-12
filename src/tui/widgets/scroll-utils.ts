// pattern: Functional Core — pure scroll position utility functions

/**
 * Determines if a scroll position is at the bottom within tolerance.
 *
 * @param scrollPos Current scroll position in lines
 * @param scrollHeight Total scrollable height in lines
 * @param viewHeight Visible viewport height in lines
 * @returns true if scrollPos is within tolerance of bottom
 */
export function isAtBottom(scrollPos: number, scrollHeight: number, viewHeight: number): boolean {
  // Allow small tolerance (±2 lines) for floating point and rounding comparisons
  const tolerance = 2;
  return scrollPos >= scrollHeight - viewHeight - tolerance;
}
