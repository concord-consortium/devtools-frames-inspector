// WindowFrameRegistry - Observable map for window-to-frame mappings

import { observable } from 'mobx';
import { WindowFrameRegistration } from './types';

// Export observable map directly
export const windowFrameRegistry = observable.map<string, WindowFrameRegistration>();
