/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { KeybindingTutorContribution, KeybindingTutorSettings } from './keybindingTutor.js';
import { ResetCommandUsageAction, ShowCommandUsageAction } from './keybindingTutorActions.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[KeybindingTutorSettings.Enabled]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize('keybindingTutor.enabled', "Controls whether to show a hint with the keybinding of a command that was repeatedly run with the mouse. Run [Show Keyboard and Mouse Usage]({0}) to see how often each command was run with the keyboard and with the mouse.", `command:${ShowCommandUsageAction.ID}`),
		},
	}
});

/**
 * Creates the settings that only apply while the keybinding tutor is enabled.
 * They are hidden from the Settings editor with `included: false` while it is disabled.
 */
function createOptionsConfigurationNode(included: boolean): IConfigurationNode {
	return {
		...workbenchConfigurationNodeBase,
		properties: {
			[KeybindingTutorSettings.Threshold]: {
				type: 'number',
				default: 3,
				minimum: 1,
				included,
				description: localize('keybindingTutor.threshold', "Controls how many times a command has to be run with the mouse before its keybinding is shown."),
			},
			[KeybindingTutorSettings.IgnoredCommands]: {
				type: 'array',
				items: { type: 'string' },
				default: [],
				included,
				description: localize('keybindingTutor.ignoredCommands', "Commands for which no keybinding hint is shown, for example after selecting 'Don't Show Again for This Command'."),
			},
		}
	};
}

// The tutor is disabled by default, so its options start out hidden.
let optionsConfigurationNode = createOptionsConfigurationNode(false);
let optionsIncluded = false;
configurationRegistry.registerConfiguration(optionsConfigurationNode);

/**
 * Shows the keybinding tutor's options in the Settings editor only while the tutor is enabled.
 */
class KeybindingTutorSettingsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.keybindingTutorSettings';

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._updateOptionsVisibility();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(KeybindingTutorSettings.Enabled)) {
				this._updateOptionsVisibility();
			}
		}));
	}

	private _updateOptionsVisibility(): void {
		const included = !!this._configurationService.getValue<boolean>(KeybindingTutorSettings.Enabled);
		if (included === optionsIncluded) {
			return;
		}
		const next = createOptionsConfigurationNode(included);
		configurationRegistry.updateConfigurations({ add: [next], remove: [optionsConfigurationNode] });
		optionsConfigurationNode = next;
		optionsIncluded = included;
	}
}

registerWorkbenchContribution2(KeybindingTutorSettingsContribution.ID, KeybindingTutorSettingsContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(KeybindingTutorContribution.ID, KeybindingTutorContribution, WorkbenchPhase.Eventually);

registerAction2(ShowCommandUsageAction);
registerAction2(ResetCommandUsageAction);
