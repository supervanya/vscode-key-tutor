/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { KeybindingTutorContribution, KeybindingTutorSettings } from './keybindingTutor.js';
import { ResetCommandUsageAction, ShowCommandUsageAction } from './keybindingTutorActions.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[KeybindingTutorSettings.Enabled]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize('keybindingTutor.enabled', "Controls whether to show a hint with the keybinding of a command that was repeatedly run with the mouse. Run [Show Keyboard and Mouse Usage]({0}) to see how often each command was run with the keyboard and with the mouse.", `command:${ShowCommandUsageAction.ID}`),
		},
		[KeybindingTutorSettings.Threshold]: {
			type: 'number',
			default: 3,
			minimum: 1,
			description: localize('keybindingTutor.threshold', "Controls how many times a command has to be run with the mouse before its keybinding is shown."),
		},
		[KeybindingTutorSettings.IgnoredCommands]: {
			type: 'array',
			items: { type: 'string' },
			default: [],
			description: localize('keybindingTutor.ignoredCommands', "Commands for which no keybinding hint is shown, for example after selecting 'Don't Show Again for This Command'."),
		},
	}
});

registerWorkbenchContribution2(KeybindingTutorContribution.ID, KeybindingTutorContribution, WorkbenchPhase.Eventually);

registerAction2(ShowCommandUsageAction);
registerAction2(ResetCommandUsageAction);
