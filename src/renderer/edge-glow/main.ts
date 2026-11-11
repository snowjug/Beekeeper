import { getBridge } from '@renderer/lib/bridge';

const bridge = getBridge('edgeGlow');
const frame = document.getElementById('frame');

/** The glow window only reacts to state events; it never accepts input. */
bridge.on('glow:state', ({ active, theme }) => {
  document.documentElement.dataset['theme'] = theme;
  if (frame) frame.dataset['active'] = String(active);
});
