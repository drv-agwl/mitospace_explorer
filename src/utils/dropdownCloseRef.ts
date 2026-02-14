/**
 * When a dropdown closes due to click-outside, we set this so the canvas
 * doesn't deselect the point (the click was intended to close the dropdown).
 */
export const dropdownCloseInProgressRef = { current: false };
