/**
 * Bridge for the off-screen camera indicator.
 *
 * The projection has to happen inside the render loop (that is where the camera
 * and viewport size live), but the chip itself is a DOM element so it can stay a
 * constant size and sit above the canvas. A mutable holder avoids re-rendering
 * React sixty times a second just to move one div.
 */
export const cameraHint = {
  /** Set by the DOM side, written to by the render loop. */
  el: null as HTMLElement | null,
}
