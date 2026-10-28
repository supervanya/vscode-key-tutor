/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { KeybindingTutorContribution, KeybindingTutorSettings } from './keybindingTutor.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[KeybindingTutorSettings.Enabled]: {
			type: 'boolean',
			default: false,
			description: localize('keybindingTutor.enabled', "Controls whether to show a hint with the keybinding of a command that was repeatedly run with the mouse."),
		},
		[KeybindingTutorSettings.Threshold]: {
			type: 'number',
			default: 3,
			minimum: 1,
			description: localize('keybindingTutor.threshold', "Controls how many times a command has to be run with the mouse before its keybinding is shown."),
		},
	}
});

registerWorkbenchContribution2(KeybindingTutorContribution.ID, KeybindingTutorContribution, WorkbenchPhase.Eventually);
