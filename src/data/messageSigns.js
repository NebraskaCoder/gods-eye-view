import { createSourceSlot } from '../app/sourceSlot.js';
import {
  createMessageSignsLayer,
  createMessageSignsSource,
} from '../layers/messageSigns/index.js';
import * as render from '../renderGovernor.js';
import * as context from './contextStore.js';
import * as picking from './pickRegistry.js';
import * as groundFloor from './groundFloor.js';
export * from '../layers/messageSigns/index.js';
const slot = createSourceSlot(
  createMessageSignsSource(),
  ['fetch'],
  'Message sign source',
);
export const configureMessageSignsSource = slot.configure;
export default createMessageSignsLayer({
  source: slot.source,
  services: { render, context, picking, groundFloor },
});
