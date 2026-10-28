/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { getCommandLabel, readCommandUsage, resetCommandUsage } from './shortcutTutor.js';

interface ICommandUsagePickItem extends IQuickPickItem {
	readonly commandId: string;
}

/**
 * Lists how often each command was run with the keyboard and with the mouse,
 * and opens the Keyboard Shortcuts editor for the picked command.
 */
export class ShowCommandUsageAction extends Action2 {

	static readonly ID = 'workbench.action.shortcutTutor.showCommandUsage';

	constructor() {
		super({
			id: ShowCommandUsageAction.ID,
			title: localize2('shortcutTutor.showCommandUsage', "Show Keyboard and Mouse Usage"),
			category: Categories.Preferences,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const keybindingService = accessor.get(IKeybindingService);
		const commandService = accessor.get(ICommandService);

		const usage = readCommandUsage(accessor.get(IStorageService));
		const items = Object.entries(usage)
			.sort(([, a], [, b]) => b.mouse - a.mouse || b.keyboard - a.keyboard)
			.map(([commandId, { keyboard, mouse }]): ICommandUsagePickItem => ({
				commandId,
				label: getCommandLabel(commandId),
				description: keybindingService.lookupKeybinding(commandId)?.getLabel() ?? localize('shortcutTutor.noKeybinding', "No keyboard shortcut"),
				detail: localize('shortcutTutor.usage', "Mouse: {0}, Keyboard: {1}", mouse, keyboard),
			}));

		const picked = await quickInputService.pick(items, {
			placeHolder: items.length
				? localize('shortcutTutor.pickCommand', "Select a command to change its keyboard shortcut")
				: localize('shortcutTutor.noUsage', "No commands recorded yet. Enable 'keyboard.shortcutTutor.enabled' to start recording."),
			matchOnDescription: true,
		});
		if (picked) {
			await commandService.executeCommand('workbench.action.openGlobalKeybindings', `@command:${picked.commandId}`);
		}
	}
}

/**
 * Forgets how often each command was run with the keyboard and with the mouse.
 */
export class ResetCommandUsageAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.shortcutTutor.resetCommandUsage',
			title: localize2('shortcutTutor.resetCommandUsage', "Reset Keyboard and Mouse Usage"),
			category: Categories.Preferences,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		resetCommandUsage(accessor.get(IStorageService));
	}
}
